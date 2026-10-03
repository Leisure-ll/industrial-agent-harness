"""Fault injection into the packaged Python runtime; no engineering PASS fixture."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import yaml

from eda_harness.core.models import Resources, RuntimeConfig
from eda_harness.core.service import Harness
from eda_harness.runtimes import execution, resources


class RuntimeContracts(unittest.TestCase):
    def test_client_exit_cleans_surviving_container(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proc = Mock(pid=987654, returncode=1)
            proc.poll.return_value = 1
            cleanup = Mock(return_value={"confirmed": True})
            runtime = execution.Runtime(RuntimeConfig(kind="docker", image="fault:test"),
                {"image_id": "sha256:fault"}, "eda-fault", root, root, root)
            with patch.object(execution.subprocess, "Popen", return_value=proc), \
                 patch.object(execution, "inspect_container", return_value={"Running": True}), \
                 patch.object(execution, "cleanup_container", cleanup), \
                 patch.object(execution, "stop_process"):
                result = runtime.execute(["tool"], {}, root / "log", lambda: False, lambda *a: None)
            self.assertEqual(result.status, "FAILED")
            self.assertTrue(result.container_state["Running"])
            cleanup.assert_called_once_with("eda-fault")

    def test_actual_daemon_budget_and_shared_admission(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "EDA_RESOURCE_STATE_DIR": directory, "EDA_MAX_CONCURRENT_ACTIONS": "1",
        }):
            info = {"kind": "docker", "daemon_id": "fault-daemon", "daemon_cpu": 8, "daemon_memory_gb": 8}
            with self.assertRaisesRegex(ValueError, "EDA_RESOURCE_MEMORY"):
                resources.acquire("too-big", Resources(memory_gb=16), info)
            resources.acquire("project-a", Resources(), info)
            with self.assertRaisesRegex(ValueError, "EDA_RESOURCE_BUSY"):
                resources.acquire("project-b", Resources(), info)
            resources.release("project-a")
            self.assertTrue(resources.acquire("project-b", Resources(), info))
            resources.release("project-b")

    def test_failed_action_records_unknown_and_execution_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "top.sv").write_text("module top; endmodule\n")
            (root / "eda.yaml").write_text(yaml.safe_dump({
                "name": "failure-contract", "top": "top", "inputs": {"rtl": ["top.sv"]},
                "runtime": {"kind": "local"}, "actions": {},
            }))
            def fail(runtime, argv, env, log, *callbacks):
                log.write_text("make: *** [do-5_1_grt] Error 247\n")
                return execution.Execution("FAILED", 2, 0.1, argv)
            with patch("eda_harness.core.service.identity", return_value={"kind": "local", "sha256": "fault"}), \
                 patch.object(execution.Runtime, "execute", fail):
                h = Harness(root)
                run = h.submit("lint", background=False)
            self.assertEqual(run["status"], "FAILED")
            step = run["steps"][0]
            self.assertEqual(step["verification"]["status"], "UNKNOWN")
            artifacts = [h.store.get("artifact", item) for item in step["artifacts"]]
            report = next(a for a in artifacts if a["type"] == "report.execution")
            self.assertEqual(json.loads(h.read_artifact(report["id"])["text"])[0]["returncode"], 2)
            self.assertIsNone(h.state())

    def test_probe_timeout_cleans_named_container(self):
        cleanup = Mock(return_value={"confirmed": True})
        with patch.object(execution.subprocess, "run", side_effect=subprocess.TimeoutExpired("docker", 1)), \
             patch.object(execution, "cleanup_container", cleanup):
            with self.assertRaises(subprocess.TimeoutExpired):
                execution.run_probe(["docker", "run", "fault", "sleep", "60"], timeout=1)
        self.assertTrue(cleanup.call_args.args[0].startswith("eda-probe-"))


if __name__ == "__main__":
    unittest.main()
