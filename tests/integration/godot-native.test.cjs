const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const mcpRequire = createRequire(path.resolve(__dirname, '../../packages/domain-mcp/package.json'));
const { Client } = mcpRequire('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = mcpRequire('@modelcontextprotocol/sdk/client/stdio.js');
const { resolveProjectTask } = require('../../packages/harness-core/src/index.cjs');
const { selectMcpServers, writeMcpConfig } = require('../../packages/domain-mcp/src/index.cjs');
const binary =
  process.env.INDUSTRIAL_HARNESS_GODOT_BIN || '/tmp/godot-4.4.1/Godot.app/Contents/MacOS/Godot';
const json = result => {
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
};
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-godot-native-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('real Godot 4 can import and inspect a bounded game scene', { timeout: 90000 }, async t => {
  assert.ok(
    fs.existsSync(binary),
    'Set INDUSTRIAL_HARNESS_GODOT_BIN to an installed Godot 4 executable.',
  );
  const root = temporary(t),
    project = path.join(root, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(project, 'project.godot'),
    'config_version=5\n[application]\nconfig/name="Game Fixture"\n',
  );
  fs.writeFileSync(
    path.join(project, 'main.tscn'),
    '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n[node name="Hud" type="Control" parent="."]\ngrow_vertical = 1\n',
  );
  const scope = resolveProjectTask('godot', { task: 'Build a Godot game scene' }).scope;
  const configFile = writeMcpConfig(root, selectMcpServers(scope), {
    projectDir: project,
    environment: {
      ...process.env,
      INDUSTRIAL_HARNESS_GODOT_BIN: binary,
    },
  });
  const config = JSON.parse(fs.readFileSync(configFile)).mcpServers['godot.local'];
  const client = new Client({ name: 'real-godot-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ ...config, stderr: 'pipe' }));
  const call = (toolId, args) =>
    client
      .callTool({ name: 'domain_tool_call', arguments: { toolId, arguments: args } })
      .then(json);
  const source = await call('godot.game.inspect_scene_source', { scenePath: 'main.tscn' });
  assert.ok(source.result.sections.some(section => section.header.includes('node')));
  const check = await call('godot.game.check_project', {});
  assert.equal(check.result.importStatus, 'PASS', check.result.stderr);
  const run = await call('godot.game.inspect_scene_runtime', { scenePath: 'main.tscn' });
  assert.equal(run.result.executionStatus, 'completed', run.result.stderr);
  assert.equal(run.result.observation.nodes[1].properties.grow_vertical, '1');
  const played = await call('godot.game.run_scene', { scenePath: 'main.tscn', frames: 2 });
  assert.equal(played.result.executionStatus, 'completed', played.result.stderr);
});
