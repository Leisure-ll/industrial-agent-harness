const {ChatStore, defaultChatDirectory} = require('./chat-store.cjs');
const {resolve} = require('@industrial-agent-harness/capability-broker');
const {capabilities, listDomains, listSkills} = require('@industrial-agent-harness/domain-skills');
const {listMcpServers, ExternalMcpRegistry} = require('@industrial-agent-harness/domain-mcp');
const {ResourceSettings, defaultResourceDirectory, effectiveResourcePolicy} = require('./resource-settings.cjs');

function resourceCatalog(domain, external = []) {return {skills: listSkills(domain), mcpServers: listMcpServers(domain, external)};}

function effectiveCapabilities(registry, disabled = {}) {
  const disabledSkills = new Set(disabled.skills || []);
  const disabledMcp = new Set(disabled.mcpServers || []);
  return registry.map(item => {
    const mcpTools = new Set(listMcpServers(item.domain).filter(server => disabledMcp.has(server.id)).flatMap(server => server.toolIds || []));
    return {...item, skills: item.skills.filter(skill => !disabledSkills.has(skill.id)), tools: item.tools.filter(tool => !mcpTools.has(tool.id))};
  });
}

function resolveProjectTask(domain, request, previous, registry = capabilities, disabled = {}, external = [], validDomains = listDomains(registry)) {
  if (!validDomains.some(item => item.id === domain)) throw Error('Choose a valid project domain.');
  if (request?.domain && request.domain !== domain) throw Error(`This project is fixed to the ${domain} domain.`);
  const result = resolve({...request, domain}, effectiveCapabilities(registry, disabled), previous);
  const extensions = external.filter(server => !(disabled.mcpServers || []).includes(server.id));
  if (extensions.length) {
    const tools = extensions.flatMap(server => server.tools.map(tool => tool.id));
    result.scope.tools = [...new Set([...result.scope.tools, ...tools])];
    const replaced = result.trace.find(row => row.event === 'scope.replace');
    if (replaced) replaced.detail.tools = result.scope.tools;
    result.trace.push({level: 'L0', event: 'mcp.external.index', detail: extensions.map(server => ({id: server.id, title: server.title, tools: server.tools.length, scope: 'user-registered host service'}))});
    result.trace.push({level: 'L2', event: 'mcp.external.scope', detail: {tools, reason: 'Explicitly registered general services are available across project domains; details remain deferred.'}});
    result.trace.push({level: 'L3', event: 'mcp.external.deferred', detail: {providers: extensions.length, toolSchemas: tools.length}});
  }
  result.trace.push({level: 'L0', event: 'resource.policy', detail: {disabledSkills: disabled.skills || [], disabledMcpServers: disabled.mcpServers || []}});
  return result;
}

module.exports = {ChatStore, defaultChatDirectory, resolveProjectTask, resourceCatalog, effectiveCapabilities, ResourceSettings, defaultResourceDirectory, effectiveResourcePolicy, ExternalMcpRegistry};
