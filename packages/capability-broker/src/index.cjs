const crypto = require('node:crypto');

function mentionsTool(text, toolId) {
  let offset = text.indexOf(toolId);
  while (offset !== -1) {
    const before = text[offset - 1] || '';
    const after = text[offset + toolId.length] || '';
    if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true;
    offset = text.indexOf(toolId, offset + 1);
  }
  return false;
}

function resolve(request, registry, previous) {
  const {task} = request;
  if (typeof task !== 'string') throw Error('Describe the engineering task first.');
  const text = task.trim().toLowerCase();
  if (!text) throw Error('Describe the engineering task first.');
  const requestedDomain = request.domain || null;
  const requestedStage = request.stage || null;
  const artifactKind = typeof request.artifactKind === 'string' ? request.artifactKind.toLowerCase() : '';
  const trace = [];
  const record = (level, event, detail) => trace.push({level, event, detail});
  const domainCapabilities = registry.filter(item => !requestedDomain || item.domain === requestedDomain);
  record('L0', 'domain.index', {domain: requestedDomain || 'auto', count: domainCapabilities.length});
  const candidates = domainCapabilities.filter(item => !requestedStage || item.stages.includes(requestedStage));
  record('L1', 'capability.index', {stage: requestedStage || 'auto', candidates: candidates.map(item => ({id: item.id, title: item.title}))});
  const scored = candidates.map(item => {
    const hits = item.keywords.filter(word => text.includes(word.toLowerCase()));
    const toolHits = item.tools.filter(tool => {
      const id = tool.id.toLowerCase();
      const shortName = id.split('.').at(-1);
      return mentionsTool(text, id) || (shortName.includes('_') && mentionsTool(text, shortName));
    });
    const artifactMatch = Boolean(artifactKind && item.keywords.some(word => word.toLowerCase() === artifactKind));
    const domainMention = text.includes(item.domain.toLowerCase());
    // A concrete action phrase should outrank several generic domain words.
    const specificity = hits.reduce((total, word) => total + 10 + Math.min(word.trim().length, 20), 0);
    return {item, hits, toolHits, artifactMatch, score: specificity + toolHits.length * 40 + (hits.length && domainMention ? 5 : 0) + (artifactMatch ? 3 : 0)};
  });
  const selected = scored.filter(({score}) => score > 0).sort((a, b) => b.score - a.score || (a.toolHits.length && b.toolHits.length ? a.item.tools.length - b.item.tools.length : 0) || b.item.priority - a.item.priority || a.item.id.localeCompare(b.item.id)).slice(0, requestedDomain && requestedStage ? 3 : 1);
  record('L1', 'capability.resolve', {selected: selected.map(({item, hits, toolHits, artifactMatch}) => ({id: item.id, reason: `task: ${hits.join(', ') || 'none'}; tools: ${toolHits.map(tool => tool.id).join(', ') || 'none'}; artifact: ${artifactMatch ? artifactKind : 'none'}`})), excluded: scored.filter(({score}) => !score).map(({item}) => ({id: item.id, reason: 'no task, tool or artifact match'}))});
  const domain = selected[0]?.item.domain ?? requestedDomain;
  const stage = selected.length ? (requestedStage || selected[0].item.stages.find(value => text.includes(value.toLowerCase())) || selected[0].item.stages[0]) : requestedStage;
  if (!requestedDomain || !requestedStage) record('L1', 'context.infer', {domain, stage, artifactKind: artifactKind || null, source: selected[0]?.hits.length ? 'task' : selected[0]?.toolHits.length ? 'tool' : selected.length ? 'artifact' : 'none'});
  const skills = [...new Set(selected.flatMap(({item}) => item.skills.map(skill => skill.id)))];
  const tools = [...new Set(selected.flatMap(({item}) => item.tools.map(tool => tool.id)))];
  const scope = {version: crypto.randomUUID(), domain, stage, capabilityIds: selected.map(({item}) => item.id), skills, tools};
  record('L2', 'scope.replace', {previous: previous?.version ?? null, current: scope.version, skills, tools});
  if (selected.length) record('L2', 'skill.batch', selected.flatMap(({item}) => item.skills.map(skill => ({capability: item.id, id: skill.id, summary: skill.summary}))));
  if (selected.length) record('L2', 'tool.scope', selected.flatMap(({item}) => item.tools.map(tool => ({capability: item.id, id: tool.id, summary: tool.summary}))));
  record('L3', 'detail.deferred', {skillReferences: skills.length, toolSchemas: tools.length, reason: 'Load only on selected capability/tool invocation.'});
  const contexts = [...new Map(registry.flatMap(item => item.stages.map(value => [`${item.domain}:${value}`, {domain: item.domain, stage: value}]))).values()];
  return {scope, trace, matches: selected.map(({item}) => ({id: item.id, title: item.title})), contexts};
}

function discloseDetail(scope, registry, capabilityId) {
  if (!scope.capabilityIds.includes(capabilityId)) throw Error('Capability is outside the current scope.');
  const item = registry.find(entry => entry.id === capabilityId && entry.domain === scope.domain && entry.stages.includes(scope.stage));
  if (!item) throw Error('Capability is unavailable.');
  return {capability: item.id, skills: item.skills, tools: item.tools, verification: item.verification};
}

function assertToolAllowed(scope, toolId) {
  if (!scope || !scope.tools.includes(toolId)) throw Error(`Tool ${toolId} is outside the current scope.`);
}

module.exports = {resolve, discloseDetail, assertToolAllowed};
