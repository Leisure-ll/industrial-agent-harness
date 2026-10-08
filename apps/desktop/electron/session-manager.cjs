// Own independent Kimi instances and captured project/scope state. Selecting a
// chat only changes UI navigation; it must never rebind a running agent callback.
class SessionManager {
  constructor() {
    this.entries = new Map();
  }
  get(project, chatId) {
    if (this.closing) throw Error('Sessions are shutting down.');
    if (!project?.id || !project.path || !project.domain || typeof chatId !== 'string' || !chatId)
      throw Error('Choose a project and chat.');
    let entry = this.entries.get(chatId);
    if (
      entry &&
      (entry.project.id !== project.id ||
        entry.project.path !== project.path ||
        entry.project.domain !== project.domain)
    )
      throw Error('Session belongs to another project or domain.');
    if (!entry) {
      entry = {
        id: chatId,
        project: Object.freeze({ ...project }),
        scope: undefined,
        trace: [],
        preparedTurn: undefined,
        release: undefined,
        agent: undefined,
        context: undefined,
      };
      this.entries.set(chatId, entry);
    }
    return entry;
  }
  busy(entry) {
    return Boolean(
      entry &&
        (entry.removing ||
          entry.resolving ||
          entry.release ||
          entry.agent?.backgroundTasks ||
          entry.agent?.running ||
          entry.agent?.turn),
    );
  }
  find(chatId) {
    return this.entries.get(chatId);
  }
  matching(projectId) {
    return [...this.entries.values()].filter(
      entry => projectId === undefined || entry.project.id === projectId,
    );
  }
  running(projectId) {
    return this.matching(projectId).filter(entry => this.busy(entry));
  }
  assertIdle(projectId) {
    if (this.running(projectId).length)
      throw Error('Stop running chats affected by this setting first.');
  }
  async reset(projectId) {
    this.assertIdle(projectId);
    const entries = this.matching(projectId);
    for (const entry of entries) entry.removing = true;
    const results = await Promise.allSettled(
      entries.map(async entry => {
        try {
          await entry.agent?.close();
          entry.context?.close();
          this.entries.delete(entry.id);
        } finally {
          entry.removing = false;
        }
      }),
    );
    throwFailures(results);
  }
  async remove(project, chatId) {
    const entry = this.get(project, chatId);
    if (this.busy(entry)) throw Error('Stop this chat before deleting it.');
    entry.removing = true;
    try {
      await entry.agent?.close();
      entry.context?.close();
      this.entries.delete(chatId);
    } finally {
      entry.removing = false;
    }
  }
  snapshots() {
    return this.matching().map(entry => ({
      chatId: entry.id,
      projectId: entry.project.id,
      running: this.busy(entry),
      backgroundTasks: Boolean(entry.agent?.backgroundTasks),
      awaitingApproval: Boolean(entry.agent?.pendingApprovals?.size),
      awaitingQuestion: Boolean(entry.agent?.pendingQuestions?.size),
    }));
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.dispose();
    return this.closePromise;
  }
  async dispose() {
    try {
      const results = await Promise.allSettled(
        this.matching().map(async entry => {
          try {
            await entry.agent?.close();
          } finally {
            try {
              entry.release?.();
            } finally {
              entry.context?.close();
            }
          }
        }),
      );
      throwFailures(results);
    } finally {
      this.entries.clear();
    }
  }
}
function throwFailures(results) {
  const errors = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason);
  if (errors.length)
    throw new AggregateError(errors, errors.map(error => error.message).join('; '));
}
function finishTurn(entry, finish, notify) {
  try {
    finish();
  } finally {
    if (entry.agent?.backgroundTasks) {
      entry.backgroundRelease = () => {
        entry.backgroundRelease = undefined;
        finishTurn(entry, () => {}, notify);
      };
      notify();
    } else {
      const release = entry.release;
      const releasePack = entry.releasePack;
      entry.release = undefined;
      entry.releasePack = undefined;
      try {
        release?.();
      } finally {
        try {
          releasePack?.();
        } finally {
          notify();
        }
      }
    }
  }
}
module.exports = { SessionManager, finishTurn };
