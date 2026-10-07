const fs = require('node:fs');
const path = require('node:path');
const { loadRegistry } = require('@industrial-agent-harness/domain-skills');
const {
  IndustrialRuntime,
  createWorkspacePlugin,
} = require('@industrial-agent-harness/domain-runtime');
const {
  ExternalMcpRegistry,
  createExternalRuntimePlugin,
} = require('@industrial-agent-harness/domain-mcp');
const { defaultResourceDirectory } = require('./resource-settings.cjs');

function createProjectRuntime({
  projectDir,
  domain,
  directory,
  environment = process.env,
  registry = loadRegistry(environment),
}) {
  const packs = (registry.runtimePacks || []).filter(pack => pack.domain === domain);
  if (packs.length > 1) throw Error('A project must resolve exactly one trusted Domain Runtime.');
  const pack = packs[0];
  const root = pack && fs.realpathSync(pack.directory);
  const entry = pack && fs.realpathSync(path.join(root, pack.runtime.entry));
  if (entry && !entry.startsWith(root + path.sep))
    throw Error('Runtime entry escaped the verified Pack.');
  // A verified same-version repair can replace entry/helpers at the same
  // pathname. New project runtimes must execute the current verified bytes.
  // Existing runtime instances and shared Core/npm modules remain untouched.
  if (root)
    for (const cached of Object.keys(require.cache))
      if (cached.startsWith(root + path.sep)) delete require.cache[cached];
  const plugin = entry ? require(entry).createRuntimePlugin({ environment }) : {};
  const protectedPaths = [
    root,
    directory,
    ...(plugin.protectedPaths || []),
    ...(plugin.workspaceProtectedPaths?.(projectDir) || []),
  ].filter(Boolean);
  let stateDiagnostics = [];
  const workspace = createWorkspacePlugin({
    domain,
    environment,
    protectedPaths,
    inspectionDiagnostics: () => stateDiagnostics,
  });
  const externalRegistry = new ExternalMcpRegistry(defaultResourceDirectory(environment));
  const externalServers = externalRegistry.records();
  const externalRevision = JSON.stringify(
    externalServers.map(server => [server.id, server.revision]),
  );
  const external = createExternalRuntimePlugin({
    servers: externalServers,
    environment,
    registry: externalRegistry,
  });
  const matches = () => !plugin.matchesProject || plugin.matchesProject(projectDir);
  const stateProvider = async context => {
    const common = await workspace.stateProvider(context);
    if (!plugin.stateProvider || !matches()) return common;
    let observed;
    try {
      observed = await plugin.stateProvider(context);
      stateDiagnostics = [];
    } catch (error) {
      stateDiagnostics = [String(error.message).slice(0, 4096)];
      return common;
    }
    return { ...observed, inputHashes: { ...common.inputHashes, ...observed.inputHashes } };
  };
  const runtime = new IndustrialRuntime(projectDir, domain, {
    directory,
    stateProvider,
    tools: [...workspace.tools, ...(plugin.tools || []), ...external.tools],
    verifiers: { ...workspace.verifiers, ...(plugin.verifiers || {}), ...external.verifiers },
    dispose: () => Promise.all([external.dispose(), plugin.dispose?.()]),
    releaseOwner: ownerId =>
      Promise.all([external.releaseOwner(ownerId), plugin.releaseOwner?.(ownerId)]),
  });
  protectedPaths.push(runtime.directory);
  return {
    runtime,
    configurationCurrent: () =>
      externalRevision ===
      JSON.stringify(externalRegistry.records().map(server => [server.id, server.revision])),
    get stateDiagnostics() {
      return stateDiagnostics;
    },
    get capabilities() {
      return [...workspace.capabilities, ...(matches() ? plugin.capabilities || [] : [])];
    },
    protectedPaths: [...protectedPaths, runtime.directory],
    packId: pack?.id || 'project-workspace',
    packVersion: pack?.version || '1.0.0',
  };
}
module.exports = { createProjectRuntime };
