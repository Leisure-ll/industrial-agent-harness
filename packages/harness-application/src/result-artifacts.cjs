const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Reuses PR #52's recorded Action/Artifact resolution and digest check, moved
// below Desktop so CLI and other application consumers share the boundary.
async function resolveResultArtifact(runtime, request) {
  if (!request || typeof request.actionId !== 'string' || typeof request.artifactId !== 'string')
    throw Error('Choose an output from a recorded action.');
  const action = runtime.get('action', request.actionId);
  const artifact = runtime.get('artifact', request.artifactId);
  if (
    !action ||
    !artifact ||
    action.projectId !== runtime.project.projectId ||
    artifact.projectId !== action.projectId ||
    artifact.actionId !== action.id ||
    artifact.runId !== action.runId ||
    !action.artifactIds.includes(artifact.id)
  )
    throw Error('This output does not belong to the recorded action.');
  runtime.assertProjectBound?.();
  const file = fs.realpathSync(path.resolve(runtime.projectDir, artifact.relativePath));
  if (!file.startsWith(runtime.projectDir + path.sep) || !fs.statSync(file).isFile())
    throw Error('File is outside the selected project.');
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const bytes of fs.createReadStream(file)) {
    size += bytes.length;
    if (size > artifact.sizeBytes) throw Error('This output has changed since the action.');
    hash.update(bytes);
  }
  if (size !== artifact.sizeBytes || hash.digest('hex') !== artifact.sha256)
    throw Error(
      'This output has changed since the action. Open the current file from the project instead.',
    );
  return { artifact, file };
}
// Display-only freshness. It does not invalidate or rewrite historical checks.
function resultContentStatus(runtime, artifact) {
  try {
    const file = fs.realpathSync(path.resolve(runtime.projectDir, artifact.relativePath));
    if (!file.startsWith(runtime.projectDir + path.sep) || !fs.statSync(file).isFile())
      return 'unavailable';
    if (fs.statSync(file).size !== artifact.sizeBytes) return 'changed';
    if (artifact.sizeBytes > 64 * 1024 * 1024) return 'unchecked';
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(file, 'r'),
      buffer = Buffer.alloc(65536);
    try {
      let read,
        total = 0;
      while ((read = fs.readSync(fd, buffer, 0, buffer.length, null))) {
        total += read;
        if (total > artifact.sizeBytes) return 'changed';
        hash.update(buffer.subarray(0, read));
      }
    } finally {
      fs.closeSync(fd);
    }
    return hash.digest('hex') === artifact.sha256 ? 'recorded' : 'changed';
  } catch {
    return 'unavailable';
  }
}
module.exports = { resolveResultArtifact, resultContentStatus };
