const capped = (value, limit = 250) =>
  String(value).length > limit ? `${String(value).slice(0, limit)}…` : String(value);
function parseSexpr(text) {
  const tokens = [];
  const lexer = /"(?:\\.|[^"\\])*"|\(|\)|[^\s()"]+/g;
  let offset = 0;
  for (const match of text.matchAll(lexer)) {
    if (text.slice(offset, match.index).trim()) throw Error('Unsupported KiCad syntax.');
    tokens.push(match[0]);
    offset = match.index + match[0].length;
    if (tokens.length > 250000) throw Error('KiCad library exceeds the token limit.');
  }
  if (text.slice(offset).trim()) throw Error('Unsupported KiCad syntax.');
  let index = 0,
    nodes = 0;
  function read(depth = 0) {
    if (depth > 100 || ++nodes > 250000) throw Error('KiCad structure exceeds preview limits.');
    const token = tokens[index++];
    if (token === '(') {
      const result = [];
      while (tokens[index] !== ')') {
        if (index >= tokens.length) throw Error('Unclosed KiCad expression.');
        result.push(read(depth + 1));
      }
      index++;
      return result;
    }
    if (token === ')' || token === undefined) throw Error('Invalid KiCad expression.');
    if (token.startsWith('"')) {
      try {
        return JSON.parse(token);
      } catch {
        throw Error('Invalid quoted KiCad string.');
      }
    }
    return token;
  }
  const root = read();
  if (index !== tokens.length || !Array.isArray(root)) throw Error('Unexpected KiCad content.');
  return root;
}
const children = (node, tag) =>
  Array.isArray(node) ? node.filter(item => Array.isArray(item) && item[0] === tag) : [];
const child = (node, tag) => children(node, tag)[0];
const num = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const pair = node => [num(node?.[1]), num(node?.[2])];
function shapes(node, group, output) {
  if (output.length >= 30000 || !Array.isArray(node)) return;
  const name = node[0];
  const line = (a, b, width = 0.15) =>
    output.push({ type: 'line', x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], width, group });
  const rectangle = (a, b) =>
    output.push({ type: 'rect', x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], group });
  const circle = (center, radius) =>
    output.push({ type: 'circle', x: center[0], y: -center[1], r: radius, group });
  if (['fp_line', 'gr_line'].includes(name))
    line(
      pair(child(node, 'start')),
      pair(child(node, 'end')),
      num(child(child(node, 'stroke'), 'width')?.[1]) || 0.15,
    );
  else if (['fp_rect', 'gr_rect', 'rectangle'].includes(name))
    rectangle(pair(child(node, 'start')), pair(child(node, 'end')));
  else if (['fp_circle', 'gr_circle', 'circle'].includes(name)) {
    const center = pair(child(node, 'center')),
      end = pair(child(node, 'end'));
    circle(
      center,
      child(node, 'radius')
        ? num(child(node, 'radius')[1])
        : Math.hypot(end[0] - center[0], end[1] - center[1]),
    );
  } else if (['fp_poly', 'gr_poly', 'polyline'].includes(name)) {
    const points = children(child(node, 'pts'), 'xy').map(pair);
    if (points.length >= 2 && points.length <= 10000)
      output.push({ type: 'polyline', points: points.map(([x, y]) => [x, -y]), group });
  } else if (name === 'pad') {
    const at = pair(child(node, 'at')),
      size = pair(child(node, 'size'));
    if (size[0] > 0 && size[1] > 0)
      output.push({
        type: 'pad',
        x1: at[0] - size[0] / 2,
        y1: -at[1] - size[1] / 2,
        x2: at[0] + size[0] / 2,
        y2: -at[1] + size[1] / 2,
        label: String(node[1] || ''),
        group,
      });
  } else if (name === 'pin') {
    const at = child(node, 'at'),
      length = num(child(node, 'length')?.[1]),
      [x, y] = pair(at),
      angle = (num(at?.[3]) * Math.PI) / 180;
    line([x, y], [x + Math.cos(angle) * length, y + Math.sin(angle) * length], 0.12);
    const number = child(node, 'number')?.[1],
      label = child(node, 'name')?.[1];
    if (number || label)
      output.push({
        type: 'label',
        x,
        y: -y,
        label: capped(`${number || ''} ${label || ''}`, 60),
        group,
      });
  }
  for (const nested of node) if (Array.isArray(nested)) shapes(nested, group, output);
}
function library(text, extension) {
  const root = parseSexpr(text),
    footprint = extension === '.kicad_mod';
  if (footprint ? root[0] !== 'footprint' : root[0] !== 'kicad_symbol_lib')
    throw Error('Unexpected KiCad library root.');
  const entries = footprint ? [root] : children(root, 'symbol').slice(0, 1000);
  const sections = [],
    drawings = [];
  for (const [index, item] of entries.entries()) {
    const label = String(item[1] || `Item ${index + 1}`),
      group = `item-${index}`;
    const properties = { name: label };
    for (const field of children(item, 'property').slice(0, 30))
      properties[String(field[1])] = capped(field[2]);
    if (footprint) {
      properties.pads = String(children(item, 'pad').length);
      properties.layer = String(child(item, 'layer')?.[1] || '');
    } else {
      let pins = 0;
      const visit = node => {
        pins += children(node, 'pin').length;
        for (const nested of children(node, 'symbol')) visit(nested);
      };
      visit(item);
      properties.pins = String(pins);
    }
    sections.push({
      id: group,
      label,
      kind: footprint ? 'footprint' : 'symbol',
      line: 1,
      properties,
    });
    shapes(item, group, drawings);
    if (drawings.length >= 30000) break;
  }
  const warnings = [];
  if (entries.length >= 1000 || drawings.length >= 30000)
    warnings.push('Library preview reached its item or geometry limit.');
  if (!drawings.length)
    warnings.push('No supported 2D geometry was found; inspect source or open in KiCad.');
  return {
    format: footprint ? 'KiCad footprint' : 'KiCad symbol library',
    summary: `${entries.length} ${footprint ? 'footprint' : 'symbols'} · ${drawings.length} shapes`,
    sections,
    drawings,
    links: [],
    warnings,
    source: text,
    mode: 'geometry',
  };
}
function rules(text) {
  const root = parseSexpr(`(${text.replace(/^\s*#.*$/gm, '')})`);
  if (!child(root, 'version')) throw Error('Unexpected KiCad design-rules format.');
  const sections = children(root, 'rule')
    .slice(0, 500)
    .map((rule, index) => ({
      id: `rule-${index}`,
      label: String(rule[1] || `Rule ${index + 1}`),
      kind: 'rule',
      line: 1,
      properties: Object.fromEntries(
        rule
          .filter(Array.isArray)
          .slice(0, 40)
          .map((entry, n) => [`${entry[0]} ${n + 1}`, capped(JSON.stringify(entry), 500)]),
      ),
    }));
  return {
    format: 'KiCad design rules',
    summary: `${sections.length} custom rules`,
    sections,
    links: [],
    warnings: [],
    source: text,
    mode: 'structure',
  };
}
function project(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error('Invalid KiCad project JSON.');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw Error('Unexpected KiCad project JSON.');
  const sections = Object.entries(value)
    .slice(0, 200)
    .map(([name, content], index) => ({
      id: `setting-${index}`,
      label: name,
      kind: 'project settings',
      line: 1,
      properties:
        content && typeof content === 'object'
          ? Object.fromEntries(
              Object.entries(content)
                .slice(0, 80)
                .map(([key, item]) => [key, capped(JSON.stringify(item), 500)]),
            )
          : { value: capped(JSON.stringify(content)) },
    }));
  return {
    format: 'KiCad project',
    summary: `${sections.length} setting groups`,
    sections,
    links: [],
    warnings: [],
    source: text,
    mode: 'structure',
  };
}
module.exports = { parseSexpr, library, rules, project };
