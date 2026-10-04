const fs = require('node:fs');
const path = require('node:path');

function copyReleaseNotices(target, root = path.resolve(__dirname, '..')) {
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const file = path.join(root, name);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile())
      throw Error(`Release license notice is missing: ${name}`);
    fs.copyFileSync(file, path.join(target, name));
  }
}

function copyDesktopNotices(target, root = path.resolve(__dirname, '..')) {
  const groups = [
    ['packages/viewer-builtin/src/kicad/vendor', 'kicanvas'],
    ['packages/viewer-builtin/src/waveform/surfer', 'surfer'],
  ];
  for (const [source, group] of groups) {
    const destination = path.join(target, 'licenses', group);
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(path.join(root, source)))
      if (/license|notice|readme|manifest/i.test(name))
        fs.copyFileSync(path.join(root, source, name), path.join(destination, name));
  }
  for (const name of ['viewer-eda-reference.md', 'viewer-provenance.md', 'agent-ui-provenance.md'])
    fs.copyFileSync(path.join(root, 'doc', name), path.join(target, 'licenses', name));
}

module.exports = { copyReleaseNotices, copyDesktopNotices };
