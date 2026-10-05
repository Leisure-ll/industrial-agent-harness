const fs = require('node:fs');
const path = require('node:path');

// Keep instruction discovery and skill parsing in Kimi. Its writable session
// workspace is not the engineering project, so map project inputs explicitly.
function prepareProjectWorkspace(directory, projectDir) {
  if (!projectDir) return [];
  const project = fs.realpathSync(projectDir);
  const workspace = path.join(directory, 'workspace');
  const existingWorkspace = fs.lstatSync(workspace, { throwIfNoEntry: false });
  if (existingWorkspace && !existingWorkspace.isDirectory())
    throw Error(`Project mappings require a session workspace directory: ${workspace}`);
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
  for (const brand of ['.kimi-code', '.kimi', '.claude', '.codex', '.agents']) {
    const source =
      brand === '.kimi-code' && !fs.existsSync(path.join(project, brand, 'skills'))
        ? path.join(project, '.kimi', 'skills')
        : path.join(project, brand, 'skills');
    const parent = path.join(workspace, brand);
    // Never follow a workspace-controlled parent link while writing mappings.
    const existing = fs.lstatSync(parent, { throwIfNoEntry: false });
    if (existing && !existing.isDirectory())
      throw Error(`Project skill mapping requires a session directory: ${parent}`);
    const target = path.join(parent, 'skills');
    fs.rmSync(target, { recursive: true, force: true });
    if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) continue;
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    fs.symlinkSync(source, target, 'junction');
  }
  for (const relative of ['AGENTS.md', 'agents.md', '.kimi/AGENTS.md', '.kimi-code/AGENTS.md'])
    fs.rmSync(path.join(workspace, relative), { force: true });
  const rootInstructions = ['AGENTS.md', 'agents.md'].find(name =>
    fs.statSync(path.join(project, name), { throwIfNoEntry: false })?.isFile(),
  );
  for (const relative of [rootInstructions, '.kimi/AGENTS.md'].filter(Boolean)) {
    const source = path.join(project, relative);
    if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) continue;
    const target = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.symlinkSync(source, target, 'file');
  }
  const instructions = path.join(project, '.kimi-code/AGENTS.md');
  const legacyInstructions = path.join(project, '.kimi/AGENTS.md');
  const source = fs.existsSync(instructions) ? instructions : legacyInstructions;
  if (fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
    const target = path.join(workspace, '.kimi-code/AGENTS.md');
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.symlinkSync(source, target, 'file');
  }
  return ['.skill', '.skills', '.claude/skills', '.codex/skills']
    .map(name => path.join(project, name))
    .filter(root => fs.statSync(root, { throwIfNoEntry: false })?.isDirectory());
}

module.exports = { prepareProjectWorkspace };
