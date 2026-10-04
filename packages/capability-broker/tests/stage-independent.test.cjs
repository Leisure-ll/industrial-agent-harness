const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { resolveFromState } = require('../src/index.cjs');
test('stage-independent tools can bootstrap an empty project without inventing engineering facts', () => {
  const state = {
    schemaVersion: '1',
    id: crypto.randomUUID(),
    projectId: 'a'.repeat(64),
    domain: 'example',
    stage: null,
    status: 'unverified',
    artifacts: [],
    inputHashes: {},
    verificationIds: [],
    createdAt: new Date().toISOString(),
  };
  const item = {
    id: 'example.prepare',
    domain: 'example',
    title: 'Prepare',
    priority: 10,
    stages: [],
    keywords: ['prepare'],
    skills: [],
    tools: [{ id: 'example.prepare' }],
    verification: [],
  };
  const phase = {
    ...item,
    id: 'example.finish',
    stages: ['finished'],
    tools: [{ id: 'example.finish' }],
  };
  const out = resolveFromState({ task: 'prepare finished', state }, [item, phase]);
  assert.equal(out.scope.stage, null);
  assert.deepEqual(out.scope.tools, ['example.prepare']);
  assert.equal(out.scope.stateId, state.id);
  assert.deepEqual(resolveFromState({ task: 'prepare finished', state }, [phase]).scope.tools, []);
});
