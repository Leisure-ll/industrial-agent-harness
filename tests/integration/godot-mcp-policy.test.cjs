const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createRequire} = require('node:module');
const mcpRequire = createRequire(path.resolve(__dirname, '../../packages/domain-mcp/package.json'));
const {Client} = mcpRequire('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = mcpRequire('@modelcontextprotocol/sdk/client/stdio.js');
const {resolveProjectTask, resourceCatalog, ResourceSettings} = require('../../packages/harness-core/src/index.cjs');
const {selectMcpServers, writeMcpConfig} = require('../../packages/domain-mcp/src/index.cjs');
const {materializeSkills} = require('../../packages/domain-skills/src/index.cjs');
const {prepareSessionFiles} = require('../../packages/agent-kimi/src/index.cjs');
const repo = path.resolve(__dirname, '../..');
const json = result => {assert.equal(result.isError, undefined, JSON.stringify(result)); return JSON.parse(result.content[0].text);};
const temporary = t => {const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-godot-mcp-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true})); return dir;};

function fakeGodot(dir) {
  const file = path.join(dir, 'godot');
  fs.writeFileSync(file, `#!${process.execPath}\nconst fs=require('fs');\nif (process.argv.includes('--version')) {console.log('4.4.1.stable.fixture'); process.exit(0);}\nif (process.argv.includes('--script')) console.log('HARNESS_SCENE_JSON:'+JSON.stringify({ok:true,scene:process.argv.at(-1),nodes:[{path:'.',type:'Node2D',properties:{}}]}));\nif (process.argv.includes('--import') && fs.existsSync(${JSON.stringify(path.join(dir, 'engine-error'))})) console.error('ERROR: Fixture parse problem');\n`, {mode: 0o700});
  return file;
}

async function connect(t, root, project, scope) {
  const configFile = writeMcpConfig(root, selectMcpServers(scope), {projectDir: project, environment: {...process.env, INDUSTRIAL_HARNESS_GODOT_BIN: fakeGodot(root)}});
  const config = JSON.parse(fs.readFileSync(configFile)).mcpServers['godot.local'];
  const client = new Client({name: 'godot-policy-test', version: '1.0.0'});
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({...config, stderr: 'pipe'}));
  return client;
}

test('Godot Broker discloses task-scoped MCP and Skill; settings can disable or override defaults', t => {
  const root = temporary(t), project = path.join(root, 'project'); fs.mkdirSync(project);
  const catalog = resourceCatalog('godot');
  assert.deepEqual(catalog.mcpServers.map(row => row.id), ['godot.local']);
  assert.deepEqual(catalog.skills.map(row => row.id), ['godot.game.inspect', 'godot.game.develop']);
  for (const prompt of ['Build a Godot CardPile game scene', 'Create a Godot player scene with AnimatedSprite2D', 'Repair the UI scene and animation']) {
    const {scope, trace} = resolveProjectTask('godot', {task: prompt});
    assert.deepEqual(scope.capabilityIds, ['godot.game.develop']);
    assert.equal(scope.tools.length, 5);
    assert.deepEqual(scope.skills, ['godot.game.develop']);
    assert.deepEqual(selectMcpServers(scope)[0].allowedToolIds, scope.tools);
    assert.ok(trace.some(row => row.event === 'detail.deferred'));
  }
  const inspect = resolveProjectTask('godot', {task: 'Inspect scene tree and scene properties'}).scope;
  assert.deepEqual(inspect.capabilityIds, ['godot.game.inspect']);
  assert.deepEqual(inspect.tools, ['godot.game.project_status', 'godot.game.inspect_scene_source']);
  const noMatch = resolveProjectTask('godot', {task: 'Hello world'}).scope;
  assert.deepEqual(noMatch.tools, []); assert.deepEqual(selectMcpServers(noMatch), []);
  assert.deepEqual(selectMcpServers(resolveProjectTask('pcb', {task: 'Godot scene'}).scope), []);
  const settings = new ResourceSettings(path.join(root, 'settings'));
  settings.set(catalog, {kind: 'mcp', id: 'godot.local', mode: 'disabled'});
  settings.set(catalog, {kind: 'skill', id: 'godot.game.develop', mode: 'disabled'});
  const blocked = resolveProjectTask('godot', {task: 'Build a Godot game scene'}, undefined, undefined, settings.snapshot(catalog, project).effective).scope;
  assert.deepEqual(blocked.tools, []); assert.deepEqual(blocked.skills, []);
  settings.set(catalog, {kind: 'mcp', id: 'godot.local', mode: 'enabled'}, project);
  settings.set(catalog, {kind: 'skill', id: 'godot.game.develop', mode: 'enabled'}, project);
  const enabled = resolveProjectTask('godot', {task: 'Build a Godot game scene'}, undefined, undefined, settings.snapshot(catalog, project).effective).scope;
  assert.equal(enabled.tools.length, 5); assert.deepEqual(enabled.skills, ['godot.game.develop']);
  const staged = path.join(root, 'staged'); fs.mkdirSync(staged);
  materializeSkills(enabled, staged);
  assert.ok(fs.existsSync(path.join(staged, 'skills/godot-game-develop/SKILL.md')));
  materializeSkills(inspect, staged);
  assert.ok(!fs.existsSync(path.join(staged, 'skills/godot-game-develop/SKILL.md')));
});

test('CLI scope-only output records progressive Godot disclosure without starting the native engine', t => {
  const root = temporary(t), entry = path.join(repo, 'apps/cli/src/main.cjs');
  const run = extra => execFileSync(process.execPath, [entry, 'run', '--project-dir', root, '--domain', 'godot', '--task', 'Create a Godot player scene with AnimatedSprite2D', '--scope-only', ...extra],
    {encoding: 'utf8', env: {...process.env, INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(root, 'settings')}}).trim().split('\n').map(JSON.parse);
  const rows = run([]);
  const scope = rows.find(row => row.type === 'scope').scope;
  assert.equal(scope.tools.length, 5);
  assert.deepEqual(scope.skills, ['godot.game.develop']);
  const events = rows.find(row => row.type === 'scope').trace.map(row => row.event);
  assert.ok(events.includes('detail.deferred'), JSON.stringify(rows));
  const disabled = run(['--disable-mcp', 'godot.local', '--disable-skill', 'godot.game.develop']);
  assert.deepEqual(disabled.find(row => row.type === 'scope').scope.tools, []);
  assert.deepEqual(disabled.find(row => row.type === 'scope').scope.skills, []);
});

test('Kimi session receives only the selected Godot Skill and MCP allowlist', t => {
  const root = temporary(t), project = path.join(root, 'project'), share = path.join(root, 'share');
  fs.mkdirSync(project); fs.mkdirSync(share);
  fs.writeFileSync(path.join(project, 'project.godot'), 'config_version=5\n');
  fs.writeFileSync(path.join(share, 'config.toml'), 'default_model = "fixture"\n');
  const environment = {...process.env, INDUSTRIAL_HARNESS_GODOT_BIN: fakeGodot(root)};
  const inspect = resolveProjectTask('godot', {task: 'Inspect scene tree'}).scope;
  const session = prepareSessionFiles(inspect, {shareDir: share, environment}, undefined, project);
  t.after(() => fs.rmSync(session, {recursive: true, force: true}));
  assert.ok(fs.existsSync(path.join(session, 'skills/godot-game-inspect/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(session, 'skills/godot-game-develop/SKILL.md')));
  const policy = JSON.parse(fs.readFileSync(path.join(session, 'mcp-godot.local.policy.json')));
  assert.deepEqual(policy.allowedToolIds, inspect.tools);
  assert.equal(policy.binaryVersion, '4.4.1.stable.fixture');
  assert.equal(JSON.parse(fs.readFileSync(path.join(session, 'mcp.json'))).mcpServers['godot.local'].command, process.execPath);
});

test('Godot MCP transport enforces scope and arguments, records native actions, and preserves failed checks', {timeout: 30000}, async t => {
  const root = temporary(t), project = path.join(root, 'project'); fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Fixture"\n');
  fs.writeFileSync(path.join(project, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\nposition = Vector2(1, 2)\n');
  const inspect = resolveProjectTask('godot', {task: 'Inspect scene tree and scene properties'}).scope;
  const client = await connect(t, root, project, inspect);
  assert.deepEqual((await client.listTools()).tools.map(row => row.name), ['domain_tool_list', 'domain_tool_describe', 'domain_tool_call', 'domain_tool_result_read']);
  const listed = json(await client.callTool({name: 'domain_tool_list', arguments: {}}));
  assert.deepEqual(listed.tools.map(row => row.toolId), inspect.tools);
  assert.equal((await client.callTool({name: 'domain_tool_describe', arguments: {toolId: 'godot.game.run_scene'}})).isError, true);
  assert.equal((await client.callTool({name: 'domain_tool_call', arguments: {toolId: 'godot.game.run_scene', arguments: {scenePath: 'main.tscn', frames: 1}}})).isError, true);
  const source = json(await client.callTool({name: 'domain_tool_call', arguments: {toolId: 'godot.game.inspect_scene_source', arguments: {scenePath: 'main.tscn'}}}));
  assert.equal(source.result.sections[1].properties.position, 'Vector2(1, 2)');
  assert.equal((await client.callTool({name: 'domain_tool_call', arguments: {toolId: 'godot.game.inspect_scene_source', arguments: {scenePath: '../outside.tscn'}}})).isError, true);
  const outside = path.join(root, 'outside.tscn'); fs.writeFileSync(outside, '[gd_scene format=3]\n');
  fs.symlinkSync(outside, path.join(project, 'escape.tscn'));
  assert.equal((await client.callTool({name: 'domain_tool_call', arguments: {toolId: 'godot.game.inspect_scene_source', arguments: {scenePath: 'escape.tscn'}}})).isError, true);
  const full = resolveProjectTask('godot', {task: 'Build a Godot game scene'}).scope;
  const fullClient = await connect(t, root, project, full);
  const observed = json(await fullClient.callTool({name: 'domain_tool_call', arguments: {toolId: 'godot.game.inspect_scene_runtime', arguments: {scenePath: 'main.tscn'}}}));
  assert.equal(observed.result.observation.nodes[0].type, 'Node2D');
  const imported = json(await fullClient.callTool({name: 'domain_tool_call', arguments: {toolId: 'godot.game.check_project', arguments: {}}}));
  assert.equal(imported.result.importStatus, 'PASS');
  fs.writeFileSync(path.join(root, 'engine-error'), '1');
  const failedImport = json(await fullClient.callTool({name: 'domain_tool_call', arguments: {toolId: 'godot.game.check_project', arguments: {}}}));
  assert.equal(failedImport.result.importStatus, 'FAIL');
  assert.match(failedImport.result.diagnostics[0], /Fixture parse problem/);
  fs.rmSync(path.join(root, 'engine-error'));
  const played = json(await fullClient.callTool({name: 'domain_tool_call', arguments: {toolId: 'godot.game.run_scene', arguments: {scenePath: 'main.tscn', frames: 2}}}));
  assert.equal(played.result.executionStatus, 'completed');
  assert.equal(played.result.engineeringAcceptance, 'not_run');
  assert.deepEqual(played.result.artifactSet, []);
  assert.equal(played.result.verificationResult.status, 'not_run');
  assert.equal(played.result.actionStatus, 'completed');
  assert.equal(played.result.artifactCoverage, 'not_enumerated');
  const receipts = fs.readdirSync(path.join(root, 'mcp-godot.local-receipts'));
  assert.equal(receipts.length, 4);
  assert.ok(receipts.every(file => (fs.statSync(path.join(root, 'mcp-godot.local-receipts', file)).mode & 0o777) === 0o600));
});

test('real Godot 4 can import and inspect a bounded game scene', {skip: !fs.existsSync('/tmp/godot-4.4.1/Godot.app/Contents/MacOS/Godot'), timeout: 90000}, async t => {
  const root = temporary(t), project = path.join(root, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'project.godot'), 'config_version=5\n[application]\nconfig/name="Game Fixture"\n');
  fs.writeFileSync(path.join(project, 'main.tscn'), '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Hud" type="Control" parent="."]\ngrow_vertical = 1\n');
  const scope = resolveProjectTask('godot', {task: 'Build a Godot game scene'}).scope;
  const configFile = writeMcpConfig(root, selectMcpServers(scope), {projectDir: project, environment: {...process.env, INDUSTRIAL_HARNESS_GODOT_BIN: '/tmp/godot-4.4.1/Godot.app/Contents/MacOS/Godot'}});
  const config = JSON.parse(fs.readFileSync(configFile)).mcpServers['godot.local'];
  const client = new Client({name: 'real-godot-test', version: '1.0.0'}); t.after(() => client.close());
  await client.connect(new StdioClientTransport({...config, stderr: 'pipe'}));
  const call = (toolId, args) => client.callTool({name: 'domain_tool_call', arguments: {toolId, arguments: args}}).then(json);
  const source = await call('godot.game.inspect_scene_source', {scenePath: 'main.tscn'});
  assert.ok(source.result.sections.some(section => section.header.includes('node')));
  const check = await call('godot.game.check_project', {});
  assert.equal(check.result.importStatus, 'PASS', check.result.stderr);
  const run = await call('godot.game.inspect_scene_runtime', {scenePath: 'main.tscn'});
  assert.equal(run.result.executionStatus, 'completed', run.result.stderr);
  assert.equal(run.result.observation.nodes[1].properties.grow_vertical, '1');
  const played = await call('godot.game.run_scene', {scenePath: 'main.tscn', frames: 2});
  assert.equal(played.result.executionStatus, 'completed', played.result.stderr);
});
