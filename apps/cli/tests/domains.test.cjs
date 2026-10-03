const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createArchive, digest, signCatalog } = require('@industrial-agent-harness/pack-manager');
const { loadRegistry } = require('@industrial-agent-harness/domain-skills');
const { runDomains } = require('../src/domains.cjs');
const { run } = require('../src/main.cjs');

test('CLI installs a signed new Domain, loads its Broker scope, then removes it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-domain-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = {
    store: process.env.INDUSTRIAL_HARNESS_PACK_STORE,
    config: process.env.INDUSTRIAL_HARNESS_CONFIG_DIR,
    fetch: global.fetch,
  };
  t.after(() => {
    if (previous.store === undefined) delete process.env.INDUSTRIAL_HARNESS_PACK_STORE;
    else process.env.INDUSTRIAL_HARNESS_PACK_STORE = previous.store;
    if (previous.config === undefined) delete process.env.INDUSTRIAL_HARNESS_CONFIG_DIR;
    else process.env.INDUSTRIAL_HARNESS_CONFIG_DIR = previous.config;
    global.fetch = previous.fetch;
  });
  process.env.INDUSTRIAL_HARNESS_CONFIG_DIR = path.join(root, 'config');
  const source = path.join(root, 'source');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(source, 'skills', 'test-inspect'), { recursive: true });
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(source, 'skills', 'test-inspect', 'SKILL.md'), '# Inspect\n');
  fs.writeFileSync(
    path.join(source, 'bundle.json'),
    JSON.stringify({
      schemaVersion: 1,
      domain: 'test',
      label: 'Test',
      emoji: '🧪',
      version: '1.0.0',
      coreApi: 1,
      capabilities: [
        {
          id: 'test.inspect',
          domain: 'test',
          stages: ['review'],
          keywords: ['inspect'],
          priority: 10,
          skills: [{ id: 'test.inspect', summary: 'Inspect', reference: 'Read.' }],
          tools: [],
          verification: [],
        },
      ],
      skills: [
        {
          id: 'test.inspect',
          domain: 'test',
          title: 'Inspect',
          file: 'skills/test-inspect/SKILL.md',
        },
      ],
      providerPacks: [],
    }),
  );
  const bytes = createArchive(source);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const keys = path.join(root, 'keys.json');
  fs.writeFileSync(
    keys,
    JSON.stringify({ release: publicKey.export({ type: 'spki', format: 'pem' }) }),
  );
  const catalog = signCatalog(
    {
      schemaVersion: 1,
      channel: 'stable',
      packs: [
        {
          domain: 'test',
          version: '1.0.0',
          sha256: digest(bytes),
          size: bytes.length,
          url: 'test.hpack',
          platforms: [`${process.platform}-${process.arch}`],
        },
      ],
    },
    'release',
    privateKey,
  );
  global.fetch = async url =>
    new Response(url.endsWith('catalog.json') ? JSON.stringify(catalog) : bytes);
  const store = path.join(root, 'packs');
  const output = {
    text: '',
    write(chunk) {
      this.text += chunk;
    },
  };
  await runDomains(
    [
      'install',
      'test',
      '--catalog',
      'https://updates.example/catalog.json',
      '--keys-file',
      keys,
      '--store',
      store,
    ],
    output,
  );
  assert.match(output.text, /"installed":"test"/);
  output.text = '';
  await run(
    {
      command: 'run',
      projectDir: project,
      domain: 'test',
      task: 'inspect this project',
      scopeOnly: true,
    },
    output,
  );
  const scope = JSON.parse(output.text.split('\n')[0]);
  assert.deepEqual(scope.scope.capabilityIds, ['test.inspect']);
  await runDomains(['remove', 'test', '--store', store], output);
  output.text = '';
  await assert.rejects(
    run(
      { command: 'run', projectDir: project, domain: 'test', task: 'inspect', scopeOnly: true },
      output,
    ),
    /valid project domain/,
  );
});

test('real Chip and PCB Packs install first; Godot can be added later without losing either', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-real-packs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const previous = {
    store: process.env.INDUSTRIAL_HARNESS_PACK_STORE,
    config: process.env.INDUSTRIAL_HARNESS_CONFIG_DIR,
    fetch: global.fetch,
  };
  t.after(() => {
    if (previous.store === undefined) delete process.env.INDUSTRIAL_HARNESS_PACK_STORE;
    else process.env.INDUSTRIAL_HARNESS_PACK_STORE = previous.store;
    if (previous.config === undefined) delete process.env.INDUSTRIAL_HARNESS_CONFIG_DIR;
    else process.env.INDUSTRIAL_HARNESS_CONFIG_DIR = previous.config;
    global.fetch = previous.fetch;
  });
  process.env.INDUSTRIAL_HARNESS_CONFIG_DIR = path.join(root, 'config');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const keys = path.join(root, 'keys.json');
  const signingKey = path.join(root, 'signing.pem');
  fs.writeFileSync(
    keys,
    JSON.stringify({ release: publicKey.export({ type: 'spki', format: 'pem' }) }),
  );
  fs.writeFileSync(signingKey, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const outputDir = path.join(root, 'feed');
  const built = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../../../scripts/build-domain-packs.cjs'), outputDir],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        INDUSTRIAL_HARNESS_PACK_STORE: '',
        HARNESS_PACK_CHANNEL: 'stable',
        HARNESS_PACK_SIGNING_KEY_FILE: signingKey,
        HARNESS_PACK_SIGNING_KEY_ID: 'release',
        HARNESS_PACK_PLATFORMS: `${process.platform}-${process.arch}`,
      },
    },
  );
  assert.equal(built.status, 0, built.stderr);
  global.fetch = async url =>
    new Response(fs.readFileSync(path.join(outputDir, path.basename(new URL(url).pathname))));
  const store = path.join(root, 'packs');
  const options = [
    '--catalog',
    'https://updates.example/catalog.json',
    '--keys-file',
    keys,
    '--store',
    store,
  ];
  const sink = {
    text: '',
    write(chunk) {
      this.text += chunk;
    },
  };
  for (const domain of ['chip', 'pcb']) await runDomains(['install', domain, ...options], sink);
  assert.deepEqual(
    loadRegistry().domains.map(item => item.id),
    ['chip', 'pcb'],
  );
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  for (const [domain, task, expected] of [
    ['chip', 'Inspect netlist signals', 'chip.rtl.netlist.inspect'],
    ['pcb', 'Inspect PCB board', 'pcb.layout.inspect'],
  ]) {
    sink.text = '';
    await run({ command: 'run', projectDir: project, domain, task, scopeOnly: true }, sink);
    assert.ok(JSON.parse(sink.text.split('\n')[0]).scope.capabilityIds.includes(expected));
  }
  await runDomains(['install', 'godot', ...options], sink);
  assert.deepEqual(
    loadRegistry().domains.map(item => item.id),
    ['chip', 'godot', 'pcb'],
  );
  sink.text = '';
  await run(
    {
      command: 'run',
      projectDir: project,
      domain: 'godot',
      task: 'Preview animation',
      scopeOnly: true,
    },
    sink,
  );
  assert.equal(JSON.parse(sink.text.split('\n')[0]).scope.domain, 'godot');
  if (process.platform === 'darwin') {
    await runDomains(['install', 'cad', ...options], sink);
    assert.deepEqual(
      loadRegistry().domains.map(item => item.id),
      ['cad', 'chip', 'godot', 'pcb'],
    );
    sink.text = '';
    await run(
      {
        command: 'run',
        projectDir: project,
        domain: 'cad',
        task: 'Operate AutoCAD drawing',
        scopeOnly: true,
      },
      sink,
    );
    assert.ok(
      JSON.parse(sink.text.split('\n')[0]).scope.capabilityIds.includes('cad.autocad.operate'),
    );
  }
});

test('a platform-only Pack is omitted from other platform catalogs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-platform-packs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'feed');
  const built = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../../../scripts/build-domain-packs.cjs'), output],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        INDUSTRIAL_HARNESS_PACK_STORE: '',
        HARNESS_PACK_PLATFORMS: 'linux-x64',
      },
    },
  );
  assert.equal(built.status, 0, built.stderr);
  const catalog = JSON.parse(fs.readFileSync(path.join(output, 'catalog.unsigned.json'), 'utf8'));
  assert.deepEqual(catalog.packs.map(item => item.domain).sort(), ['chip', 'godot', 'pcb']);
  assert.ok(catalog.packs.every(item => item.platforms.length > 0));
});
