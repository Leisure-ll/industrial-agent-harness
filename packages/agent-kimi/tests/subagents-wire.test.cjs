const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { KimiSession } = require('../src/index.cjs');
const { validateProfile, writeCliConfig, sessionEnv } = require('../src/model-config.cjs');
const { ChatStore, SessionResourceManager } = require('../../harness-core/src/index.cjs');
const { startSubagentModel } = require('../../../tests/integration/fixtures/subagent-model.cjs');
const options = {
  skip: !process.env.KIMI_EXECUTABLE || !['darwin', 'linux'].includes(process.platform),
  timeout: 45000,
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  // Hosted CI includes native CLI startup and tool discovery in this wait.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(30);
  }
  assert.fail('Native subagent did not reach the expected state.');
}
async function setup(t, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-wire-regression-')),
    project = path.join(root, 'project');
  fs.mkdirSync(project);
  const file = path.join(project, 'dimensions.json');
  fs.writeFileSync(file, JSON.stringify({ length: 120, width: 80, bore: 40 }));
  const mutationFile = path.join(project, 'forbidden.txt');
  const model = await startSubagentModel({ file, scenario, mutationFile });
  const profile = validateProfile({
    provider: 'openai_legacy',
    endpoint: model.endpoint,
    model: 'subagent-regression',
    contextSize: 262144,
    thinking: false,
  });
  const runtime = {
    profile,
    apiKey: 'fixture-key',
    shareDir: writeCliConfig(path.join(root, 'model'), profile),
    env: sessionEnv(profile, 'fixture-key'),
    executable: process.env.KIMI_EXECUTABLE,
    revision: 0,
  };
  const events = [],
    chats = new ChatStore(path.join(root, 'chats'));
  const chat = chats.create(project, 'test');
  const resources = new SessionResourceManager({
    directory: path.join(root, 'resources'),
    limits: { maxConcurrent: 1, maxResident: 1, idleMs: 80, minFreeMemoryBytes: 0 },
    sweepIntervalMs: 20,
  });
  let turn;
  const scope = { domain: 'test', stage: 'test', capabilityIds: [], skills: [], tools: [] };
  const session = new KimiSession(
    project,
    () => scope,
    () => null,
    () => null,
    event => {
      events.push(event);
      chats.append(event.turnId || turn, event);
    },
    () => runtime,
    undefined,
    {
      directory: path.join(root, 'logs'),
      resources,
      resolveSession: key => chats.runtimeSession(chat.id, key),
      sessionInitialized: id => chats.initialized(id),
      resolveToolTurn: (id, time) => chats.toolCallTurn(chat.id, id, time),
    },
  );
  t.after(async () => {
    model.release();
    await session.close();
    await resources.close();
    chats.close();
    await model.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const run = async task => {
    turn = chats.beginTurn(chat.id, task);
    await session.run(task, [], { turnId: turn });
    chats.finish(turn, events.findLast(e => e.type === 'done')?.result.status || 'error');
    assert.deepEqual(
      events.filter(e => e.type === 'error'),
      [],
    );
    return turn;
  };
  return { session, events, model, run, scope, chats, chat, resources, root, mutationFile };
}

test(
  'native parallel children retain separate tools, scoped context and resumed history',
  options,
  async t => {
    const f = await setup(t, 'parallel');
    await f.run('Inspect the part. ROOT_ONLY_SECRET');
    const states = f.events.filter(e => e.type === 'subagent-state');
    const ids = new Set(states.map(e => e.agentId));
    assert.equal(ids.size, 3);
    for (const id of ids) {
      assert.equal(states.filter(e => e.agentId === id).at(-1).status, 'completed');
      assert.ok(
        f.events.some(
          e =>
            e.type === 'subagent-event' &&
            e.agentId === id &&
            e.event.type === 'tool-result' &&
            /120/.test(e.event.output),
        ),
      );
    }
    const children = f.model.requests.filter(b =>
      b.messages.some(
        m =>
          m.role === 'system' &&
          /You are now running as a subagent/.test(JSON.stringify(m.content)),
      ),
    );
    assert.ok(children.every(b => !JSON.stringify(b.messages).includes('ROOT_ONLY_SECRET')));
    await f.run('RESUME_CHILD and report the earlier dimensions');
    assert.ok(
      f.events.filter(e => e.type === 'tool-result').some(e => /resumed: true/.test(e.output)),
    );
    assert.ok(children.every(b => !b.tools.some(t => t.function.name === 'Agent')));
  },
);

test(
  'background approval remains actionable after root completion and idle sweep; a later root turn cannot steal its history',
  options,
  async t => {
    const f = await setup(t, 'background-approval');
    const first = await f.run('Inspect the part in the background');
    assert.ok(f.session.hasBackgroundTasks());
    await sleep(200);
    assert.ok(f.session.session);
    const nativeId = f.session.session.sessionId;
    const second = await f.run('ROOT_ONLY_FOLLOWUP: report while the first child is still running');
    assert.notEqual(second, first);
    assert.equal(nativeId, f.session.session.sessionId);
    f.model.release();
    await until(() => f.events.some(e => e.type === 'approval'));
    const approval = f.events.find(e => e.type === 'approval');
    assert.ok(approval.background);
    assert.ok(approval.agentId);
    assert.equal(approval.turnId, first);
    await f.session.approve(approval.id, 'approve');
    await until(() => !f.session.hasBackgroundTasks());
    const completed = f.events
      .filter(e => e.type === 'subagent-state' && e.agentId === approval.agentId)
      .at(-1);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.turnId, first);
    assert.ok(
      f.model.requests.some(b =>
        b.messages.some(
          m =>
            m.role === 'tool' && JSON.stringify(m.content).includes('SUBAGENT_APPROVAL_EXECUTED'),
        ),
      ),
    );
    const history = f.chats.history(
      f.chat.id,
      f.chat.projectDir || path.join(f.root, 'project'),
      'test',
    );
    assert.ok(
      history.turns
        .find(t => t.id === first)
        .events.some(e => e.type === 'approval-resolved' && e.id === approval.id),
    );
    assert.ok(
      !history.turns.find(t => t.id === second).events.some(e => e.agentId === approval.agentId),
    );
    await assert.rejects(f.session.approve(approval.id, 'approve'), /no longer pending/);
    await f.session.closeNative();
    await f.run('ROOT_ONLY_FOLLOWUP: reopen the saved native context');
    assert.equal(f.session.session.sessionId, nativeId);
    assert.equal(
      f.events.filter(e => e.type === 'subagent-state' && e.agentId === approval.agentId).at(-1)
        .turnId,
      first,
    );
  },
);

test(
  'native child rejection, project write denial and foreground cancellation remain observable',
  { ...options, timeout: 120000 },
  async t => {
    await t.test('rejection', async t => {
      const f = await setup(t, 'reject');
      const run = f.run('Inspect part');
      await until(() => f.events.some(e => e.type === 'approval'));
      await f.session.approve(f.events.find(e => e.type === 'approval').id, 'reject');
      await run;
      assert.ok(
        f.events.some(
          e => e.type === 'subagent-event' && e.event.type === 'tool-result' && e.event.error,
        ),
      );
    });
    await t.test('write boundary', async t => {
      const f = await setup(t, 'mutation');
      const run = f.run('Inspect part');
      await until(() => f.events.some(e => e.type === 'approval'));
      await f.session.approve(f.events.find(e => e.type === 'approval').id, 'approve');
      await run;
      assert.ok(!fs.existsSync(f.mutationFile));
      assert.ok(
        f.events.some(
          e => e.type === 'subagent-event' && e.event.type === 'tool-result' && e.event.error,
        ),
      );
    });
    await t.test('native child excluded tools', async t => {
      const f = await setup(t, 'question');
      await f.run('Inspect part with an intentionally excluded child tool');
      assert.ok(!f.events.some(e => e.type === 'question'));
      assert.ok(
        f.events.some(
          e =>
            e.type === 'subagent-event' &&
            e.event.type === 'tool-result' &&
            e.event.error &&
            /AskUserQuestion.*not found/.test(e.event.message),
        ),
      );
    });
    await t.test('cancellation', async t => {
      const f = await setup(t, 'cancel');
      const run = f.run('Inspect part');
      await f.model.childStarted;
      await f.session.interrupt();
      await run;
      assert.equal(f.events.findLast(e => e.type === 'done').result.status, 'cancelled');
      assert.equal(f.events.filter(e => e.type === 'subagent-state').at(-1).status, 'cancelled');
    });
  },
);

test(
  'native Agent timeout returns a failed invocation without changing its original timeout policy',
  options,
  async t => {
    const f = await setup(t, 'timeout');
    await f.run('Inspect part');
    const final = f.events.filter(e => e.type === 'subagent-state').at(-1);
    assert.equal(final.status, 'failed');
    assert.match(final.summary, /timed out|timeout/i);
  },
);
test(
  'root native TaskList, TaskOutput and approved TaskStop preserve background task ownership',
  options,
  async t => {
    const f = await setup(t, 'background');
    const first = await f.run('Inspect in background');
    const childId = f.events.find(e => e.type === 'subagent-state').agentId;
    const stop = f.run('STOP_BACKGROUND: list and inspect the original task, then stop it');
    await until(
      () =>
        f.events.some(e => e.type === 'approval') ||
        f.events.filter(e => e.type === 'done').length > 1,
    );
    assert.ok(f.events.some(e => e.type === 'approval'));
    await f.session.approve(f.events.find(e => e.type === 'approval').id, 'approve');
    await stop;
    await until(() => !f.session.hasBackgroundTasks());
    const state = f.events.filter(e => e.type === 'subagent-state' && e.agentId === childId).at(-1);
    assert.equal(state.status, 'cancelled');
    assert.equal(state.turnId, first);
    for (const name of ['TaskList', 'TaskOutput', 'TaskStop']) {
      const tool = f.events.find(e => e.type === 'tool' && e.name === name);
      assert.ok(tool);
      assert.ok(f.events.some(e => e.type === 'tool-result' && e.id === tool.id && !e.error));
    }
  },
);
test(
  'scope replacement cannot terminate a running background child; shutdown and reopening retain native recovery',
  options,
  async t => {
    const f = await setup(t, 'background');
    const first = await f.run('Inspect in background');
    const nativeId = f.session.session.sessionId;
    f.scope.tools = ['undeclared.test'];
    await f.session.run('Try a different scope', [], { turnId: 'blocked' });
    assert.match(f.events.findLast(e => e.type === 'error').message, /后台任务/);
    assert.equal(f.session.session.sessionId, nativeId);
    assert.ok(f.session.hasBackgroundTasks());
    f.scope.tools = [];
    f.events.splice(
      f.events.findIndex(e => e.type === 'error'),
      1,
    );
    await f.session.closeNative();
    assert.ok(!f.session.hasBackgroundTasks());
    assert.ok(
      ['lost', 'cancelled'].includes(
        f.events.filter(e => e.type === 'subagent-state').at(-1).status,
      ),
    );
    f.model.release();
    await f.run('ROOT_ONLY_FOLLOWUP: recover the interrupted context');
    assert.equal(f.session.session.sessionId, nativeId);
    assert.equal(
      f.events.filter(e => e.type === 'subagent-state' && e.background).at(-1).turnId,
      first,
    );
  },
);
