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
test('continuations retain only still-available capabilities for the same project, domain and factual stage', () => {
  const state = {
    schemaVersion: '1',
    id: crypto.randomUUID(),
    projectId: 'b'.repeat(64),
    domain: 'example',
    stage: null,
    status: 'verified',
    artifacts: [],
    inputHashes: {},
    verificationIds: [crypto.randomUUID()],
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
  const first = resolveFromState({ task: 'prepare', state }, [item]);
  const task = '继续把刚刚的新版本换个形状';
  const next = resolveFromState(
    { task, state: { ...state, id: crypto.randomUUID() } },
    [item],
    first.scope,
  );
  assert.deepEqual(next.scope.tools, ['example.prepare']);
  assert.equal(next.scope.stage, null);
  assert.ok(
    next.trace.some(
      t => t.event === 'capability.resolve' && t.detail.selected[0]?.reason.includes('continue'),
    ),
  );
  for (const previous of [
    { ...first.scope, projectId: 'c'.repeat(64) },
    { ...first.scope, domain: 'other' },
    { ...first.scope, stage: 'finished' },
  ])
    assert.deepEqual(resolveFromState({ task, state }, [item], previous).scope.tools, []);
  assert.deepEqual(resolveFromState({ task, state }, [], first.scope).scope.tools, []);
  assert.deepEqual(
    resolveFromState({ task: 'Plan a holiday', state }, [item], first.scope).scope.tools,
    [],
  );
});
