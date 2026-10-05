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
async function open(t, transport) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-mcp-runtime-')),
    project = path.join(directory, 'project');
  fs.mkdirSync(project);
  const marker = path.join(directory, 'clicked'),
    drift = path.join(directory, 'drift'),
    secret = 'fixture-private-credential';
  const remote =
    transport === 'stdio' ? null : await startRemoteFixture({ marker, secret, driftFile: drift });
  let runtime;
  t.after(async () => {
    runtime?.close();
    await remote?.close();
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  const config =
    transport === 'stdio'
      ? {
          command: process.execPath,
          args: [fixture],
          env: { FIXTURE_CLICK_MARKER: marker, FIXTURE_DRIFT_FILE: drift, FIXTURE_SECRET: secret },
        }
      : {
          url: remote.url + (transport === 'sse' ? '/sse' : '/mcp'),
          type: transport,
          headers: { Authorization: 'Bearer ' + secret },
        };
  const registry = new ExternalMcpRegistry(path.join(directory, 'config'));
  await registry.add(JSON.stringify({ mcpServers: { host: config } }));
  const servers = registry.records(),
    external = createExternalRuntimePlugin({ servers, registry, environment: process.env });
  const common = createWorkspacePlugin({ domain: 'example' });
  runtime = new IndustrialRuntime(project, 'example', {
    directory: path.join(directory, 'state'),
    ...common,
    tools: [...common.tools, ...external.tools],
    verifiers: { ...common.verifiers, ...external.verifiers },
  });
  const run = async (name, args, approval = true, allowed = true) => {
    const tool = servers[0].tools.find(tool => tool.name === name),
      state = await runtime.inspect();
    return runtime.execute(
      { toolId: tool.id, inputs: { arguments: args }, expectedStateId: state.id },
      {
        approval,
        scope: {
          domain: state.domain,
          projectId: state.projectId,
          stateId: state.id,
          tools: allowed ? [tool.id] : [],
        },
      },
    );
  };
  return { marker, drift, registry, runtime, run, secret };
}
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
