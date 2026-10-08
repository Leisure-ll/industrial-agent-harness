const { test: nodeTest } = require('node:test');
const test = (name, body) => nodeTest(name, { timeout: 30000 }, body);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { RemoteSettings, selectedSnapshot } = require('../src/remote-settings.cjs');
const {
  createProjectRuntime,
  runtimeCapabilities,
  resolveProjectTask,
} = require('../src/index.cjs');
const { IndustrialRuntime } = require('../../domain-runtime/src/industrial.cjs');
const { hash } = require('../../domain-runtime/src/remote-client.cjs');
const { RemoteClient } = require('../../domain-runtime/src/remote-client.cjs');

const domain = 'test-domain',
  toolId = 'test.verify',
  descriptor = {
    schemaVersion: '1',
    id: toolId,
    version: '1',
    risk: 'mutating',
    verification: ['test.check'],
  };
const registry = {
  domains: [{ id: domain }],
  runtimePacks: [{ domain, directory: '/does-not-exist', runtime: { entry: 'must-not-load.cjs' } }],
  capabilities: [
    {
      id: 'test.remote',
      domain,
      title: 'Remote test',
      keywords: [],
      stages: [],
      alwaysAvailable: true,
      priority: 0,
      skills: [],
      tools: [
        { id: toolId, summary: 'test' },
        { id: 'test.local-only', summary: 'not remotely available' },
      ],
      verification: ['test.check'],
    },
  ],
};

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-remote-'));
  const runtimes = [];
  let remote, server;
  t.after(async () => {
    const errors = [];
    if (server)
      await new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
      });
    for (const runtime of runtimes) {
      try {
        if (runtime.executing) {
          runtime.cancel();
          await runtime.waitForIdle();
        }
        await runtime.close();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await remote?.close();
    } catch (error) {
      errors.push(error);
    }
    // Windows cannot remove SQLite files until every owned Runtime is closed.
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'Remote fixture cleanup failed.');
  });
  const projectDir = path.join(directory, 'local'),
    serverDir = path.join(directory, 'server');
  fs.mkdirSync(projectDir);
  fs.mkdirSync(serverDir);
  fs.writeFileSync(path.join(projectDir, 'input.txt'), 'declared protocol check\n');
  const projectId = crypto.randomUUID(),
    serverId = crypto.randomUUID(),
    capHash = hash('capability');
  let hashes = {},
    snapshotId = null,
    upload,
    job = null,
    grant,
    posts = 0,
    cancel = false,
    corrupt = false;
  remote = new IndustrialRuntime(serverDir, domain, {
    directory: path.join(directory, 'server-store'),
    stateProvider: () => ({ stage: snapshotId ? 'test-stage' : null, inputHashes: hashes }),
    tools: [
      {
        descriptor,
        execute: ({ action }) => {
          const file = path.join(serverDir, 'report-' + action.id + '.json');
          fs.writeFileSync(file, '{"protocolFixture":true}\n');
          return {
            executionSucceeded: true,
            artifacts: [{ kind: 'report.test', file }],
            diagnostics: [],
          };
        },
      },
    ],
    verifiers: {
      'test.check': ({ artifacts }) => ({
        status: artifacts.length === 1 ? 'passed' : 'failed',
        reason: 'Protocol fixture evidence (not a native EDA check).',
        metrics: {},
      }),
    },
  });
  server = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'Bearer private-fixture-token');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks),
        body = req.headers['content-type'] === 'application/json' ? JSON.parse(bytes) : null;
      if (req.method === 'POST') posts++;
      const send = value => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      const suffix = req.url.replace('/v1/projects/' + projectId + '/', '');
      if (req.url === '/v1/service-info')
        return send({
          serverId,
          contractVersion: '0.2',
          canonicalSchemaVersion: '1',
          ready: true,
          domains: [domain],
        });
      if (req.url === '/v1/projects')
        return send({ id: projectId, canonicalProjectId: remote.project.projectId, domain });
      if (suffix === 'state') return send({ snapshotId, state: await remote.inspect() });
      if (suffix === 'capabilities')
        return send({ domain, capabilitySnapshotHash: capHash, tools: [descriptor] });
      if (suffix === 'checkpoints') return send({ checkpoints: remote.listCheckpoints() });
      if (suffix === 'snapshot-uploads') {
        assert.equal(body.baseSnapshotId, snapshotId);
        upload = { id: crypto.randomUUID(), manifest: body.manifest };
        return send({ uploadId: upload.id, missing: upload.manifest.files });
      }
      if (suffix.includes('/blobs/')) return send({});
      if (suffix.endsWith('/commit')) {
        snapshotId = crypto.randomUUID();
        hashes = Object.fromEntries(upload.manifest.files.map(file => [file.path, file.sha256]));
        return send({ snapshot: { id: snapshotId }, state: await remote.inspect() });
      }
      if (suffix === 'invocation-grants') {
        grant = body;
        return send({ invocationGrantId: crypto.randomUUID() });
      }
      if (suffix === 'jobs') {
        assert.equal(body.schemaVersion, '0.1');
        assert.equal(body.action.schemaVersion, '1');
        assert.equal(body.snapshotId, snapshotId);
        assert.equal(body.requestId, grant.requestId);
        job = {
          jobId: crypto.randomUUID(),
          requestId: body.requestId,
          status: 'queued',
          queuePosition: 1,
          result: null,
          intent: body,
        };
        return send(job);
      }
      if (suffix.endsWith('/cancel')) {
        cancel = true;
        return send(job);
      }
      if (suffix.startsWith('jobs/')) {
        if (cancel) {
          job.status = 'cancelled';
          return send(job);
        }
        if (!job) {
          res.writeHead(404);
          res.end('{"code":"NOT_FOUND"}');
          return;
        }
        if (!job.result) {
          const state = await remote.inspect();
          job.result = await remote.execute(job.intent.action, {
            scope: { projectId: state.projectId, domain, stateId: state.id, tools: [toolId] },
            approval: true,
          });
          job.status = 'completed';
        }
        return send(job);
      }
      if (suffix.startsWith('artifacts/')) {
        const id = suffix.split('/')[1],
          artifact = remote.readArtifact(id);
        if (suffix.endsWith('/content')) {
          const content = corrupt ? Buffer.from('tampered') : artifact.content;
          res.writeHead(200, { 'content-length': content.length });
          res.end(content);
          return;
        }
        return send(artifact.artifact);
      }
      throw Error('Unexpected fixture route: ' + suffix);
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ code: 'FIXTURE_ERROR', message: String(error) }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const environment = {
    INDUSTRIAL_REMOTE_SERVICE_URL: 'http://127.0.0.1:' + server.address().port,
    INDUSTRIAL_REMOTE_CREDENTIAL_ENV: 'FIXTURE_TOKEN',
    FIXTURE_TOKEN: 'private-fixture-token',
  };
  const settings = new RemoteSettings({ directory: path.join(directory, 'config'), environment });
  return {
    settings,
    projectDir,
    serverId,
    directory,
    remote,
    runtimes,
    environment,
    posts: () => posts,
    corrupt: () => {
      corrupt = true;
    },
  };
}

test('blank deployment settings remain unconfigured and project choices are shared without uploading', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-empty-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let requests = 0;
  const settings = new RemoteSettings({
    directory: path.join(dir, 'config'),
    environment: {},
    fetch: () => {
      requests++;
    },
  });
  assert.deepEqual(await settings.check(), { status: 'not_configured', domains: [] });
  settings.setLocation(dir, domain, 'remote');
  assert.equal(
    new RemoteSettings({ directory: settings.directory, environment: {} }).project(dir, domain)
      .location,
    'remote',
  );
  assert.equal(requests, 0);
  assert.throws(
    () => createProjectRuntime({ projectDir: dir, domain, registry, remoteSettings: settings }),
    /confirm files/,
  );
});

test('sync consent binds exact bytes, destination, project and expiry; symlinks and credentials are excluded', async t => {
  const f = await fixture(t);
  assert.equal((await f.settings.check()).status, 'connected');
  assert.equal(JSON.stringify(f.settings.view()).includes('private-fixture-token'), false);
  fs.writeFileSync(path.join(f.projectDir, '.env'), 'SECRET=value');
  fs.symlinkSync(path.join(f.projectDir, 'input.txt'), path.join(f.projectDir, 'linked.txt'));
  assert.deepEqual(f.settings.candidates(f.projectDir), ['input.txt']);
  for (const file of ['.env', '../outside', 'linked.txt'])
    assert.throws(() => selectedSnapshot(f.projectDir, [file]));
  const review = await f.settings.review(f.projectDir, domain, ['input.txt']);
  assert.equal(f.posts(), 0);
  fs.appendFileSync(path.join(f.projectDir, 'input.txt'), 'changed\n');
  await assert.rejects(f.settings.sync(f.projectDir, domain, review.id), /changed/);
  assert.equal(f.posts(), 0);
  const approved = await f.settings.review(f.projectDir, domain, ['input.txt']);
  const binding = await f.settings.sync(f.projectDir, domain, approved.id);
  assert.ok(binding.snapshotId);
  assert.equal(binding.location, 'remote');
  await assert.rejects(f.settings.sync(f.projectDir, domain, approved.id), /expired/);
});

test('shared factory skips the local pack and executes approved actions with canonical remote evidence', async t => {
  const f = await fixture(t),
    review = await f.settings.review(f.projectDir, domain, ['input.txt']);
  await f.settings.sync(f.projectDir, domain, review.id);
  const bundle = createProjectRuntime({
    projectDir: f.projectDir,
    domain,
    registry,
    remoteSettings: f.settings,
    directory: path.join(f.directory, 'local-store'),
  });
  f.runtimes.push(bundle.runtime);
  const state = await bundle.runtime.inspect();
  const capabilities = runtimeCapabilities(registry, bundle);
  const broker = resolveProjectTask(
    domain,
    { task: 'verify', state },
    undefined,
    capabilities,
    {},
    [],
    registry.domains,
  );
  assert.ok(broker.scope.tools.includes(toolId));
  assert.equal(broker.scope.tools.includes('test.local-only'), false);
  assert.equal(
    bundle.runtime.descriptors().some(tool => tool.id === 'project.task.run'),
    false,
  );
  const before = f.posts();
  for (const invalid of [
    { ...broker.scope, projectId: 'f'.repeat(64) },
    { ...broker.scope, tools: [] },
  ]) {
    const refused = await bundle.runtime.execute(
      { toolId, inputs: {}, expectedStateId: state.id },
      { scope: invalid, approval: true },
    );
    assert.equal(refused.verification.status, 'insufficient_evidence');
  }
  assert.equal(f.posts(), before);
  const denied = await bundle.runtime.execute(
    { toolId, inputs: {}, expectedStateId: state.id },
    { scope: broker.scope, approval: false },
  );
  assert.equal(denied.action.status, 'failed');
  assert.equal(denied.verification.status, 'insufficient_evidence');
  assert.equal(f.posts(), before);
  const result = await bundle.runtime.execute(
    { toolId, inputs: {}, expectedStateId: state.id },
    { scope: broker.scope, approval: true },
  );
  assert.equal(result.verification.status, 'passed');
  assert.equal(result.action.id, f.remote.listActions()[0].id);
  assert.equal(result.checkpoint.id, f.remote.latestCheckpoint().id);
  assert.equal(
    bundle.runtime.readArtifact(result.artifacts[0].id).content.toString(),
    '{"protocolFixture":true}\n',
  );
  assert.equal(bundle.runtime.status().status, 'completed');
  const saved = fs.readFileSync(
    path.join(f.settings.directory, 'remote-requests', bundle.runtime.status().requestId + '.json'),
    'utf8',
  );
  assert.equal(saved.includes('private-fixture-token'), false);
  fs.appendFileSync(path.join(f.projectDir, 'input.txt'), 'updated in previously approved scope\n');
  const next = await bundle.runtime.inspect();
  assert.equal(next.status, 'stale');
  assert.notEqual(next.id, state.id);
  const stale = await bundle.runtime.execute(
    { toolId, inputs: {}, expectedStateId: state.id },
    { scope: broker.scope, approval: true },
  );
  assert.equal(stale.verification.status, 'insufficient_evidence');
});

test('remote cancellation targets the active job and waits for its terminal status without claiming acceptance', async t => {
  const f = await fixture(t),
    review = await f.settings.review(f.projectDir, domain, ['input.txt']);
  await f.settings.sync(f.projectDir, domain, review.id);
  const bundle = createProjectRuntime({
    projectDir: f.projectDir,
    domain,
    registry,
    remoteSettings: f.settings,
  });
  f.runtimes.push(bundle.runtime);
  const state = await bundle.runtime.inspect(),
    scope = { projectId: state.projectId, domain, stateId: state.id, tools: [toolId] };
  const pending = bundle.runtime.execute(
    { toolId, inputs: {}, expectedStateId: state.id },
    { scope, approval: true },
  );
  const deadline = Date.now() + 3000;
  while (!bundle.runtime.jobId && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(bundle.runtime.jobId);
  await assert.rejects(
    f.settings.cancelTask(f.projectDir, domain, {
      requestId: crypto.randomUUID(),
      jobId: bundle.runtime.jobId,
    }),
    /changed/,
  );
  bundle.runtime.cancel();
  const result = await pending;
  assert.equal(bundle.runtime.status().status, 'cancelled');
  assert.equal(result.verification.status, 'insufficient_evidence');
  assert.equal(f.remote.listActions().length, 0);
  f.settings.setLocation(f.projectDir, domain, 'local');
});

test('service identity changes fail closed and plaintext or credential-bearing endpoints are refused', async t => {
  const f = await fixture(t);
  assert.equal((await f.settings.check()).status, 'connected');
  const saved = f.settings.read();
  saved.service.serverId = crypto.randomUUID();
  f.settings.write(saved);
  assert.equal((await f.settings.check()).status, 'unavailable');
  assert.equal(f.settings.read().service.serverId, saved.service.serverId);
  for (const url of [
    'http://example.com',
    'https://secret@example.com',
    'https://example.com?token=secret',
  ])
    assert.throws(() => new RemoteClient({ url, credential: 'token' }), /clean HTTPS/);
});

test('artifact corruption cannot import acceptance and uncertain submissions are never replayed', async t => {
  const f = await fixture(t),
    review = await f.settings.review(f.projectDir, domain, ['input.txt']);
  await f.settings.sync(f.projectDir, domain, review.id);
  const bundle = createProjectRuntime({
    projectDir: f.projectDir,
    domain,
    registry,
    remoteSettings: f.settings,
  });
  f.runtimes.push(bundle.runtime);
  const state = await bundle.runtime.inspect(),
    scope = { projectId: state.projectId, domain, stateId: state.id, tools: [toolId] };
  f.corrupt();
  const result = await bundle.runtime.execute(
    { toolId, inputs: {}, expectedStateId: state.id },
    { scope, approval: true },
  );
  assert.equal(result.verification.status, 'insufficient_evidence');
  assert.equal(
    bundle.runtime.listVerifications().some(item => item.status === 'passed'),
    false,
  );
  const posts = f.posts();
  // Simulate a process stopping after submission identity was persisted.
  bundle.runtime.publish({
    requestId: crypto.randomUUID(),
    jobId: null,
    status: 'unknown',
    queuePosition: null,
    remoteProjectId: bundle.runtime.binding.remoteProjectId,
    serviceIdentity: f.settings.identity(),
  });
  await assert.rejects(bundle.runtime.inspect());
  assert.equal(f.posts(), posts);
  assert.throws(() => f.settings.setLocation(f.projectDir, domain, 'local'), /pending/);
});
