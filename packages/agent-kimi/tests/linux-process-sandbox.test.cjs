const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createProcessSandbox } = require('../src/process-sandbox.cjs');
const execute = promisify(execFile);

test(
  'Linux descendants cannot use a host Unix socket or relax the namespace boundary, while internal socketpairs work',
  { skip: process.platform !== 'linux' },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-boundary-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    for (const name of ['project', 'share']) fs.mkdirSync(path.join(directory, name));
    const socket = path.join(directory, 'host.sock');
    let connected = false;
    const server = net.createServer(client => {
      connected = true;
      client.end();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, resolve);
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const sandbox = createProcessSandbox({
      executable: '/usr/bin/python3',
      projectDir: path.join(directory, 'project'),
      shareDir: path.join(directory, 'share'),
    });
    t.after(() => sandbox.close());
    const probe = `import socket, subprocess, sys, json\ntry:\n s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); denied=False\nexcept PermissionError:\n denied=True\na,b=socket.socketpair(); a.send(b'ok'); pair=b.recv(2)==b'ok'\nrelax=subprocess.run(['unshare','-Ur','true'],capture_output=True)\nprint(json.dumps({'socketDenied':denied,'socketpairWorks':pair,'namespaceDenied':relax.returncode!=0}))`;
    const result = await execute(sandbox.executable, ['-c', probe, socket], { env: sandbox.env });
    assert.deepEqual(JSON.parse(result.stdout), {
      socketDenied: true,
      socketpairWorks: true,
      namespaceDenied: true,
    });
    assert.equal(connected, false);
  },
);
