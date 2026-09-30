#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || path.join(root, 'dist', 'desktop-stage'));
if (!target.startsWith(path.join(root, 'dist') + path.sep) || target === root || fs.existsSync(target)) throw Error('Use a new directory under dist for desktop staging.');
const built = path.join(root, 'apps', 'desktop', 'dist', 'index.html');
if (!fs.existsSync(built)) throw Error('Build the desktop renderer first.');
const deployed = process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', `pnpm --filter @industrial-agent-harness/desktop deploy --legacy --prod "${target}"`], {cwd: root, stdio: 'inherit'})
  : spawnSync('pnpm', ['--filter', '@industrial-agent-harness/desktop', 'deploy', '--legacy', '--prod', target], {cwd: root, stdio: 'inherit'});
if (deployed.error) throw deployed.error;
if (deployed.status !== 0) process.exit(deployed.status || 1);
for (const name of ['.venv-kimi', '.venv-klayout', 'src', 'scripts', 'viewer-host']) fs.rmSync(path.join(target, name), {recursive: true, force: true});
const requireFromApp = createRequire(path.join(target, 'electron', 'main.cjs'));
const skillsRoot = path.dirname(path.dirname(requireFromApp.resolve('@industrial-agent-harness/domain-skills')));
for (const name of ['skills', 'packs']) {
  const directory = path.join(skillsRoot, name);
  fs.rmSync(directory, {recursive: true, force: true});
  fs.mkdirSync(directory);
}
for (const packageName of ['@industrial-agent-harness/viewer-builtin/runtime/layout', '@industrial-agent-harness/viewer-builtin/runtime/godot', '@industrial-agent-harness/agent-kimi', '@industrial-agent-harness/pack-manager', 'electron-updater']) requireFromApp.resolve(packageName);
const feedUrl = process.env.HARNESS_PACK_CATALOG_URL;
const keysFile = process.env.HARNESS_PACK_PUBLIC_KEYS_FILE;
const coreUrl = process.env.HARNESS_CORE_UPDATE_URL;
if (process.env.HARNESS_RELEASE_BUILD === '1' && (!feedUrl || !keysFile || !coreUrl)) throw Error('Release build requires Pack catalog, public keys and Core update URL.');
const keys = keysFile ? JSON.parse(fs.readFileSync(keysFile, 'utf8')) : {};
const channel = process.env.HARNESS_RELEASE_CHANNEL || 'beta';
if (!['stable', 'beta'].includes(channel)) throw Error('Invalid release channel.');
if (process.env.HARNESS_RELEASE_BUILD === '1') {
  for (const [name, value] of [['Pack catalog', feedUrl], ['Core update', coreUrl]]) if (new URL(value).protocol !== 'https:') throw Error(`${name} URL must use HTTPS.`);
  if (!Object.keys(keys).length || Object.values(keys).some(value => typeof value !== 'string' || !value.includes('BEGIN PUBLIC KEY'))) throw Error('Release build requires Pack verification public keys.');
}
fs.writeFileSync(path.join(target, 'pack-feed.json'), JSON.stringify({schemaVersion: 1, channel, catalogUrl: feedUrl || null, publicKeys: keys}, null, 2) + '\n');
process.stdout.write(`${target}\n`);
