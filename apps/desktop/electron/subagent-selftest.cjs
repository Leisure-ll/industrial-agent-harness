const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startSubagentModel } = require('../../../tests/integration/fixtures/subagent-model.cjs');
const { saveBindings } = require('./project-bindings.cjs');
const { saveProfile, defaults } = require('./model-config.cjs');
const { saveSettings } = require('./harness-settings.cjs');
let fixture, evidence;
async function prepare(config, modelDirectory) {
  evidence =
    process.env.HARNESS_SUBAGENT_SELFTEST_OUTPUT ||
    path.resolve(__dirname, '../../../dist/subagent-selftest');
  fs.mkdirSync(evidence, { recursive: true });
  const directory = path.join(config, 'subagent-project');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'dimensions.json');
  fs.writeFileSync(file, JSON.stringify({ length: 120, width: 80, bore: 40 }));
  fixture = await startSubagentModel({ file, scenario: 'parallel' });
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
  const capture = async name =>
    fs.writeFileSync(path.join(evidence, name), (await window.webContents.capturePage()).toPNG());
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
    await capture('parallel-collapsed.png');
    await evaluate(`document.querySelector('.ia-subagent-card > summary').click()`);
    await wait(
      `document.querySelector('.ia-subagent-card[open] .ia-agent-tool')?.innerText.includes('ReadFile')`,
    );
    await evaluate(
      `document.querySelector('.ia-subagent-card[open] .ia-agent-tool > summary').click()`,
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
        evidence,
      }),
    );
  } finally {
    await fixture.close();
  }
}
module.exports = { prepare, run };
