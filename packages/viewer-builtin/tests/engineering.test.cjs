const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createEngineeringPlugins, isEngineeringFile } = require('../src/engineering/service.cjs');
const { createViewerRegistry } = require('../../viewer-core/src/registry.cjs');
const { createAssetPlugins } = require('../src/assets/service.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-engineering-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(root, name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}
async function open(root, file) {
  const bytes = fs.readFileSync(file);
  const artifact = {
    id: 'fixture',
    name: path.basename(file),
    sha256: sha(bytes),
    sizeBytes: bytes.length,
    kind: 'engineering',
    source: 'project file',
  };
  const registry = createViewerRegistry([
    ...createEngineeringPlugins({ projectRoot: () => root }),
    ...createAssetPlugins({ projectRoot: () => root }),
  ]);
  assert.equal(registry.match(file), 'engineering');
  return registry.get('engineering').open({ artifact, file });
}

test('Godot source views expose scene structure, resources, scripts, configuration, binary metadata and playable audio', async t => {
  const root = setup(t),
    repo = path.resolve(__dirname, '../../..');
  fs.cpSync(path.join(repo, 'examples/godot-viewer'), root, {
    recursive: true,
    filter: source => !source.includes('/build/'),
  });
  const scene = await open(root, path.join(root, 'playground.tscn'));
  assert.equal(scene.data.format, 'Godot scene');
  assert.ok(scene.data.sections.some(item => item.kind === 'node'));
  assert.ok(scene.data.animation?.animations.length);
  assert.ok(scene.data.links.every(link => link.status === 'present'));
  const script = await open(root, path.join(root, 'playground.gd'));
  assert.equal(script.data.format, 'GDScript');
  assert.ok(script.data.sections.some(item => item.kind === 'func'));
  const project = await open(root, path.join(root, 'project.godot'));
  assert.ok(project.data.sections.some(item => item.label === 'application'));
  const resource = write(
    root,
    'theme.tres',
    '[gd_resource type="Theme" format=3]\n[resource]\ndefault_font_size = 20\n',
  );
  assert.equal(
    (await open(root, resource)).data.sections.find(item => item.kind === 'resource').properties
      .default_font_size,
    '20',
  );
  const binary = write(root, 'theme.res', Buffer.from('RSRC12345678'));
  assert.match((await open(root, binary)).data.warnings[0], /not decoded/);
  const audio = write(
    root,
    'effect.wav',
    Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WAVEfmt '),
      Buffer.alloc(40),
    ]),
  );
  assert.match((await open(root, audio)).data.mediaUrl, /^data:audio\/wav;base64,/);
});

test('KiCad symbol, footprint, rules and project settings render bounded structure and geometry', async t => {
  const root = setup(t);
  const symbol = write(
    root,
    'Device.kicad_sym',
    '(kicad_symbol_lib (version 20211014) (generator kicad_symbol_editor) (symbol "R" (property "Reference" "R") (symbol "R_1_1" (rectangle (start -1 1) (end 1 -1)) (pin passive line (at -3 0 0) (length 2) (name "A") (number "1")))))',
  );
  const footprint = write(
    root,
    'Resistor.pretty/R_0603.kicad_mod',
    '(footprint "R_0603" (version 20221018) (layer "F.Cu") (fp_rect (start -2 -1) (end 2 1)) (pad "1" smd rect (at -1 0) (size 0.8 0.9)) (pad "2" smd rect (at 1 0) (size 0.8 0.9)))',
  );
  const sym = await open(root, symbol),
    pad = await open(root, footprint);
  assert.equal(sym.data.sections[0].properties.pins, '1');
  assert.ok(sym.data.drawings.some(shape => shape.type === 'line'));
  assert.equal(pad.data.sections[0].properties.pads, '2');
  assert.equal(pad.data.drawings.filter(shape => shape.type === 'pad').length, 2);
  const rule = write(
    root,
    'board.kicad_dru',
    '# local rules\n(version 1)\n(rule "width" (constraint track_width (min 0.2mm)))\n',
  );
  assert.equal((await open(root, rule)).data.sections[0].label, 'width');
  const project = write(
    root,
    'board.kicad_pro',
    JSON.stringify({ board: { design_settings: { layers: 2 } }, schematic: { drawing: {} } }),
  );
  assert.equal((await open(root, project)).data.sections.length, 2);
});

test('Gerber and Excellon files combine matching layers and preserve coordinate warnings', async t => {
  const root = setup(t),
    gerber =
      '%FSLAX24Y24*%\n%MOMM*%\n%ADD10C,0.2*%\nD10*\nX010000Y010000D02*\nX020000Y010000D01*\nX020000Y020000D03*\nM02*';
  const selected = write(root, 'board-F_Cu.gbr', gerber);
  write(root, 'board-B_Cu.gbr', gerber.replace('X020000Y020000', 'X030000Y020000'));
  write(root, 'board-PTH.drl', 'M48\nMETRIC,TZ\nT01C0.8\n%\nT01\nX1.0Y2.0\nM30\n');
  write(root, 'board-F_Paste.gbr', 'invalid companion');
  write(root, 'other-F_Cu.gbr', gerber);
  const output = await open(root, selected);
  assert.equal(output.data.sections.length, 3);
  assert.equal(output.data.drawings.filter(shape => shape.type === 'circle').length, 3);
  assert.ok(output.data.warnings.some(value => value.includes('board-F_Paste.gbr')));
  assert.ok(output.data.drawings.some(shape => shape.type === 'line' && shape.x2 === 2));
  const trailing = write(
    root,
    'trailing.gbr',
    '%FSTAX24Y24*%\n%MOMM*%\n%ADD10R,1X2*%\nD10*\nX01Y02D03*\nM02*',
  );
  const rectangle = await open(root, trailing);
  assert.deepEqual(rectangle.data.drawings[0], {
    type: 'pad',
    x1: 0.5,
    y1: -3,
    x2: 1.5,
    y2: -1,
    group: 'layer-0',
  });
  const wrongFormat = write(root, 'incremental.gbr', '%FSLIX24Y24*%\n%MOMM*%\nX010000Y010000D02*');
  await assert.rejects(open(root, wrongFormat), /Unsupported Gerber coordinate format/);
  const bad = write(root, 'bad.gbr', 'not Gerber');
  await assert.rejects(open(root, bad), /recognizable Gerber/);
});

test('OBJ, glTF, GLB, STEP and VRML have explicit bounded previews', async t => {
  const root = setup(t);
  const obj = write(root, 'mesh.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  assert.equal((await open(root, obj)).data.drawings[0].type, 'polyline');
  const gltf = write(
    root,
    'mesh.gltf',
    JSON.stringify({ asset: { version: '2.0' }, nodes: [{ name: 'Body', mesh: 0 }], meshes: [{}] }),
  );
  assert.equal((await open(root, gltf)).data.sections[0].label, 'Body');
  const json = Buffer.from(
    JSON.stringify({ asset: { version: '2.0' }, nodes: [{ name: 'Head' }] }),
  );
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.write('JSON', 16);
  const glb = write(root, 'mesh.glb', Buffer.concat([header, padded]));
  assert.equal((await open(root, glb)).data.sections[0].label, 'Head');
  const step = write(
    root,
    'body.step',
    "ISO-10303-21;\nDATA;\n#1 = CARTESIAN_POINT('',(1.0,2.0,3.0));\nENDSEC;\nEND-ISO-10303-21;",
  );
  assert.equal((await open(root, step)).data.drawings.length, 1);
  const wrl = write(
    root,
    'body.wrl',
    '#VRML V2.0 utf8\nShape { geometry IndexedFaceSet { coord Coordinate { point [0 0 0, 1 0 0, 0 1 0] } coordIndex [0, 1, 2, -1] } }',
  );
  assert.equal((await open(root, wrl)).data.drawings[0].type, 'polyline');
});

test('Viewer refuses changed artifact, oversized input and links outside the project', async t => {
  const root = setup(t),
    outside = setup(t),
    source = write(
      root,
      'scene.tscn',
      '[gd_scene format=3]\n[ext_resource type="Script" path="res://missing.gd" id="1"]\n',
    );
  const opened = await open(root, source);
  assert.equal(opened.data.links[0].status, 'missing');
  const plugin = createEngineeringPlugins({ projectRoot: () => root })[0];
  await assert.rejects(
    plugin.open({ artifact: { name: 'scene.tscn', sha256: '0'.repeat(64) }, file: source }),
    /changed/,
  );
  const outsideFile = write(outside, 'outside.tscn', '[gd_scene format=3]');
  fs.symlinkSync(outsideFile, path.join(root, 'escape.tscn'));
  await assert.rejects(
    plugin.open({
      artifact: { name: 'escape.tscn', sha256: sha(fs.readFileSync(outsideFile)) },
      file: path.join(root, 'escape.tscn'),
    }),
    /outside/,
  );
  const huge = write(root, 'huge.gd', 'x'.repeat(4 * 1024 * 1024 + 1));
  await assert.rejects(open(root, huge), /limit/);
  assert.equal(isEngineeringFile(path.join(root, 'scene.tscn')), true);
  assert.equal(isEngineeringFile(path.join(root, 'unrelated.txt')), false);
});
