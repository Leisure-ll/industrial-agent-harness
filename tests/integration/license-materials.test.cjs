const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

test('public source retains original license and bundled component notices without relicensing externally loaded actor resources', () => {
  for (const name of [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'SECURITY.md',
    'packages/viewer-builtin/src/kicad/vendor/LICENSE.md',
    'packages/viewer-builtin/src/kicad/vendor/earcut-LICENSE',
    'packages/viewer-builtin/src/kicad/vendor/newstroke-NOTICES.txt',
    'packages/viewer-builtin/src/kicad/vendor/symbols-LICENSE',
    'packages/viewer-builtin/src/waveform/surfer/LICENSE-EUPL-1.2.txt',
    'domain-packs/chip/PROVENANCE.md',
    'domain-packs/pcb/PROVENANCE.md',
  ])
    assert.ok(fs.statSync(path.join(root, name)).size > 100, `Missing license material: ${name}`);
  const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notices, /No upstream repository license/);
  assert.match(notices, /excluded from public bundles/);
  assert.match(notices, /copyright holder explicitly granted MIT/);
  assert.ok(fs.statSync(path.join(root, 'domain-packs/chip/eda-harness/LICENSE')).size > 100);
});
