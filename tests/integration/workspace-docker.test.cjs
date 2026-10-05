const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createProjectRuntime } = require('../../packages/harness-core/src/index.cjs');
const { resolveFromState } = require('../../packages/capability-broker/src/index.cjs');
test(
  'real Docker task executes an inspected immutable image through the host Runtime with read-only inputs, resource limits and fresh checks',
  { timeout: 60000 },
  async t => {
    const image = process.env.HARNESS_WORKSPACE_DOCKER_IMAGE;
    assert.ok(image, 'This dedicated Linux gate requires the prepared Docker test image.');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-docker-')),
      project = path.join(directory, 'project');
    fs.mkdirSync(project);
    const script = `import os,json,socket
from pathlib import Path
denied=False
try: Path('/inputs/check.py').write_text('bypass')
except OSError: denied=True
checks=[{'name':'actual calculation','passed':sum([2,3])==5},{'name':'read-only snapshot','passed':denied},{'name':'no model credentials','passed':not any('TOKEN' in k or 'API_KEY' in k for k in os.environ)}]
Path('/work/checks.json').write_text(json.dumps({'schemaVersion':'1','checks':checks}))
`;
    fs.writeFileSync(path.join(project, 'check.py'), script);
    fs.writeFileSync(
      path.join(project, 'harness.tasks.json'),
      JSON.stringify({
        schemaVersion: '1',
        tasks: {
          test: {
            command: ['python3', '{input}/check.py'],
            inputs: ['check.py'],
            runtime: { kind: 'docker', image, cpus: 1, memoryMb: 256, pids: 32 },
            verification: { kind: 'checks-json', path: 'checks.json' },
            timeoutMs: 10000,
          },
        },
      }),
    );
    const bundle = createProjectRuntime({
      projectDir: project,
      domain: 'example',
      registry: { runtimePacks: [] },
      directory: path.join(directory, 'state'),
      environment: {
        ...process.env,
        OPENAI_API_KEY: 'must-not-inherit',
        INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'config'),
      },
    });
    t.after(() => {
      bundle.runtime.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    const state = await bundle.runtime.inspect(),
      scope = resolveFromState({ task: 'test', state }, bundle.capabilities).scope;
    const result = await bundle.runtime.execute(
      { toolId: 'project.task.run', inputs: { task: 'test' }, expectedStateId: state.id },
      { scope, approval: true },
    );
    assert.equal(result.verification.status, 'passed', JSON.stringify(result));
    const report = JSON.parse(
      bundle.runtime.readArtifact(result.artifacts.find(a => a.kind === 'report.execution').id)
        .content,
    );
    assert.equal(
      report.identity.imageId,
      spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
        encoding: 'utf8',
      }).stdout.trim(),
    );
    assert.equal(report.runtime.memoryMb, 256);
    assert.equal(report.runtime.cpus, 1);
    assert.equal(report.runtime.pids, 32);
    assert.equal(fs.readFileSync(path.join(project, 'check.py'), 'utf8'), script);
    const container = spawnSync(
      'docker',
      ['container', 'inspect', 'industrial-task-' + result.action.id],
      { encoding: 'utf8' },
    );
    assert.notEqual(
      container.status,
      0,
      'Owned container must be gone before returning the Action.',
    );
  },
);
