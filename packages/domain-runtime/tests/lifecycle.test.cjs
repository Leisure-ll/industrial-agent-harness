const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { IndustrialRuntime } = require('../src/index.cjs');

test('closing or cancelling an idle chat cannot abort another chat action; runtime disposal settles once', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-owner-')),
    project = path.join(directory, 'project');
  fs.mkdirSync(project);
  let entered,
    signal,
    disposals = 0;
  const ready = new Promise(resolve => {
    entered = resolve;
  });
  const runtime = new IndustrialRuntime(project, 'example', {
    directory: path.join(directory, 'state'),
    stateProvider: () => ({ stage: null, inputHashes: {} }),
    dispose: async () => {
      disposals++;
      await new Promise(resolve => setImmediate(resolve));
    },
    tools: [
      {
        descriptor: {
          schemaVersion: '1',
          id: 'example.wait',
          version: '1',
          risk: 'read-only',
          verification: [],
        },
        execute: context =>
          new Promise(resolve => {
            signal = context.signal;
            entered();
            signal.addEventListener(
              'abort',
              () =>
                resolve({
                  executionSucceeded: false,
                  artifacts: [],
                  diagnostics: ['Owned operation cancelled'],
                }),
              { once: true },
            );
          }),
      },
    ],
  });
  t.after(async () => {
    await runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const state = await runtime.inspect(),
    pending = runtime.execute(
      { toolId: 'example.wait', inputs: {}, expectedStateId: state.id },
      {
        approval: true,
        ownerId: 'alice',
        scope: {
          domain: state.domain,
          projectId: state.projectId,
          stateId: state.id,
          tools: ['example.wait'],
        },
      },
    );
  await ready;
  runtime.cancel('bob');
  await runtime.waitForIdle('bob');
  assert.equal(signal.aborted, false);
  runtime.cancel('alice');
  assert.equal((await pending).action.status, 'failed');
  await Promise.all([runtime.close(), runtime.close()]);
  assert.equal(disposals, 1);
});
