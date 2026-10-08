const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CoreUpdater } = require('./updater.cjs');

test('Core update waits for a ready download and an idle task before restart', async () => {
  const source = new EventEmitter();
  let checks = 0,
    restarts = 0,
    busy = true;
  source.checkForUpdates = async () => {
    checks++;
    source.emit('update-available', { version: '0.2.0' });
    source.emit('download-progress', { percent: 61 });
    source.emit('update-downloaded', { version: '0.2.0' });
  };
  source.quitAndInstall = () => {
    restarts++;
  };
  const updater = new CoreUpdater({
    updater: source,
    packaged: true,
    channel: 'beta',
    onChange: () => {},
    canInstall: () => {
      if (busy) throw Error('Task is running.');
    },
  });
  assert.equal(source.channel, 'beta');
  assert.equal(source.allowPrerelease, true);
  assert.throws(() => updater.install(), /not ready/);
  await updater.check();
  assert.equal(updater.snapshot().status, 'ready');
  assert.equal(updater.snapshot().version, '0.2.0');
  await updater.check();
  assert.equal(checks, 1);
  assert.throws(() => updater.install(), /Task is running/);
  busy = false;
  updater.install();
  assert.equal(restarts, 1);
});

test('local installed builds without an update feed never contact a placeholder endpoint', async () => {
  const updater = new CoreUpdater({
    updater: null,
    packaged: true,
    configured: false,
    onChange: () => assert.fail('No update operation should start.'),
    canInstall: () => assert.fail('No restart should be attempted.'),
  });
  assert.equal(updater.snapshot().status, 'unconfigured');
  assert.equal((await updater.check()).status, 'unconfigured');
  assert.equal(updater.snapshot().error, null);
  assert.throws(() => updater.install(), /not ready/);
});
