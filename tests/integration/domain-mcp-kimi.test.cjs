const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { startModel } = require('./fixtures/domain-mcp-model.cjs');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const entry = process.env.INDUSTRIAL_HARNESS_TEST_CLI || path.join(root, 'apps/cli/src/main.cjs');
const kimi = process.env.KIMI_EXECUTABLE || path.join(root, 'apps/desktop/.venv-kimi/bin/kimi');
const python =
  process.env.INDUSTRIAL_HARNESS_EDA_PYTHON ||
  path.join(root, 'domain-packs/chip/eda-harness/.venv/bin/python');

test(
  'real CLI + pinned Kimi refuses legacy project mutation even after approval; empty engineering state does not disclose legacy tools',
  { timeout: 90000, skip: !fs.existsSync(kimi) || !fs.existsSync(python) },
  async t => {
    let activeProject;
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const fixture = await startModel({
      calls: () => [
        {
          name: 'Shell',
          arguments: {
            command: `${quote(python)} -c ${quote('import sys; from eda_harness.core.service import Harness; Harness(sys.argv[1]).create_goal("MCP_INTEGRATION_GOAL", {}, [])')} ${quote(activeProject)}`,
          },
        },
      ],
    });
    t.after(fixture.close);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-kimi-mcp-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    for (const approval of ['reject', 'approve']) {
      const project = path.join(directory, approval);
      activeProject = project;
      fs.mkdirSync(project);
      fs.writeFileSync(
        path.join(project, 'eda.yaml'),
        'name: mcp-test\ntop: top\nruntime:\n  kind: local\ninputs: {}\nactions: {}\nrequired_verification: []\n',
      );
      const before = fixture.requests.length;
      const args = [
        entry,
        'run',
        '--project-dir',
        project,
        '--domain',
        'chip',
        '--task',
        'create_goal for MCP integration',
        '--approval',
        approval,
        '--provider',
        'openai_legacy',
        '--endpoint',
        fixture.endpoint,
        '--model',
        'controlled-mcp',
        '--no-thinking',
        '--kimi-executable',
        kimi,
        '--timeout-ms',
        '25000',
        '--chat-dir',
        path.join(directory, 'chats'),
        '--state-dir',
        path.join(directory, 'state'),
        '--log-dir',
        path.join(directory, 'logs'),
      ];
      const { stdout, stderr } = await execute(process.execPath, args, {
        cwd: root,
        env: {
          ...process.env,
          OPENAI_API_KEY: 'local-fixture-key',
          INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'resources'),
        },
        timeout: 40000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const rows = stdout.trim().split('\n').map(JSON.parse);
      assert.equal(rows.at(-1).status, 'finished', stderr + stdout);
      assert.ok(rows.some(row => row.type === 'approval_decision' && row.decision === approval));
      const requests = fixture.requests.slice(before);
      const tools = requests[0].tools.map(tool => tool.function.name);
      assert.ok(!tools.includes('domain_tool_call'));
      assert.ok(!tools.includes('run_action'));
      if (approval === 'approve') {
        const output = JSON.stringify(
          requests.at(-1).messages.filter(message => message.role === 'tool'),
        );
        assert.match(output, /Operation not permitted|PermissionError|Read-only file system/);
        assert.match(output, /\.eda/);
        assert.ok(
          rows.some(
            row => row.event?.type === 'execution-boundary' && row.event.projectWritable === false,
          ),
        );
      }
      assert.ok(!fs.existsSync(path.join(project, '.eda')));
      assert.ok(
        !rows.some(row => row.type === 'industrial_result' && row.verification.status === 'passed'),
      );
    }
  },
);
