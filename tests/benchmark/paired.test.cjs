const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  loadBaseline,
  runBaseline,
  treeHash,
  hashFile,
} = require('../../scripts/benchmark-paired.cjs');

const smokeFile = path.resolve(__dirname, '../../examples/bench/paired-chip-counter/smoke.json');
const haveTools = ['iverilog', 'vvp'].every(
  command => spawnSync(command, ['-V'], { stdio: 'ignore' }).status === 0,
);
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-paired-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test(
  'engineering smoke copies paired inputs and preserves real compiler/simulator evidence without model scores',
  { skip: !haveTools },
  async t => {
    const directory = setup(t);
    const baseline = loadBaseline(smokeFile);
    const before = treeHash(baseline.tasks[0].projectDir);
    const summary = await runBaseline(smokeFile, path.join(directory, 'results'));
    assert.equal(summary.records.length, 2);
    assert.ok(summary.records.every(record => record.passed));
    assert.equal(summary.metrics.harness.firstAttemptSuccessRate, null);
    assert.equal(summary.metrics.harness.cost, null);
    assert.equal(summary.rankingEligible, false);
    assert.equal(treeHash(baseline.tasks[0].projectDir), before);
    for (const record of summary.records) {
      assert.equal(hashFile(record.verification.stdoutFile), record.verification.stdoutSha256);
      assert.notEqual(record.outputTreeSha256, record.inputTreeSha256);
      const evidence = JSON.parse(
        fs.readFileSync(
          path.join(path.dirname(record.verification.stdoutFile), 'verification-evidence.json'),
        ),
      );
      assert.equal(evidence.status, 'passed');
    }
  },
);

test(
  'self-reported PASS and successful driver exit never substitute for independent engineering verification',
  { skip: !haveTools },
  async t => {
    const directory = setup(t);
    const suite = JSON.parse(fs.readFileSync(smokeFile));
    const source = path.dirname(smokeFile);
    suite.tasks[0].projectDir = path.join(source, 'project');
    suite.verifier.args[0] = path.join(source, 'verify.cjs');
    suite.verifier.files = suite.verifier.files.map(file => ({
      ...file,
      path: path.join(source, file.path),
    }));
    for (const label of ['native-kimi', 'harness'])
      suite.drivers[label] = {
        executable: 'node',
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({type:"model_answer",status:"PASS"})+"\\n")',
        ],
        files: [],
      };
    const file = path.join(directory, 'baseline.json');
    fs.writeFileSync(file, JSON.stringify(suite));
    const summary = await runBaseline(file, path.join(directory, 'results'));
    assert.ok(summary.records.every(record => record.execution.exitCode === 0));
    assert.ok(
      summary.records.every(record => !record.passed && record.verification.exitCode !== 0),
    );
  },
);

test('frozen input/implementation drift is rejected before running, and symlink inputs are forbidden', t => {
  const directory = setup(t);
  const projectDir = path.join(directory, 'project');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'a'), 'initial');
  const suite = JSON.parse(fs.readFileSync(smokeFile));
  suite.tasks[0].projectDir = projectDir;
  suite.tasks[0].inputTreeSha256 = treeHash(projectDir);
  for (const label of ['native-kimi', 'harness']) suite.drivers[label].files = [];
  suite.verifier.files = [];
  const file = path.join(directory, 'suite.json');
  fs.writeFileSync(file, JSON.stringify(suite));
  fs.writeFileSync(path.join(projectDir, 'a'), 'changed');
  assert.throws(() => loadBaseline(file), /Input tree hash mismatch/);
  fs.symlinkSync(path.join(projectDir, 'a'), path.join(projectDir, 'linked'));
  assert.throws(() => treeHash(projectDir), /symlinks/);
});

test('diagnostic continuation and token-budget claims cannot contaminate first-attempt results', t => {
  const directory = setup(t);
  const suite = JSON.parse(fs.readFileSync(smokeFile));
  const file = path.join(directory, 'suite.json');
  suite.runKind = 'diagnostic';
  fs.writeFileSync(file, JSON.stringify(suite));
  assert.throws(() => loadBaseline(file), /parentSummarySha256/);
  suite.runKind = 'first-attempt';
  suite.budget.maxTokens = 10000;
  fs.writeFileSync(file, JSON.stringify(suite));
  assert.throws(() => loadBaseline(file), /wall time only/);
});

test(
  'hung drivers are killed at the shared wall-time budget and still get independent verification',
  { skip: !haveTools },
  async t => {
    const directory = setup(t);
    const suite = JSON.parse(fs.readFileSync(smokeFile));
    const source = path.dirname(smokeFile);
    suite.tasks[0].projectDir = path.join(source, 'project');
    suite.budget.maxMs = 100;
    suite.verifier.args[0] = path.join(source, 'verify.cjs');
    suite.verifier.files = suite.verifier.files.map(file => ({
      ...file,
      path: path.join(source, file.path),
    }));
    for (const label of ['native-kimi', 'harness'])
      suite.drivers[label] = {
        executable: 'node',
        args: ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],
        files: [],
      };
    const file = path.join(directory, 'suite.json');
    fs.writeFileSync(file, JSON.stringify(suite));
    const summary = await runBaseline(file, path.join(directory, 'results'));
    assert.ok(summary.records.every(record => record.execution.timedOut && !record.passed));
    assert.ok(summary.records.every(record => fs.existsSync(record.verification.stdoutFile)));
  },
);

test(
  'benchmark log files redact credentials split across process writes while preserving their recorded hashes',
  { skip: !haveTools },
  async t => {
    const directory = setup(t);
    const suite = JSON.parse(fs.readFileSync(smokeFile));
    const source = path.dirname(smokeFile);
    suite.tasks[0].projectDir = path.join(source, 'project');
    suite.verifier.args[0] = path.join(source, 'verify.cjs');
    suite.verifier.files = suite.verifier.files.map(file => ({
      ...file,
      path: path.join(source, file.path),
    }));
    const secret = 'split-benchmark-private-key';
    process.env.INDUSTRIAL_TEST_API_KEY = secret;
    t.after(() => delete process.env.INDUSTRIAL_TEST_API_KEY);
    const script =
      'const k=process.env.INDUSTRIAL_TEST_API_KEY;process.stdout.write(k.slice(0,9));process.stderr.write(k.slice(0,9));setTimeout(()=>{process.stdout.write(k.slice(9)+"\\n");process.stderr.write(k.slice(9)+"\\n");},50)';
    for (const label of ['native-kimi', 'harness'])
      suite.drivers[label] = { executable: 'node', args: ['-e', script], files: [] };
    const file = path.join(directory, 'suite.json');
    fs.writeFileSync(file, JSON.stringify(suite));
    const summary = await runBaseline(file, path.join(directory, 'results'));
    for (const record of summary.records)
      for (const channel of ['stdout', 'stderr']) {
        const text = fs.readFileSync(record.execution[channel + 'File'], 'utf8');
        assert.equal(text, '[REDACTED]\n');
        assert.equal(
          hashFile(record.execution[channel + 'File']),
          record.execution[channel + 'Sha256'],
        );
      }
  },
);

test('formal model identity mismatch invalidates both rates even if independent verification exits successfully', async t => {
  const directory = setup(t);
  const projectDir = path.join(directory, 'project');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'input.txt'), 'fixed');
  const driver = path.join(directory, 'driver.cjs');
  fs.writeFileSync(
    driver,
    'process.stdout.write(JSON.stringify({type:"benchmark_driver",driver:process.argv[2],model:{provider:"test",id:"wrong-model",configurationId:"v1"}})+"\\n")',
  );
  const verifier = path.join(directory, 'verifier.cjs');
  fs.writeFileSync(verifier, 'process.exitCode=0;');
  const command = script => ({
    executable: process.execPath,
    sha256: hashFile(process.execPath),
    args: [script],
    files: [{ path: script, sha256: hashFile(script) }],
  });
  const suite = {
    schemaVersion: 1,
    mode: 'paired-model',
    runKind: 'first-attempt',
    seeds: [0],
    budget: { maxMs: 1000, maxTokens: null },
    verifierMaxMs: 1000,
    model: { provider: 'test', id: 'frozen-model', configurationId: 'v1' },
    environment: {
      platform: process.platform,
      toolchainId: 'test-v1',
      tools: [{ executable: process.execPath, sha256: hashFile(process.execPath) }],
    },
    drivers: Object.fromEntries(
      ['native-kimi', 'harness'].map(label => [
        label,
        { ...command(driver), args: [driver, label] },
      ]),
    ),
    verifier: command(verifier),
    tasks: [
      {
        id: 'frozen',
        domain: 'chip',
        projectDir,
        inputTreeSha256: treeHash(projectDir),
        prompt: 'Use fixed inputs.',
      },
    ],
  };
  const file = path.join(directory, 'suite.json');
  fs.writeFileSync(file, JSON.stringify(suite));
  const summary = await runBaseline(file, path.join(directory, 'results'));
  assert.equal(summary.comparisonValid, false);
  assert.ok(summary.records.every(record => !record.modelIdentityValid));
  assert.equal(summary.metrics['native-kimi'].firstAttemptSuccessRate, null);
  assert.equal(summary.metrics.harness.firstAttemptSuccessRate, null);
});
