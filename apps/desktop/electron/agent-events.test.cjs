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
