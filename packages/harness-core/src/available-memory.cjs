const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function parseAvailableMemory(platform, source, fallback) {
  if (platform === 'linux') {
    const match = source.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    if (match) return Number(match[1]) * 1024;
  }
  if (platform === 'darwin') {
    const pageSize = Number(source.match(/page size of (\d+) bytes/)?.[1]);
    const pages = ['free', 'inactive', 'speculative'].map(name =>
      Number(source.match(new RegExp(`^Pages ${name}:\\s+(\\d+)\\.$`, 'm'))?.[1]),
    );
    if (pageSize && pages.every(Number.isFinite))
      return pages.reduce((sum, count) => sum + count, 0) * pageSize;
  }
  return fallback;
}

let cached;
function availableMemoryBytes() {
  const now = Date.now();
  if (cached && now - cached.at < 1000) return cached.bytes;
  let source = '';
  try {
    if (process.platform === 'linux') source = fs.readFileSync('/proc/meminfo', 'utf8');
    if (process.platform === 'darwin')
      source = execFileSync('/usr/bin/vm_stat', [], { encoding: 'utf8', timeout: 1000 });
  } catch {
    // Conservative fallback when the native availability probe cannot run.
  }
  cached = { at: now, bytes: parseAvailableMemory(process.platform, source, os.freemem()) };
  return cached.bytes;
}

module.exports = { availableMemoryBytes, parseAvailableMemory };
