const CHUNK_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;

// Retain chunks until a complete record arrives, then join them once. Repeatedly
// concatenating the partial record copies a large tool result quadratically.
async function scanRecords(handle, size, cursor, consume) {
  let position = cursor;
  let fragments = [];
  let pendingBytes = 0;
  while (position < size) {
    const bytes = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, size - position));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, position);
    if (bytesRead !== bytes.length) throw Error('Diagnostic log changed while indexing.');
    position += bytesRead;
    let start = 0;
    let newline;
    while ((newline = bytes.indexOf(10, start)) >= 0) {
      const length = pendingBytes + newline - start;
      if (length > MAX_RECORD_BYTES)
        throw Error('Diagnostic record exceeds the 16 MiB viewing limit.');
      const last = bytes.subarray(start, newline);
      const raw = fragments.length ? Buffer.concat([...fragments, last], length) : last;
      consume(raw.toString('utf8'), cursor, length);
      cursor += length + 1;
      start = newline + 1;
      fragments = [];
      pendingBytes = 0;
    }
    if (start < bytes.length) {
      fragments.push(bytes.subarray(start));
      pendingBytes += bytes.length - start;
      if (pendingBytes > MAX_RECORD_BYTES)
        throw Error('Diagnostic record exceeds the 16 MiB viewing limit.');
    }
  }
  return { cursor, pending: pendingBytes > 0 };
}

module.exports = { scanRecords, CHUNK_BYTES };
