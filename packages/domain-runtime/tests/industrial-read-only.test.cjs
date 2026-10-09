const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { IndustrialRuntime } = require('../src/index.cjs');

test('canonical history reader does not create a missing store', t => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-history-'));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const directory = path.join(projectDir, 'missing-store');
  assert.equal(IndustrialRuntime.openRecords(projectDir, 'test-domain', { directory }), null);
  assert.equal(fs.existsSync(directory), false);
});

test('canonical history reader preserves a live Action and execution lease, then reads it after shutdown', async t => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-history-'));
  const directory = path.join(projectDir, 'state');
  let release, entered;
  const waiting = new Promise(resolve => {
    release = resolve;
  });
  const started = new Promise(resolve => {
    entered = resolve;
  });
  const runtime = new IndustrialRuntime(projectDir, 'test-domain', {
    directory,
    stateProvider: async () => ({ stage: null, inputHashes: {} }),
    tools: [
      {
        descriptor: {
          schemaVersion: '1',
          id: 'test.wait',
          version: '1',
          risk: 'read-only',
          verification: [],
        },
        execute: async () => {
          entered();
          await waiting;
          return { executionSucceeded: true };
        },
      },
    ],
  });
  t.after(async () => {
    release();
    await runtime.waitForIdle();
    await runtime.close();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });
  const state = await runtime.inspect();
  const execution = runtime.execute(
    { toolId: 'test.wait', inputs: {}, expectedStateId: state.id },
    {
      scope: {
        domain: state.domain,
        projectId: state.projectId,
        stateId: state.id,
        tools: ['test.wait'],
      },
    },
  );
  await started;
  const action = runtime.listActions()[0];
  const owner = runtime.metadata('owner_pid');
  assert.equal(action.status, 'running');
  const records = IndustrialRuntime.openRecords(projectDir, state.domain, { directory });
  try {
    assert.deepEqual(records.project, runtime.project);
    assert.deepEqual(records.get('action', action.id), action);
    assert.equal(records.get('action', 'absent'), null);
    assert.equal(records.put, undefined);
    assert.equal(records.execute, undefined);
  } finally {
    records.close();
  }
  assert.equal(runtime.metadata('owner_pid'), owner);
  assert.deepEqual(runtime.get('action', action.id), action);
  release();
  const completed = await execution;
  await runtime.close();
  const persisted = IndustrialRuntime.openRecords(projectDir, state.domain, { directory });
  try {
    assert.deepEqual(persisted.get('action', action.id), completed.action);
  } finally {
    persisted.close();
  }
});

test('canonical history reader rejects a foreign project binding and an unsupported store version', async t => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-history-'));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const directory = path.join(projectDir, 'state');
  const runtime = new IndustrialRuntime(projectDir, 'test-domain', {
    directory,
    stateProvider: async () => ({ stage: null, inputHashes: {} }),
  });
  const project = runtime.project;
  await runtime.close();
  const db = new DatabaseSync(runtime.file);
  try {
    db.prepare('UPDATE core_records SET json=? WHERE kind=? AND id=?').run(
      JSON.stringify({ ...project, domain: 'another-domain' }),
      'project',
      project.projectId,
    );
    assert.throws(
      () => IndustrialRuntime.openRecords(projectDir, project.domain, { directory }),
      /project binding/,
    );
    db.exec('PRAGMA user_version=2');
    assert.throws(
      () => IndustrialRuntime.openRecords(projectDir, project.domain, { directory }),
      /store version/,
    );
  } finally {
    db.close();
  }
});

test('read-only host checks preserve verified design evidence on success and failure, and still enforce scope', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-read-only-'));
  fs.writeFileSync(path.join(directory, 'input.txt'), 'contract test input\n');
  let failure = false,
    calls = 0;
  const descriptor = (id, risk, verification = []) => ({
    schemaVersion: '1',
    id,
    version: '1',
    risk,
    verification,
  });
  const runtime = new IndustrialRuntime(directory, 'test-domain', {
    directory: path.join(directory, 'state'),
    stateProvider: async () => ({
      inputHashes: {
        'input.txt': crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(directory, 'input.txt')))
          .digest('hex'),
      },
      stage: 'declared',
    }),
    verifiers: {
      acceptance: async () => ({ status: 'passed', reason: 'contract fixture', metrics: {} }),
    },
    tools: [
      {
        descriptor: descriptor('test.verify', 'mutating', ['acceptance']),
        execute: async () => ({ executionSucceeded: true, artifacts: [] }),
      },
      {
        descriptor: descriptor('test.environment', 'read-only'),
        execute: async () => {
          calls++;
          if (failure) throw Error('Docker unavailable');
          return { executionSucceeded: true, artifacts: [], diagnostics: ['environment ready'] };
        },
      },
    ],
  });
  t.after(() => {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const state = await runtime.inspect();
  const scope = {
    domain: state.domain,
    projectId: state.projectId,
    stateId: state.id,
    tools: ['test.verify'],
  };
  const verified = await runtime.execute(
    { toolId: 'test.verify', inputs: {}, expectedStateId: state.id },
    { scope, approval: true },
  );
  assert.equal(verified.state.status, 'verified');
  scope.stateId = verified.state.id;
  scope.tools = ['test.environment'];
  const request = { toolId: 'test.environment', inputs: {}, expectedStateId: verified.state.id };
  const checked = await runtime.execute(request, { scope });
  assert.equal(checked.action.status, 'completed');
  assert.equal(checked.verification.status, 'not_run');
  assert.deepEqual(checked.state, verified.state);
  assert.equal(checked.checkpoint.stateHash, verified.checkpoint.stateHash);
  failure = true;
  const unavailable = await runtime.execute(request, { scope });
  assert.equal(unavailable.action.status, 'failed');
  assert.deepEqual(unavailable.state, verified.state);
  assert.deepEqual(unavailable.artifacts, []);
  const denied = await runtime.execute(request, { scope: { ...scope, tools: [] } });
  assert.match(denied.action.diagnostics.join(), /outside the current Broker scope/);
  assert.equal(calls, 2);
  assert.equal(runtime.listActions().length, 4);
});
