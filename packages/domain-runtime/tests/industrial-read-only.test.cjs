const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { IndustrialRuntime } = require('../src/index.cjs');

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
