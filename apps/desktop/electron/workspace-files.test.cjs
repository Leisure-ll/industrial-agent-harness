const test = require('node:test');
const assert = require('node:assert/strict');
test('browsing replaces one preview while explicitly retained files keep their identity', async () => {
  const { openWorkspaceFile } = await import('../src/workspace-files.ts');
  const file = (path, id = path, sha256 = id) => ({
    id,
    path,
    name: path,
    artifact: { id, sha256 },
  });
  let current = openWorkspaceFile([], file('model.FCStd')).files;
  current = openWorkspaceFile(current, file('README.md')).files;
  assert.deepEqual(
    current.map(item => item.path),
    ['README.md'],
  );
  current = openWorkspaceFile(current, file('README.md', 'new-read', 'README.md'), true).files;
  const retained = current[0];
  assert.equal(retained.id, 'README.md', 'Pinning an unchanged artifact retains its Viewer');
  assert.equal(retained.preview, false);
  current = openWorkspaceFile(current, file('model.FCStd')).files;
  current = openWorkspaceFile(current, file('recipe.json')).files;
  assert.equal(current[0], retained);
  assert.deepEqual(
    current.map(item => [item.path, item.preview]),
    [
      ['README.md', false],
      ['recipe.json', true],
    ],
  );
  const reopened = openWorkspaceFile(current, file('README.md', 'refresh', 'README.md'));
  assert.equal(reopened.selected.id, retained.id);
  assert.equal(reopened.selected.preview, false, 'Single-clicking a pinned file does not unpin it');
  assert.deepEqual(
    reopened.files.map(item => item.path),
    ['README.md', 'recipe.json'],
  );
  const changed = openWorkspaceFile(reopened.files, file('README.md', 'changed'));
  assert.equal(changed.selected.id, 'changed');
  assert.equal(changed.selected.preview, false, 'Refreshing a changed source retains pin status');
  assert.equal(reopened.files[0], retained, 'Opening is a pure update');
  const retried = openWorkspaceFile(
    reopened.files,
    file('README.md', 'retry', 'README.md'),
    false,
    true,
  );
  assert.equal(
    retried.selected.id,
    'retry',
    'Retrying a failed view recreates it even when the source hash is unchanged',
  );
  assert.equal(retried.selected.preview, false);
});
