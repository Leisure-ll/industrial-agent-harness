const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { execFile } = require('node:child_process'),
  { promisify } = require('node:util');
const execute = promisify(execFile),
  entry = path.resolve(__dirname, '../src/main.cjs');
test(
  'doctor reports a missing declared executable before model startup and retains a read-only Action',
  { timeout: 30000 },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-doctor-')),
      project = path.join(directory, 'project');
    fs.mkdirSync(project);
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const manifest = JSON.stringify({
      schemaVersion: '1',
      tasks: { test: { command: ['harness-test-definitely-missing'], inputs: ['source'] } },
    });
    fs.writeFileSync(path.join(project, 'harness.tasks.json'), manifest);
    fs.writeFileSync(path.join(project, 'source'), 'input');
    let result;
    try {
      await execute(
        process.execPath,
        [
          entry,
          'doctor',
          '--project-dir',
          project,
          '--domain',
          'chip',
          '--state-dir',
          path.join(directory, 'state'),
        ],
        {
          env: { ...process.env, INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'config') },
          timeout: 20000,
        },
      );
    } catch (error) {
      result = error;
    }
    assert.equal(result?.code, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.type, 'doctor');
    assert.equal(report.ready, false);
    assert.ok(
      report.checks.some(
        check => check.name === 'task test executable' && check.status === 'missing',
      ),
    );
    assert.match(report.actionId, /^[a-f0-9-]{36}$/);
    assert.equal(report.agent.expectedVersion, '2.1.1');
    assert.equal(fs.readFileSync(path.join(project, 'harness.tasks.json'), 'utf8'), manifest);
  },
);
