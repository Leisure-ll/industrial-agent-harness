const test = require('node:test');
const assert = require('node:assert/strict');

test('leading provider reasoning stays separate from Markdown, including partial streamed tags and literal code', async () => {
  const { splitLeadingThinking } = await import('../src/message-content.ts');
  assert.deepEqual(splitLeadingThinking('<think>First</think>\n<think>Second</think>\n## Answer'), {
    thoughts: [
      { text: 'First', incomplete: false },
      { text: 'Second', incomplete: false },
    ],
    body: '## Answer',
  });
  assert.deepEqual(splitLeadingThinking('<think>Still streaming'), {
    thoughts: [{ text: 'Still streaming', incomplete: true }],
    body: '',
  });
  for (const text of ['```xml\n<think>literal</think>\n```', '正文中提及 <think> 标签'])
    assert.deepEqual(splitLeadingThinking(text), { thoughts: [], body: text });
});
