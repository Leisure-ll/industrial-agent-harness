const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { buildHeadlessPackage } = require('./fixtures/headless-package.cjs');
const { startModel } = require('./fixtures/domain-mcp-model.cjs');
const execute = promisify(execFile);

// This gate requires the production process boundary. Run it on the declared
// native platforms, separately from portable packaging and other pnpm deploys.
test('packaged headless Agent completes a real protected Kimi Code turn outside the workspace', async t => {
  const { directory, target } = buildHeadlessPackage(t);
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
  assert.ok(
    rows.some(
      row => row.event?.type === 'execution-boundary' && row.event.projectWritable === false,
    ),
  );
  assert.ok(rows.some(row => row.event?.text === 'PACKAGED_CODE_OK'));
  assert.equal(model.requests.length, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(target, 'HARNESS-PACKAGE.json'))).agentRuntime.version,
    '2.1.1',
  );
});
