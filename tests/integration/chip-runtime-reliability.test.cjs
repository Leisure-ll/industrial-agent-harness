const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const python =
  process.env.INDUSTRIAL_HARNESS_EDA_PYTHON ||
  path.join(
    require('../../packages/domain-skills/src/index.cjs').packSourceDirectory('chip-pack'),
    'eda-harness/.venv/bin/python',
  );

test(
  'vendored Chip runtime owns client/probe cleanup, daemon budget and failed action evidence',
  { timeout: 15000, skip: !fs.existsSync(python) },
  async () => {
    const result = await execute(
      python,
      [path.join(__dirname, 'fixtures/chip-runtime-reliability.py')],
      { cwd: root, timeout: 12000 },
    );
    assert.match(result.stderr, /Ran 4 tests/);
    assert.match(result.stderr, /\bOK\b/);
  },
);
