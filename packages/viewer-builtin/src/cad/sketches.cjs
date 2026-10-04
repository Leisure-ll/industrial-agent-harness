// Bounded display schema for native Sketcher readback. No expressions or scripts.
function parseSketches(bytes, sourceSha256) {
  const data = JSON.parse(bytes.toString('utf8'));
  const fail = () => {
    throw Error('Invalid or oversized CAD sketch companion.');
  };
  const number = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7;
  const vector = (v, n) => Array.isArray(v) && v.length === n && v.every(number);
  const text = v => typeof v === 'string' && v.length > 0 && v.length <= 200;
  if (
    data.schemaVersion !== 1 ||
    data.units !== 'mm' ||
    !/^[a-f0-9]{64}$/.test(sourceSha256 || '') ||
    data.sourceSha256 !== sourceSha256 ||
    !Array.isArray(data.sketches) ||
    data.sketches.length > 50
  )
    fail();
  let total = 0;
  const names = new Set();
  for (const sketch of data.sketches) {
    if (
      !sketch ||
      !text(sketch.name) ||
      names.has(sketch.name) ||
      !text(sketch.label) ||
      typeof sketch.fullyConstrained !== 'boolean' ||
      !vector(sketch.origin, 3) ||
      !vector(sketch.rotation, 4) ||
      Math.abs(Math.hypot(...sketch.rotation) - 1) > 1e-5 ||
      !Array.isArray(sketch.geometry) ||
      sketch.geometry.length > 2000 ||
      !Array.isArray(sketch.constraints) ||
      sketch.constraints.length > 4000
    )
      fail();
    names.add(sketch.name);
    total += sketch.geometry.length + sketch.constraints.length;
    if (total > 10000) fail();
    sketch.geometry.forEach((g, index) => {
      if (!g || g.index !== index || typeof g.construction !== 'boolean') fail();
      if (g.kind === 'line') {
        if (!vector(g.start, 2) || !vector(g.end, 2)) fail();
      } else if (g.kind === 'circle') {
        if (!vector(g.center, 2) || !number(g.radius) || g.radius <= 0) fail();
      } else if (g.kind !== 'unsupported' || !text(g.type)) fail();
    });
    sketch.constraints.forEach((c, index) => {
      if (
        !c ||
        c.index !== index ||
        !text(c.type) ||
        !number(c.value) ||
        (c.driving !== null && typeof c.driving !== 'boolean')
      )
        fail();
      for (const key of ['first', 'second', 'third'])
        if (!Number.isInteger(c[key]) || c[key] < -100000 || c[key] >= sketch.geometry.length)
          fail();
      for (const key of ['firstPos', 'secondPos', 'thirdPos'])
        if (!Number.isInteger(c[key]) || c[key] < 0 || c[key] > 3) fail();
    });
  }
  return data.sketches;
}
module.exports = { parseSketches };
