#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { copyReleaseNotices } = require('./release-notices.cjs');
const {
  capabilities,
  listDomains,
  listSkills,
  domainPacks,
} = require('../packages/domain-skills/src/index.cjs');

const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
let output, domain;
for (let index = 0; index < argv.length; index++) {
  if (argv[index] === '--domain') {
    if (domain || !argv[index + 1]) throw Error('Provide --domain once.');
    domain = argv[++index];
  } else if (!output && !argv[index].startsWith('--')) output = argv[index];
  else throw Error(`Unknown packaging argument: ${argv[index]}`);
}
if (domain && !listDomains(capabilities).some(item => item.id === domain))
  throw Error('Unknown package domain.');
const target = path.resolve(
  output || path.join(root, 'dist', domain ? `headless-${domain}` : 'headless'),
);
if (
  target === root ||
  target.startsWith(path.join(root, 'packages') + path.sep) ||
  target.startsWith(path.join(root, 'apps') + path.sep)
)
  throw Error('Invalid headless output directory.');
if (fs.existsSync(target)) throw Error(`Output already exists: ${target}`);
fs.mkdirSync(path.dirname(target), { recursive: true });
const deployArgs = [
  '--filter',
  '@industrial-agent-harness/cli',
  'deploy',
  '--legacy',
  '--prod',
  target,
];
// Windows cannot execute a pnpm.cmd shim through spawnSync without a shell.
// Reuse pnpm's JS entry point to preserve each argument verbatim (including paths with spaces).
const pnpmEntry = process.env.npm_execpath;
if (process.platform === 'win32' && !pnpmEntry) {
  throw Error('On Windows, package through pnpm run package:headless.');
}
const result = pnpmEntry
  ? spawnSync(process.execPath, [pnpmEntry, ...deployArgs], { cwd: root, stdio: 'inherit' })
  : spawnSync('pnpm', deployArgs, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
copyReleaseNotices(target);
// pnpm legacy deploy can leave its root package linked to the source checkout.
// Resolve that package inside the portable bundle instead.
const selfLink = path.join(
  target,
  'node_modules',
  '.pnpm',
  'node_modules',
  '@industrial-agent-harness',
  'cli',
);
if (fs.lstatSync(selfLink, { throwIfNoEntry: false })?.isSymbolicLink()) {
  fs.unlinkSync(selfLink);
  fs.symlinkSync(path.relative(path.dirname(selfLink), target), selfLink, 'dir');
}
const entry = path.join(target, 'src', 'main.cjs');
const agent = path.join(
  target,
  'node_modules',
  '@industrial-agent-harness',
  'agent-kimi',
  'src',
  'index.cjs',
);
const deployedRequire = createRequire(fs.realpathSync(agent));
const skillsRoot = path.dirname(
  path.dirname(deployedRequire.resolve('@industrial-agent-harness/domain-skills')),
);
const mcp = deployedRequire.resolve('@industrial-agent-harness/domain-mcp');
const runtime = deployedRequire.resolve('@industrial-agent-harness/domain-runtime');
const contracts = createRequire(runtime).resolve('@industrial-agent-harness/contracts');
for (const file of [entry, mcp, runtime, contracts])
  if (!fs.existsSync(file)) throw Error(`Incomplete headless package: ${file}`);

if (domain) {
  fs.writeFileSync(
    path.join(skillsRoot, 'distribution.json'),
    JSON.stringify({ schemaVersion: 1, domain }, null, 2) + '\n',
  );
  const allowedSkills = new Set(listSkills(domain).map(item => item.id));
  const { skillFile } = require('../packages/domain-skills/src/registry.cjs');
  const directories = new Set(
    [...allowedSkills].map(id => path.basename(path.dirname(skillFile(id)))),
  );
  for (const item of fs.readdirSync(path.join(skillsRoot, 'skills')))
    if (!directories.has(item))
      fs.rmSync(path.join(skillsRoot, 'skills', item), { recursive: true });
  const packsDirectory = path.join(skillsRoot, 'packs');
  for (const file of fs.readdirSync(packsDirectory)) {
    const pack = JSON.parse(fs.readFileSync(path.join(packsDirectory, file), 'utf8'));
    if (pack.domain !== domain) fs.unlinkSync(path.join(packsDirectory, file));
  }
}
for (const pack of domainPacks.filter(pack => !domain || pack.domain === domain)) {
  const source = path.join(root, 'domain-packs', pack.provider.packDirectory);
  fs.cpSync(source, path.join(target, 'domain-packs', pack.provider.packDirectory), {
    recursive: true,
    filter: file =>
      !['.venv', '.venv-kimi', '__pycache__', '.DS_Store', '.ruff_cache', '.pytest_cache'].includes(
        path.basename(file),
      ) && !file.endsWith('.pyc'),
  });
}
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
fs.writeFileSync(
  path.join(target, 'HARNESS-PACKAGE.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      domain: domain || null,
      builtAt: new Date().toISOString(),
      sourceCommit: revision.status === 0 ? revision.stdout.trim() : null,
      sourceDirty: dirty.status === 0 ? Boolean(dirty.stdout.trim()) : null,
      providers: domainPacks
        .filter(pack => !domain || pack.domain === domain)
        .map(pack => ({ id: pack.provider.id, version: pack.version })),
    },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(
  path.join(target, 'industrial-harness.cjs'),
  '#!/usr/bin/env node\nvoid require("./src/main.cjs").main();\n',
  { mode: 0o755 },
);
const binding =
  (domain
    ? `Bound domain: ${domain}. --domain is optional; other domains are rejected.\n`
    : 'Multi-domain package: --domain is required.\n') +
  '\nExternal MCP services (stdio / Streamable HTTP / SSE):\n  node industrial-harness.cjs mcp add --file /absolute/path/mcp.json\n  node industrial-harness.cjs mcp list\n  node industrial-harness.cjs mcp refresh external.NAME\n  node industrial-harness.cjs mcp remove external.NAME\nRegistrations and enable/disable policy are shared with Desktop and other domain packages. Services must be installed separately. Host services may control apps outside project roots; all actual external calls use Kimi approval. Screenshots require a vision model and run --image-input. Results are unverified observations.\n';
const setup =
  domainPacks
    .filter(pack => !domain || pack.domain === domain)
    .map(
      pack =>
        `\n${pack.provider.title} is registered. Follow domain-packs/${pack.provider.packDirectory}/README.md for its locked gateway/backend setup. Registration does not imply native runtime readiness; source resources, tool images and required engineering dependencies are not downloaded automatically.\n`,
    )
    .join('') ||
  '\nThis domain has no registered industrial MCP provider yet. Scope/Skill and general Kimi tests are supported; do not infer engineering execution readiness.\n';
fs.writeFileSync(
  path.join(target, 'HEADLESS-README.txt'),
  `Industrial Agent Harness CLI test package\n\n${binding}\nUse Node.js 24 or newer:\n  node industrial-harness.cjs run --project-dir DIR ${domain ? '' : '--domain DOMAIN '}--task TEXT --scope-only\n  node industrial-harness.cjs run --project-dir DIR ${domain ? '' : '--domain DOMAIN '}--task TEXT\n\nAgent execution needs Kimi CLI 1.51.0 and model API credentials. Install it in a separate environment (requires uv):\n  uv venv --python 3.13 /absolute/path/harness-kimi\n  uv pip install --python /absolute/path/harness-kimi/bin/python 'kimi-cli==1.51.0'\n  export KIMI_EXECUTABLE=/absolute/path/harness-kimi/bin/kimi\n\nSet KIMI_API_KEY for the default Kimi provider; other providers use their declared key environment. Do not place keys in task text or command-line arguments.\n\nProtected agent execution currently requires macOS Seatbelt. Linux/Windows mutation and host GUI/external MCP combinations remain unavailable until a verified boundary exists. The registered RTL runtime emits persisted action and verification facts; read result.engineering separately from the agent turn status.\n\nThis package includes the shared Broker, domain Skill and MCP declarations, Kimi SDK integration, chat persistence and observed-context SQLite store; no Electron or Viewer UI. HARNESS-PACKAGE.json records source identity and whether this is a local uncommitted test build.\n${setup}`,
);
process.stdout.write(`${target}\n`);
