// Derive this turn's resources; leave saved user preferences intact.
function executionPolicy(runtime, plugins, protectedIndustrial, externalRuntimeIds = []) {
  if (!protectedIndustrial) return { runtime, plugins, excluded: null };
  const disabled = new Set(runtime.disabledMcpServers || []);
  const allowed = new Set(externalRuntimeIds);
  const hosted = (runtime.externalServers || []).filter(server =>
    server.tools.every(tool => allowed.has(tool.id)),
  );
  const excluded = {
    externalMcp: (runtime.externalServers || [])
      .filter(server => !disabled.has(server.id))
      .filter(server => !hosted.includes(server))
      .map(server => server.id),
    plugins: (plugins || [])
      .filter(plugin => plugin?.enabled?.() === true)
      .map(plugin => plugin.name),
  };
  return {
    runtime: { ...runtime, externalServers: hosted, hostRuntimeExternal: true },
    plugins: [],
    excluded: excluded.externalMcp.length || excluded.plugins.length ? excluded : null,
  };
}
module.exports = { executionPolicy };
