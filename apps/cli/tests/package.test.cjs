const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const {
  buildHeadlessPackage,
} = require('../../../tests/integration/fixtures/headless-package.cjs');

test('packaged headless entry runs outside the workspace with Broker, Skills and pinned Kimi Code', t => {
  const { root, directory, target } = buildHeadlessPackage(t);
  const checkLinks = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        assert.ok(
          fs.realpathSync(file).startsWith(fs.realpathSync(target) + path.sep) ||
            fs.realpathSync(file) === fs.realpathSync(target),
          `Bundle dependency still points outside the package: ${file}`,
        );
      else if (entry.isDirectory()) checkLinks(file);
    }
  };
  checkLinks(path.join(target, 'node_modules'));
  const suite = path.join(root, 'examples/bench/scope-smoke.json');
  const outputDir = path.join(directory, 'results');
  const executed = spawnSync(
    process.execPath,
    [
      path.join(target, 'industrial-harness.cjs'),
      'bench',
      '--suite',
      suite,
      '--output-dir',
      outputDir,
    ],
    { cwd: os.tmpdir(), encoding: 'utf8' },
  );
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, 'summary.json'))).passed, true);
  assert.ok(
    fs.existsSync(
      path.join(
        target,
        'node_modules/@zhiman-bj/industrial-domain-packs/packs/chip/skills/chip-netlist-inspect/SKILL.md',
      ),
    ),
  );
  assert.equal(
    fs.existsSync(path.join(target, 'node_modules/@industrial-agent-harness/desktop')),
    false,
  );
  const packagedRequire = createRequire(
    fs.realpathSync(
      path.join(target, 'node_modules/@industrial-agent-harness/agent-kimi/src/index.cjs'),
    ),
  );
  const version = spawnSync(
    process.execPath,
    [packagedRequire.resolve('@moonshot-ai/kimi-code/dist/main.mjs'), '--version'],
    {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        KIMI_CODE_HOME: path.join(directory, 'kimi-home'),
        KIMI_CODE_NO_AUTO_UPDATE: '1',
      },
    },
  );
  assert.ifError(version.error);
  assert.equal(version.status, 0, version.stderr || version.stdout);
  assert.equal(version.stdout.trim(), '2.1.1');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(target, 'HARNESS-PACKAGE.json'))).agentRuntime.version,
    '2.1.1',
  );
});
