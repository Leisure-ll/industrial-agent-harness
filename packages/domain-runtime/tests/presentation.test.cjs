const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { bindPresentation } = require('../src/presentation.cjs');

test('local output refs bind only to this Action; forged identities and unbound input versions are rejected as display metadata', t => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'result-binding-')));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, 'input.txt'), 'actual');
  const digest = crypto.createHash('sha256').update('actual').digest('hex');
  const action = { id: crypto.randomUUID(), projectId: 'a'.repeat(64), inputHashes: {} };
  const artifact = {
    id: crypto.randomUUID(),
    actionId: action.id,
    projectId: action.projectId,
    sizeBytes: 6,
    sha256: digest,
  };
  const result = {
    artifacts: [{ localId: 'native' }],
    presentation: {
      schemaVersion: '1',
      groups: [{ key: 'document', title: 'Document', primary: 'native' }],
    },
  };
  assert.equal(
    bindPresentation(result, action, [artifact], project).groups[0].primaryArtifactId,
    artifact.id,
  );
  for (const invalid of [
    {
      ...result,
      presentation: {
        ...result.presentation,
        groups: [{ ...result.presentation.groups[0], preview: 'unknown' }],
      },
    },
    {
      ...result,
      presentation: {
        ...result.presentation,
        groups: [
          {
            ...result.presentation.groups[0],
            supersedesInput: { relativePath: 'input.txt', sha256: digest },
          },
        ],
      },
    },
    {
      ...result,
      presentation: {
        ...result.presentation,
        inputs: [{ output: 'native', relativePath: '../escape' }],
      },
    },
  ]) {
    const bound = bindPresentation(invalid, action, [artifact], project);
    assert.deepEqual(bound.groups, []);
    assert.equal(bound.diagnostics.length, 1);
  }
  const snapshot = {
    ...result,
    presentation: {
      ...result.presentation,
      inputs: [{ output: 'native', relativePath: 'input.txt' }],
      groups: [
        {
          ...result.presentation.groups[0],
          supersedesInput: { relativePath: 'input.txt', sha256: digest },
        },
      ],
    },
  };
  assert.equal(bindPresentation(snapshot, action, [artifact], project).groups.length, 1);
  fs.writeFileSync(path.join(project, 'input.txt'), 'replacement');
  assert.equal(bindPresentation(snapshot, action, [artifact], project).groups.length, 0);
  assert.equal(
    bindPresentation(result, action, [{ ...artifact, actionId: crypto.randomUUID() }], project)
      .groups.length,
    0,
  );
});
