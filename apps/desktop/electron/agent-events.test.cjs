const test = require('node:test');
const assert = require('node:assert/strict');

test('batched display events preserve streamed content, activity boundaries and the previous render', async () => {
  const { appendDisplayEvents, latestEvent } = await import('../src/agent-events.ts');
  const current = Object.freeze([Object.freeze({ type: 'text', text: 'Hello' })]);
  const events = [
    { type: 'status', contextUsage: 0.1 },
    { type: 'step', number: 1 },
    { type: 'text', text: ' world' },
    { type: 'thinking', text: 'Think' },
    { type: 'thinking', text: ' more' },
    { type: 'tool', id: 'a', name: 'ReadFile', arguments: '{}' },
    { type: 'text', text: 'Done' },
    { type: 'text', text: '.' },
  ];
  const result = appendDisplayEvents(current, events);
  assert.deepEqual(result, [
    { type: 'text', text: 'Hello world' },
    { type: 'status', contextUsage: 0.1 },
    { type: 'step', number: 1 },
    { type: 'thinking', text: 'Think more' },
    { type: 'tool', id: 'a', name: 'ReadFile', arguments: '{}' },
    { type: 'text', text: 'Done.' },
  ]);
  assert.equal(current[0].text, 'Hello');
  assert.equal(latestEvent(result, 'text').text, 'Done.');
  assert.equal(latestEvent(result, 'todo'), undefined);
  assert.equal(appendDisplayEvents(result, []), result);
});

test('streamed text keeps its first receipt time across later chunks and a restored history', async () => {
  const { appendDisplayEvents } = await import('../src/agent-events.ts');
  const first = { type: 'text', text: 'First', recordedAt: '2026-10-08T05:54:45.000Z' };
  const later = { type: 'text', text: ' second', recordedAt: '2026-10-08T05:55:01.000Z' };
  assert.deepEqual(appendDisplayEvents([first], [later]), [{ ...first, text: 'First second' }]);
  // Legacy history has no receipt time: do not invent a time for its first chunk.
  assert.deepEqual(appendDisplayEvents([{ type: 'text', text: 'Old' }], [later]), [
    { type: 'text', text: 'Old second' },
  ]);
});
