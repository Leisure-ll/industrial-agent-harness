const crypto = require('node:crypto');
const { connectExternal, hash } = require('./external-client.cjs');

// Owned by one Project Runtime. Keep service state inside its caller's chat,
// never share process-local handles between unrelated callers. A lost session
// fails closed: recreating a transport cannot recreate the service's state.
class ExternalSessions {
  constructor(environment, { idleMs = 300000, maximum = 64 } = {}) {
    this.environment = environment;
    this.idleMs = idleMs;
    this.maximum = maximum;
    this.entries = new Map();
  }
  async acquire(server, projectDir, ownerId) {
    if (this.closed) throw Error('External MCP runtime is closed.');
    const key = JSON.stringify([projectDir, ownerId, server.id, server.revision]);
    const environmentKey = hash(
      Object.values({ ...server.config.envRefs, ...server.config.headerEnv }).map(name => [
        name,
        this.environment[name],
      ]),
    );
    let entry = this.entries.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      if (entry.environmentKey !== environmentKey) {
        await this.invalidate(entry);
        throw Error(
          'External MCP referenced environment changed. Start a new chat with fresh service state.',
        );
      }
      if (entry.lost || entry.connection.closed)
        throw Error(
          'External MCP session state was lost. Start a new chat after inspecting the service; do not repeat an uncertain mutation.',
        );
      return { entry, reused: true };
    }
    if (this.entries.size >= this.maximum)
      throw Error(
        'External MCP session limit reached. Close idle chats before opening another service.',
      );
    const connection = await connectExternal(server, projectDir, this.environment);
    entry = {
      key,
      ownerId,
      serverId: server.id,
      environmentKey,
      connection,
      id: crypto.randomUUID(),
    };
    this.entries.set(key, entry);
    return { entry, reused: false };
  }
  release(entry) {
    if (entry.lost || this.closed) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.invalidate(entry), this.idleMs);
    entry.timer.unref();
  }
  async invalidate(entry) {
    clearTimeout(entry.timer);
    entry.lost = true;
    await entry.connection.close().catch(() => {});
  }
  async closeOwner(ownerId) {
    const entries = [...this.entries.values()].filter(entry => entry.ownerId === ownerId);
    for (const entry of entries) this.entries.delete(entry.key);
    await Promise.all(entries.map(entry => this.invalidate(entry)));
  }
  async closeServer(serverId) {
    const entries = [...this.entries.values()].filter(entry => entry.serverId === serverId);
    for (const entry of entries) this.entries.delete(entry.key);
    await Promise.all(entries.map(entry => this.invalidate(entry)));
  }
  async close() {
    this.closed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(entries.map(entry => this.invalidate(entry)));
  }
}
module.exports = { ExternalSessions };
