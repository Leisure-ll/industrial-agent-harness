const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const MAX_TEXT = 4 * 1024 * 1024;
const MAX_MEDIA = 16 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function readBounded(file, root, expectedHash, limit = MAX_TEXT) {
  const project = fs.realpathSync(root),
    canonical = fs.realpathSync(file);
  const relative = path.relative(project, canonical);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw Error('Engineering file is outside the selected project.');
  const fd = fs.openSync(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > limit)
      throw Error(
        `Engineering file exceeds the ${Math.round(limit / 1024 / 1024)} MiB preview limit.`,
      );
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw Error('File changed; reopen it.');
      offset += count;
    }
    const after = fs.fstatSync(fd),
      current = fs.statSync(canonical);
    const sha256 = hash(bytes);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      fs.realpathSync(file) !== canonical ||
      fs.realpathSync(root) !== project ||
      (expectedHash && sha256 !== expectedHash)
    )
      throw Error('File changed; reopen it.');
    return { bytes, canonical, project, sha256 };
  } finally {
    fs.closeSync(fd);
  }
}

function utf8(bytes) {
  if (bytes.includes(0)) throw Error('Text source contains binary data.');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw Error('Text source is not valid UTF-8.');
  }
}

module.exports = { readBounded, utf8, MAX_TEXT, MAX_MEDIA, hash };
