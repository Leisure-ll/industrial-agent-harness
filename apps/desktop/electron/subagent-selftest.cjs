const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startModel } = require('../../../tests/integration/fixtures/domain-mcp-model.cjs');
const { saveBindings } = require('./project-bindings.cjs');
const { saveProfile, defaults } = require('./model-config.cjs');
let fixture, evidence;
const child = body =>
  body.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('UI_CHILD_ONLY'));
const taskText = body =>
  String(
    body.messages.findLast(
      m =>
        m.role === 'user' &&
        /FOREGROUND_TASK|BACKGROUND_TASK|UI_CHILD_ONLY|background_task/.test(
          JSON.stringify(m.content),
        ),
    )?.content,
  );
async function prepare(config, modelDirectory) {
  evidence = path.dirname(config);
  const directory = path.join(config, 'subagent-project');
  fs.mkdirSync(directory, { recursive: true });
  fixture = await startModel({
    resultIndex: body =>
      body.messages
        .slice(
          body.messages.findLastIndex(
            m =>
              m.role === 'user' &&
              /FOREGROUND_TASK|BACKGROUND_TASK|UI_CHILD_ONLY|background_task/.test(
                JSON.stringify(m.content),
              ),
          ) + 1,
        )
        .filter(m => m.role === 'tool').length,
    beforeTool: 'Checking this task before using tools. '.repeat(6),
    calls: body =>
      !child(body) &&
      String(
        body.messages.findLast(
          m =>
            m.role === 'user' &&
            /FOREGROUND_TASK|BACKGROUND_TASK|UI_CHILD_ONLY|background_task/.test(
              JSON.stringify(m.content),
            ),
        )?.content,
      ).includes('source_kind="background_task"')
        ? [
            {
              name: 'Bash',
              arguments: { command: 'echo FOLLOWUP_TOOL_OK', description: 'FOLLOWUP_APPROVAL' },
            },
            {
              name: 'AskUserQuestion',
              arguments: {
                questions: [
                  {
                    question: 'Confirm follow-up?',
                    header: 'Follow-up',
                    options: [{ label: 'Continue' }, { label: 'Stop' }],
                  },
                ],
              },
            },
          ]
        : child(body)
          ? [
              {
                name: 'Bash',
                arguments: {
                  command: 'echo UI_CHILD_TOOL_OK',
                  description: 'Read-only child marker',
                },
              },
            ]
          : taskText(body).includes('SHELL_BACKGROUND_TASK')
            ? [
                {
                  name: 'Bash',
                  arguments: {
                    command: 'sleep 1; echo SHELL_BACKGROUND_OUTPUT',
                    description: 'SHELL_BACKGROUND_MARKER',
                    run_in_background: true,
                  },
                },
              ]
            : [
                {
                  name: 'Agent',
                  arguments: {
                    description: 'Inspect the part independently',
                    prompt: 'UI_CHILD_ONLY: inspect and summarize.',
                    subagent_type: 'coder',
                    run_in_background: JSON.stringify(body.messages).includes('BACKGROUND_TASK'),
                  },
                },
                ...(JSON.stringify(body.messages).includes('BACKGROUND_TASK')
                  ? []
                  : [
                      {
                        name: 'AskUserQuestion',
                        arguments: {
                          questions: [
                            {
                              question: 'Which inspection?',
                              header: 'Inspect',
                              options: [{ label: 'Geometry' }, { label: 'Constraints' }],
                            },
                          ],
                        },
                      },
                    ]),
              ],
    success: body =>
      taskText(body).includes('SHELL_BACKGROUND_MARKER')
        ? 'SHELL_FOLLOWUP_OK'
        : taskText(body).includes('SHELL_BACKGROUND_TASK')
          ? 'SHELL_STARTED_OK'
          : child(body)
            ? '## Child result\n\n**CHILD_SUMMARY_OK**'
            : '<think>UI_THINKING_ONLY</think>\n## Final result\n\n**PARENT_FINAL_OK**\n\n| Check | Result |\n|---|---|\n| Native child | Complete |',
  });
  saveBindings(config, {
    activeId: 'subagent-test',
    projects: [
      {
        id: 'subagent-test',
        name: 'Native subagent test',
        path: fs.realpathSync(directory),
        domain: 'chip',
      },
    ],
  });
  saveProfile(modelDirectory, {
    ...defaults,
    provider: 'openai_legacy',
    endpoint: fixture.endpoint,
    model: 'controlled-subagent',
    thinking: false,
  });
}
async function run(window) {
  const evaluate = async script => {
    try {
      return await window.webContents.executeJavaScript(script, true);
    } catch (error) {
      throw Error(
        `${error.message}: ${script}\n${await window.webContents.executeJavaScript('document.body.innerText')}`,
      );
    }
  };
  async function wait(script) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await evaluate(script)) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw Error(
      `Native subagent UI timed out: ${script}\n${await evaluate('document.body.innerText')}`,
    );
  }
  try {
    await wait(`Boolean(document.querySelector('.ia-project-row'))`);
    await evaluate(`document.querySelector('.ia-project-row').click()`);
    await wait(`Boolean(document.querySelector('.ia-project-start'))`);
    await evaluate(`document.querySelector('.ia-project-start').click()`);
    await wait(`Boolean(document.querySelector('.ia-composer textarea'))`);
    for (const task of ['FOREGROUND_TASK', 'BACKGROUND_TASK']) {
      await evaluate(
        `(() => {const area=document.querySelector('.ia-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,${JSON.stringify(task)});area.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await evaluate(`document.querySelector('.ia-send').click()`);
      await wait(`Boolean(document.querySelector('.ia-approval button'))`);
      assert.match(
        await evaluate(`document.querySelector('.ia-approval-source').innerText`),
        /agent-/,
      );
      assert.ok(await evaluate(`document.querySelectorAll('.ia-subagent-card').length>0`));
      await evaluate(`document.querySelector('.ia-approval button').click()`);
      if (task === 'BACKGROUND_TASK') {
        await wait(
          `Array.from(document.querySelectorAll('.ia-approval')).some(n=>n.innerText.includes('FOLLOWUP_TOOL_OK'))`,
        );
        await evaluate(`document.querySelector('.ia-approval button').click()`);
      }
      if (task === 'FOREGROUND_TASK' || task === 'BACKGROUND_TASK') {
        await wait(`Boolean(document.querySelector('.ia-question input[type="radio"]'))`);
        await evaluate(
          `document.querySelector('.ia-question input[type="radio"]').click();document.querySelector('.ia-question button[type="submit"]').click()`,
        );
      }
      await wait(
        `Array.from(document.querySelectorAll('.ia-subagent-card')).at(-1)?.querySelector('.ia-subagent-status.completed')`,
      );
      await wait(
        `!document.querySelector('.ia-question')&&!document.querySelector('button[title="Stop agent"]')`,
      );
      await wait(`document.querySelectorAll('.ia-markdown h2').length>=1`);
    }
    assert.ok(
      await evaluate(
        `Array.from(document.querySelectorAll('.ia-markdown strong')).some(n=>n.innerText==='PARENT_FINAL_OK')`,
      ),
    );
    assert.ok(
      await evaluate(
        `document.querySelector('.ia-markdown table tbody td')?.innerText==='Native child'`,
      ),
    );
    assert.ok(
      await evaluate(
        `!Array.from(document.querySelectorAll('.ia-markdown')).some(n=>n.innerText.includes('UI_THINKING_ONLY'))`,
      ),
    );
    const history = await evaluate(
      `window.viewerHost.chats().then(state=>window.viewerHost.chatHistory({id:state.activeId}))`,
    );
    assert.equal(history.turns.length, 2);
    for (const turn of history.turns) {
      assert.equal(turn.status, 'finished');
      assert.ok(
        turn.events.some(
          e =>
            e.type === 'subagent-state' &&
            e.status === 'completed' &&
            e.summary.includes('CHILD_SUMMARY_OK'),
        ),
      );
    }
    await window.webContents.reload();
    await wait(
      `document.querySelectorAll('.ia-subagent-card').length===2&&document.querySelectorAll('.ia-markdown table').length===3`,
    );
    await evaluate(
      `(() => {const area=document.querySelector('.ia-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,'SHELL_BACKGROUND_TASK');area.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await evaluate(`document.querySelector('.ia-send').click()`);
    await wait(`Boolean(document.querySelector('.ia-approval button'))`);
    await evaluate(`document.querySelector('.ia-approval button').click()`);
    await wait(`document.body.innerText.includes('SHELL_STARTED_OK')`);
    await wait(`Boolean(document.querySelector('button[title="Stop agent"]'))`);
    await wait(
      `Array.from(document.querySelectorAll('.ia-approval')).some(n=>n.innerText.includes('FOLLOWUP_TOOL_OK'))`,
    );
    await evaluate(`document.querySelector('.ia-approval button').click()`);
    await wait(`Boolean(document.querySelector('.ia-question input[type="radio"]'))`);
    await evaluate(
      `document.querySelector('.ia-question input[type="radio"]').click();document.querySelector('.ia-question button[type="submit"]').click()`,
    );
    await wait(
      `document.body.innerText.includes('SHELL_FOLLOWUP_OK')&&!document.querySelector('button[title="Stop agent"]')`,
    );
    const shellHistory = await evaluate(
      `window.viewerHost.chats().then(state=>window.viewerHost.chatHistory({id:state.activeId}))`,
    );
    assert.equal(shellHistory.turns.length, 3);
    assert.ok(
      shellHistory.turns
        .at(-1)
        .events.some(e => e.type === 'question-resolved' && e.decision === 'answered'),
    );
    await evaluate(
      `(() => {const area=document.querySelector('.ia-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,'BACKGROUND_TASK_CANCEL');area.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await evaluate(`document.querySelector('.ia-send').click()`);
    await wait(`Boolean(document.querySelector('.ia-approval button'))`);
    await wait(`Boolean(document.querySelector('button[title="Stop agent"]'))`);
    await evaluate(`document.querySelector('button[title="Stop agent"]').click()`);
    await wait(
      `Array.from(document.querySelectorAll('.ia-subagent-card')).at(-1)?.querySelector('.ia-subagent-status.cancelled')&&!document.querySelector('.ia-approval')&&!document.querySelector('button[title="Stop agent"]')`,
    );
    const stopped = await evaluate(
      `window.viewerHost.chats().then(state=>window.viewerHost.chatHistory({id:state.activeId}))`,
    );
    assert.ok(
      !stopped.turns.at(-1).events.some(event => event.type === 'error'),
      'Explicit Stop must not surface a native exit error',
    );
    assert.ok(
      stopped.turns
        .at(-1)
        .events.some(event => event.type === 'approval-resolved' && event.decision === 'expired'),
    );
    fs.writeFileSync(
      path.join(evidence, 'native-subagent-ui.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(
      JSON.stringify({
        ok: true,
        nativeKimi: true,
        foreground: true,
        background: true,
        backgroundShell: true,
        nativeFollowup: true,
        followupApproval: true,
        followupQuestion: true,
        backgroundStop: true,
        approval: true,
        question: true,
        markdown: true,
        history: true,
        evidence,
      }),
    );
  } finally {
    fs.writeFileSync(
      path.join(evidence, 'native-subagent-requests.json'),
      JSON.stringify(fixture.requests, null, 2),
    );
    fixture.close();
  }
}
module.exports = { prepare, run };
