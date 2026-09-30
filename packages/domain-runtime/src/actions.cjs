const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {ActionRecordSchema} = require('@industrial-agent-harness/contracts');

function defaultActionDirectory() {return path.join(os.homedir(), '.industrial-agent-harness', 'state', 'actions');}

class ActionJournal {
  constructor(projectDir, domain, {directory = defaultActionDirectory()} = {}) {
    this.projectDir = fs.realpathSync(projectDir);
    if (!fs.statSync(this.projectDir).isDirectory() || typeof domain !== 'string' || !domain) throw Error('Action requires a bound project and domain.');
    this.domain = domain;
    this.projectId = crypto.createHash('sha256').update(`${this.projectDir}\0${domain}`).digest('hex');
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    fs.chmodSync(directory, 0o700);
    this.file = path.join(directory, `${this.projectId}.sqlite`);
    try {fs.closeSync(fs.openSync(this.file, 'wx', 0o600));} catch (error) {if (error.code !== 'EEXIST') throw error;}
    fs.chmodSync(this.file, 0o600);
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, record_json TEXT NOT NULL);');
  }

  write(record) {
    const parsed = ActionRecordSchema.parse(record);
    this.db.prepare('INSERT INTO actions (id, run_id, record_json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json')
      .run(parsed.id, parsed.runId, JSON.stringify(parsed));
    return parsed;
  }

  async execute(toolId, inputs, operation, assess = () => true) {
    if (typeof toolId !== 'string' || !toolId || !inputs || typeof inputs !== 'object' || Array.isArray(inputs) || typeof operation !== 'function') throw Error('Invalid Action request.');
    let record = this.write({id: crypto.randomUUID(), runId: crypto.randomUUID(), projectId: this.projectId, domain: this.domain,
      toolId, inputs, startedAt: new Date().toISOString(), endedAt: null, status: 'running', diagnostics: [], artifactIds: [],
      verification: {status: 'not_run', verifierId: null, reason: 'A native process result is not engineering acceptance.'}});
    try {
      const result = await operation();
      const passed = Boolean(assess(result));
      record = this.write({...record, endedAt: new Date().toISOString(), status: passed ? 'completed' : 'failed',
        diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics.map(String).slice(0, 30) : []});
      return {...result, runId: record.runId, actionId: record.id, actionStatus: record.status, verificationResult: record.verification, artifactSet: record.artifactIds};
    } catch (error) {
      this.write({...record, endedAt: new Date().toISOString(), status: 'failed', diagnostics: [String(error.message).slice(0, 2048)]});
      throw error;
    }
  }

  list() {return this.db.prepare('SELECT record_json FROM actions ORDER BY rowid').all().map(row => ActionRecordSchema.parse(JSON.parse(row.record_json)));}
  close() {this.db?.close(); this.db = undefined;}
}

module.exports = {ActionJournal, defaultActionDirectory};
