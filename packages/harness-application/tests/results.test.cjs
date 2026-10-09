const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { TaskService } = require('../src/index.cjs');
const { runtimeTools } = require('../../agent-kimi/src/runtime-tools.cjs');
const { applicationTools } = require('../../agent-kimi/src/application-tools.cjs');
const { startToolServer } = require('../../agent-kimi/src/tool-server.cjs');

function setup(t, script) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-results-')));
  const project = { id: 'project', domain: 'chip', path: path.join(directory, 'project') };
  fs.mkdirSync(project.path);
  const events = [];
  class Kernel {
    constructor(_dir, getScope, _read, _detail, emit, _config, _factory, options) {
      Object.assign(this, { getScope, emit, options });
    }
    async run(task) {
      const tools = runtimeTools(
        this.options.industrialRuntime,
        this.getScope,
        async () => true,
        this.options.onIndustrialResult,
        { getApplicationContext: this.options.getApplicationContext },
      );
      const apply = changes =>
        tools
          .find(tool => tool.name === 'industrial_action_call')
          .handler({
            toolId: 'project.files.apply',
            inputs: { changes },
            expectedStateId: this.getScope().stateId,
          });
      const status = await script({
        task,
        apply,
        kernel: this,
        context: this.options.getApplicationContext(),
        application: applicationTools(this.options.getApplicationContext),
      });
      this.emit({ type: 'done', result: { status: status || 'completed' } });
    }
    async close() {}
  }
  const options = {
    Session: Kernel,
    chatDirectory: path.join(directory, 'chats'),
    resourceDirectory: path.join(directory, 'config'),
    runtimeOptions: { directory: path.join(directory, 'state') },
    getConfig: () => ({}),
    onEvent: (event, metadata) => events.push({ ...event, ...metadata }),
  };
  let tasks = new TaskService(options);
  const chat = tasks.chats.create(project.path, project.domain);
  let entry = tasks.resume(project, chat.id);
  t.after(async () => {
    await tasks.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    project,
    events,
    get tasks() {
      return tasks;
    },
    get entry() {
      return entry;
    },
    async run(task) {
      await tasks.prepare(entry, { task });
      return (await tasks.start(entry, task)).completion;
    },
    async reopen() {
      await tasks.close();
      tasks = new TaskService(options);
      entry = tasks.resume(project, chat.id);
    },
  };
}
const change = (file, content, expectedSha256 = null) => ({ path: file, content, expectedSha256 });

test('ordinary files automatically register real refs, persist once and open only the recorded contents', async t => {
  let fact;
  const f = setup(t, async ({ apply, context }) => {
    const output = JSON.parse((await apply([change('notes.txt', 'first version')])).output);
    fact = f.entry.runtimeBundle.runtime.get('action', output.actionId);
    const before = context.snapshot().revision;
    context.register({ action: fact });
    assert.equal(context.snapshot().revision, before, 'duplicate Action is idempotent');
  });
  const completed = await f.run('write notes');
  const view = completed.results;
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].verifications[0].status, 'not_run');
  assert.equal(view.groups[0].artifacts[0].relativePath, 'notes.txt');
  assert.ok(
    f.events.some(event => event.type === 'results-changed' && event.results.phase === 'running'),
  );
  const group = view.groups[0];
  const request = { turnId: view.turnId, groupId: group.id, artifactId: group.primaryArtifactId };
  assert.equal((await f.tasks.openResult(f.entry, request)).artifact.id, group.primaryArtifactId);
  await f.reopen();
  assert.equal(f.tasks.results(f.entry, view.turnId).groups[0].id, group.id);
  assert.equal(
    f.tasks
      .history(f.project, f.entry.id)
      .turns[0].events.filter(event => event.eventId === `results:${view.turnId}:${fact.id}`)
      .length,
    1,
  );
  fs.writeFileSync(path.join(f.project.path, 'notes.txt'), 'changed');
  await assert.rejects(f.tasks.openResult(f.entry, request), /changed/);
  assert.equal(f.tasks.results(f.entry, view.turnId).groups[0].contentStatus, 'changed');
  const another = f.tasks.chats.create(f.project.path, f.project.domain);
  await assert.rejects(
    f.tasks.openResult(f.tasks.resume(f.project, another.id), request),
    /another chat/,
  );
});
test('explicit replacements preserve history; parallel outputs and optional selection retain all groups', async t => {
  let first, oldContext;
  const f = setup(t, async ({ task, apply, context, application }) => {
    if (task === 'first') {
      await apply([change('a.txt', 'one'), change('b.txt', 'parallel')]);
      first = context.view();
      oldContext = context;
    } else {
      const artifact = first.groups[0].artifacts[0];
      await apply([change('a.txt', 'two', artifact.sha256)]);
      const current = context.view();
      assert.deepEqual(current.groups[0].supersedes, [first.groups[0].id]);
      assert.throws(
        () => context.select({ groupIds: [current.groups[0].id], revision: 0 }),
        /stale/,
      );
      assert.throws(
        () => context.select({ groupIds: ['unknown'], revision: current.revision }),
        /Unknown/,
      );
      assert.throws(
        () =>
          oldContext.select({
            groupIds: [first.groups[0].id],
            revision: oldContext.snapshot().revision,
          }),
        /stale/,
      );
      const selection = application.find(tool => tool.name === 'select_result');
      await selection.handler({
        groupIds: [first.groups[0].id, current.groups[0].id],
        historical: true,
        revision: current.revision,
      });
      const selected = context.view();
      assert.equal(selected.groups.length, 2);
      assert.equal(selected.groups.filter(group => group.historical).length, 1);
      assert.equal(selected.selection.historical, true);
    }
  });
  await f.run('first');
  const second = await f.run('second');
  assert.equal(second.results.groups.length, 2);
  const history = f.tasks.history(f.project, f.entry.id);
  const previous = history.turns[0].events
    .filter(event => event.type === 'results-changed')
    .at(-1).results;
  assert.equal(previous.groups[0].superseded, true);
  assert.equal(previous.groups[1].superseded, false);
  assert.equal(
    f.entry.runtimeBundle.runtime.listActions().length,
    2,
    'selection creates no industrial Action',
  );
});
test('failed request retains visible partial files and does not relabel the preceding success', async t => {
  const f = setup(t, async ({ task, apply }) => {
    await apply([change(task + '.txt', 'actual output')]);
    if (task === 'failure') throw Error('controlled interruption after output');
  });
  const previous = await f.run('success');
  const failed = await f.run('failure');
  assert.equal(failed.status, 'error');
  assert.equal(failed.results.executionStatus, 'error');
  assert.equal(failed.results.groups.length, 1);
  assert.equal(f.tasks.results(f.entry, previous.turnId).requestStatus, 'completed');
  assert.equal(
    f.events.filter(event => event.type === 'results-ready').at(-1).autoPreviewEligible,
    false,
  );
});
test('late results keep the original request, cannot change a newer selection, and background readiness never arms preview', async t => {
  let old, pending;
  const f = setup(t, async ({ task, context, apply, kernel }) => {
    if (task === 'background') {
      old = context;
      kernel.backgroundTasks = true;
      await apply([change('early.txt', 'early')]);
    } else {
      await apply([change('new.txt', 'new')]);
      const view = context.view();
      context.select({ groupIds: [view.groups[0].id], revision: view.revision });
    }
  });
  const first = await f.run('background');
  assert.equal(first.results.phase, 'background');
  f.entry.agent.backgroundTasks = false;
  f.entry.agent.emit({ type: 'background-state', running: false });
  assert.equal(
    f.events.filter(event => event.type === 'results-ready').at(-1).autoPreviewEligible,
    false,
  );
  const runtime = f.entry.runtimeBundle.runtime;
  const state = await runtime.inspect();
  pending = await runtime.execute(
    {
      toolId: 'project.files.apply',
      expectedStateId: state.id,
      inputs: { changes: [change('late.txt', 'late')] },
    },
    { scope: f.entry.scope, approval: true },
  );
  const newer = await f.run('newer');
  const selection = newer.results.selection;
  await old.onIndustrialResult(pending);
  assert.equal(f.tasks.results(f.entry, first.turnId).groups.length, 2);
  assert.deepEqual(f.tasks.results(f.entry, newer.turnId).selection, selection);
  assert.equal(f.events.at(-1).turnId, first.turnId);
});
test('application tools work through the authenticated MCP bridge without an industrial runtime', async t => {
  let selected;
  const context = {
    view: () => ({ revision: 3, groups: [{ id: 'document' }] }),
    select: args => {
      selected = args;
      return context.view();
    },
  };
  const server = await startToolServer(applicationTools(() => context));
  t.after(server.close);
  async function call(name, args) {
    const response = await fetch(server.config.url, {
      method: 'POST',
      headers: {
        ...server.config.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    return response.json();
  }
  const listed = await call('list_results', {});
  assert.equal(JSON.parse(listed.result.content[0].text).revision, 3);
  const result = await call('select_result', { groupIds: ['document'], revision: 3 });
  assert.equal(result.result.isError, false);
  assert.deepEqual(selected.groupIds, ['document']);
  assert.equal(
    (await call('select_result', { groupIds: ['document'], revision: 3, sha256: 'forged' })).result
      .isError,
    true,
  );
});

test('current selection rejects changed bytes while preserving the recorded check', async t => {
  const f = setup(t, async ({ apply, context }) => {
    await apply([change('note.txt', 'recorded')]);
    const view = context.view();
    fs.writeFileSync(path.join(f.project.path, 'note.txt'), 'modified');
    assert.throws(
      () => context.select({ groupIds: [view.groups[0].id], revision: view.revision }),
      /stale or unavailable/,
    );
    assert.equal(context.view().groups[0].verifications[0].status, 'not_run');
  });
  await f.run('create note');
});

test('cancelled requests preserve actual partial outputs and never authorize automatic preview', async t => {
  const f = setup(t, async ({ apply }) => {
    await apply([change('partial.txt', 'saved before cancellation')]);
    return 'cancelled';
  });
  const result = await f.run('cancel after saving');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.results.requestStatus, 'cancelled');
  assert.equal(result.results.groups.length, 1);
  assert.equal(
    f.events.filter(event => event.type === 'results-ready').at(-1).autoPreviewEligible,
    false,
  );
});
