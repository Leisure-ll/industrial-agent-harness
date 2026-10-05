const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ProjectPathSchema,
  ProjectTaskManifestSchema,
} = require('@industrial-agent-harness/contracts');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const excluded = new Set(['.git', '.harness-runs', 'node_modules', '.venv', '__pycache__']);
const inside = (file, root) => file === root || file.startsWith(root + path.sep);
function canonicalPath(file) {
  const missing = [];
  let current = path.resolve(file);
  while (!fs.existsSync(current)) {
    missing.unshift(path.basename(current));
    current = path.dirname(current);
  }
  return path.join(fs.realpathSync(current), ...missing);
}

function projectFile(projectDir, relative, protectedPaths = []) {
  projectDir = fs.realpathSync(projectDir);
  ProjectPathSchema.parse(relative);
  if (relative.split('/').some(part => excluded.has(part)))
    throw Error('Path is reserved for runtime, dependencies or evidence.');
  const file = path.join(projectDir, ...relative.split('/'));
  if (protectedPaths.some(root => inside(file, canonicalPath(root))))
    throw Error('Path is protected runtime storage.');
  let current = projectDir;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw Error('Project input paths cannot contain symlinks.');
    if (stat && current !== file && !stat.isDirectory())
      throw Error('A path parent is not a directory.');
  }
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && !stat.isFile()) throw Error('Expected an ordinary project file.');
  if (stat?.nlink > 1) throw Error('Hard-linked project files cannot be used.');
  return file;
}
function readBytes(file, maximum = 262144) {
  if (fs.statSync(file).size > maximum) throw Error('File exceeds the bounded read size.');
  return fs.readFileSync(file);
}
function inputIndex(projectDir, protectedPaths = []) {
  projectDir = fs.realpathSync(projectDir);
  const entries = {};
  let total = 0,
    count = 0;
  function visit(relative, depth = 0) {
    if (depth > 32) throw Error('Project input depth exceeds the workspace limit.');
    const directory = path.join(projectDir, relative);
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (excluded.has(entry.name)) continue;
      if (++count > 10000) throw Error('Project input entries exceed the workspace limit.');
      const name = relative ? relative + '/' + entry.name : entry.name;
      const file = path.join(projectDir, name);
      if (protectedPaths.some(root => inside(file, canonicalPath(root)))) continue;
      if (entry.isSymbolicLink())
        throw Error('Project input paths cannot contain symlinks: ' + name);
      if (entry.isDirectory()) visit(name, depth + 1);
      else if (entry.isFile()) {
        projectFile(projectDir, name, protectedPaths);
        const bytes = readBytes(file, 64 * 1024 * 1024);
        total += bytes.length;
        if (total > 256 * 1024 * 1024 || Object.keys(entries).length >= 10000)
          throw Error('Project input scan exceeds the bounded workspace limit.');
        entries[name] = hash(bytes);
      }
    }
  }
  visit('');
  return entries;
}
function manifest(projectDir, protectedPaths = []) {
  const file = projectFile(projectDir, 'harness.tasks.json', protectedPaths);
  if (!fs.existsSync(file)) return { schemaVersion: '1', tasks: {} };
  return ProjectTaskManifestSchema.parse(JSON.parse(readBytes(file).toString('utf8')));
}
function applyFiles(projectDir, changes, protectedPaths = []) {
  // Validate the entire batch and all preconditions before the first write.
  const plans = changes.map(change => {
    const file = projectFile(projectDir, change.path, protectedPaths);
    const before = fs.existsSync(file) ? readBytes(file) : null;
    if ((before === null ? null : hash(before)) !== change.expectedSha256)
      throw Error('File precondition is stale: ' + change.path);
    if (change.content === null && before === null) throw Error('Cannot delete a missing file.');
    return {
      ...change,
      file,
      before,
      beforeMode: before === null ? 0o600 : fs.statSync(file).mode & 0o777,
    };
  });
  const applied = [],
    createdDirectories = [];
  try {
    for (const plan of plans) {
      projectFile(projectDir, plan.path, protectedPaths);
      const current = fs.existsSync(plan.file) ? readBytes(plan.file) : null;
      if ((current === null ? null : hash(current)) !== plan.expectedSha256)
        throw Error('File changed before applying the batch: ' + plan.path);
      if (plan.content === null) fs.unlinkSync(plan.file);
      else {
        const missing = [];
        for (
          let parent = path.dirname(plan.file);
          !fs.existsSync(parent);
          parent = path.dirname(parent)
        )
          missing.unshift(parent);
        for (const parent of missing) {
          fs.mkdirSync(parent);
          createdDirectories.push(parent);
        }
        // Stage complete bytes before replacing an existing file. A partial
        // write/disk error must never truncate the original source.
        const temporary = path.join(
          path.dirname(plan.file),
          '.harness-edit-' + crypto.randomUUID(),
        );
        const fd = fs.openSync(temporary, 'wx', plan.beforeMode);
        let opened = true;
        try {
          fs.writeFileSync(fd, plan.content, 'utf8');
          if (process.platform !== 'win32') fs.fchmodSync(fd, plan.beforeMode);
          fs.fsyncSync(fd);
          fs.closeSync(fd);
          opened = false;
          projectFile(projectDir, plan.path, protectedPaths);
          if (plan.before !== null && hash(fs.readFileSync(plan.file)) !== plan.expectedSha256)
            throw Error('File changed before writing: ' + plan.path);
          if (plan.before === null) fs.linkSync(temporary, plan.file);
          else fs.renameSync(temporary, plan.file);
          applied.push(plan);
        } finally {
          if (opened) fs.closeSync(fd);
          fs.rmSync(temporary, { force: true });
        }
      }
      if (plan.content === null) applied.push(plan);
    }
  } catch (error) {
    for (const plan of applied.reverse()) {
      const file = projectFile(projectDir, plan.path, protectedPaths);
      const current = fs.existsSync(file) ? readBytes(file) : null;
      const expected = plan.content === null ? null : hash(Buffer.from(plan.content));
      if ((current === null ? null : hash(current)) !== expected) continue;
      if (plan.before === null) fs.unlinkSync(file);
      else fs.writeFileSync(file, plan.before, { mode: plan.beforeMode });
    }
    for (const directory of createdDirectories.reverse()) {
      try {
        fs.rmdirSync(directory);
      } catch {}
    }
    throw error;
  }
  return plans.map(plan => ({
    path: plan.path,
    beforeSha256: plan.expectedSha256,
    sha256: plan.content === null ? null : hash(Buffer.from(plan.content)),
  }));
}
function runDirectory(projectDir, actionId) {
  const parent = path.join(projectDir, '.harness-runs');
  const stat = fs.lstatSync(parent, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
    throw Error('Invalid runtime output directory.');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = path.join(parent, actionId);
  fs.mkdirSync(directory, { mode: 0o700 });
  return directory;
}
module.exports = { hash, projectFile, inputIndex, applyFiles, manifest, runDirectory, readBytes };
