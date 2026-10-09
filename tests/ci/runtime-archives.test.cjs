const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  archiveDeclarations,
  prepareArchives,
} = require('../../scripts/prepare-ci-runtime-archives.cjs');

test('CI archive paths and identities come from the immutable owner declarations', () => {
  const assets = archiveDeclarations(path.resolve('dist'));
  assert.deepEqual(
    assets.map(asset => asset.id),
    ['freecad', 'kicad', 'godot'],
  );
  assert.deepEqual(
    assets.map(asset => path.basename(asset.file)),
    ['FreeCAD_1.1.4-macOS-arm64-py311.dmg', 'kicad.dmg', 'godot.zip'],
  );
  assert.deepEqual(
    assets.map(asset => path.basename(path.dirname(asset.file))),
    ['freecad-runtime', 'pcb-runtime', 'godot-runtime'],
  );
  for (const asset of assets) {
    assert.ok(asset.size > 0);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  }
});

test('archive preparation verifies downloaded and restored bytes, creates no app, and rejects corrupt archives', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-native-archives-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('official archive fixture');
  const asset = {
    id: 'fixture',
    url: 'https://example.test/tool.zip',
    file: path.join(directory, 'tool.zip'),
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  let requests = 0;
  const options = {
    download: true,
    fetchImpl: async () => {
      requests++;
      return new Response(bytes);
    },
  };
  assert.deepEqual(await prepareArchives([asset], options), { fixture: asset.file });
  assert.deepEqual(fs.readdirSync(directory), ['tool.zip']);
  await prepareArchives([asset], options);
  assert.equal(requests, 1);
  fs.writeFileSync(asset.file, Buffer.alloc(bytes.length));
  await assert.rejects(prepareArchives([asset], options), /SHA-256 mismatch/);
  fs.writeFileSync(asset.file, 'truncated');
  await assert.rejects(prepareArchives([asset], options), /size mismatch/);
  fs.rmSync(asset.file);
  await assert.rejects(prepareArchives([asset]), /Missing prepared official archive/);
  await assert.rejects(
    prepareArchives([asset], { download: true, fetchImpl: async () => new Response('bad') }),
    /size mismatch/,
  );
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('an existing FreeCAD setup cache is found at the declared path without another download', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-freecad-cache-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('verified FreeCAD cache fixture');
  const asset = {
    ...archiveDeclarations(directory).find(asset => asset.id === 'freecad'),
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  const setupCache = path.join(directory, 'freecad-runtime', 'FreeCAD_1.1.4-macOS-arm64-py311.dmg');
  fs.mkdirSync(path.dirname(setupCache));
  fs.writeFileSync(setupCache, bytes);
  assert.deepEqual(
    await prepareArchives([asset], {
      download: true,
      fetchImpl: async () => {
        throw Error('An existing verified setup archive must be reused');
      },
    }),
    { freecad: setupCache },
  );
  assert.equal(fs.existsSync(path.join(directory, 'cad-runtime')), false);
});
