const path = require('node:path');
const root = __dirname;
const updateUrl = process.env.HARNESS_CORE_UPDATE_URL || 'https://updates.invalid/industrial-agent-harness/beta';
const release = process.env.HARNESS_RELEASE_BUILD === '1';

module.exports = {
  appId: 'com.zhiman.industrial-agent-harness',
  productName: 'Industrial Agent Harness',
  directories: {output: path.join(root, 'dist', 'desktop-release')},
  files: ['dist/**/*', 'electron/**/*.cjs', 'node_modules/**/*', 'package.json'],
  extraResources: [{from: 'pack-feed.json', to: 'pack-feed.json'}],
  asar: true,
  forceCodeSigning: release,
  mac: {target: ['dmg', 'zip'], category: 'public.app-category.developer-tools', hardenedRuntime: true, notarize: release},
  win: {target: ['nsis']},
  nsis: {oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true},
  publish: [{provider: 'generic', url: updateUrl}],
};
