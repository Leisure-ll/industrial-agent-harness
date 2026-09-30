const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {resourceCatalog, ResourceSettings, resolveProjectTask} = require('../../packages/harness-core/src/index.cjs');
const {selectMcpServers, writeMcpConfig} = require('../../packages/domain-mcp/src/index.cjs');

test('Desktop/CLI resource catalog and global/project policy share the registered PCB tools and Skill', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-policy-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const project = path.join(root, 'one'), other = path.join(root, 'two');
  fs.mkdirSync(project); fs.mkdirSync(other);
  const catalog = resourceCatalog('pcb');
  assert.equal(catalog.mcpServers[0].id, 'pcb-bench.tools');
  assert.ok(catalog.skills.some(item => item.id === 'pcb.design.e2e'));
  const settings = new ResourceSettings(path.join(root, 'settings'));
  settings.set(catalog, {kind: 'mcp', id: 'pcb-bench.tools', mode: 'disabled'});
  settings.set(catalog, {kind: 'skill', id: 'pcb.design.e2e', mode: 'disabled'});
  const inherited = settings.snapshot(catalog, project).effective;
  const blocked = resolveProjectTask('pcb', {task: 'pcb mcp'}, undefined, undefined, inherited);
  assert.deepEqual(selectMcpServers(blocked.scope), []);
  assert.ok(!blocked.scope.skills.includes('pcb.design.e2e'));
  assert.deepEqual(JSON.parse(fs.readFileSync(writeMcpConfig(root, []))), {mcpServers: {}});
  settings.set(catalog, {kind: 'mcp', id: 'pcb-bench.tools', mode: 'enabled'}, project);
  settings.set(catalog, {kind: 'skill', id: 'pcb.design.e2e', mode: 'enabled'}, project);
  const enabled = settings.snapshot(catalog, project).effective;
  const allowed = resolveProjectTask('pcb', {task: 'pcb mcp'}, undefined, undefined, enabled);
  assert.equal(allowed.scope.tools.length, 89);
  assert.deepEqual(allowed.scope.skills, ['pcb.design.e2e']);
  assert.equal(selectMcpServers(allowed.scope)[0].allowedToolIds.length, 89);
  assert.deepEqual(settings.snapshot(catalog, other).effective, inherited);
  settings.set(catalog, {kind: 'mcp', id: 'pcb-bench.tools', mode: 'inherit'}, project);
  assert.deepEqual(selectMcpServers(resolveProjectTask('pcb', {task: 'pcb mcp'}, undefined, undefined, settings.snapshot(catalog, project).effective).scope), []);
});

test('real CLI scopes the PCB provider and accepts its resource disable IDs without native setup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-cli-policy-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const entry = path.resolve(__dirname, '../../apps/cli/src/main.cjs');
  const run = extra => execFileSync(process.execPath, [entry, 'run', '--project-dir', root, '--domain', 'pcb', '--task', 'pcb mcp', '--scope-only', ...extra], {env: {...process.env, INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(root, 'resources')}, encoding: 'utf8'}).trim().split('\n').map(JSON.parse);
  assert.equal(run([]).find(row => row.type === 'scope').scope.tools.length, 89);
  const disabled = run(['--disable-mcp', 'pcb-bench.tools', '--disable-skill', 'pcb.design.e2e']);
  assert.deepEqual(disabled.find(row => row.type === 'scope').scope.tools, []);
  assert.deepEqual(disabled.find(row => row.type === 'scope').scope.skills, []);
});

test('a PCB verification follow-up can submit the native final claims', () => {
  const {scope} = resolveProjectTask('pcb', {task: 'Inspect project_status and verify_design, then finalize the CAD-prototype claims.'});
  assert.ok(scope.capabilityIds.includes('pcb.bench.verification'));
  assert.ok(scope.tools.includes('pcb.bench.verify_design'));
  assert.ok(scope.tools.includes('pcb.bench.finalize_claims'));
  assert.ok(selectMcpServers(scope)[0].allowedToolIds.includes('pcb.bench.finalize_claims'));
});

test('KiCad design and repair requests receive the full PCB runtime', () => {
  for (const task of [
    'Design a KiCad project. Choose footprints, placement and routing. Deliver spec.json and board.kicad_pcb.',
    'Repair the supplied KiCad project. Deliver spec.json and board.kicad_pcb.',
  ]) {
    const {scope} = resolveProjectTask('pcb', {task});
    assert.deepEqual(scope.capabilityIds, ['pcb.bench.operate']);
    assert.equal(scope.tools.length, 89);
  }
});

test('a named multi-tool PCB follow-up retains the editing and verification runtime', () => {
  const {scope} = resolveProjectTask('pcb', {task: 'Inspect the board, use place_component for J1 and J2, rerun verify_design, then finalize_claims.'});
  assert.deepEqual(scope.capabilityIds, ['pcb.bench.operate']);
  assert.ok(scope.tools.includes('pcb.bench.place_component'));
  assert.ok(scope.tools.includes('pcb.bench.verify_design'));
  assert.ok(scope.tools.includes('pcb.bench.finalize_claims'));
});
