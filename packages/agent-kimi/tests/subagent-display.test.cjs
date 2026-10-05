const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { SubagentEvents } = require('../src/subagent-events.cjs');
const { NativeTaskReader } = require('../src/native-task-reader.cjs');
function fixture() {
  const events = [];
  const projector = new SubagentEvents({
    emit: e => events.push(e),
    sessionId: 'native',
    originTurnId: 'first',
    parentArguments: () => JSON.stringify({ description: '检查零件', subagent_type: 'explore' }),
    resolveOrigin: () => 'first',
  });
  const wire = (agent, type, payload) =>
    projector.wire({
      parent_tool_call_id: 'same-parent',
      agent_id: agent,
      subagent_type: 'explore',
      event: { type, payload },
    });
  return { projector, events, wire };
}
test('parallel tool fragments stay with their native child and resumed calls keep a separate turn identity', () => {
  const { projector, events, wire } = fixture();
  for (const a of ['a', 'b'])
    wire(a, 'ToolCall', { id: 'same-tool', function: { name: 'ReadFile', arguments: '' } });
  wire('a', 'ToolCallPart', { arguments_part: '{"path":"a"}' });
  wire('b', 'ToolCallPart', { arguments_part: '{"path":"b"}' });
  for (const a of ['a', 'b'])
    wire(a, 'ToolResult', { tool_call_id: 'same-tool', return_value: { output: a } });
  const tools = events.filter(
    e => e.type === 'subagent-event' && e.event.type === 'tool' && e.event.arguments,
  );
  assert.equal(tools[0].event.arguments, '{"path":"a"}');
  assert.equal(tools[1].event.arguments, '{"path":"b"}');
  projector.finish('same-parent', { output: 'agent_id: a\n[summary]\nFinished' });
  projector.originTurnId = 'second';
  wire('a', 'ContentPart', { type: 'text', text: 'Resumed' });
  assert.notEqual(
    events.find(e => e.type === 'subagent-state' && e.agentId === 'a').id,
    events.at(-1).id,
  );
  assert.equal(events.at(-1).turnId, 'second');
});
test('child display omits images and bounds long output without changing native results', () => {
  const { projector, events, wire } = fixture();
  wire('a', 'ToolResult', {
    tool_call_id: 'image',
    return_value: {
      output: [
        { type: 'image_url', image_url: { url: 'PRIVATE_IMAGE_BYTES' } },
        { type: 'text', text: 'Visible text' },
      ],
    },
  });
  assert.ok(!JSON.stringify(events).includes('PRIVATE_IMAGE_BYTES'));
  wire('a', 'ToolResult', { tool_call_id: 'long', return_value: { output: 'x'.repeat(20000) } });
  assert.equal(events.at(-1).event.output.length, 12000);
  assert.equal(events.at(-1).event.outputTruncated, true);
  for (let i = 0; i < 40; i++) wire('a', 'ContentPart', { type: 'text', text: '中'.repeat(2000) });
  assert.ok(events.some(e => e.type === 'subagent-state' && e.truncated));
  projector.finish('same-parent', { output: 'agent_id: a\n[summary]\nNative summary' });
  assert.equal(events.at(-1).status, 'completed');
  assert.equal(events.at(-1).summary, 'Native summary');
  projector.finish('background-parent', {
    output: [
      { type: 'text', text: 'agent_id: background-a\nactual_subagent_type: plan\ntask_id: task-a' },
    ],
  });
  assert.equal(events.at(-1).taskId, 'task-a');
  assert.equal(events.at(-1).background, true);
});
test('rolling bounded task scans retain busy status until late entries are inspected', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-scan-test-')),
    dir = path.join(root, 'session');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < 129; i++) {
    const task = path.join(dir, 'tasks', 'task-' + i);
    fs.mkdirSync(task, { recursive: true });
    fs.writeFileSync(
      path.join(task, 'spec.json'),
      JSON.stringify({ id: 'task-' + i, kind: 'bash' }),
    );
    fs.writeFileSync(path.join(task, 'runtime.json'), JSON.stringify({ status: 'running' }));
  }
  const { projector } = fixture(),
    reader = new NativeTaskReader({ directory: dir, shareDir: root, projector });
  t.after(() => reader.close());
  reader.poll();
  assert.ok(reader.busy());
  reader.poll();
  assert.equal(reader.activeTasks.size, 129);
  for (let i = 0; i < 129; i++)
    fs.writeFileSync(
      path.join(dir, 'tasks', 'task-' + i, 'runtime.json'),
      JSON.stringify({ status: 'completed' }),
    );
  reader.poll();
  reader.poll();
  assert.ok(!reader.busy());
});
test('background file observation isolates corrupt frames, partial UTF-8, origins and oversized metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-reader-test-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const dir = path.join(root, 'session'),
    task = path.join(dir, 'tasks', 'task-a'),
    child = path.join(dir, 'subagents', 'agent-a');
  fs.mkdirSync(task, { recursive: true });
  fs.mkdirSync(child, { recursive: true });
  const { projector, events } = fixture();
  projector.originTurnId = 'second';
  fs.writeFileSync(
    path.join(task, 'spec.json'),
    JSON.stringify({
      id: 'task-a',
      kind: 'agent',
      tool_call_id: 'same-parent',
      description: 'Background',
      created_at: 10,
      kind_payload: { agent_id: 'agent-a', subagent_type: 'plan' },
    }),
  );
  fs.writeFileSync(path.join(task, 'runtime.json'), JSON.stringify({ status: 'running' }));
  const file = path.join(child, 'wire.jsonl');
  const row = Buffer.from(
    JSON.stringify({
      timestamp: 11,
      message: { type: 'ContentPart', payload: { type: 'text', text: '零件' } },
    }) + '\n',
  );
  const split = row.indexOf(Buffer.from('件')) + 1;
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from('corrupt\n{"timestamp":11,"message":{"type":"ToolResult","payload":{}}}\n'),
      row.subarray(0, split),
    ]),
  );
  const reader = new NativeTaskReader({ directory: dir, shareDir: root, projector });
  t.after(() => reader.close());
  reader.poll();
  assert.ok(reader.busy());
  assert.ok(!events.some(e => e.type === 'subagent-event'));
  fs.appendFileSync(file, row.subarray(split));
  reader.poll();
  const content = events.find(e => e.type === 'subagent-event');
  assert.equal(content.event.text, '零件');
  assert.equal(content.turnId, 'first');
  assert.throws(() => reader.open('../escape'), /Invalid native task path/);
  fs.writeFileSync(path.join(task, 'runtime.json'), 'x'.repeat(65000 + 1024));
  assert.doesNotThrow(() => reader.poll());
  fs.writeFileSync(path.join(task, 'runtime.json'), JSON.stringify({ status: 'completed' }));
  fs.writeFileSync(path.join(task, 'output.log'), '[summary]\nFinal summary');
  reader.poll();
  assert.ok(!reader.busy());
  assert.equal(events.at(-1).summary, 'Final summary');
  assert.equal(events.at(-1).turnId, 'first');
  fs.appendFileSync(
    file,
    JSON.stringify({
      timestamp: 12,
      message: { type: 'ContentPart', payload: { type: 'text', text: 'NEW_RESUMED_TASK' } },
    }) + '\n',
  );
  reader.poll();
  assert.ok(!JSON.stringify(events).includes('NEW_RESUMED_TASK'));
});
