const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ChatStore, SessionResourceManager } = require('../../packages/harness-core/src/index.cjs');
const { KimiSession } = require('../../packages/agent-kimi/src/index.cjs');
const {
  validateProfile,
  writeCliConfig,
  sessionEnv,
} = require('../../packages/agent-kimi/src/model-config.cjs');
const { startModel } = require('./fixtures/session-resource-model.cjs');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const executable =
  process.env.KIMI_EXECUTABLE || path.join(root, 'apps/desktop/.venv-kimi/bin/kimi');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test(
  'SIGKILL followed by repeated Stop settles one native turn, preserves another and resumes saved context',
  { skip: process.platform === 'win32' || !fs.existsSync(executable), timeout: 30000 },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-dirty-session-'));
    const projectDir = path.join(directory, 'project');
    fs.mkdirSync(projectDir);
    const resources = new SessionResourceManager({
      directory: path.join(directory, 'resources'),
      limits: { maxConcurrent: 2, maxResident: 2, idleMs: 10000, minFreeMemoryBytes: 0 },
    });
    const chats = new ChatStore(path.join(directory, 'chats'));
    const firstModel = await startModel(),
      secondModel = await startModel({ held: true });
    const agents = [];
    t.after(async () => {
      firstModel.release();
      secondModel.release();
      await Promise.all(agents.map(agent => agent.close()));
      await resources.close();
      chats.close();
      await Promise.all([firstModel.close(), secondModel.close()]);
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const make = model => {
      const chat = chats.create(projectDir, 'test');
      const profile = validateProfile({
        provider: 'openai_legacy',
        endpoint: model.endpoint,
        model: 'dirty-test',
        contextSize: 262144,
        thinking: false,
      });
      const runtime = {
        profile,
        apiKey: 'local-fixture-key',
        executable,
        revision: 0,
        shareDir: writeCliConfig(path.join(directory, chat.id), profile),
        env: sessionEnv(profile, 'local-fixture-key'),
      };
      const events = [];
      const agent = new KimiSession(
        projectDir,
        () => ({ domain: 'test', stage: 'test', capabilityIds: [], skills: [], tools: [] }),
        () => null,
        () => null,
        event => events.push(event),
        () => runtime,
        undefined,
        {
          resources,
          directory: path.join(directory, 'logs'),
          resolveSession: key => chats.runtimeSession(chat.id, key),
          sessionInitialized: id => chats.initialized(id),
        },
      );
      agents.push(agent);
      return { agent, events };
    };
    const first = make(firstModel),
      second = make(secondModel);
    await first.agent.run('Remember DIRTY_MEMORY_MARKER.');
    assert.equal(first.events.at(-1).type, 'done');
    const nativeId = first.agent.session.sessionId;
    const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,comm=']);
    const owned = stdout
      .split('\n')
      .map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
      .filter(
        match =>
          match && Number(match[2]) === process.pid && /(?:kimi|python)(?:\s|$)/i.test(match[3]),
      );
    assert.equal(owned.length, 1, 'only the first test-owned native process is selected');
    const firstPid = Number(owned[0][1]);
    firstModel.hold();
    const firstRun = first.agent.run('Wait for a response that will be interrupted.');
    await firstModel.waitForRequests(2);
    const secondRun = second.agent.run('Keep the independent second chat running.');
    await secondModel.waitForRequests(1);
    process.kill(firstPid, 'SIGKILL');
    await delay(150);
    // Exercise the pinned SDK's unsettled-result edge rather than assuming
    // signal termination is equivalent to a clean native completion.
    assert.equal(first.agent.running, true);
    const stopStarted = Date.now();
    await Promise.all([first.agent.interrupt(), first.agent.interrupt()]);
    t.diagnostic(`Production Stop fallback settled in ${Date.now() - stopStarted} ms.`);
    await firstRun;
    assert.equal(first.events.at(-1).result.status, 'cancelled');
    assert.equal(first.agent.running, false);
    assert.equal(second.agent.running, true);
    assert.equal(resources.snapshot().active, 1);
    secondModel.release();
    await secondRun;
    assert.equal(second.events.at(-1).result.status, 'finished');
    firstModel.release();
    await first.agent.run('Continue the earlier chat after the killed process.');
    assert.equal(first.events.at(-1).result.status, 'finished');
    assert.equal(first.agent.session.sessionId, nativeId);
    assert.ok(JSON.stringify(firstModel.requests.at(-1).messages).includes('DIRTY_MEMORY_MARKER'));
    assert.equal(resources.snapshot().active, 0);
  },
);
