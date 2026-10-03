const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { resourceDirectory } = require('./pack-resources.cjs');
const { domainPacks } = require('./index.cjs');

test('PCB declarations cover all native tools and keep the complete design Skill separate from maintenance', () => {
  const provider = domainPacks.find(pack => pack.domain === 'pcb').provider;
  assert.equal(provider.tools.length, 89);
  assert.equal(new Set(provider.tools.map(tool => tool.name)).size, 89);
  assert.equal(provider.tools.find(tool => tool.name === 'run_python').risk, 'read-only');
  assert.equal(provider.tools.find(tool => tool.name === 'add_track').risk, 'mutating');
  assert.equal(
    Object.keys(provider.sourceFiles).filter(name => name.startsWith('skills/')).length,
    11,
  );
  assert.ok(
    Object.hasOwn(provider.sourceFiles, 'skills/pcb-design-e2e/assets/constraints.example.yaml'),
  );
  assert.ok(
    !Object.keys(provider.sourceFiles).some(
      name => name.includes('maintainer') || name.includes('experiments'),
    ),
  );
});

test('external resources reject changed, missing, extra or symlinked files before a session can load them', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-resources-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const contents = {
    'pcb-agent/tools/runtime.py': 'fixture source',
    'skills/pcb-design-e2e/SKILL.md': 'fixture skill',
    'skills/pcb-design-e2e/references/tools.md': 'fixture reference',
  };
  const sourceFiles = {};
  for (const [file, content] of Object.entries(contents)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
    sourceFiles[file] = crypto.createHash('sha256').update(content).digest('hex');
  }
  const provider = {
    title: 'Fixture',
    directoryEnv: 'FIXTURE_ROOT',
    resourceRoots: ['pcb-agent', 'skills/pcb-design-e2e'],
    sourceFiles,
    sourceSha256: crypto.createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex'),
  };
  assert.equal(
    resourceDirectory(provider, { FIXTURE_ROOT: directory }),
    fs.realpathSync(directory),
  );
  assert.throws(() => resourceDirectory(provider, {}), /absolute directory/);
  const target = path.join(directory, 'skills/pcb-design-e2e/references/tools.md');
  fs.writeFileSync(target, 'changed');
  assert.throws(() => resourceDirectory(provider, { FIXTURE_ROOT: directory }), /differs/);
  fs.writeFileSync(target, contents['skills/pcb-design-e2e/references/tools.md']);
  const extra = path.join(directory, 'pcb-agent/tools/extra.py');
  fs.writeFileSync(extra, 'unexpected imported module');
  assert.throws(() => resourceDirectory(provider, { FIXTURE_ROOT: directory }), /inventory/);
  fs.unlinkSync(extra);
  fs.unlinkSync(target);
  assert.throws(() => resourceDirectory(provider, { FIXTURE_ROOT: directory }), /inventory/);
  fs.symlinkSync(path.join(directory, 'pcb-agent/tools/runtime.py'), target);
  assert.throws(() => resourceDirectory(provider, { FIXTURE_ROOT: directory }), /symlinks/);
});
