#!/usr/bin/env node
// Packaging format conversion only; selected image-edit masters stay unchanged.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const assets = path.resolve(__dirname, '../apps/desktop/public');
const branding = path.resolve(__dirname, '../apps/desktop/branding');
const source = path.join(branding, 'product-mark-transparent.png');
const appIcon = path.join(branding, 'app-icon-master.png');
if (process.platform !== 'darwin')
  throw Error('Regenerate icons on macOS with the native sips tool.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-product-icons-'));
try {
  execFileSync('sips', ['-z', '64', '64', source, '--out', path.join(assets, 'product-mark.png')]);
  execFileSync('sips', ['-z', '1024', '1024', appIcon, '--out', path.join(assets, 'app-icon.png')]);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map(size => {
    const target = path.join(temporary, `${size}.png`);
    execFileSync('sips', ['-z', String(size), String(size), appIcon, '--out', target]);
    return fs.readFileSync(target);
  });
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  fs.writeFileSync(path.join(assets, 'app-icon.ico'), Buffer.concat([header, ...images]));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
