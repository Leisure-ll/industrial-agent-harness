const fs = require('node:fs');
const path = require('node:path');
const {
  builtInPackDirectory,
  packGatewayAdapter,
} = require('@industrial-agent-harness/domain-skills');
function registered(provider) {
  return {
    ...provider,
    installedDirectory: provider.installedDirectory || builtInPackDirectory(provider),
  };
}
function providerRuntime(provider, environment = process.env) {
  const resource = registered(provider);
  return packGatewayAdapter(resource).providerRuntime(resource, environment);
}
function gatewayConfig(directory, provider, projectDir, environment, options = {}) {
  if (!projectDir || !path.isAbsolute(projectDir))
    throw Error('Domain MCP requires an explicit absolute project directory.');
  const project = fs.realpathSync(projectDir);
  if (!fs.statSync(project).isDirectory()) throw Error('Domain MCP project must be a directory.');
  const resource = registered(provider);
  return packGatewayAdapter(resource).gatewayConfig(directory, resource, project, environment, {
    ...options,
    gatewayScript: path.join(__dirname, 'gateway.py'),
  });
}
module.exports = { providerRuntime, gatewayConfig };
