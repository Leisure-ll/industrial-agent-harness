const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { KimiSession } = require('../src/index.cjs');
const { createKimiPaths } = require('@moonshot-ai/kimi-agent-sdk');
const { ChatStore } = require('../../harness-core/src/index.cjs');

test('observer failure during cleanup cannot leave an execution slot or running state behind', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'failed-observer-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'config.toml'), 'default_model="industrial"\n');
  let released = 0;
  const agent = new KimiSession(
    directory,
    () => ({ domain: 'test', stage: 'test', capabilityIds: [], skills: [], tools: [] }),
    () => null,
    () => null,
    event => {
      if (event.type === 'error' || event.type === 'approval-resolved')
        throw Error('Observer failed');
    },
    () => ({ apiKey: 'fixture', profile: { thinking: false }, revision: 0, shareDir: directory }),
    () => ({
      sessionId: 'fixture',
      close: async () => {},
      prompt: () => ({
        result: Promise.resolve({ status: 'finished' }),
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'ApprovalRequest',
            payload: { id: 'pending', action: 'test', description: 'pending' },
          };
          throw Error('Native transport failed');
        },
      }),
    }),
    {
      directory: path.join(directory, 'logs'),
      resolveSession: () => null,
      sessionInitialized: () => {},
      resources: { acquire: async () => () => released++, remove: async () => {} },
    },
  );
  await assert.rejects(agent.run('Fail while an approval is pending.'), /Observer failed/);
  assert.equal(released, 1);
  assert.equal(agent.running, false);
  assert.equal(agent.turn, undefined);
  assert.equal(agent.log, undefined);
  await agent.close();
});

test('Stop while waiting for resource admission prevents a native prompt and releases the slot', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-admission-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let admit,
    released = 0,
    created = 0;
  const events = [];
  const session = new KimiSession(
    directory,
    () => ({ domain: 'test', stage: 'test', capabilityIds: [], skills: [], tools: [] }),
    () => null,
    () => null,
    event => events.push(event),
    () => ({ apiKey: 'fixture', profile: { thinking: false }, revision: 0 }),
    () => {
      created++;
      throw Error('Native session must not start');
    },
    {
      directory: path.join(directory, 'logs'),
      resolveSession: () => null,
      sessionInitialized: () => {},
      resources: {
        acquire: () =>
          new Promise(resolve => {
            admit = resolve;
          }),
        remove: async () => {},
      },
    },
  );
  const run = session.run('This task is cancelled during admission.');
  await session.interrupt();
  admit(() => {
    released++;
  });
  await run;
  assert.equal(created, 0);
  assert.equal(released, 1);
  assert.equal(events.at(-1).result.status, 'cancelled');
  assert.equal(session.running, false);
});

test('adapter resumes persistent IDs after close, rotates scope/model, and preserves missing-context history', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-adapter-resume-'));
  const source = path.join(root, 'config');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'config.toml'), 'default_model="industrial"\n');
  const store = new ChatStore(path.join(root, 'chats'));
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const chat = store.create(root, 'chip');
  let scope = {
    domain: 'chip',
    stage: 'rtl',
    capabilityIds: ['chip.rtl.netlist.inspect'],
    skills: ['chip.netlist.inspect'],
    tools: ['eda.netlist.inspect'],
  };
  const runtime = {
    shareDir: source,
    apiKey: 'test-key',
    profile: { model: 'first', thinking: false },
    revision: 0,
  };
  const options = [],
    emitted = [];
  const factory = settings => {
    options.push(settings);
    const directory = createKimiPaths(settings.shareDir).sessionDir(root, settings.sessionId);
    fs.mkdirSync(directory, { recursive: true });
    return {
      sessionId: settings.sessionId,
      close: async () => {},
      prompt: task => ({
        result: Promise.resolve({ status: 'finished' }),
        async *[Symbol.asyncIterator]() {
          fs.appendFileSync(
            path.join(directory, 'context.jsonl'),
            JSON.stringify({ role: 'user', content: task }) + '\n',
          );
          yield { type: 'ContentPart', payload: { type: 'text', text: 'Persisted' } };
        },
      }),
    };
  };
  const make = () =>
    new KimiSession(
      root,
      () => scope,
      () => null,
      () => null,
      event => emitted.push(event),
      () => runtime,
      factory,
      {
        directory: path.join(root, 'logs'),
        resolveSession: key => store.runtimeSession(chat.id, key),
        sessionInitialized: id => store.initialized(id),
      },
    );
  let adapter = make();
  await adapter.run('First');
  await adapter.run('Second');
  await adapter.close();
  assert.equal(options.length, 1);
  assert.ok(fs.existsSync(options[0].shareDir));
  adapter = make();
  await adapter.run('Third');
  assert.equal(options[0].sessionId, options[1].sessionId);
  assert.equal(options[0].shareDir, options[1].shareDir);
  scope = { ...scope, stage: 'verification' };
  await adapter.run('Changed scope');
  assert.notEqual(options[1].sessionId, options[2].sessionId);
  runtime.profile = { ...runtime.profile, model: 'second' };
  runtime.revision++;
  await adapter.run('Changed model');
  await adapter.close();
  assert.notEqual(options[2].sessionId, options[3].sessionId);
  const latest = options.at(-1);
  fs.unlinkSync(
    path.join(createKimiPaths(latest.shareDir).sessionDir(root, latest.sessionId), 'context.jsonl'),
  );
  adapter = make();
  await adapter.run('Missing context');
  await adapter.close();
  assert.equal(options.length, 4);
  assert.match(emitted.at(-1).message, /context is missing/);
});
