// Derive this turn's resources; leave saved user preferences intact.
function executionPolicy(runtime, plugins, protectedIndustrial) {
  if (!protectedIndustrial) return { runtime, plugins, excluded: null };
  const disabled = new Set(runtime.disabledMcpServers || []);
  const excluded = {
    externalMcp: (runtime.externalServers || [])
      .filter(server => !disabled.has(server.id))
      .map(server => server.id),
    plugins: (plugins || [])
      .filter(plugin => plugin?.enabled?.() === true)
      .map(plugin => plugin.name),
  };
  return {
    runtime: { ...runtime, externalServers: [] },
    plugins: [],
    excluded: excluded.externalMcp.length || excluded.plugins.length ? excluded : null,
  };
}
module.exports = { executionPolicy };
