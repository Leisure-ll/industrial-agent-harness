const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { DiagnosticReader } = require('../packages/agent-kimi/src/diagnostic-reader.cjs');
const { createDiagnosticLog } = require('../packages/agent-kimi/src/diagnostic-log.cjs');
const { ChatStore, effectiveCapabilities } = require('../packages/harness-core/src/index.cjs');
const { capabilities } = require('../packages/domain-skills/src/index.cjs');

async function measure(operation, repetitions = 5) {
  const durations = [];
  for (let index = 0; index < repetitions; index++) {
    const start = performance.now();
    await operation();
    durations.push(performance.now() - start);
  }
  return Number(durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)].toFixed(2));
}

async function benchmark() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-maintenance-bench-'));
  try {
    const project = path.join(root, 'project');
    const directory = path.join(root, 'logs');
    fs.mkdirSync(project);
    const log = createDiagnosticLog(project, { directory });
    log.record('run.start', {});
    log.record('sdk.event', {
      type: 'ToolResult',
      payload: {
        tool_call_id: 'large',
        return_value: { output: 'x'.repeat(8 * 1024 * 1024), is_error: false },
      },
    });
    log.record('run.end', { status: 'completed' });
    log.close();
    const runId = path.basename(log.file);
    let copiedBytes = 0;
    const concatenate = Buffer.concat;
    Buffer.concat = (buffers, length) => {
      copiedBytes += length ?? buffers.reduce((sum, buffer) => sum + buffer.length, 0);
      return concatenate(buffers, length);
    };
    let diagnosticMs;
    try {
      diagnosticMs = await measure(async () => {
        const page = await new DiagnosticReader(directory).page(project, { runId });
        assert.equal(page.totalRecords, 3);
        assert.equal(page.records.at(-1).type, 'run.end');
      });
    } finally {
      Buffer.concat = concatenate;
    }

    const registry = Array.from({ length: 200 }, (_, index) => ({
      ...capabilities[index % capabilities.length],
      id: `benchmark.${index}`,
    }));
    const policy = { skills: ['chip.netlist.inspect'], mcpServers: ['chip-pack.eda'] };
    const capabilitiesMs = await measure(() => {
      for (let index = 0; index < 10; index++) {
        const result = effectiveCapabilities(registry, policy);
        assert.equal(result.length, registry.length);
        assert.ok(
          result.every(item => item.skills.every(skill => skill.id !== 'chip.netlist.inspect')),
        );
      }
    });

    const chatMs = await measure(() => {
      const store = new ChatStore(path.join(root, 'chats'));
      try {
        const chat = store.create(project, 'benchmark');
        const turnId = store.beginTurn(chat.id, 'Streaming benchmark');
        for (let index = 0; index < 1000; index++)
          store.append(turnId, { type: 'text', text: 'chunk ' });
        store.finish(turnId, 'completed');
        assert.equal(
          store.history(chat.id, project, 'benchmark').turns[0].events[0].text,
          'chunk '.repeat(1000),
        );
      } finally {
        store.close();
      }
    });

    console.log(
      JSON.stringify(
        {
          node: process.version,
          platform: `${process.platform}-${process.arch}`,
          repetitions: 5,
          diagnostic: {
            fileBytes: fs.statSync(log.file).size,
            medianMs: diagnosticMs,
            copiedBytesPerRead: copiedBytes / 5,
          },
          capabilityPolicy: { capabilities: 200, resolutions: 10, medianMs: capabilitiesMs },
          chatStream: { chunks: 1000, medianMs: chatMs },
        },
        null,
        2,
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

benchmark().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
