const { packGatewayAdapter } = require('@industrial-agent-harness/domain-skills');
module.exports = {
  pcbRuntime: (provider, ...args) =>
    packGatewayAdapter(provider).providerRuntime(provider, ...args),
  pcbGatewayConfig: (directory, provider, ...args) =>
    packGatewayAdapter(provider).gatewayConfig(directory, provider, ...args),
};
