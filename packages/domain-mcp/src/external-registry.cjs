const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { discoverExternal, toolSnapshot, hash } = require('./external-client.cjs');

const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function stringMap(value = {}, references = false) {
  if (
    !object(value) ||
    Object.keys(value).length > 64 ||
    Object.entries(value).some(
      ([key, item]) =>
        !key ||
        key.length > 128 ||
        typeof item !== 'string' ||
        item.length > 8192 ||
        (references && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item)),
    )
  )
    throw Error('Invalid MCP environment or header configuration.');
  return value;
}
function normalizeConfig(config, directory = process.cwd(), checkDirectory = true) {
  if (!object(config)) throw Error('MCP server configuration must be an object.');
  const remote = typeof config.url === 'string';
  const keys = remote
    ? ['url', 'type', 'transport', 'headers', 'headerEnv']
    : ['command', 'args', 'cwd', 'env', 'envRefs', 'type', 'transport'];
  if (Object.keys(config).some(key => !keys.includes(key)))
    throw Error(
      'Unsupported MCP configuration property. Use command/args or url; credentials may use envRefs/headerEnv.',
    );
  if (remote) {
    let url;
    try {
      url = new URL(config.url);
    } catch {
      throw Error('MCP URL is invalid.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      config.url.length > 4096
    )
      throw Error('MCP URL requires HTTP(S) without embedded credentials.');
    const transport = config.transport || config.type || 'http';
    if (!['http', 'streamable-http', 'sse'].includes(transport))
      throw Error('Unsupported remote MCP transport.');
    const headers = stringMap(config.headers),
      headerEnv = stringMap(config.headerEnv, true);
    for (const name of [...Object.keys(headers), ...Object.keys(headerEnv)])
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(headers[name] || ''))
        throw Error('Invalid MCP header.');
    return {
      transport: transport === 'streamable-http' ? 'http' : transport,
      url: url.href,
      headers,
      headerEnv,
    };
  }
  if (
    typeof config.command !== 'string' ||
    !config.command.trim() ||
    config.command.length > 4096 ||
    /[\r\n\0]/.test(config.command) ||
    !Array.isArray(config.args || []) ||
    (config.args || []).length > 128 ||
    (config.args || []).some(
      arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'),
    ) ||
    (config.transport || config.type || 'stdio') !== 'stdio'
  )
    throw Error('Invalid local MCP command or arguments.');
  const cwd = config.cwd || directory;
  if (
    typeof cwd !== 'string' ||
    !path.isAbsolute(cwd) ||
    (checkDirectory && !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory())
  )
    throw Error('MCP working directory must be an existing absolute directory.');
  const env = stringMap(config.env),
    envRefs = stringMap(config.envRefs, true);
  if (
    [...Object.keys(env), ...Object.keys(envRefs)].some(
      key => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
    )
  )
    throw Error('Invalid MCP environment variable name.');
  return {
    transport: 'stdio',
    command: config.command,
    args: config.args || [],
    cwd: checkDirectory ? fs.realpathSync(cwd) : cwd,
    env,
    envRefs,
  };
}
function publicServer(server) {
  return {
    id: server.id,
    title: server.title,
    domain: 'all',
    transport: server.config.transport,
    toolCount: server.tools.length,
    checkedAt: server.checkedAt,
    enabledByDefault: true,
    external: true,
  };
}

class ExternalMcpRegistry {
  constructor(
    directory = process.env.INDUSTRIAL_HARNESS_CONFIG_DIR ||
      path.join(os.homedir(), '.industrial-agent-harness'),
  ) {
    this.file = path.join(directory, 'external-mcp.json');
  }
  records() {
    if (!fs.existsSync(this.file)) return [];
    let saved;
    try {
      if (fs.statSync(this.file).size > 8 * 1024 * 1024) throw Error('Oversize registry');
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.schemaVersion !== 1 || !Array.isArray(saved.servers) || saved.servers.length > 16)
        throw Error('Invalid registry');
      const ids = new Set();
      let toolCount = 0;
      for (const server of saved.servers) {
        if (
          !/^external\.[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(server.id) ||
          ids.has(server.id) ||
          typeof server.title !== 'string' ||
          !server.revision ||
          !server.checkedAt
        )
          throw Error('Invalid server');
        ids.add(server.id);
        const config = normalizeConfig(server.config, undefined, false);
        if (JSON.stringify(config) !== JSON.stringify(server.config))
          throw Error('Invalid normalized configuration');
        const tools = toolSnapshot(
          server.id,
          server.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.schema,
            outputSchema: tool.outputSchema,
            annotations: tool.annotations,
          })),
        );
        if (
          hash(tools) !== server.surfaceHash ||
          JSON.stringify(tools) !== JSON.stringify(server.tools) ||
          (toolCount += tools.length) > 512
        )
          throw Error('Invalid tool snapshot');
      }
      return saved.servers;
    } catch {
      throw Error(
        'Cannot read external MCP registry. Fix external-mcp.json before changing or running registered services.',
      );
    }
  }
  list() {
    return this.records().map(publicServer);
  }
  update(change) {
    const directory = path.dirname(this.file);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const lock = `${this.file}.lock`;
    let fd;
    try {
      fd = fs.openSync(lock, 'wx', 0o600);
    } catch {
      throw Error(
        'External MCP registry is being updated. Retry when the other configuration operation finishes.',
      );
    }
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      const servers = change(this.records());
      if (
        servers.length > 16 ||
        servers.reduce((count, server) => count + server.tools.length, 0) > 512
      )
        throw Error('External MCP registry exceeds 16 services or 512 tools.');
      const contents = JSON.stringify({ schemaVersion: 1, servers }, null, 2);
      if (Buffer.byteLength(contents) > 8 * 1024 * 1024)
        throw Error('External MCP registry exceeds 8 MiB.');
      fs.writeFileSync(temporary, contents + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, this.file);
      return servers.map(publicServer);
    } finally {
      fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
      fs.rmSync(temporary, { force: true });
    }
  }
  async add(configuration, environment = process.env) {
    if (typeof configuration !== 'string' || Buffer.byteLength(configuration) > 256 * 1024)
      throw Error('MCP configuration must be JSON text below 256 KiB.');
    let input;
    try {
      input = JSON.parse(configuration);
    } catch {
      throw Error('MCP configuration is not valid JSON.');
    }
    if (
      !object(input) ||
      Object.keys(input).some(key => key !== 'mcpServers') ||
      !object(input.mcpServers) ||
      !Object.keys(input.mcpServers).length ||
      Object.keys(input.mcpServers).length > 16
    )
      throw Error('Use a JSON object containing mcpServers.');
    const existing = this.records();
    const pending = Object.entries(input.mcpServers).map(([name, config]) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name))
        throw Error(
          'MCP names must use letters, digits, dots, underscores or hyphens (up to 64 characters).',
        );
      const id = `external.${name}`;
      if (existing.some(server => server.id === id))
        throw Error(
          `MCP service ${id} already exists. Remove it to replace configuration, or refresh its tools.`,
        );
      return { id, title: name, config: normalizeConfig(config) };
    });
    if (existing.length + pending.length > 16)
      throw Error('External MCP registry exceeds 16 services.');
    const discovered = [];
    for (const server of pending) {
      const tools = await discoverExternal(server, null, environment);
      discovered.push({
        ...server,
        tools,
        surfaceHash: hash(tools),
        revision: crypto.randomUUID(),
        checkedAt: new Date().toISOString(),
      });
    }
    return this.update(servers => {
      if (discovered.some(server => servers.some(existing => existing.id === server.id)))
        throw Error('MCP registration changed during discovery. Reload settings.');
      return [...servers, ...discovered].sort((a, b) => a.id.localeCompare(b.id));
    });
  }
  async refresh(id, environment = process.env) {
    const selected = this.records().find(server => server.id === id);
    if (!selected) throw Error('Unknown external MCP service.');
    const tools = await discoverExternal(selected, null, environment);
    return this.update(servers => {
      const current = servers.find(server => server.id === id);
      if (!current || current.revision !== selected.revision)
        throw Error('MCP registration changed during discovery. Reload settings.');
      return servers.map(server =>
        server.id === id
          ? {
              ...server,
              tools,
              surfaceHash: hash(tools),
              revision: crypto.randomUUID(),
              checkedAt: new Date().toISOString(),
            }
          : server,
      );
    });
  }
  remove(id) {
    return this.update(servers => {
      if (!servers.some(server => server.id === id)) throw Error('Unknown external MCP service.');
      return servers.filter(server => server.id !== id);
    });
  }
}

module.exports = { ExternalMcpRegistry, normalizeConfig, publicServer };
