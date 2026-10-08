const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const owner = require('@zhiman-bj/industrial-domain-packs');
const { loadRegistry, materializeSkills } = require('../../domain-skills/src/index.cjs');
const { createProjectRuntime } = require('../src/project-runtime.cjs');
const { resolveFromState } = require('../../capability-broker/src/index.cjs');
const { CudaService, startHttp } = require(
  path.join(owner.sourceDirectory('cuda-pack'), 'server/mcp.cjs'),
);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('pinned consumer discovers CUDA and its Skill while unconfigured execution stays unavailable', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuda-consumer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'model.py'), 'reference');
  fs.writeFileSync(path.join(projectDir, 'model_new.py'), 'candidate');
  const registry = loadRegistry();
  assert(registry.domains.some(domain => domain.id === 'cuda'));
  assert(registry.runtimePacks.some(pack => pack.id === 'cuda-pack'));
  const staged = materializeSkills({ skills: ['cuda.kernel.optimize'] }, path.join(root, 'skills'));
  assert(
    fs
      .readFileSync(path.join(staged, 'cuda-kernel-optimize/SKILL.md'), 'utf8')
      .includes('cuda.candidate.compile'),
  );
  const bound = createProjectRuntime({
    projectDir,
    domain: 'cuda',
    directory: path.join(root, 'store'),
    environment: { INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(root, 'config') },
    registry,
  });
  t.after(() => bound.runtime.close());
  const state = await bound.runtime.inspect();
  assert.equal(state.stage, 'kernel');
  assert(!bound.runtime.descriptors().some(tool => tool.id.startsWith('cuda.')));
});

test('shared factory and Broker use both authenticated MCP identities from the pinned owner', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuda-consumer-http-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'model.py'), 'reference');
  fs.writeFileSync(path.join(projectDir, 'model_new.py'), 'candidate');
  const config = {
    projectId: hash(projectDir + '\0cuda'),
    stateDirectory: path.join(root, 'native-store'),
    imageId: require(path.join(owner.sourceDirectory('cuda-pack'), 'locks/rtx4090-image.json'))
      .imageId,
    gpuUuid: 'GPU-31ebe3bf-b2e5-5e2e-2350-131b6336dd39',
    taskSha256: hash('reference'),
  };
  const service = new CudaService(config, {
    check: async () => ({ ready: true, nativeQualification: 'transport-fixture-only' }),
  });
  const server = await startHttp(service, {
    compilerToken: 'compiler-test-token',
    evaluatorToken: 'evaluator-test-token',
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  const environment = { INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(root, 'config') };
  for (const role of ['compiler', 'evaluator']) {
    const prefix = 'INDUSTRIAL_HARNESS_CUDA_' + role.toUpperCase() + '_MCP_';
    environment[prefix + 'URL'] = 'http://127.0.0.1:' + server.address().port + '/' + role + '/mcp';
    environment[prefix + 'TOKEN'] = role + '-test-token';
    environment[prefix + 'IDENTITY'] = hash(JSON.stringify(service.identities[role]));
  }
  const bound = createProjectRuntime({
    projectDir,
    domain: 'cuda',
    directory: path.join(root, 'store'),
    environment,
    registry: loadRegistry(),
  });
  t.after(() => bound.runtime.close());
  for (const role of ['compiler', 'evaluator']) {
    const state = await bound.runtime.inspect(),
      scope = resolveFromState(
        { task: 'CUDA kernel optimization', state },
        bound.capabilities,
      ).scope;
    assert(scope.skills.includes('cuda.kernel.optimize'));
    const result = await bound.runtime.execute(
      {
        schemaVersion: '1',
        projectId: state.projectId,
        domain: state.domain,
        toolId: 'cuda.' + role + '.check',
        expectedStateId: state.id,
        inputs: {},
      },
      { scope },
    );
    assert.equal(result.action.status, 'completed');
    assert.equal(result.verification.status, 'not_run');
    assert.equal(JSON.parse(result.action.diagnostics[0]).identity.role, role);
  }
});
