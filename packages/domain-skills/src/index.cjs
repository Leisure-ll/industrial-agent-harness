const {distributionDomain} = require('./distribution.cjs');
const {loadDomainPacks} = require('./packs.cjs');
const domainPacks = loadDomainPacks();
const capabilities = [...require('./capabilities.cjs'), ...require('./skill-only-packs.cjs').loadSkillOnlyPacks().flatMap(pack => pack.capabilities), ...domainPacks.flatMap(pack => pack.capabilities)].filter(item => !distributionDomain || item.domain === distributionDomain);
const {listDomains} = require('./domains.cjs');
const {listSkills, materializeSkills} = require('./registry.cjs');
const {loadRegistry, installedSkills, materializeInstalledSkills} = require('./installed.cjs');

module.exports = {capabilities, listDomains, listSkills: installedSkills, materializeSkills: materializeInstalledSkills, domainPacks, loadRegistry, distributionDomain, ...require('./pack-resources.cjs')};
