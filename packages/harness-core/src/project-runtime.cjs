const fs = require('node:fs');
const path = require('node:path');
const { loadRegistry } = require('@industrial-agent-harness/domain-skills');
const { IndustrialRuntime } = require('@industrial-agent-harness/domain-runtime');

function createProjectRuntime({
  projectDir,
  domain,
  directory,
  environment = process.env,
  registry = loadRegistry(environment),
}) {
  const packs = (registry.runtimePacks || []).filter(pack => pack.domain === domain);
  if (!packs.length) return null;
  if (packs.length !== 1) throw Error('A project must resolve exactly one trusted Domain Runtime.');
  const pack = packs[0];
  const root = fs.realpathSync(pack.directory);
  const entry = fs.realpathSync(path.join(root, pack.runtime.entry));
  if (!entry.startsWith(root + path.sep)) throw Error('Runtime entry escaped the verified Pack.');
  // A verified same-version repair can replace entry/helpers at the same
  // pathname. New project runtimes must execute the current verified bytes.
  // Existing runtime instances and shared Core/npm modules remain untouched.
  for (const cached of Object.keys(require.cache))
    if (cached.startsWith(root + path.sep)) delete require.cache[cached];
  const plugin = require(entry).createRuntimePlugin({ environment });
  if (plugin.matchesProject && !plugin.matchesProject(projectDir)) return null;
  if (plugin.available === false)
    throw Error(
      'This Domain Runtime is not installed. Install its declared dependencies before engineering execution.',
    );
  const runtime = new IndustrialRuntime(projectDir, domain, { directory, ...plugin });
  return {
    runtime,
    capabilities: plugin.capabilities || [],
    protectedPaths: [root, runtime.directory, ...(plugin.protectedPaths || [])],
    packId: pack.id,
    packVersion: pack.version,
  };
}
module.exports = { createProjectRuntime };
