const http = require('node:http');

async function startModel({ delayMs = 30, held = false } = {}) {
  const requests = [];
  const pending = new Set();
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const answer = 'RESOURCE_TEST_ACK';
    const send = () => {
      pending.delete(send);
      if (response.destroyed) return;
      if (body.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const base = { id: 'resource-test', object: 'chat.completion.chunk', created: 1, model: body.model };
        for (const choice of [
          { index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null },
          { index: 0, delta: {}, finish_reason: 'stop' },
        ]) response.write(`data: ${JSON.stringify({ ...base, choices: [choice] })}\n\n`);
        response.end('data: [DONE]\n\n');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ id: 'resource-test', object: 'chat.completion', created: 1,
          model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }));
      }
    };
    if (held) pending.add(send);
    else setTimeout(send, delayMs);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/v1`, requests,
    release() { held = false; for (const send of [...pending]) send(); },
    async waitForRequests(count, timeout = 20000) {
      const end = Date.now() + timeout;
      while (requests.length < count && Date.now() < end)
        await new Promise(resolve => setTimeout(resolve, 20));
      if (requests.length < count) throw Error('Native model request did not arrive.');
    },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { startModel };
