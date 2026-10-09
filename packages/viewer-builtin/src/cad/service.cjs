const fs = require('node:fs');
const path = require('node:path');
const { readBounded, utf8 } = require('../engineering/read.cjs');
const { parseSketches } = require('./sketches.cjs');
const LIMIT = 100000;
function parseStl(bytes) {
  const vertices = [];
  if (bytes.length >= 84 && 84 + bytes.readUInt32LE(80) * 50 === bytes.length) {
    const count = bytes.readUInt32LE(80);
    if (!count || count > LIMIT) throw Error('STL needs 1–100000 triangles.');
    for (let i = 0; i < count; i++)
      for (let j = 0; j < 9; j++) vertices.push(bytes.readFloatLE(84 + i * 50 + 12 + j * 4));
  } else {
    const text = utf8(bytes);
    if (!/^\s*solid\b/.test(text) || !/endsolid\b/.test(text))
      throw Error('Unsupported STL encoding.');
    const pattern = /\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g;
    for (const match of text.matchAll(pattern)) {
      if (vertices.length >= LIMIT * 9) throw Error('STL triangle limit exceeded.');
      vertices.push(...match.slice(1).map(Number));
    }
    if (!vertices.length || vertices.length % 9) throw Error('STL triangle data is incomplete.');
  }
  if (vertices.some(value => !Number.isFinite(value) || Math.abs(value) > 1e7))
    throw Error('STL contains invalid or unbounded coordinates.');
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach((value, i) => {
    const axis = i % 3;
    min[axis] = Math.min(min[axis], value);
    max[axis] = Math.max(max[axis], value);
  });
  if (max.every((v, i) => v === min[i])) throw Error('STL has no spatial extent.');
  return { vertices, bounds: [...min, ...max], triangles: vertices.length / 9 };
}
function createCadPlugins({ projectRoot }) {
  return [
    {
      id: 'cad',
      autoPreview: true,
      matches: file =>
        /\.(fcstd|stl)$/i.test(file) ||
        (/\.(step|stp)$/i.test(file) &&
          fs.existsSync(file.replace(/\.[^.]+$/, '.cad-preview.json'))),
      open: async ({ artifact, file }) => {
        const root = fs.realpathSync(projectRoot());
        const source = readBounded(file, root, artifact.sha256, 16 * 1024 * 1024);
        let mesh = source,
          companions = [],
          brep,
          sketches;
        if (!/\.stl$/i.test(file)) {
          const manifestFile = file.replace(/\.[^.]+$/, '.cad-preview.json');
          if (!fs.existsSync(manifestFile))
            throw Error(
              'Create a CAD mesh preview with the FreeCAD inspect/export tool before opening this model.',
            );
          const manifest = readBounded(manifestFile, root, null, 256 * 1024);
          const data = JSON.parse(utf8(manifest.bytes));
          if (data.schemaVersion !== 1 || data.hashes?.[path.basename(file)] !== source.sha256)
            throw Error('CAD preview source changed; regenerate the preview.');
          const meshFile = file.replace(/\.[^.]+$/, '.stl');
          const expected = data.hashes[path.basename(meshFile)];
          if (!/^[a-f0-9]{64}$/.test(expected || ''))
            throw Error('CAD mesh companion hash is missing.');
          mesh = readBounded(meshFile, root, expected, 16 * 1024 * 1024);
          companions = [
            { name: path.basename(manifestFile), sha256: manifest.sha256 },
            { name: path.basename(meshFile), sha256: mesh.sha256 },
          ];
          const brepFile = file.replace(/\.[^.]+$/, '.brep');
          const brepHash = data.hashes[path.basename(brepFile)];
          if (brepHash !== undefined) {
            if (!/^[a-f0-9]{64}$/.test(brepHash))
              throw Error('CAD BREP companion hash is invalid.');
            const shape = readBounded(brepFile, root, brepHash, 16 * 1024 * 1024);
            const text = utf8(shape.bytes);
            if (!/^CASCADE Topology V[123],/m.test(text) || text.split('\n').length > 500000)
              throw Error('Unsupported or oversized CAD BREP companion.');
            brep = shape.bytes.toString('base64');
            companions.push({ name: path.basename(brepFile), sha256: shape.sha256 });
          }
          const sketchFile = file.replace(/\.[^.]+$/, '.cad-sketches.json');
          const sketchHash = data.hashes[path.basename(sketchFile)];
          if (sketchHash !== undefined) {
            if (!/^[a-f0-9]{64}$/.test(sketchHash))
              throw Error('CAD sketch companion hash is invalid.');
            const preview = readBounded(sketchFile, root, sketchHash, 1024 * 1024);
            const nativeHash = data.hashes[path.basename(file.replace(/\.[^.]+$/, '.FCStd'))];
            sketches = parseSketches(Buffer.from(utf8(preview.bytes)), nativeHash);
            companions.push({ name: path.basename(sketchFile), sha256: preview.sha256 });
          }
          readBounded(file, root, source.sha256, 16 * 1024 * 1024);
          readBounded(manifestFile, root, manifest.sha256, 256 * 1024);
        }
        return {
          kind: 'cad',
          artifact,
          data: {
            name: artifact.name,
            sha256: source.sha256,
            ...parseStl(mesh.bytes),
            companions,
            brep,
            sketches,
          },
        };
      },
    },
  ];
}
module.exports = { createCadPlugins, parseStl };
