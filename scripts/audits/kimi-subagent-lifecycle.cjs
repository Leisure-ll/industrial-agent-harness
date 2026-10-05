const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict');
const [repo, executable] = process.argv.slice(2);
const { KimiSession } = require(path.join(repo, 'packages/agent-kimi/src/index.cjs'));
const { validateProfile, writeCliConfig, sessionEnv } = require(
  path.join(repo, 'packages/agent-kimi/src/model-config.cjs'),
);
const { createSession, createKimiPaths } = require(
  path.join(repo, 'packages/agent-kimi/node_modules/@moonshot-ai/kimi-agent-sdk'),
);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-subagent-lifecycle-'));
const report = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const isChild = body =>
  body.messages.some(
    m => m.role === 'system' && /You are now running as a subagent/.test(textOf(m)),
  );
async function run(mode, scenario) {
  const root = path.join(base, mode, scenario),
    project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  const source = path.join(project, 'part.txt');
  fs.writeFileSync(source, 'LIFECYCLE_PART\n');
  let childStartedResolve, releaseChildResolve;
  const childStarted = new Promise(r => (childStartedResolve = r));
  const releaseChild = new Promise(r => (releaseChildResolve = r));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    requests.push(body);
    const results = body.messages.filter(m => m.role === 'tool');
    const n = results.length,
      child = isChild(body);
    let calls = [];
    if (child) {
      childStartedResolve();
      if (scenario === 'cancel' || scenario.startsWith('background-')) await releaseChild;
      const asksApproval = ['reject', 'background-approval'].includes(scenario);
      if (n === 0)
        calls = [
          {
            name: asksApproval ? 'Shell' : 'ReadFile',
            arguments: asksApproval ? { command: 'printf LIFECYCLE_APPROVAL' } : { path: source },
          },
        ];
    } else if (n === 0) {
      const types = scenario === 'parallel' ? ['coder', 'explore'] : ['coder'];
      calls = types.map(type => ({
        name: 'Agent',
        arguments: {
          description: `Audit ${scenario} lifecycle`,
          subagent_type: type,
          prompt: `Inspect ${source}.`,
          run_in_background: scenario.startsWith('background-'),
        },
      }));
    }
    const message = calls.length
      ? {
          role: 'assistant',
          content: null,
          tool_calls: calls.map((call, i) => ({
            id: `audit-${requests.length}-${i}`,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        }
      : { role: 'assistant', content: 'LIFECYCLE_FINAL_SUMMARY' };
    res.writeHead(200, { 'Content-Type': body.stream ? 'text/event-stream' : 'application/json' });
    if (!body.stream)
      return res.end(
        JSON.stringify({
          id: 'audit',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [{ index: 0, message, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        }),
      );
    const delta = calls.length
      ? {
          role: 'assistant',
          tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })),
        }
      : message;
    res.write(
      `data: ${JSON.stringify({ id: 'audit', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
    );
    res.end(
      `data: ${JSON.stringify({ id: 'audit', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const profile = validateProfile({
    provider: 'openai_legacy',
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    model: 'controlled-lifecycle',
    contextSize: 262144,
    thinking: false,
  });
  const runtime = {
    profile,
    apiKey: 'fixture-key',
    shareDir: writeCliConfig(path.join(root, 'model'), profile),
    env: sessionEnv(profile, 'fixture-key'),
    executable,
    revision: 0,
  };
  const events = [];
  let session, native, turn, work, share;
  const timer = setTimeout(() => {
    releaseChildResolve();
    void (mode === 'harness' ? session?.interrupt() : turn?.interrupt());
  }, 25000);
  try {
    let task;
    if (mode === 'native') {
      native = session = createSession({
        workDir: project,
        shareDir: runtime.shareDir,
        executable,
        env: runtime.env,
        model: 'industrial',
        thinking: false,
      });
      turn = session.prompt('Audit native child task lifecycle.');
      task = (async () => {
        for await (const e of turn) {
          events.push(e);
          if (e.type === 'ApprovalRequest') await turn.approve(e.payload.id, 'reject');
        }
        return await turn.result;
      })();
    } else {
      session = new KimiSession(
        project,
        () => ({ domain: 'test', stage: 'test', capabilityIds: [], skills: [], tools: [] }),
        () => null,
        () => null,
        e => {
          events.push(e);
          if (e.type === 'approval') void session.approve(e.id, 'reject');
        },
        () => runtime,
        undefined,
        { directory: path.join(root, 'logs') },
      );
      task = session.run('Audit native child task lifecycle.');
    }
    if (scenario === 'cancel') {
      await childStarted;
      await delay(100);
      await (mode === 'native' ? turn.interrupt() : session.interrupt());
    }
    const result = await task;
    if (mode === 'harness') {
      native = session.session;
      share = session.sessionConfigDir;
      work = session.nativeWorkDir;
      assert.deepEqual(
        events.filter(e => e.type === 'error'),
        [],
      );
    } else {
      share = runtime.shareDir;
      work = project;
    }
    const directory = createKimiPaths(share).sessionDir(work, native.sessionId),
      subdir = path.join(directory, 'subagents');
    const readAgents = () =>
      fs
        .readdirSync(subdir)
        .map(id => ({ id, ...JSON.parse(fs.readFileSync(path.join(subdir, id, 'meta.json'))) }));
    const statesAtRootEnd = readAgents().map(a => a.status);
    let backgroundTaskStatuses = null;
    if (scenario === 'background-approval') {
      assert.ok(statesAtRootEnd.includes('running_background'));
      releaseChildResolve();
      const readTasks = () =>
        fs
          .readdirSync(path.join(directory, 'tasks'))
          .map(id =>
            JSON.parse(fs.readFileSync(path.join(directory, 'tasks', id, 'runtime.json'))),
          );
      for (let i = 0; i < 100 && !readTasks().some(t => t.status === 'awaiting_approval'); i++)
        await delay(50);
      backgroundTaskStatuses = readTasks().map(t => t.status);
      assert.ok(backgroundTaskStatuses.includes('awaiting_approval'));
      assert.equal(events.filter(e => ['ApprovalRequest', 'approval'].includes(e.type)).length, 0);
    }
    if (scenario === 'background-idle') {
      assert.ok(statesAtRootEnd.includes('running_background'));
      releaseChildResolve();
      for (let i = 0; i < 100 && readAgents().some(a => a.status === 'running_background'); i++)
        await delay(50);
      assert.ok(readAgents().every(a => a.status === 'idle'));
    }
    const agents = readAgents();
    if (scenario === 'cancel') assert.ok(agents.every(a => a.status === 'killed'));
    if (scenario === 'parallel') assert.equal(agents.length, 2);
    const wire =
      mode === 'native'
        ? events
        : fs
            .readFileSync(events.find(e => e.type === 'diagnostic-log').path, 'utf8')
            .trim()
            .split('\n')
            .map(JSON.parse)
            .filter(row => row.type === 'sdk.event')
            .map(row => row.payload);
    const approvals = wire.filter(e => e.type === 'ApprovalRequest');
    if (scenario === 'reject') {
      assert.ok(approvals.length);
      assert.ok(
        requests
          .filter(isChild)
          .some(b =>
            b.messages
              .filter(m => m.role === 'tool')
              .some(m => /rejected by the user/i.test(textOf(m))),
          ),
      );
    }
    const childTypes = [
      ...new Set(wire.filter(e => e.type === 'SubagentEvent').map(e => e.payload.subagent_type)),
    ];
    if (scenario === 'parallel') assert.equal(childTypes.length, 2);
    const nativeApprovalRows = agents
      .flatMap(a =>
        fs
          .readFileSync(path.join(subdir, a.id, 'wire.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map(JSON.parse),
      )
      .filter(row => JSON.stringify(row).includes('ApprovalRequest'));
    report.push({
      mode,
      scenario,
      status:
        mode === 'native' ? result.status : events.findLast(e => e.type === 'done')?.result.status,
      statesAtRootEnd,
      finalAgentStatuses: agents.map(a => a.status),
      backgroundTaskStatuses,
      sdkNestedEvents: wire.filter(e => e.type === 'SubagentEvent').length,
      approvalCount: approvals.length,
      sdkApprovalHasAgentIdentity: approvals.length
        ? approvals.every(e => Boolean(e.payload.agent_id))
        : null,
      nativeApprovalHasAgentIdentity: nativeApprovalRows.length
        ? nativeApprovalRows.every(row => JSON.stringify(row).includes('"agent_id"'))
        : null,
      independentChildTypes: childTypes,
    });
  } finally {
    clearTimeout(timer);
    releaseChildResolve();
    await session?.close();
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}
(async () => {
  for (const scenario of process.argv[4]
    ? [process.argv[4]]
    : ['parallel', 'reject', 'cancel', 'background-idle', 'background-approval'])
    for (const mode of ['native', 'harness']) await run(mode, scenario);
  const result = {
    runtime: 'kimi-cli 1.51.0',
    sdk: '0.1.8',
    method: 'real native runtime, controlled localhost model; not live inference',
    cases: report,
  };
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log('REPORT_PATH=' + path.join(base, 'report.json'));
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
