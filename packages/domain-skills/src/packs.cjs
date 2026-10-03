const fs = require('node:fs');
const path = require('node:path');
const { distributionDomain } = require('./distribution.cjs');

// Only repository-owned declarations are loaded. Project files cannot add launch commands.
function loadDomainPacks() {
  const directory = path.join(__dirname, '..', 'packs');
  if (!fs.existsSync(directory) && process.env.INDUSTRIAL_HARNESS_PACK_STORE) return [];
  const packs = fs
    .readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')));
  const ids = new Set();
  const toolIds = new Set();
  const capabilityIds = new Set();
  const providerIds = new Set();
  for (const pack of packs) {
    if (
      pack.schemaVersion !== 1 ||
      !pack.id ||
      ids.has(pack.id) ||
      !pack.domain ||
      !pack.version ||
      pack.provider?.version !== pack.version ||
      pack.provider?.domain !== pack.domain ||
      pack.provider?.transport !== 'gateway'
    )
      throw Error('Invalid repository Domain Pack declaration.');
    if (
      !/^[a-z0-9][a-z0-9.-]*$/.test(pack.provider.id) ||
      providerIds.has(pack.provider.id) ||
      !/^[a-z0-9][a-z0-9-]*$/.test(pack.provider.packDirectory) ||
      (pack.provider.backend !== 'godot-local' &&
        (!/^[A-Z][A-Z0-9_]*$/.test(pack.provider.directoryEnv) ||
          !/^[A-Z][A-Z0-9_]*$/.test(pack.provider.pythonEnv))) ||
      !/^[a-f0-9]{64}$/.test(pack.provider.sourceSha256) ||
      !Array.isArray(pack.provider.tools) ||
      !Array.isArray(pack.capabilities)
    )
      throw Error('Invalid Domain Pack provider metadata.');
    if (pack.provider.backend && !['pcb-bench', 'godot-local'].includes(pack.provider.backend))
      throw Error('Unsupported Domain Pack backend.');
    if (
      pack.provider.backend === 'godot-local' &&
      (pack.domain !== 'godot' || pack.provider.packDirectory !== 'godot')
    )
      throw Error('Invalid Godot Domain Pack identity.');
    if (
      pack.provider.backend === 'pcb-bench' &&
      (!/^[a-f0-9]{40}$/.test(pack.provider.sourceCommit) ||
        !/^sha256:[a-f0-9]{64}$/.test(pack.provider.imageId) ||
        !/^[a-f0-9]{64}$/.test(pack.provider.toolSchemaSha256))
    )
      throw Error('Invalid pinned provider identity.');
    if (pack.provider.sourceFiles) {
      const safePath = file =>
        typeof file === 'string' &&
        /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(file) &&
        !file.split('/').some(part => part === '.' || part === '..');
      const roots = pack.provider.resourceRoots;
      if (
        !Array.isArray(roots) ||
        !roots.length ||
        roots.some(file => !safePath(file)) ||
        roots.some((file, index) =>
          roots.some(
            (other, otherIndex) =>
              otherIndex !== index && (file === other || file.startsWith(other + '/')),
          ),
        ) ||
        !Object.keys(pack.provider.sourceFiles).length ||
        Object.entries(pack.provider.sourceFiles).some(
          ([file, hash]) =>
            !safePath(file) ||
            !roots.some(root => file.startsWith(root + '/')) ||
            !/^[a-f0-9]{64}$/.test(hash),
        )
      )
        throw Error('Invalid pinned provider resource inventory.');
    } else if (['pcb-bench', 'godot-local'].includes(pack.provider.backend))
      throw Error('Missing pinned provider resources.');
    ids.add(pack.id);
    providerIds.add(pack.provider.id);
    const declared = new Map();
    for (const tool of pack.provider.tools) {
      if (
        !tool.id ||
        !tool.name ||
        toolIds.has(tool.id) ||
        declared.has(tool.id) ||
        !['read-only', 'mutating'].includes(tool.risk) ||
        (tool.risk === 'mutating' && !tool.verification?.length)
      )
        throw Error('Invalid Domain Pack tool descriptor.');
      declared.set(tool.id, tool);
      toolIds.add(tool.id);
    }
    if (new Set(pack.provider.tools.map(tool => tool.name)).size !== declared.size)
      throw Error('Duplicate upstream MCP tool name.');
    for (const capability of pack.capabilities) {
      if (
        capability.domain !== pack.domain ||
        !capability.id ||
        capabilityIds.has(capability.id) ||
        !capability.keywords?.length ||
        !capability.tools?.length ||
        capability.tools.some(
          tool => JSON.stringify(tool) !== JSON.stringify(declared.get(tool.id)),
        )
      )
        throw Error('Capability does not match its Domain Pack tool declarations.');
      capabilityIds.add(capability.id);
    }
  }
  return packs.filter(pack => !distributionDomain || pack.domain === distributionDomain);
}
module.exports = { loadDomainPacks };
