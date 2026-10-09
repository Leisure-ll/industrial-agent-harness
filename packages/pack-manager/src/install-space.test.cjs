const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { availableSpace, footprint, checkSpace } = require('./install-space.cjs');
const { TransferProgress } = require('./transfer.cjs');

test('disk preflight uses destination filesystem and includes download, staging and reserve', () => {
  assert.ok(availableSpace(os.tmpdir()) > 0);
  const estimate = footprint(100, 200, { estimated: false, cacheReused: true });
  assert.ok(estimate.requiredBytes > 300);
  assert.equal(
    checkSpace(os.tmpdir(), estimate, () => estimate.requiredBytes).availableBytes,
    estimate.requiredBytes,
  );
  assert.throws(() => checkSpace(os.tmpdir(), estimate, () => 299), { code: 'ENOSPC' });
});
test('download estimates use measured elapsed bytes and omit unknown estimates', () => {
  let now = 0;
  const known = new TransferProgress(1000, () => now);
  assert.equal(known.update(0).bytesPerSecond, undefined);
  now = 2000;
  assert.deepEqual(known.update(200), {
    phase: 'downloading',
    received: 200,
    total: 1000,
    bytesPerSecond: 100,
    etaSeconds: 8,
  });
  now = 4000;
  assert.equal(known.update(1000).etaSeconds, 0);
  const unknown = new TransferProgress(undefined, () => now);
  now += 1000;
  assert.equal(unknown.update(50).bytesPerSecond, 50);
  assert.equal(unknown.update(50).etaSeconds, undefined);
});
