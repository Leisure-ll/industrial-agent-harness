const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProjectRuntimes } = require('./project-runtimes.cjs');

test('desktop chats share one actual persistent project runtime and reopen its facts after disposal', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-project-runtime-'));
  const projectDir = path.join(directory, 'project');
  const packDir = path.join(directory, 'pack');
  fs.mkdirSync(projectDir);
  fs.mkdirSync(packDir);
  fs.writeFileSync(path.join(projectDir, 'design.txt'), 'declared engineering inputs');
  fs.writeFileSync(
    path.join(packDir, 'index.cjs'),
    `
    const fs = require('node:fs');
    const path = require('node:path');
    const crypto = require('node:crypto');
    exports.createRuntimePlugin = () => ({
      stateProvider: ({projectDir}) => ({stage:'review', inputHashes:{
        'design.txt':crypto.createHash('sha256').update(fs.readFileSync(path.join(projectDir,'design.txt'))).digest('hex')
      }}), tools:[], verifiers:{}, capabilities:[]
    });
  `,
  );
  const registry = {
    runtimePacks: [
      {
        id: 'review-pack',
        domain: 'review',
        version: '1.0.0',
        directory: packDir,
        runtime: { entry: 'index.cjs' },
      },
    ],
  };
  const runtimes = new ProjectRuntimes({ directory: path.join(directory, 'state') });
  t.after(() => {
    runtimes.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const project = { id: 'project-id', path: projectDir, domain: 'review' };
  const first = runtimes.get(project, registry);
  assert.equal(runtimes.get({ ...project, id: 'another-chat-binding' }, registry), first);
  const state = await first.runtime.inspect();
  const checkpoint = first.runtime.latestCheckpoint();
  runtimes.close();
  const reopened = runtimes.get(project, registry);
  assert.notEqual(reopened, first);
  assert.equal((await reopened.runtime.inspect()).id, state.id);
  assert.equal(reopened.runtime.latestCheckpoint().id, checkpoint.id);
  fs.appendFileSync(path.join(projectDir, 'design.txt'), ' changed');
  assert.notEqual((await reopened.runtime.inspect()).id, state.id);
});
