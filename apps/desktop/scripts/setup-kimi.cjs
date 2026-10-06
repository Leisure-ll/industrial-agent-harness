const { spawnSync } = require('node:child_process');
const { bundledExecutable, KIMI_CODE_VERSION } = require('@industrial-agent-harness/agent-kimi');
const result = spawnSync(process.execPath, [bundledExecutable(), '--version'], {
  encoding: 'utf8',
  env: { ...process.env, KIMI_CODE_NO_AUTO_UPDATE: '1', ELECTRON_RUN_AS_NODE: '1' },
  timeout: 10000,
});
if (result.error || result.status !== 0 || result.stdout.trim() !== KIMI_CODE_VERSION)
  throw Error('Run pnpm install to restore the pinned Kimi Code runtime.');
process.stdout.write(
  `Kimi Code ${KIMI_CODE_VERSION} is installed with the workspace dependencies.\n`,
);
