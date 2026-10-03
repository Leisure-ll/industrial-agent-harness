const fs = require('node:fs');
const path = require('node:path');

function loadSkillOnlyPacks() {
  const directory = path.join(__dirname, '..', 'skill-only-packs');
  const files = fs
    .readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .sort();
  const domains = new Set();
  const capabilities = new Set();
  return files.map(file => {
    const pack = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    if (
      pack.schemaVersion !== 1 ||
      !/^[a-z][a-z0-9-]*$/.test(pack.domain) ||
      domains.has(pack.domain) ||
      !Array.isArray(pack.capabilities) ||
      !pack.capabilities.length
    )
      throw Error('Invalid skill-only Domain Pack.');
    domains.add(pack.domain);
    for (const capability of pack.capabilities) {
      if (
        capability.domain !== pack.domain ||
        !capability.id ||
        capabilities.has(capability.id) ||
        !Array.isArray(capability.skills) ||
        !capability.skills.length ||
        !Array.isArray(capability.tools) ||
        capability.tools.length ||
        !Array.isArray(capability.verification)
      )
        throw Error('Invalid skill-only capability.');
      capabilities.add(capability.id);
    }
    return pack;
  });
}

module.exports = { loadSkillOnlyPacks };
