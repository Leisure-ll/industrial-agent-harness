const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEME = 'harness-browser';
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MIME = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
};
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function normalizeBrowserUrl(input, localOrigins = new Set()) {
  if (typeof input !== 'string' || input.length > 8192 || /[\x00-\x20]/.test(input.trim()))
    throw Error('Enter a valid HTTP or HTTPS address.');
  let value = input.trim();
  if (!value || value === 'about:blank') return 'about:blank';
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(value)) value = `http://${value}`;
  else if (!/^[a-z][a-z\d+.-]*:/i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('Enter a valid HTTP or HTTPS address.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) &&
    !(url.protocol === `${SCHEME}:` && localOrigins.has(url.host))
  )
    throw Error('Only HTTP, HTTPS and opened project HTML pages are supported.');
  if (url.username || url.password) throw Error('Addresses cannot contain login credentials.');
  return url.href;
}

function clippedBounds(bounds, size) {
  if (!bounds || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(bounds[key])))
    throw Error('Invalid browser viewport.');
  const x = Math.max(0, Math.min(size.width, Math.round(bounds.x)));
  const y = Math.max(0, Math.min(size.height, Math.round(bounds.y)));
  const width = Math.max(0, Math.min(size.width - x, Math.round(bounds.width)));
  const height = Math.max(0, Math.min(size.height - y, Math.round(bounds.height)));
  return { x, y, width, height };
}

class BrowserFiles {
  constructor() {
    this.previews = new Map();
  }
  origins(projectId) {
    return new Set(
      [...this.previews].filter(([, p]) => p.projectId === projectId).map(([id]) => id),
    );
  }
  async register(project, file, expectedHash) {
    const root = await fs.realpath(project.path);
    const actual = await fs.realpath(file);
    if (!actual.startsWith(root + path.sep) || !/\.html?$/i.test(actual))
      throw Error('HTML preview must belong to the selected project.');
    const bytes = await this.read(actual);
    if (sha256(bytes) !== expectedHash) throw Error('HTML changed; reopen the file.');
    for (const [id, p] of this.previews) {
      if (p.projectId === project.id && p.file === actual && p.hash === expectedHash)
        return this.url(id, path.relative(root, actual));
    }
    if (this.previews.size >= 64) throw Error('Too many local previews. Restart to release them.');
    const id = crypto.randomUUID();
    this.previews.set(id, {
      projectId: project.id,
      root,
      file: actual,
      hash: expectedHash,
      hashes: new Map([[actual, expectedHash]]),
      paths: new Map([[path.relative(root, actual).split(path.sep).join('/'), actual]]),
    });
    return this.url(id, path.relative(root, actual));
  }
  url(id, relative) {
    return `${SCHEME}://${id}/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
  }
  async read(file) {
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
        throw Error('Preview resource exceeds 32 MiB.');
      const bytes = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== stat.size)
        throw Error('Preview resource changed while reading; reopen the HTML file.');
      return bytes.subarray(0, offset);
    } finally {
      await handle.close();
    }
  }
  async handle(request, projectId) {
    try {
      if (!['GET', 'HEAD', undefined].includes(request.method)) throw Error('Read-only preview.');
      const url = new URL(request.url);
      const p = this.previews.get(url.host);
      if (url.protocol !== `${SCHEME}:` || !p || p.projectId !== projectId)
        throw Error('Preview does not belong to this project.');
      const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (
        !relative ||
        relative.includes('\\') ||
        relative.includes('\0') ||
        relative.split('/').some(part => part.startsWith('.') || part === '..')
      )
        throw Error('Preview resource is outside the project.');
      const file = await fs.realpath(path.resolve(p.root, relative));
      if (
        !file.startsWith(p.root + path.sep) ||
        path
          .relative(p.root, file)
          .split(path.sep)
          .some(part => part.startsWith('.'))
      )
        throw Error('Preview resource is outside the project.');
      const mime = MIME[path.extname(file).toLowerCase()];
      if (!mime) throw Error('Unsupported preview resource.');
      if (p.paths.has(relative) && p.paths.get(relative) !== file)
        throw Error('Preview resource path changed; reopen the HTML file.');
      const bytes = await this.read(file);
      if ((await fs.realpath(file)) !== file)
        throw Error('Preview resource path changed; reopen the HTML file.');
      const hash = sha256(bytes);
      if (p.hashes.has(file) && p.hashes.get(file) !== hash)
        throw Error('Preview resource changed; reopen the HTML file.');
      if (p.paths.size >= 256 && !p.paths.has(relative)) throw Error('Too many preview resources.');
      p.hashes.set(file, hash);
      p.paths.set(relative, file);
      return new Response(request.method === 'HEAD' ? null : bytes, {
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "default-src 'self' https: http: data: blob:; script-src 'self' 'unsafe-inline' https: http:; style-src 'self' 'unsafe-inline' https: http:; object-src 'none'; frame-ancestors 'none'",
        },
      });
    } catch (error) {
      return new Response(String(error.message), {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }
  close() {
    this.previews.clear();
  }
}
module.exports = { SCHEME, BrowserFiles, normalizeBrowserUrl, clippedBounds, sha256 };
