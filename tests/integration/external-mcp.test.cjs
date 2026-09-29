const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {createRequire} = require('node:module');
const mcpRequire = createRequire(path.resolve(__dirname, '../../packages/domain-mcp/package.json'));
const {Client} = mcpRequire('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = mcpRequire('@modelcontextprotocol/sdk/client/stdio.js');
const {ExternalMcpRegistry, selectMcpServers, writeMcpConfig, selectedRuntimeKey} = require('../../packages/domain-mcp/src/index.cjs');
const {resolveProjectTask, ResourceSettings, resourceCatalog} = require('../../packages/harness-core/src/index.cjs');
const {startRemoteFixture, image} = require('./fixtures/external-mcp-server.cjs');
const fixture = path.resolve(__dirname, 'fixtures/external-mcp-server.cjs');

function temporary(t) {const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-external-')); t.after(() => fs.rmSync(directory, {recursive: true, force: true})); return directory;}
function localConfig(directory) {return {mcpServers: {'computer-use': {command: process.execPath, args: [fixture], env: {FIXTURE_CLICK_MARKER: path.join(directory, 'host-click.json'), FIXTURE_DRIFT_FILE: path.join(directory, 'drift'), FIXTURE_SECRET: 'external-fixture-private-secret'}}}};}
async function gateway(t, directory, servers, ids) {
  const project = path.join(directory, 'project'); fs.mkdirSync(project, {recursive: true});
  const selected = selectMcpServers({domain: 'chip', tools: ids || servers.flatMap(server => server.tools.map(tool => tool.id))}, [], undefined, servers);
  const config = JSON.parse(fs.readFileSync(writeMcpConfig(directory, selected, {projectDir: project}))).mcpServers['harness.external'];
  const client = new Client({name: 'controlled-gateway-test', version: '1.0.0'});
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({...config, stderr: 'pipe'}));
  return {client, project};
}
const jsonResult = result => {assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content.find(part => part.type === 'text').text);};

test('external registration is private, explicit, transactional, and available in every domain with shared disable/override policy', {timeout: 30000}, async t => {
  const directory = temporary(t), registry = new ExternalMcpRegistry(path.join(directory, 'config'));
  const configuration = localConfig(directory);
  const summaries = await registry.add(JSON.stringify(configuration));
  assert.equal(summaries[0].id, 'external.computer-use'); assert.equal(summaries[0].toolCount, 3);
  assert.ok(!JSON.stringify(summaries).includes('private-secret'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(registry.file).mode & 0o777, 0o600);
  const before = fs.readFileSync(registry.file, 'utf8');
  await assert.rejects(registry.add(JSON.stringify(configuration)), /already exists/);
  await assert.rejects(registry.add(JSON.stringify({mcpServers: {good: configuration.mcpServers['computer-use'], broken: {command: '/nonexistent-harness-mcp-executable', args: []}}})), /unavailable/);
  assert.equal(fs.readFileSync(registry.file, 'utf8'), before, 'failed discovery never leaves partially registered services');
  const external = registry.records();
  for (const domain of ['chip', 'pcb', 'godot']) {
    const broker = resolveProjectTask(domain, {task: 'Use host screenshot and click'}, undefined, undefined, {}, external);
    assert.deepEqual(broker.scope.tools, external[0].tools.map(tool => tool.id));
    assert.ok(broker.trace.some(row => row.event === 'mcp.external.scope'));
    const disabled = resolveProjectTask(domain, {task: 'Use host screenshot'}, undefined, undefined, {mcpServers: ['external.computer-use']}, external);
    assert.deepEqual(disabled.scope.tools, []);
  }
  const project = path.join(directory, 'policy-project'); fs.mkdirSync(project);
  const settings = new ResourceSettings(path.dirname(registry.file)), catalog = resourceCatalog('chip', external);
  settings.set(catalog, {kind: 'mcp', id: summaries[0].id, mode: 'disabled'});
  assert.ok(settings.snapshot(catalog, project).effective.mcpServers.includes(summaries[0].id));
  assert.ok(!settings.set(catalog, {kind: 'mcp', id: summaries[0].id, mode: 'enabled'}, project).effective.mcpServers.includes(summaries[0].id));
  const revision = external[0].revision;
  await registry.refresh(summaries[0].id); assert.notEqual(registry.records()[0].revision, revision);
  registry.remove(summaries[0].id); assert.deepEqual(registry.list(), []);
});

test('real external stdio gateway enforces pinned scope/schema, preserves screenshots, binds roots, pages and redacts results', {timeout: 30000}, async t => {
  const directory = temporary(t), registry = new ExternalMcpRegistry(path.join(directory, 'config'));
  await registry.add(JSON.stringify(localConfig(directory)));
  const servers = registry.records(); const {client, project} = await gateway(t, directory, servers);
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['external_tool_call', 'external_tool_describe', 'external_tool_list', 'external_tool_result_read']);
  const tools = jsonResult(await client.callTool({name: 'external_tool_list', arguments: {}})).tools;
  const click = tools.find(tool => tool.name === 'click'), screenshot = tools.find(tool => tool.name === 'screenshot'), long = tools.find(tool => tool.name === 'long_text');
  assert.equal(click.risk, 'mutating');
  assert.equal((await client.callTool({name: 'external_tool_call', arguments: {toolId: click.toolId, arguments: {x: 1, y: 2, approval: true}}})).isError, true);
  assert.equal((await client.callTool({name: 'external_tool_describe', arguments: {toolId: 'external.undeclared'}})).isError, true);
  assert.ok(!fs.existsSync(path.join(directory, 'host-click.json')));
  const screenshotResult = await client.callTool({name: 'external_tool_call', arguments: {toolId: screenshot.toolId, arguments: {}}});
  assert.ok(!screenshotResult.isError); assert.deepEqual(screenshotResult.content.find(part => part.type === 'image'), image);
  const clicked = jsonResult(await client.callTool({name: 'external_tool_call', arguments: {toolId: click.toolId, arguments: {x: 1, y: 2}}}));
  assert.equal(clicked.verificationStatus, 'not_run');
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'host-click.json'))).roots[0].uri, pathToFileURL(fs.realpathSync(project)).href);
  const large = jsonResult(await client.callTool({name: 'external_tool_call', arguments: {toolId: long.toolId, arguments: {}}}));
  assert.equal(large.paged, true);
  let raw = '', offset = 0;
  do {const page = jsonResult(await client.callTool({name: 'external_tool_result_read', arguments: {responseId: large.responseId, offset}})); raw += page.text; offset = page.nextOffset;} while (offset !== null);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), large.sha256);
  assert.ok(!raw.includes('external-fixture-private-secret')); assert.ok(raw.includes('[REDACTED_MCP_CREDENTIAL]'));
  assert.equal(JSON.parse(raw).content[0].text.startsWith('界'.repeat(1000)), true);
  fs.writeFileSync(path.join(directory, 'drift'), 'changed');
  assert.match((await client.callTool({name: 'external_tool_call', arguments: {toolId: click.toolId, arguments: {x: 3, y: 4}}})).content[0].text, /schemas changed/);
  const fresh = await gateway(t, path.join(directory, 'fresh'), servers, [click.toolId]).catch(error => {throw error;});
  assert.equal((await fresh.client.callTool({name: 'external_tool_describe', arguments: {toolId: screenshot.toolId}})).isError, true);
  assert.match((await fresh.client.callTool({name: 'external_tool_call', arguments: {toolId: click.toolId, arguments: {x: 3, y: 4}}})).content[0].text, /schemas changed/);
});

test('remote HTTP and legacy SSE registration use explicit header credentials and the same scoped gateway', {timeout: 30000}, async t => {
  const directory = temporary(t), remote = await startRemoteFixture({secret: 'remote-fixture-secret'}); t.after(remote.close);
  for (const transport of ['http', 'sse']) {
    const current = path.join(directory, transport); fs.mkdirSync(current);
    const registry = new ExternalMcpRegistry(path.join(current, 'config'));
    const environment = {...process.env, REMOTE_AUTH: 'Bearer remote-fixture-secret'};
    await registry.add(JSON.stringify({mcpServers: {remote: {url: `${remote.url}/${transport === 'sse' ? 'sse' : 'mcp'}`, type: transport, headerEnv: {Authorization: 'REMOTE_AUTH'}}}}), environment);
    const servers = registry.records();
    const project = path.join(current, 'project'); fs.mkdirSync(project);
    const selected = selectMcpServers({domain: 'godot', tools: servers[0].tools.map(tool => tool.id)}, [], undefined, servers);
    const config = JSON.parse(fs.readFileSync(writeMcpConfig(current, selected, {projectDir: project, environment}))).mcpServers['harness.external'];
    const client = new Client({name: 'remote-test', version: '1.0.0'}); t.after(() => client.close());
    await client.connect(new StdioClientTransport({...config, stderr: 'pipe'}));
    const screenshot = servers[0].tools.find(tool => tool.name === 'screenshot');
    assert.deepEqual((await client.callTool({name: 'external_tool_call', arguments: {toolId: screenshot.id, arguments: {}}})).content.find(part => part.type === 'image'), image);
    assert.ok(!JSON.stringify(registry.list()).includes('remote-fixture-secret'));
    await client.close();
  }
});

test('configuration rejects malformed services and corruption; referenced credentials change session identity without disclosing secrets', {timeout: 30000}, async t => {
  const directory = temporary(t), registry = new ExternalMcpRegistry(path.join(directory, 'config'));
  for (const config of [{command: 'node', args: 'unsafe split'}, {url: 'file:///tmp/service'}, {url: 'https://user:secret@example.com/mcp'}, {url: 'https://example.com/mcp', headers: {Authorization: 'one\r\ntwo'}}, {command: 'node', arbitrary: true}]) {
    await assert.rejects(registry.add(JSON.stringify({mcpServers: {invalid: config}})));
    assert.deepEqual(registry.list(), []);
  }
  const config = localConfig(directory); config.mcpServers['computer-use'].envRefs = {FIXTURE_SECRET: 'HOST_MCP_TOKEN'};
  await registry.add(JSON.stringify(config), {HOST_MCP_TOKEN: 'first-private-token'});
  const external = registry.records(), scope = {domain: 'chip', tools: external[0].tools.map(tool => tool.id)};
  const first = selectedRuntimeKey(scope, [], {HOST_MCP_TOKEN: 'first-private-token'}, external);
  const second = selectedRuntimeKey(scope, [], {HOST_MCP_TOKEN: 'second-private-token'}, external);
  assert.notDeepEqual(first, second); assert.ok(!JSON.stringify(first).includes('first-private-token'));
  assert.ok(!fs.readFileSync(registry.file, 'utf8').includes('first-private-token'));
  const gatewayDirectory = path.join(directory, 'missing-env'); fs.mkdirSync(gatewayDirectory);
  assert.throws(() => writeMcpConfig(gatewayDirectory, selectMcpServers(scope, [], undefined, external), {projectDir: directory, environment: {}}), /Set HOST_MCP_TOKEN/);
  fs.writeFileSync(registry.file, '{invalid');
  assert.throws(() => registry.records(), /Cannot read/);
  await assert.rejects(registry.add(JSON.stringify(localConfig(directory))), /Cannot read/);
  assert.equal(fs.readFileSync(registry.file, 'utf8'), '{invalid');
});
