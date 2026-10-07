#!/usr/bin/env node
// Exercise both installed runtimes, with actual application data rather than sentinels.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ChatStore } = require('../packages/harness-core/src/index.cjs');
const { DatabaseSync } = require('node:sqlite');
const { saveProfile, readProfile } = require('../packages/agent-kimi/src/model-config.cjs');
const { startModel } = require('../tests/integration/fixtures/domain-mcp-model.cjs');
const execute = promisify(execFile);
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function snapshot(directory) {
  return [...fs.globSync('**/*', { cwd: directory })]
    .filter(name => fs.lstatSync(path.join(directory, name)).isFile())
    .map(name => ({
      file: path.join(directory, name),
      sha256: digest(path.join(directory, name)),
    }));
}
async function main() {
  const [oldPrefix, installer, prefix, binDir, data, reportFile] = process.argv.slice(2);
  if (![oldPrefix, installer, prefix, binDir, data, reportFile].every(Boolean))
    throw Error(
      'Provide previous installation prefix, candidate installer, new prefix, shared bin directory, isolated user directory and report file.',
    );
  const oldEntry = path.join(binDir, 'industrial-harness-chip');
  fs.mkdirSync(data, { recursive: true });
  const project = path.join(data, 'project'),
    config = path.join(data, 'config'),
    chats = path.join(data, 'chats');
  fs.mkdirSync(project);
  // A real declared engineering project, preserved without installer mutation.
  fs.writeFileSync(path.join(project, 'design.cjs'), 'module.exports = 42;\n');
  fs.writeFileSync(
    path.join(project, 'harness.tasks.json'),
    JSON.stringify({ schemaVersion: '1', tasks: {} }),
  );
  const model = await startModel({ calls: [], success: 'UPGRADE_CONTEXT_REPLY' });
  const profile = saveProfile(config, {
    provider: 'openai_legacy',
    endpoint: model.endpoint,
    model: 'upgrade-fixture',
    contextSize: 262144,
    thinking: false,
    imageInput: false,
  });
  const env = {
    ...process.env,
    KIMI_EXECUTABLE: '',
    OPENAI_API_KEY: 'controlled-upgrade-key',
    UPGRADE_MCP_TOKEN: 'controlled-upgrade-secret',
    INDUSTRIAL_HARNESS_CONFIG_DIR: config,
  };
  const invoke = async (entry, args) => {
    const result = await execute(
      entry.endsWith('.cjs') ? process.execPath : entry,
      entry.endsWith('.cjs') ? [entry, ...args] : args,
      { cwd: project, env, timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
    );
    return result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  };
  const prompt = async (entry, task, chatId) => {
    const args = [
      'run',
      '--project-dir',
      project,
      '--domain',
      'chip',
      '--task',
      task,
      '--provider',
      'openai_legacy',
      '--endpoint',
      model.endpoint,
      '--model',
      profile.model,
      '--no-thinking',
      '--timeout-ms',
      '60000',
      '--chat-dir',
      chats,
      '--state-dir',
      path.join(data, 'state'),
      '--log-dir',
      path.join(data, 'logs'),
    ];
    if (chatId) args.push('--chat-id', chatId);
    const rows = await invoke(entry, args);
    assert.equal(rows.at(-1).status, 'finished', JSON.stringify(rows));
    assert.match(
      rows
        .filter(row => row.event?.type === 'text')
        .map(row => row.event.text)
        .join(''),
      /UPGRADE_CONTEXT_REPLY/,
    );
    assert.ok(!rows[0].scope.tools.some(id => id.startsWith('external.host.')));
    return rows.at(-1).chatId;
  };
  const history = chatId => {
    const store = new ChatStore(chats);
    try {
      return {
        turns: store.history(chatId, project, 'chip').turns,
        sessions: store.db
          .prepare(
            'SELECT id, compatibility_key FROM runtime_sessions WHERE chat_id = ? ORDER BY rowid',
          )
          .all(chatId),
      };
    } finally {
      store.close();
    }
  };
  try {
    const registration = path.join(data, 'mcp-import.json');
    fs.writeFileSync(
      registration,
      JSON.stringify({
        mcpServers: {
          host: {
            command: process.execPath,
            args: [
              path.resolve(__dirname, '../tests/integration/fixtures/external-mcp-server.cjs'),
            ],
            cwd: project,
            envRefs: { FIXTURE_SECRET: 'UPGRADE_MCP_TOKEN' },
          },
        },
      }),
    );
    assert.equal(
      (await invoke(oldEntry, ['mcp', 'add', '--file', registration]))[0].servers[0].id,
      'external.host',
    );
    await invoke(oldEntry, ['mcp', 'disable', 'external.host', '--project-dir', project]);
    const chatId = await prompt(oldEntry, 'Remember BEFORE_UPGRADE_CONTEXT_MARKER. Reply.', null);
    assert.equal(await prompt(oldEntry, 'Continue before upgrading. Reply.', chatId), chatId);
    assert.ok(
      JSON.stringify(model.requests.at(-1).messages).includes('BEFORE_UPGRADE_CONTEXT_MARKER'),
    );
    const before = history(chatId);
    assert.equal(before.turns.length, 2);
    assert.equal(before.sessions.length, 1);
    const preserved = [
      // Resource leases are operational data: each CLI process changes this
      // database even after deleting its leases. Preserve settings byte-for-byte,
      // and validate lease cleanup semantically instead.
      ...snapshot(config).filter(
        item => !/^session-resources\.sqlite(?:-wal|-shm)?$/.test(path.basename(item.file)),
      ),
      ...snapshot(project),
      ...snapshot(path.join(chats, 'sessions', before.sessions[0].id)),
    ];
    assert.ok(
      preserved.some(item => /context.*jsonl/.test(item.file)),
      'Must preserve a real native model transcript.',
    );
    const receiptFile = path.join(oldPrefix, 'install-receipt.json'),
      oldReceipt = digest(receiptFile);
    // Candidate installation owns only its new prefix and the shared launcher.
    await execute('bash', [installer, '--skip-image', '--prefix', prefix, '--bin-dir', binDir], {
      env,
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    for (const item of preserved) assert.equal(digest(item.file), item.sha256, item.file);
    assert.equal(digest(receiptFile), oldReceipt);
    assert.deepEqual(readProfile(config), profile);
    const newEntry = path.join(binDir, 'industrial-harness-chip');
    const launcher = fs.readFileSync(newEntry, 'utf8');
    assert.ok(
      launcher.includes(prefix.replaceAll(' ', '\\ ')) &&
        !launcher.includes(oldPrefix.replaceAll(' ', '\\ ')),
      'Managed launcher must switch to the candidate.',
    );
    assert.equal((await invoke(newEntry, ['mcp', 'list']))[0].servers[0].id, 'external.host');
    assert.ok(
      (
        await invoke(newEntry, [
          'chats',
          '--project-dir',
          project,
          '--domain',
          'chip',
          '--chat-dir',
          chats,
        ])
      )[0].chats.some(chat => chat.id === chatId),
    );
    assert.equal(
      await prompt(newEntry, 'Remember AFTER_UPGRADE_CONTEXT_MARKER. Reply.', chatId),
      chatId,
    );
    assert.equal(await prompt(newEntry, 'Continue after upgrading. Reply.', chatId), chatId);
    assert.ok(
      JSON.stringify(model.requests.at(-1).messages).includes('AFTER_UPGRADE_CONTEXT_MARKER'),
    );
    const after = history(chatId);
    assert.deepEqual(after.turns.slice(0, 2), before.turns);
    assert.equal(after.turns.length, 4);
    assert.equal(
      after.sessions.length,
      2,
      'Changed native kernel and tool scope must rotate context once.',
    );
    assert.notEqual(after.sessions[1].compatibility_key, before.sessions[0].compatibility_key);
    for (const item of preserved) assert.equal(digest(item.file), item.sha256, item.file);
    const resources = new DatabaseSync(path.join(config, 'session-resources.sqlite'), {
      readOnly: true,
    });
    try {
      assert.equal(resources.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(
        resources.prepare('SELECT COUNT(*) AS count FROM session_leases').get().count,
        0,
      );
      assert.equal(
        resources.prepare('SELECT COUNT(*) AS count FROM resource_owners').get().count,
        0,
      );
    } finally {
      resources.close();
    }
    const report = {
      status: 'PASS',
      previousRelease: 'chip-linux-installer-v0.1.0-preview.4',
      preservedChatId: chatId,
      priorTurnsRetained: 2,
      currentTurns: 4,
      nativeSegments: 2,
      nativeContextContinues: true,
      preservedFiles: preserved.length,
      modelProfileRetained: true,
      mcpRegistrationRetained: true,
      projectResourcePolicyRetained: true,
      resourceLeasesCleaned: true,
      previousInstallRetained: true,
      installedLauncher: newEntry,
    };
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally {
    model.close();
  }
}
main().catch(error => {
  process.stderr.write(String(error.stack) + '\n');
  process.exitCode = 1;
});
