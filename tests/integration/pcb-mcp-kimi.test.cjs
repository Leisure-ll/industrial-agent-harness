const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {startModel} = require('./fixtures/domain-mcp-model.cjs');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../..');
const kimi = process.env.KIMI_EXECUTABLE || path.join(root, 'apps/desktop/.venv-kimi/bin/kimi');
const python = process.env.INDUSTRIAL_HARNESS_PCB_GATEWAY_PYTHON || path.join(root, 'domain-packs/pcb/.venv/bin/python');

test('real Kimi/CLI PCB approval and result delivery use the fixed schemas and complete Skill; refusal has no controlled mutation', {skip: !process.env.INDUSTRIAL_HARNESS_PCB_BENCH_DIR || !fs.existsSync(kimi) || !fs.existsSync(python), timeout: 90000}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-kimi-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const fakeDocker = path.join(directory, 'controlled-docker');
  fs.writeFileSync(fakeDocker, `#!${python}\nimport os\nos.environ['PCB_FIXTURE_USE_SOURCE_SCHEMAS']='1'\n` + fs.readFileSync(path.join(__dirname, 'fixtures/pcb-mcp-backend.py'), 'utf8'), {mode: 0o700});
  const fixture = await startModel({calls: [
    {name: 'domain_tool_describe', arguments: {toolId: 'pcb.bench.new_project'}},
    {name: 'domain_tool_call', arguments: {toolId: 'pcb.bench.new_project', arguments: {width_mm: 20, height_mm: 15}}},
    {name: 'domain_tool_call', arguments: {toolId: 'pcb.bench.project_status', arguments: {}}},
  ]});
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
    if (approval === 'approve') {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'spec.json'))), {width_mm: 20, height_mm: 15});
      assert.ok(events.some(event => event.event?.type === 'tool-result' && event.event.output?.includes('width_mm')));
      assert.ok(JSON.stringify(requests.at(-1).messages).includes('MODIFIED'));
    } else assert.ok(!fs.existsSync(path.join(project, 'spec.json')));
  }
});
