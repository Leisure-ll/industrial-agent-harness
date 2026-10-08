const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { saveBindings } = require('./project-bindings.cjs');
const { setLanguage } = require('./selftest-language.cjs');

let project;
const source =
  '// A source preview must preserve the project file.\nmodule sobel_filter;\nendmodule\n';
function prepare(config) {
  project = path.join(config, 'sobel-project');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'sobel_filter.v'), source);
  saveBindings(config, { activeId: null, projects: [] });
}

async function run(window, dialog) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(`UI selftest timed out: ${script}`);
  }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = (selector, value) =>
    evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  async function quality(name) {
    await evaluate(`document.fonts.ready`);
    assert.equal(
      await evaluate(
        `Array.from(document.fonts).some(face => face.family === 'IBM Plex Sans' && face.status === 'loaded')`,
      ),
      true,
      `${name}: the self-hosted font must load through the production app protocol`,
    );
    const failures = await evaluate(`(() => {
      const samples = ['.ia-chat-welcome p', '.ia-composer textarea', '.ia-project-row.selected',
        '.ia-sidebar-chat[aria-current="page"]', '.ia-file-list button.selected', '.ia-source-panel pre'];
      function rgba(color) { return color.match(/[\\d.]+/g).map(Number); }
      function background(node) {
        if (!node) return [255, 255, 255];
        const values = rgba(getComputedStyle(node).backgroundColor);
        const alpha = values[3] ?? 1;
        if (alpha === 1) return values.slice(0, 3);
        const under = background(node.parentElement);
        return under.map((channel, index) => values[index] * alpha + channel * (1 - alpha));
      }
      function luminance(channels) {
        const linear = channels.map(channel => { const s = channel / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
        return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
      }
      return samples.flatMap(selector => {
        const node = document.querySelector(selector);
        if (!node || node.disabled) return [];
        const foreground = luminance(rgba(getComputedStyle(node).color).slice(0, 3));
        const surface = luminance(background(node));
        const ratio = (Math.max(foreground, surface) + .05) / (Math.min(foreground, surface) + .05);
        return ratio < 4.5 ? [{ selector, ratio }] : [];
      });
    })()`);
    assert.deepEqual(failures, [], `${name}: body and selected text contrast`);
    assert.equal(
      await evaluate(`document.querySelector('.ia-columns').scrollWidth <= innerWidth + 1`),
      true,
      `${name}: panels must fit the window`,
    );
    const clipped =
      await evaluate(`Array.from(document.querySelectorAll('.ia-chat-actions button, .ia-workspace-actions button, .ia-settings-button, .ia-send')).filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1);
    }).map(node => node.getAttribute('aria-label') || node.title || node.textContent)`);
    assert.deepEqual(clipped, [], `${name}: essential controls must remain visible`);
  }
  async function capture(name) {
    const directory = process.env.INDUSTRIAL_UI_SCREENSHOTS;
    if (!directory) return;
    await evaluate(
      `document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`,
    );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, `${name}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
  }

  await wait(`Boolean(document.querySelector('.ia-chat-welcome'))`);
  assert.equal(await evaluate(`Boolean(document.querySelector('.ia-workspace'))`), false);
  assert.equal(await evaluate(`document.querySelector('.ia-composer textarea').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('.ia-send').disabled`), true);
  await capture('empty-light');
  await click('.ia-welcome-create');
  await wait(`Boolean(document.querySelector('.ia-create-project'))`);
  await capture('create-project');
  const original = dialog.showOpenDialog;
  try {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
    await click('.ia-folder-picker');
    await wait(`document.querySelector('.ia-folder-picker').textContent.includes('sobel-project')`);
  } finally {
    dialog.showOpenDialog = original;
  }
  await input('.ia-create-project input', 'Sobel edge detector');
  await evaluate(
    `Array.from(document.querySelectorAll('.ia-domain-choice')).find(node => node.textContent.includes('Chip')).click()`,
  );
  await click('.ia-create-project .primary');
  await wait(`Boolean(document.querySelector('.ia-project-page'))`);
  assert.equal(
    await evaluate(
      `document.querySelector('.ia-project-start').getBoundingClientRect().bottom < innerHeight`,
    ),
    true,
    'New chat must be visible when arriving on project details',
  );
  await capture('project-details');
  await wait(
    `document.querySelector('.ia-execution-options button[aria-pressed="true"]')?.textContent.includes('This computer')`,
  );
  await click('.ia-execution-options button:last-child');
  await wait(
    `document.querySelector('.ia-remote-project-body')?.textContent.includes('Not configured') && document.querySelector('.ia-project-start').disabled`,
  );
  await wait(`!document.querySelector('.ia-project-resources')`);
  assert.equal(
    await evaluate(`document.querySelectorAll('.ia-project-execution input').length`),
    0,
    'Unknown deployment configuration must not ask users for a service name or URL.',
  );
  await capture('remote-unconfigured');
  await setLanguage(window, 'zh-CN');
  await capture('remote-unconfigured-zh');
  await setLanguage(window, 'en');
  await click('.ia-new-chat');
  await wait(
    `document.querySelector('.ia-remote-task-status')?.textContent.includes('Not configured')`,
  );
  assert.equal(await evaluate(`document.querySelector('.ia-composer textarea').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('.ia-send').disabled`), true);
  await click('.ia-remote-task-status button');
  await wait(`Boolean(document.querySelector('.ia-project-page'))`);
  await click('.ia-settings-button');
  await evaluate(
    `Array.from(document.querySelectorAll('.ia-settings-row')).find(row => row.textContent.includes('MCP & Skills')).querySelector('button').click()`,
  );
  await wait(
    `document.querySelector('.ia-remote-service')?.textContent.includes('Not configured')`,
  );
  assert.equal(
    await evaluate(`document.querySelector('.ia-remote-service button').disabled`),
    true,
  );
  assert.equal(await evaluate(`document.querySelector('.ia-advanced-mcp').open`), false);
  await capture('builtin-remote-service');
  await setLanguage(window, 'zh-CN');
  await capture('builtin-remote-service-zh');
  await setLanguage(window, 'en');
  await click('.ia-resource-modal header button');
  await click('.ia-execution-options button:first-child');
  await wait(`!document.querySelector('.ia-project-start').disabled`);
  await click('.ia-project-start');
  await wait(`Boolean(document.querySelector('.ia-chat-welcome'))`);
  const draft = 'Inspect the RTL and explain the timing constraints.\n检查 RTL 并解释时序约束。';
  await input('.ia-composer textarea', draft);
  await quality('chat-light');
  await capture('chat-light');
  await click('.ia-welcome-actions button:last-child');
  await wait(`Boolean(document.querySelector('.ia-workspace-tree'))`);
  assert.equal(await evaluate(`document.querySelector('.ia-composer textarea').value`), draft);
  await click('.ia-file-tree-toggle');
  await click('.ia-chat-actions button[title="Hide workspace"]');
  await click('.ia-chat-actions button[title="Show workspace"]');
  await wait(`Boolean(document.querySelector('.ia-workspace'))`);
  assert.equal(await evaluate(`Boolean(document.querySelector('.ia-workspace-tree'))`), false);
  await click('.ia-file-tree-toggle');
  await wait(`document.querySelectorAll('.ia-file-list button').length > 0`);
  await evaluate(
    `Array.from(document.querySelectorAll('.ia-file-list button')).find(node => node.textContent.includes('sobel_filter.v')).click()`,
  );
  await wait(`Boolean(document.querySelector('.ia-source-panel pre'))`);
  assert.equal(
    await evaluate(`document.querySelector('.ia-source-panel pre').textContent`),
    source,
  );
  await quality('workspace-light');
  await capture('workspace-light');
  await setLanguage(window, 'zh-CN');
  assert.equal(await evaluate(`document.querySelector('.ia-composer textarea').value`), draft);
  await click('.ia-settings-button');
  await evaluate(`document.querySelector('.ia-settings-row button').click()`);
  await click('.ia-settings-title button');
  await wait(`Boolean(document.querySelector('.theme-dark'))`);
  await quality('workspace-dark-zh');
  await capture('workspace-dark-zh');
  window.setSize(1000, 720);
  await quality('workspace-compact');
  await click('.ia-settings-button');
  assert.equal(
    await evaluate(
      `(() => { const rect = document.querySelector('.ia-settings-popover').getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; })()`,
    ),
    true,
    'Settings must fit the compact window',
  );
  await capture('settings-compact');
  await click('.ia-settings-title button');
  await capture('workspace-compact');
  window.setSize(1000, 650);
  await quality('workspace-minimum');
  window.setSize(1250, 800);
  await quality('workspace-medium');
  window.setSize(1440, 900);
  await setLanguage(window, 'en');
  await click('.ia-chat-actions button[title="Hide workspace"]');
  await wait(`!document.querySelector('.ia-workspace')`);
  window.focus();
  window.webContents.focus();
  await evaluate(`(() => {
    const node = document.querySelector('.ia-composer textarea');
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  })()`);
  assert.equal(
    await evaluate(`getComputedStyle(document.querySelector('.ia-composer')).outlineStyle`),
    'solid',
    'The focused input must have a visible focus indicator',
  );
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['shift'] });
  window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: ['shift'] });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['shift'] });
  await wait(
    `document.querySelector('.ia-composer textarea').value === ${JSON.stringify(draft + '\n')}`,
  );
  await input('.ia-composer textarea', draft);
  await quality('chat-dark');
  await capture('chat-dark');
  assert.equal(await evaluate(`document.querySelector('.ia-composer textarea').value`), draft);
  assert.equal(fs.readFileSync(path.join(project, 'sobel_filter.v'), 'utf8'), source);
  console.log(
    'UI selftest passed: builtin remote configuration states, project execution location, onboarding, source preview, themes, contrast, languages, compact layout, keyboard input, and draft retention.',
  );
}

module.exports = { prepare, run };
