const test = require('node:test');
const assert = require('node:assert/strict');
const { createResultPreviewPolicy } = require('./result-preview.cjs');
const context = { chatId: 'chat', projectId: 'project', focusRevision: 0, turnId: 'turn' };
const group = {
  id: 'model',
  primaryArtifactId: 'native',
  previewArtifactId: 'preview',
  executionStatus: 'completed',
};
function ready(groups = [group]) {
  return {
    type: 'results-ready',
    autoPreviewEligible: true,
    results: {
      turnId: 'turn',
      chatId: 'chat',
      phase: 'settled',
      requestStatus: 'completed',
      groups,
    },
  };
}
test('a unique explicit preview opens at most once; diagnostics do not replace it', () => {
  const policy = createResultPreviewPolicy();
  policy.begin(context);
  const event = ready([
    group,
    { id: 'report', primaryArtifactId: 'report', executionStatus: 'completed' },
  ]);
  assert.equal(policy.consume(event, context).artifactId, 'preview');
  assert.equal(policy.consume(event, context), null);
});
test('parallel designs, failure, background completion, historical selection and old turns never steal focus', () => {
  for (const event of [
    ready([group, { ...group, id: 'b' }]),
    ready([{ ...group, executionStatus: 'failed' }]),
    { ...ready(), autoPreviewEligible: false },
    { ...ready(), results: { ...ready().results, requestStatus: 'cancelled' } },
    {
      ...ready(),
      results: { ...ready().results, selection: { groupIds: ['model'], historical: true } },
    },
  ]) {
    const policy = createResultPreviewPolicy();
    policy.begin(context);
    assert.equal(policy.consume(event, context), null);
  }
  for (const changed of [
    { focusRevision: 1 },
    { chatId: 'other' },
    { projectId: 'other' },
    { turnId: 'next' },
  ]) {
    const policy = createResultPreviewPolicy();
    policy.begin(context);
    assert.equal(policy.consume(ready(), { ...context, ...changed }), null);
  }
  assert.equal(
    createResultPreviewPolicy().consume(ready(), context),
    null,
    'restart/history does not arm automatic preview',
  );
});

test('native Kimi finished status is accepted only after the application settles related work', () => {
  const policy = createResultPreviewPolicy();
  policy.begin(context);
  const event = ready();
  event.results.requestStatus = 'finished';
  assert.equal(policy.consume(event, context).artifactId, 'preview');
});
