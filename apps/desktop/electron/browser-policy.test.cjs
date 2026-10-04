const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  BrowserFiles,
  normalizeBrowserUrl,
  clippedBounds,
  sha256,
} = require('./browser-policy.cjs');

test('address policy supports websites and localhost, rejects executable and credential URLs', () => {
  for (const [input, expected] of [
    ['example.com/path', 'https://example.com/path'],
    ['localhost:3000/a', 'http://localhost:3000/a'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080/'],
    ['[::1]:3000', 'http://[::1]:3000/'],
    ['https://example.com', 'https://example.com/'],
    ['', 'about:blank'],
  ])
    assert.equal(normalizeBrowserUrl(input), expected);
  for (const input of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,x',
    'app://viewer/index.html',
    'about:config',
    'chrome://settings',
    'https://name:password@example.com',
    'https://example.com/\nx',
    'my search terms',
    'harness-browser://unknown/index.html',
  ])
    assert.throws(() => normalizeBrowserUrl(input));
});

test('native viewport cannot extend beyond the host window', () => {
  assert.deepEqual(
    clippedBounds({ x: -20, y: 50, width: 5000, height: 900 }, { width: 800, height: 600 }),
    { x: 0, y: 50, width: 800, height: 550 },
  );
  assert.throws(() =>
    clippedBounds({ x: NaN, y: 0, width: 10, height: 10 }, { width: 800, height: 600 }),
  );
});

test('project preview serves relative resources with stable hashes and project boundaries', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-browser-policy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'project'));
  const project = { id: 'project-a', path: path.join(root, 'project') };
  const html = '<script src="app.js"></script><h1>Preview</h1>';
  const file = path.join(project.path, 'index.html');
  await fs.writeFile(file, html);
  await fs.writeFile(path.join(project.path, 'app.js'), 'document.title="Loaded"');
  await fs.writeFile(path.join(project.path, '.env'), 'secret');
  await fs.writeFile(path.join(root, 'outside.js'), 'secret');
  await fs.symlink(path.join(root, 'outside.js'), path.join(project.path, 'escape.js'));
  const files = new BrowserFiles();
  const url = await files.register(project, file, sha256(html));
  assert.equal(await files.register(project, file, sha256(html)), url);
  assert.equal(normalizeBrowserUrl(url, files.origins(project.id)), url);
  assert.equal(await (await files.handle({ url }, project.id)).text(), html);
  const script = new URL('app.js', url).href;
  assert.equal((await files.handle({ url: script }, project.id)).status, 200);
  await fs.symlink(path.join(project.path, 'app.js'), path.join(project.path, 'alias.js'));
  const alias = new URL('alias.js', url).href;
  assert.equal((await files.handle({ url: alias }, project.id)).status, 200);
  await fs.writeFile(path.join(project.path, 'replacement.js'), 'replacement');
  await fs.unlink(path.join(project.path, 'alias.js'));
  await fs.symlink(path.join(project.path, 'replacement.js'), path.join(project.path, 'alias.js'));
  assert.equal((await files.handle({ url: alias }, project.id)).status, 403);
  for (const relative of [
    'escape.js',
    '.env',
    '%2eenv',
    '%2e%2e%2foutside.js',
    'missing.js',
    'index.html%00',
  ])
    assert.equal(
      (await files.handle({ url: new URL(relative, url).href }, project.id)).status,
      403,
      relative,
    );
  assert.equal((await files.handle({ url }, 'project-b')).status, 403);
  assert.equal((await files.handle({ url, method: 'POST' }, project.id)).status, 403);
  assert.equal((await files.handle({ url, method: 'HEAD' }, project.id)).status, 200);
  await fs.writeFile(path.join(project.path, 'app.js'), 'changed');
  assert.match(await (await files.handle({ url: script }, project.id)).text(), /changed/);
  await fs.writeFile(file, 'changed');
  assert.equal((await files.handle({ url }, project.id)).status, 403);
  await assert.rejects(files.register(project, file, sha256(html)), /changed/);
  files.close();
  assert.equal((await files.handle({ url }, project.id)).status, 403);
});

test('oversized project resources fail without being served', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-browser-limit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'large.html');
  const handle = await fs.open(file, 'w');
  await handle.truncate(32 * 1024 * 1024 + 1);
  await handle.close();
  await assert.rejects(
    new BrowserFiles().register({ id: 'a', path: root }, file, 'hash'),
    /32 MiB/,
  );
});
