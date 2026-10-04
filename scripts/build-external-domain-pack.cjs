#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createArchive, decodeArchive, digest } = require('../packages/pack-manager/src/index.cjs');
const [source, output, ...extra] = process.argv.slice(2);
if (!source || extra.length)
  throw Error('Usage: node scripts/build-external-domain-pack.cjs SOURCE [OUTPUT.hpack]');
const directory = path.resolve(source);
for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
  if (!fs.statSync(path.join(directory, notice), { throwIfNoEntry: false })?.isFile())
    throw Error(`Missing Pack license material: ${notice}`);
const bytes = createArchive(directory);
const { bundle, files } = decodeArchive(bytes);
if (output) {
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
}
process.stdout.write(
  JSON.stringify({
    domain: bundle.domain,
    version: bundle.version,
    coreApi: bundle.coreApi,
    size: bytes.length,
    sha256: digest(bytes),
    files: files.length,
    output: output ? path.resolve(output) : null,
  }) + '\n',
);
