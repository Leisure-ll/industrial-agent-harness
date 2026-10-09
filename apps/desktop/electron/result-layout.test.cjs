const test = require('node:test');
const assert = require('node:assert/strict');

function group(id, options = {}) {
  return {
    id,
    actionId: id,
    title: 'Same report title',
    primaryArtifactId: id,
    artifacts: [{ id }],
    superseded: false,
    historical: false,
    selected: false,
    executionStatus: 'completed',
    contentStatus: 'recorded',
    verifications: [{ status: 'passed' }],
    ...options,
  };
}
test('explicitly attached reports fold together while final models and version history stay separate', async () => {
  const { partitionResultGroups } = await import('../src/result-layout.ts');
  const groups = [1, 2, 3].flatMap(step => [
    group('model' + step, {
      previewArtifactId: 'model' + step,
      superseded: step < 3,
      artifacts: [{ id: 'model' + step }, { id: 'report' + step }, { id: 'inspection' }],
    }),
    group('report' + step),
  ]);
  groups.push(group('inspection'));
  const { main, supporting, previous } = partitionResultGroups(groups);
  assert.deepEqual(
    main.map(item => item.id),
    ['model3'],
  );
  assert.deepEqual(
    supporting.map(item => item.id),
    ['report1', 'report2', 'report3', 'inspection'],
  );
  assert.deepEqual(
    previous.map(item => item.id),
    ['model1', 'model2'],
  );
  assert.equal(new Set([...main, ...supporting, ...previous]).size, groups.length);
});
test('equal titles do not collapse unrelated results and mutual attachments retain a main entry', async () => {
  const { partitionResultGroups } = await import('../src/result-layout.ts');
  const unrelated = [group('a'), group('b')];
  assert.deepEqual(partitionResultGroups(unrelated).main, unrelated);
  const mutual = [
    group('a', { artifacts: [{ id: 'a' }, { id: 'b' }] }),
    group('b', { artifacts: [{ id: 'b' }, { id: 'a' }] }),
  ];
  assert.deepEqual(partitionResultGroups(mutual).main, mutual);
});
test('selected, failed, uncertain, changed and unavailable attachments remain visible', async () => {
  const { partitionResultGroups } = await import('../src/result-layout.ts');
  for (const options of [
    { selected: true },
    { executionStatus: 'failed' },
    { verifications: [{ status: 'failed' }] },
    { verifications: [{ status: 'insufficient_evidence' }] },
    { contentStatus: 'changed' },
    { contentStatus: 'unavailable' },
    { contentStatus: 'unchecked' },
    { previewArtifactId: 'report' },
  ]) {
    const report = group('report', options);
    const parent = group('model', { artifacts: [{ id: 'model' }, { id: 'report' }] });
    assert.ok(
      partitionResultGroups([parent, report]).main.includes(report),
      JSON.stringify(options),
    );
  }
});
test('an explicitly selected superseded result is promoted out of the closed history section', async () => {
  const { partitionResultGroups } = await import('../src/result-layout.ts');
  const historical = group('old', { superseded: true, historical: true, selected: true });
  const { main, previous } = partitionResultGroups([historical, group('latest')]);
  assert.ok(main.includes(historical));
  assert.equal(previous.length, 0);
});
