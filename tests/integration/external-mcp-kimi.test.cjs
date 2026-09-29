const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {ExternalMcpRegistry} = require('../../packages/domain-mcp/src/index.cjs');
const {startModel} = require('./fixtures/domain-mcp-model.cjs');
const execute = promisify(execFile), root = path.resolve(__dirname, '../..');
const entry = process.env.INDUSTRIAL_HARNESS_TEST_CLI || path.join(root, 'apps/cli/src/main.cjs');
const kimi = process.env.KIMI_EXECUTABLE || path.join(root, 'apps/desktop/.venv-kimi/bin/kimi');
const server = path.join(__dirname, 'fixtures/external-mcp-server.cjs');

test('CLI registration feeds real pinned Kimi: approval protects host mutation and MCP images reach the model', {timeout: 90000, skip: !fs.existsSync(kimi)}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-external-kimi-')); t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const configs = path.join(directory, 'settings'), marker = path.join(directory, 'host-click.json');
  const file = path.join(directory, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({mcpServers: {'computer-use': {command: process.execPath, args: [server], env: {FIXTURE_CLICK_MARKER: marker}}}}));
  const environment = {...process.env, INDUSTRIAL_HARNESS_CONFIG_DIR: configs, OPENAI_API_KEY: 'controlled-external-fixture'};
  const added = await execute(process.execPath, [entry, 'mcp', 'add', '--file', file], {cwd: os.tmpdir(), env: environment});
  assert.equal(JSON.parse(added.stdout).servers[0].id, 'external.computer-use');
  const tools = new ExternalMcpRegistry(configs).records()[0].tools;
  const screenshot = tools.find(tool => tool.name === 'screenshot').id, click = tools.find(tool => tool.name === 'click').id;
  const fixture = await startModel({success: 'EXTERNAL_MCP_CONFIRMED', calls: [
    {name: 'external_tool_list', arguments: {}},
    {name: 'external_tool_describe', arguments: {toolId: screenshot}},
    {name: 'external_tool_call', arguments: {toolId: screenshot, arguments: {}}},
    {name: 'external_tool_describe', arguments: {toolId: click}},
    {name: 'external_tool_call', arguments: {toolId: click, arguments: {x: 40, y: 60}}},
  ]}); t.after(fixture.close);
  const project = path.join(directory, 'project'); fs.mkdirSync(project);
  for (const approval of ['reject', 'approve']) {
    const before = fixture.requests.length;
    const args = [entry, 'run', '--project-dir', project, '--domain', 'chip', '--task', 'Use the host screenshot and click', '--provider', 'openai_legacy', '--endpoint', fixture.endpoint, '--model', 'controlled-external', '--image-input', '--no-thinking', '--approval', approval, '--kimi-executable', kimi, '--timeout-ms', '30000', '--chat-dir', path.join(directory, 'chats'), '--log-dir', path.join(directory, 'logs'), '--state-dir', path.join(directory, 'state')];
    const {stdout, stderr} = await execute(process.execPath, args, {cwd: os.tmpdir(), env: environment, timeout: 45000, maxBuffer: 4 * 1024 * 1024});
    const rows = stdout.trim().split('\n').map(JSON.parse);
    assert.equal(rows.at(-1).status, 'finished', stdout + stderr);
    assert.ok(rows.some(row => row.type === 'approval_decision' && row.decision === approval));
    const requests = fixture.requests.slice(before);
    assert.ok(requests[0].tools.some(tool => tool.function.name === 'external_tool_call'));
    assert.ok(!requests[0].tools.some(tool => ['click', 'screenshot'].includes(tool.function.name)));
    if (approval === 'reject') assert.ok(!fs.existsSync(marker));
    else {
      assert.deepEqual(JSON.parse(fs.readFileSync(marker)).arguments, {x: 40, y: 60});
      assert.ok(requests.some(request => JSON.stringify(request.messages).includes('data:image/png;base64,')), 'MCP image must reach model input, not become a text placeholder.');
      assert.ok(rows.some(row => row.event?.type === 'tool-result'));
    }
  }
  const disabled = await execute(process.execPath, [entry, 'mcp', 'disable', 'external.computer-use', '--project-dir', project], {env: environment});
  assert.ok(JSON.parse(disabled.stdout).settings.effective.mcpServers.includes('external.computer-use'));
  const scoped = await execute(process.execPath, [entry, 'run', '--project-dir', project, '--domain', 'chip', '--task', 'Use host screenshot', '--scope-only'], {env: environment});
  assert.ok(!JSON.parse(scoped.stdout.split('\n')[0]).scope.tools.some(id => id.startsWith('external.')));
});
