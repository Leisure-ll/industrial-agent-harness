const fs = require('node:fs');
const path = require('node:path');
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;
const MAX_FILES = 2000;

function skillResourceFiles(directory) {
  const files = [];
  let total = 0;
  function visit(file, relative = '') {
    const info = fs.lstatSync(file);
    if (info.isSymbolicLink()) throw Error('Skill resources cannot contain symlinks.');
    if (info.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) {
        if (['__pycache__', '.DS_Store'].includes(name) || name.endsWith('.pyc')) continue;
        visit(path.join(file, name), relative ? `${relative}/${name}` : name);
      }
    } else if (info.isFile()) {
      total += info.size;
      if (info.size > MAX_FILE || total > MAX_TOTAL || files.length >= MAX_FILES)
        throw Error('Skill resource size limit exceeded.');
      files.push(relative);
    } else throw Error('Skill resources must be ordinary files.');
  }
  if (!fs.lstatSync(directory).isDirectory())
    throw Error('Skill source must be an ordinary directory.');
  visit(directory);
  if (!files.includes('SKILL.md')) throw Error('Missing Skill entrypoint.');
  return files;
}

function copySkillResources(source, destination) {
  const files = skillResourceFiles(source);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const relative of files) {
    const from = path.join(source, ...relative.split('/'));
    const target = path.join(destination, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    // Refuse changed links between inventory and opening instead of following them.
    const fd = fs.openSync(from, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const info = fs.fstatSync(fd);
      if (!info.isFile() || info.size > MAX_FILE) throw Error('Invalid Skill resource.');
      const bytes = fs.readFileSync(fd);
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: info.mode & 0o111 ? 0o700 : 0o600 });
    } finally {
      fs.closeSync(fd);
    }
  }
  return destination;
}

function materializeSkillDirectories(entries, directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const root = path.join(directory, 'skills');
  const staged = fs.mkdtempSync(path.join(directory, '.skills-'));
  const backup = path.join(directory, `.skills-previous-${require('node:crypto').randomUUID()}`);
  try {
    const names = new Set();
    for (const entry of entries) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(entry.name) || names.has(entry.name))
        throw Error('Invalid or colliding Skill directory name.');
      names.add(entry.name);
      const target = path.join(staged, entry.name);
      copySkillResources(entry.source, target);
      if (entry.suffix) fs.appendFileSync(path.join(target, 'SKILL.md'), entry.suffix);
    }
    const replaced = fs.existsSync(root);
    if (replaced) {
      if (fs.lstatSync(root).isSymbolicLink())
        throw Error('Session Skill directory cannot be a symlink.');
      fs.renameSync(root, backup);
    }
    try {
      fs.renameSync(staged, root);
    } catch (error) {
      if (replaced) fs.renameSync(backup, root);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
    return root;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

module.exports = { copySkillResources, materializeSkillDirectories, skillResourceFiles };
