const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { saveBindings } = require('./project-bindings.cjs');

let project;
const source = 'name,value\n用户原文,000123\nSettings,keep this source verbatim\n';
function prepare(config) {
  project = path.join(config, 'language-project');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'data.csv'), source);
  fs.writeFileSync(path.join(project, 'notes.txt'), 'Original text · 原始内容');
  saveBindings(config, {
    activeId: 'language-project',
    projects: [
      {
        id: 'language-project',
        name: '语言测试 Project',
        path: fs.realpathSync(project),
        domain: 'pcb',
      },
    ],
  });
}

async function run(window, dialog) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(`Language selftest timed out: ${script}`);
  }
  async function settings() {
    if (!(await evaluate(`Boolean(document.getElementById('ia-language'))`)))
      await evaluate(`document.querySelector('.ia-settings-button').click()`);
    await wait(`Boolean(document.getElementById('ia-language'))`);
  }
  async function language(value) {
    await settings();
    await evaluate(
      `(() => { const select=document.getElementById('ia-language'); select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
    if (value !== 'system') await wait(`document.documentElement.lang===${JSON.stringify(value)}`);
  }
  const closeSettings = () =>
    evaluate(`document.querySelector('.ia-settings-title button').click()`);
  const input = (selector, value) =>
    evaluate(
      `(() => {const node=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  async function directoryTitle(expected) {
    const original = dialog.showOpenDialog;
    let options;
    try {
      // Exercise the real preload/main IPC while avoiding an interactive OS dialog.
      dialog.showOpenDialog = async value => {
        options = value;
        return { canceled: true, filePaths: [] };
      };
      await evaluate(`document.querySelector('.ia-folder-picker').click()`);
      const deadline = Date.now() + 5000;
      while (!options && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(options?.title, expected);
      assert.deepEqual(options.properties, ['openDirectory']);
    } finally {
      dialog.showOpenDialog = original;
    }
  }

  await wait(`document.querySelector('.ia-domain-pill')?.innerText.includes('PCB')`);
  assert.equal(await evaluate(`Boolean(document.querySelector('.ia-workspace'))`), false);
  await settings();
  assert.equal(await evaluate(`document.getElementById('ia-language').value`), 'system');
  assert.deepEqual(
    await evaluate(
      `Array.from(document.getElementById('ia-language').options).slice(1).map(option => ({value:option.value,label:option.textContent}))`,
    ),
    Object.entries(require('../i18n.config.json').locales).map(([value, { label }]) => ({
      value,
      label,
    })),
  );
  await language('en');
  await closeSettings();
  await input('.ia-composer textarea', '未发送的中文草稿 / unsent draft');
  // The native IME confirmation Enter must not submit a task.
  await evaluate(
    `document.querySelector('.ia-composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}))`,
  );
  assert.equal(await evaluate(`document.querySelectorAll('.ia-chat-turn').length`), 0);
  await language('zh-CN');
  assert.equal(
    await evaluate(`document.querySelector('.ia-settings-title b').textContent`),
    '设置',
  );
  assert.equal(
    await evaluate(`document.querySelector('.ia-composer textarea').placeholder`),
    '描述你的项目任务…',
  );
  assert.equal(
    await evaluate(`document.querySelector('.ia-composer textarea').value`),
    '未发送的中文草稿 / unsent draft',
  );
  assert.equal(await evaluate(`document.getElementById('ia-language').value`), 'zh-CN');
  await closeSettings();
  await evaluate(`document.querySelector('button[title="展开工作区"]').click()`);
  await evaluate(`document.querySelector('button[title="展开文件树"]').click()`);
  await wait(`Boolean(document.querySelector('.ia-file-list button[title="data.csv"]'))`);
  await evaluate(`document.querySelector('.ia-file-list button[title="data.csv"]').click()`);
  await wait(`Boolean(document.querySelector('.rp-document-table tbody tr'))`);
  await input('input[aria-label="在文档中搜索"]', '用户原文');
  await wait(`document.querySelectorAll('.rp-document-table tbody tr').length===1`);
  await evaluate(`document.querySelector('button[aria-label="放大"]').click()`);
  await wait(`document.querySelector('output[aria-label="查看器缩放"]').textContent==='120%'`);
  await evaluate(`document.querySelector('.rp-document').dataset.languageIdentity='retained'`);
  await language('en');
  assert.equal(
    await evaluate(`document.querySelector('.rp-document').dataset.languageIdentity`),
    'retained',
  );
  assert.equal(
    await evaluate(`document.querySelector('output[aria-label="Viewer zoom"]').textContent`),
    '120%',
  );
  assert.equal(
    await evaluate(`document.querySelector('input[aria-label="Find in document"]').value`),
    '用户原文',
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.rp-document-table tbody tr').length`),
    1,
  );
  assert.match(
    await evaluate(`document.querySelector('.rp-document-table tbody').textContent`),
    /用户原文.*000123/,
  );
  assert.equal(
    await evaluate(`document.querySelector('.ia-composer textarea').value`),
    '未发送的中文草稿 / unsent draft',
  );
  await closeSettings();
  await evaluate(`document.querySelector('button[aria-label="View agent logs"]').click()`);
  await wait(`document.querySelector('.ia-agent-log')?.open`);
  assert.equal(
    await evaluate(`document.getElementById('ia-log-title').textContent`),
    'Agent run logs',
  );
  await evaluate(`document.querySelector('button[aria-label="Close agent logs"]').click()`);
  await evaluate(`document.querySelector('button[aria-label="New project"]').click()`);
  await wait(`Boolean(document.querySelector('[aria-label="Create project"]'))`);
  assert.equal(
    await evaluate(`document.querySelector('.ia-create-project h2').textContent`),
    'New project',
  );
  await directoryTitle('Choose engineering project');
  await input('.ia-create-project input', 'Project 用户名称');
  await evaluate(`document.querySelector('button[aria-label="Close project creation"]').click()`);
  await language('zh-CN');
  await closeSettings();
  await evaluate(`document.querySelector('button[aria-label="新建项目"]').click()`);
  await wait(`Boolean(document.querySelector('[aria-label="创建项目"]'))`);
  await directoryTitle('选择工程项目目录');
  await evaluate(`document.querySelector('button[aria-label="关闭项目创建"]').click()`);
  await settings();
  await new Promise(resolve => setTimeout(resolve, 300));
  if (process.env.HARNESS_LANGUAGE_SELFTEST_OUTPUT)
    fs.writeFileSync(
      process.env.HARNESS_LANGUAGE_SELFTEST_OUTPUT,
      (await window.webContents.capturePage()).toPNG(),
    );

  await new Promise(resolve => {
    window.webContents.once('did-finish-load', resolve);
    window.webContents.reload();
  });
  await wait(
    `document.documentElement.lang==='zh-CN' && Boolean(document.querySelector('.ia-settings-button'))`,
  );
  await settings();
  assert.equal(await evaluate(`document.getElementById('ia-language').value`), 'zh-CN');
  await language('system');
  assert.equal(
    await evaluate(`document.documentElement.lang`),
    await evaluate(`/^zh(?:-|$)/i.test(navigator.languages[0]||'')?'zh-CN':'en'`),
  );
  assert.equal(fs.readFileSync(path.join(project, 'data.csv'), 'utf8'), source);
  console.log(
    'Language selftest passed: switch, persistence, system fallback, IME, draft, source content, viewer zoom/search/state and dialogs.',
  );
}

module.exports = { prepare, run };
