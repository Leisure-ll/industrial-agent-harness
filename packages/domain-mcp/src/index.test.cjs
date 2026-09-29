const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {selectMcpServers, writeMcpConfig} = require('./index.cjs');

test('a server is withheld unless every declared tool is in scope and it is enabled', t => {
  const server = {id: 'fixture', domain: 'chip', toolIds: ['eda.netlist.inspect', 'eda.waveform.inspect'], config: {command: 'fixture-server'}};
  assert.deepEqual(selectMcpServers({domain: 'chip', tools: ['eda.netlist.inspect']}, [], [server]), []);
  assert.deepEqual(selectMcpServers({domain: 'chip', tools: server.toolIds}, ['fixture'], [server]), []);
  assert.deepEqual(selectMcpServers({domain: 'chip', tools: server.toolIds}, [], [server]), [server]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-mcp-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const file = writeMcpConfig(root, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), {mcpServers: {}});
});


test('registered gateway intersects the current scope while direct providers retain all-or-nothing disclosure', () => {
  const {listMcpServers} = require('./index.cjs');
  const providers = listMcpServers('chip');
  assert.equal(providers.length, 1); assert.equal(providers[0].id, 'chip-pack.eda');
  assert.equal(providers[0].toolIds.length, 25);
  const pcb = listMcpServers('pcb');
  assert.equal(pcb.length, 1); assert.equal(pcb[0].id, 'pcb-bench.tools');
  assert.equal(pcb[0].toolIds.length, 89);
  const scope = {domain: 'chip', tools: ['eda.harness.get_server_info']};
  assert.deepEqual(selectMcpServers(scope)[0].allowedToolIds, scope.tools);
  assert.deepEqual(selectMcpServers(scope, ['chip-pack.eda']), []);
  assert.deepEqual(selectMcpServers({...scope, domain: 'pcb'}), []);
  assert.deepEqual(selectMcpServers({domain: 'chip', tools: ['unknown']}), []);
});
