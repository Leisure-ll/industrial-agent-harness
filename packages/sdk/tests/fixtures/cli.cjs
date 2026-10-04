const fs = require('node:fs');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
const command = args[0];
const task = args.includes('--task-file') ? fs.readFileSync(value('--task-file'), 'utf8') : '';
const emit = event => process.stdout.write(JSON.stringify({ schemaVersion: 1, runId: 'run-1', ...event }) + '\n');
if (command === 'chats') emit({ type: 'chats', chats: [{ id: 'chat-1' }] });
else if (task === 'invalid') process.stdout.write('invalid json\n');
else if (task === 'failure') { process.stderr.write('diagnostic ' + process.env.KIMI_API_KEY); emit({ type: 'error', message: 'failure' }); process.exitCode = 1; }
else if (task === 'hang' || task === 'orphan') {
  const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
  emit({ type: 'child', pid: descendant.pid });
  if (task === 'orphan') { emit({ type: 'result', status: 'completed' }); process.exit(0); }
  process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
} else if (task === 'overflow') { for (let i = 0; i < 50; i++) emit({ type: 'text', text: 'x' }); setInterval(() => {}, 1000); }
else {
  emit({ type: 'scope', scope: { domain: value('--domain') } });
  emit({ type: 'chat', chatId: value('--chat-id') || 'chat-1' });
  emit({ type: 'text', text: task });
  emit({ type: 'result', status: args.includes('--scope-only') ? 'scoped' : 'completed', chatId: value('--chat-id') || 'chat-1' });
}
