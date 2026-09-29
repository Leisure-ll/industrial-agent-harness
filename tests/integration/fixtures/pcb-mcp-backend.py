"""Controlled protocol fixture, not a native KiCad runtime or engineering verifier.

Invoked in place of Docker only by a test-created private policy. The production
launcher never installs this file or accepts model-provided launch commands.
"""
import base64
import json
from pathlib import Path
import subprocess
import sys
import os

DEFINITIONS = [
    {"type": "function", "function": {"name": "project_status", "description": "Read fixture state", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "new_project", "description": "Create fixture intent", "parameters": {"type": "object", "properties": {"width_mm": {"type": "number", "exclusiveMinimum": 0}, "height_mm": {"type": "number", "exclusiveMinimum": 0}}, "required": ["width_mm", "height_mm"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "run_drc", "description": "Return a controlled failed check", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "view_design", "description": "Return a controlled image", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}}},
    {"type": "function", "function": {"name": "inspect_tool", "description": "Return a controlled large contract", "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}}},
]


def main():
    global DEFINITIONS
    mount = next(value for value in sys.argv if ",dst=/harness/policy.json" in value)
    policy_file = mount.split(",dst=", 1)[0].removeprefix("type=bind,src=")
    policy = json.loads(Path(policy_file).read_text())
    if policy.get("fixtureSourceDir"):
        env = {**os.environ, "PYTHONPATH": str(Path(policy["fixtureSourceDir"]) / "pcb-agent"), "PCB_SKILLS": str(Path(policy["fixtureSourceDir"]) / "skills")}
        raise SystemExit(subprocess.call([sys.executable, "-m", "tools.kimi_mcp"], cwd=policy["projectDir"], env=env))
    if os.environ.get("PCB_FIXTURE_USE_SOURCE_SCHEMAS") == "1":
        sys.path.insert(0, str(Path(policy["sourceDir"]) / "pcb-agent"))
        from tools.agent_session import TOOLS
        DEFINITIONS = TOOLS
    root = Path(policy["projectDir"])
    for line in sys.stdin:
        request = json.loads(line)
        if "id" not in request:
            continue
        method = request["method"]
        if method == "initialize":
            result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "pcb-atomic-tools", "version": "1.0.0"}}
        elif method == "tools/list":
            result = {"tools": [{"name": t["function"]["name"], "description": t["function"]["description"], "inputSchema": t["function"]["parameters"]} for t in DEFINITIONS]}
            if policy.get("fixtureBadSchema"):
                result["tools"][0]["inputSchema"] = {"type": "object", "properties": {"unexpected": {"type": "string"}}}
        elif method == "tools/call":
            params = request["params"]
            name, arguments = params["name"], params.get("arguments", {})
            with (root / "fixture-actions.jsonl").open("a") as stream:
                stream.write(json.dumps(params) + "\n")
            images = []
            if name == "new_project":
                (root / "spec.json").write_text(json.dumps(arguments))
                data = {"status": "MODIFIED", "verification": "REQUIRED", "operation_outcome": "CHANGED", "action": 1}
            elif name == "project_status":
                data = {"status": "PASS", "verification_role": "observation_only", "spec": json.loads((root / "spec.json").read_text()) if (root / "spec.json").exists() else None}
            elif name == "run_drc":
                data = {"status": "FAIL", "available": True, "report_valid": True, "violations": [{"uuid": "fixture-object", "type": "short"}]}
            elif name == "inspect_tool":
                data = {"status": "PASS", "scope": "fixture", "text": "完整报告\n\t" * 12000}
            else:
                data = {"status": "PASS", "verification_role": "observation_only"}
                images = [{"type": "image", "mimeType": "image/png", "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO2kAAAAASUVORK5CYII="}]
            result = {"content": [{"type": "text", "text": json.dumps(data)}, *images], "isError": False}
        else:
            result = {}
        print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)


if __name__ == "__main__":
    main()
