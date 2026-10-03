const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionManager } = require('./session-manager.cjs');
test('reset reserves all targeted chats; failed cleanup waits for slower siblings and remains retryable', async () => {
  const manager = new SessionManager();
  const project = { id: 'p', path: '/p', domain: 'example' };
  const first = manager.get(project, 'one'),
    second = manager.get(project, 'two');
  let finish;
  first.agent = {
    close: async () => {
      throw Error('close failed');
    },
  };
  second.agent = {
    close: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  };
  let settled = false;
  const reset = manager.reset('p').catch(error => {
    settled = true;
    return error;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.busy(second), true);
  assert.equal(settled, false);
  finish();
  assert.ok((await reset) instanceof AggregateError);
  assert.equal(manager.entries.has('two'), false);
  assert.equal(manager.busy(first), false);
  first.agent.close = async () => {};
  await manager.reset('p');
});
test('shutdown waits for every actor despite an early failure and blocks new sessions', async () => {
  const manager = new SessionManager();
  const project = { id: 'p', path: '/p', domain: 'example' };
  let finish,
    released = 0;
  manager.get(project, 'one').agent = {
    close: async () => {
      throw Error('early failure');
    },
  };
  const second = manager.get(project, 'two');
  second.agent = {
    close: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  };
  second.release = () => {
    released++;
  };
  let settled = false;
  const closing = manager.close().catch(error => {
    settled = true;
    return error;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.throws(() => manager.get(project, 'new'), /shutting down/);
  finish();
  assert.ok((await closing) instanceof AggregateError);
  assert.equal(released, 1);
  assert.equal(manager.entries.size, 0);
});
test('failed history finalization still releases both execution and pack leases', () => {
  const { finishTurn } = require('./session-manager.cjs');
  let released = 0,
    notified = 0;
  const entry = { release: () => released++, releasePack: () => released++ };
  assert.throws(
    () =>
      finishTurn(
        entry,
        () => {
          throw Error('disk full');
        },
        () => notified++,
      ),
    /disk full/,
  );
  assert.equal(released, 2);
  assert.equal(notified, 1);
  assert.equal(entry.release, undefined);
  assert.equal(entry.releasePack, undefined);
});
test('running chats remain bound to their own project and scope across navigation; settings affect only their project', async () => {
  const manager = new SessionManager();
  const projectA = { id: 'a', path: '/project/a', domain: 'example' };
  const projectB = { id: 'b', path: '/project/b', domain: 'example' };
  const a1 = manager.get(projectA, 'a1'),
    a2 = manager.get(projectA, 'a2'),
    b = manager.get(projectB, 'b');
  a1.scope = { tools: ['a.tool'] };
  a2.scope = { tools: ['a.other'] };
  b.scope = { tools: ['b.tool'] };
  a1.agent = { running: true };
  a2.release = () => {};
  assert.equal(manager.running().length, 2);
  assert.equal(manager.get(projectA, 'a1'), a1);
  assert.throws(() => manager.get(projectB, 'a1'), /another project/);
  assert.deepEqual(a1.scope.tools, ['a.tool']);
  assert.deepEqual(a2.scope.tools, ['a.other']);
  await assert.rejects(manager.remove(projectA, 'a1'), /Stop this chat/);
  await assert.rejects(manager.reset('a'), /running chats/);
  await manager.reset('b');
  assert.equal(manager.entries.has('b'), false);
  assert.equal(manager.entries.has('a1'), true);
  a1.agent.running = false;
  a1.agent.close = async () => {};
  a2.release = undefined;
  await manager.reset();
  assert.equal(manager.entries.size, 0);
});
test('shutdown closes and releases every session even when one close fails', async () => {
  const manager = new SessionManager();
  let released = 0;
  for (const id of ['one', 'two']) {
    const entry = manager.get({ id: 'p', path: '/p', domain: 'example' }, id);
    entry.agent = {
      close: async () => {
        if (id === 'one') throw Error('shutdown failure');
      },
    };
    entry.release = () => released++;
  }
  await assert.rejects(manager.close(), /shutdown failure/);
  assert.equal(released, 2);
});
test('deleting an idle chat reserves it until its native session has closed', async () => {
  const manager = new SessionManager();
  const project = { id: 'p', path: '/p', domain: 'example' };
  const entry = manager.get(project, 'chat');
  let finish;
  entry.agent = {
    close: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  };
  const removing = manager.remove(project, 'chat');
  assert.equal(manager.busy(entry), true);
  await assert.rejects(manager.remove(project, 'chat'), /Stop this chat/);
  finish();
  await removing;
  assert.equal(manager.entries.has('chat'), false);
});
