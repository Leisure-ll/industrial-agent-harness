const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ChatStore } = require('@industrial-agent-harness/harness-core');
const { saveBindings } = require('./project-bindings.cjs');
const { createResultFixture } = require('./result-fixture.cjs');
const { setLanguage } = require('./selftest-language.cjs');

let project, results, chatId;
async function prepare(config) {
  project = path.join(config, 'result-project');
  const fixture = await createResultFixture(project, path.join(path.dirname(config), 'state'));
  results = fixture.results;
  fixture.runtime.close();
  const other = path.join(config, 'other-project');
  fs.mkdirSync(other, { recursive: true });
  saveBindings(config, {
    activeId: 'result-test',
    projects: [
      {
        id: 'result-test',
        name: 'Recorded results',
        path: fs.realpathSync(project),
        domain: 'chip',
      },
      {
        id: 'other-result-test',
        name: 'Other project',
        path: fs.realpathSync(other),
        domain: 'chip',
      },
    ],
  });
  const store = new ChatStore(path.join(path.dirname(config), 'chats'));
  try {
    chatId = store.createDraft(project, 'chip').id;
    for (const result of results) {
      const turn = store.beginTurn(chatId, `Recorded ${result.verification.status} action`);
      store.append(turn, { type: 'industrial-result', ...result });
      store.append(turn, { type: 'done', result: { status: 'finished' } });
      store.finish(turn, 'finished');
    }
    // An older history record has no artifacts/evidence fields.
    const legacy = store.beginTurn(chatId, 'Legacy result without output metadata');
    store.append(legacy, {
      type: 'industrial-result',
      action: { id: 'legacy-action', status: 'completed' },
      verification: { status: 'not_run', reason: 'Legacy observation.' },
      state: { id: 'legacy-state', status: 'unverified' },
      checkpoint: { id: 'legacy-checkpoint' },
    });
    store.finish(legacy, 'finished');
  } finally {
    store.close();
  }
}

async function run(window) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(
      `Result selftest timed out: ${script}; UI=${await evaluate('document.body.innerText.slice(-2500)')}`,
    );
  }
  const card = index => `.ia-industrial-result[data-action-id="${results[index].action.id}"]`;
  const clickOutput = index =>
    evaluate(
      `document.querySelector(${JSON.stringify(card(index) + ' .ia-result-artifact')}).click()`,
    );
  await wait(`document.querySelectorAll('.ia-industrial-result').length === 5`);
  await evaluate(
    `document.querySelectorAll('.ia-industrial-result').forEach(node => node.open = true)`,
  );
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(card(0) + ' summary')}).textContent`),
    'Engineering verification passed',
  );
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(card(1) + ' summary')}).textContent`),
    'Engineering verification was not run',
  );
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(card(2) + ' summary')}).textContent`),
    'Engineering verification failed',
  );
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(card(2) + ' .ia-result-execution')}).textContent`,
    ),
    'Execution completed',
  );
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(card(3) + ' .ia-result-execution')}).textContent`,
    ),
    'Execution failed',
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-action-id="legacy-action"] .ia-result-artifact')`,
    ),
    null,
  );
  await clickOutput(0);
  await wait(`document.querySelector('.ia-workspace')?.innerText.includes('measured=42')`);
  await clickOutput(2);
  await wait(`document.querySelector('.ia-workspace')?.innerText.includes('measured=41')`);
  assert.equal(
    await evaluate(`document.querySelector('.ia-workspace').innerText.includes('measured=42')`),
    false,
  );
  const request = {
    projectId: 'result-test',
    chatId,
    actionId: results[0].action.id,
    artifactId: results[0].artifacts[0].id,
  };
  const denied = await evaluate(
    `window.viewerHost.openResultArtifact(${JSON.stringify({ ...request, projectId: 'other-result-test' })}).then(() => null, error => String(error))`,
  );
  assert.match(denied, /selected project or chat changed/);
  const wrongAction = await evaluate(
    `window.viewerHost.openResultArtifact(${JSON.stringify({ ...request, actionId: results[2].action.id })}).then(() => null, error => String(error))`,
  );
  assert.match(wrongAction, /does not belong/);
  await evaluate(`(() => {
    document.querySelector(${JSON.stringify(card(0) + ' .ia-result-artifact')}).click();
    document.querySelector(${JSON.stringify(card(2) + ' .ia-result-artifact')}).click();
  })()`);
  await wait(
    `document.querySelector(${JSON.stringify(card(0) + ' [role="alert"]')})?.textContent.includes('Another file was selected')`,
  );
  await wait(
    `document.querySelector('.ia-workspace')?.innerText.includes('measured=41') && !document.querySelector(${JSON.stringify(card(2) + ' .ia-result-artifact')}).disabled`,
  );
  fs.writeFileSync(path.join(project, results[0].artifacts[0].relativePath), 'measured=43\n');
  await clickOutput(0);
  await wait(
    `document.querySelector(${JSON.stringify(card(0) + ' [role="alert"]')})?.textContent.includes('changed since the action')`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.ia-workspace').innerText.includes('measured=41')`),
    true,
  );
  assert.equal(
    await evaluate(`document.querySelector('.ia-workspace').innerText.includes('measured=43')`),
    false,
  );

  // Configuration recovery must preserve the unsent draft and open the actual modal.
  const draft = 'Inspect the recorded measurement.';
  await evaluate(`(() => {
    const area = document.querySelector('.ia-composer textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, ${JSON.stringify(draft)});
    area.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(`!document.querySelector('.ia-send').disabled`);
  await evaluate(`document.querySelector('.ia-send').click()`);
  await wait(`Boolean(document.querySelector('.ia-recovery-action'))`);
  await evaluate(`document.querySelector('.ia-recovery-action').click()`);
  await wait(`Boolean(document.querySelector('.ia-model-modal'))`);
  assert.equal(await evaluate(`document.querySelector('.ia-composer textarea').value`), draft);
  await evaluate(
    `document.querySelector('.ia-model-modal button[aria-label="Close settings"]').click()`,
  );
  await setLanguage(window, 'zh-CN');
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(card(1) + ' summary')}).textContent`),
    '未执行工程验证',
  );
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(card(2) + ' .ia-result-execution')}).textContent`,
    ),
    '执行已完成',
  );
  assert.equal(
    await evaluate(`document.querySelector('.ia-recovery-action').textContent`),
    '打开模型 API 设置',
  );
  await clickOutput(2);
  await wait(`document.querySelector('.ia-workspace')?.innerText.includes('measured=41')`);
  if (process.env.INDUSTRIAL_RESULT_SCREENSHOT) {
    await evaluate(`document.fonts.ready`);
    await evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    );
    fs.writeFileSync(
      process.env.INDUSTRIAL_RESULT_SCREENSHOT,
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  await window.webContents.reload();
  await wait(`document.querySelectorAll('.ia-industrial-result').length === 5`);
  await evaluate(
    `document.querySelectorAll('.ia-industrial-result').forEach(node => node.open = true)`,
  );
  await clickOutput(2);
  await wait(`document.querySelector('.ia-workspace')?.innerText.includes('measured=41')`);
  console.log(
    'Result selftest passed: durable action outputs, failed verification, hash rejection, IPC binding, legacy history, model settings recovery, Chinese, and reload.',
  );
}

module.exports = { prepare, run };
