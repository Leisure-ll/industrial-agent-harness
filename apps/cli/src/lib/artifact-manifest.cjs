const fs = require('node:fs');
const path = require('node:path');

// Transport input validation only; canonical facts and verification live in Runtime.
async function loadArtifacts(manifestFile, projectDir) {
  if (!manifestFile) return new Map();
  const entries = JSON.parse(fs.readFileSync(path.resolve(manifestFile), 'utf8'));
  if (!Array.isArray(entries)) throw Error('Artifact manifest must be a JSON array.');
  const artifacts = new Map();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      typeof entry.path !== 'string' ||
      !['layout', 'netlist', 'waveform'].includes(entry.kind)
    )
      throw Error('Invalid artifact manifest entry.');
    if (artifacts.has(entry.id)) throw Error('Duplicate artifact ID.');
    const file = fs.realpathSync(path.resolve(projectDir, entry.path));
    const relativePath = path.relative(projectDir, file);
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath) ||
      !fs.statSync(file).isFile()
    )
      throw Error('Artifact must be a file inside the project.');
    artifacts.set(entry.id, {
      file,
      metadata: {
        id: entry.id,
        kind: entry.kind,
        name: path.basename(file),
        relativePath,
        sizeBytes: fs.statSync(file).size,
      },
    });
  }
  return artifacts;
}
module.exports = { loadArtifacts };
