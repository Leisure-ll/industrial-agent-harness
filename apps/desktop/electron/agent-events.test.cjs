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
test('child display state updates in place while content and other children remain immutable', async () => {
  const { appendDisplayEvents } = await import('../src/agent-events.ts');
  const state = Object.freeze({ type: 'subagent-state', id: 'a', status: 'running' });
  const text = Object.freeze({
    type: 'subagent-event',
    id: 'a',
    event: Object.freeze({ type: 'text', text: '零' }),
  });
  const current = Object.freeze([state, text]);
  const result = appendDisplayEvents(current, [
    { type: 'subagent-state', id: 'a', status: 'completed' },
    { type: 'subagent-event', id: 'a', event: { type: 'text', text: '件' } },
    { type: 'subagent-event', id: 'b', event: { type: 'text', text: 'Other' } },
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0].status, 'completed');
  assert.equal(result[1].event.text, '零件');
  assert.equal(current[0].status, 'running');
  assert.equal(current[1].event.text, '零');
});
