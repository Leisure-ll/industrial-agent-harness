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
  'real CLI analyses a project without a Runtime while filtering enabled host services and GUI; preferences stay intact',
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
    const project = path.join(directory, 'project');
    fs.mkdirSync(project);
    const readme = path.join(project, 'README.md');
    fs.writeFileSync(readme, 'PCB_PROJECT_ANALYSIS_INPUT\n');
    const fixture = await startModel({
      calls: [{ name: 'ReadFile', arguments: { path: readme } }],
      success: 'PROTECTED_SESSION_READY',
    });
    t.after(fixture.close);
    const args = approval => [
      entry,
      'run',
      '--project-dir',
      project,
      '--domain',
      'pcb',
      '--task',
      '分析一下当前项目，读取 README.md',
      '--enable-gui',
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
    for (const policy of ['enabled', 'once', 'persisted']) {
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
      assert.equal(fixture.requests.length, before + 2);
      assert.match(JSON.stringify(fixture.requests.at(-1).messages), /PCB_PROJECT_ANALYSIS_INPUT/);
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
      assert.ok(rows.some(row => row.type === 'execution_policy'));
      assert.ok(!rows.some(row => row.type === 'gui_install'));
      assert.match(fs.readFileSync(readme, 'utf8'), /PCB_PROJECT_ANALYSIS_INPUT/);
      if (policy === 'enabled') {
        assert.ok(rows[0].trace.some(row => row.event === 'resource.execution-boundary'));
        assert.ok(rows.some(row => row.event?.type === 'text' && /暂不可用/.test(row.event.text)));
        const log = rows.find(row => row.event?.type === 'diagnostic-log').event.path;
        assert.match(fs.readFileSync(log, 'utf8'), /resource.filtered/);
        assert.equal(new ExternalMcpRegistry(configs).records().length, 1);
        assert.ok(!fs.existsSync(path.join(configs, 'resource-settings.json')));
      }
    }
  },
);
