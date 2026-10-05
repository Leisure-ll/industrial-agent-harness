const http = require('node:http');
const crypto = require('node:crypto');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');

function createExternalTool({ parameters, handler, ...descriptor }) {
  return {
    ...descriptor,
    parameters: z.toJSONSchema(parameters, { target: 'draft-7' }),
    handler: args => handler(parameters.parse(args)),
  };
}

function toolContent(result) {
  if (typeof result.output === 'string') return [{ type: 'text', text: result.output }];
  return (result.output || []).flatMap(part => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }];
    if (part.type === 'image_url') {
      const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(
        part.image_url?.url || '',
      );
      if (match) return [{ type: 'image', mimeType: match[1], data: match[2] }];
    }
    throw Error('Unsupported Harness tool content.');
  });
}

// Host callbacks stay in Harness. Kimi owns the tool loop and reaches them over
// authenticated MCP; the handlers still recheck the current Broker scope.
async function startToolServer(tools) {
  const token = crypto.randomBytes(32).toString('hex');
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  if (byName.size !== tools.length) throw Error('Duplicate Harness tool name.');
  const active = new Set();
  let closed = false;
  const server = http.createServer(async (request, response) => {
    let mcp;
    try {
      if (closed || request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401).end();
        return;
      }
      if (request.headers.host !== `127.0.0.1:${server.address().port}` || request.url !== '/mcp') {
        response.writeHead(403).end();
        return;
      }
      if (request.method !== 'POST') {
        response.writeHead(405).end();
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      mcp = new Server(
        { name: 'industrial-harness-adapter', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map(({ name, description, parameters }) => ({
          name,
          description,
          inputSchema: parameters,
        })),
      }));
      mcp.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        const tool = byName.get(params.name);
        if (!tool || closed) throw Error('Tool is outside the active Harness session.');
        try {
          const result = await tool.handler(params.arguments || {});
          return {
            content: toolContent(result),
            isError: Boolean(result.isError || result.is_error),
          };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: String(error.message) }] };
        }
      });
      active.add(mcp);
      response.on('close', () => {
        active.delete(mcp);
        void mcp.close();
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) response.writeHead(400);
      response.end();
      if (mcp) {
        active.delete(mcp);
        await mcp.close().catch(() => {});
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    config: {
      transport: 'http',
      url: `http://127.0.0.1:${server.address().port}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([...active].map(mcp => mcp.close()));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { createExternalTool, startToolServer, toolContent };
