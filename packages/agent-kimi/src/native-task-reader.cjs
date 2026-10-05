const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;

// Native session files are display inputs only. Never write task/control,
// context or verification records from this observer.
class NativeTaskReader {
  constructor({ directory, shareDir, projector, interval = 150 }) {
    const root = fs.realpathSync(shareDir);
    this.directory = path.join(
      root,
      path.relative(path.resolve(shareDir), path.resolve(directory)),
    );
    if (!this.directory.startsWith(root + path.sep))
      throw Error('Native task session is outside its storage root.');
    this.projector = projector;
    this.cursors = new Map();
    this.closed = false;
    this.activeTasks = new Set();
    this.timer = setInterval(() => this.poll(), interval);
    this.timer.unref();
  }
  open(relative) {
    const parts = relative.split('/');
    let current = this.directory;
    if (
      !parts.every(
        p =>
          idPattern.test(p) ||
          ['spec.json', 'runtime.json', 'meta.json', 'wire.jsonl', 'output.log'].includes(p),
      )
    )
      throw Error('Invalid native task path.');
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink())
        throw Error('Native task links are not supported.');
    }
    const fd = fs.openSync(current, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const canonical = fs.realpathSync(current);
      const actual = fs.fstatSync(fd),
        expected = fs.statSync(canonical);
      if (
        !canonical.startsWith(this.directory + path.sep) ||
        actual.ino !== expected.ino ||
        actual.dev !== expected.dev
      ) {
        throw Error('Native task input escaped its session.');
      }
      if (!fs.fstatSync(fd).isFile()) {
        throw Error('Native task input is not a file.');
      }
      return fd;
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }
  json(relative) {
    const fd = this.open(relative);
    try {
      const size = fs.fstatSync(fd).size;
      if (size > 64 * 1024) throw Error('Native task metadata is too large.');
      const b = Buffer.alloc(size);
      fs.readSync(fd, b, 0, size, 0);
      return JSON.parse(b.toString('utf8'));
    } finally {
      fs.closeSync(fd);
    }
  }
  taskIds() {
    const root = path.join(this.directory, 'tasks');
    if (!fs.realpathSync(root).startsWith(this.directory + path.sep))
      throw Error('Native task directory escaped its session.');
    if (fs.lstatSync(root).isSymbolicLink()) throw Error('Native task directory is a link.');
    const directory = this.scan || (this.scan = fs.opendirSync(root)),
      ids = [];
    try {
      let entry;
      for (let scanned = 0; scanned < 128; scanned++) {
        entry = directory.readSync();
        if (!entry) {
          directory.closeSync();
          this.scan = null;
          break;
        }
        if (entry.isDirectory() && idPattern.test(entry.name)) ids.push(entry.name);
      }
    } catch (error) {
      directory.closeSync();
      this.scan = null;
      throw error;
    }
    return [...new Set([...ids, ...this.activeTasks])];
  }
  poll() {
    if (this.closed || this.polling) return;
    this.polling = true;
    try {
      this.readTasks();
    } finally {
      this.polling = false;
    }
  }
  readTasks() {
    let ids;
    try {
      ids = this.taskIds();
    } catch {
      return;
    }
    for (const id of ids) {
      try {
        const spec = this.json(`tasks/${id}/spec.json`),
          runtime = this.json(`tasks/${id}/runtime.json`);
        if (['created', 'starting', 'running', 'awaiting_approval'].includes(runtime.status))
          this.activeTasks.add(id);
        else this.activeTasks.delete(id);
        if (
          spec.id !== id ||
          !spec.kind_payload?.agent_id ||
          !idPattern.test(spec.kind_payload.agent_id)
        )
          continue;
        let cursor = this.cursors.get(id);
        if (!cursor) {
          cursor = {
            offset: 0,
            buffer: '',
            decoder: new StringDecoder('utf8'),
            completedAtAttach: ['completed', 'failed', 'killed', 'lost'].includes(runtime.status),
          };
          this.cursors.set(id, cursor);
        }
        const record = this.projector.task(spec, runtime);
        if (record && !cursor.completedAtAttach) {
          const terminal = ['completed', 'failed', 'killed', 'lost'].includes(runtime.status);
          this.readWire(spec, cursor, terminal, runtime.finished_at);
        }
        if (['completed', 'failed', 'killed', 'lost'].includes(runtime.status)) {
          let summary = '';
          try {
            const fd = this.open(`tasks/${id}/output.log`);
            try {
              const size = fs.fstatSync(fd).size,
                length = Math.min(size, 16 * 1024),
                b = Buffer.alloc(length);
              fs.readSync(fd, b, 0, length, size - length);
              summary = b.toString('utf8').split('[summary]\n').at(-1);
              if (!b.toString('utf8').includes('[summary]\n')) summary = '';
            } finally {
              fs.closeSync(fd);
            }
          } catch {}
          this.projector.task(spec, runtime, summary);
        }
      } catch {
        /* Partial native writes, missing files and malformed inputs stay isolated. */
      }
    }
  }
  readWire(spec, cursor, terminal = false, finishedAt = null) {
    const fd = this.open(`subagents/${spec.kind_payload.agent_id}/wire.jsonl`);
    try {
      const actualSize = fs.fstatSync(fd).size;
      if (terminal && cursor.end === undefined) cursor.end = actualSize;
      const size = cursor.end ?? actualSize;
      if (size < cursor.offset) {
        cursor.offset = 0;
        cursor.buffer = '';
        cursor.decoder = new StringDecoder('utf8');
      }
      const length = Math.min(size - cursor.offset, 128 * 1024);
      if (!length) {
        if (terminal) cursor.completedAtAttach = true;
        return;
      }
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(fd, buffer, 0, length, cursor.offset);
      cursor.offset += read;
      cursor.buffer += cursor.decoder.write(buffer.subarray(0, read));
      let newline;
      while ((newline = cursor.buffer.indexOf('\n')) >= 0) {
        const line = cursor.buffer.slice(0, newline);
        cursor.buffer = cursor.buffer.slice(newline + 1);
        if (line.length > 512 * 1024) continue;
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        if (!row.message || row.timestamp < spec.created_at) continue;
        if (finishedAt && row.timestamp > finishedAt) continue;
        try {
          this.projector.wire({
            parent_tool_call_id: spec.tool_call_id,
            agent_id: spec.kind_payload.agent_id,
            subagent_type: spec.kind_payload.subagent_type,
            event: row.message,
          });
        } catch {}
      }
      if (cursor.buffer.length > 512 * 1024) cursor.buffer = '';
      if (terminal && cursor.offset >= size) cursor.completedAtAttach = true;
    } finally {
      fs.closeSync(fd);
    }
  }
  busy() {
    return this.activeTasks.size > 0 || Boolean(this.scan);
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.scan?.closeSync();
    this.scan = null;
    this.cursors.clear();
    this.activeTasks.clear();
  }
}
module.exports = { NativeTaskReader };
