// A transparent stdio bridge around the unchanged, protected native CLI.
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const [executable, socketPath, token, ...args] = process.argv.slice(2);
const socket = net.createConnection(socketPath);
const pending = new Map();
let child,
  buffer = '',
  started = false,
  stopping = false,
  killTimer;
socket.setEncoding('utf8');
socket.on('connect', () => socket.write(JSON.stringify({ token }) + '\n'));
socket.on('error', fail);
socket.on('close', () => {
  if (!stopping) fail();
});
socket.on('data', chunk => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 65536) return fail();
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return fail();
    }
    if (!started) {
      if (!message.ready) return fail();
      started = true;
      start();
      continue;
    }
    if (!message.ack) continue;
    if (
      !child?.stdin.writable ||
      pending.get(message.id) !== message.rpcId ||
      !['approve', 'approve_for_session', 'reject'].includes(message.response)
    ) {
      socket.write(
        JSON.stringify({ ack: message.ack, error: 'This native approval is no longer pending.' }) +
          '\n',
      );
      continue;
    }
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: message.rpcId,
        result: { request_id: message.id, response: message.response },
      }) + '\n',
      error => {
        if (!error) pending.delete(message.id);
        socket.write(
          JSON.stringify({
            ack: message.ack,
            ...(error ? { error: 'Native approval delivery failed.' } : {}),
          }) + '\n',
        );
      },
    );
  }
});
function start() {
  // The observer socket/token are argv of this host bridge, never native env.
  const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
  child = spawn(executable, args, {
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stderr.pipe(process.stderr);
  child.stdout.pipe(process.stdout);
  child.stdin.on('error', () => {});
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    try {
      const msg = JSON.parse(line);
      if (msg.result?.request_id) pending.delete(msg.result.request_id);
    } catch {}
    if (child.stdin.writable) child.stdin.write(line + '\n');
  });
  input.on('close', () => child.stdin.end());
  const output = createInterface({ input: child.stdout });
  output.on('line', line => {
    // Observe only approvals. Large tool results and image data remain solely
    // on the official SDK transport, with its existing display/redaction.
    if (!line.includes('ApprovalRequest') && !line.includes('ApprovalResponse')) return;
    let envelope;
    try {
      envelope = JSON.parse(line);
    } catch {
      return;
    }
    const type = envelope.params?.type;
    if (type === 'ApprovalRequest') pending.set(envelope.params.payload.id, envelope.id);
    else if (type === 'ApprovalResponse') pending.delete(envelope.params.payload.request_id);
    else return;
    if (Buffer.byteLength(line) > 512 * 1024) return fail();
    socket.write(JSON.stringify({ envelope }) + '\n');
  });
  child.on('error', fail);
  child.on('close', code => {
    stopping = true;
    clearTimeout(killTimer);
    input.close();
    output.close();
    socket.end();
    process.exitCode = code || 0;
  });
}
function signal(kind) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill(kind);
    else process.kill(-child.pid, kind);
  } catch {}
}
function stop() {
  stopping = true;
  signal('SIGTERM');
  if (!child) {
    socket.destroy();
    process.exitCode = 1;
    return;
  }
  killTimer = setTimeout(() => signal('SIGKILL'), 2000);
  killTimer.unref();
}
function fail() {
  process.stderr.write('Native Wire observation channel closed.\n');
  stop();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
