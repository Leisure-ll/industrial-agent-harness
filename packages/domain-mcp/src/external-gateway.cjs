const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Server} = require('@modelcontextprotocol/sdk/server/index.js');
const {StdioServerTransport} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {ListToolsRequestSchema, CallToolRequestSchema} = require('@modelcontextprotocol/sdk/types.js');
const {connectExternal, toolSnapshot, schemaValidator, hash, externalSecrets, REQUEST_TIMEOUT} = require('./external-client.cjs');

const MAX_TEXT = 16 * 1024, MAX_CACHE = 8 * 1024 * 1024, MAX_IMAGES = 8 * 1024 * 1024;
const annotations = {readOnlyHint: true, destructiveHint: false, openWorldHint: false};
const tool = (name, description, properties = {}, required = [], mutating = false) => ({name, description, inputSchema: {type: 'object', properties, required, additionalProperties: false}, annotations: mutating ? {readOnlyHint: false, destructiveHint: true, openWorldHint: true} : annotations});
const string = {type: 'string'}, integer = (minimum, maximum) => ({type: 'integer', minimum, maximum});
const gatewayTools = [
  tool('external_tool_list', 'List a compact page of registered external tool IDs in the current Broker scope. External services may control host apps outside the project.', {providerId: string, offset: integer(0, 512), limit: integer(1, 20)}),
  tool('external_tool_describe', 'Read the pinned input schema of one allowed external tool.', {toolId: string}, ['toolId']),
  tool('external_tool_call', 'Call one allowed external tool. All external calls need caller approval; server readOnly hints do not grant permission. Results are unverified external observations. Never automatically repeat a failed or timed-out mutation.', {toolId: string, arguments: {type: 'object'}}, ['toolId', 'arguments'], true),
  tool('external_tool_result_read', 'Read a character page of a large response cached by this live external gateway.', {responseId: string, offset: integer(0, MAX_CACHE), limit: integer(1, 8000)}, ['responseId']),
];

function writeExternalGateway(directory, selected, projectDir, environment = process.env) {
  if (!path.isAbsolute(projectDir || '') || !fs.statSync(projectDir).isDirectory()) throw Error('External MCP requires a bound absolute project directory.');
  const project = fs.realpathSync(projectDir);
  const policyFile = path.join(directory, 'external-mcp.policy.json');
  // Resolve only explicitly requested environment references, never the model key or full host environment.
  const servers = selected.map(server => {
    const config = structuredClone(server.config);
    for (const [values, references] of [['env', 'envRefs'], ['headers', 'headerEnv']]) {
      for (const [key, name] of Object.entries(config[references] || {})) {
        if (typeof environment[name] !== 'string' || !environment[name]) throw Error(`Set ${name} for MCP service ${server.id}.`);
        config[values][key] = environment[name];
      }
      config[references] = {};
    }
    return {...server, config};
  });
  const policy = {schemaVersion: 1, projectDir: project, servers, cacheDir: path.join(directory, 'external-mcp-results')};
  fs.writeFileSync(policyFile, JSON.stringify(policy), {mode: 0o600}); fs.chmodSync(policyFile, 0o600);
  return {command: process.execPath, args: [__filename, policyFile], env: {ELECTRON_RUN_AS_NODE: '1'}};
}

function createExternalGateway(policy) {
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.servers) || policy.servers.length > 16) throw Error('Invalid external MCP policy.');
  const project = fs.realpathSync(policy.projectDir);
  const allowed = new Map(), providers = new Map();
  for (const provider of policy.servers) {
    if (providers.has(provider.id) || hash(provider.tools) !== provider.surfaceHash) throw Error('Invalid external MCP tool snapshot.');
    providers.set(provider.id, provider);
    const ids = new Set(provider.allowedToolIds);
    if (!ids.size || [...ids].some(id => !provider.tools.some(tool => tool.id === id))) throw Error('Invalid external Broker scope.');
    for (const descriptor of provider.tools) if (ids.has(descriptor.id)) {
      if (allowed.has(descriptor.id)) throw Error('Duplicate external canonical Tool ID.');
      allowed.set(descriptor.id, {provider, descriptor, validate: schemaValidator(descriptor.schema)});
    }
  }
  const connections = new Map(), cache = new Map(); let cacheBytes = 0;
  const secrets = externalSecrets(policy.servers);
  fs.mkdirSync(policy.cacheDir, {recursive: true, mode: 0o700}); fs.chmodSync(policy.cacheDir, 0o700);
  for (const file of fs.readdirSync(policy.cacheDir)) if (/^[0-9a-f-]+\.json$/.test(file)) fs.rmSync(path.join(policy.cacheDir, file));
  function checkProject() {if (fs.realpathSync(policy.projectDir) !== project || !fs.statSync(project).isDirectory()) throw Error('Bound project directory changed. Reconnect the external gateway.');}
  function requireTool(id) {const selected = allowed.get(id); if (!selected) throw Error('External tool is outside the current Broker scope.'); return selected;}
  function bounded(value) {
    const text = JSON.stringify(value, (_key, item) => typeof item === 'string' ? secrets.reduce((result, secret) => result.replaceAll(secret, '[REDACTED_MCP_CREDENTIAL]'), item) : item);
    const size = Buffer.byteLength(text);
    if (size <= MAX_TEXT) return text;
    if (size > MAX_CACHE) throw Error('External response exceeds 8 MiB. Mutation outcome may be unknown; inspect the service before retrying.');
    while (cacheBytes + size > MAX_CACHE && cache.size) {
      const id = cache.keys().next().value, old = cache.get(id); cache.delete(id); fs.rmSync(old.file); cacheBytes -= old.bytes;
    }
    const responseId = crypto.randomUUID(), file = path.join(policy.cacheDir, responseId + '.json');
    const entry = {file, bytes: size, characters: text.length, sha256: crypto.createHash('sha256').update(text).digest('hex')};
    fs.writeFileSync(file, text, {mode: 0o600, flag: 'wx'}); cache.set(responseId, entry); cacheBytes += size;
    return JSON.stringify({responseId, bytes: size, characters: text.length, sha256: entry.sha256, paged: true, nextStep: 'Use external_tool_result_read. Images, if any, are returned separately.'});
  }
  async function verifySurface(provider, connected) {
    const tools = [], cursors = new Set(); let cursor;
    do {
      const page = await connected.client.listTools(cursor ? {cursor} : undefined, {timeout: 10000});
      tools.push(...page.tools); cursor = page.nextCursor;
      if (tools.length > 128 || (cursor && cursors.has(cursor)) || cursors.size > 32) throw Error('External tool list changed. Refresh this service in MCP settings.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (hash(toolSnapshot(provider.id, tools)) !== provider.surfaceHash) throw Error('External tool schemas changed. Refresh this service in MCP settings before invoking it.');
  }
  async function connection(provider) {
    if (!connections.has(provider.id)) {
      const pending = connectExternal(provider, project);
      connections.set(provider.id, pending);
      pending.catch(() => {if (connections.get(provider.id) === pending) connections.delete(provider.id);});
    }
    return connections.get(provider.id);
  }
  function resultContent(result, context) {
    let imageBytes = 0;
    const images = result.content.filter(part => part.type === 'image');
    if (images.length > 4) throw Error('External response exceeds four images. Request a narrower screenshot.');
    for (const part of images) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(part.mimeType) || typeof part.data !== 'string' || part.data.length > 12 * 1024 * 1024) throw Error('Unsupported or oversize external image.');
      const decoded = Buffer.from(part.data, 'base64');
      if (decoded.toString('base64') !== part.data || (imageBytes += decoded.length) > MAX_IMAGES) throw Error('External images exceed 8 MiB or contain invalid base64.');
    }
    const nonImages = result.content.filter(part => part.type !== 'image');
    const value = {...context, content: nonImages, ...(result.structuredContent !== undefined ? {structuredContent: result.structuredContent} : {}), isError: Boolean(result.isError)};
    return {content: [{type: 'text', text: bounded(value)}, ...images], ...(result.isError ? {isError: true} : {})};
  }
  const validators = new Map(gatewayTools.map(tool => [tool.name, schemaValidator(tool.inputSchema)]));
  const server = new Server({name: 'Industrial External MCP Gateway', version: '0.1.0'}, {capabilities: {tools: {}}, instructions: 'Discover external_tool_list, describe a selected tool, then invoke it through external_tool_call. These are user-registered host services, not industrial verification. Project roots are context, not an OS sandbox. Never automatically retry an uncertain mutation.'});
  server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: gatewayTools}));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      checkProject();
      const args = request.params.arguments || {}, validate = validators.get(request.params.name);
      if (!validate || !validate(args) || Buffer.byteLength(JSON.stringify(args)) > 65536) throw Error('Invalid external gateway arguments.');
      switch (request.params.name) {
        case 'external_tool_list': {
          const rows = [...allowed.values()].filter(({provider}) => !args.providerId || provider.id === args.providerId).map(({provider, descriptor}) => ({providerId: provider.id, toolId: descriptor.id, name: descriptor.name, summary: descriptor.summary, risk: 'mutating'}));
          const offset = args.offset || 0, limit = args.limit || 12;
          return {content: [{type: 'text', text: bounded({tools: rows.slice(offset, offset + limit), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null})}]};
        }
        case 'external_tool_describe': {
          const {provider, descriptor} = requireTool(args.toolId);
          return {content: [{type: 'text', text: bounded({providerId: provider.id, toolId: descriptor.id, name: descriptor.name, description: descriptor.description, inputSchema: descriptor.schema, risk: 'mutating', verificationStatus: 'not_run', projectDir: project})}]};
        }
        case 'external_tool_call': {
          const {provider, descriptor, validate} = requireTool(args.toolId);
          if (!validate(args.arguments)) throw Error('Arguments do not match the pinned external tool schema.');
          const connected = await connection(provider);
          await verifySurface(provider, connected);
          let result;
          try {result = await connected.client.callTool({name: descriptor.name, arguments: args.arguments}, undefined, {timeout: REQUEST_TIMEOUT});}
          catch {throw Error('External call failed or timed out; mutation outcome may be unknown. Inspect the service before retrying. No automatic resubmission.');}
          const content = resultContent(result, {providerId: provider.id, toolId: descriptor.id, projectDir: project, verificationStatus: 'not_run'});
          for (const part of content.content) if (part.type === 'text') part.text = connected.redact(part.text);
          return content;
        }
        case 'external_tool_result_read': {
          const entry = cache.get(args.responseId);
          if (!entry) throw Error('Invalid or expired external response ID.');
          const raw = fs.readFileSync(entry.file, 'utf8');
          if (crypto.createHash('sha256').update(raw).digest('hex') !== entry.sha256) throw Error('Cached external response changed.');
          const offset = args.offset || 0; let text = raw.slice(offset, offset + (args.limit || 8000));
          while (Buffer.byteLength(JSON.stringify(text)) > MAX_TEXT - 1024) text = text.slice(0, Math.floor(text.length / 2));
          return {content: [{type: 'text', text: JSON.stringify({responseId: args.responseId, offset, nextOffset: offset + text.length < raw.length ? offset + text.length : null, characters: entry.characters, bytes: entry.bytes, sha256: entry.sha256, text})}]};
        }
      }
    } catch (error) {
      const message = secrets.reduce((result, secret) => result.replaceAll(secret, '[REDACTED_MCP_CREDENTIAL]'), String(error.message));
      return {content: [{type: 'text', text: message.slice(0, 2048)}], isError: true};
    }
  });
  async function close() {await Promise.allSettled([...connections.values()].map(async pending => (await pending).close()));}
  server.onclose = () => {void close();};
  return {server, close};
}

if (require.main === module) {
  (async () => {
    const file = process.argv[2];
    if (process.platform !== 'win32' && fs.statSync(file).mode & 0o077) throw Error('External MCP policy must be private.');
    const gateway = createExternalGateway(JSON.parse(fs.readFileSync(file, 'utf8')));
    const shutdown = async () => {await gateway.close(); await gateway.server.close(); process.exit(0);};
    process.once('SIGTERM', () => {void shutdown();}); process.once('SIGINT', () => {void shutdown();});
    await gateway.server.connect(new StdioServerTransport());
  })().catch(() => {process.stderr.write('External MCP gateway failed to start. Check its private policy and runtime.\n'); process.exitCode = 1;});
}

module.exports = {writeExternalGateway, createExternalGateway, gatewayTools};
