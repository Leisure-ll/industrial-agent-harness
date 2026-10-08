const { packGatewayAdapter } = require('@industrial-agent-harness/domain-skills');
module.exports = {
  godotRuntime: (provider, ...args) =>
    packGatewayAdapter(provider).providerRuntime(provider, ...args),
  godotGatewayConfig: (directory, provider, ...args) =>
    packGatewayAdapter(provider).gatewayConfig(directory, provider, ...args),
};
