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
    'apps/desktop/src/assets/fonts/OFL.txt',
    'packages/viewer-builtin/src/kicad/vendor/LICENSE.md',
    'packages/viewer-builtin/src/kicad/vendor/earcut-LICENSE',
    'packages/viewer-builtin/src/kicad/vendor/newstroke-NOTICES.txt',
    'packages/viewer-builtin/src/kicad/vendor/symbols-LICENSE',
    'packages/viewer-builtin/src/waveform/surfer/LICENSE-EUPL-1.2.txt',
  ])
    assert.ok(fs.statSync(path.join(root, name)).size > 100, `Missing license material: ${name}`);
  for (const id of ['chip-pack', 'pcb-pack'])
    assert.ok(
      fs.statSync(
        path.join(
          require('../../packages/domain-skills/src/index.cjs').packSourceDirectory(id),
          'PROVENANCE.md',
        ),
      ).size > 100,
    );
  const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notices, /No upstream repository license/);
  assert.match(notices, /excluded from public bundles/);
  assert.match(notices, /copyright holder explicitly granted MIT/);
  assert.ok(
    fs.statSync(
      path.join(
        require('../../packages/domain-skills/src/index.cjs').packSourceDirectory('chip-pack'),
        'eda-harness/LICENSE',
      ),
    ).size > 100,
  );
});

test('desktop staging retains the bundled font license and provenance', () => {
  const os = require('node:os');
  const { copyDesktopNotices } = require('../../scripts/release-notices.cjs');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-font-notices-'));
  try {
    copyDesktopNotices(target);
    assert.equal(
      fs.readFileSync(path.join(target, 'licenses/ibm-plex-sans/OFL.txt'), 'utf8'),
      fs.readFileSync(path.join(root, 'apps/desktop/src/assets/fonts/OFL.txt'), 'utf8'),
    );
    assert.match(
      fs.readFileSync(path.join(target, 'licenses/ibm-plex-sans/README.md'), 'utf8'),
      /@fontsource-variable\/ibm-plex-sans@5\.3\.0/,
    );
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
