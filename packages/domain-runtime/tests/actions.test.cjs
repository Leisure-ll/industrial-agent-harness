const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ActionJournal} = require('../src/index.cjs');

test('native Action records survive restart and failure never becomes engineering acceptance', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-action-journal-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  const directory = path.join(root, 'state');
  const journal = new ActionJournal(project, 'godot', {directory});
  const ok = await journal.execute('godot.game.run_scene', {scenePath: 'main.tscn'}, async () => ({executionStatus: 'completed', diagnostics: []}));
  const failed = await journal.execute('godot.game.check_project', {}, async () => ({importStatus: 'FAIL', diagnostics: ['Parse Error']}), result => result.importStatus === 'PASS');
  await assert.rejects(journal.execute('godot.game.run_scene', {}, async () => {throw Error('Engine unavailable');}), /Engine unavailable/);
  assert.equal(ok.verificationResult.status, 'not_run');
  assert.deepEqual(ok.artifactSet, []);
  assert.equal(failed.actionStatus, 'failed');
  journal.close();
  const reopened = new ActionJournal(project, 'godot', {directory});
  t.after(() => reopened.close());
  const records = reopened.list();
  assert.deepEqual(records.map(item => item.status), ['completed', 'failed', 'failed']);
  assert.deepEqual(records.map(item => item.verification.status), ['not_run', 'not_run', 'not_run']);
  assert.equal(records[0].id, ok.actionId);
  assert.match(records[2].diagnostics[0], /Engine unavailable/);
});
