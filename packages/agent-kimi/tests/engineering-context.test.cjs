const test = require('node:test');
const assert = require('node:assert/strict');
const { engineeringContext } = require('../src/engineering-context.cjs');
test('continuation context contains bounded current output references without inventing engineering facts', () => {
  const model = {
    id: 'output-id',
    kind: 'model.example',
    relativePath: 'outputs/new-version/model.bin',
    sha256: 'a'.repeat(64),
  };
  const state = {
    schemaVersion: '1',
    id: 'current-state',
    projectId: 'example-project',
    domain: 'example',
    stage: null,
    status: 'verified',
    verificationIds: ['verification-id'],
    inputHashes: { 'original.bin': 'b'.repeat(64) },
    artifacts: [
      {
        ...model,
        id: 'diagnostic',
        kind: 'diagnostic.example',
        relativePath: 'outputs/new-version/log.txt',
      },
      model,
    ],
  };
  const text = engineeringContext(state);
  assert.ok(text.includes(JSON.stringify(model)));
  assert.ok(text.includes('expectedStateId=current-state'));
  assert.ok(text.includes('"stage":null'));
  assert.ok(!text.includes('original.bin'));
  assert.ok(!text.includes('volume'));
  assert.equal(engineeringContext(null), '');
  const factsOnly = engineeringContext(state, 0);
  assert.ok(factsOnly.includes('expectedStateId=current-state'));
  assert.ok(factsOnly.includes('"currentArtifacts":[]'));
  assert.ok(!factsOnly.includes(model.relativePath));
  const many = engineeringContext({
    ...state,
    artifacts: Array.from({ length: 100 }, (_, i) => ({ ...model, id: 'output-' + i })),
  });
  assert.ok(Buffer.byteLength(many) < 4096);
});
