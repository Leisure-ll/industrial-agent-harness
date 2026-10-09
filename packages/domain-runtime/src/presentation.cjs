const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ToolPresentationSchema,
  ActionPresentationSchema,
} = require('@industrial-agent-harness/contracts');

function bindPresentation(result, action, artifacts, projectDir) {
  const bound = {
    schemaVersion: '1',
    actionId: action.id,
    groups: [],
    checks: [],
    diagnostics: [],
  };
  if (!result?.presentation) return bound;
  try {
    const declaration = ToolPresentationSchema.parse(result.presentation);
    const outputs = new Map();
    (result.artifacts || []).forEach((output, index) => {
      if (!output.localId) return;
      if (outputs.has(output.localId)) throw Error('Duplicate presentation output name.');
      outputs.set(output.localId, artifacts[index]);
    });
    const resolve = name => {
      const artifact = outputs.get(name);
      if (!artifact || artifact.actionId !== action.id || artifact.projectId !== action.projectId)
        throw Error('Presentation references an undeclared output: ' + name);
      return artifact.id;
    };
    const inputs = { ...action.inputHashes };
    for (const declared of declaration.inputs) {
      const artifact = outputs.get(declared.output);
      resolve(declared.output);
      const file = fs.realpathSync(path.resolve(projectDir, declared.relativePath));
      if (!file.startsWith(projectDir + path.sep) || !fs.statSync(file).isFile())
        throw Error('Presentation input escaped the project.');
      const relative = path.relative(projectDir, file).split(path.sep).join('/');
      if (
        relative !== declared.relativePath ||
        fs.statSync(file).size !== artifact.sizeBytes ||
        crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== artifact.sha256
      )
        throw Error('Presentation input differs from its recorded snapshot.');
      inputs[relative] = artifact.sha256;
    }
    const checkedInput = input => {
      if (inputs[input.relativePath] !== input.sha256)
        throw Error('Presentation relationship has no content-bound input.');
      return input;
    };
    const keys = new Set();
    const groups = declaration.groups.map(group => {
      if (keys.has(group.key)) throw Error('Duplicate presentation group key.');
      keys.add(group.key);
      return {
        key: group.key,
        title: group.title,
        primaryArtifactId: resolve(group.primary),
        ...(group.preview ? { previewArtifactId: resolve(group.preview) } : {}),
        attachmentArtifactIds: group.attachments.map(resolve),
        companionArtifactIds: group.companions.map(resolve),
        ...(group.supersedesInput ? { supersedesInput: checkedInput(group.supersedesInput) } : {}),
      };
    });
    const checks = declaration.checks.map(check => ({
      input: checkedInput(check.input),
      artifactIds: check.outputs.map(resolve),
    }));
    bound.groups = groups;
    bound.checks = checks;
  } catch (error) {
    // Presentation failures never rewrite execution or engineering acceptance.
    bound.diagnostics.push('Result grouping unavailable: ' + String(error.message).slice(0, 2000));
  }
  return ActionPresentationSchema.parse(bound);
}
module.exports = { bindPresentation };
