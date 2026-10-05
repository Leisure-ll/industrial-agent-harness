const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

// SDK 0.1.8 only exposes a per-prompt event iterator. Observe the native
// transport without changing its agent loop, tools, requests or SDK bytes.
async function createWireObserver({ executable, onMessage, onDisconnect }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-wire-'));
  fs.chmodSync(directory, 0o700);
  const socketPath = path.join(directory, 'events.sock');
  const token = crypto.randomBytes(32).toString('hex');
  const pending = new Map(),
    acknowledgements = new Map();
  let client,
    closed = false,
    sequence = 0;
  const server = net.createServer(socket => {
    let authenticated = false,
      buffer = '';
    const timeout = setTimeout(() => socket.destroy(), 5000);
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 1024 * 1024) return socket.destroy();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try {
          message = JSON.parse(line);
          if (!message || typeof message !== 'object') throw Error('Invalid Wire frame.');
        } catch {
          socket.destroy();
          return;
        }
        if (!authenticated) {
          if (message.token !== token || client || closed) return socket.destroy();
          authenticated = true;
          client = socket;
          clearTimeout(timeout);
          socket.write('{"ready":true}\n');
          continue;
        }
        if (message.ack) {
          const request = acknowledgements.get(message.ack);
          if (request) {
            clearTimeout(request.timer);
            acknowledgements.delete(message.ack);
            message.error ? request.reject(Error(message.error)) : request.resolve();
          }
          continue;
        }
        const envelope = message.envelope;
        if (
          !envelope?.params?.payload ||
          !['ApprovalRequest', 'ApprovalResponse'].includes(envelope.params.type)
        )
          return socket.destroy();
        if (envelope.params.type === 'ApprovalRequest') {
          if (typeof envelope.params.payload.id !== 'string' || envelope.id == null)
            return socket.destroy();
          pending.set(envelope.params.payload.id, envelope.id);
        } else pending.delete(envelope.params.payload.request_id);
        try {
          onMessage(envelope);
        } catch {
          socket.destroy();
          return;
        }
      }
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      if (client !== socket) return;
      client = undefined;
      pending.clear();
      for (const ack of acknowledgements.values()) {
        clearTimeout(ack.timer);
        ack.reject(Error('Native approval connection closed.'));
      }
      acknowledgements.clear();
      if (!closed) onDisconnect?.();
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    fs.chmodSync(socketPath, 0o600);
    const wrapper = path.join(directory, 'kimi');
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(path.join(__dirname, 'wire-proxy.cjs'))} ${quote(executable)} ${quote(socketPath)} ${quote(token)} "$@"\n`,
      { mode: 0o500 },
    );
    return {
      executable: wrapper,
      hasApproval: id => pending.has(id),
      async approve(id, response) {
        if (!client || !pending.has(id)) throw Error('This native approval is no longer pending.');
        if (!['approve', 'approve_for_session', 'reject'].includes(response))
          throw Error('Invalid approval decision.');
        const ack = String(++sequence);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            acknowledgements.delete(ack);
            reject(Error('Native approval delivery timed out.'));
          }, 5000);
          acknowledgements.set(ack, { resolve, reject, timer });
          client.write(JSON.stringify({ ack, id, rpcId: pending.get(id), response }) + '\n');
        });
      },
      async close() {
        closed = true;
        client?.destroy();
        for (const ack of acknowledgements.values()) {
          clearTimeout(ack.timer);
          ack.reject(Error('Native approval connection closed.'));
        }
        acknowledgements.clear();
        pending.clear();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    server.close();
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { createWireObserver };
