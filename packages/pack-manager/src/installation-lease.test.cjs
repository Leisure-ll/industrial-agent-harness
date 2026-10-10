const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { PackManager } = require('./index.cjs');
const { InstallationJournal } = require('./installation-journal.cjs');

async function holder(t, directory, operation) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const { PackManager } = require(process.argv[1]);
       const { InstallationJournal } = require(process.argv[2]);
       const manager = new PackManager({ directory: process.argv[3] });
       let release;
       if (process.argv[4] === 'use') release = manager.acquireUse('fixture');
       else {
         const journal = new InstallationJournal(manager);
         journal.begin(['fixture'], 'repair');
         release = () => journal.finish('completed');
       }
       process.on('message', () => { release(); process.disconnect(); });
       process.send('ready');`,
      require.resolve('./index.cjs'),
      require.resolve('./installation-journal.cjs'),
      directory,
      operation,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  let errors = '';
  child.stderr.on('data', bytes => {
    errors += bytes;
  });
  const closed = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  });
  const ready = await Promise.race([
    once(child, 'message'),
    closed.then(() => {
      throw Error(`Lease holder exited early: ${errors}`);
    }),
  ]);
  assert.equal(ready[0], 'ready');
  return async () => {
    child.send('release');
    const [code] = await closed;
    assert.equal(code, 0, errors);
  };
}

test(
  'task use and preparation exclude each other across processes while unrelated domains remain usable',
  { timeout: 10000 },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-lease-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const manager = new PackManager({ directory });
    manager.writeState({ schemaVersion: 1, active: { fixture: '1.0.0', unrelated: '1.0.0' } });
    const journal = new InstallationJournal(manager);

    const releaseUse = await holder(t, directory, 'use');
    assert.throws(() => journal.begin(['fixture'], 'repair'), /fixture is in use/);
    assert.equal(journal.snapshot(), null);
    await releaseUse();
    journal.begin(['fixture'], 'repair');
    journal.finish('completed');

    const finishRepair = await holder(t, directory, 'repair');
    assert.throws(() => manager.acquireUse('fixture'), /fixture preparation is in progress/);
    const releaseUnrelated = manager.acquireUse('unrelated');
    assert.throws(() => manager.assertIdle('unrelated'), /unrelated is in use/);
    releaseUnrelated();
    manager.assertIdle('unrelated');
    await finishRepair();
    const release = manager.acquireUse('fixture');
    release();
    manager.assertIdle('fixture');
    assert.equal(fs.existsSync(path.join(directory, 'install.lock')), false);
  },
);
