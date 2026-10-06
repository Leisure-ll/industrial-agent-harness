const fs = require('node:fs');
const path = require('node:path');
const { PackManager, defaultPackDirectory } = require('@industrial-agent-harness/pack-manager');

const usage = `industrial-harness domains list [--store DIR]
industrial-harness domains available --catalog HTTPS_URL --keys-file FILE [--store DIR]
industrial-harness domains install DOMAIN --catalog HTTPS_URL --keys-file FILE [--store DIR]
industrial-harness domains update --catalog HTTPS_URL --keys-file FILE [--store DIR]
industrial-harness domains remove DOMAIN [--store DIR]
industrial-harness domains repair DOMAIN [--store DIR]
Use a trusted public-key JSON file: {"key-id":"-----BEGIN PUBLIC KEY-----..."}.
Set INDUSTRIAL_HARNESS_PACK_STORE to the same store for run and bench.\n`;

function parse(argv) {
  if (!argv.length || argv.includes('--help')) return { help: true };
  const command = argv[0];
  if (!['list', 'available', 'install', 'update', 'remove', 'repair'].includes(command))
    throw Error('Unknown domains command.');
  const options = { command };
  for (let index = 1; index < argv.length; index++) {
    const token = argv[index];
    if (['--store', '--catalog', '--keys-file'].includes(token)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw Error(`Missing ${token} value.`);
      const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (options[key]) throw Error(`Duplicate ${token}.`);
      options[key] = value;
    } else if (!options.domain && !token.startsWith('--')) options.domain = token;
    else throw Error(`Unknown domains option: ${token}`);
  }
  if (['install', 'remove', 'repair'].includes(command) !== Boolean(options.domain))
    throw Error('Specify one Domain ID for install or remove.');
  if (
    ['available', 'install', 'update'].includes(command) &&
    (!options.catalog || !options.keysFile)
  )
    throw Error('Provide --catalog and --keys-file.');
  return options;
}

async function runDomains(argv, output = process.stdout) {
  const options = parse(argv);
  if (options.help) {
    output.write(usage);
    return 0;
  }
  const directory = path.resolve(options.store || defaultPackDirectory());
  const keys = options.keysFile
    ? JSON.parse(fs.readFileSync(path.resolve(options.keysFile), 'utf8'))
    : {};
  const manager = new PackManager({ directory, keys });
  process.env.INDUSTRIAL_HARNESS_PACK_STORE = directory;
  if (options.command === 'list') {
    output.write(
      `${JSON.stringify({ store: directory, installed: manager.list().map(({ location, ...item }) => ({ domain: item.domain, version: item.version, label: item.label, location, runtimeAssets: manager.runtimeAssets.status(item.runtimeAssets) })) }, null, 2)}\n`,
    );
    return 0;
  }
  if (options.command === 'remove') {
    manager.remove(options.domain);
    output.write(`${JSON.stringify({ removed: options.domain })}\n`);
    return 0;
  }
  const onProgress = progress =>
    output.write(`${JSON.stringify({ type: 'runtime_progress', ...progress })}\n`);
  if (options.command === 'repair') {
    manager.assertIdle(options.domain);
    const bundle = manager.list().find(item => item.domain === options.domain);
    if (!bundle) throw Error('Domain is not installed.');
    await manager.runtimeAssets.ensure(bundle.runtimeAssets, { recheck: true, onProgress });
    output.write(`${JSON.stringify({ repaired: options.domain })}\n`);
    return 0;
  }
  const catalog = await manager.catalog(options.catalog);
  const available = catalog.packs.filter(item =>
    item.platforms.includes(`${process.platform}-${process.arch}`),
  );
  if (options.command === 'available') {
    output.write(`${JSON.stringify({ channel: catalog.channel, packs: available }, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'install') {
    const item = available.find(pack => pack.domain === options.domain);
    if (!item) throw Error('Domain is unavailable for this platform.');
    const installed = await manager.install(item, { prepareRuntime: true, onProgress });
    output.write(
      `${JSON.stringify({ installed: installed.domain, version: installed.version })}\n`,
    );
    return 0;
  }
  const current = new Map(manager.list().map(item => [item.domain, item.version]));
  for (const item of available) {
    if (
      !current.has(item.domain) ||
      item.version.localeCompare(current.get(item.domain), 'en', { numeric: true }) <= 0
    )
      continue;
    const installed = await manager.install(item, { prepareRuntime: true, onProgress });
    output.write(`${JSON.stringify({ updated: installed.domain, version: installed.version })}\n`);
  }
  return 0;
}

module.exports = { runDomains, parse, usage };
