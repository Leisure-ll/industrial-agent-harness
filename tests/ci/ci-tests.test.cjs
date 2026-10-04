const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assess, allowedSkips } = require('../../scripts/ci-tests.cjs');

test('CI cannot pass with no tests, failed, cancelled, TODO or unaccounted skipped tests', () => {
  const counts = { tests: 1, passed: 1, failed: 0, cancelled: 0, todo: 0, skipped: 0 };
  assert.equal(assess({ success: true, counts }, []).ok, true);
  for (const change of [
    { tests: 0, passed: 0 },
    { failed: 1 },
    { cancelled: 1 },
    { todo: 1 },
    { skipped: 1 },
  ]) {
    assert.equal(assess({ success: true, counts: { ...counts, ...change } }, []).ok, false);
  }
  assert.equal(assess(undefined, []).ok, false);
  assert.equal(assess({ success: false, counts }, []).ok, false);
  assert.deepEqual(allowedSkips('native', 'darwin'), []);
  assert.deepEqual(allowedSkips('benchmark', 'linux'), []);
});

test('real Node test events fail CI for unexpected skips, TODO and assertion failures', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ci-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runner = path.resolve(__dirname, '../../scripts/ci-tests.cjs');
  for (const [name, source, expected] of [
    ['passing', "test('executed', () => {});", true],
    [
      'skipped',
      "test('executed', () => {}); test('missing native', {skip:true}, () => {});",
      false,
    ],
    ['todo', "test('unfinished', {todo:true}, () => {});", false],
    ['failing', "test('broken', () => {throw Error('broken');});", false],
  ]) {
    const file = path.join(directory, `${name}.test.cjs`);
    fs.writeFileSync(file, `const test = require('node:test');\n${source}\n`);
    const program = `require(${JSON.stringify(runner)}).runFiles(${JSON.stringify({
      suite: name,
      files: [file],
      reportDirectory: directory,
    })}).then(report => {process.exitCode = report.ok ? 0 : 1;})`;
    const launcher = path.join(directory, `${name}-runner.cjs`);
    fs.writeFileSync(launcher, program);
    const result = spawnSync(process.execPath, [launcher], {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected ? 0 : 1, result.stdout + result.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8'));
    assert.equal(report.ok, expected);
    if (name === 'skipped') assert.deepEqual(report.unexpectedSkips, ['missing native']);
  }
});
