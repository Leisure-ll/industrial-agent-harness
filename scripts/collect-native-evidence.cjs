const fs = require('node:fs');
const path = require('node:path');

function collectNativeEvidence(source, destination) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  if (!fs.existsSync(source)) return { collected: false, excludedRuntimeStores: [] };
  const excludedRuntimeStores = [];
  fs.cpSync(source, destination, {
    recursive: true,
    filter(file) {
      const relative = path.relative(source, file);
      const parts = relative.split(path.sep);
      // Managed application bundles and download caches are reproducible inputs,
      // not task evidence. upload-artifact already omits these hidden stores;
      // avoid copying several GB before that exclusion. Keep project outputs,
      // installed Pack manifests, identities in managed-installation.json,
      // and all other hidden records unchanged.
      if (parts.length === 3 && parts[1] === 'installed' && parts[2] === '.runtime-assets') {
        excludedRuntimeStores.push(relative);
        return false;
      }
      return true;
    },
  });
  return { collected: true, excludedRuntimeStores };
}

module.exports = { collectNativeEvidence };
if (require.main === module) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw Error('Expected evidence source and destination directories.');
  console.log(JSON.stringify(collectNativeEvidence(source, destination)));
}
