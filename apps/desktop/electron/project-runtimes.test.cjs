const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProjectRuntimes } = require('./project-runtimes.cjs');

test('desktop chats share one actual persistent project runtime and reopen its facts after disposal', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-project-runtime-'));
  const projectDir = path.join(directory, 'project');
  const packDir = path.join(directory, 'pack');
  fs.mkdirSync(projectDir);
  fs.mkdirSync(packDir);
  fs.writeFileSync(path.join(projectDir, 'design.txt'), 'declared engineering inputs');
  fs.writeFileSync(
    path.join(packDir, 'index.cjs'),
    `
    const fs = require('node:fs');
    const path = require('node:path');
    const crypto = require('node:crypto');
    exports.createRuntimePlugin = () => ({
      stateProvider: ({projectDir}) => ({stage:'review', inputHashes:{
        'design.txt':crypto.createHash('sha256').update(fs.readFileSync(path.join(projectDir,'design.txt'))).digest('hex')
      }}), tools:[], verifiers:{}, capabilities:[]
    });
  `,
  );
  const registry = {
    runtimePacks: [
      {
        id: 'review-pack',
        domain: 'review',
        version: '1.0.0',
        directory: packDir,
        runtime: { entry: 'index.cjs' },
      },
    ],
  };
  const runtimes = new ProjectRuntimes({
    directory: path.join(directory, 'state'),
    environment: { INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'config') },
  });
  t.after(() => {
    runtimes.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const project = { id: 'project-id', path: projectDir, domain: 'review' };
  const first = runtimes.get(project, registry);
  assert.equal(runtimes.get({ ...project, id: 'another-chat-binding' }, registry), first);
  const state = await first.runtime.inspect();
  const checkpoint = first.runtime.latestCheckpoint();
  runtimes.close();
  const reopened = runtimes.get(project, registry);
  assert.notEqual(reopened, first);
  assert.equal((await reopened.runtime.inspect()).id, state.id);
  assert.equal(reopened.runtime.latestCheckpoint().id, checkpoint.id);
  fs.appendFileSync(path.join(projectDir, 'design.txt'), ' changed');
  assert.notEqual((await reopened.runtime.inspect()).id, state.id);
});
test('external MCP changes made by another client renew an idle project Runtime and preserve its facts', async t => {
  const { ExternalMcpRegistry } = require('@industrial-agent-harness/harness-core');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-mcp-runtime-')),
    projectDir = path.join(directory, 'project');
  fs.mkdirSync(projectDir);
  const config = path.join(directory, 'config'),
    registry = new ExternalMcpRegistry(config);
  const runtimes = new ProjectRuntimes({
    directory: path.join(directory, 'state'),
    environment: { INDUSTRIAL_HARNESS_CONFIG_DIR: config },
  });
  t.after(() => {
    runtimes.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const project = { path: projectDir, domain: 'example' },
    packs = { runtimePacks: [] };
  const first = runtimes.get(project, packs),
    state = await first.runtime.inspect();
  const server = path.resolve(
    __dirname,
    '../../../tests/integration/fixtures/external-mcp-server.cjs',
  );
  await registry.add(
    JSON.stringify({ mcpServers: { host: { command: process.execPath, args: [server] } } }),
  );
  const next = runtimes.get(project, packs);
  assert.notEqual(next, first);
  assert.equal((await next.runtime.inspect()).id, state.id);
  assert.ok(next.runtime.descriptors().some(tool => tool.effect === 'external'));
  registry.remove('external.host');
  const removed = runtimes.get(project, packs);
  assert.notEqual(removed, next);
  assert.ok(!removed.runtime.descriptors().some(tool => tool.effect === 'external'));
  assert.equal((await removed.runtime.inspect()).id, state.id);
});
