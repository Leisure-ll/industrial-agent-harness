#!/usr/bin/env node
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process'),
  { promisify } = require('node:util');
const { startModel } = require('../tests/integration/fixtures/domain-mcp-model.cjs');
const { modelCalls } = require('../tests/integration/fixtures/workspace-scenario.cjs');
const execute = promisify(execFile);
async function main() {
  const [entry, domain = 'chip', reportFile] = process.argv.slice(2);
  if (!entry) throw Error('Provide the installed CLI entry or launcher.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-workspace-consumer-')),
    project = path.join(directory, 'empty-project');
  fs.mkdirSync(project);
  const fixture = await startModel({
    calls: modelCalls(project),
    success: 'INSTALLED_WORKSPACE_COMPLETE',
  });
  try {
    const args = [
      'run',
      '--project-dir',
      project,
      '--domain',
      domain,
      '--task',
      'Create a project and test; repair failed checks',
      '--approval',
      'approve',
      '--provider',
      'openai_legacy',
      '--endpoint',
      fixture.endpoint,
      '--model',
      'installed-workspace',
      '--no-thinking',
      '--timeout-ms',
      '60000',
      '--chat-dir',
      path.join(directory, 'chats'),
      '--state-dir',
      path.join(directory, 'state'),
      '--log-dir',
      path.join(directory, 'logs'),
    ];
    const result = await execute(
      entry.endsWith('.cjs') ? process.execPath : entry,
      entry.endsWith('.cjs') ? [entry, ...args] : args,
      {
        cwd: directory,
        env: {
          ...process.env,
          OPENAI_API_KEY: 'local-installed-fixture',
          INDUSTRIAL_HARNESS_CONFIG_DIR: path.join(directory, 'config'),
        },
        timeout: 90000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const rows = result.stdout.trim().split('\n').map(JSON.parse),
      actions = rows.filter(row => row.type === 'industrial_result');
    assert.equal(rows.at(-1).status, 'finished', result.stderr + result.stdout);
    assert.equal(actions.length, 8);
    assert.ok(rows[0].scope.skills.includes('project.work'));
    assert.deepEqual(
      actions
        .filter(row => row.action.toolId === 'project.task.run')
        .map(row => row.verification.status),
      ['passed', 'failed', 'passed'],
    );
    assert.equal(actions[4].state.status, 'stale');
    assert.equal(actions.at(-1).state.status, 'verified');
    const report = {
      status: 'PASS',
      domain,
      entry,
      actions: actions.map(({ action, verification, state, checkpoint }) => ({
        toolId: action.toolId,
        actionId: action.id,
        verification: verification.status,
        state: state.status,
        checkpointId: checkpoint.id,
      })),
      toolSources:
        'installed CLI dependency graph; controlled model with real Kimi and native task execution',
    };
    if (reportFile) {
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    }
    process.stdout.write(JSON.stringify(report) + '\n');
  } finally {
    fixture.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => {
  process.stderr.write(String(error.stack) + '\n');
  process.exitCode = 1;
});
