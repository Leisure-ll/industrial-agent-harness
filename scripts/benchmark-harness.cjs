#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('../packages/sdk/src/index.cjs');
const { readProfile } = require('./benchmark-model-profile.cjs');

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 5)
    throw Error('Usage: benchmark-harness.cjs PROJECT DOMAIN TASK_FILE OUTPUT_DIR PROFILE_FILE');
  const [projectDir, domain, taskFile, outputDir, profileFile] = argv;
  const { profile, apiKeyEnv, executable, configurationId } = readProfile(profileFile);
  const client = createClient({
    cliPath: path.resolve(__dirname, '../apps/cli/src/main.cjs'),
    projectDir,
    domain,
    environment: { INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(outputDir, 'resource-settings') },
  });
  const send = row => process.stdout.write(JSON.stringify(row) + '\n');
  send({
    type: 'benchmark_driver',
    driver: 'harness',
    configurationId,
    model: { provider: profile.provider, id: profile.model, configurationId },
    seedControl: 'not-enforced',
    acceptance: 'external-verifier-required',
  });
  const shutdown = () => {
    void client.close().finally(() => process.exit(130));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  try {
    const handle = client.run({
      task: fs.readFileSync(taskFile, 'utf8'),
      provider: profile.provider,
      endpoint: profile.endpoint,
      model: profile.model,
      contextSize: profile.contextSize,
      thinking: profile.thinking,
      imageInput: profile.imageInput,
      apiKeyEnv,
      kimiExecutable: executable,
      approval: 'auto',
      chatDir: path.join(outputDir, 'chats'),
      stateDir: path.join(outputDir, 'state'),
      logDir: path.join(outputDir, 'logs'),
    });
    for await (const event of handle.events) send(event);
    const result = await handle.result;
    send({ type: 'benchmark_transport_result', result });
  } finally {
    await client.close();
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
