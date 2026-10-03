const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { KimiSession } = require('../src/index.cjs');

async function waitFor(check) {
  const end = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > end) throw Error('Question was not surfaced.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function setup(t, approvalMode = 'ask') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-question-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'config.toml'), 'default_model = "industrial"\n');
  const events = [],
    creations = [],
    responses = [];
  let release;
  const scope = { domain: 'godot', stage: null, capabilityIds: [], skills: [], tools: [] };
  const runtime = {
    apiKey: 'test-key',
    revision: 0,
    shareDir: root,
    profile: { thinking: false },
    approvalMode,
  };
  const factory = options => {
    creations.push(options);
    return {
      sessionId: 'question-test',
      close: async () => {},
      prompt: () => ({
        result: Promise.resolve({ status: 'finished' }),
        approve: async (id, value) => {
          responses.push({ kind: 'approval', id, value });
        },
        respondQuestion: async (rpcId, questionId, answers) => {
          responses.push({ kind: 'question', rpcId, questionId, answers });
          release?.();
        },
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'ApprovalRequest',
            payload: {
              id: 'approval-1',
              sender: 'Shell',
              action: 'run',
              description: 'run command',
            },
          };
          yield {
            type: 'QuestionRequest',
            payload: {
              id: 'question-1',
              tool_call_id: 'tool-1',
              questions: [
                { question: 'Which target?', options: [{ label: 'A' }, { label: 'B' }] },
                {
                  question: 'Which files?',
                  multi_select: true,
                  options: [{ label: 'Board' }, { label: 'Schematic' }],
                },
              ],
            },
          };
          await new Promise(resolve => {
            release = resolve;
          });
        },
      }),
    };
  };
  const session = new KimiSession(
    root,
    () => scope,
    () => null,
    () => null,
    event => events.push(event),
    () => runtime,
    factory,
    { directory: path.join(root, 'logs') },
  );
  t.after(() => session.close());
  return { session, runtime, creations, responses, events };
}

test('automatic mode delegates to native Kimi yolo and questions still wait for an explicit answer', async t => {
  const { session, creations, responses, events } = setup(t, 'auto');
  const running = session.run('design');
  await waitFor(() => events.some(event => event.type === 'question'));
  assert.equal(creations[0].yoloMode, true);
  assert.deepEqual(
    events.filter(event => event.type === 'approval'),
    [],
  );
  assert.deepEqual(responses[0], {
    kind: 'approval',
    id: 'approval-1',
    value: 'approve_for_session',
  });
  await assert.rejects(
    session.answerQuestion('question-1', { 'Which target?': 'A' }),
    /Answer every question/,
  );
  await session.answerQuestion('question-1', {
    'Which target?': 'A',
    'Which files?': 'Board, Schematic',
  });
  await running;
  assert.deepEqual(responses[1], {
    kind: 'question',
    rpcId: 'question-1',
    questionId: 'question-1',
    answers: { 'Which target?': 'A', 'Which files?': 'Board, Schematic' },
  });
  assert.equal(events.find(event => event.type === 'question-resolved').decision, 'answered');
  await assert.rejects(session.answerQuestion('question-1', {}), /no longer pending/);
});

test('question submission can retry transport failures; ask mode retains approval prompts', async t => {
  const { session, creations, events } = setup(t);
  const running = session.run('ask');
  await waitFor(() => events.some(event => event.type === 'question'));
  assert.equal(creations[0].yoloMode, false);
  assert.equal(events.filter(event => event.type === 'approval').length, 1);
  let failed = true;
  const original = session.turn.respondQuestion;
  session.turn.respondQuestion = async (...args) => {
    if (failed) throw Error('wire failed');
    return original(...args);
  };
  await assert.rejects(session.answerQuestion('question-1', {}), /wire failed/);
  assert.equal(session.pendingQuestions.get('question-1').state, 'pending');
  failed = false;
  await session.answerQuestion('question-1', {});
  await running;
  assert.equal(events.find(event => event.type === 'question-resolved').decision, 'skipped');
  assert.equal(events.find(event => event.type === 'approval-resolved').decision, 'expired');
});
