const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { createProjectRuntime, resolveProjectTask } = require('../src/index.cjs');
test('shared factory boots an empty project without a Pack and keeps workspace tools at every factual stage', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'core-workspace-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const domain of ['example', 'other']) {
    const project = path.join(directory, domain);
    fs.mkdirSync(project);
    const bundle = createProjectRuntime({
      projectDir: project,
      domain,
      registry: { runtimePacks: [] },
      directory: path.join(directory, 'state'),
      environment: { INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'config') },
    });
    try {
      const state = await bundle.runtime.inspect();
      assert.equal(state.stage, null);
      const scoped = resolveProjectTask(
        domain,
        { task: 'unrelated words', state },
        undefined,
        bundle.capabilities,
        {},
        [],
        [{ id: domain }],
      );
      assert.equal(scoped.scope.stage, null);
      assert.ok(scoped.scope.skills.includes('project.work'));
      assert.equal(scoped.scope.tools.length, 5);
      const staged = resolveProjectTask(
        domain,
        { task: 'unrelated words', state: { ...state, stage: 'real-stage' } },
        undefined,
        bundle.capabilities,
        {},
        [],
        [{ id: domain }],
      );
      assert.deepEqual(staged.scope.tools, scoped.scope.tools);
    } finally {
      bundle.runtime.close();
    }
  }
});
test('creating actual configuration refreshes professional scope; invalid configuration remains repairable with visible inspection evidence', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'core-workspace-pack-')),
    project = path.join(directory, 'project'),
    pack = path.join(directory, 'pack');
  fs.mkdirSync(project);
  fs.mkdirSync(pack);
  fs.writeFileSync(
    path.join(pack, 'index.cjs'),
    `const fs=require('node:fs'),path=require('node:path');
    exports.createRuntimePlugin=()=>({
      matchesProject:project=>fs.existsSync(path.join(project,'design.json')),
      workspaceProtectedPaths:project=>[path.join(project,'generated')],
      stateProvider:({projectDir})=>{const data=JSON.parse(fs.readFileSync(path.join(projectDir,'design.json')));if(!data.valid)throw Error('Invalid professional configuration');return {stage:'review',inputHashes:{}};},
      capabilities:[{id:'example.review',domain:'example',title:'review',stages:['review'],priority:1,keywords:['review'],skills:[],tools:[{id:'example.inspect'}],verification:[]}],
      tools:[{descriptor:{schemaVersion:'1',id:'example.inspect',version:'1',risk:'read-only',verification:[]},execute:()=>({executionSucceeded:true,artifacts:[]})}],verifiers:{}
    });`,
  );
  const registry = {
    runtimePacks: [
      {
        id: 'test-pack',
        domain: 'example',
        version: '1',
        directory: pack,
        runtime: { entry: 'index.cjs' },
      },
    ],
  };
  const bundle = createProjectRuntime({
    projectDir: project,
    domain: 'example',
    registry,
    directory: path.join(directory, 'state'),
    environment: { INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'config') },
  });
  t.after(() => {
    bundle.runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const scoped = state =>
    resolveProjectTask(
      'example',
      { task: 'review', state },
      undefined,
      bundle.capabilities,
      {},
      [],
      [{ id: 'example' }],
    ).scope;
  const initial = await bundle.runtime.inspect();
  assert.equal(initial.stage, null);
  assert.ok(!scoped(initial).tools.includes('example.inspect'));
  const created = await bundle.runtime.execute(
    {
      toolId: 'project.files.apply',
      inputs: {
        changes: [{ path: 'design.json', content: '{"valid":true}', expectedSha256: null }],
      },
      expectedStateId: initial.id,
    },
    { scope: scoped(initial), approval: true },
  );
  assert.equal(created.state.stage, 'review');
  assert.ok(scoped(created.state).tools.includes('example.inspect'));
  const competing = resolveProjectTask(
    'example',
    { task: 'project task file edit test and review', state: created.state },
    undefined,
    bundle.capabilities,
    {},
    [],
    [{ id: 'example' }],
  );
  assert.ok(
    competing.scope.tools.includes('example.inspect'),
    'Workspace discovery must not consume the professional capability selection slot.',
  );
  assert.ok(competing.scope.tools.includes('project.files.apply'));
  const refused = await bundle.runtime.execute(
    {
      toolId: 'project.files.apply',
      inputs: {
        changes: [{ path: 'generated/fake-proof', content: 'forged', expectedSha256: null }],
      },
      expectedStateId: created.state.id,
    },
    { scope: scoped(created.state), approval: true },
  );
  assert.equal(refused.action.status, 'failed');
  fs.writeFileSync(path.join(project, 'design.json'), 'not-json');
  const invalid = await bundle.runtime.inspect();
  assert.equal(invalid.stage, null);
  const inspected = await bundle.runtime.execute(
    { toolId: 'project.tasks.inspect', inputs: {}, expectedStateId: invalid.id },
    { scope: scoped(invalid) },
  );
  const receipt = JSON.parse(bundle.runtime.readArtifact(inspected.artifacts[0].id).content);
  assert.ok(receipt.inspectionDiagnostics.length);
  assert.equal(inspected.action.status, 'completed');
  const fixed = await bundle.runtime.execute(
    {
      toolId: 'project.files.apply',
      inputs: {
        changes: [
          {
            path: 'design.json',
            content: '{"valid":true}',
            expectedSha256: invalid.inputHashes['design.json'],
          },
        ],
      },
      expectedStateId: invalid.id,
    },
    { scope: scoped(invalid), approval: true },
  );
  assert.equal(fixed.state.stage, 'review');
  assert.deepEqual(bundle.stateDiagnostics, []);
});
