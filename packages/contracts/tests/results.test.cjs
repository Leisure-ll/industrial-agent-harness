const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolPresentationSchema, ResultSelectionRequestSchema } = require('../src/index.cjs');
test('minimal document presentation requires neither domain state nor a verifier', () => {
  assert.deepEqual(
    ToolPresentationSchema.parse({
      schemaVersion: '1',
      groups: [{ key: 'document', title: 'Notes', primary: 'notes' }],
    }).groups[0].attachments,
    [],
  );
  assert.equal(ToolPresentationSchema.safeParse({ schemaVersion: '2', groups: [] }).success, false);
  assert.equal(
    ToolPresentationSchema.safeParse({
      schemaVersion: '1',
      groups: [{ key: 'x', title: 'x', primary: 'notes', verification: 'passed' }],
    }).success,
    false,
  );
});
test('selection accepts only group IDs and a host revision, never file pairs or acceptance claims', () => {
  assert.equal(
    ResultSelectionRequestSchema.safeParse({ groupIds: ['registered'], revision: 1 }).success,
    true,
  );
  for (const field of ['sha256', 'primary', 'verification', 'projectId', 'turnId'])
    assert.equal(
      ResultSelectionRequestSchema.safeParse({
        groupIds: ['registered'],
        revision: 1,
        [field]: 'forged',
      }).success,
      false,
    );
});
