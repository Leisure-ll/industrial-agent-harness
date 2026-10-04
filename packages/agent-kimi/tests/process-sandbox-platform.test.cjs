const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProcessSandbox } = require('../src/process-sandbox.cjs');

test('an unverified platform and a writable session nested in a protected project fail before spawning', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const platform of ['linux', 'win32']) {
    assert.throws(() => createProcessSandbox({ platform }), /verified process write boundary/);
  }
  if (process.platform === 'darwin')
    assert.throws(
      () =>
        createProcessSandbox({ projectDir: directory, shareDir: directory, executable: '/bin/sh' }),
      /outside the protected/,
    );
});
