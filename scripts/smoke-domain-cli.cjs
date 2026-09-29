#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const directory = path.resolve(process.argv[2]);
const domains = ['chip', 'pcb', 'godot'];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-cli-smoke-'));
try {
  for (const domain of domains) {
    const entry = path.join(directory, `headless-${domain}`, 'industrial-harness.cjs');
    const packageRoot = path.dirname(entry);
    const filenames = fs.readdirSync(packageRoot).map(name => name.toLowerCase());
    assert.equal(new Set(filenames).size, filenames.length, 'Package root filenames must coexist on case-insensitive filesystems.');
    const identity = JSON.parse(fs.readFileSync(path.join(packageRoot, 'HARNESS-PACKAGE.json'), 'utf8'));
    assert.equal(identity.domain, domain);
    assert.equal(JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).name, '@industrial-agent-harness/cli', 'Release identity must preserve the Node package manifest.');
    const args = ['run', '--project-dir', temporary, '--task', domain === 'chip' ? '检查工程状态' : domain === 'pcb' ? 'Inspect PCB board' : 'Inspect project files', '--scope-only'];
    const run = extra => execFileSync(process.execPath, [entry, ...args, ...extra], {cwd: temporary, encoding: 'utf8', env: {...process.env, INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(temporary, 'config')}}).trim().split('\n').map(JSON.parse);
    const rows = run([]); assert.equal(rows[0].scope.domain, domain); assert.equal(rows.at(-1).status, 'scoped');
    assert.ok(rows[0].trace.find(row => row.event === 'domain.index').detail.count === (domain === 'chip' ? 8 : domain === 'pcb' ? 1 : 0));
    const denied = domain === 'chip' ? 'pcb' : 'chip';
    assert.throws(() => run(['--domain', denied]), error => error.stdout.includes(`fixed to the ${domain} domain`));
    const skillsRoot = fs.realpathSync(path.join(path.dirname(entry), 'node_modules/@industrial-agent-harness/domain-skills'));
    const inspect = `const {capabilities,listSkills,listDomains,domainPacks}=require(${JSON.stringify(skillsRoot)});console.log(JSON.stringify({skills:listSkills(),capabilities:capabilities.map(c=>c.domain),domains:listDomains(capabilities),packs:domainPacks.map(p=>p.domain)}))`;
    const catalog = JSON.parse(execFileSync(process.execPath, ['-e', inspect], {cwd: temporary, encoding: 'utf8'}));
    assert.ok(catalog.skills.every(skill => skill.domain === domain));
    assert.ok(catalog.capabilities.every(item => item === domain));
    assert.deepEqual(catalog.domains.map(item => item.id), [domain]);
    assert.ok(catalog.packs.every(item => item === domain));
    if (domain === 'chip') {assert.equal(catalog.skills.length, 4); assert.equal(fs.existsSync(path.join(path.dirname(entry), 'domain-packs/chip/eda-harness/src/eda_harness/server/mcp.py')), true); assert.deepEqual(run(['--disable-mcp', 'chip-pack.eda'])[0].scope.tools, []);}
    else assert.equal(fs.existsSync(path.join(path.dirname(entry), 'domain-packs/chip')), false);
    console.log(JSON.stringify({domain, ok: true, skills: catalog.skills.length, providers: catalog.packs.length}));
  }
} finally {fs.rmSync(temporary, {recursive: true, force: true});}
