const fs = require('node:fs');
const path = require('node:path');

const SOURCE_PREVIEW_BYTES = 2 * 1024 * 1024;
const HIDDEN_DIRECTORIES = new Set(['node_modules', '__pycache__', 'target']);

function resolveProjectFile(projectDirectory, relative) {
  if (!projectDirectory || typeof relative !== 'string') throw Error('Choose a project first.');
  const file = fs.realpathSync(path.resolve(projectDirectory, relative));
  if (!file.startsWith(projectDirectory + path.sep) || !fs.statSync(file).isFile())
    throw Error('File is outside the selected project.');
  return file;
}

function listProjectFiles(projectDirectory, { includeBuildDirectories = false } = {}) {
  if (!projectDirectory) return [];
  const output = [];
  function walk(directory, depth) {
    if (depth > 3 || output.length >= 250) return;
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(
        item =>
          !item.name.startsWith('.') &&
          !HIDDEN_DIRECTORIES.has(item.name) &&
          (includeBuildDirectories || !['dist', 'build'].includes(item.name)),
      )
      .sort(
        (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
      );
    for (const entry of entries) {
      if (output.length >= 250) break;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const absolute = path.join(directory, entry.name);
      output.push({
        path: path.relative(projectDirectory, absolute),
        name: entry.name,
        depth,
        directory: entry.isDirectory(),
      });
      if (entry.isDirectory()) walk(absolute, depth + 1);
    }
  }
  walk(projectDirectory, 0);
  return output;
}

function readSourcePreview(file, relative, viewer) {
  const sizeBytes = fs.statSync(file).size;
  const metadata = {
    path: relative,
    name: path.basename(file),
    sizeBytes,
    viewer,
    content: null,
    truncated: false,
  };
  if (viewer) return metadata;
  const handle = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(Math.min(sizeBytes, SOURCE_PREVIEW_BYTES));
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(handle, buffer, offset, buffer.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const bytes = buffer.subarray(0, offset);
    return {
      ...metadata,
      content: bytes.includes(0) ? null : bytes.toString('utf8'),
      truncated: sizeBytes > SOURCE_PREVIEW_BYTES,
    };
  } finally {
    fs.closeSync(handle);
  }
}

module.exports = { resolveProjectFile, listProjectFiles, readSourcePreview };
