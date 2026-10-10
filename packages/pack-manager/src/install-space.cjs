const fs = require('node:fs');
const path = require('node:path');

// statfs reports free space available to this user, on the destination filesystem.
function availableSpace(directory) {
  let existing = path.resolve(directory);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw Error('Cannot inspect installation disk space.');
    existing = parent;
  }
  const stats = fs.statfsSync(existing, { bigint: true });
  return Number(stats.bavail * stats.bsize);
}
function footprint(downloadBytes, installedBytes, { estimated = false, cacheReused = false } = {}) {
  if (![downloadBytes, installedBytes].every(bytes => Number.isSafeInteger(bytes) && bytes >= 0))
    throw Error('Invalid installation footprint.');
  const safetyBytes = Math.max(64 * 1024 ** 2, Math.ceil(installedBytes * 0.05));
  return {
    downloadBytes,
    installedBytes,
    requiredBytes: downloadBytes + installedBytes + safetyBytes,
    estimated,
    cacheReused,
  };
}
function checkSpace(directory, estimate, space = availableSpace) {
  const availableBytes = space(directory);
  if (!Number.isSafeInteger(availableBytes) || availableBytes < 0)
    throw Error('Cannot inspect installation disk space.');
  if (availableBytes < estimate.requiredBytes) {
    const error = Error(
      `Insufficient disk space: ${estimate.requiredBytes} bytes required, ${availableBytes} bytes available. Free space and retry; installed versions are preserved.`,
    );
    error.code = 'ENOSPC';
    error.requiredBytes = estimate.requiredBytes;
    error.availableBytes = availableBytes;
    throw error;
  }
  return { ...estimate, availableBytes };
}
module.exports = { availableSpace, footprint, checkSpace };
