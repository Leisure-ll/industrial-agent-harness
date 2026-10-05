const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createProcessSandbox } = require('../src/process-sandbox.cjs');
test(
  'native descendants cannot connect to the host approval observer socket',
  { skip: !['darwin', 'linux'].includes(process.platform) },
  async t => {
    const { createWireObserver } = require('../src/wire-observer.cjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'observer-boundary-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const name of ['project', 'share']) fs.mkdirSync(path.join(root, name));
    const observer = await createWireObserver({
      executable: '/usr/bin/python3',
      onMessage: () => {},
    });
    t.after(() => observer.close());
    const sandbox = createProcessSandbox({
      executable: '/usr/bin/python3',
      shareDir: path.join(root, 'share'),
      projectDir: path.join(root, 'project'),
    });
    t.after(() => sandbox.close());
    sandbox.protectHostIpc(
      path.dirname(observer.executable),
      path.join(path.dirname(observer.executable), 'events.sock'),
    );
    const probe = spawnSync(
      sandbox.executable,
      [
        '-c',
        "import socket,sys\ntry:\n s=socket.socket(socket.AF_UNIX);s.connect(sys.argv[1]);print('CONNECTED')\nexcept OSError:\n print('DENIED')",
        path.join(path.dirname(observer.executable), 'events.sock'),
      ],
      { env: sandbox.env, encoding: 'utf8' },
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(probe.stdout.trim(), 'DENIED');
  },
);

test(
  'a real descendant process can write session scratch but cannot overwrite project, lateral files, metadata or sandbox launcher',
  { skip: !['darwin', 'linux'].includes(process.platform) },
  t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    for (const name of ['project', 'share', 'state']) fs.mkdirSync(path.join(directory, name));
    const projectFile = path.join(directory, 'project', 'counter.sv');
    fs.writeFileSync(projectFile, 'engineering source');
    const sandbox = createProcessSandbox({
      executable: '/usr/bin/python3',
      shareDir: path.join(directory, 'share'),
      projectDir: path.join(directory, 'project'),
      protectedPaths: [path.join(directory, 'state')],
      environment: { ...process.env, KIMI_SHARE_DIR: path.join(directory, 'foreign-share') },
    });
    t.after(() => sandbox.close());
    assert.equal(sandbox.env.KIMI_SHARE_DIR, fs.realpathSync(path.join(directory, 'share')));
    fs.symlinkSync(path.join(directory, 'project'), path.join(directory, 'share', 'project-link'));
    const probe = `import json, pathlib, subprocess, sys\nresults=[]\nfor name in sys.argv[1:]:\n try:\n  pathlib.Path(name).write_text('bypass')\n  results.append(True)\n except OSError as error:\n  if error.errno not in (1,13,30): raise\n  results.append(False)\n# Descendants inherit the same restriction, including an arbitrary shell.\np=subprocess.run(['/bin/sh','-c','printf bypass > "$1"','probe',sys.argv[1]],capture_output=True)\nprint(json.dumps({'writes':results,'child':p.returncode}))`;
    const probeResult = spawnSync(
      sandbox.executable,
      [
        '-c',
        probe,
        projectFile,
        path.join(directory, 'outside'),
        path.join(directory, 'state', 'fake.sqlite'),
        sandbox.executable,
        path.join(directory, 'share', 'project-link', 'counter.sv'),
        path.join(directory, 'share', 'context.json'),
      ],
      { env: sandbox.env, encoding: 'utf8' },
    );
    assert.equal(probeResult.status, 0, probeResult.stderr);
    const result = JSON.parse(probeResult.stdout);
    assert.deepEqual(result.writes, [false, false, false, false, false, true]);
    assert.notEqual(result.child, 0);
    assert.equal(fs.readFileSync(projectFile, 'utf8'), 'engineering source');
  },
);
