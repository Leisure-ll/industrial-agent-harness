const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { IndustrialRuntime } = require('@industrial-agent-harness/domain-runtime');

// Real durable Runtime records and content-bound outputs for display tests.
// This fixture does not measure a model or qualify a professional toolchain.
async function createResultFixture(project, directory) {
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'input.txt'), 'reference input\n');
  async function execute({ action, inputs }) {
    if (inputs.failExecution) throw Error('The fixture executable could not start.');
    const file = path.join(project, '.harness-runs', action.id, 'report.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `measured=${inputs.value}\n`);
    return { executionSucceeded: true, artifacts: [{ kind: 'report.result', file }] };
  }
  const runtime = new IndustrialRuntime(project, 'chip', {
    directory,
    stateProvider: async () => ({
      stage: 'result-fixture',
      inputHashes: {
        'input.txt': crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(project, 'input.txt')))
          .digest('hex'),
      },
    }),
    tools: [
      {
        descriptor: {
          schemaVersion: '1',
          id: 'fixture.verify',
          version: '1',
          risk: 'mutating',
          verification: ['fixture.check'],
        },
        execute,
      },
      {
        descriptor: {
          schemaVersion: '1',
          id: 'fixture.observe',
          version: '1',
          risk: 'read-only',
          verification: [],
        },
        execute,
      },
    ],
    verifiers: {
      'fixture.check': ({ artifacts, readArtifact }) => {
        const passed = readArtifact(artifacts[0]).toString('utf8') === 'measured=42\n';
        return {
          status: passed ? 'passed' : 'failed',
          reason: passed
            ? 'The recorded measurement is 42.'
            : 'Expected 42; recorded measurement is 41.',
          metrics: { expected: 42 },
        };
      },
    },
  });
  const results = [];
  try {
    for (const [toolId, inputs] of [
      ['fixture.verify', { value: 42 }],
      ['fixture.observe', { value: 42 }],
      ['fixture.verify', { value: 41 }],
      ['fixture.verify', { failExecution: true }],
    ]) {
      const state = await runtime.inspect();
      results.push(
        await runtime.execute(
          { toolId, inputs, expectedStateId: state.id },
          {
            approval: true,
            scope: {
              domain: state.domain,
              projectId: state.projectId,
              stateId: state.id,
              tools: [toolId],
            },
          },
        ),
      );
    }
    return { runtime, results };
  } catch (error) {
    runtime.close();
    throw error;
  }
}

module.exports = { createResultFixture };
