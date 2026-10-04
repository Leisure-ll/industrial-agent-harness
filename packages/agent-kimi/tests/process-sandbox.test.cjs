const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createProcessSandbox } = require('../src/process-sandbox.cjs');

test(
  'a real descendant process can write session scratch but cannot overwrite project, lateral files, metadata or sandbox launcher',
  { skip: process.platform !== 'darwin' },
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
    });
    t.after(() => sandbox.close());
    fs.symlinkSync(path.join(directory, 'project'), path.join(directory, 'share', 'project-link'));
    const probe = `import json, pathlib, subprocess, sys\nresults=[]\nfor name in sys.argv[1:]:\n try:\n  pathlib.Path(name).write_text('bypass')\n  results.append(True)\n except PermissionError:\n  results.append(False)\n# Descendants inherit the same restriction, including an arbitrary shell.\np=subprocess.run(['/bin/sh','-c','printf bypass > "$1"','probe',sys.argv[1]],capture_output=True)\nprint(json.dumps({'writes':results,'child':p.returncode}))`;
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

test('an unverified platform and a writable session nested in a protected project fail before spawning', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(
    () => createProcessSandbox({ platform: 'linux' }),
    /verified process write boundary/,
  );
  if (process.platform === 'darwin')
    assert.throws(
      () =>
        createProcessSandbox({ projectDir: directory, shareDir: directory, executable: '/bin/sh' }),
      /outside the protected/,
    );
});
