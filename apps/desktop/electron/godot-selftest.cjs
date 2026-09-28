const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {saveBindings} = require('./project-bindings.cjs');
let configDirectory;
function prepare(config) {
  configDirectory = config;
  const project = fs.realpathSync(path.resolve(__dirname, '../../../examples/godot-viewer'));
  if (!fs.existsSync(path.join(project, 'build/playground.html'))) throw Error('Run node examples/godot-viewer/export.cjs before the Godot desktop selftest.');
  saveBindings(config, {activeId: 'godot-test', projects: [{id: 'godot-test', name: 'Godot example', path: project, domain: 'godot'}]});
}
async function run(window) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function waitFor(script) {
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Godot desktop condition timed out: ${script}`);
  }
  const requests = [];
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    requests.push(details.url);
    callback({cancel: /^https?:/.test(details.url)});
  });
  try {
    await waitFor(`document.querySelector('.ia-domain-pill')?.innerText.includes('Godot')`);
    await evaluate(`document.querySelector('.ia-chat-actions button:last-child').click()`);
    await waitFor(`Boolean(document.querySelector('.ia-file-tree-toggle'))`);
    await evaluate(`document.querySelector('.ia-file-tree-toggle').click()`);
    await waitFor(`Boolean(document.querySelector('.ia-file-list button[title="build/playground.html"]'))`);
    await evaluate(`document.querySelector('.ia-file-list button[title="build/playground.html"]').click()`);
    await waitFor(`document.querySelector('.rp-godot-toolbar strong')?.innerText.includes('ViewerPlayground') && !document.querySelector('button[aria-label="Pause"]')?.disabled`);
    const frame = window.webContents.mainFrame.frames.find(item => item.url.startsWith('app://godot/'));
    assert.ok(frame, 'actual Godot Web runtime frame');
    assert.ok(await frame.executeJavaScript(`Boolean(document.querySelector('canvas')?.width > 100)`));
    await evaluate(`document.querySelector('button[aria-label="Pause"]').click()`);
    await waitFor(`document.querySelector('button[aria-label="Step frame"]')?.disabled === false`);
    const inspectRobot = `Array.from(document.querySelectorAll('.rp-godot-node')).find(node => node.innerText.startsWith('Robot')).click()`;
    await evaluate(inspectRobot);
    await waitFor(`document.querySelector('.rp-godot-inspect')?.innerText.includes('position')`);
    const position = `Array.from(document.querySelectorAll('.rp-godot-inspect dl > div')).find(node => node.querySelector('dt')?.innerText === 'position')?.querySelector('dd')?.innerText`;
    const paused = await evaluate(position);
    await new Promise(resolve => setTimeout(resolve, 300));
    await evaluate(inspectRobot);
    assert.equal(await evaluate(position), paused, 'pause freezes real scene node');
    await evaluate(`document.querySelector('button[aria-label="Step frame"]').click()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    await evaluate(inspectRobot);
    await waitFor(`${position} !== ${JSON.stringify(paused)}`);
    assert.equal(await evaluate(`document.querySelector('button[aria-label="Step frame"]').disabled`), false, 'single step leaves runtime paused');
    await evaluate(`(() => {const camera = document.querySelector('select[aria-label="Camera"]'); camera.value = Array.from(camera.options).find(option => option.text === 'MainCamera').value; camera.dispatchEvent(new Event('change', {bubbles:true}));})()`);
    await evaluate(`document.querySelector('button[aria-label="Fullscreen viewer"]').click()`);
    await waitFor(`Boolean(document.fullscreenElement?.classList.contains('ia-workspace'))`);
    await evaluate(`document.querySelector('button[aria-label="Exit viewer fullscreen"]').click()`);
    await waitFor(`!document.fullscreenElement`);
    fs.writeFileSync(path.join(configDirectory, 'godot-runtime.png'), (await window.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('button[aria-label="Stop"]').click()`);
    await waitFor(`Array.from(document.querySelectorAll('.rp-godot-node')).some(node => node.innerText.startsWith('Robot') && !node.disabled) && !document.querySelector('.rp-godot-inspect')`);
    await evaluate(inspectRobot);
    await waitFor(`(() => {const point = (${position})?.match(/-?[0-9.]+/g)?.map(Number); return point?.[0] === 480 && point?.[1] === 320;})()`);
    assert.equal(await evaluate(`document.querySelector('button[aria-label="Step frame"]').disabled`), false, 'stop reloads the scene paused');
    await evaluate(`document.querySelector('button[aria-label="Play"]').click()`);
    await waitFor(`document.querySelector('button[aria-label="Step frame"]').disabled`);
    for (const [file, kind] of [['robot.png', 'IMAGE'], ['robot.sprite.json', 'SPRITE'], ['playground.tscn', 'ANIMATION']]) {
      await evaluate(`document.querySelector('.ia-file-list button[title="${file}"]').click()`);
      await waitFor(`document.querySelector('.ia-viewer-footer')?.innerText.includes('${kind} · Ready')`);
      if (kind !== 'IMAGE') assert.ok(await evaluate(`document.body.innerText.includes('idle') || document.body.innerText.includes('run')`));
    }
    assert.ok(!requests.some(url => /^https?:/.test(url)), requests.join('\n'));
    console.log(JSON.stringify({ok: true, runtime: 'real Godot Web export', pause: true, step: true, stop: true, camera: true, fullscreen: true, assets: 3, externalRequests: 0, screenshot: path.join(configDirectory, 'godot-runtime.png')}));
  } catch (error) {
    fs.writeFileSync(path.join(configDirectory, 'godot-failure.png'), (await window.webContents.capturePage()).toPNG());
    console.error('Godot selftest evidence:', configDirectory);
    throw error;
  } finally {window.webContents.session.webRequest.onBeforeRequest(null);}
}
module.exports = {prepare, run};
