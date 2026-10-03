const test = require('node:test');
const assert = require('node:assert/strict');

test('late history cannot restore expired approval, duplicate text or resurrect running state', async () => {
  const { mergeHistoryEvents } = await import('../src/chat-history.ts');
  const history = {
    chat: { id: 'a' },
    eventRevision: 2,
    executing: true,
    turns: [{ id: 'turn-a', status: 'running', events: [{ type: 'text', text: 'first' }] }],
  };
  const received = [
    { chatId: 'a', turnId: 'turn-a', eventRevision: 2, type: 'text', text: 'first' },
    { chatId: 'b', turnId: 'turn-b', eventRevision: 10, type: 'text', text: 'OTHER_CHAT' },
    { chatId: 'a', turnId: 'turn-a', eventRevision: 3, type: 'text', text: ' second' },
    {
      chatId: 'a',
      turnId: 'turn-a',
      eventRevision: 4,
      type: 'approval-resolved',
      id: 'shared',
      decision: 'expired',
    },
    {
      chatId: 'a',
      turnId: 'turn-a',
      eventRevision: 5,
      type: 'done',
      result: { status: 'cancelled' },
    },
  ];
  const merged = mergeHistoryEvents(history, received);
  assert.equal(merged.turns[0].events[0].text, 'first second');
  assert.equal(merged.turns[0].status, 'cancelled');
  assert.equal(merged.executing, false);
  assert.equal(merged.eventRevision, 5);
  assert.equal(history.turns[0].status, 'running');
});
