const crypto = require('node:crypto');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
const {StreamableHTTPClientTransport} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {SSEClientTransport} = require('@modelcontextprotocol/sdk/client/sse.js');
const {ListRootsRequestSchema} = require('@modelcontextprotocol/sdk/types.js');
const Ajv = require('ajv');
const Ajv2020 = require('ajv/dist/2020.js');

const MAX_TOOLS = 128;
const REQUEST_TIMEOUT = 30000;
const credentialName = /token|secret|password|authorization|api.?key|credential/i;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function schemaValidator(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'object' || Buffer.byteLength(JSON.stringify(schema)) > 32768) throw Error('MCP tools require a bounded object input schema.');
  const Engine = schema.$schema?.includes('draft-07') ? Ajv : Ajv2020;
  return new Engine({strict: false, validateFormats: false, allErrors: false}).compile(schema);
}

function toolSnapshot(id, tools) {
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw Error('MCP service exceeds the 128-tool limit.');
  const names = new Set();
  return tools.map(tool => {
    if (typeof tool.name !== 'string' || !tool.name || tool.name.length > 128 || names.has(tool.name)) throw Error('MCP tool names must be unique and bounded.');
    names.add(tool.name);
    schemaValidator(tool.inputSchema);
    const description = typeof tool.description === 'string' ? tool.description : '';
    if (description.length > 16384) throw Error('MCP tool description is too large.');
    return {id: `${id}.${hash(tool.name).slice(0, 16)}`, name: tool.name, summary: (description || tool.name).slice(0, 240), description, schema: tool.inputSchema, ...(tool.outputSchema ? {outputSchema: tool.outputSchema} : {}), ...(tool.annotations ? {annotations: tool.annotations} : {}), risk: 'mutating', verification: ['external-result-unverified']};
  }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function environmentValues(values, references, environment) {
  const result = {...values};
  for (const [key, name] of Object.entries(references || {})) {
    if (typeof environment[name] !== 'string' || !environment[name]) throw Error(`Set the ${name} environment variable required by this MCP service.`);
    result[key] = environment[name];
  }
  return result;
}

function externalSecrets(servers, environment = process.env) {
  return servers.flatMap(({config}) => [
    ...Object.entries(config.env || {}).filter(([key]) => credentialName.test(key)).map(([, value]) => value),
    ...Object.entries(config.envRefs || {}).filter(([key, name]) => credentialName.test(key) || credentialName.test(name)).map(([, name]) => environment[name]),
    ...Object.values(config.headers || {}), ...Object.values(config.headerEnv || {}).map(name => environment[name]),
    ...(config.url ? [...new URL(config.url).searchParams].filter(([key]) => credentialName.test(key)).map(([, value]) => value) : []),
  ]).filter(value => typeof value === 'string' && value.length >= 4);
}

async function connectExternal(server, projectDir, environment = process.env) {
  const config = server.config;
  const client = new Client({name: 'industrial-harness-external', version: '0.1.0'}, {capabilities: {roots: {listChanged: false}}});
  client.setRequestHandler(ListRootsRequestSchema, async () => ({roots: projectDir ? [{uri: pathToFileURL(projectDir).href, name: path.basename(projectDir)}] : []}));
  const secrets = externalSecrets([server], environment);
  const redact = text => secrets.reduce((result, secret) => result.replaceAll(secret, '[REDACTED]'), String(text));
  let transport;
  if (config.transport === 'stdio') {
    transport = new StdioClientTransport({command: config.command, args: config.args, cwd: config.cwd, env: environmentValues(config.env, config.envRefs, environment), stderr: 'pipe', maxBufferSize: 16 * 1024 * 1024});
    transport.stderr?.resume();
  } else {
    const headers = environmentValues(config.headers, config.headerEnv, environment);
    const options = {requestInit: {headers, redirect: 'error'}};
    transport = config.transport === 'sse' ? new SSEClientTransport(new URL(config.url), options) : new StreamableHTTPClientTransport(new URL(config.url), {...options, reconnectionOptions: {maxRetries: 0}});
  }
  client.onerror = () => {};
  try {
    await client.connect(transport, {timeout: 10000});
    return {client, close: () => client.close(), redact};
  } catch {
    await client.close().catch(() => {});
    throw Error(`MCP service ${server.id} is unavailable. Check its launch command, URL, credentials and system permissions.`);
  }
}

async function discoverExternal(server, projectDir, environment) {
  const connection = await connectExternal(server, projectDir, environment);
  try {
    const tools = [], cursors = new Set();
    let cursor;
    do {
      const page = await connection.client.listTools(cursor ? {cursor} : undefined, {timeout: 10000});
      tools.push(...page.tools);
      if (tools.length > MAX_TOOLS) throw Error('MCP service exceeds the 128-tool limit.');
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw Error('MCP service repeated a tool-list cursor.');
      if (cursor) cursors.add(cursor);
      if (cursors.size > 32) throw Error('MCP tool discovery exceeds the page limit.');
    } while (cursor);
    return toolSnapshot(server.id, tools);
  } catch (error) {throw Error(connection.redact(error.message));}
  finally {await connection.close();}
}

module.exports = {connectExternal, discoverExternal, toolSnapshot, schemaValidator, externalSecrets, hash, REQUEST_TIMEOUT};
