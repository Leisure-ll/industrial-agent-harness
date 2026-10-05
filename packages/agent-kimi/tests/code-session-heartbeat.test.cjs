const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { z } = require('zod');
const { createSession, createExternalTool } = require('../src/code-session.cjs');
const { configToml, sessionEnv } = require('../src/model-config.cjs');
const { startModel } = require('../../../tests/integration/fixtures/domain-mcp-model.cjs');

test(
  'real Kimi heartbeat keeps a long host callback and an idle session alive without replay',
  { timeout: 90000 },
  async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-code-heartbeat-'));
    const model = await startModel({
      calls: [{ name: 'controlled_long_callback', arguments: {} }],
      success: 'HEARTBEAT_TURN_FINISHED',
    });
    const profile = {
      provider: 'openai_legacy',
      endpoint: model.endpoint,
      model: 'controlled',
      contextSize: 32768,
      thinking: false,
    };
    fs.writeFileSync(path.join(directory, 'config.toml'), configToml(profile));
    fs.writeFileSync(path.join(directory, 'mcp.json'), '{}');
    let callbacks = 0;
    const session = createSession({
      workDir: directory,
      shareDir: directory,
      env: sessionEnv(profile, 'heartbeat-fixture-key'),
      externalTools: [
        createExternalTool({
          name: 'controlled_long_callback',
          description: 'Wait beyond the native heartbeat deadline and return a marker.',
          parameters: z.object({}),
          handler: async () => {
            callbacks++;
            await delay(22000);
            return { output: 'HEARTBEAT_TOOL_OK' };
          },
        }),
      ],
    });
    t.after(async () => {
      await session.close();
      model.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    async function completeTurn() {
      const turn = session.prompt('Complete the controlled task');
      const events = [];
      for await (const event of turn) {
        events.push(event);
        if (event.type === 'ApprovalRequest') await turn.approve(event.payload.id, 'approve');
      }
      assert.equal((await turn.result).status, 'finished');
      assert.ok(
        events.some(
          event => event.type === 'ContentPart' && event.payload.text === 'HEARTBEAT_TURN_FINISHED',
        ),
      );
      return events;
    }
    const events = await completeTurn();
    assert.ok(
      events.some(
        event =>
          event.type === 'ToolResult' && event.payload.return_value.output === 'HEARTBEAT_TOOL_OK',
      ),
    );
    const nativeId = session.nativeId;
    await delay(22000);
    await completeTurn();
    assert.equal(session.nativeId, nativeId);
    assert.equal(callbacks, 1, 'A live connection must never replay the host action.');
    assert.equal(model.requests.length, 3);
  },
);
