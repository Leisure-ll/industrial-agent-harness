const fs = require('node:fs');
const path = require('node:path');
const { PackManager } = require('@industrial-agent-harness/pack-manager');
const { distributionDomain } = require('./distribution.cjs');
const staticCapabilities = require('./capabilities.cjs');
const { loadDomainPacks } = require('./packs.cjs');
const { loadSkillOnlyPacks } = require('./skill-only-packs.cjs');
const staticSkills = require('./registry.cjs');
const { listDomains } = require('./domains.cjs');

function repositoryPackDirectory(packDirectory) {
  // A deployed pnpm package lives below node_modules/.pnpm. Bind its native
  // resources to the portable release root, never a source checkout above it.
  for (let directory = __dirname; ; directory = path.dirname(directory)) {
    if (fs.existsSync(path.join(directory, 'HARNESS-PACKAGE.json')))
      return path.join(directory, 'domain-packs', packDirectory);
    if (path.dirname(directory) === directory) break;
  }
  return path.resolve(__dirname, '../../../domain-packs', packDirectory);
}

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
      runtimePacks: providerPacks
        .filter(pack => pack.runtime)
        .map(pack => ({
          id: pack.id,
          domain: pack.domain,
          version: pack.version,
          runtime: pack.runtime,
          directory: repositoryPackDirectory(pack.provider.packDirectory),
        })),
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
      ...(skill.external ? { external: skill.external } : {}),
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
  const runtimePacks = bundles.flatMap(bundle =>
    bundle.providerPacks
      .filter(pack => pack.runtime)
      .map(pack => ({
        id: pack.id,
        domain: pack.domain,
        version: pack.version,
        runtime: pack.runtime,
        directory: path.join(bundle.location, 'domain-packs', pack.provider.packDirectory),
      })),
  );
  return { domains, capabilities, skills, providerPacks, runtimePacks };
}

function installedSkills(domain) {
  return loadRegistry()
    .skills.filter(item => !domain || item.domain === domain)
    .map(({ file, ...item }) => item);
}

function materializeInstalledSkills(scope, directory, environment = process.env) {
  if (!process.env.INDUSTRIAL_HARNESS_PACK_STORE)
    return staticSkills.materializeSkills(scope, directory, environment);
  const { materializeSkillDirectories } = require('./skill-resources.cjs');
  const { skills, providerPacks } = loadRegistry();
  return materializeSkillDirectories(
    scope.skills.map(id => {
      const item = skills.find(skill => skill.id === id);
      if (!item) throw Error(`Unknown installed Skill: ${id}`);
      let source = path.dirname(item.file),
        suffix;
      if (item.external) {
        const provider = providerPacks.find(
          pack => pack.id === item.external.providerPackId,
        )?.provider;
        if (!provider) throw Error('Skill requires its registered Domain Pack.');
        source = path.join(
          require('./pack-resources.cjs').resourceDirectory(provider, environment),
          ...item.external.resourcePath.split('/'),
        );
        suffix = staticSkills.integrationSuffix(item.external.nativeToolPrefix);
      }
      return { name: id.replace(/[^a-zA-Z0-9.-]/g, '-'), source, suffix };
    }),
    directory,
  );
}

module.exports = { loadRegistry, installedSkills, materializeInstalledSkills };
