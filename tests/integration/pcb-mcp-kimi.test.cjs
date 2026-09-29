const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {DiagnosticReader} = require('../../packages/agent-kimi/src/diagnostic-reader.cjs');
const {startModel} = require('./fixtures/domain-mcp-model.cjs');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const kimi = process.env.KIMI_EXECUTABLE || path.join(root, 'apps/desktop/.venv-kimi/bin/kimi');
const python = process.env.INDUSTRIAL_HARNESS_PCB_GATEWAY_PYTHON || path.join(root, 'domain-packs/pcb/.venv/bin/python');

test('real Kimi/CLI progressively discloses PCB Skill, references and tool schemas in model input and UI logs; refusal has no controlled mutation', {skip: !process.env.INDUSTRIAL_HARNESS_PCB_BENCH_DIR || !fs.existsSync(kimi) || !fs.existsSync(python), timeout: 90000}, async t => {
  const evidenceRoot = process.env.INDUSTRIAL_HARNESS_PCB_TEST_EVIDENCE_DIR;
  if (evidenceRoot) fs.mkdirSync(evidenceRoot, {recursive: true, mode: 0o700});
  const directory = fs.mkdtempSync(path.join(evidenceRoot || os.tmpdir(), 'pcb-kimi-'));
  if (!evidenceRoot) t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const fakeDocker = path.join(directory, 'controlled-docker');
  fs.writeFileSync(fakeDocker, `#!${python}\nimport os\nos.environ['PCB_FIXTURE_USE_SOURCE_SCHEMAS']='1'\n` + fs.readFileSync(path.join(__dirname, 'fixtures/pcb-mcp-backend.py'), 'utf8'), {mode: 0o700});
  const content = body => body.messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
  const fixture = await startModel({calls: body => {
    const skillPath = content(body).match(/Path: ([^\r\n]+\/pcb-design-e2e\/SKILL\.md)/)?.[1];
    assert.ok(skillPath, 'the actual Kimi prompt must discover the complete design Skill');
    return [
      {name: 'industrial_capability_detail', arguments: {capabilityId: 'pcb.bench.operate', section: 'skills'}},
      {name: 'ReadFile', arguments: {path: skillPath}},
      {name: 'ReadFile', arguments: {path: path.join(path.dirname(skillPath), 'references/layout.md'), n_lines: 15}},
      {name: 'domain_tool_list', arguments: {limit: 3}},
      {name: 'domain_tool_describe', arguments: {toolId: 'pcb.bench.new_project'}},
      {name: 'domain_tool_call', arguments: {toolId: 'pcb.bench.new_project', arguments: {width_mm: 20, height_mm: 15}}},
      {name: 'domain_tool_call', arguments: {toolId: 'pcb.bench.project_status', arguments: {}}},
    ];
  }});
  t.after(fixture.close);
  for (const approval of ['reject', 'approve']) {
    const project = path.join(directory, approval); fs.mkdirSync(project);
    const before = fixture.requests.length;
    const {stdout, stderr} = await execute(process.execPath, [path.join(root, 'apps/cli/src/main.cjs'), 'run', '--project-dir', project, '--domain', 'pcb', '--task', 'pcb mcp', '--approval', approval, '--provider', 'openai_legacy', '--endpoint', fixture.endpoint, '--model', 'controlled-pcb', '--no-thinking', '--kimi-executable', kimi, '--timeout-ms', '25000', '--chat-dir', path.join(directory, 'chats'), '--state-dir', path.join(directory, 'state'), '--log-dir', path.join(directory, 'logs')], {
      cwd: root, timeout: 40000, maxBuffer: 4 * 1024 * 1024,
      env: {...process.env, OPENAI_API_KEY: 'local-fixture-key', INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'resources'), INDUSTRIAL_HARNESS_PCB_DOCKER: fakeDocker, INDUSTRIAL_HARNESS_PCB_GATEWAY_PYTHON: python},
    });
    const events = stdout.trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).status, 'finished', stdout + stderr);
    assert.ok(events.some(event => event.type === 'approval_decision' && event.decision === approval));
    const requests = fixture.requests.slice(before);
    assert.ok(requests[0].tools.some(tool => tool.function.name === 'domain_tool_call'));
    assert.ok(!requests[0].tools.some(tool => tool.function.name === 'new_project'));
    assert.ok(content(requests[0]).includes('pcb-design-e2e'));
    assert.ok(!content(requests[0]).includes('## Build and verify'), 'initial context contains Skill metadata, not its full body');
    assert.ok(!content(requests[0]).includes('width_mm'), 'initial context does not carry the native parameter schema');
    if (approval === 'approve') {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'spec.json'))), {width_mm: 20, height_mm: 15});
      assert.ok(events.some(event => event.event?.type === 'tool-result' && event.event.output?.includes('width_mm')));
      assert.ok(JSON.stringify(requests.at(-1).messages).includes('MODIFIED'));
      assert.equal(requests.length, 8);
      assert.ok(!content(requests[1]).includes('## Build and verify'));
      assert.ok(content(requests[2]).includes('## Build and verify'), 'Skill body reaches the model only after ReadFile');
      const reference = fs.readFileSync(path.join(process.env.INDUSTRIAL_HARNESS_PCB_BENCH_DIR, 'skills/pcb-design-e2e/references/layout.md'), 'utf8').split('\n').slice(0, 15).find(line => line.trim().length > 40);
      assert.ok(reference);
      assert.ok(!content(requests[2]).includes(reference), 'the selected reference was deferred');
      assert.ok(content(requests[3]).includes(reference), 'the selected reference enters after its own ReadFile');
      const latestToolOutput = body => JSON.stringify(body.messages.filter(message => message.role === 'tool').at(-1)?.content);
      assert.ok(!latestToolOutput(requests[4]).includes('inputSchema'), 'listing tool summaries must not inject native schemas');
      assert.ok(latestToolOutput(requests[5]).includes('inputSchema') && latestToolOutput(requests[5]).includes('width_mm'), 'only describe discloses the requested native schema');
      const logFile = events.find(event => event.event?.type === 'diagnostic-log').event.path;
      const rows = fs.readFileSync(logFile, 'utf8').trim().split('\n').map(JSON.parse);
      assert.ok(rows.find(row => row.type === 'run.start').payload.brokerTrace.some(row => row.event === 'detail.deferred'));
      const reader = new DiagnosticReader(path.join(directory, 'logs'));
      const view = await reader.view(fs.realpathSync(project), {runId: path.basename(logFile), view: 'tools'});
      assert.deepEqual(view.entries.map(entry => entry.title), ['industrial_capability_detail', 'ReadFile', 'ReadFile', 'domain_tool_list', 'domain_tool_describe', 'domain_tool_call', 'domain_tool_call']);
      assert.ok(view.entries.every(entry => entry.status === 'success'));
      const readOutput = entry => reader.detail(fs.realpathSync(project), {runId: path.basename(logFile), id: entry.id, field: 'output'}).then(result => result.text);
      assert.ok((await readOutput(view.entries[1])).includes('## Build and verify'));
      assert.ok((await readOutput(view.entries[2])).includes(reference));
      assert.ok((await readOutput(view.entries[4])).includes('width_mm'));
      if (evidenceRoot) {
        fs.writeFileSync(path.join(directory, 'disclosure-evidence.json'), JSON.stringify({kind: 'CONTROLLED_PROTOCOL_TEST_NOT_NATIVE_CAD', logFile, initialSkillBodyAbsent: true, initialNativeSchemaAbsent: true, skillReadConfirmed: true, focusedReferenceReadConfirmed: true, schemaDescribeConfirmed: true, uiLogProjectionConfirmed: true, tools: view.entries.map(({title,status}) => ({title,status}))}, null, 2), {mode: 0o600});
        t.diagnostic('Retained controlled disclosure evidence: ' + path.join(directory, 'disclosure-evidence.json'));
      }
    } else assert.ok(!fs.existsSync(path.join(project, 'spec.json')));
  }
});
