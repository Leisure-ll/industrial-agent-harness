const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { ExternalMcpRegistry } = require('./external-registry.cjs');
const { createExternalRuntimePlugin } = require('./external-runtime.cjs');
const {
  IndustrialRuntime,
  createWorkspacePlugin,
} = require('@industrial-agent-harness/domain-runtime');
const {
  startRemoteFixture,
} = require('../../../tests/integration/fixtures/external-mcp-server.cjs');
const fixture = path.resolve(
  __dirname,
  '../../../tests/integration/fixtures/external-mcp-server.cjs',
);
async function open(t, transport, sessionOptions) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-mcp-runtime-')),
    project = path.join(directory, 'project');
  fs.mkdirSync(project);
  const marker = path.join(directory, 'clicked'),
    drift = path.join(directory, 'drift'),
    secret = 'fixture-private-credential';
  const remote =
    transport === 'stdio' ? null : await startRemoteFixture({ marker, secret, driftFile: drift });
  let runtime;
  const environment = { ...process.env, FIXTURE_REFERENCE_SECRET: secret };
  t.after(async () => {
    await runtime?.close();
    await remote?.close();
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const config =
    transport === 'stdio'
      ? {
          command: process.execPath,
          args: [fixture],
          env: { FIXTURE_CLICK_MARKER: marker, FIXTURE_DRIFT_FILE: drift },
          envRefs: { FIXTURE_SECRET: 'FIXTURE_REFERENCE_SECRET' },
        }
      : {
          url: remote.url + (transport === 'sse' ? '/sse' : '/mcp'),
          type: transport,
          headers: { Authorization: 'Bearer ' + secret },
        };
  const registry = new ExternalMcpRegistry(path.join(directory, 'config'));
  await registry.add(JSON.stringify({ mcpServers: { host: config } }), environment);
  const servers = registry.records(),
    external = createExternalRuntimePlugin({
      servers,
      registry,
      environment,
      sessionOptions,
    });
  const common = createWorkspacePlugin({ domain: 'example' });
  runtime = new IndustrialRuntime(project, 'example', {
    directory: path.join(directory, 'state'),
    ...common,
    tools: [...common.tools, ...external.tools],
    verifiers: { ...common.verifiers, ...external.verifiers },
    dispose: external.dispose,
    releaseOwner: external.releaseOwner,
  });
  const run = async (name, args, approval = true, allowed = true, ownerId = 'project') => {
    const tool = servers[0].tools.find(tool => tool.name === name),
      state = await runtime.inspect();
    return runtime.execute(
      { toolId: tool.id, inputs: { arguments: args }, expectedStateId: state.id },
      {
        approval,
        ownerId,
        scope: {
          domain: state.domain,
          projectId: state.projectId,
          stateId: state.id,
          tools: allowed ? [tool.id] : [],
        },
      },
    );
  };
  return { marker, drift, registry, runtime, run, secret, environment, remote };
}

test(
  'stdio MCP retains process-local state for its chat, isolates other chats, and closes owned processes',
  { timeout: 30000 },
  async t => {
    const { runtime, run } = await open(t, 'stdio');
    const call = async owner => {
      const result = await run('click', { x: 1, y: 2 }, true, true, owner);
      assert.equal(result.action.status, 'completed', JSON.stringify(result));
      const report = JSON.parse(runtime.readArtifact(result.artifacts[0].id).content);
      return { ...JSON.parse(report.content[0].text), session: report._harnessMcpSession };
    };
    const first = await call('alice'),
      second = await call('alice'),
      other = await call('bob');
    assert.deepEqual([first.count, second.count, other.count], [1, 2, 1]);
    assert.equal(first.pid, second.pid);
    assert.notEqual(first.pid, other.pid);
    assert.equal(first.session.id, second.session.id);
    assert.deepEqual(
      [first.session.reused, second.session.reused, other.session.reused],
      [false, true, false],
    );
    await runtime.releaseOwner('alice');
    assert.throws(() => process.kill(first.pid, 0), { code: 'ESRCH' });
    assert.equal((await call('bob')).count, 2);
    await runtime.close();
    assert.throws(() => process.kill(other.pid, 0), { code: 'ESRCH' });
  },
);

test(
  'a terminated MCP process fails closed without replaying a mutation or silently recreating state',
  { timeout: 30000 },
  async t => {
    const { runtime, run, marker } = await open(t, 'stdio');
    await run('click', { x: 1, y: 2 }, true, true, 'chat');
    const evidence = fs.readFileSync(marker, 'utf8'),
      pid = JSON.parse(evidence).pid;
    process.kill(pid, 'SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
    const lost = await run('click', { x: 3, y: 4 }, true, true, 'chat');
    assert.equal(lost.action.status, 'failed');
    assert.match(lost.action.diagnostics.join(), /state was lost/);
    assert.equal(JSON.parse(runtime.readArtifact(lost.artifacts[0].id).content).uncertain, false);
    assert.equal(fs.readFileSync(marker, 'utf8'), evidence);
    assert.equal(
      (await run('click', { x: 3, y: 4 }, true, true, 'new-chat')).action.status,
      'completed',
    );
  },
);
test(
  'expired MCP state is visible and its bounded slot is released only when the owner closes',
  { timeout: 30000 },
  async t => {
    const { runtime, run, marker } = await open(t, 'stdio', { idleMs: 20, maximum: 1 });
    await run('click', { x: 1, y: 2 }, true, true, 'chat');
    const original = fs.readFileSync(marker, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 100));
    const expired = await run('click', { x: 3, y: 4 }, true, true, 'chat');
    assert.match(expired.action.diagnostics.join(), /state was lost/);
    assert.equal(fs.readFileSync(marker, 'utf8'), original);
    assert.match(
      (await run('click', { x: 3, y: 4 }, true, true, 'other')).action.diagnostics.join(),
      /session limit/,
    );
    await runtime.releaseOwner('chat');
    assert.equal(
      (await run('click', { x: 3, y: 4 }, true, true, 'other')).action.status,
      'completed',
    );
  },
);
test(
  'changed credential references close the old connection before another mutation',
  { timeout: 30000 },
  async t => {
    const { runtime, run, marker, environment } = await open(t, 'stdio');
    await run('click', { x: 1, y: 2 }, true, true, 'chat');
    const before = fs.readFileSync(marker, 'utf8'),
      pid = JSON.parse(before).pid;
    environment.FIXTURE_REFERENCE_SECRET = 'updated-controlled-credential';
    const changed = await run('click', { x: 3, y: 4 }, true, true, 'chat');
    assert.match(changed.action.diagnostics.join(), /environment changed/);
    assert.equal(fs.readFileSync(marker, 'utf8'), before);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(
      (await run('click', { x: 3, y: 4 }, true, true, 'new-chat')).action.status,
      'completed',
    );
  },
);
test(
  'SSE disconnection cannot replace service state through SDK automatic reconnection',
  { timeout: 30000 },
  async t => {
    const { runtime, run, marker, remote } = await open(t, 'sse');
    await run('click', { x: 1, y: 2 }, true, true, 'chat');
    const before = fs.readFileSync(marker, 'utf8');
    await remote.disconnectSse();
    // EventSource normally reconnects after three seconds, possibly with a new service session.
    await new Promise(resolve => setTimeout(resolve, 4000));
    const lost = await run('click', { x: 3, y: 4 }, true, true, 'chat');
    assert.equal(lost.action.status, 'failed');
    assert.match(lost.action.diagnostics.join(), /state was lost/);
    assert.equal(fs.readFileSync(marker, 'utf8'), before);
    assert.equal(
      (await run('click', { x: 3, y: 4 }, true, true, 'new-chat')).action.status,
      'completed',
    );
  },
);
for (const transport of ['stdio', 'http', 'sse'])
  test(
    `hosted ${transport} MCP calls are approved, content-bound, unverified and reject changed surfaces`,
    { timeout: 30000 },
    async t => {
      const { marker, drift, registry, runtime, run, secret } = await open(t, transport);
      const before = await runtime.inspect();
      const name = transport === 'http' ? 'screenshot' : 'click',
        args = transport === 'http' ? {} : { x: 1, y: 2 };
      for (const policy of [
        [false, true],
        [true, false],
      ]) {
        assert.equal((await run(name, args, ...policy)).action.status, 'failed');
        assert.equal(fs.existsSync(marker), false);
      }
      assert.equal((await run('click', { x: 'wrong', y: 2 })).action.status, 'failed');
      assert.equal(fs.existsSync(marker), false);
      const called = await run(name, args);
      assert.equal(called.action.status, 'completed', JSON.stringify(called));
      assert.equal(called.verification.status, 'not_run');
      assert.equal(called.state.id, before.id);
      if (transport !== 'http') {
        assert.ok(JSON.parse(fs.readFileSync(marker)).clicked);
        fs.unlinkSync(marker);
      } else
        assert.match(
          runtime.readArtifact(called.artifacts[0].id).content.toString(),
          /CONTROLLED_HOST_SCREENSHOT/,
        );
      const long = await run('long_text', {}),
        report = runtime.readArtifact(long.artifacts[0].id).content.toString('utf8');
      assert.ok(!report.includes(secret));
      assert.ok(report.includes('[REDACTED]'));
      fs.writeFileSync(drift, 'changed');
      const changed = await run(name, args);
      assert.equal(changed.action.status, 'failed');
      assert.equal(fs.existsSync(marker), false);
      assert.match(changed.action.diagnostics.join(), /surface changed/);
      registry.remove('external.host');
      assert.equal((await run(name, args)).action.status, 'failed');
    },
  );
