const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {KimiSession} = require('../src/index.cjs');
const {toolSnapshot, hash} = require('../../domain-mcp/src/external-client.cjs');

test('a live adapter renews its session when external credentials or registry revision change with the same tool IDs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-external-session-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'config.toml'), 'default_model="industrial"\n');
  const tools = toolSnapshot('external.host', [{name: 'observe', inputSchema: {type: 'object', properties: {}}}]);
  const server = {id: 'external.host', tools, surfaceHash: hash(tools), revision: 'first', config: {transport: 'stdio', command: process.execPath, args: [], cwd: root, env: {}, envRefs: {TOKEN: 'HOST_TOKEN'}}};
  const runtime = {shareDir: root, apiKey: 'model-key', profile: {thinking: false}, revision: 0, externalServers: [server], environment: {HOST_TOKEN: 'first-private-token'}};
  let created = 0, closed = 0;
  const factory = () => {created++; return {close: async () => {closed++;}, prompt: () => ({result: Promise.resolve({status: 'finished'}), async *[Symbol.asyncIterator]() {yield {type: 'ContentPart', payload: {type: 'text', text: 'done'}};}})};};
  const scope = {domain: 'test', stage: 'test', capabilityIds: [], skills: [], tools: tools.map(tool => tool.id)};
  const session = new KimiSession(root, () => scope, () => null, () => null, () => {}, () => runtime, factory, {directory: path.join(root, 'logs')}); t.after(() => session.close());
  await session.run('first'); await session.run('unchanged'); assert.equal(created, 1);
  runtime.environment.HOST_TOKEN = 'second-private-token'; await session.run('new credential'); assert.equal(created, 2); assert.equal(closed, 1);
  server.revision = 'refreshed'; await session.run('new snapshot'); assert.equal(created, 3); assert.equal(closed, 2);
});
