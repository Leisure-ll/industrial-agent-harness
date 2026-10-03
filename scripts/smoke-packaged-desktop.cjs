#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'desktop-release');
const folders = fs.readdirSync(output);
let executable;
if (process.platform === 'win32') {
  executable = path.join(output, 'win-unpacked', 'Industrial Agent Harness.exe');
} else if (process.platform === 'darwin') {
  const preferred = process.arch === 'arm64' ? ['mac-arm64', 'mac'] : ['mac', 'mac-x64'];
  const mac =
    preferred.find(name =>
      fs.existsSync(path.join(output, name, 'Industrial Agent Harness.app')),
    ) ||
    folders.find(
      name =>
        name.startsWith('mac') &&
        fs.existsSync(path.join(output, name, 'Industrial Agent Harness.app')),
    );
  if (mac)
    executable = path.join(
      output,
      mac,
      'Industrial Agent Harness.app',
      'Contents',
      'MacOS',
      'Industrial Agent Harness',
    );
} else throw Error('Packaged Desktop smoke supports macOS and Windows.');
if (!executable || !fs.existsSync(executable))
  throw Error('Packaged Desktop executable is missing.');
const screenshot = path.join(
  os.tmpdir(),
  `industrial-harness-first-run-${process.platform}-${process.arch}.png`,
);
const environment = { ...process.env, HARNESS_PACKAGED_SMOKE_SCREENSHOT: screenshot };
let fixture;
if (process.argv.includes('--domains')) {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-harness-feed-smoke-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const keys = { smoke: publicKey.export({ type: 'spki', format: 'pem' }) };
  const signingKey = path.join(fixture, 'signing.pem');
  fs.writeFileSync(signingKey, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const feed = path.join(fixture, 'feed');
  const built = spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'build-domain-packs.cjs'), feed],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        INDUSTRIAL_HARNESS_PACK_STORE: '',
        HARNESS_PACK_CHANNEL: 'stable',
        HARNESS_PACK_SIGNING_KEY_FILE: signingKey,
        HARNESS_PACK_SIGNING_KEY_ID: 'smoke',
        HARNESS_PACK_PLATFORMS: `${process.platform}-${process.arch}`,
      },
    },
  );
  if (built.status !== 0) throw Error(built.stderr || 'Could not build signed Domain smoke feed.');
  const config = path.join(fixture, 'pack-feed.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      schemaVersion: 1,
      channel: 'stable',
      catalogUrl: 'https://updates.example/catalog.json',
      publicKeys: keys,
    }),
  );
  environment.INDUSTRIAL_HARNESS_PACK_FEED_FILE = config;
  environment.HARNESS_PACKAGED_SMOKE_FEED_DIR = feed;
}
const result = spawnSync(executable, ['--packaged-smoke'], {
  encoding: 'utf8',
  timeout: 30000,
  env: environment,
});
if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
if (
  result.error ||
  result.status !== 0 ||
  !fs.statSync(screenshot, { throwIfNoEntry: false })?.isFile()
) {
  process.stderr.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  throw result.error || Error(`Packaged Desktop first-run smoke failed: ${result.status}`);
}
process.stdout.write(
  `${process.argv.includes('--domains') ? 'Chip + PCB first install and Godot/CAD add-on passed' : 'First-run Domain selection passed'}: ${screenshot}\n`,
);
