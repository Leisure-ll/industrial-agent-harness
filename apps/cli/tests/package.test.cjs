const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { startModel } = require('../../../tests/integration/fixtures/domain-mcp-model.cjs');
const execute = promisify(execFile);

test('packaged headless entry runs outside the workspace with Broker, Skills and bundled real Kimi Code', async t => {
  const root = path.resolve(__dirname, '../../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-headless-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'bundle');
  const built = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/package-headless.cjs'), target],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const checkLinks = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        assert.ok(
          fs.realpathSync(file).startsWith(fs.realpathSync(target) + path.sep) ||
            fs.realpathSync(file) === fs.realpathSync(target),
          `Bundle dependency still points outside the package: ${file}`,
        );
      else if (entry.isDirectory()) checkLinks(file);
    }
  };
  checkLinks(path.join(target, 'node_modules'));
  const suite = path.join(root, 'examples/bench/scope-smoke.json');
  const outputDir = path.join(directory, 'results');
  const executed = spawnSync(
    process.execPath,
    [
      path.join(target, 'industrial-harness.cjs'),
      'bench',
      '--suite',
      suite,
      '--output-dir',
      outputDir,
    ],
    { cwd: os.tmpdir(), encoding: 'utf8' },
  );
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, 'summary.json'))).passed, true);
  assert.ok(
    fs.existsSync(
      path.join(
        target,
        'node_modules/@industrial-agent-harness/domain-skills/skills/chip-netlist-inspect/SKILL.md',
      ),
    ),
  );
  assert.equal(
    fs.existsSync(path.join(target, 'node_modules/@industrial-agent-harness/desktop')),
    false,
  );
  const model = await startModel({ calls: [], success: 'PACKAGED_CODE_OK' });
  t.after(model.close);
  const project = path.join(directory, 'project');
  fs.mkdirSync(project);
  const { stdout } = await execute(
    process.execPath,
    [
      path.join(target, 'industrial-harness.cjs'),
      'run',
      '--project-dir',
      project,
      '--domain',
      'godot',
      '--task',
      'Reply PACKAGED_CODE_OK without tools',
      '--provider',
      'openai_legacy',
      '--endpoint',
      model.endpoint,
      '--model',
      'controlled',
      '--no-thinking',
      '--chat-dir',
      path.join(directory, 'chats'),
      '--state-dir',
      path.join(directory, 'state'),
      '--log-dir',
      path.join(directory, 'logs'),
    ],
    {
      cwd: os.tmpdir(),
      timeout: 30000,
      env: {
        ...process.env,
        KIMI_EXECUTABLE: '',
        OPENAI_API_KEY: 'package-local-fixture',
        INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'settings'),
      },
    },
  );
  const rows = stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows.at(-1).status, 'finished');
  assert.ok(rows.some(row => row.event?.text === 'PACKAGED_CODE_OK'));
  assert.equal(model.requests.length, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(target, 'HARNESS-PACKAGE.json'))).agentRuntime.version,
    '2.1.1',
  );
});
