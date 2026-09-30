const finite = n => Number.isFinite(n) && Math.abs(n) < 1e7;
const project = ([x, y, z]) => [x + z * 0.42, -y + z * 0.25];
function sketch(points, faces = []) {
  const drawings = [];
  if (faces.length) {
    for (const face of faces.slice(0, 20000)) {
      const polygon = face.map(index => points[index]).filter(Boolean).map(project);
      if (polygon.length >= 2) drawings.push({type: 'polyline', points: polygon, group: 'model'});
    }
  } else for (const point of points.slice(0, 10000)) {const [x, y] = project(point); drawings.push({type: 'circle', x, y, r: 0.25, group: 'model'});}
  return drawings;
}
function obj(text) {
  const points = [], faces = [];
  for (const line of text.split(/\r?\n/)) {
    if (points.length > 100000 || faces.length > 20000) break;
    if (line.startsWith('v ')) {
      const values = line.trim().split(/\s+/).slice(1, 4).map(Number);
      if (values.length === 3 && values.every(finite)) points.push(values);
    } else if (line.startsWith('f ')) {
      const indices = line.trim().split(/\s+/).slice(1, 30).map(token => Number(token.split('/')[0]) - 1);
      if (indices.every(Number.isInteger)) faces.push(indices);
    }
  }
  return {format: '3D OBJ mesh', summary: `${points.length} vertices · ${faces.length} faces`, sections: [{id: 'mesh', label: 'Mesh', kind: '3D source', line: 1, properties: {vertices: String(points.length), faces: String(faces.length)}}], drawings: sketch(points, faces), links: [], warnings: ['Orthographic outline preview; materials, lighting and hidden surfaces are not rendered.'], source: text, mode: 'geometry'};
}
function vrml(text) {
  const pointSource = /\bpoint\s*\[([^\]]{0,4000000})\]/s.exec(text)?.[1];
  const values = pointSource ? [...pointSource.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].slice(0, 300000).map(m => Number(m[0])) : [];
  const points = [];
  for (let i = 0; i + 2 < values.length && points.length < 100000; i += 3) if ([values[i], values[i + 1], values[i + 2]].every(finite)) points.push([values[i], values[i + 1], values[i + 2]]);
  const indexSource = /\bcoordIndex\s*\[([^\]]{0,4000000})\]/s.exec(text)?.[1];
  const faces = []; let face = [];
  for (const token of (indexSource || '').match(/-?\d+/g) || []) {
    const number = Number(token);
    if (number === -1) {if (face.length >= 2) faces.push(face); face = [];} else if (face.length < 30) face.push(number);
    if (faces.length >= 20000) break;
  }
  return {format: 'VRML 3D model', summary: `${points.length} points · ${faces.length} indexed faces`, sections: [{id: 'vrml', label: 'Geometry', kind: '3D source', line: 1, properties: {points: String(points.length), faces: String(faces.length)}}], drawings: sketch(points, faces), links: [], warnings: ['Orthographic outline preview; VRML transforms, materials and hidden surfaces are not reconstructed.'], source: text, mode: 'geometry'};
}
function step(text) {
  if (!/^ISO-10303-21;/i.test(text.trimStart())) throw Error('Unrecognized STEP header.');
  const points = [];
  for (const match of text.matchAll(/CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)\s*\)/g)) {
    const values = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (values.every(finite)) points.push(values);
    if (points.length >= 10000) break;
  }
  const entities = (text.match(/^#\d+\s*=/gm) || []).length;
  return {format: 'STEP CAD model', summary: `${entities} entities · ${points.length} extracted points`, sections: [{id: 'step', label: 'STEP summary', kind: '3D source', line: 1, properties: {entities: String(entities), points: String(points.length)}}], drawings: sketch(points), links: [], warnings: ['STEP B-rep surfaces are not tessellated. This is a point-location preview, not a 3D shape or clearance check.'], source: text, mode: 'geometry'};
}
function gltf(bytes, extension) {
  let value;
  if (extension === '.glb') {
    if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length || bytes.toString('ascii', 16, 20) !== 'JSON') throw Error('Invalid GLB 2.0 header.');
    const length = bytes.readUInt32LE(12);
    if (length > 4 * 1024 * 1024 || 20 + length > bytes.length) throw Error('GLB JSON chunk exceeds preview limits.');
    value = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  } else value = JSON.parse(bytes.toString('utf8'));
  if (value.asset?.version !== '2.0') throw Error('Only glTF 2.0 metadata is supported.');
  const sections = (value.nodes || []).slice(0, 500).map((node, index) => ({id: `node-${index}`, label: String(node.name || `Node ${index}`), kind: '3D node', line: 1, properties: {mesh: String(node.mesh ?? ''), children: JSON.stringify(node.children || []), translation: JSON.stringify(node.translation || []), scale: JSON.stringify(node.scale || [])}}));
  return {format: extension === '.glb' ? 'Godot GLB model' : 'Godot glTF model', summary: `${sections.length} nodes · ${(value.meshes || []).length} meshes`, sections, links: [], warnings: ['Geometry buffers and materials are not rendered; inspect the model in Godot for a full 3D view.'], source: extension === '.gltf' ? bytes.toString('utf8') : undefined, mode: 'structure'};
}
module.exports = {obj, vrml, step, gltf};
