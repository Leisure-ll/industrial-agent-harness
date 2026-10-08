const crypto = require('node:crypto');
const fs = require('node:fs');
const { resolveProjectFile } = require('./project-files.cjs');

// Resolve the recorded identity, never a renderer-supplied path or digest.
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
  const file = resolveProjectFile(runtime.projectDir, artifact.relativePath);
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const bytes of fs.createReadStream(file)) {
    size += bytes.length;
    hash.update(bytes);
  }
  if (size !== artifact.sizeBytes || hash.digest('hex') !== artifact.sha256)
    throw Error(
      'This output has changed since the action. Open the current file from the project instead.',
    );
  return { artifact, file };
}

module.exports = { resolveResultArtifact };
