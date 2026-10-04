const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ExternalMcpRegistry } = require('../../packages/domain-mcp/src/index.cjs');
const { startModel } = require('./fixtures/domain-mcp-model.cjs');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const entry = process.env.INDUSTRIAL_HARNESS_TEST_CLI || path.join(root, 'apps/cli/src/main.cjs');
const kimi = process.env.KIMI_EXECUTABLE || path.join(root, 'apps/desktop/.venv-kimi/bin/kimi');
const server = path.join(__dirname, 'fixtures/external-mcp-server.cjs');

test(
  'real CLI refuses enabled host services without calling the model; disabling them starts the protected Kimi session',
  { timeout: 90000, skip: !fs.existsSync(kimi) },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-external-kimi-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const configs = path.join(directory, 'settings');
    const marker = path.join(directory, 'host-click.json');
    const file = path.join(directory, 'mcp.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          'computer-use': {
            command: process.execPath,
            args: [server],
            env: { FIXTURE_CLICK_MARKER: marker },
          },
        },
      }),
    );
    const environment = {
      ...process.env,
      INDUSTRIAL_HARNESS_CONFIG_DIR: configs,
      OPENAI_API_KEY: 'controlled-external-fixture',
    };
    const added = await execute(process.execPath, [entry, 'mcp', 'add', '--file', file], {
      cwd: os.tmpdir(),
      env: environment,
    });
    assert.equal(JSON.parse(added.stdout).servers[0].id, 'external.computer-use');
    assert.ok(
      new ExternalMcpRegistry(configs).records()[0].tools.some(tool => tool.name === 'click'),
    );
    const fixture = await startModel({ calls: [], success: 'PROTECTED_SESSION_READY' });
    t.after(fixture.close);
    const project = path.join(directory, 'project');
    fs.mkdirSync(project);
    const args = approval => [
      entry,
      'run',
      '--project-dir',
      project,
      '--domain',
      'chip',
      '--task',
      'Use the host screenshot and click',
      '--provider',
      'openai_legacy',
      '--endpoint',
      fixture.endpoint,
      '--model',
      'controlled-external',
      '--no-thinking',
      '--approval',
      approval,
      '--kimi-executable',
      kimi,
      '--timeout-ms',
      '30000',
      '--chat-dir',
      path.join(directory, 'chats'),
      '--state-dir',
      path.join(directory, 'state'),
      '--log-dir',
      path.join(directory, 'logs'),
    ];
    const invoke = values =>
      execute(process.execPath, values, {
        cwd: os.tmpdir(),
        env: environment,
        timeout: 45000,
        maxBuffer: 4 * 1024 * 1024,
      });
    for (const approval of ['reject', 'approve']) {
      await assert.rejects(invoke(args(approval)), error => {
        assert.equal(error.code, 1);
        const rows = error.stdout.trim().split('\n').map(JSON.parse);
        assert.equal(rows.at(-1).status, 'error');
        assert.ok(
          rows.some(row => row.event?.type === 'error' && /外部 MCP/.test(row.event.message)),
        );
        return true;
      });
      assert.equal(fixture.requests.length, 0);
      assert.ok(!fs.existsSync(marker));
    }
    for (const policy of ['once', 'persisted']) {
      if (policy === 'persisted') {
        const disabled = await invoke([
          entry,
          'mcp',
          'disable',
          'external.computer-use',
          '--project-dir',
          project,
        ]);
        assert.ok(
          JSON.parse(disabled.stdout).settings.effective.mcpServers.includes(
            'external.computer-use',
          ),
        );
      }
      const before = fixture.requests.length;
      const values = [
        ...args('approve'),
        ...(policy === 'once' ? ['--disable-mcp', 'external.computer-use'] : []),
      ];
      if (process.platform !== 'darwin') {
        await assert.rejects(
          invoke(values),
          error => error.code === 1 && /verified process write boundary/.test(error.stdout),
        );
        continue;
      }
      const { stdout, stderr } = await invoke(values);
      const rows = stdout.trim().split('\n').map(JSON.parse);
      assert.equal(rows.at(-1).status, 'finished', stdout + stderr);
      assert.equal(fixture.requests.length, before + 1);
      assert.ok(
        !fixture.requests.at(-1).tools.some(tool => tool.function.name === 'external_tool_call'),
      );
      assert.ok(!rows[0].scope.tools.some(id => id.startsWith('external.')));
      assert.ok(
        rows.some(
          row => row.event?.type === 'execution-boundary' && row.event.projectWritable === false,
        ),
      );
      assert.ok(!fs.existsSync(marker));
    }
  },
);
