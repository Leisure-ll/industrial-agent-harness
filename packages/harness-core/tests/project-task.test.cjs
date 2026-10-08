const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveProjectTask } = require('../src/index.cjs');
const { randomUUID } = require('node:crypto');

test('protected Runtime scopes include registered MCP tools and honor disable policy without changing preferences', () => {
  const external = [
    { id: 'external.example', title: 'Example', tools: [{ id: 'external.example.call' }] },
  ];
  const registry = [
    {
      id: 'example.prepare',
      domain: 'example',
      title: 'Prepare',
      stages: [],
      keywords: ['prepare'],
      skills: [],
      tools: [{ id: 'example.prepare' }],
      verification: [],
    },
  ];
  const state = {
    schemaVersion: '1',
    id: randomUUID(),
    projectId: 'b'.repeat(64),
    domain: 'example',
    stage: null,
    status: 'unverified',
    artifacts: [],
    inputHashes: {},
    verificationIds: [],
    createdAt: new Date().toISOString(),
  };
  const policy = { skills: [], mcpServers: [] };
  const call = request =>
    resolveProjectTask('example', request, undefined, registry, policy, external, [
      { id: 'example' },
    ]);
  assert.deepEqual(call({ task: 'prepare' }).scope.tools, [
    'example.prepare',
    'external.example.call',
  ]);
  const protectedTask = call({ task: 'prepare', state });
  assert.deepEqual(protectedTask.scope.tools, ['example.prepare', 'external.example.call']);
  assert.ok(
    protectedTask.trace.some(
      t => t.event === 'mcp.external.scope' && t.detail.tools.includes('external.example.call'),
    ),
  );
  policy.mcpServers.push('external.example');
  assert.deepEqual(call({ task: 'prepare', state }).scope.tools, ['example.prepare']);
  policy.mcpServers.pop();
  assert.deepEqual(policy, { skills: [], mcpServers: [] });
  assert.equal(external.length, 1);
});

test('a project domain constrains capability resolution without a desktop process', () => {
  const result = resolveProjectTask('chip', { task: 'Inspect netlist signals' });
  assert.equal(result.scope.domain, 'chip');
  assert.deepEqual(result.scope.capabilityIds, ['chip.rtl.netlist.inspect']);
  assert.throws(
    () => resolveProjectTask('chip', { task: 'Inspect PCB board', domain: 'pcb' }),
    /fixed to the chip domain/,
  );
  assert.throws(
    () => resolveProjectTask('missing', { task: 'Inspect netlist' }),
    /valid project domain/,
  );
});

test('a project-disabled skill is absent from scope, detail, and the disclosure trace', () => {
  const { effectiveCapabilities } = require('../src/index.cjs');
  const { capabilities } = require('../../domain-skills/src/index.cjs');
  const { discloseDetail } = require('@industrial-agent-harness/capability-broker');
  const disabled = { skills: ['chip.netlist.inspect'], mcpServers: [] };
  const result = resolveProjectTask(
    'chip',
    { task: 'Inspect netlist signals' },
    undefined,
    capabilities,
    disabled,
  );
  assert.deepEqual(result.scope.skills, []);
  assert.deepEqual(result.scope.tools, ['eda.netlist.inspect']);
  assert.deepEqual(
    discloseDetail(
      result.scope,
      effectiveCapabilities(capabilities, disabled),
      'chip.rtl.netlist.inspect',
    ).skills,
    [],
  );
  assert.ok(
    result.trace.some(
      entry =>
        entry.event === 'resource.policy' &&
        entry.detail.disabledSkills.includes('chip.netlist.inspect'),
    ),
  );
});
