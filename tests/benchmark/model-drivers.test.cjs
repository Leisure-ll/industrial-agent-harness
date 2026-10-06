const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const executable =
  process.env.KIMI_EXECUTABLE ||
  require('../../packages/agent-kimi/src/code-session.cjs').bundledExecutable();

test(
  'paired model drivers consume the pinned native Kimi and production Harness through the same controlled provider',
  { skip: !fs.existsSync(executable), timeout: 45000 },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-driver-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const requests = [];
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      requests.push(body);
      const choice = {
        index: 0,
        delta: {
          role: 'assistant',
          content: 'Controlled response; engineering verification is external.',
        },
        finish_reason: null,
      };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const base = {
        id: 'paired-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: body.model,
      };
      response.write(`data: ${JSON.stringify({ ...base, choices: [choice] })}\n\n`);
      response.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`,
      );
      response.end('data: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const profileFile = path.join(directory, 'profile.json');
    fs.writeFileSync(
      profileFile,
      JSON.stringify({
        provider: 'openai_legacy',
        endpoint: `http://127.0.0.1:${server.address().port}/v1`,
        model: 'paired-controlled',
        contextSize: 262144,
        thinking: false,
        imageInput: false,
        apiKeyEnv: 'OPENAI_API_KEY',
        kimiExecutable: executable,
        configurationId: 'controlled-paired-model-v1',
      }),
    );
    const taskFile = path.join(directory, 'task.txt');
    fs.writeFileSync(taskFile, 'Reply with a brief diagnostic acknowledgement.');
    for (const label of ['native-kimi', 'harness']) {
      const projectDir = path.join(directory, label);
      fs.mkdirSync(projectDir);
      const outputDir = path.join(directory, label + '-out');
      fs.mkdirSync(outputDir);
      const script =
        label === 'native-kimi' ? 'benchmark-native-kimi.cjs' : 'benchmark-harness.cjs';
      const args =
        label === 'native-kimi'
          ? [projectDir, taskFile, outputDir, profileFile]
          : [projectDir, 'chip', taskFile, outputDir, profileFile];
      const child = spawn(process.execPath, [path.join(root, 'scripts', script), ...args], {
        env: { ...process.env, OPENAI_API_KEY: 'local-driver-test-key' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      t.after(() => child.kill('SIGKILL'));
      let stdout = '',
        stderr = '';
      child.stdout.on('data', chunk => {
        stdout += chunk;
      });
      child.stderr.on('data', chunk => {
        stderr += chunk;
      });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
      const code = await new Promise(resolve => child.once('close', resolve));
      clearTimeout(timeout);
      assert.equal(code, 0, stdout + '\n' + stderr);
      const rows = stdout.trim().split('\n').map(JSON.parse);
      assert.equal(rows[0].configurationId, 'controlled-paired-model-v1');
      assert.ok(
        rows.some(
          row =>
            row.type === (label === 'native-kimi' ? 'native_result' : 'benchmark_transport_result'),
        ),
      );
    }
    assert.ok(requests.length >= 2);
    assert.ok(requests.every(request => request.model === 'paired-controlled'));
    assert.ok(
      requests.every(request =>
        JSON.stringify(request.messages).includes('diagnostic acknowledgement'),
      ),
    );
  },
);
