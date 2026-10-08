const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createResultFixture } = require('./result-fixture.cjs');
const { resolveResultArtifact } = require('./result-artifacts.cjs');

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'result-artifacts-'));
  const result = await createResultFixture(
    path.join(directory, 'project'),
    path.join(directory, 'state'),
  );
  t.after(() => {
    result.runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { ...result, directory };
}
const request = result => ({ actionId: result.action.id, artifactId: result.artifacts[0].id });

test('outputs with the same filename resolve to their own durable action, including failed verification', async t => {
  const { runtime, results } = await fixture(t);
  const first = await resolveResultArtifact(runtime, request(results[0]));
  const failed = await resolveResultArtifact(runtime, request(results[2]));
  assert.notEqual(first.file, failed.file);
  assert.equal(fs.readFileSync(first.file, 'utf8'), 'measured=42\n');
  assert.equal(fs.readFileSync(failed.file, 'utf8'), 'measured=41\n');
  assert.equal(results[2].action.status, 'completed');
  assert.equal(results[2].verification.status, 'failed');
});

test('an artifact cannot be opened through another action or another project', async t => {
  const { runtime, results, directory } = await fixture(t);
  await assert.rejects(
    resolveResultArtifact(runtime, {
      actionId: results[2].action.id,
      artifactId: results[0].artifacts[0].id,
    }),
    /does not belong/,
  );
  const other = await createResultFixture(
    path.join(directory, 'other'),
    path.join(directory, 'other-state'),
  );
  try {
    await assert.rejects(
      resolveResultArtifact(other.runtime, request(results[0])),
      /does not belong/,
    );
  } finally {
    other.runtime.close();
  }
});

test('changing a recorded output rejects the shortcut while the immutable CAS evidence remains readable', async t => {
  const { runtime, results } = await fixture(t);
  const original = results[0].artifacts[0];
  fs.writeFileSync(path.join(runtime.projectDir, original.relativePath), 'measured=43\n');
  await assert.rejects(
    resolveResultArtifact(runtime, request(results[0])),
    /changed since the action/,
  );
  assert.equal(runtime.readArtifact(original.id).content.toString('utf8'), 'measured=42\n');
});

test('a symlink cannot redirect an output outside its bound project even when the bytes match', async t => {
  const { runtime, results, directory } = await fixture(t);
  const target = path.join(directory, 'outside.txt');
  const output = path.join(runtime.projectDir, results[0].artifacts[0].relativePath);
  fs.copyFileSync(output, target);
  fs.unlinkSync(output);
  fs.symlinkSync(target, output);
  await assert.rejects(
    resolveResultArtifact(runtime, request(results[0])),
    /outside the selected project/,
  );
});

test('invalid or missing result identities do not fall back to renderer-supplied paths', async t => {
  const { runtime, results } = await fixture(t);
  await assert.rejects(
    resolveResultArtifact(runtime, { relativePath: results[0].artifacts[0].relativePath }),
    /recorded action/,
  );
  await assert.rejects(
    resolveResultArtifact(runtime, { actionId: 'missing', artifactId: 'missing' }),
    /does not belong/,
  );
});
