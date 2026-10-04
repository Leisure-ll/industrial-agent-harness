const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const occt = path.join(root, 'packages/viewer-builtin/src/cad/occt');
const { copyDesktopNotices } = require('../../../scripts/release-notices.cjs');

test('distributed OCCT assets match pinned source and include relinkable desktop sources', t => {
  const manifest = JSON.parse(fs.readFileSync(path.join(occt, 'manifest.json')));
  assert.equal(manifest.repository, 'https://github.com/Open-Cascade-SAS/OCCT');
  assert.equal(manifest.revision, 'c5f20409c52bf8f658314d205a0e5d6f0be0969c');
  assert.deepEqual(manifest.occtModifications, []);
  for (const [file, digest] of Object.entries(manifest.files))
    assert.equal(
      createHash('sha256')
        .update(fs.readFileSync(path.join(occt, file)))
        .digest('hex'),
      digest,
      file,
    );
  assert.equal(
    fs.readFileSync(path.join(occt, 'harness-occt.wasm')).subarray(0, 4).toString('hex'),
    '0061736d',
  );
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'occt-release-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  copyDesktopNotices(target, root);
  for (const file of [
    'LICENSE_LGPL_21.txt',
    'OCCT_LGPL_EXCEPTION.txt',
    'EMSCRIPTEN-LICENSE.txt',
    'NOTICE.md',
    'README.md',
    'manifest.json',
    'native/Viewer.cpp',
    'native/CMakeLists.txt',
    'source/OCCT-7.9.2.tar.gz',
  ])
    assert.deepEqual(
      fs.readFileSync(path.join(target, 'licenses/occt', file)),
      fs.readFileSync(path.join(occt, file)),
      file,
    );
  assert.deepEqual(
    fs.readFileSync(path.join(target, 'licenses/occt/build-occt-viewer.cjs')),
    fs.readFileSync(path.join(root, 'scripts/build-occt-viewer.cjs')),
  );
});
