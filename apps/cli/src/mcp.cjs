const fs = require('node:fs');
const path = require('node:path');
const {ExternalMcpRegistry, ResourceSettings, resourceCatalog, defaultResourceDirectory} = require('@industrial-agent-harness/harness-core');

const usage = `industrial-harness mcp list
industrial-harness mcp add --file MCP_CONFIG.json
industrial-harness mcp refresh EXTERNAL_ID
industrial-harness mcp remove EXTERNAL_ID
industrial-harness mcp enable|disable|inherit MCP_ID [--project-dir DIR]

Optional --config-dir DIR applies to every mcp command. Otherwise use
INDUSTRIAL_HARNESS_CONFIG_DIR or ~/.industrial-agent-harness.
Import uses {"mcpServers":{"name":{"command":"...","args":[]}}} or a url.
Add and refresh connect to the user-selected service and discover its tools.
Local commands may start programs; host services can act outside project roots.
Registrations are shared by Desktop and all domain CLI packages.\n`;

async function runMcp(argv, output = process.stdout, environment = process.env) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {output.write(usage); return 0;}
  const command = argv[0];
  if (!['list', 'add', 'refresh', 'remove', 'enable', 'disable', 'inherit'].includes(command)) throw Error('Unknown mcp command. Use mcp --help.');
  let id; const options = {};
  for (let index = 1; index < argv.length; index++) {
    const value = argv[index];
    if (['--file', '--config-dir', '--project-dir'].includes(value)) {
      if (options[value] || !argv[index + 1] || argv[index + 1].startsWith('--')) throw Error('Invalid mcp option.');
      options[value] = argv[++index];
    } else if (!id && !value.startsWith('--')) id = value;
    else throw Error('Invalid mcp argument.');
  }
  const allowedOptions = command === 'add' ? ['--file', '--config-dir'] : ['enable', 'disable', 'inherit'].includes(command) ? ['--config-dir', '--project-dir'] : ['--config-dir'];
  if (Object.keys(options).some(key => !allowedOptions.includes(key)) || (['list', 'add'].includes(command) ? Boolean(id) : !id) || (command === 'add' && !options['--file'])) throw Error('Invalid mcp command arguments. Use mcp --help.');
  const directory = path.resolve(options['--config-dir'] || defaultResourceDirectory(environment));
  const registry = new ExternalMcpRegistry(directory);
  let result;
  if (command === 'list') result = {servers: registry.list()};
  else if (command === 'add') {
    const file = path.resolve(options['--file']);
    if (fs.statSync(file).size > 256 * 1024) throw Error('MCP import file exceeds 256 KiB.');
    result = {servers: await registry.add(fs.readFileSync(file, 'utf8'), environment)};
  } else if (command === 'refresh') result = {servers: await registry.refresh(id, environment)};
  else if (command === 'remove') result = {servers: registry.remove(id)};
  else {
    const project = options['--project-dir'] ? fs.realpathSync(path.resolve(options['--project-dir'])) : undefined;
    if (command === 'inherit' && !project) throw Error('Inherit requires --project-dir.');
    result = {settings: new ResourceSettings(directory).set(resourceCatalog(undefined, registry.records()), {kind: 'mcp', id, mode: command === 'enable' ? 'enabled' : command === 'disable' ? 'disabled' : 'inherit'}, project)};
  }
  output.write(JSON.stringify({schemaVersion: 1, type: 'mcp_registry', command, ...result}) + '\n');
  return 0;
}
module.exports = {runMcp, usage};
