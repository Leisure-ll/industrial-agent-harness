const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = path.resolve(__dirname, '../../domain-packs/chip/linux-bootstrap.sh');
const run = (args, env = process.env) =>
  spawnSync('bash', [source, ...args], { env, encoding: 'utf8' });

test('help is available without downloads or system setup', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /sudo is requested only for missing system dependencies/);
});

test('invalid arguments are rejected before attempting installation', () => {
  for (const args of [['--unknown'], ['--prefix'], ['--prefix', 'relative/path']]) {
    const result = run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unknown option|requires an absolute directory/);
    assert.doesNotMatch(result.stdout, /Downloading|Preparing/);
  }
});

test('a corrupted download never executes or provisions system dependencies', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chip-bootstrap-rejection-'));
  const marker = path.join(directory, 'executed');
  try {
    // Linux preflight requires flock; this rejection must occur before invoking it.
    fs.writeFileSync(path.join(directory, 'flock'), '#!/bin/bash\nexit 99\n', { mode: 0o755 });
    fs.writeFileSync(
      path.join(directory, 'uname'),
      '#!/bin/bash\nif [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(directory, 'wget'),
      '#!/bin/bash\nwhile (( $# )); do\n if [[ "$1" == -O ]]; then printf "#!/bin/bash\\ntouch \\\"%s\\\"\\n" "$BOOTSTRAP_EXECUTION_MARKER" > "$2"; exit; fi\n shift\ndone\nexit 1\n',
      { mode: 0o755 },
    );
    const result = run([], {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      BOOTSTRAP_EXECUTION_MARKER: marker,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Installer checksum mismatch/);
    assert.doesNotMatch(result.stdout, /Preparing missing system dependencies/);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
