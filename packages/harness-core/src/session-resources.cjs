const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { defaultResourceDirectory } = require('./resource-settings.cjs');
const { availableMemoryBytes } = require('./available-memory.cjs');

const DEFAULT_SESSION_LIMITS = Object.freeze({
  maxConcurrent: 4,
  maxResident: 6,
  idleMs: 5 * 60 * 1000,
  minFreeMemoryBytes: 256 * 1024 * 1024,
});

function sessionResourceLimits(environment = process.env) {
  const values = { ...DEFAULT_SESSION_LIMITS };
  for (const [key, name] of Object.entries({
    maxConcurrent: 'INDUSTRIAL_HARNESS_MAX_CONCURRENT_SESSIONS',
    maxResident: 'INDUSTRIAL_HARNESS_MAX_RESIDENT_SESSIONS',
    idleMs: 'INDUSTRIAL_HARNESS_SESSION_IDLE_MS',
    minFreeMemoryBytes: 'INDUSTRIAL_HARNESS_MIN_FREE_MEMORY_BYTES',
  })) {
    if (environment[name] === undefined) continue;
    const value = Number(environment[name]);
    if (!/^\d+$/.test(environment[name]) || !Number.isSafeInteger(value))
      throw Error(`${name} must be an integer.`);
    values[key] = value;
  }
  if (values.maxConcurrent < 1 || values.maxResident < values.maxConcurrent || values.idleMs < 1)
    throw Error('Session limits require maxResident >= maxConcurrent >= 1 and idleMs >= 1.');
  return values;
}

class SessionCapacityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SessionCapacityError';
    this.code = code;
  }
}

function ownerAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Host resource leases only. Resources supply their own close/busy callbacks;
// this module neither understands model context nor runs an agent/tool loop.
class SessionResourceManager {
  constructor({
    environment = process.env,
    directory = defaultResourceDirectory(environment),
    limits = sessionResourceLimits(environment),
    clock = Date.now,
    freeMemory = availableMemoryBytes,
    isOwnerAlive = ownerAlive,
    sweepIntervalMs = 1000,
    residentWaitMs = 5000,
    onError = error => console.error('Session resource cleanup failed:', error.message),
  } = {}) {
    // Validate explicit limits with the same rules as configuration values.
    this.limits = sessionResourceLimits({
      INDUSTRIAL_HARNESS_MAX_CONCURRENT_SESSIONS: String(limits.maxConcurrent),
      INDUSTRIAL_HARNESS_MAX_RESIDENT_SESSIONS: String(limits.maxResident),
      INDUSTRIAL_HARNESS_SESSION_IDLE_MS: String(limits.idleMs),
      INDUSTRIAL_HARNESS_MIN_FREE_MEMORY_BYTES: String(limits.minFreeMemoryBytes),
    });
    this.clock = clock;
    this.freeMemory = freeMemory;
    this.isOwnerAlive = isOwnerAlive;
    this.residentWaitMs = residentWaitMs;
    this.onError = onError;
    this.owner = crypto.randomUUID();
    this.entries = new Map();
    this.closed = false;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const canonical = fs.realpathSync(directory);
    const file = path.join(canonical, 'session-resources.sqlite');
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
      throw Error('Session resource database cannot be a symbolic link.');
    this.db = new DatabaseSync(file);
    fs.chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS resource_owners (
        id TEXT PRIMARY KEY, pid INTEGER NOT NULL, max_concurrent INTEGER NOT NULL,
        max_resident INTEGER NOT NULL, min_free_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS session_leases (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES resource_owners(id) ON DELETE CASCADE,
        active INTEGER NOT NULL, resident INTEGER NOT NULL, last_used INTEGER NOT NULL,
        retire INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS lease_owner ON session_leases(owner_id);`);
    this.db
      .prepare('INSERT INTO resource_owners VALUES (?, ?, ?, ?, ?)')
      .run(
        this.owner,
        process.pid,
        this.limits.maxConcurrent,
        this.limits.maxResident,
        this.limits.minFreeMemoryBytes,
      );
    this.timer = setInterval(() => {
      void this.sweep().catch(this.onError);
    }, sweepIntervalMs);
    this.timer.unref();
  }
  transaction(operation) {
    if (this.closed || this.stopping) throw Error('Session resource manager is closed.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const owner of this.db.prepare('SELECT id, pid FROM resource_owners').all()) {
        if (!this.isOwnerAlive(owner.pid))
          this.db.prepare('DELETE FROM resource_owners WHERE id = ?').run(owner.id);
      }
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  counts() {
    const limits = this.db
      .prepare(
        `SELECT MIN(max_concurrent) AS maxConcurrent,
      MIN(max_resident) AS maxResident, MAX(min_free_bytes) AS minFreeMemoryBytes
      FROM resource_owners`,
      )
      .get();
    const usage = this.db
      .prepare(
        `SELECT COALESCE(SUM(active), 0) AS active,
      COALESCE(SUM(resident), 0) AS resident FROM session_leases`,
      )
      .get();
    return { ...limits, ...usage };
  }
  snapshot() {
    return this.transaction(() => ({ ...this.counts(), freeMemoryBytes: this.freeMemory() }));
  }
  pressure(usage) {
    if (this.freeMemory() >= usage.minFreeMemoryBytes) return false;
    this.db.prepare('UPDATE session_leases SET retire = 1 WHERE active = 0').run();
    return true;
  }
  reserve(id) {
    const error = this.transaction(() => {
      const usage = this.counts();
      if (this.pressure(usage))
        return new SessionCapacityError(
          'MEMORY_PRESSURE',
          'Available memory is below the session reserve. Idle sessions are being released; retry after memory is available.',
        );
      if (usage.active >= usage.maxConcurrent)
        return new SessionCapacityError(
          'CONCURRENT_LIMIT',
          `The shared limit of ${usage.maxConcurrent} running sessions is reached. Retry when another chat finishes.`,
        );
      const previous = this.db.prepare('SELECT * FROM session_leases WHERE id = ?').get(id);
      if (previous?.active || (previous && previous.owner_id !== this.owner))
        throw Error('Session already holds an execution lease.');
      if (previous) {
        this.db.prepare('UPDATE session_leases SET active = 1, retire = 0 WHERE id = ?').run(id);
      } else {
        this.db
          .prepare('INSERT INTO session_leases VALUES (?, ?, 1, 0, ?, 0)')
          .run(id, this.owner, this.clock());
      }
      return null;
    });
    if (error) throw error;
  }
  reserveResident(id) {
    return this.transaction(() => {
      const lease = this.db
        .prepare('SELECT resident FROM session_leases WHERE id = ? AND owner_id = ?')
        .get(id, this.owner);
      if (!lease) throw Error('Session execution lease was lost.');
      if (lease.resident) return true;
      const usage = this.counts();
      if (this.pressure(usage))
        return new SessionCapacityError(
          'MEMORY_PRESSURE',
          'Available memory is below the session reserve. Retry after memory is available.',
        );
      if (usage.resident >= usage.maxResident) {
        // Ask the owning host to dispose its oldest idle resource. A slot stays
        // occupied until that host confirms close, even when close is slow.
        const retiring = this.db
          .prepare(
            'SELECT COUNT(*) AS count FROM session_leases WHERE active = 0 AND resident = 1 AND retire = 1',
          )
          .get().count;
        if (retiring < usage.resident - usage.maxResident + 1)
          this.db
            .prepare(
              `UPDATE session_leases SET retire = 1 WHERE id = (
          SELECT id FROM session_leases WHERE active = 0 AND resident = 1 AND retire = 0
          ORDER BY last_used, rowid LIMIT 1)`,
            )
            .run();
        return false;
      }
      this.db.prepare('UPDATE session_leases SET resident = 1 WHERE id = ?').run(id);
      return true;
    });
  }
  async acquire(id, resource) {
    if (typeof id !== 'string' || !id || typeof resource?.dispose !== 'function')
      throw Error('A resource identity and disposer are required.');
    const previous = this.entries.get(id);
    if (previous?.closing) await previous.closing;
    this.reserve(id);
    const entry = this.entries.get(id) || { id, ...resource };
    entry.active = true;
    this.entries.set(id, entry);
    try {
      const deadline = Date.now() + this.residentWaitMs;
      while (true) {
        const reserved = this.reserveResident(id);
        if (reserved instanceof Error) throw reserved;
        if (reserved) break;
        void this.sweep().catch(this.onError);
        if (Date.now() >= deadline)
          throw new SessionCapacityError(
            'RESIDENT_LIMIT',
            'The shared resident session limit is reached. Idle processes are still closing; retry shortly.',
          );
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    } catch (error) {
      this.releaseTurn(id);
      if (
        !this.closed &&
        !this.db.prepare('SELECT resident FROM session_leases WHERE id = ?').get(id)?.resident
      ) {
        this.db
          .prepare('DELETE FROM session_leases WHERE id = ? AND owner_id = ?')
          .run(id, this.owner);
        this.entries.delete(id);
      }
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseTurn(id);
    };
  }
  releaseTurn(id) {
    const entry = this.entries.get(id);
    if (entry) entry.active = false;
    if (this.closed) return;
    this.db
      .prepare('UPDATE session_leases SET active = 0, last_used = ? WHERE id = ? AND owner_id = ?')
      .run(this.clock(), id, this.owner);
  }
  async remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.closing) return entry.closing;
    entry.closing = Promise.resolve()
      .then(() => entry.dispose())
      .then(() => {
        this.db
          .prepare('DELETE FROM session_leases WHERE id = ? AND owner_id = ?')
          .run(id, this.owner);
        this.entries.delete(id);
      })
      .finally(() => {
        entry.closing = undefined;
      });
    return entry.closing;
  }
  async sweep() {
    if (this.closed || this.stopping || !this.entries.size) return;
    const leases = this.transaction(() => {
      this.pressure(this.counts());
      return this.db
        .prepare(
          'SELECT id, retire, last_used FROM session_leases WHERE owner_id = ? AND active = 0',
        )
        .all(this.owner);
    });
    await Promise.all(
      leases.map(async lease => {
        const entry = this.entries.get(lease.id);
        if (!entry || entry.active || entry.isBusy?.()) return;
        if (lease.retire || this.clock() - lease.last_used >= this.limits.idleMs)
          await this.remove(lease.id);
      }),
    );
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.stopping = true;
    this.closePromise = this.dispose();
    return this.closePromise;
  }
  async dispose() {
    if (this.closed) return;
    clearInterval(this.timer);
    const results = await Promise.allSettled([...this.entries.keys()].map(id => this.remove(id)));
    const errors = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    if (!errors.length) this.db.prepare('DELETE FROM resource_owners WHERE id = ?').run(this.owner);
    this.closed = true;
    this.db.close();
    // Failed disposal retains leases until the host exits; do not falsely claim
    // capacity was freed and allow more native processes to start.
    if (errors.length)
      throw new AggregateError(errors, 'Session resources could not all be released.');
  }
}

module.exports = {
  SessionResourceManager,
  SessionCapacityError,
  sessionResourceLimits,
  DEFAULT_SESSION_LIMITS,
};
