const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveProjectFile, listProjectFiles, readSourcePreview } = require('./project-files.cjs');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-project-files-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  return { root, project };
}

test('project file access rejects sibling paths and escaping symlinks', t => {
  const { root, project } = fixture(t);
  const file = path.join(project, 'source.txt');
  fs.writeFileSync(file, 'source');
  const outside = path.join(root, 'outside.txt');
  fs.writeFileSync(outside, 'outside');
  assert.equal(resolveProjectFile(project, 'source.txt'), file);
  assert.throws(() => resolveProjectFile(project, '../outside.txt'), /outside/);
  fs.symlinkSync(outside, path.join(project, 'linked.txt'));
  assert.throws(() => resolveProjectFile(project, 'linked.txt'), /outside/);
});

test('project tree retains ordering, visibility and bounded depth and size', t => {
  const { project } = fixture(t);
  for (const name of ['build', 'dist', 'node_modules', '.hidden', 'src'])
    fs.mkdirSync(path.join(project, name));
  fs.writeFileSync(path.join(project, 'z.txt'), 'last');
  fs.mkdirSync(path.join(project, 'src/a/b/c/d'), { recursive: true });
  const files = listProjectFiles(project);
  assert.deepEqual(
    files.map(item => item.path.replaceAll('\\', '/')),
    ['src', 'src/a', 'src/a/b', 'src/a/b/c', 'z.txt'],
  );
  assert.deepEqual(
    listProjectFiles(project, { includeBuildDirectories: true })
      .filter(item => item.depth === 0)
      .map(item => item.name),
    ['build', 'dist', 'src', 'z.txt'],
  );
  for (let index = 0; index < 300; index++)
    fs.writeFileSync(path.join(project, `file-${index}.txt`), '');
  assert.equal(listProjectFiles(project).length, 250);
  assert.deepEqual(listProjectFiles(null), []);
});

test('source previews bound text reads, preserve binary detection and defer Viewer content', t => {
  const { project } = fixture(t);
  const file = path.join(project, 'source.txt');
  fs.writeFileSync(file, '你好\n');
  assert.equal(readSourcePreview(file, 'source.txt', null).content, '你好\n');
  fs.writeFileSync(file, Buffer.from([97, 0, 98]));
  assert.equal(readSourcePreview(file, 'source.txt', null).content, null);
  fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024 + 1));
  const preview = readSourcePreview(file, 'source.txt', null);
  assert.equal(preview.content.length, 2 * 1024 * 1024);
  assert.equal(preview.truncated, true);
  assert.equal(readSourcePreview(file, 'source.txt', 'text').content, null);
  assert.equal(readSourcePreview(file, 'source.txt', 'text').truncated, false);
});
