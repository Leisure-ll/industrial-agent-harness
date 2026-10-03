const fs = require('node:fs');
const path = require('node:path');
const { PackManager } = require('@industrial-agent-harness/pack-manager');
const { distributionDomain } = require('./distribution.cjs');
const staticCapabilities = require('./capabilities.cjs');
const { loadDomainPacks } = require('./packs.cjs');
const { loadSkillOnlyPacks } = require('./skill-only-packs.cjs');
const staticSkills = require('./registry.cjs');
const { listDomains } = require('./domains.cjs');

function loadRegistry() {
  if (!process.env.INDUSTRIAL_HARNESS_PACK_STORE) {
    const providerPacks = loadDomainPacks();
    const capabilities = [
      ...staticCapabilities,
      ...loadSkillOnlyPacks().flatMap(pack => pack.capabilities),
      ...providerPacks.flatMap(pack => pack.capabilities),
    ].filter(item => !distributionDomain || item.domain === distributionDomain);
    return {
      domains: listDomains(capabilities),
      capabilities,
      skills: staticSkills
        .listSkills()
        .map(item => ({ ...item, file: staticSkills.skillFile(item.id) })),
      providerPacks,
    };
  }
  const bundles = new PackManager()
    .list()
    .filter(bundle => !distributionDomain || bundle.domain === distributionDomain);
  const domains = bundles
    .map(bundle => ({ id: bundle.domain, label: bundle.label, emoji: bundle.emoji }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const capabilities = bundles.flatMap(bundle => bundle.capabilities);
  const skills = bundles.flatMap(bundle =>
    bundle.skills.map(skill => ({
      id: skill.id,
      domain: skill.domain,
      title: skill.title,
      enabledByDefault: true,
      file: path.join(bundle.location, ...skill.file.split('/')),
    })),
  );
  const providerPacks = bundles.flatMap(bundle =>
    bundle.providerPacks.map(pack => ({
      ...pack,
      provider: {
        ...pack.provider,
        installedDirectory: path.join(bundle.location, 'domain-packs', pack.provider.packDirectory),
      },
    })),
  );
  const ids = new Set();
  for (const domain of domains) {
    if (ids.has(domain.id)) throw Error('Duplicate installed Domain.');
    ids.add(domain.id);
  }
  for (const skill of skills)
    if (!fs.statSync(skill.file, { throwIfNoEntry: false })?.isFile())
      throw Error(`Missing installed Skill: ${skill.id}`);
  return { domains, capabilities, skills, providerPacks };
}

function installedSkills(domain) {
  return loadRegistry()
    .skills.filter(item => !domain || item.domain === domain)
    .map(({ file, ...item }) => item);
}

function materializeInstalledSkills(scope, directory) {
  if (!process.env.INDUSTRIAL_HARNESS_PACK_STORE)
    return staticSkills.materializeSkills(scope, directory);
  const root = path.join(directory, 'skills');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const skills = loadRegistry().skills;
  for (const id of scope.skills) {
    const item = skills.find(skill => skill.id === id);
    if (!item) throw Error(`Unknown installed Skill: ${id}`);
    const target = path.join(root, id.replace(/[^a-zA-Z0-9.-]/g, '-'));
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    fs.copyFileSync(item.file, path.join(target, 'SKILL.md'));
  }
  return root;
}

module.exports = { loadRegistry, installedSkills, materializeInstalledSkills };
