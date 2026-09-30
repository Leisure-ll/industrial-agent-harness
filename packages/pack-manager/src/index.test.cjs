const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {PackManager, createArchive, decodeArchive, digest, signCatalog, verifyCatalog} = require('./index.cjs');

function fixture(root, version = '1.0.0') {
  const source = path.join(root, `source-${version}`);
  fs.mkdirSync(path.join(source, 'skills', 'test'), {recursive: true});
  const bundle = {schemaVersion: 1, domain: 'test', label: 'Test', emoji: '🧪', version, coreApi: 1, capabilities: [{id: 'test.inspect', domain: 'test', stages: ['review'], keywords: ['inspect'], priority: 1, skills: [{id: 'test.inspect', summary: 'Inspect', reference: 'Read.'}], tools: [{id: 'test.read', summary: 'Read', schema: {}}], verification: []}], skills: [{id: 'test.inspect', domain: 'test', title: 'Inspect', file: 'skills/test/SKILL.md'}], providerPacks: []};
  fs.writeFileSync(path.join(source, 'bundle.json'), JSON.stringify(bundle));
  fs.writeFileSync(path.join(source, 'skills', 'test', 'SKILL.md'), '# Inspect\n');
  return createArchive(source);
}

test('signed catalog installs a Pack and keeps the previous version when an update is corrupt', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-manager-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const keys = {release: publicKey.export({type: 'spki', format: 'pem'})};
  const first = fixture(root);
  const second = fixture(root, '1.1.0');
  const item = (version, bytes) => ({domain: 'test', version, sha256: digest(bytes), size: bytes.length, url: `test-${version}.hpack`, platforms: [`${process.platform}-${process.arch}`]});
  const catalog = signCatalog({schemaVersion: 1, channel: 'stable', packs: [item('1.0.0', first)]}, 'release', privateKey);
  assert.equal(verifyCatalog(catalog, keys).packs[0].version, '1.0.0');
  assert.throws(() => verifyCatalog({...catalog, payload: {...catalog.payload, channel: 'beta'}}, keys), /signature/);
  const manager = new PackManager({directory: path.join(root, 'store'), keys});
  const oldFetch = global.fetch;
  global.fetch = async url => new Response(url.endsWith('catalog.json') ? JSON.stringify(catalog) : first);
  t.after(() => {global.fetch = oldFetch;});
  const selected = (await manager.catalog('https://updates.example/catalog.json')).packs[0];
  assert.equal(Object.isFrozen(selected), true);
  await assert.rejects(manager.install({...selected}, {bytes: first}), /verified catalog/);
  await manager.install(selected);
  assert.equal(manager.list()[0].version, '1.0.0');
  await assert.rejects(manager.install(item('1.1.0', second), {bytes: Buffer.from('corrupt'), allowUnsigned: true}), /hash mismatch/);
  assert.equal(manager.list()[0].version, '1.0.0');
  manager.remove('test');
  assert.deepEqual(manager.list(), []);
});

test('archive rejects traversal and checks required Skill files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-archive-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const compressed = fixture(root);
  assert.equal(decodeArchive(compressed).bundle.domain, 'test');
  const zlib = require('node:zlib');
  const archive = JSON.parse(zlib.gunzipSync(compressed));
  archive.files[0].path = '../escape';
  assert.throws(() => decodeArchive(zlib.gzipSync(JSON.stringify(archive))), /Unsafe Pack path/);
});

test('signed HTTPS feed can follow an HTTPS asset redirect but rejects HTTP downgrade', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-redirect-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const bytes = fixture(root);
  const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
  const manager = new PackManager({directory: path.join(root, 'store'), keys: {release: publicKey.export({type: 'spki', format: 'pem'})}});
  const item = {domain: 'test', version: '1.0.0', sha256: digest(bytes), size: bytes.length, url: 'test.hpack', platforms: [`${process.platform}-${process.arch}`]};
  const signed = signCatalog({schemaVersion: 1, channel: 'stable', packs: [item]}, 'release', privateKey);
  const oldFetch = global.fetch;
  let downgrade = false;
  global.fetch = async url => {
    if (url.endsWith('catalog.json')) return new Response(JSON.stringify(signed));
    if (url.startsWith('https://cdn.example/')) return new Response(bytes);
    if (url.endsWith('test.hpack')) return new Response(null, {status: 302, headers: {location: downgrade ? 'http://cdn.example/test.hpack' : 'https://cdn.example/test.hpack'}});
    throw Error(`Unexpected URL: ${url}`);
  };
  t.after(() => {global.fetch = oldFetch;});
  const selected = (await manager.catalog('https://updates.example/catalog.json')).packs[0];
  await manager.install(selected);
  downgrade = true;
  await assert.rejects(manager.install(selected), /require HTTPS/);
});

test('a running Domain blocks update and removal; a damaged Pack is diagnosed', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-lease-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const bytes = fixture(root);
  const manager = new PackManager({directory: path.join(root, 'store')});
  const entry = {domain: 'test', version: '1.0.0', sha256: digest(bytes), size: bytes.length, platforms: [`${process.platform}-${process.arch}`]};
  await manager.install(entry, {bytes, allowUnsigned: true});
  const release = manager.acquireUse('test');
  await assert.rejects(manager.install(entry, {bytes, allowUnsigned: true}), /in use/);
  assert.throws(() => manager.remove('test'), /in use/);
  release();
  await manager.install(entry, {bytes, allowUnsigned: true});
  fs.writeFileSync(path.join(root, 'store', 'test', '1.0.0', 'bundle.json'), '{}');
  assert.deepEqual(manager.list(), []);
  assert.equal(manager.scan().errors[0].domain, 'test');
  await manager.install(entry, {bytes, allowUnsigned: true});
  assert.equal(manager.list()[0].version, '1.0.0');
});
