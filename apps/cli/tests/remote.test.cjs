const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runRemote } = require('../src/remote.cjs');
const { RemoteSettings } = require('../../../packages/harness-core/src/index.cjs');

test('CLI built-in service needs no name or URL and saves the same project execution preference as Desktop', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-remote-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const environment = { INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'config') };
  let output = '';
  const sink = {
    write: text => {
      output += text;
    },
  };
  await runRemote(['status'], sink, environment);
  assert.equal(JSON.parse(output).status, 'not_configured');
  output = '';
  await runRemote(
    ['use', '--project-dir', directory, '--domain', 'example', '--location', 'remote'],
    sink,
    environment,
  );
  assert.equal(
    new RemoteSettings({
      directory: environment.INDUSTRIAL_HARNESS_CONFIG_DIR,
      environment,
    }).project(directory, 'example').location,
    'remote',
  );
  await assert.rejects(
    runRemote(
      ['sync', '--project-dir', directory, '--domain', 'example', '--file', 'source.txt'],
      sink,
      environment,
    ),
    /unavailable/,
  );
  await assert.rejects(
    runRemote(
      ['use', '--project-dir', directory, '--domain', 'example', '--location', 'invalid'],
      sink,
      environment,
    ),
    /Invalid/,
  );
});
