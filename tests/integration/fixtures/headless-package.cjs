const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function buildHeadlessPackage(t) {
  const root = path.resolve(__dirname, '../../..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-headless-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'bundle');
  const built = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/package-headless.cjs'), target],
    { cwd: root, encoding: 'utf8' },
  );
  assert.ifError(built.error);
  assert.equal(built.status, 0, built.stderr || built.stdout);
  return { root, directory, target };
}

module.exports = { buildHeadlessPackage };
