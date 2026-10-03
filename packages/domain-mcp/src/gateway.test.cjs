const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { providerRuntime, sourceHash, gatewayConfig } = require('./gateway.cjs');

test('provider resolution pins source and requires explicit absolute runtime overrides', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-runtime-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'eda-harness');
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  for (const [name, text] of [
    ['pyproject.toml', 'fixture'],
    ['uv.lock', 'fixture'],
    ['src/runtime.py', 'fixture'],
  ])
    fs.writeFileSync(path.join(source, name), text);
  const python = path.join(directory, 'python');
  fs.writeFileSync(python, 'fixture executable never launched');
  const provider = {
    id: 'fixture',
    title: 'Fixture',
    directoryEnv: 'FIXTURE_PACK',
    pythonEnv: 'FIXTURE_PYTHON',
    sourceSha256: sourceHash(source),
  };
  const environment = { FIXTURE_PACK: directory, FIXTURE_PYTHON: python };
  assert.deepEqual(providerRuntime(provider, environment), {
    sourceDir: fs.realpathSync(source),
    python,
  });
  assert.throws(
    () => providerRuntime(provider, { ...environment, FIXTURE_PACK: 'relative' }),
    /absolute/,
  );
  assert.throws(
    () => providerRuntime(provider, { ...environment, FIXTURE_PYTHON: 'relative' }),
    /Python environment/,
  );
  assert.throws(
    () => gatewayConfig(directory, provider, undefined, environment),
    /explicit absolute project/,
  );
  fs.writeFileSync(path.join(source, 'src/runtime.py'), 'changed');
  assert.throws(() => providerRuntime(provider, environment), /registered snapshot/);
});
