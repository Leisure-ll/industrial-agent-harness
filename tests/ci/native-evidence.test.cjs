const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectNativeEvidence } = require('../../scripts/collect-native-evidence.cjs');

test('native evidence retains task records and Pack identity without copying managed applications', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'reports');
  const retained = {
    'installed-professional-1/managed-installation.json': '{"runtimes":[{"ready":true}]}',
    'installed-professional-1/installed/pack/bundle.json': '{"version":"1.0.0"}',
    'installed-professional-1/project/verification.json': '{"status":"passed"}',
    'desktop-professional-2/project/model.step': 'native model bytes',
    'desktop-professional-2/project/.runtime-assets/user-data.json': 'project evidence',
    'desktop-professional-2/project/.harness/state.sqlite': 'canonical database bytes',
  };
  for (const [file, content] of Object.entries({
    ...retained,
    'installed-professional-1/installed/.runtime-assets/cache/archive.dmg': 'cached input',
    'desktop-professional-2/installed/.runtime-assets/tool/App.app/Contents/tool': 'native tool',
  })) {
    const target = path.join(source, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  const report = collectNativeEvidence(source, destination);
  assert.equal(report.collected, true);
  assert.equal(report.excludedRuntimeStores.length, 2);
  for (const [file, content] of Object.entries(retained))
    assert.equal(fs.readFileSync(path.join(destination, file), 'utf8'), content);
  for (const file of report.excludedRuntimeStores)
    assert.equal(fs.existsSync(path.join(destination, file)), false);
  assert.equal(
    fs.readFileSync(
      path.join(source, 'installed-professional-1/installed/.runtime-assets/cache/archive.dmg'),
      'utf8',
    ),
    'cached input',
    'Evidence collection must not delete or change the tested installation.',
  );
});

test('native evidence collection tolerates a failure before fixtures are created', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-evidence-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(collectNativeEvidence(path.join(root, 'missing'), path.join(root, 'reports')), {
    collected: false,
    excludedRuntimeStores: [],
  });
});
