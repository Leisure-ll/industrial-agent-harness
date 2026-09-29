const http = require('node:http');

// Controlled model responses exercise the real pinned Kimi runtime and its MCP approvals.
// They do not claim an LLM inference or an industrial signoff.
async function startModel(options = {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const results = body.messages.filter(message => message.role === 'tool');
    const rejected = results.some(message => /reject|denied/i.test(JSON.stringify(message.content)));
    const index = results.length;
    const calls = options.calls || [
      {name: 'domain_tool_describe', arguments: {toolId: 'eda.harness.create_goal'}},
      {name: 'domain_tool_call', arguments: {toolId: 'eda.harness.create_goal', arguments: {description: 'MCP_INTEGRATION_GOAL', constraints: {}, required_verification: []}}},
      {name: 'domain_tool_call', arguments: {toolId: 'eda.harness.get_operational_context', arguments: {}}},
    ];
    const call = !rejected && calls[index];
    const message = call ? {role: 'assistant', content: null, tool_calls: [{id: `mcp-call-${index}`, type: 'function', function: {name: call.name, arguments: JSON.stringify(call.arguments)}}]} : {role: 'assistant', content: rejected ? 'MCP_REJECTED' : 'MCP_CONTEXT_CONFIRMED'};
    if (body.stream) {
      response.writeHead(200, {'Content-Type': 'text/event-stream'});
      const delta = call ? {role: 'assistant', tool_calls: [{index: 0, ...message.tool_calls[0]}]} : message;
      response.write(`data: ${JSON.stringify({id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{index: 0, delta, finish_reason: null}]})}\n\n`);
      response.end(`data: ${JSON.stringify({id: 'fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}})}\n\ndata: [DONE]\n\n`);
    } else {response.writeHead(200, {'Content-Type': 'application/json'}); response.end(JSON.stringify({id: 'fixture', object: 'chat.completion', created: 1, model: body.model, choices: [{index: 0, message, finish_reason: call ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}}));}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {endpoint: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => {server.closeAllConnections(); server.close();}};
}
module.exports = {startModel};
