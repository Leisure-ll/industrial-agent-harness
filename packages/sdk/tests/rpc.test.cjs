const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

test('stdio RPC drives real CLI scope execution and returns its terminal result', async t => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-rpc-test-'));
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  const child = spawn(
    process.execPath,
    [
      path.resolve(__dirname, '../src/rpc.cjs'),
      '--cli',
      path.resolve(__dirname, '../../../apps/cli/src/main.cjs'),
      '--project-dir',
      projectDir,
      '--domain',
      'chip',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  t.after(() => child.kill());
  const rows = [];
  const iterator = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = request => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...request }) + '\n');
  send({ id: 1, method: 'initialize' });
  const initialized = JSON.parse((await iterator.next()).value);
  assert.equal(initialized.result.project.domain, 'chip');
  send({
    id: 2,
    method: 'runs.start',
    params: { task: 'Inspect netlist signals', scopeOnly: true },
  });
  let requestId, complete;
  while (!complete) {
    const row = JSON.parse((await iterator.next()).value);
    rows.push(row);
    if (row.id === 2) requestId = row.result.requestId;
    if (row.method === 'runs.completed') complete = row;
  }
  assert.ok(rows.some(row => row.params?.event?.type === 'scope'));
  assert.equal(complete.params.requestId, requestId);
  assert.equal(complete.params.result.result.status, 'scoped');
  send({ id: 3, method: 'runs.wait', params: { requestId } });
  assert.equal(JSON.parse((await iterator.next()).value).result.result.result.status, 'scoped');
  const closed = new Promise(resolve => child.once('close', resolve));
  child.stdin.end();
  await closed;
});
