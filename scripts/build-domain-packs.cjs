#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {createArchive, digest, signCatalog} = require('../packages/pack-manager/src/index.cjs');
const capabilities = require('../packages/domain-skills/src/capabilities.cjs');
const {loadDomainPacks} = require('../packages/domain-skills/src/packs.cjs');
const {loadSkillOnlyPacks} = require('../packages/domain-skills/src/skill-only-packs.cjs');
const {listSkills, skillFile} = require('../packages/domain-skills/src/registry.cjs');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'dist', 'domain-packs'));
const channel = process.env.HARNESS_PACK_CHANNEL || 'beta';
if (!['stable', 'beta'].includes(channel)) throw Error('Invalid Pack channel.');
if (fs.existsSync(output)) throw Error(`Output already exists: ${output}`);
fs.mkdirSync(output, {recursive: true});
const labels = {chip: ['Chip', '💠'], pcb: ['PCB', '🔌'], godot: ['Godot', '🎮'], cad: ['CAD', '📐']};
const features = {
  chip: {summary: 'EDA skills, viewers and the Chip MCP service', prerequisites: ['Python 3.13 for the Chip MCP service', 'EDA tools and PDK for industrial execution']},
  pcb: {summary: 'PCB skills and KiCad document viewer', prerequisites: ['Native KiCad is required for future editing and DRC actions']},
  godot: {summary: 'Godot Web Export viewer', prerequisites: ['A Godot Web Export is required for project preview']},
  cad: {summary: 'AutoCAD for macOS operating Skill', prerequisites: ['AutoCAD for macOS and the computer-use plugin are required']},
};
const providerPacks = loadDomainPacks();
const skillOnlyPacks = loadSkillOnlyPacks();
const entries = [];
for (const [domain, [label, emoji]] of Object.entries(labels)) {
  const directory = path.join(output, domain);
  fs.mkdirSync(directory, {recursive: true});
  const providers = providerPacks.filter(pack => pack.domain === domain);
  const version = providers[0]?.version || '0.1.0';
  const skills = listSkills(domain).map(item => ({id: item.id, domain: item.domain, title: item.title, file: `skills/${item.id}/SKILL.md`}));
  for (const skill of skills) {
    const target = path.join(directory, ...skill.file.split('/'));
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(skillFile(skill.id), target);
  }
  for (const pack of providers) {
    const source = path.join(root, 'domain-packs', pack.provider.packDirectory);
    const destination = path.join(directory, 'domain-packs', pack.provider.packDirectory);
    fs.cpSync(source, destination, {recursive: true, filter: file => !['.venv', '.venv-kimi', 'node_modules', '__pycache__', '.DS_Store', '.git', 'dist', '.pytest_cache', '.ruff_cache'].includes(path.basename(file)) && !file.endsWith('.pyc')});
  }
  const bundle = {schemaVersion: 1, domain, label, emoji, version, coreApi: 1, ...features[domain], capabilities: [...capabilities.filter(item => item.domain === domain), ...skillOnlyPacks.filter(pack => pack.domain === domain).flatMap(pack => pack.capabilities), ...providers.flatMap(pack => pack.capabilities)], skills, providerPacks: providers};
  fs.writeFileSync(path.join(directory, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
  const archive = createArchive(directory);
  const file = `${domain}-${version}.hpack`;
  fs.writeFileSync(path.join(output, file), archive);
  entries.push({domain, label, emoji, version, summary: bundle.summary, prerequisites: bundle.prerequisites, sha256: digest(archive), size: archive.length, url: file, platforms: (process.env.HARNESS_PACK_PLATFORMS || `${process.platform}-${process.arch}`).split(',').filter(platform => domain !== 'cad' || platform.startsWith('darwin-'))});
}
const payload = {schemaVersion: 1, channel, generatedAt: new Date().toISOString(), packs: entries};
const keyFile = process.env.HARNESS_PACK_SIGNING_KEY_FILE;
if (keyFile) {
  const keyId = process.env.HARNESS_PACK_SIGNING_KEY_ID;
  if (!keyId) throw Error('Set HARNESS_PACK_SIGNING_KEY_ID.');
  fs.writeFileSync(path.join(output, 'catalog.json'), JSON.stringify(signCatalog(payload, keyId, fs.readFileSync(keyFile)), null, 2) + '\n');
} else fs.writeFileSync(path.join(output, 'catalog.unsigned.json'), JSON.stringify(payload, null, 2) + '\n');
process.stdout.write(`${output}\n`);
