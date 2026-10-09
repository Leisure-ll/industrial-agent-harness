const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createArchive, digest, signCatalog, compareVersions } = require('./index.cjs');
const { createLocalhostCertificate } = require('./localhost-tls.cjs');

test('version ordering includes numeric components and prerelease precedence', () => {
  for (const [older, newer] of [
    ['1.9.0', '1.10.0'],
    ['1.0.0-beta.2', '1.0.0-beta.10'],
    ['1.0.0-beta', '1.0.0'],
    ['1.0.0-beta-a', '1.0.0-beta-b'],
    ['1.0.0-2', '1.0.0-a'],
  ]) {
    assert.equal(compareVersions(older, newer), -1);
    assert.equal(compareVersions(newer, older), 1);
  }
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test(
  'real signed HTTPS transfers reject downgrade, cancel and time out stalled bodies, then retry without losing the active Pack',
  { timeout: 30000 },
  async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pack-transfer-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const archives = {};
    for (const version of ['1.0.0', '1.1.0', '1.2.0']) {
      const source = path.join(root, version);
      fs.mkdirSync(source);
      fs.writeFileSync(
        path.join(source, 'bundle.json'),
        JSON.stringify({
          schemaVersion: 1,
          domain: 'test',
          version,
          coreApi: 1,
          label: 'Transfer fixture',
          emoji: '🧪',
          capabilities: [],
          skills: [],
          providerPacks: [],
        }),
      );
      fs.writeFileSync(path.join(source, 'payload.bin'), crypto.randomBytes(160000));
      archives[version] = createArchive(source);
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const tls = createLocalhostCertificate();
    fs.writeFileSync(path.join(root, 'localhost-cert.pem'), tls.cert);
    const sockets = new Set();
    const server = https.createServer(
      {
        key: tls.key,
        cert: tls.cert,
      },
      (req, res) => {
        const version = req.url.includes('1.0.0')
          ? '1.0.0'
          : req.url.includes('1.1.0')
            ? '1.1.0'
            : '1.2.0';
        if (req.url.startsWith('/catalog')) {
          const mode = req.url.split('/').at(-1);
          const item = {
            domain: 'test',
            version,
            size: archives[version].length,
            sha256: digest(archives[version]),
            platforms: [`${process.platform}-${process.arch}`],
            url: `/${mode}.hpack?version=${version}`,
          };
          res.end(
            JSON.stringify(
              signCatalog(
                { schemaVersion: 1, channel: 'stable', packs: [item] },
                'fixture',
                privateKey,
              ),
            ),
          );
        } else {
          res.writeHead(200, { 'Content-Length': archives[version].length });
          if (req.url.includes('stall') || req.url.includes('cancel'))
            res.write(archives[version].subarray(0, 70000));
          else res.end(archives[version]);
        }
      },
    );
    server.on('connection', s => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(async () => {
      for (const s of sockets) s.destroy();
      await new Promise(r => server.close(r));
    });
    const base = `https://127.0.0.1:${server.address().port}`;
    const options = { root, base, key: publicKey.export({ type: 'spki', format: 'pem' }) };
    // A separate production Node client trusts only the test-generated CA. No
    // disabled certificate verification or mocked fetch/installer is used.
    const script = `
    const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
    const {PackManager}=require(${JSON.stringify(path.join(__dirname, 'index.cjs'))});
    const o=JSON.parse(process.argv[1]),manager=new PackManager({directory:path.join(o.root,'store'),keys:{fixture:o.key}});
    const select=async(version,mode)=>(await manager.catalog(o.base+'/catalog/'+version+'/'+mode)).packs[0];
    (async()=>{
      await manager.install(await select('1.1.0','good'));
      await assert.rejects(manager.install(await select('1.0.0','good')),/downgrade/);
      const stalled=await select('1.2.0','stall'),progress=[];
      await assert.rejects(manager.install(stalled,{stallMs:1000,onProgress:p=>progress.push(p)}),/stalled/);
      assert.ok(progress.some(p=>p.received>0&&p.total===stalled.size));
      assert.ok(progress.some(p=>p.bytesPerSecond>0&&Number.isFinite(p.etaSeconds)&&p.etaSeconds>=0));
      const controller=new AbortController();
      await assert.rejects(manager.install(await select('1.2.0','cancel'),{signal:controller.signal,onProgress:p=>{if(p.received>0)controller.abort(Error('USER_CANCELLED'));}}),/USER_CANCELLED/);
      assert.equal(manager.list()[0].version,'1.1.0');
      assert.ok(!fs.existsSync(path.join(o.root,'store','test','1.2.0')));
      await manager.install(await select('1.2.0','good'));
      assert.equal(manager.list()[0].version,'1.2.0');
      assert.equal(fs.readdirSync(path.join(o.root,'store','test')).some(n=>n.startsWith('.')),false);
      console.log('signed HTTPS downgrade/stall/cancel/retry passed');
    })().catch(e=>{console.error(e);process.exitCode=1;});`;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['-e', script, JSON.stringify(options)],
      {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: path.join(root, 'localhost-cert.pem') },
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.match(stdout, /passed/);
  },
);
