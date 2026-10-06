const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { IndustrialRuntime, createWorkspacePlugin } = require('../src/index.cjs');
const { hash } = require('../src/workspace-files.cjs');
function open(t, domain = 'example') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-workspace-'));
  const project = path.join(directory, 'project');
  fs.mkdirSync(project);
  const plugin = createWorkspacePlugin({
    domain,
    protectedPaths: [path.join(project, 'private-state')],
  });
  const runtime = new IndustrialRuntime(project, domain, {
    directory: path.join(directory, 'state'),
    ...plugin,
  });
  t.after(() => {
    runtime.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const execute = async (toolId, inputs, approval = true, override = {}) => {
    const state = await runtime.inspect();
    return runtime.execute(
      { toolId, inputs, expectedStateId: state.id, ...override },
      {
        approval,
        scope: {
          domain,
          projectId: state.projectId,
          stateId: state.id,
          tools: runtime.descriptors().map(t => t.id),
        },
      },
    );
  };
  return { project, runtime, execute };
}
test('same initialization and file lifecycle works in unrelated domains and retains immutable history', async t => {
  for (const domain of ['example', 'another']) {
    const { project, runtime, execute } = open(t, domain);
    const initialized = await execute('project.initialize', { name: 'new design' });
    assert.equal(initialized.action.status, 'completed');
    assert.equal(initialized.verification.status, 'not_run');
    assert.equal(initialized.state.stage, null);
    assert.equal(initialized.state.status, 'unverified');
    assert.equal(
      (await execute('project.initialize', { name: 'overwrite' })).action.status,
      'failed',
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(project, 'harness.project.json'))).name,
      'new design',
    );
    const created = await execute('project.files.apply', {
      changes: [{ path: 'src/design.txt', content: 'first', expectedSha256: null }],
    });
    assert.equal(created.action.status, 'completed');
    const read = await execute('project.files.read', { path: 'src/design.txt' });
    const report = JSON.parse(runtime.readArtifact(read.artifacts[0].id).content);
    assert.equal(report.content, 'first');
    assert.equal(report.sha256, hash(Buffer.from('first')));
    const rejected = await execute('project.files.apply', {
      changes: [{ path: 'src/design.txt', content: 'bad', expectedSha256: null }],
    });
    assert.equal(rejected.action.status, 'failed');
    assert.match(rejected.action.diagnostics.join(), /precondition/);
    const edited = await execute('project.files.apply', {
      changes: [{ path: 'src/design.txt', content: 'second', expectedSha256: report.sha256 }],
    });
    assert.equal(edited.action.status, 'completed');
    assert.notEqual(edited.state.id, created.state.id);
    assert.equal(JSON.parse(runtime.readArtifact(read.artifacts[0].id).content).content, 'first');
    assert.ok(runtime.listCheckpoints().some(c => c.id === created.checkpoint.id));
    assert.equal(
      (
        await execute('project.files.apply', {
          changes: [
            { path: 'src/design.txt', content: null, expectedSha256: hash(Buffer.from('second')) },
          ],
        })
      ).action.status,
      'completed',
    );
    assert.equal(fs.existsSync(path.join(project, 'src/design.txt')), false);
  }
});
test('approval, scope and all batch preconditions are checked before any file write', async t => {
  const { project, execute } = open(t);
  const edit = { changes: [{ path: 'src/a', content: 'a', expectedSha256: null }] };
  assert.equal((await execute('project.files.apply', edit, false)).action.status, 'failed');
  assert.equal(fs.existsSync(path.join(project, 'src')), false);
  const invalid = {
    changes: [...edit.changes, { path: 'missing', content: 'x', expectedSha256: 'a'.repeat(64) }],
  };
  assert.equal((await execute('project.files.apply', invalid)).action.status, 'failed');
  assert.equal(fs.existsSync(path.join(project, 'src')), false);
  for (const name of [
    '../escape',
    '.git/config',
    '.harness-runs/fake',
    'node_modules/pkg',
    'private-state/fact',
  ]) {
    const result = await execute('project.files.apply', {
      changes: [{ path: name, content: 'bad', expectedSha256: null }],
    });
    assert.equal(result.action.status, 'failed', name);
    assert.equal(result.artifacts.length, 0);
  }
});
test('input mutations make accepted evidence stale rather than replacing it with file-write acceptance', async t => {
  const { project, runtime, execute } = open(t);
  await execute('project.files.apply', {
    changes: [{ path: 'source', content: 'one', expectedSha256: null }],
  });
  const before = await runtime.inspect();
  const verified = {
    ...before,
    id: require('node:crypto').randomUUID(),
    status: 'verified',
    verificationIds: [require('node:crypto').randomUUID()],
  };
  runtime.put('state', verified.id, verified);
  runtime.setMetadata('head_state', verified.id);
  const edit = await execute('project.files.apply', {
    changes: [{ path: 'source', content: 'two', expectedSha256: before.inputHashes.source }],
  });
  assert.equal(edit.state.status, 'stale');
  assert.deepEqual(edit.state.verificationIds, verified.verificationIds);
  assert.equal(edit.verification.status, 'not_run');
  assert.equal(runtime.get('state', verified.id).status, 'verified');
});
test('partial staging failures preserve original files and rollback prior edits in the batch', async t => {
  const { project, execute, runtime } = open(t);
  fs.writeFileSync(path.join(project, 'first'), 'one', { mode: 0o600 });
  fs.writeFileSync(path.join(project, 'second'), 'two', { mode: 0o600 });
  const original = fs.writeFileSync;
  for (const failAt of [1, 2]) {
    let writes = 0;
    fs.writeFileSync = (file, ...args) => {
      if (typeof file === 'number' && ++writes === failAt) {
        original(file, 'partial');
        throw Error('Controlled partial staging failure');
      }
      return original(file, ...args);
    };
    let failed;
    try {
      failed = await execute('project.files.apply', {
        changes: [
          { path: 'first', content: 'new first', expectedSha256: hash(Buffer.from('one')) },
          { path: 'second', content: 'new second', expectedSha256: hash(Buffer.from('two')) },
        ],
      });
    } finally {
      fs.writeFileSync = original;
    }
    assert.equal(failed.action.status, 'failed');
    assert.equal(failed.verification.status, 'insufficient_evidence');
    assert.equal(fs.readFileSync(path.join(project, 'first'), 'utf8'), 'one');
    assert.equal(fs.readFileSync(path.join(project, 'second'), 'utf8'), 'two');
    assert.ok(!fs.readdirSync(project).some(name => name.startsWith('.harness-edit-')));
    assert.equal((await runtime.inspect()).inputHashes.first, hash(Buffer.from('one')));
  }
});
test('symlink, hard-link and reserved output-kind inputs are refused', async t => {
  const { project, execute } = open(t);
  // The file boundary independently refuses the path, including before inspection.
  const { projectFile } = require('../src/workspace-files.cjs');
  if (process.platform !== 'win32') {
    fs.symlinkSync(os.tmpdir(), path.join(project, 'link'));
    assert.throws(() => projectFile(project, 'link/out'), /symlink/);
    fs.unlinkSync(path.join(project, 'link'));
  }
  fs.writeFileSync(path.join(project, 'a'), 'x');
  fs.linkSync(path.join(project, 'a'), path.join(project, 'b'));
  assert.throws(() => projectFile(project, 'a'), /Hard-linked/);
  const { ProjectTaskManifestSchema } = require('@industrial-agent-harness/contracts');
  assert.equal(
    ProjectTaskManifestSchema.safeParse({
      schemaVersion: '1',
      tasks: {
        test: {
          command: ['node'],
          inputs: ['a'],
          outputs: [{ path: 'fake', kind: 'report.task-checks' }],
        },
      },
    }).success,
    false,
  );
});
