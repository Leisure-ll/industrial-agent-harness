const http = require('node:http');

// Fixed responses drive the unchanged native Kimi agent/tool loop. This is
// protocol regression evidence, never a claim of live-model task quality.
async function startSubagentModel({ file, scenario = 'foreground', mutationFile } = {}) {
  const requests = [];
  const stoppedTasks = new Set();
  let childStartedResolve, releaseResolve;
  const childStarted = new Promise(resolve => (childStartedResolve = resolve));
  const released = new Promise(resolve => (releaseResolve = resolve));
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const child = body.messages.some(
      m =>
        m.role === 'system' && /You are now running as a subagent/.test(JSON.stringify(m.content)),
    );
    const allResults = body.messages.filter(m => m.role === 'tool');
    let lastUser = body.messages.length - 1;
    while (lastUser >= 0 && body.messages[lastUser].role !== 'user') lastUser--;
    const currentResults = body.messages.slice(lastUser + 1).filter(m => m.role === 'tool');
    let calls = [];
    if (child) {
      childStartedResolve();
      if (['background', 'background-approval', 'cancel', 'timeout'].includes(scenario))
        await released;
      if (!allResults.length)
        calls = [
          {
            name: ['reject', 'background-approval'].includes(scenario)
              ? 'Shell'
              : scenario === 'mutation'
                ? 'WriteFile'
                : 'ReadFile',
            arguments: ['reject', 'background-approval'].includes(scenario)
              ? { command: 'printf SUBAGENT_APPROVAL_EXECUTED' }
              : scenario === 'mutation'
                ? { path: mutationFile, content: 'UNAUTHORIZED_NATIVE_MUTATION' }
                : { path: file },
          },
        ];
      if (scenario === 'question' && !allResults.length)
        calls = [
          {
            name: 'AskUserQuestion',
            arguments: {
              questions: [
                {
                  question: '孔径选择?',
                  options: [
                    { label: '36 mm', description: '维持原孔径' },
                    { label: '40 mm', description: '扩大孔径' },
                  ],
                },
              ],
            },
          },
        ];
    } else if (
      body.messages.some(
        m => m.role === 'user' && JSON.stringify(m.content).includes('STOP_BACKGROUND'),
      )
    ) {
      const previous = allResults
        .map(m =>
          typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map(p => (p.type === 'text' ? p.text : '')).join('\n')
              : JSON.stringify(m.content),
        )
        .join('\n');
      const taskId = previous.match(/task_id: (\S+)/)?.[1];
      if (taskId && !stoppedTasks.has(taskId)) {
        stoppedTasks.add(taskId);
        calls = [
          { name: 'TaskList', arguments: {} },
          { name: 'TaskOutput', arguments: { task_id: taskId, block: false } },
          { name: 'TaskStop', arguments: { task_id: taskId } },
        ];
      }
    } else if (
      !currentResults.length &&
      !body.messages.some(
        m => m.role === 'user' && JSON.stringify(m.content).includes('ROOT_ONLY_FOLLOWUP'),
      )
    ) {
      const previous = allResults
        .map(m =>
          typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map(p => (p.type === 'text' ? p.text : '')).join('\n')
              : JSON.stringify(m.content),
        )
        .join('\n');
      const resume = JSON.stringify(body.messages[lastUser]?.content).includes('RESUME_CHILD');
      const types = scenario === 'parallel' && !resume ? ['coder', 'explore', 'plan'] : ['coder'];
      calls = types.map(type => ({
        name: 'Agent',
        arguments: {
          description: `${type} inspect part dimensions`,
          subagent_type: type,
          prompt: `Read ${file} and return a concise inspection summary.`,
          ...(resume ? { resume: previous.match(/agent_id: (\S+)/)?.[1] } : {}),
          run_in_background: scenario.startsWith('background'),
          ...(scenario === 'timeout' ? { timeout: 30 } : {}),
        },
      }));
    }
    const message = calls.length
      ? {
          role: 'assistant',
          content: null,
          tool_calls: calls.map((call, index) => ({
            id: `native-subagent-${requests.length}-${index}`,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        }
      : {
          role: 'assistant',
          content: child ? 'SUBAGENT_INSPECTION_SUMMARY' : 'ROOT_INSPECTION_SUMMARY',
        };
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'subagent-fixture',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [{ index: 0, message, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        }),
      );
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = calls.length
      ? {
          role: 'assistant',
          tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })),
        }
      : message;
    response.write(
      `data: ${JSON.stringify({ id: 'subagent-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
    );
    response.end(
      `data: ${JSON.stringify({ id: 'subagent-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    childStarted,
    setScenario: value => {
      scenario = value;
    },
    release: () => releaseResolve(),
    close: async () => {
      releaseResolve();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
module.exports = { startSubagentModel };
