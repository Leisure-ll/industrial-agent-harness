const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safe = value =>
  typeof value === 'string' &&
  /^[A-Za-z0-9._ -]+(?:\/[A-Za-z0-9._ -]+)*$/.test(value) &&
  !value.split('/').some(part => part === '.' || part === '..');
function validateRuntimeAssets(assets = []) {
  if (!Array.isArray(assets) || assets.length > 8) throw Error('Invalid runtime assets.');
  const ids = new Set(),
    variables = new Set();
  for (const asset of assets) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(asset?.id || '') ||
      ids.has(asset.id) ||
      !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/.test(asset.version || '') ||
      typeof asset.label !== 'string' ||
      !asset.label ||
      asset.type !== 'macos-app-dmg' ||
      asset.platform !== 'darwin-arm64' ||
      !/^https:\/\//.test(asset.url || '') ||
      !/^[a-f0-9]{64}$/.test(asset.sha256 || '') ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > 2 * 1024 ** 3 ||
      !safe(asset.app) ||
      asset.app.includes('/') ||
      !asset.app.endsWith('.app') ||
      !safe(asset.executable) ||
      !asset.executable.startsWith('Contents/') ||
      !/^INDUSTRIAL_HARNESS_[A-Z0-9_]+$/.test(asset.environment || '') ||
      variables.has(asset.environment) ||
      !Array.isArray(asset.versionArgs) ||
      !asset.versionArgs.length ||
      asset.versionArgs.length > 4 ||
      asset.versionArgs.some(arg => !/^--[a-z-]+$/.test(arg)) ||
      typeof asset.versionText !== 'string' ||
      !asset.versionText ||
      asset.versionText.length > 100
    )
      throw Error('Invalid managed runtime declaration.');
    const url = new URL(asset.url);
    if (url.username || url.password) throw Error('Runtime URL cannot contain credentials.');
    if (
      !asset.profileEnvironment ||
      typeof asset.profileEnvironment !== 'object' ||
      Array.isArray(asset.profileEnvironment) ||
      Object.entries(asset.profileEnvironment).some(
        ([key, value]) =>
          !/^[A-Z][A-Z0-9_]+$/.test(key) ||
          ['PATH', 'HOME', 'TMPDIR', 'NODE_OPTIONS'].includes(key) ||
          !['home', 'data', 'temp'].includes(value),
      )
    )
      throw Error('Invalid runtime probe profile.');
    ids.add(asset.id);
    variables.add(asset.environment);
  }
  return assets;
}
async function fileHash(file) {
  const digest = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}
function run(command, args, { cwd, env, signal, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '',
      overflow = false,
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    const receive = bytes => {
      output += bytes;
      if (output.length > 1024 * 1024) {
        overflow = true;
        child.kill('SIGKILL');
      }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(Error(`Runtime preparation timed out after ${timeout / 1000} seconds.`));
      else if (code === 0 && !overflow) resolve(output);
      else reject(Error(`Runtime preparation failed (${code}): ${output.slice(-2000)}`));
    });
  });
}
async function download(asset, target, { signal, onProgress }) {
  const temporary = target + '.' + crypto.randomUUID() + '.partial';
  const timeout = AbortSignal.timeout(20 * 60 * 1000);
  const cancellation = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response,
    url = asset.url;
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (new URL(url).protocol !== 'https:') throw Error('Runtime downloads require HTTPS.');
      response = await fetch(url, { redirect: 'manual', signal: cancellation });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects === 5 || !response.headers.get('location'))
        throw Error('Too many runtime redirects.');
      url = new URL(response.headers.get('location'), url).toString();
      await response.body?.cancel();
    }
    if (!response.ok || !response.body)
      throw Error(`Runtime download failed: HTTP ${response.status}`);
    const fd = fs.openSync(temporary, 'wx', 0o600),
      digest = crypto.createHash('sha256');
    let received = 0,
      reported = 0;
    try {
      for await (const chunk of response.body) {
        cancellation.throwIfAborted();
        received += chunk.length;
        if (received > asset.size) {
          await response.body.cancel().catch(() => {});
          throw Error('Runtime download size mismatch.');
        }
        digest.update(chunk);
        fs.writeFileSync(fd, chunk);
        if (received - reported >= 1024 * 1024 || received === asset.size) {
          onProgress({ phase: 'downloading', received, total: asset.size });
          reported = received;
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    if (received !== asset.size || digest.digest('hex') !== asset.sha256)
      throw Error('Runtime download hash or size mismatch.');
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
class RuntimeAssetManager {
  constructor({
    directory,
    platform = `${process.platform}-${process.arch}`,
    command = run,
    fetchArchive = download,
  } = {}) {
    if (!directory) throw Error('Runtime asset store is required.');
    this.directory = path.join(path.resolve(directory), '.runtime-assets');
    this.platform = platform;
    this.command = command;
    this.fetchArchive = fetchArchive;
  }
  location(asset) {
    validateRuntimeAssets([asset]);
    return path.join(this.directory, asset.id, `${asset.version}-${asset.sha256}`);
  }
  status(assets = []) {
    validateRuntimeAssets(assets);
    return assets.map(asset => {
      try {
        if (asset.platform !== this.platform)
          throw Error('Runtime does not support this platform.');
        const location = this.location(asset),
          receipt = JSON.parse(fs.readFileSync(path.join(location, 'receipt.json'), 'utf8'));
        const executable = path.join(location, asset.app, asset.executable);
        if (
          receipt.sha256 !== asset.sha256 ||
          receipt.declarationHash !== hash(Buffer.from(JSON.stringify(asset))) ||
          !fs.realpathSync(executable).startsWith(fs.realpathSync(location) + path.sep) ||
          receipt.executableSha256 !== hash(fs.readFileSync(executable))
        )
          throw Error('Runtime installation changed.');
        return {
          id: asset.id,
          label: asset.label,
          version: asset.version,
          ready: true,
          executable,
          checkedAt: receipt.checkedAt,
        };
      } catch (error) {
        return {
          id: asset.id,
          label: asset.label,
          version: asset.version,
          ready: false,
          message: error.code === 'ENOENT' ? 'Runtime needs preparation.' : error.message,
        };
      }
    });
  }
  environment(assets = []) {
    const statuses = this.status(assets);
    return Object.fromEntries(
      assets.map((asset, index) => [asset.environment, statuses[index].executable || '']),
    );
  }
  async probe(asset, location, { signal } = {}) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runtime-check-'));
    for (const name of ['data', 'temp']) fs.mkdirSync(path.join(profile, name));
    try {
      const output = await this.command(
        path.join(location, asset.app, asset.executable),
        asset.versionArgs,
        {
          signal,
          cwd: profile,
          timeout: 30000,
          env: {
            PATH: '/usr/bin:/bin',
            HOME: profile,
            TMPDIR: path.join(profile, 'temp') + '/',
            PYTHONNOUSERSITE: '1',
            PYTHONDONTWRITEBYTECODE: '1',
            QT_QPA_PLATFORM: 'offscreen',
            ...Object.fromEntries(
              Object.entries(asset.profileEnvironment).map(([key, value]) => [
                key,
                value === 'home' ? profile : path.join(profile, value),
              ]),
            ),
          },
        },
      );
      if (!output.includes(asset.versionText)) throw Error('Runtime version check failed.');
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
  async ensure(assets = [], { onProgress = () => {}, signal, recheck = false } = {}) {
    validateRuntimeAssets(assets);
    if (!assets.length) return [];
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, 'prepare.lock');
    let fd;
    try {
      fd = fs.openSync(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (!Number.isInteger(owner.pid) || owner.pid < 1)
        throw Error('Invalid runtime preparation lock.');
      try {
        process.kill(owner.pid, 0);
      } catch (probe) {
        if (probe.code === 'ESRCH') {
          fs.rmSync(lock);
          return this.ensure(assets, { onProgress, signal, recheck });
        }
        throw probe;
      }
      throw Error('Runtime preparation is already in progress.');
    }
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    try {
      for (const asset of assets) {
        signal?.throwIfAborted();
        if (asset.platform !== this.platform)
          throw Error('Runtime does not support this platform.');
        const report = state => onProgress({ id: asset.id, label: asset.label, ...state });
        const target = this.location(asset);
        if (this.status([asset])[0].ready) {
          if (!recheck) {
            report({ phase: 'ready' });
            continue;
          }
          report({ phase: 'checking' });
          try {
            await this.command(
              '/usr/bin/codesign',
              ['--verify', '--deep', '--strict', path.join(target, asset.app)],
              { signal, timeout: 5 * 60 * 1000 },
            );
            await this.probe(asset, target, { signal });
            report({ phase: 'ready' });
            continue;
          } catch (error) {
            signal?.throwIfAborted();
            fs.rmSync(path.join(target, 'receipt.json'), { force: true });
          }
        }
        const cache = path.join(this.directory, 'cache');
        fs.mkdirSync(cache, { recursive: true });
        const archive = path.join(cache, asset.sha256 + '.dmg');
        report({ phase: 'checking' });
        if (
          fs.existsSync(archive) &&
          (fs.statSync(archive).size !== asset.size || (await fileHash(archive)) !== asset.sha256)
        )
          fs.rmSync(archive);
        if (!fs.existsSync(archive)) {
          report({ phase: 'downloading', received: 0, total: asset.size });
          await this.fetchArchive(asset, archive, { signal, onProgress: report });
        }
        // Always verify even cached input before mounting or executing anything.
        if (fs.statSync(archive).size !== asset.size || (await fileHash(archive)) !== asset.sha256)
          throw Error('Runtime archive verification failed.');
        const parent = path.dirname(target);
        fs.mkdirSync(parent, { recursive: true });
        const staging = fs.mkdtempSync(path.join(parent, '.staging-'));
        const mount = fs.realpathSync(
          fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runtime-mount-')),
        );
        const backup = target + '.previous-' + crypto.randomUUID();
        let mounted = false;
        try {
          report({ phase: 'installing' });
          await this.command(
            '/usr/bin/hdiutil',
            ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, archive],
            { signal, timeout: 5 * 60 * 1000 },
          );
          mounted = true;
          const source = fs.realpathSync(path.join(mount, asset.app));
          if (source !== path.join(mount, asset.app) || !fs.statSync(source).isDirectory())
            throw Error('Unexpected runtime app bundle.');
          await this.command('/usr/bin/ditto', [source, path.join(staging, asset.app)], {
            signal,
            timeout: 5 * 60 * 1000,
          });
          report({ phase: 'checking' });
          await this.command(
            '/usr/bin/codesign',
            ['--verify', '--deep', '--strict', path.join(staging, asset.app)],
            { signal, timeout: 5 * 60 * 1000 },
          );
          await this.probe(asset, staging, { signal });
          const executable = path.join(staging, asset.app, asset.executable);
          if (!fs.realpathSync(executable).startsWith(fs.realpathSync(staging) + path.sep))
            throw Error('Runtime executable escaped its app.');
          fs.writeFileSync(
            path.join(staging, 'receipt.json'),
            JSON.stringify({
              schemaVersion: 1,
              sha256: asset.sha256,
              declarationHash: hash(Buffer.from(JSON.stringify(asset))),
              executableSha256: hash(fs.readFileSync(executable)),
              checkedAt: new Date().toISOString(),
              url: asset.url,
            }),
            { flag: 'wx', mode: 0o600 },
          );
          signal?.throwIfAborted();
          if (fs.existsSync(target)) fs.renameSync(target, backup);
          try {
            fs.renameSync(staging, target);
          } catch (error) {
            if (fs.existsSync(backup)) fs.renameSync(backup, target);
            throw error;
          }
          fs.rmSync(backup, { recursive: true, force: true });
          report({ phase: 'ready' });
        } finally {
          try {
            if (mounted)
              await this.command('/usr/bin/hdiutil', ['detach', mount], { timeout: 60000 });
          } finally {
            fs.rmSync(staging, { recursive: true, force: true });
            fs.rmdirSync(mount);
          }
        }
      }
      return this.status(assets);
    } finally {
      fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
    }
  }
}
module.exports = { RuntimeAssetManager, validateRuntimeAssets, fileHash };
