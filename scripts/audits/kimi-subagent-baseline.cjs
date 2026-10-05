const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = process.argv[2];
const executable = process.argv[3];
const { KimiSession } = require(path.join(repo, 'packages/agent-kimi/src/index.cjs'));
const { validateProfile, writeCliConfig, sessionEnv } = require(
  path.join(repo, 'packages/agent-kimi/src/model-config.cjs'),
);
const { startModel } = require(path.join(repo, 'tests/integration/fixtures/domain-mcp-model.cjs'));
const { createSession, createKimiPaths, createExternalTool } = require(
  path.join(repo, 'packages/agent-kimi/node_modules/@moonshot-ai/kimi-agent-sdk'),
);
const { z } = require(path.join(repo, 'packages/agent-kimi/node_modules/zod'));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-subagent-audit-'));
const outputs = [];
const textOf = message =>
  typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
const isChild = body =>
  body.messages.some(
    m => m.role === 'system' && /You are now running as a subagent/.test(textOf(m)),
  );

async function run(mode) {
  const root = path.join(base, mode);
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  const source = path.join(project, 'part.txt');
  fs.writeFileSync(source, 'AUDIT_PART_120x80\n');
  const fixture = await startModel({
    calls: body => {
      const lastUser = body.messages.filter(m => m.role === 'user').at(-1);
      const user = textOf(lastUser);
      if (isChild(body)) return [{ name: 'ReadFile', arguments: { path: source } }];
      const results = body.messages.filter(m => m.role === 'tool');
      const first = results[0] && textOf(results[0]);
      const agentId = first?.match(/agent_id: ([^\s]+)/)?.[1];
      return [
        ...['coder', 'explore', 'plan'].map(type => ({
          name: 'Agent',
          arguments: {
            description: `Audit ${type} file inspection`,
            subagent_type: type,
            prompt: `AUDIT_CHILD_${type}: Read ${source} and report dimensions.`,
          },
        })),
        ...(agentId
          ? [
              {
                name: 'Agent',
                arguments: {
                  description: 'Audit existing context resume',
                  resume: agentId,
                  prompt:
                    'AUDIT_CHILD_RESUME: Report the previously read dimensions from your retained context.',
                },
              },
            ]
          : []),
      ];
    },
    success: 'AUDIT_COMPACT_FINAL_SUMMARY',
  });
  const profile = validateProfile({
    provider: 'openai_legacy',
    endpoint: fixture.endpoint,
    model: 'subagent-audit-controlled',
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
  let session, native, share, workDir;
  const timer = setTimeout(
    () => void (mode === 'harness' ? session?.interrupt() : native?.close()),
    45000,
  );
  try {
    if (mode === 'native') {
      share = runtime.shareDir;
      workDir = project;
      native = createSession({
        workDir,
        executable,
        shareDir: share,
        model: 'industrial',
        env: runtime.env,
        thinking: false,
        externalTools: [
          createExternalTool({
            name: 'industrial_capability_detail',
            description: 'Harmless audit marker',
            parameters: z.object({}),
            handler: async () => ({ output: 'AUDIT_MARKER', message: 'AUDIT_MARKER' }),
          }),
        ],
      });
      session = native;
      const turn = session.prompt(
        'AUDIT_ROOT_TASK: Delegate independent file inspection, then resume the first child. ROOT_ONLY_CONTEXT_SECRET.',
      );
      for await (const event of turn) {
        events.push(event);
        if (event.type === 'ApprovalRequest') await turn.approve(event.payload.id, 'approve');
      }
      assert.equal((await turn.result).status, 'finished');
    } else {
      session = new KimiSession(
        project,
        () => ({ domain: 'test', stage: 'test', capabilityIds: ['audit'], skills: [], tools: [] }),
        () => null,
        () => ({ audit: true }),
        e => events.push(e),
        () => runtime,
        undefined,
        { directory: path.join(root, 'logs') },
      );
      await session.run(
        'AUDIT_ROOT_TASK: Delegate independent file inspection, then resume the first child. ROOT_ONLY_CONTEXT_SECRET.',
      );
      assert.deepEqual(
        events.filter(e => e.type === 'error'),
        [],
      );
      native = session.session;
      share = session.sessionConfigDir;
      workDir = session.nativeWorkDir;
    }
    const sessionDirectory = createKimiPaths(share).sessionDir(workDir, native.sessionId);
    const subagentsDirectory = path.join(sessionDirectory, 'subagents');
    const agents = fs.readdirSync(subagentsDirectory).map(id => ({
      ...JSON.parse(fs.readFileSync(path.join(subagentsDirectory, id, 'meta.json'))),
      context: fs.readFileSync(path.join(subagentsDirectory, id, 'context.jsonl'), 'utf8'),
    }));
    const children = fixture.requests.filter(isChild);
    const rootRequests = fixture.requests.filter(body => !children.includes(body));
    const wireEvents =
      mode === 'native'
        ? events
        : fs
            .readFileSync(events.find(e => e.type === 'diagnostic-log').path, 'utf8')
            .trim()
            .split('\n')
            .map(JSON.parse)
            .filter(row => row.type === 'sdk.event')
            .map(row => row.payload);
    const nested = wireEvents.filter(e => e.type === 'SubagentEvent');
    fs.writeFileSync(
      path.join(root, 'debug.json'),
      JSON.stringify({ events, requests: fixture.requests, agents }, null, 2),
    );
    assert.equal(agents.length, 3);
    assert.equal(new Set(nested.map(e => e.payload.agent_id)).size, 3);
    assert.ok(
      children.every(body => !JSON.stringify(body.messages).includes('ROOT_ONLY_CONTEXT_SECRET')),
    );
    assert.ok(children.every(body => !body.tools.some(t => t.function.name === 'Agent')));
    assert.ok(
      children.every(
        body => !body.tools.some(t => t.function.name === 'industrial_capability_detail'),
      ),
    );
    assert.ok(rootRequests[0].tools.some(t => t.function.name === 'industrial_capability_detail'));
    assert.ok(
      rootRequests
        .at(-1)
        .messages.filter(m => m.role === 'tool')
        .some(m => /resumed: true/.test(textOf(m))),
    );
    assert.ok(
      children.some(
        body =>
          JSON.stringify(body.messages).includes('AUDIT_CHILD_RESUME') &&
          JSON.stringify(body.messages).includes('AUDIT_PART_120x80'),
      ),
    );
    assert.ok(agents.every(a => a.status === 'idle'));
    assert.equal(fs.readFileSync(source, 'utf8'), 'AUDIT_PART_120x80\n');
    outputs.push({
      mode,
      requests: fixture.requests.length,
      childTypes: agents.map(a => a.subagent_type).sort(),
      nativeStatuses: agents.map(a => a.status),
      nestedEventCount: nested.length,
      nestedEventTypes: [...new Set(nested.map(e => e.payload.event.type))],
      nestedIdentityPreserved: nested.every(
        e => e.payload.agent_id && e.payload.subagent_type && e.payload.parent_tool_call_id,
      ),
      displayedSubagentEvents:
        mode === 'harness' ? events.filter(e => /subagent/i.test(e.type)).length : null,
      contextIsolated: true,
      resumeRetainedContext: true,
      rootExternalToolPresent: true,
      childExternalToolPresent: false,
      childRecursionAllowed: false,
      sessionDirectory,
    });
  } finally {
    clearTimeout(timer);
    await session?.close();
    fixture.close();
  }
}
(async () => {
  await run('native');
  await run('harness');
  const report = {
    date: new Date().toISOString(),
    runtime: 'kimi-cli 1.51.0',
    sdk: '0.1.8',
    method: 'real native runtime, localhost controlled model responses; not live inference',
    cases: outputs,
  };
  fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('REPORT_PATH=' + path.join(base, 'report.json'));
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
