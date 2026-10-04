const fs = require('node:fs');
const path = require('node:path');
const { validateProfile, sessionEnv } = require('../packages/agent-kimi/src/model-config.cjs');

function readProfile(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    !value.apiKeyEnv ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.apiKeyEnv) ||
    !value.kimiExecutable ||
    !value.configurationId
  )
    throw Error(
      'Freeze configurationId, apiKeyEnv, and kimiExecutable in the shared model profile.',
    );
  if (Object.hasOwn(value, 'apiKey')) throw Error('API keys belong in the environment.');
  const profile = validateProfile(value);
  const apiKey = process.env[value.apiKeyEnv];
  const executable = fs.realpathSync(path.resolve(path.dirname(file), value.kimiExecutable));
  return {
    profile,
    apiKeyEnv: value.apiKeyEnv,
    executable,
    env: sessionEnv(profile, apiKey),
    configurationId: value.configurationId,
  };
}
module.exports = { readProfile };
