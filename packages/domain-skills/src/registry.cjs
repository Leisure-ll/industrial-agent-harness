const fs = require('node:fs');
const path = require('node:path');
const { distributionDomain } = require('./distribution.cjs');

// Repository-owned defaults. Harness resource policy stores ID enablement only.
const skills = Object.freeze([
  {
    id: 'project.work',
    domain: '*',
    title: 'Create, edit and check a project',
    directory: 'project-work',
  },
  {
    id: 'chip.netlist.inspect',
    domain: 'chip',
    title: 'Inspect RTL netlist',
    directory: 'chip-netlist-inspect',
  },
  {
    id: 'chip.waveform.inspect',
    domain: 'chip',
    title: 'Inspect simulation waveform',
    directory: 'chip-waveform-inspect',
  },
  {
    id: 'chip.layout.inspect',
    domain: 'chip',
    title: 'Inspect physical layout',
    directory: 'chip-layout-inspect',
  },
  {
    id: 'pcb.layout.inspect',
    domain: 'pcb',
    title: 'Inspect PCB layout',
    directory: 'pcb-layout-inspect',
  },
  {
    id: 'chip.eda.operate',
    domain: 'chip',
    title: 'Operate Chip Pack EDA Harness',
    directory: 'chip-eda-operate',
  },
  {
    id: 'pcb.design.e2e',
    domain: 'pcb',
    title: 'PCB design and repair',
    directory: 'pcb-design-e2e',
    externalPack: 'pcb-bench',
    nativeToolPrefix: 'pcb.bench.',
  },
  {
    id: 'godot.game.inspect',
    domain: 'godot',
    title: 'Inspect Godot game scenes',
    directory: 'godot-game-inspect',
  },
  {
    id: 'godot.game.develop',
    domain: 'godot',
    title: 'Develop and verify Godot games',
    directory: 'godot-game-develop',
  },
  {
    id: 'cad.autocad.macos',
    domain: 'cad',
    title: 'Operate AutoCAD on macOS',
    directory: 'cad-autocad-macos',
  },
  {
    id: 'cad.intent.loop',
    domain: 'cad',
    title: 'CAD intent loop (dimension-neutral)',
    directory: 'cad-intent-loop',
  },
  {
    id: 'cad.ezdxf.author',
    domain: 'cad',
    title: 'Author 2D DXF via ezdxf',
    directory: 'cad-ezdxf',
  },
  {
    id: 'cad.freecad.headless',
    domain: 'cad',
    title: 'Drive FreeCAD headless',
    directory: 'cad-freecad-headless',
  },
]);

function listSkills(domain) {
  return skills
    .filter(
      item =>
        (item.domain === '*' || !distributionDomain || item.domain === distributionDomain) &&
        (item.domain === '*' || !domain || item.domain === domain),
    )
    .map(({ directory, externalPack, nativeToolPrefix, ...item }) => ({
      ...item,
      enabledByDefault: true,
    }));
}

function skillFile(id) {
  const item = skills.find(
    skill =>
      skill.id === id &&
      (skill.domain === '*' || !distributionDomain || skill.domain === distributionDomain),
  );
  if (!item) throw Error(`Unknown repository skill: ${id}`);
  const file = path.join(__dirname, '..', 'skills', item.directory, 'SKILL.md');
  if (!fs.statSync(file).isFile()) throw Error(`Missing repository skill: ${id}`);
  return file;
}

function integrationSuffix(prefix) {
  return `\n\n## Industrial Harness integration\n\nUse domain_tool_list to discover the current allowed tools. Each native name in this Skill maps to canonical ID ${prefix}<name>; use domain_tool_describe and domain_tool_call with that ID. The backend owns native CAD actions and receipts. Do not bypass it with Shell or direct file edits. A successful tool process or an observation is not engineering acceptance.\n`;
}

function skillPackaging(id) {
  const item = skills.find(
    skill =>
      skill.id === id &&
      (skill.domain === '*' || !distributionDomain || skill.domain === distributionDomain),
  );
  if (!item) throw Error(`Unknown repository skill: ${id}`);
  return {
    source: path.dirname(skillFile(id)),
    name: item.directory,
    external: item.externalPack
      ? {
          providerPackId: item.externalPack,
          resourcePath: `skills/${item.directory}`,
          nativeToolPrefix: item.nativeToolPrefix,
        }
      : undefined,
  };
}

function skillSource(id, environment = process.env) {
  const resource = skillPackaging(id);
  if (resource.external) {
    const { loadDomainPacks } = require('./packs.cjs');
    const { resourceDirectory } = require('./pack-resources.cjs');
    const provider = loadDomainPacks().find(
      pack => pack.id === resource.external.providerPackId,
    )?.provider;
    if (!provider) throw Error('Skill requires its registered Domain Pack.');
    resource.source = path.join(
      resourceDirectory(provider, environment),
      ...resource.external.resourcePath.split('/'),
    );
    resource.suffix = integrationSuffix(resource.external.nativeToolPrefix);
  }
  return resource;
}

function materializeSkills(scope, directory, environment = process.env) {
  const { materializeSkillDirectories } = require('./skill-resources.cjs');
  return materializeSkillDirectories(
    scope.skills.map(id => skillSource(id, environment)),
    directory,
  );
}

module.exports = {
  listSkills,
  skillFile,
  materializeSkills,
  skillSource,
  skillPackaging,
  integrationSuffix,
};
