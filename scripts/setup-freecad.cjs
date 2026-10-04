#!/usr/bin/env node
// Official upstream binary stays outside Pack archives; pinned native CI dependency.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const NAME = 'FreeCAD_1.1.4-macOS-arm64-py311.dmg';
const SHA = '071343b4abb70492b75c973f41eaf1d2528f9b9c7ea018d22a4f46ae14d27ac0';
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw Error('FreeCAD native acceptance currently requires macOS arm64.');
  const root = path.resolve(process.argv[2] || 'dist/freecad-runtime');
  fs.mkdirSync(root, { recursive: true });
  const dmg = path.join(root, NAME),
    mount = path.join(root, 'mount');
  if (!fs.existsSync(dmg)) {
    const response = await fetch(
      'https://github.com/FreeCAD/FreeCAD/releases/download/1.1.4/' + NAME,
    );
    if (!response.ok) throw Error('Official FreeCAD download failed: ' + response.status);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(dmg, { flags: 'wx' }));
  }
  const digest = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(dmg)) digest.update(bytes);
  if (digest.digest('hex') !== SHA) throw Error('FreeCAD official asset SHA-256 mismatch.');
  const command = path.join(mount, 'FreeCAD.app/Contents/Resources/bin/freecadcmd');
  if (!fs.existsSync(command)) {
    const result = spawnSync(
      'hdiutil',
      ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg],
      { stdio: 'inherit' },
    );
    if (result.error || result.status !== 0)
      throw result.error || Error('FreeCAD disk-image mount failed.');
  }
  if (!fs.existsSync(command)) throw Error('Pinned FreeCAD executable is missing.');
  fs.writeFileSync(
    path.join(root, 'provenance.json'),
    JSON.stringify(
      {
        version: '1.1.4',
        url: 'https://github.com/FreeCAD/FreeCAD/releases/tag/1.1.4',
        sha256: SHA,
        command,
      },
      null,
      2,
    ),
  );
  if (process.env.GITHUB_ENV)
    fs.appendFileSync(process.env.GITHUB_ENV, `INDUSTRIAL_HARNESS_FREECAD_CMD=${command}\n`);
  console.log(command);
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
