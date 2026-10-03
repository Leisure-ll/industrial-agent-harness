const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MAX_COMPRESSED = 128 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
const MAX_FILES = 20000;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/;
const SHA = /^[a-f0-9]{64}$/;

function defaultPackDirectory(environment = process.env) {
  return (
    environment.INDUSTRIAL_HARNESS_PACK_STORE ||
    path.join(os.homedir(), '.industrial-agent-harness', 'packs')
  );
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safeRelative(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.split('/').some(part => !part || part === '.' || part === '..') ||
    path.posix.normalize(value) !== value
  )
    throw Error('Unsafe Pack path.');
  return value;
}

function validateBundle(bundle) {
  if (
    bundle?.schemaVersion !== 1 ||
    !ID.test(bundle.domain || '') ||
    !VERSION.test(bundle.version || '') ||
    bundle.coreApi !== 1 ||
    typeof bundle.label !== 'string' ||
    !bundle.label ||
    typeof bundle.emoji !== 'string' ||
    !Array.isArray(bundle.capabilities) ||
    !Array.isArray(bundle.skills) ||
    !Array.isArray(bundle.providerPacks)
  )
    throw Error('Invalid Domain Pack manifest.');
  for (const capability of bundle.capabilities)
    if (capability?.domain !== bundle.domain || typeof capability.id !== 'string')
      throw Error('Invalid Domain capability.');
  for (const skill of bundle.skills)
    if (
      skill?.domain !== bundle.domain ||
      typeof skill.id !== 'string' ||
      !safeRelative(skill.file).endsWith('/SKILL.md')
    )
      throw Error('Invalid Domain Skill.');
  for (const pack of bundle.providerPacks)
    if (
      pack?.domain !== bundle.domain ||
      pack?.provider?.domain !== bundle.domain ||
      !safeRelative(pack.provider.packDirectory)
    )
      throw Error('Invalid Domain provider.');
  return bundle;
}

function verifyCatalog(envelope, keys) {
  if (
    envelope?.schemaVersion !== 1 ||
    !envelope.payload ||
    typeof envelope.signature !== 'string' ||
    typeof envelope.keyId !== 'string'
  )
    throw Error('Invalid Pack catalog.');
  const key = keys[envelope.keyId];
  if (
    !key ||
    !crypto.verify(
      null,
      Buffer.from(stable(envelope.payload)),
      key,
      Buffer.from(envelope.signature, 'base64'),
    )
  )
    throw Error('Pack catalog signature is invalid.');
  const catalog = envelope.payload;
  if (
    catalog.schemaVersion !== 1 ||
    !['stable', 'beta'].includes(catalog.channel) ||
    !Array.isArray(catalog.packs)
  )
    throw Error('Invalid Pack catalog payload.');
  const ids = new Set();
  for (const item of catalog.packs) {
    if (
      !ID.test(item?.domain || '') ||
      ids.has(item.domain) ||
      !VERSION.test(item.version || '') ||
      !SHA.test(item.sha256 || '') ||
      typeof item.url !== 'string' ||
      !item.url ||
      !Number.isSafeInteger(item.size) ||
      item.size < 1 ||
      item.size > MAX_COMPRESSED ||
      !Array.isArray(item.platforms) ||
      !item.platforms.length
    )
      throw Error('Invalid Pack catalog entry.');
    ids.add(item.domain);
  }
  return catalog;
}

function signCatalog(payload, keyId, privateKey) {
  return {
    schemaVersion: 1,
    keyId,
    payload,
    signature: crypto.sign(null, Buffer.from(stable(payload)), privateKey).toString('base64'),
  };
}

function createArchive(sourceDirectory) {
  const bundle = validateBundle(
    JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'bundle.json'), 'utf8')),
  );
  const files = [];
  let total = 0;
  function visit(directory, relative = '') {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      safeRelative(name);
      if (entry.isDirectory()) visit(path.join(directory, entry.name), name);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(path.join(directory, entry.name));
        total += bytes.length;
        if (total > MAX_EXPANDED || files.length >= MAX_FILES)
          throw Error('Domain Pack exceeds size limits.');
        files.push({
          path: name,
          sha256: digest(bytes),
          mode: fs.statSync(path.join(directory, entry.name)).mode & 0o111 ? 'executable' : 'file',
          data: bytes.toString('base64'),
        });
      } else throw Error('Domain Pack cannot contain links or special files.');
    }
  }
  visit(sourceDirectory);
  if (!files.some(file => file.path === 'bundle.json'))
    throw Error('Missing Domain Pack manifest.');
  const compressed = zlib.gzipSync(
    Buffer.from(
      JSON.stringify({ schemaVersion: 1, domain: bundle.domain, version: bundle.version, files }),
    ),
    { level: 9 },
  );
  if (compressed.length > MAX_COMPRESSED) throw Error('Domain Pack archive exceeds size limits.');
  return compressed;
}

function decodeArchive(compressed) {
  if (!Buffer.isBuffer(compressed) || compressed.length > MAX_COMPRESSED)
    throw Error('Domain Pack download exceeds size limits.');
  const expanded = zlib.gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED * 2 });
  const archive = JSON.parse(expanded.toString('utf8'));
  if (
    archive?.schemaVersion !== 1 ||
    !ID.test(archive.domain || '') ||
    !VERSION.test(archive.version || '') ||
    !Array.isArray(archive.files) ||
    archive.files.length > MAX_FILES
  )
    throw Error('Invalid Domain Pack archive.');
  let total = 0;
  const seen = new Set();
  const files = archive.files.map(file => {
    const name = safeRelative(file.path);
    if (
      seen.has(name) ||
      !SHA.test(file.sha256 || '') ||
      !['file', 'executable'].includes(file.mode) ||
      typeof file.data !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)
    )
      throw Error('Invalid Domain Pack file.');
    seen.add(name);
    const bytes = Buffer.from(file.data, 'base64');
    total += bytes.length;
    if (total > MAX_EXPANDED || digest(bytes) !== file.sha256)
      throw Error('Domain Pack file verification failed.');
    return { path: name, bytes, mode: file.mode };
  });
  const manifest = files.find(file => file.path === 'bundle.json');
  if (!manifest) throw Error('Missing Domain Pack manifest.');
  const bundle = validateBundle(JSON.parse(manifest.bytes.toString('utf8')));
  if (bundle.domain !== archive.domain || bundle.version !== archive.version)
    throw Error('Domain Pack identity mismatch.');
  for (const skill of bundle.skills)
    if (!seen.has(skill.file)) throw Error(`Missing Domain Skill: ${skill.id}`);
  return { bundle, files };
}

async function download(url, expectedSize, maxBytes = MAX_COMPRESSED) {
  let response;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (new URL(url).protocol !== 'https:') throw Error('Pack downloads require HTTPS.');
    response = await fetch(url, { redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects === 5 || !response.headers.get('location'))
      throw Error('Pack download has too many redirects.');
    url = new URL(response.headers.get('location'), url).toString();
    await response.body?.cancel();
  }
  if (!response.ok) throw Error(`Pack download failed: HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw Error('Pack download exceeds size limits.');
    chunks.push(chunk);
  }
  if (expectedSize != null && size !== expectedSize) throw Error('Pack download size mismatch.');
  return Buffer.concat(chunks);
}

class PackManager {
  constructor({ directory = defaultPackDirectory(), keys = {}, channel = 'stable' } = {}) {
    this.directory = path.resolve(directory);
    this.keys = keys;
    this.channel = channel;
    this.verifiedEntries = new WeakSet();
  }
  stateFile() {
    return path.join(this.directory, 'installed.json');
  }
  withLock(action) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, 'install.lock');
    let fd;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fd = fs.openSync(lock, 'wx', 0o600);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try {
          owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
        } catch {
          throw Error('Domain installation is busy.');
        }
        if (!Number.isInteger(owner.pid) || owner.pid < 1)
          throw Error('Domain installation lock is invalid.');
        try {
          process.kill(owner.pid, 0);
          throw Error('Domain installation is busy.');
        } catch (probe) {
          if (probe.code !== 'ESRCH') throw probe;
        }
        fs.rmSync(lock, { force: true });
      }
    }
    if (fd === undefined) throw Error('Domain installation is busy.');
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
      return action();
    } finally {
      fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
    }
  }
  assertIdle(domain) {
    const directory = path.join(this.directory, 'leases', domain);
    if (!fs.existsSync(directory)) return;
    for (const file of fs.readdirSync(directory)) {
      const lease = path.join(directory, file);
      let pid;
      try {
        pid = JSON.parse(fs.readFileSync(lease, 'utf8')).pid;
      } catch {
        throw Error('Domain use lease is invalid.');
      }
      if (!Number.isInteger(pid) || pid < 1) throw Error('Domain use lease is invalid.');
      try {
        process.kill(pid, 0);
        throw Error(`Domain ${domain} is in use.`);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      fs.rmSync(lease, { force: true });
    }
  }
  acquireUse(domain) {
    if (!ID.test(domain || '')) throw Error('Invalid Domain ID.');
    const directory = path.join(this.directory, 'leases', domain);
    const lease = path.join(directory, `${process.pid}-${crypto.randomUUID()}.json`);
    this.withLock(() => {
      if (!this.readState().active[domain]) throw Error(`Domain ${domain} is not installed.`);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(lease, JSON.stringify({ pid: process.pid, domain }), {
        flag: 'wx',
        mode: 0o600,
      });
    });
    let released = false;
    return () => {
      if (!released) {
        released = true;
        fs.rmSync(lease, { force: true });
      }
    };
  }
  readState() {
    try {
      const state = JSON.parse(fs.readFileSync(this.stateFile(), 'utf8'));
      if (
        state?.schemaVersion !== 1 ||
        !state.active ||
        typeof state.active !== 'object' ||
        Array.isArray(state.active)
      )
        throw Error('Invalid installed Pack state.');
      for (const [id, version] of Object.entries(state.active))
        if (!ID.test(id) || !VERSION.test(version)) throw Error('Invalid installed Pack identity.');
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, active: {} };
      throw error;
    }
  }
  writeState(state) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile()}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, this.stateFile());
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  scan() {
    const state = this.readState();
    const installed = [],
      errors = [];
    for (const [domain, version] of Object.entries(state.active)) {
      try {
        const location = path.join(this.directory, domain, version);
        const bundle = validateBundle(
          JSON.parse(fs.readFileSync(path.join(location, 'bundle.json'), 'utf8')),
        );
        if (bundle.domain !== domain || bundle.version !== version)
          throw Error('Installed Domain Pack identity mismatch.');
        for (const skill of bundle.skills)
          if (
            !fs
              .statSync(path.join(location, ...skill.file.split('/')), { throwIfNoEntry: false })
              ?.isFile()
          )
            throw Error(`Installed Domain Skill is missing: ${skill.id}`);
        for (const provider of bundle.providerPacks)
          if (
            !fs
              .statSync(
                path.join(
                  location,
                  'domain-packs',
                  ...safeRelative(provider.provider.packDirectory).split('/'),
                ),
                { throwIfNoEntry: false },
              )
              ?.isDirectory()
          )
            throw Error(`Installed Domain provider is missing: ${provider.id}`);
        installed.push({ ...bundle, location });
      } catch (error) {
        errors.push({ domain, version, message: String(error) });
      }
    }
    return { installed, errors };
  }
  list() {
    return this.scan().installed;
  }
  async catalog(url) {
    const envelope = JSON.parse((await download(url, undefined, 2 * 1024 * 1024)).toString('utf8'));
    const catalog = verifyCatalog(envelope, this.keys);
    if (catalog.channel !== this.channel) throw Error('Pack catalog channel mismatch.');
    for (const entry of catalog.packs) {
      entry.url = new URL(entry.url, url).toString();
      if (!entry.url.startsWith('https://'))
        throw Error('Pack catalog has an insecure download URL.');
      Object.freeze(entry.platforms);
      Object.freeze(entry);
      this.verifiedEntries.add(entry);
    }
    return catalog;
  }
  async install(entry, { bytes, allowUnsigned = false } = {}) {
    if (!allowUnsigned && !this.verifiedEntries.has(entry))
      throw Error('Pack must come from a verified catalog.');
    if (
      !ID.test(entry?.domain || '') ||
      !VERSION.test(entry.version || '') ||
      !SHA.test(entry.sha256 || '')
    )
      throw Error('Invalid Pack selection.');
    if (entry.platforms && !entry.platforms.includes(`${process.platform}-${process.arch}`))
      throw Error('Domain Pack does not support this platform.');
    const archive = bytes || (await download(entry.url, entry.size));
    if (digest(archive) !== entry.sha256) throw Error('Domain Pack archive hash mismatch.');
    const { bundle, files } = decodeArchive(archive);
    if (bundle.domain !== entry.domain || bundle.version !== entry.version)
      throw Error('Domain Pack catalog identity mismatch.');
    if (bundle.coreApi !== 1) throw Error('Domain Pack requires another Core API.');
    const parent = path.join(this.directory, bundle.domain);
    const target = path.join(parent, bundle.version);
    const staging = path.join(parent, `.staging-${crypto.randomUUID()}`);
    const backup = path.join(parent, `.previous-${crypto.randomUUID()}`);
    try {
      return this.withLock(() => {
        this.assertIdle(bundle.domain);
        fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
        for (const file of files) {
          const output = path.join(staging, ...file.path.split('/'));
          fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
          fs.writeFileSync(output, file.bytes, {
            flag: 'wx',
            mode: file.mode === 'executable' ? 0o700 : 0o600,
          });
        }
        const replaced = fs.existsSync(target);
        if (replaced) fs.renameSync(target, backup);
        try {
          fs.renameSync(staging, target);
          const state = this.readState();
          state.active[bundle.domain] = bundle.version;
          this.writeState(state);
        } catch (error) {
          fs.rmSync(target, { recursive: true, force: true });
          if (replaced) fs.renameSync(backup, target);
          throw error;
        }
        fs.rmSync(backup, { recursive: true, force: true });
        return { ...bundle, location: target };
      });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  remove(domain) {
    if (!ID.test(domain || '')) throw Error('Invalid Domain ID.');
    return this.withLock(() => {
      this.assertIdle(domain);
      const state = this.readState();
      delete state.active[domain];
      this.writeState(state);
      fs.rmSync(path.join(this.directory, domain), { recursive: true, force: true });
    });
  }
}

module.exports = {
  PackManager,
  createArchive,
  decodeArchive,
  verifyCatalog,
  signCatalog,
  defaultPackDirectory,
  digest,
  validateBundle,
};
