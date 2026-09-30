const path = require('node:path');
const manufacturingExtensions = new Set(['.gbr', '.ger', '.gtl', '.gbl', '.gts', '.gbs', '.gto', '.gbo', '.gtp', '.gbp', '.gko', '.gm1', '.drl', '.xln', '.exc']);
const isManufacturing = file => manufacturingExtensions.has(path.extname(file).toLowerCase());
const coord = (raw, integerPlaces, decimals, suppression = 'L') => {
  if (raw.includes('.')) return Number(raw);
  const sign = raw.startsWith('-') ? -1 : 1;
  const digits = raw.replace(/^[-+]/, '');
  const width = integerPlaces + decimals;
  if (digits.length > width) throw Error('Gerber coordinate exceeds the declared format.');
  return sign * Number(suppression === 'T' ? digits.padEnd(width, '0') : digits) / 10 ** decimals;
};
const finite = n => Number.isFinite(n) && Math.abs(n) < 1e7;
function gerber(text, group) {
  if (!/(?:%FS|G04|%MO|D0[123]\*)/.test(text.slice(0, 10000))) throw Error('File does not contain recognizable Gerber commands.');
  const format = /%FS([LT])([AI])X(\d)(\d)Y(\d)(\d)\*%/.exec(text);
  if (format && (format[2] !== 'A' || format[3] !== format[5] || format[4] !== format[6])) throw Error('Unsupported Gerber coordinate format; open in a CAM tool.');
  const integerPlaces = format ? Number(format[3]) : 2, decimals = format ? Number(format[4]) : 4, suppression = format?.[1] || 'L';
  const inches = /%MOIN\*%/.test(text); const factor = inches ? 25.4 : 1;
  const apertures = new Map();
  for (const match of text.matchAll(/%ADD(\d+)([A-Z]),?([^*%]*)\*%/g)) {
    const sizes = match[3].split(/[Xx]/).map(Number).filter(value => finite(value) && value > 0);
    apertures.set(match[1], {shape: match[2], width: (sizes[0] || 0.15) * factor, height: (sizes[1] || sizes[0] || 0.15) * factor});
  }
  const drawings = [], warnings = []; let x = 0, y = 0, aperture = {shape: 'C', width: 0.15, height: 0.15}, operation = 'D02';
  if (!format) warnings.push('Coordinate format was not declared; assumed 2:4 decimals.');
  if (/G0[23]\*/.test(text)) warnings.push('Arc commands are represented by straight endpoints in this preview.');
  if (/G3[67]\*/.test(text)) warnings.push('Filled regions and polarity are not reconstructed; inspect the manufacturing source.');
  if (/%LPC\*%/.test(text)) warnings.push('Clear polarity is not composited; inspect the manufacturing source.');
  if ([...apertures.values()].some(item => !['C', 'R'].includes(item.shape))) warnings.push('Some aperture shapes are approximated as circular flashes.');
  if ([...apertures.values()].some(item => item.shape === 'R')) warnings.push('Rectangular aperture strokes are approximated by their width.');
  const commands = text.replace(/%[^%]*%/gs, '').split('*');
  for (const raw of commands) {
    if (drawings.length >= 30000) {warnings.push('Geometry preview reached 30,000 primitives.'); break;}
    const command = raw.replace(/\s+/g, '');
    if (!command || /^G0?4/.test(command)) continue;
    const onlyAperture = /^D(\d+)$/.exec(command);
    if (onlyAperture && Number(onlyAperture[1]) >= 10) {aperture = apertures.get(onlyAperture[1]) || aperture; continue;}
    const rawX = /X([-+]?\d+(?:\.\d+)?)/.exec(command)?.[1];
    const rawY = /Y([-+]?\d+(?:\.\d+)?)/.exec(command)?.[1];
    if (!rawX && !rawY) continue;
    const nextX = rawX ? coord(rawX, integerPlaces, decimals, suppression) * factor : x, nextY = rawY ? -coord(rawY, integerPlaces, decimals, suppression) * factor : y;
    if (!finite(nextX) || !finite(nextY)) throw Error('Gerber coordinate exceeds preview limits.');
    const mode = /D0?([123])$/.exec(command)?.[1]; if (mode) operation = `D0${mode}`;
    if (operation === 'D01') drawings.push({type: 'line', x1: x, y1: y, x2: nextX, y2: nextY, width: aperture.width, group});
    if (operation === 'D03') drawings.push(aperture.shape === 'R' ? {type: 'pad', x1: nextX - aperture.width / 2, y1: nextY - aperture.height / 2, x2: nextX + aperture.width / 2, y2: nextY + aperture.height / 2, group} : {type: 'circle', x: nextX, y: nextY, r: aperture.width / 2, group});
    x = nextX; y = nextY;
  }
  return {drawings, warnings, properties: {units: 'mm', apertures: String(apertures.size), primitives: String(drawings.length)}};
}
function excellon(text, group) {
  if (!/(?:M48|METRIC|INCH|T\d+C)/.test(text.slice(0, 10000))) throw Error('File does not contain recognizable Excellon drill commands.');
  const inches = /(?:^|\n)INCH\b/m.test(text) || /M72/.test(text), factor = inches ? 25.4 : 1;
  const sizes = new Map();
  for (const match of text.matchAll(/T(\d+)C([\d.]+)/g)) sizes.set(match[1], Number(match[2]) * factor);
  const drawings = [], warnings = []; let diameter = 0.8, x = 0, y = 0;
  for (const line of text.split(/\r?\n/)) {
    if (drawings.length >= 30000) {warnings.push('Drill preview reached 30,000 holes.'); break;}
    const command = line.trim();
    const tool = /^T(\d+)\s*$/.exec(command); if (tool) {diameter = sizes.get(tool[1]) || diameter; continue;}
    const match = /X([-+]?\d+(?:\.\d+)?)Y([-+]?\d+(?:\.\d+)?)/.exec(command);
    if (!match) continue;
    // Excellon integer coordinates do not carry a universal fixed-point format.
    x = coord(match[1], 3, 3) * factor;
    y = -coord(match[2], 3, 3) * factor;
    if (!finite(x) || !finite(y) || !finite(diameter)) throw Error('Drill coordinate exceeds preview limits.');
    drawings.push({type: 'circle', x, y, r: diameter / 2, group});
  }
  if (!/X[-+]?\d+\.\d+Y/.test(text)) warnings.push('Integer drill coordinates use an assumed 3-decimal format; compare against the CAM tool before manufacturing.');
  return {drawings, warnings, properties: {units: 'mm', tools: String(sizes.size), holes: String(drawings.length)}};
}
function manufacturing(files, initialWarnings = []) {
  const sections = [], drawings = [], warnings = [...initialWarnings], links = [];
  for (const [index, file] of files.entries()) {
    const group = `layer-${index}`, extension = path.extname(file.name).toLowerCase();
    let parsed;
    try {parsed = ['.drl', '.xln', '.exc'].includes(extension) ? excellon(file.text, group) : gerber(file.text, group);}
    catch (error) {if (index === 0) throw error; warnings.push(`${file.name}: ${error.message}`); continue;}
    sections.push({id: group, label: file.name, kind: ['.drl', '.xln', '.exc'].includes(extension) ? 'drill' : 'Gerber layer', line: 1, properties: parsed.properties});
    drawings.push(...parsed.drawings); warnings.push(...parsed.warnings.map(value => `${file.name}: ${value}`));
    links.push({path: file.name, status: file.sha256 ? `snapshot ${file.sha256.slice(0, 12)}` : 'snapshot'});
  }
  return {format: 'PCB manufacturing', summary: `${sections.length} layers · ${drawings.length} primitives`, sections, drawings, links, warnings, source: files[0]?.text, mode: 'geometry'};
}
module.exports = {manufacturing, isManufacturing, gerber, excellon};
