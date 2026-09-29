const {distributionDomain} = require('./distribution.cjs');
const {loadDomainPacks} = require('./packs.cjs');
const domainPacks = loadDomainPacks();
const capabilities = [...require('./capabilities.cjs'), ...domainPacks.flatMap(pack => pack.capabilities)].filter(item => !distributionDomain || item.domain === distributionDomain);
const {listDomains} = require('./domains.cjs');
const {listSkills, materializeSkills} = require('./registry.cjs');

module.exports = {capabilities, listDomains, listSkills, materializeSkills, domainPacks, distributionDomain, ...require('./pack-resources.cjs')};
