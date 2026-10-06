const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RuntimeAssetManager, validateRuntimeAssets } = require('./runtime-assets.cjs');
const { PackManager, createArchive, digest } = require('./index.cjs');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-toolchain-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('pinned vendor disk image');
  const asset = {
    id: 'modeler',
    label: 'Modeler',
    version: '1.2.3',
    type: 'macos-app-dmg',
    platform: 'darwin-arm64',
    url: 'https://vendor.example/runtime.dmg',
    sha256: digest(bytes),
    size: bytes.length,
    app: 'Modeler.app',
    executable: 'Contents/bin/modeler',
    environment: 'INDUSTRIAL_HARNESS_MODELER_CMD',
    versionArgs: ['--version'],
    versionText: '1.2.3',
    profileEnvironment: {},
  };
  const events = [],
    commands = [];
  let downloads = 0,
    wrongVersion = false;
  const command = async (file, args) => {
    commands.push([file, args]);
    if (file.endsWith('/hdiutil') && args[0] === 'attach') {
      const mount = args[args.indexOf('-mountpoint') + 1];
      const executable = path.join(mount, asset.app, asset.executable);
      fs.mkdirSync(path.dirname(executable), { recursive: true });
      fs.writeFileSync(executable, 'vendor executable');
    } else if (file.endsWith('/hdiutil') && args[0] === 'detach')
      fs.rmSync(path.join(args[1], asset.app), { recursive: true });
    else if (file.endsWith('/ditto')) fs.cpSync(args[0], args[1], { recursive: true });
    else if (file.endsWith('/modeler')) return wrongVersion ? '1.0.0' : 'Modeler 1.2.3';
    return '';
  };
  const manager = new RuntimeAssetManager({
    directory,
    platform: 'darwin-arm64',
    command,
    fetchArchive: async (_asset, target) => {
      downloads++;
      fs.writeFileSync(target, bytes);
    },
  });
  return {
    directory,
    manager,
    asset,
    events,
    commands,
    options: { onProgress: state => events.push(state) },
    downloads: () => downloads,
    wrongVersion: () => {
      wrongVersion = true;
    },
  };
}
test('managed vendor app is verified, probed, detached and reused; deleted executable can be repaired from verified cache', async t => {
  const f = fixture(t);
  assert.equal(f.manager.status([f.asset])[0].ready, false);
  await f.manager.ensure([f.asset], f.options);
  const status = f.manager.status([f.asset])[0];
  assert.equal(status.ready, true);
  assert.ok(status.executable.startsWith(f.directory));
  assert.equal(f.manager.environment([f.asset]).INDUSTRIAL_HARNESS_MODELER_CMD, status.executable);
  assert.ok(f.commands.some(([file]) => file.endsWith('/codesign')));
  assert.ok(f.commands.some(([file, args]) => file.endsWith('/hdiutil') && args[0] === 'detach'));
  await f.manager.ensure([f.asset]);
  assert.equal(f.downloads(), 1);
  fs.rmSync(status.executable);
  assert.equal(f.manager.status([f.asset])[0].ready, false);
  await f.manager.ensure([f.asset]);
  assert.equal(f.manager.status([f.asset])[0].ready, true);
  assert.equal(f.downloads(), 1);
});
test('corrupt downloads never mount or execute and cannot report readiness', async t => {
  const f = fixture(t);
  f.manager.fetchArchive = async (_asset, file) => fs.writeFileSync(file, 'wrong bytes');
  await assert.rejects(f.manager.ensure([f.asset]), /verification failed/);
  assert.equal(f.commands.length, 0);
  assert.equal(f.manager.status([f.asset])[0].ready, false);
  assert.equal(fs.existsSync(path.join(f.manager.directory, 'prepare.lock')), false);
});
test('failed native probe cleans staging and mount and preserves a previous usable version', async t => {
  const f = fixture(t);
  await f.manager.ensure([f.asset]);
  f.wrongVersion();
  const newer = { ...f.asset, version: '1.2.4' };
  await assert.rejects(f.manager.ensure([newer]), /version check/);
  assert.equal(f.manager.status([f.asset])[0].ready, true);
  assert.equal(f.manager.status([newer])[0].ready, false);
  assert.ok(f.commands.some(([file, args]) => file.endsWith('/hdiutil') && args[0] === 'detach'));
  assert.ok(
    !fs
      .readdirSync(path.dirname(f.manager.location(newer)))
      .some(name => name.startsWith('.staging')),
  );
});
test('real download path rejects HTTPS downgrade, oversized body and abort without partial files', async t => {
  const f = fixture(t),
    original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const manager = new RuntimeAssetManager({ directory: f.directory, platform: 'darwin-arm64' });
  global.fetch = async () =>
    new Response(null, { status: 302, headers: { location: 'http://vendor.example/file' } });
  await assert.rejects(manager.ensure([f.asset]), /HTTPS/);
  global.fetch = async () => new Response(Buffer.alloc(f.asset.size + 1));
  await assert.rejects(manager.ensure([f.asset]), /size mismatch/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(manager.ensure([f.asset], { signal: controller.signal }), /abort/i);
  assert.ok(
    !fs.readdirSync(path.join(manager.directory, 'cache')).some(name => name.includes('.partial')),
  );
});
test('asynchronous preparation keeps a cross-process lock until completion', async t => {
  const f = fixture(t);
  let resume, entered;
  const started = new Promise(resolve => {
    entered = resolve;
  });
  f.manager.fetchArchive = async (_asset, file) => {
    entered();
    await new Promise(resolve => {
      resume = resolve;
    });
    fs.writeFileSync(file, Buffer.from('pinned vendor disk image'));
  };
  const active = f.manager.ensure([f.asset]);
  await started;
  await assert.rejects(f.manager.ensure([f.asset]), /already in progress/);
  resume();
  await active;
  assert.equal(f.manager.status([f.asset])[0].ready, true);
});
test('runtime metadata rejects shell paths, unsafe variables and unsupported installers', () => {
  for (const asset of [
    { id: '../../escape' },
    { type: 'shell-script' },
    { app: '../Bad.app' },
    { environment: 'HOME' },
  ])
    assert.throws(() => validateRuntimeAssets([asset]), /Invalid/);
});
test('Core bundled catalog is bounded and a failed toolchain update keeps active Pack unchanged', async t => {
  const f = fixture(t),
    resources = path.join(f.directory, 'core');
  fs.mkdirSync(resources);
  function bundle(version) {
    const source = path.join(f.directory, version);
    fs.mkdirSync(source);
    fs.writeFileSync(
      path.join(source, 'bundle.json'),
      JSON.stringify({
        schemaVersion: 1,
        domain: 'modeling',
        label: 'Modeling',
        emoji: 'M',
        version,
        coreApi: 1,
        skills: [],
        capabilities: [],
        providerPacks: [],
        runtimeAssets: [f.asset],
      }),
    );
    const bytes = createArchive(source),
      url = `modeling-${version}.hpack`;
    fs.writeFileSync(path.join(resources, url), bytes);
    return {
      domain: 'modeling',
      version,
      sha256: digest(bytes),
      size: bytes.length,
      url,
      platforms: [`${process.platform}-${process.arch}`],
    };
  }
  const entries = [bundle('1.0.0'), bundle('1.0.1')];
  fs.writeFileSync(
    path.join(resources, 'catalog.unsigned.json'),
    JSON.stringify({ schemaVersion: 1, packs: entries }),
  );
  const manager = new PackManager({ directory: path.join(f.directory, 'packs') });
  const catalog = manager.bundledCatalog(resources);
  manager.runtimeAssets = f.manager;
  await manager.install(catalog.packs[0], { prepareRuntime: true });
  manager.runtimeAssets.ensure = async () => {
    throw Error('vendor offline');
  };
  await assert.rejects(
    manager.install(catalog.packs[1], { prepareRuntime: true }),
    /vendor offline/,
  );
  assert.equal(manager.list()[0].version, '1.0.0');
  fs.writeFileSync(path.join(resources, entries[1].url), 'tampered');
  await assert.rejects(manager.install(catalog.packs[1]), /hash mismatch/);
  await assert.rejects(manager.install({ ...catalog.packs[0] }), /verified catalog/);
});
