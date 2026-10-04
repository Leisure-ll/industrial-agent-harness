const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionResourceManager, sessionResourceLimits } = require('../src/index.cjs');
const { parseAvailableMemory } = require('../src/available-memory.cjs');

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'session-resources-'));
  const managers = [];
  t.after(async () => {
    await Promise.allSettled(managers.map(manager => manager.close()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const create = (options = {}) => {
    const manager = new SessionResourceManager({
      directory,
      limits: { maxConcurrent: 2, maxResident: 2, idleMs: 100, minFreeMemoryBytes: 0 },
      sweepIntervalMs: 100000,
      ...overrides,
      ...options,
    });
    managers.push(manager);
    return manager;
  };
  return { create, directory };
}

test('shared admission is atomic across hosts, obeys the stricter limit, and releases failed attempts', async t => {
  const { create } = fixture(t);
  const a = create();
  const b = create({
    limits: { maxConcurrent: 10, maxResident: 10, idleMs: 100, minFreeMemoryBytes: 0 },
  });
  let disposed = 0;
  const resource = {
    dispose: async () => {
      disposed++;
    },
  };
  const releaseA = await a.acquire('a', resource);
  const releaseB = await b.acquire('b', resource);
  await assert.rejects(b.acquire('overflow', resource), { code: 'CONCURRENT_LIMIT' });
  assert.equal(b.snapshot().active, 2);
  assert.equal(b.snapshot().resident, 2);
  releaseA();
  releaseA();
  const releaseC = await a.acquire('c', resource);
  assert.equal(disposed, 1);
  assert.equal(a.snapshot().resident, 2);
  releaseB();
  releaseC();
});

test('idle TTL protects active and pending-interaction resources and keeps persisted data', async t => {
  let now = 0,
    awaitingApproval = false;
  const { create, directory } = fixture(t, { clock: () => now });
  const manager = create();
  const saved = path.join(directory, 'native-context.jsonl');
  fs.writeFileSync(saved, 'persisted context');
  let closed = 0;
  const release = await manager.acquire('chat', {
    dispose: async () => {
      closed++;
    },
    isBusy: () => awaitingApproval,
  });
  now = 1000;
  await manager.sweep();
  assert.equal(closed, 0);
  awaitingApproval = true;
  release();
  now = 2000;
  await manager.sweep();
  assert.equal(closed, 0);
  awaitingApproval = false;
  await manager.sweep();
  assert.equal(closed, 1);
  assert.equal(manager.snapshot().resident, 0);
  assert.equal(fs.readFileSync(saved, 'utf8'), 'persisted context');
});

test('a full resident pool requests eviction from another host before admitting a new process', async t => {
  // TTL must not race the specific cross-host eviction being verified here.
  const { create } = fixture(t, {
    sweepIntervalMs: 10,
    limits: { maxConcurrent: 2, maxResident: 2, idleMs: 60000, minFreeMemoryBytes: 0 },
  });
  const a = create();
  const b = create();
  let closed = 0;
  for (const id of ['oldest', 'newer']) {
    const release = await a.acquire(id, {
      dispose: async () => {
        closed++;
      },
    });
    release();
  }
  const release = await b.acquire('new', { dispose: async () => {} });
  assert.equal(closed, 1);
  assert.equal(b.snapshot().resident, 2);
  assert.equal(a.entries.has('oldest'), false);
  assert.equal(a.entries.has('newer'), true);
  release();
});

test('slow disposal occupies its slot, bounded admission fails, and revival waits for close', async t => {
  const { create } = fixture(t, {
    residentWaitMs: 10,
    limits: { maxConcurrent: 1, maxResident: 1, idleMs: 100, minFreeMemoryBytes: 0 },
  });
  const manager = create();
  let finish;
  const release = await manager.acquire('old', {
    dispose: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  });
  release();
  await assert.rejects(manager.acquire('new', { dispose: async () => {} }), {
    code: 'RESIDENT_LIMIT',
  });
  assert.equal(manager.snapshot().active, 0);
  assert.equal(manager.snapshot().resident, 1);
  assert.equal(manager.entries.has('new'), false);
  const revival = manager.acquire('old', { dispose: async () => {} });
  finish();
  const releaseRevival = await revival;
  assert.equal(manager.snapshot().resident, 1);
  releaseRevival();
});

test('memory pressure rejects starts and retires idle resources without interrupting active work', async t => {
  let available = 1000,
    closed = 0;
  const { create } = fixture(t, {
    freeMemory: () => available,
    limits: { maxConcurrent: 2, maxResident: 2, idleMs: 100, minFreeMemoryBytes: 100 },
  });
  const manager = create();
  const releaseIdle = await manager.acquire('idle', {
    dispose: async () => {
      closed++;
    },
  });
  releaseIdle();
  const releaseActive = await manager.acquire('active', {
    dispose: async () => {
      closed++;
    },
  });
  available = 10;
  await assert.rejects(manager.acquire('denied', { dispose: async () => {} }), {
    code: 'MEMORY_PRESSURE',
  });
  await manager.sweep();
  assert.equal(closed, 1);
  assert.equal(manager.snapshot().active, 1);
  assert.equal(manager.snapshot().resident, 1);
  releaseActive();
});

test('dead owners are reclaimed and failed disposal never reports free capacity', async t => {
  const { create } = fixture(t);
  const manager = create();
  manager.db.prepare('INSERT INTO resource_owners VALUES (?, ?, 1, 1, 0)').run('dead', 2147483647);
  manager.db.prepare('INSERT INTO session_leases VALUES (?, ?, 1, 1, 0, 0)').run('orphan', 'dead');
  assert.equal(manager.snapshot().active, 0);
  const release = await manager.acquire('failed', {
    dispose: async () => {
      throw Error('close failed');
    },
  });
  release();
  await assert.rejects(manager.remove('failed'), /close failed/);
  assert.equal(manager.snapshot().resident, 1);
  await assert.rejects(manager.close(), /could not all be released/);
});

test('invalid configuration fails explicitly rather than removing resource protection', () => {
  assert.throws(
    () => sessionResourceLimits({ INDUSTRIAL_HARNESS_MAX_CONCURRENT_SESSIONS: '0' }),
    /Session limits/,
  );
  assert.throws(
    () => sessionResourceLimits({ INDUSTRIAL_HARNESS_MAX_CONCURRENT_SESSIONS: '8' }),
    /Session limits/,
  );
  assert.throws(() => sessionResourceLimits({ INDUSTRIAL_HARNESS_SESSION_IDLE_MS: '' }), /integer/);
  assert.equal(sessionResourceLimits().maxConcurrent, 4);
});

test('availability includes reclaimable pages instead of treating cached memory as exhausted', () => {
  assert.equal(
    parseAvailableMemory('linux', 'MemFree: 100 kB\nMemAvailable: 4096 kB\n', 10),
    4194304,
  );
  assert.equal(
    parseAvailableMemory(
      'darwin',
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nPages inactive: 100.\nPages speculative: 2.\n',
      10,
    ),
    112 * 16384,
  );
  assert.equal(parseAvailableMemory('darwin', 'unexpected output', 10), 10);
});
