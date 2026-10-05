const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startSubagentModel } = require('../../../tests/integration/fixtures/subagent-model.cjs');
const { saveBindings } = require('./project-bindings.cjs');
const { saveProfile, defaults } = require('./model-config.cjs');
const { saveSettings } = require('./harness-settings.cjs');
let fixture, evidence;
const todoItems = [
  { title: '核对轴承座与底板的设计尺寸', status: 'done' },
  { title: '汇总设计参数与几何回读', status: 'in_progress' },
  { title: '等待确认后再修改工程', status: 'pending' },
];
const markdown = `<think>REASONING_STAYS_FOLDED</think>

## 轴承座核对

**关键尺寸**与已有回读对照。

| 对象 | 尺寸 | 来源 |
| --- | --- | --- |
| 底板 | 120 × 80 × 8 mm | \`BaseLength / BaseWidth / BaseThickness\` |
| 轴承座 | Ø36 → Ø40 mm | \`SeatRadius\` |

> 回读只证明已记录的几何事实。

- 核对包围盒
- 保留参数来源

\`\`\`python
SeatRadius = 20
\`\`\`

[链接](javascript:globalThis.__markdownExecuted=true)
![blocked-remote-image](https://example.com/model.png)

<script>globalThis.__markdownExecuted=true</script>
<iframe src="https://example.com"></iframe>`;
async function prepare(config, modelDirectory) {
  evidence =
    process.env.HARNESS_SUBAGENT_SELFTEST_OUTPUT ||
    path.resolve(__dirname, '../../../dist/subagent-selftest');
  fs.mkdirSync(evidence, { recursive: true });
  const directory = path.join(config, 'subagent-project');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'dimensions.json');
  fs.writeFileSync(file, JSON.stringify({ length: 120, width: 80, bore: 40 }));
  fixture = await startSubagentModel({
    file,
    scenario: 'parallel',
    rootSummary: markdown,
    childSummary: '### 子任务摘要\n\n**尺寸检查**完成。\n\n- 读取配方\n- 记录文件依据',
    todoItems,
  });
  saveSettings(modelDirectory, { guiPluginEnabled: false, approvalMode: 'ask' });
  saveBindings(config, {
    activeId: 'subagent-cad',
    projects: [
      {
        id: 'subagent-cad',
        name: 'Subagent regression',
        path: fs.realpathSync(directory),
        domain: 'pcb',
      },
    ],
  });
  saveProfile(modelDirectory, {
    ...defaults,
    provider: 'openai_legacy',
    endpoint: fixture.endpoint,
    model: 'subagent-regression',
    thinking: false,
    imageInput: false,
  });
}
async function run(window) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(
      'Subagent UI timed out: ' + script + '\n' + (await evaluate('document.body.innerText')),
    );
  }
  async function prompt(text) {
    await evaluate(
      `(() => { const area = document.querySelector('.ia-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, ${JSON.stringify(text)}); area.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await evaluate(`document.querySelector('.ia-send').click()`);
  }
  async function capture(name) {
    // Let layout and the compositor catch up before saving visual evidence.
    await evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    );
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(evidence, name), (await window.webContents.capturePage()).toPNG());
  }
  async function toggleTheme() {
    await evaluate(`document.querySelector('.ia-settings-button').click()`);
    await wait(`Boolean(document.querySelector('.ia-settings-row button'))`);
    await evaluate(`document.querySelector('.ia-settings-row button').click()`);
    await evaluate(`document.querySelector('.ia-settings-button').click()`);
    await wait(`!document.querySelector('.ia-settings-popover')`);
  }
  try {
    await wait(`Boolean(document.querySelector('.ia-project-row'))`);
    await evaluate(`document.querySelector('.ia-project-row').click()`);
    await wait(`Boolean(document.querySelector('.ia-project-start'))`);
    await evaluate(`document.querySelector('.ia-project-start').click()`);
    await wait(`Boolean(document.querySelector('.ia-composer textarea'))`);
    await prompt('并行检查零件尺寸，分别探索、规划和编程分析');
    await wait(
      `document.querySelectorAll('.ia-subagent-card.completed, .ia-subagent-card .completed').length >= 3 && !document.querySelector('button[title="Stop agent"]')`,
    );
    assert.equal(await evaluate(`document.querySelectorAll('.ia-subagent-card').length`), 3);
    assert.equal(await evaluate(`document.querySelectorAll('.ia-subagent-card[open]').length`), 0);
    await wait(
      `document.querySelector('.ia-agent-text .ia-markdown h2')?.textContent === '轴承座核对'`,
    );
    assert.equal(
      await evaluate(`document.querySelector('.ia-agent-text .ia-markdown tbody').rows.length`),
      2,
    );
    assert.ok(
      await evaluate(
        `document.querySelector('.ia-agent-text .ia-markdown strong')?.textContent.includes('关键尺寸')`,
      ),
    );
    assert.ok(
      await evaluate(
        `document.querySelector('.ia-agent-text .ia-markdown pre code')?.textContent.includes('SeatRadius = 20')`,
      ),
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.ia-agent-text .ia-markdown img, .ia-agent-text .ia-markdown iframe, .ia-agent-text .ia-markdown script, .ia-agent-text .ia-markdown a[href]').length`,
      ),
      0,
    );
    assert.equal(await evaluate(`Boolean(globalThis.__markdownExecuted)`), false);
    assert.equal(
      await evaluate(`document.querySelector('.ia-todo-title').getAttribute('aria-expanded')`),
      'false',
    );
    assert.equal(await evaluate(`document.querySelectorAll('.ia-todo li').length`), 0);
    assert.equal(
      await evaluate(`document.querySelector('.ia-todo-progress').getAttribute('aria-valuenow')`),
      '1',
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.ia-agent-text .ia-thinking[data-expanded="true"]').length`,
      ),
      0,
    );
    await evaluate(
      `document.querySelector('.ia-agent-text .ia-markdown').scrollIntoView({ block: 'center' })`,
    );
    await capture('markdown-todo-collapsed.png');
    await evaluate(`document.querySelector('.ia-todo-title').click()`);
    assert.equal(await evaluate(`document.querySelectorAll('.ia-todo li').length`), 3);
    assert.equal(await evaluate(`document.querySelectorAll('.ia-todo-spin').length`), 0);
    await capture('markdown-todo-expanded.png');
    window.setSize(1000, 740);
    await wait(`window.innerWidth <= 1000`);
    await evaluate(`document.querySelector('button[title="Show workspace"]').click()`);
    await wait(`Boolean(document.querySelector('.ia-workspace-divider'))`);
    await evaluate(
      `document.querySelector('.ia-workspace-divider').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))`,
    );
    await wait(`document.querySelector('.ia-chat').clientWidth <= 301`);
    assert.ok(
      await evaluate(
        `document.querySelector('.ia-chat-scroll').scrollWidth <= document.querySelector('.ia-chat-scroll').clientWidth + 1`,
      ),
    );
    await toggleTheme();
    await wait(`document.querySelector('.ia-app').classList.contains('theme-dark')`);
    assert.equal(
      await evaluate(`getComputedStyle(document.querySelector('.ia-todo')).backgroundColor`),
      'rgb(37, 39, 40)',
    );
    await capture('markdown-todo-dark-narrow.png');
    await toggleTheme();
    await evaluate(
      `document.querySelector('.ia-todo-title').click(); document.querySelector('button[title="Hide workspace"]').click()`,
    );
    window.setSize(1440, 900);
    await capture('parallel-collapsed.png');
    await evaluate(`document.querySelector('.ia-subagent-card > summary').click()`);
    await wait(
      `document.querySelector('.ia-subagent-card[open] .ia-agent-tool')?.innerText.includes('ReadFile')`,
    );
    await evaluate(
      `document.querySelector('.ia-subagent-card[open] .ia-agent-tool > summary').click()`,
    );
    assert.ok(
      await evaluate(`Boolean(document.querySelector('.ia-subagent-card[open] .ia-markdown h3'))`),
    );
    assert.match(
      await evaluate(`document.querySelector('.ia-subagent-card[open]').innerText`),
      /120/,
    );
    await capture('parallel-expanded.png');
    fixture.setScenario('background-approval');
    await prompt('后台检查零件，完成后回报');
    await wait(
      `document.querySelectorAll('.ia-subagent-card').length === 4 && !document.querySelector('button[title="Stop agent"]')`,
    );
    fixture.release();
    await wait(`Boolean(document.querySelector('.ia-approval button'))`);
    assert.match(
      await evaluate(`document.querySelector('.ia-approval').innerText`),
      /子任务.*后台/s,
    );
    assert.equal(
      await evaluate(`document.querySelector('.ia-approval').closest('.ia-subagent-card')`),
      null,
    );
    await capture('background-approval.png');
    await evaluate(`document.querySelector('.ia-approval button').click()`);
    await wait(
      `!document.querySelector('.ia-approval') && document.querySelectorAll('.ia-subagent-card .completed').length === 4`,
    );
    await capture('background-completed.png');
    await evaluate('location.reload()');
    await wait(`document.querySelectorAll('.ia-subagent-card .completed').length === 4`);
    assert.equal(await evaluate(`document.querySelectorAll('.ia-subagent-card[open]').length`), 0);
    assert.ok(
      fixture.requests.some(b =>
        b.messages.some(
          m =>
            m.role === 'tool' && JSON.stringify(m.content).includes('SUBAGENT_APPROVAL_EXECUTED'),
        ),
      ),
    );
    console.log(
      JSON.stringify({
        ok: true,
        pinnedNativeKimi: true,
        parallelRoles: 3,
        foldedDetails: true,
        backgroundApproval: true,
        historyReload: true,
        markdownAndCompactTodo: true,
        evidence,
      }),
    );
  } finally {
    await fixture.close();
  }
}
module.exports = { prepare, run };
