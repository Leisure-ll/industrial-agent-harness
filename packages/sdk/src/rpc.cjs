#!/usr/bin/env node
const { StringDecoder } = require('node:string_decoder');
const { createClient, SDK_SCHEMA_VERSION } = require('./index.cjs');

// Newline-framed JSON-RPC 2.0 over stdio; project/domain are fixed at startup.
async function serve(client, input = process.stdin, output = process.stdout) {
  const runs = new Map();
  const decoder = new StringDecoder('utf8');
  let buffer = '',
    overlong = false;
  const send = row => {
    if (output.destroyed) return;
    if (output.writableLength > 4 * 1024 * 1024) {
      output.destroy(Error('RPC consumer is too slow.'));
      return;
    }
    output.write(`${JSON.stringify({ jsonrpc: '2.0', ...row })}\n`);
  };
  const respond = async request => {
    const validId =
      request &&
      (typeof request.id === 'string' || typeof request.id === 'number' || request.id === null);
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || !validId) {
      send({
        id: validId ? request.id : null,
        error: { code: -32600, message: 'A JSON-RPC request requires an id.' },
      });
      return;
    }
    const params = request.params || {};
    if (typeof params !== 'object' || Array.isArray(params)) {
      send({ id: request.id, error: { code: -32602, message: 'params must be an object.' } });
      return;
    }
    try {
      let result;
      if (request.method === 'initialize')
        result = {
          sdkSchemaVersion: SDK_SCHEMA_VERSION,
          project: client.project,
          methods: ['runs.start', 'runs.cancel', 'runs.wait', 'chats.list'],
        };
      else if (request.method === 'runs.start') {
        if ([...runs.values()].filter(row => !row.completed).length >= 4)
          throw Error('At most four active runs are allowed.');
        const handle = client.run(params);
        const row = { handle, completed: false, result: null, error: null };
        runs.set(handle.id, row);
        send({ id: request.id, result: { requestId: handle.id } });
        const drained = (async () => {
          try {
            for await (const event of handle.events)
              send({ method: 'runs.event', params: { requestId: handle.id, event } });
            await handle.result;
          } catch (_) {
            /* Completion uses the result promise's canonical error. */
          }
        })();
        row.completion = drained
          .then(() => handle.result)
          .then(
            value => {
              row.result = value;
              send({ method: 'runs.completed', params: { requestId: handle.id, result: value } });
            },
            error => {
              row.error = {
                code: error.code || 'RUN_FAILED',
                message: error.message,
                details: error.details,
              };
              send({
                method: 'runs.completed',
                params: { requestId: handle.id, error: row.error },
              });
            },
          )
          .finally(() => {
            row.completed = true;
            if (runs.size > 64)
              for (const [key, prior] of runs)
                if (prior.completed && key !== handle.id) {
                  runs.delete(key);
                  if (runs.size <= 64) break;
                }
          });
        return;
      } else if (request.method === 'runs.cancel' || request.method === 'runs.wait') {
        const row = runs.get(params.requestId);
        if (!row) throw Error('Unknown or expired requestId.');
        if (request.method === 'runs.cancel') {
          await row.handle.cancel();
          result = { cancelled: true };
        } else {
          await row.completion;
          result = { result: row.result, error: row.error };
        }
      } else if (request.method === 'chats.list') result = await client.chats(params);
      else {
        send({ id: request.id, error: { code: -32601, message: 'Unknown method.' } });
        return;
      }
      send({ id: request.id, result });
    } catch (error) {
      send({
        id: request.id,
        error: {
          code: -32000,
          message: error.message,
          data: { code: error.code || 'INVALID_REQUEST', details: error.details },
        },
      });
    }
  };
  function consume(text) {
    buffer += text;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (overlong || Buffer.byteLength(line) > 1024 * 1024) {
        overlong = false;
        send({ id: null, error: { code: -32700, message: 'Request exceeds 1 MiB.' } });
        continue;
      }
      if (!line.trim()) continue;
      try {
        void respond(JSON.parse(line));
      } catch (_) {
        send({ id: null, error: { code: -32700, message: 'Invalid JSON.' } });
      }
    }
    if (Buffer.byteLength(buffer) > 1024 * 1024) {
      buffer = '';
      overlong = true;
    }
  }
  input.on('data', chunk => consume(decoder.write(chunk)));
  const done = new Promise(resolve => {
    input.once('end', resolve);
    input.once('error', resolve);
    output.once('error', resolve);
  });
  await done;
  consume(decoder.end());
  if (buffer.trim())
    send({ id: null, error: { code: -32700, message: 'Requests require a final newline.' } });
  await client.close();
}

async function main(argv = process.argv.slice(2)) {
  if (
    argv.length !== 6 ||
    argv[0] !== '--cli' ||
    argv[2] !== '--project-dir' ||
    argv[4] !== '--domain'
  )
    throw Error('Usage: industrial-harness-rpc --cli FILE --project-dir DIR --domain DOMAIN');
  const client = createClient({ cliPath: argv[1], projectDir: argv[3], domain: argv[5] });
  const shutdown = () => {
    void client.close().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  try {
    await serve(client);
  } finally {
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
  }
}
module.exports = { serve, main };
if (require.main === module)
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
