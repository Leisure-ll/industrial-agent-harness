#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { readProfile } = require('./benchmark-model-profile.cjs');
const { writeCliConfig } = require('../packages/agent-kimi/src/model-config.cjs');
// Resolve the pinned SDK already owned by agent-kimi; do not invent another kernel.
const requireKimi = createRequire(path.resolve(__dirname, '../packages/agent-kimi/package.json'));
const { createSession } = requireKimi('@moonshot-ai/kimi-agent-sdk');

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4)
    throw Error('Usage: benchmark-native-kimi.cjs PROJECT TASK_FILE OUTPUT_DIR PROFILE_FILE');
  const [projectDir, taskFile, outputDir, profileFile] = argv;
  const { profile, executable, env, configurationId } = readProfile(profileFile);
  const shareDir = writeCliConfig(path.join(outputDir, 'native-kimi'), profile);
  const session = createSession({
    workDir: fs.realpathSync(projectDir),
    executable,
    shareDir,
    model: 'industrial',
    thinking: profile.thinking,
    env,
    yoloMode: true,
    externalTools: [],
    clientInfo: { name: 'industrial-paired-native-baseline', version: '1' },
  });
  const send = row => process.stdout.write(JSON.stringify(row) + '\n');
  send({
    type: 'benchmark_driver',
    driver: 'native-kimi',
    configurationId,
    model: { provider: profile.provider, id: profile.model, configurationId },
    seedControl: 'not-enforced',
    acceptance: 'external-verifier-required',
  });
  const shutdown = () => {
    void session.close().finally(() => process.exit(130));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  try {
    const turn = session.prompt(fs.readFileSync(taskFile, 'utf8'));
    for await (const event of turn) {
      send({ type: 'native_event', event });
      if (event.type === 'ApprovalRequest') await turn.approve(event.payload.id, 'approve');
      if (event.type === 'QuestionRequest')
        await turn.respondQuestion(event.payload.id, event.payload.id, {});
    }
    const result = await turn.result;
    send({ type: 'native_result', result });
    process.exitCode = result.status === 'finished' ? 0 : 1;
  } finally {
    await session.close();
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
  }
}
module.exports = { main };
if (require.main === module)
  main().catch(error => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  });
