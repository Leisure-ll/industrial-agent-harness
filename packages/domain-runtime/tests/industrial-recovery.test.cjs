const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { IndustrialRuntime } = require('../src/industrial.cjs');
const { DatabaseSync } = require('node:sqlite');

test(
  'a killed runtime owner is recovered as a failed action with explicit empty artifacts, while a live owner and duplicate object are rejected',
  { timeout: 15000 },
  async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-recovery-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const options = {
      directory: path.join(dir, 'state'),
      stateProvider: async () => ({ inputHashes: {}, stage: null }),
    };
    const owner = new IndustrialRuntime(dir, 'test-domain', options);
    assert.throws(() => new IndustrialRuntime(dir, 'test-domain', options), /already open/);
    const modulePath = path.resolve(__dirname, '../src/industrial.cjs');
    const check = spawnSync(
      process.execPath,
      [
        '-e',
        `const {IndustrialRuntime}=require(${JSON.stringify(modulePath)});new IndustrialRuntime(${JSON.stringify(dir)},'test-domain',{directory:${JSON.stringify(options.directory)},stateProvider:async()=>({inputHashes:{},stage:null})});`,
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(check.status, 0);
    assert.match(check.stderr, /active in another process/);
    owner.close();
    const script = `const {IndustrialRuntime}=require(${JSON.stringify(modulePath)});const r=new IndustrialRuntime(${JSON.stringify(dir)},'test-domain',{directory:${JSON.stringify(options.directory)},stateProvider:async()=>({inputHashes:{},stage:null}),verifiers:{check:async()=>({status:'insufficient_evidence',reason:'never reached',metrics:{}})},tools:[{descriptor:{schemaVersion:'1',id:'test.wait',version:'1',risk:'mutating',verification:['check']},execute:async()=>{console.log('RUNNING');await new Promise(()=>{});}}]});(async()=>{const s=await r.inspect();await r.execute({toolId:'test.wait',inputs:{},expectedStateId:s.id},{scope:{domain:'test-domain',projectId:s.projectId,stateId:s.id,tools:['test.wait']},approval:true});})();`;
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill('SIGKILL'));
    await new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', data => {
        output += data;
        if (output.includes('RUNNING')) resolve();
      });
      child.once('error', reject);
      child.once('exit', code => {
        if (!output.includes('RUNNING')) reject(Error(`Owner exited ${code}`));
      });
    });
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGKILL');
    await closed;
    const reopened = new IndustrialRuntime(dir, 'test-domain', options);
    t.after(() => reopened.close());
    const action = reopened.listActions()[0];
    assert.equal(action.status, 'failed');
    assert.deepEqual(action.artifactIds, []);
    assert.equal(action.verification.status, 'insufficient_evidence');
    assert.equal(reopened.listRuns()[0].status, 'failed');
    assert.equal(reopened.latestCheckpoint().actionIds[0], action.id);
  },
);

test('future store versions are refused without changing its lease, and multiple verifiers require a declared aggregate', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = {
    directory: path.join(dir, 'state'),
    stateProvider: async () => ({ inputHashes: {}, stage: null }),
  };
  const runtime = new IndustrialRuntime(dir, 'test-domain', options);
  const file = runtime.file;
  runtime.close();
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version=99');
  db.prepare('INSERT OR REPLACE INTO core_metadata(key,value) VALUES(?,?)').run(
    'owner_pid',
    '4242',
  );
  assert.throws(() => new IndustrialRuntime(dir, 'test-domain', options), /newer/);
  assert.equal(
    db.prepare('SELECT value FROM core_metadata WHERE key=?').get('owner_pid').value,
    '4242',
  );
  db.close();
  assert.throws(
    () =>
      new IndustrialRuntime(dir, 'test-domain', {
        ...options,
        tools: [
          {
            descriptor: {
              schemaVersion: '1',
              id: 'multi-check',
              version: '1',
              risk: 'mutating',
              verification: ['one', 'two'],
            },
            execute: async () => {},
          },
        ],
        verifiers: { one() {}, two() {} },
      }),
    /aggregate verifier/,
  );
});

test('StateProvider stage changes rotate the persisted state even with identical hashes; replacing the bound directory is rejected', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'core-binding-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'project');
  fs.mkdirSync(project);
  let stage = null;
  const runtime = new IndustrialRuntime(project, 'test-domain', {
    directory: path.join(directory, 'state'),
    stateProvider: async () => ({ inputHashes: {}, stage }),
  });
  t.after(() => runtime.close());
  const unknown = await runtime.inspect();
  assert.equal((await runtime.inspect()).id, unknown.id);
  stage = 'declared-stage';
  const current = await runtime.inspect();
  assert.notEqual(current.id, unknown.id);
  assert.equal(current.stage, 'declared-stage');
  fs.renameSync(project, path.join(directory, 'original'));
  fs.mkdirSync(project);
  await assert.rejects(runtime.inspect(), /Bound project directory changed/);
});
