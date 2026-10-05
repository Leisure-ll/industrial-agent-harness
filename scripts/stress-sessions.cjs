const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  ChatStore,
  SessionResourceManager,
  availableMemoryBytes,
} = require('../packages/harness-core/src/index.cjs');
const { KimiSession } = require('../packages/agent-kimi/src/index.cjs');
const {
  validateProfile,
  writeCliConfig,
  sessionEnv,
} = require('../packages/agent-kimi/src/model-config.cjs');
const { startModel } = require('../tests/integration/fixtures/session-resource-model.cjs');
const execute = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const executable =
  process.env.KIMI_EXECUTABLE ||
  require('../packages/agent-kimi/src/code-session.cjs').bundledExecutable();
const limits = {
  maxConcurrent: 4,
  maxResident: 6,
  idleMs: 750,
  minFreeMemoryBytes: 256 * 1024 * 1024,
};

async function worker() {
  const options = JSON.parse(process.env.HARNESS_SESSION_STRESS_OPTIONS);
  const directory = path.join(options.directory, `host-${options.host}`);
  fs.mkdirSync(directory);
  const chats = new ChatStore(path.join(directory, 'chats'));
  const resources = options.protected
    ? new SessionResourceManager({
        directory: path.join(options.directory, 'resources'),
        limits,
        sweepIntervalMs: 50,
      })
    : undefined;
  const profile = validateProfile({
    provider: 'openai_legacy',
    endpoint: options.endpoint,
    model: 'resource-stress',
    contextSize: 262144,
    thinking: false,
  });
  const runtime = {
    profile,
    apiKey: 'local-fixture-key',
    executable,
    revision: 0,
    shareDir: writeCliConfig(directory, profile),
    env: sessionEnv(profile, 'local-fixture-key'),
  };
  let evictions = 0;
  const records = Array.from({ length: options.burst }, (_, index) => {
    const chat = chats.create(directory, 'stress');
    const record = { marker: `SESSION_MARKER_${options.host}_${index}`, events: [] };
    record.agent = new KimiSession(
      directory,
      () => ({ domain: 'stress', stage: 'test', capabilityIds: [], skills: [], tools: [] }),
      () => null,
      () => null,
      event => record.events.push(event),
      () => runtime,
      undefined,
      {
        resources,
        directory: path.join(directory, 'logs'),
        onIdleRelease: () => {
          evictions++;
        },
        resolveSession: key => chats.runtimeSession(chat.id, key),
        sessionInitialized: id => chats.initialized(id),
      },
    );
    return record;
  });
  const run = async (record, task) => {
    record.events = [];
    await record.agent.run(task);
    return record.events.at(-1);
  };
  const checkpoint = async (phase, data) => {
    const proceed = new Promise(resolve => process.once('message', resolve));
    process.send({ phase, ...data });
    if ((await proceed)?.stop) throw Error('Stress host was stopped.');
  };
  try {
    const outcomes = await Promise.all(
      records.map(record => run(record, `Remember ${record.marker}. Reply ACK.`)),
    );
    const accepted = outcomes.filter(event => event?.type === 'done').length;
    const rejected = outcomes.filter(
      event => event?.type === 'error' && /shared limit/.test(event.message),
    ).length;
    assert.equal(
      accepted + rejected,
      records.length,
      JSON.stringify(outcomes.filter(event => event?.type === 'error')),
    );
    await checkpoint('burst', { accepted, rejected });
    for (const record of records.slice(0, 6)) {
      const outcome = await run(record, `Remember ${record.marker}. Reply ACK.`);
      assert.equal(outcome.type, 'done', JSON.stringify(outcome));
    }
    const nativeId = records[0].agent.persistentSession.id;
    await checkpoint('warm', { completed: 6, evictions });
    const idleDeadline = Date.now() + 10000;
    while (resources?.snapshot().resident && Date.now() < idleDeadline) await delay(50);
    if (resources) assert.equal(resources.snapshot().resident, 0);
    await checkpoint('idle', { evictions, resident: resources?.snapshot().resident });
    const outcome = await run(records[0], `Resume ${records[0].marker} after idle. Reply ACK.`);
    assert.equal(outcome.type, 'done', JSON.stringify(outcome));
    assert.equal(records[0].agent.persistentSession.id, nativeId);
    await checkpoint('resumed', { evictions, sameNativeSession: true });
  } finally {
    await Promise.all(records.map(record => record.agent.close()));
    await resources?.close();
    chats.close();
  }
}

async function processSample(hosts) {
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,args=']);
  const rows = stdout
    .split('\n')
    .map(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
      return match
        ? {
            pid: Number(match[1]),
            parent: Number(match[2]),
            rssBytes: Number(match[3]) * 1024,
            cpuPercent: Number(match[4]),
            command: match[5],
          }
        : undefined;
    })
    .filter(Boolean);
  const owned = new Set(hosts);
  let changed;
  do {
    changed = false;
    for (const row of rows)
      if (owned.has(row.parent) && !owned.has(row.pid)) {
        owned.add(row.pid);
        changed = true;
      }
  } while (changed);
  const tree = rows.filter(row => owned.has(row.pid));
  const native = tree.filter(
    row =>
      !hosts.includes(row.pid) &&
      /(?:^|\/)(?:python[\d.]*|kimi(?:-code)?)(?:\s|$)/i.test(row.command),
  );
  return { tree, native };
}

function host(options) {
  const child = fork(__filename, ['--worker'], {
    env: { ...process.env, HARNESS_SESSION_STRESS_OPTIONS: JSON.stringify(options) },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '',
    failure;
  const messages = new Map(),
    waiters = new Map();
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const fail = error => {
    failure = error;
    for (const waiter of waiters.values()) waiter.reject(error);
  };
  child.on('error', fail);
  child.on('exit', code => {
    if (code !== 0) fail(Error(`Stress host exited ${code}: ${stderr}`));
  });
  child.on('message', message => {
    if (message.error) return fail(Error(message.error));
    messages.set(message.phase, message);
    waiters.get(message.phase)?.resolve(message);
  });
  return {
    child,
    abort(error) {
      fail(error);
      if (child.connected) child.send({ stop: true });
    },
    wait(phase) {
      if (failure) return Promise.reject(failure);
      if (messages.has(phase)) return Promise.resolve(messages.get(phase));
      return new Promise((resolve, reject) => waiters.set(phase, { resolve, reject }));
    },
  };
}

async function scenario(protectedMode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-session-stress-'));
  const model = await startModel({ delayMs: 300 });
  const observer = protectedMode
    ? new SessionResourceManager({ directory: path.join(directory, 'resources'), limits })
    : undefined;
  const hosts = [0, 1].map(index =>
    host({
      directory,
      endpoint: model.endpoint,
      host: index,
      protected: protectedMode,
      burst: protectedMode ? 32 : 6,
    }),
  );
  const pids = hosts.map(host => host.child.pid);
  let stopping = false,
    failure;
  const stats = {
    peakNativeProcesses: 0,
    peakNativeRssMiB: 0,
    peakTreeRssMiB: 0,
    peakCpuPercent: 0,
    peakReservedActive: 0,
    peakReservedResident: 0,
    samples: 0,
  };
  const sampling = (async () => {
    while (!stopping) {
      const sample = await processSample(pids);
      stats.peakNativeProcesses = Math.max(stats.peakNativeProcesses, sample.native.length);
      stats.peakNativeRssMiB = Math.max(
        stats.peakNativeRssMiB,
        sample.native.reduce((sum, row) => sum + row.rssBytes, 0) / 2 ** 20,
      );
      stats.peakTreeRssMiB = Math.max(
        stats.peakTreeRssMiB,
        sample.tree.reduce((sum, row) => sum + row.rssBytes, 0) / 2 ** 20,
      );
      stats.peakCpuPercent = Math.max(
        stats.peakCpuPercent,
        sample.tree.reduce((sum, row) => sum + row.cpuPercent, 0),
      );
      stats.samples++;
      if (observer) {
        const usage = observer.snapshot();
        stats.peakReservedActive = Math.max(stats.peakReservedActive, usage.active);
        stats.peakReservedResident = Math.max(stats.peakReservedResident, usage.resident);
        if (
          usage.active > limits.maxConcurrent ||
          usage.resident > limits.maxResident ||
          sample.native.length > limits.maxResident
        )
          throw Error('Observed session capacity exceeded the configured limit.');
      }
      if (availableMemoryBytes() < 512 * 1024 * 1024)
        throw Error('Stress run stopped because the machine memory reserve was reached.');
      await delay(150);
    }
  })().catch(error => {
    failure = error;
    for (const host of hosts) host.abort(error);
  });
  const deadline = setTimeout(() => {
    failure = Error('Stress scenario exceeded 120 seconds.');
    for (const host of hosts) host.child.kill('SIGTERM');
  }, 120000);
  const start = Date.now();
  try {
    const burst = await Promise.all(hosts.map(host => host.wait('burst')));
    if (failure) throw failure;
    console.error(
      `${protectedMode ? 'protected' : 'baseline'} burst: ${burst.reduce((n, item) => n + item.accepted, 0)} accepted, ${burst.reduce((n, item) => n + item.rejected, 0)} rejected`,
    );
    if (protectedMode)
      assert.equal(
        burst.reduce((n, item) => n + item.accepted, 0),
        limits.maxConcurrent,
      );
    for (const host of hosts) host.child.send({ continue: true });
    await Promise.all(hosts.map(host => host.wait('warm')));
    if (failure) throw failure;
    await delay(2000);
    for (const host of hosts) host.child.send({ continue: true });
    const idle = await Promise.all(hosts.map(host => host.wait('idle')));
    const idleNativeProcesses = (await processSample(pids)).native.length;
    if (protectedMode) assert.equal(idleNativeProcesses, 0);
    else assert.equal(idleNativeProcesses, 12);
    for (const host of hosts) host.child.send({ continue: true });
    await Promise.all(hosts.map(host => host.wait('resumed')));
    for (let index = 0; index < 2; index++) {
      const last = model.requests
        .filter(request => JSON.stringify(request.messages).includes(`SESSION_MARKER_${index}_0`))
        .at(-1);
      assert.ok(
        last.messages.some(
          message => message.role === 'assistant' && message.content === 'RESOURCE_TEST_ACK',
        ),
      );
      assert.ok(last.messages.filter(message => message.role === 'user').length >= 2);
    }
    for (const host of hosts) host.child.send({ continue: true });
    await Promise.all(
      hosts.map(
        ({ child }) =>
          new Promise((resolve, reject) => {
            child.once('exit', code =>
              code === 0 ? resolve() : reject(Error(`Stress host failed: ${code}`)),
            );
          }),
      ),
    );
    if (failure) throw failure;
    for (const key of ['peakNativeRssMiB', 'peakTreeRssMiB', 'peakCpuPercent'])
      stats[key] = Number(stats[key].toFixed(2));
    return {
      mode: protectedMode ? 'protected' : 'baseline-without-resource-manager',
      hosts: 2,
      burstAttempts: protectedMode ? 64 : 12,
      burstAccepted: burst.reduce((n, item) => n + item.accepted, 0),
      burstRejected: burst.reduce((n, item) => n + item.rejected, 0),
      sequentialTurns: 12,
      idleNativeProcesses,
      contextResumeVerified: true,
      evictions: idle.reduce((n, item) => n + item.evictions, 0),
      durationMs: Date.now() - start,
      ...stats,
    };
  } finally {
    clearTimeout(deadline);
    stopping = true;
    await sampling;
    const liveHosts = hosts
      .filter(({ child }) => child.exitCode === null)
      .map(({ child }) => child.pid);
    const remaining = liveHosts.length ? (await processSample(liveHosts)).tree : [];
    for (const row of remaining.filter(row => !liveHosts.includes(row.pid))) {
      try {
        process.kill(row.pid, 'SIGTERM');
      } catch {}
    }
    for (const { child } of hosts) if (child.exitCode === null) child.kill('SIGTERM');
    await observer?.close();
    await model.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--worker')) return worker();
  if (!['darwin', 'linux'].includes(process.platform))
    throw Error('This stress sampler requires macOS or Linux ps.');
  if (!fs.existsSync(executable))
    throw Error('Prepare the fixed local Kimi executable before running the stress test.');
  const available = availableMemoryBytes();
  if (available < 2.5 * 2 ** 30)
    throw Error('The baseline comparison requires at least 2.5 GiB estimated available memory.');
  const baseline = await scenario(false);
  const protectedRun = await scenario(true);
  console.log(
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        totalMemoryGiB: os.totalmem() / 2 ** 30,
        initialAvailableMemoryGiB: Number((available / 2 ** 30).toFixed(2)),
        limits,
        method:
          'Real fixed Kimi CLI; two independent Node hosts; local controlled model. Approximate ps samples every 150 ms. RSS is resident memory, not total footprint; ps CPU is a smoothed estimate, with 100% representing one logical core. Baseline burst is deliberately smaller to preserve host headroom. Idle TTL accelerated to 750 ms.',
        baseline,
        protected: protectedRun,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  if (process.send) process.send({ error: error.stack });
  else console.error(error.stack);
  process.exitCode = 1;
});
