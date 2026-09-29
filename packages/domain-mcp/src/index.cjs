const fs = require('node:fs');
const path = require('node:path');
const {domainPacks} = require('@industrial-agent-harness/domain-skills');
const {gatewayConfig, providerRuntime} = require('./gateway.cjs');

const servers = Object.freeze(domainPacks.map(pack => ({...pack.provider, toolIds: pack.provider.tools.map(tool => tool.id)})));

function listMcpServers(domain) {
  return servers.filter(item => !domain || item.domain === domain).map(({config, tools, sourceFiles, ...item}) => ({...item, enabledByDefault: true}));
}

function selectMcpServers(scope, disabledIds = [], registry = servers) {
  const disabled = new Set(disabledIds);
  return registry.filter(item => item.domain === scope.domain && !disabled.has(item.id) && item.toolIds.length > 0 && (item.transport === 'gateway' ? item.toolIds.some(id => scope.tools.includes(id)) : item.toolIds.every(id => scope.tools.includes(id))))
    .map(item => item.transport === 'gateway' ? {...item, allowedToolIds: item.toolIds.filter(id => scope.tools.includes(id))} : item);
}

function writeMcpConfig(shareDir, selected, options = {}) {
  const mcpServers = Object.fromEntries(selected.map(item => [item.id, item.transport === 'gateway' ? gatewayConfig(shareDir, item, options.projectDir, options.environment, options) : item.config]));
  const file = path.join(shareDir, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({mcpServers}, null, 2), {mode: 0o600});
  fs.chmodSync(file, 0o600);
  return file;
}

function selectedRuntimeKey(scope, disabledIds, environment) {
  return selectMcpServers(scope, disabledIds).map(provider => ({id: provider.id, version: provider.version, allowedToolIds: provider.allowedToolIds, ...(provider.transport === 'gateway' ? providerRuntime(provider, environment) : {config: provider.config})}));
}
module.exports = {listMcpServers, selectMcpServers, writeMcpConfig, selectedRuntimeKey};
