const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hash } = require('../src/engineering/read.cjs');
const { parseStl, createCadPlugins } = require('../src/cad/service.cjs');
function triangle() {
  const b = Buffer.alloc(134);
  b.writeUInt32LE(1, 80);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => b.writeFloatLE(v, 96 + i * 4));
  return b;
}
test('CAD STL parser rejects nonfinite, excessive and malformed mesh data', () => {
  assert.equal(parseStl(triangle()).triangles, 1);
  const bad = triangle();
  bad.writeFloatLE(NaN, 96);
  assert.throws(() => parseStl(bad), /invalid/);
  const excessive = Buffer.alloc(84 + 100001 * 50);
  excessive.writeUInt32LE(100001, 80);
  assert.throws(() => parseStl(excessive), /100000/);
  assert.throws(() => parseStl(Buffer.from('solid x\nvertex 0 0 0\nendsolid x')), /incomplete/);
});
test('CAD viewer binds both model and mesh to hash-checked project companions', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cad-view-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = path.join(root, 'model.FCStd'),
    mesh = path.join(root, 'model.stl');
  fs.writeFileSync(model, 'fixture-model');
  fs.writeFileSync(mesh, triangle());
  fs.writeFileSync(
    path.join(root, 'model.cad-preview.json'),
    JSON.stringify({
      schemaVersion: 1,
      hashes: {
        'model.FCStd': hash(fs.readFileSync(model)),
        'model.stl': hash(fs.readFileSync(mesh)),
      },
    }),
  );
  const plugin = createCadPlugins({ projectRoot: () => root })[0];
  const artifact = { name: 'model.FCStd', sha256: hash(fs.readFileSync(model)) };
  assert.equal((await plugin.open({ file: model, artifact })).data.triangles, 1);
  fs.writeFileSync(mesh, Buffer.from('changed'));
  await assert.rejects(plugin.open({ file: model, artifact }), /changed/);
  const outside = path.join(root, '..', path.basename(root) + '-outside.stl');
  fs.writeFileSync(outside, triangle());
  t.after(() => fs.rmSync(outside, { force: true }));
  await assert.rejects(
    plugin.open({ file: outside, artifact: { name: 'outside', sha256: hash(triangle()) } }),
    /outside/,
  );
});
test('OCCT BREP companions are hash bound and cannot escape the project', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occt-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = path.join(root, 'model.FCStd'),
    brep = path.join(root, 'model.brep');
  fs.writeFileSync(model, 'model');
  fs.writeFileSync(path.join(root, 'model.stl'), triangle());
  fs.writeFileSync(brep, 'DBRep_DrawableShape\nCASCADE Topology V3, (c) Open Cascade\n');
  const manifest = {
    schemaVersion: 1,
    hashes: {
      'model.FCStd': hash(fs.readFileSync(model)),
      'model.stl': hash(triangle()),
      'model.brep': hash(fs.readFileSync(brep)),
    },
  };
  fs.writeFileSync(path.join(root, 'model.cad-preview.json'), JSON.stringify(manifest));
  const plugin = createCadPlugins({ projectRoot: () => root })[0],
    artifact = { name: 'model.FCStd', sha256: manifest.hashes['model.FCStd'] };
  assert.equal(
    Buffer.from((await plugin.open({ file: model, artifact })).data.brep, 'base64').toString(),
    fs.readFileSync(brep, 'utf8'),
  );
  fs.writeFileSync(brep, 'tamper');
  await assert.rejects(plugin.open({ file: model, artifact }), /changed/);
  const outside = path.join(root, '..', path.basename(root) + '.brep');
  fs.writeFileSync(outside, 'DBRep_DrawableShape\nCASCADE Topology V3, (c) Open Cascade\n');
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.unlinkSync(brep);
  fs.symlinkSync(outside, brep);
  await assert.rejects(plugin.open({ file: model, artifact }), /outside/);
});
