const fs = require('node:fs');
const path = require('node:path');

// Inspect both central and local headers before ditto sees an archive. ZIP64,
// encrypted entries, links and special files are deliberately unsupported.
function inspectRuntimeZip(file, maxExpanded) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const read = (offset, length) => {
      if (offset < 0 || length < 0 || offset + length > size)
        throw Error('Invalid runtime ZIP bounds.');
      const bytes = Buffer.alloc(length);
      if (fs.readSync(fd, bytes, 0, length, offset) !== length)
        throw Error('Truncated runtime ZIP.');
      return bytes;
    };
    const tail = read(Math.max(0, size - 65557), Math.min(size, 65557));
    let end = -1;
    for (let at = tail.length - 22; at >= 0; at--) {
      if (
        tail.readUInt32LE(at) === 0x06054b50 &&
        at + 22 + tail.readUInt16LE(at + 20) === tail.length
      ) {
        end = at;
        break;
      }
    }
    if (end < 0) throw Error('Invalid runtime ZIP directory.');
    const count = tail.readUInt16LE(end + 10);
    const centralSize = tail.readUInt32LE(end + 12),
      centralOffset = tail.readUInt32LE(end + 16);
    if (
      !count ||
      count === 65535 ||
      tail.readUInt32LE(end + 4) !== 0 ||
      tail.readUInt16LE(end + 8) !== count ||
      centralSize > 64 * 1024 ** 2 ||
      centralOffset + centralSize !== size - tail.length + end
    )
      throw Error('Unsupported runtime ZIP directory.');
    const central = read(centralOffset, centralSize),
      names = new Set(),
      spans = [];
    let offset = 0,
      expanded = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50)
        throw Error('Invalid runtime ZIP entry.');
      const flags = central.readUInt16LE(offset + 8),
        method = central.readUInt16LE(offset + 10);
      const packed = central.readUInt32LE(offset + 20),
        unpacked = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28),
        extraLength = central.readUInt16LE(offset + 30);
      const commentLength = central.readUInt16LE(offset + 32),
        localOffset = central.readUInt32LE(offset + 42);
      const mode = central.readUInt32LE(offset + 38) >>> 16,
        type = mode & 0o170000;
      const nameBytes = central.subarray(offset + 46, offset + 46 + nameLength);
      const name = nameBytes.toString('utf8'),
        relative = name.replace(/\/$/, '');
      if (
        !relative ||
        relative.includes('\\') ||
        relative.includes(':') ||
        relative.includes('\0') ||
        relative.startsWith('/') ||
        relative.split('/').some(part => !part || part === '.' || part === '..') ||
        path.posix.normalize(relative) !== relative ||
        names.has(relative.toLowerCase()) ||
        !Buffer.from(name).equals(nameBytes) ||
        flags & (1 | 64 | 8192) ||
        ![0, 8].includes(method) ||
        ![0, 0o100000, 0o040000].includes(type) ||
        packed === 0xffffffff ||
        unpacked === 0xffffffff
      )
        throw Error('Unsafe or unsupported runtime ZIP entry.');
      names.add(relative.toLowerCase());
      expanded += unpacked;
      if (expanded > maxExpanded) throw Error('Runtime ZIP exceeds installation size limit.');
      const local = read(localOffset, 30);
      const localNameLength = local.readUInt16LE(26),
        localExtraLength = local.readUInt16LE(28);
      const dataEnd = localOffset + 30 + localNameLength + localExtraLength + packed;
      if (
        local.readUInt32LE(0) !== 0x04034b50 ||
        local.readUInt16LE(6) !== flags ||
        local.readUInt16LE(8) !== method ||
        !read(localOffset + 30, localNameLength).equals(nameBytes) ||
        dataEnd > centralOffset ||
        central.readUInt16LE(offset + 34) !== 0
      )
        throw Error('Runtime ZIP local header mismatch.');
      spans.push([localOffset, dataEnd]);
      offset += 46 + nameLength + extraLength + commentLength;
    }
    if (offset !== central.length) throw Error('Invalid runtime ZIP directory length.');
    spans.sort((a, b) => a[0] - b[0]);
    if (spans.some((span, index) => index > 0 && spans[index - 1][1] > span[0]))
      throw Error('Overlapping runtime ZIP entries.');
    return { installedBytes: expanded, files: count };
  } finally {
    fs.closeSync(fd);
  }
}
module.exports = { inspectRuntimeZip };
