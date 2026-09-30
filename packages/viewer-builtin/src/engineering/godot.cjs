const fs = require('node:fs');
const path = require('node:path');

const capped = (value, limit = 300) => value.length > limit ? `${value.slice(0, limit)}…` : value;
function attributes(header) {
  const result = {};
  for (const match of header.matchAll(/([a-zA-Z_][\w]*)=("(?:\\.|[^"\\])*"|[^\s]+)/g)) {
    try {result[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];}
    catch {result[match[1]] = capped(match[2]);}
  }
  return result;
}
function sectionsOf(text) {
  const lines = text.split(/\r?\n/), sections = []; let current = null, truncated = false;
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line];
    if (value.startsWith('[') && value.endsWith(']')) {
      if (sections.length >= 1000) {truncated = true; break;}
      const header = value.slice(1, -1), kind = header.split(/\s/)[0], attrs = attributes(header);
      current = {id: `section-${line + 1}`, label: attrs.name || attrs.type || attrs.path || kind, kind, line: line + 1, properties: {...attrs}};
      sections.push(current);
    } else if (current && /^([\w/.:+-]+)\s*=\s*/.test(value)) {
      if (Object.keys(current.properties).length >= 100) {truncated = true; continue;}
      const index = value.indexOf('=');
      current.properties[value.slice(0, index).trim()] = capped(value.slice(index + 1).trim());
    }
  }
  return {sections, truncated};
}
function resourceLinks(text, project) {
  const links = [];
  for (const match of text.matchAll(/path="(res:\/\/[^"\n]+)"/g)) {
    if (links.length >= 200) break;
    const resource = match[1], relative = resource.slice(6);
    let status = 'missing';
    if (relative && !relative.split('/').some(part => part === '..' || part === '.') && !relative.includes('\\') && !relative.includes('\0')) {
      try {
        const canonical = fs.realpathSync(path.join(project, relative));
        if (canonical.startsWith(project + path.sep) && fs.statSync(canonical).isFile()) status = 'present';
        else status = 'outside project';
      } catch {status = 'missing';}
    } else status = 'unsafe path';
    if (!links.some(item => item.path === resource)) links.push({path: resource, status});
  }
  return links;
}
function godotScene(text, project, file) {
  const parsed = sectionsOf(text);
  const scenes = parsed.sections.filter(item => item.kind === 'node');
  const resources = parsed.sections.filter(item => ['ext_resource', 'sub_resource', 'resource', 'gd_resource'].includes(item.kind));
  const links = resourceLinks(text, project);
  const warnings = [];
  if (parsed.truncated) warnings.push('Structure preview reached its section/property limit; source remains available.');
  if (links.some(link => link.status !== 'present')) warnings.push('Some referenced project resources are missing or outside this project.');
  return {format: path.extname(file) === '.tscn' ? 'Godot scene' : 'Godot resource', summary: `${scenes.length} nodes · ${resources.length} resource sections · ${links.length} external references`, sections: parsed.sections, links, warnings, source: text, mode: 'structure'};
}
function godotScript(text) {
  const lines = text.split(/\r?\n/), sections = [], links = [];
  for (const [index, line] of lines.entries()) {
    const match = /^\s*(?:@onready\s+)?(class_name|extends|signal|func|static func|@export(?:_\w+)?\s+var|var|const)\s+([^\s(:=]+)/.exec(line);
    if (match && sections.length < 500) sections.push({id: `script-${index + 1}`, label: `${match[1]} ${match[2]}`, kind: match[1], line: index + 1, properties: {declaration: capped(line.trim(), 500)}});
    for (const ref of line.matchAll(/(?:\$|get_node\()\s*"?([\w./%-]+)"?/g)) {
      if (links.length < 200) links.push({path: ref[1], status: 'scene-relative; inspect target scene'});
    }
  }
  return {format: 'GDScript', summary: `${sections.filter(item => item.kind.includes('func')).length} functions · ${sections.filter(item => item.kind === 'signal').length} signals`, sections, links, warnings: [], source: text, mode: 'source'};
}
function godotProject(text) {
  const sections = [], lines = text.split(/\r?\n/); let current = null;
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      current = {id: `config-${index + 1}`, label: trimmed.slice(1, -1), kind: 'setting group', line: index + 1, properties: {}};
      if (sections.length < 200) sections.push(current);
    } else if (current && /^[\w/.-]+\s*=/.test(trimmed) && Object.keys(current.properties).length < 200) {
      const split = trimmed.indexOf('='); current.properties[trimmed.slice(0, split).trim()] = capped(trimmed.slice(split + 1).trim(), 500);
    }
  }
  return {format: 'Godot project', summary: `${sections.length} setting groups · ${sections.reduce((n, item) => n + Object.keys(item.properties).length, 0)} values`, sections, links: [], warnings: [], source: text, mode: 'structure'};
}
function godotBinary(bytes) {
  const magic = bytes.subarray(0, 4).toString('ascii');
  return {format: 'Godot binary resource', summary: `${bytes.length} bytes · ${magic === 'RSRC' ? 'RSRC header' : 'unrecognized binary header'}`, sections: [{id: 'binary', label: 'Resource file', kind: 'metadata', line: 1, properties: {signature: magic, bytes: String(bytes.length), headerHex: bytes.subarray(0, 64).toString('hex')}}], links: [], warnings: ['Binary .res contents are not decoded by this read-only Viewer. Open in Godot for full resource properties.'], mode: 'metadata'};
}
function audio(bytes, extension) {
  const mime = {'.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg'}[extension];
  if (!mime) throw Error('Unsupported audio format.');
  if (extension === '.wav' && (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')) throw Error('Invalid WAV header.');
  if (extension === '.ogg' && bytes.toString('ascii', 0, 4) !== 'OggS') throw Error('Invalid Ogg header.');
  if (extension === '.mp3' && !(bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) throw Error('Invalid MP3 header.');
  const properties = {format: extension.slice(1).toUpperCase(), bytes: String(bytes.length)};
  if (extension === '.wav' && bytes.length >= 36) {properties.channels = String(bytes.readUInt16LE(22)); properties.sampleRate = String(bytes.readUInt32LE(24)); properties.bitsPerSample = String(bytes.readUInt16LE(34));}
  return {format: 'Godot audio', summary: `${extension.slice(1).toUpperCase()} · ${bytes.length} bytes`, sections: [{id: 'audio', label: 'Audio metadata', kind: 'media', line: 1, properties}], links: [], warnings: [], mediaUrl: `data:${mime};base64,${bytes.toString('base64')}`, mode: 'media'};
}
module.exports = {godotScene, godotScript, godotProject, godotBinary, audio, sectionsOf, resourceLinks};
