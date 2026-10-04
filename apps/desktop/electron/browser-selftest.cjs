const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { saveBindings } = require('./project-bindings.cjs');
const { verifyNavigation } = require('./navigation-selftest.cjs');
let directory;
let originals;
function prepare(config) {
  directory = path.join(config, 'browser-project');
  fs.mkdirSync(directory, { recursive: true });
  directory = fs.realpathSync(directory);
  originals = {
    'index.html':
      '<!doctype html><html><head><title>Project preview</title><link rel="stylesheet" href="style.css"></head><body><h1>Industrial Harness Browser</h1><p id="ready">Starting</p><input id="draft" value="keep me"><button id="counter" onclick="this.textContent=String(Number(this.textContent)+1)">0</button><script src="app.js"></script></body></html>',
    'app.js': 'document.querySelector("#ready").textContent="Local scripts loaded";',
    'style.css':
      'body{font-family:system-ui;background:#edf3fa;color:#16324e;margin:32px}h1{font-size:28px}input,button{padding:10px;margin:8px}',
    'notes.txt': 'Source file',
  };
  for (const [file, contents] of Object.entries(originals))
    fs.writeFileSync(path.join(directory, file), contents);
  const other = path.join(config, 'other-browser-project');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'other.html'), '<h1>Other project</h1>');
  saveBindings(config, {
    activeId: 'browser-a',
    projects: [
      { id: 'browser-a', path: directory, name: 'Browser project', domain: 'chip' },
      { id: 'browser-b', path: fs.realpathSync(other), name: 'Other project', domain: 'chip' },
    ],
  });
}
async function run(window, manager) {
  const bounded = async (promise, label) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  window.show();
  window.focus();
  const evaluate = script =>
    bounded(window.webContents.executeJavaScript(script, true), `host script: ${script}`);
  const wait = async (check, label = 'browser state') => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw Error(`Timed out: ${label}`);
  };
  const click = label =>
    evaluate(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
  const state = () => manager.state('browser-a');
  const active = () => manager.projects.get('browser-a')?.tabs.get(state().activeId);
  const page = script =>
    bounded(active().view.webContents.executeJavaScript(script, true), `page script: ${script}`);
  let visits = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/slow') return;
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: 'file:///etc/passwd' });
      response.end();
      return;
    }
    visits += 1;
    response.setHeader('Content-Type', 'text/html');
    response.end(
      `<!doctype html><title>${request.url === '/two' ? 'Second page' : 'Local development'}</title><style>body{font:18px system-ui;padding:32px;background:#f7f9fc;color:#16324e}</style><h1>${request.url === '/two' ? 'Second page' : 'Local development server'}</h1><a id="next" href="/two">Next page</a><a id="popup" href="/two" target="_blank">Open new tab</a><input id="draft" value="web draft">`,
    );
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const checks = [];
  try {
    await wait(
      () => evaluate(`Boolean(document.querySelector('button[aria-label="Open browser"]'))`),
      'app ready',
    );
    await evaluate(`document.querySelector('button[title="Show workspace"]').click()`);
    await evaluate(`document.querySelector('button[title="Show file tree"]').click()`);
    await wait(() => evaluate(`Boolean(document.querySelector('button[title="index.html"]'))`));
    await evaluate(`document.querySelector('button[title="index.html"]').click()`);
    await wait(() =>
      Boolean(
        manager.attached &&
          active()?.view.webContents.getTitle() === 'Project preview' &&
          !active().loading,
      ),
    );
    assert.equal(
      await page(`document.querySelector('#ready').textContent`),
      'Local scripts loaded',
    );
    assert.equal(
      await page(`JSON.stringify([typeof require,typeof process,typeof window.viewerHost])`),
      '["undefined","undefined","undefined"]',
    );
    assert.equal(
      await evaluate(`window.viewerHost.readProjectFile('index.html').then(file=>file.viewer)`),
      'browser',
    );
    checks.push('Project file tree → Registry → native HTML + CSS + JS');
    const native = active().view.webContents;
    await page(
      `document.querySelector('#draft').value='Retained form state';document.querySelector('#counter').click()`,
    );
    await verifyNavigation(window, () => native.getZoomFactor());
    assert.equal(await page(`document.querySelector('#draft').value`), 'Retained form state');
    assert.equal(await page(`document.querySelector('#counter').textContent`), '1');
    assert.equal(active().view.webContents, native);
    // Chromium Ctrl+wheel routes through zoom-changed; pinch uses visual zoom.
    native.sendInputEvent({
      type: 'mouseWheel',
      x: 50,
      y: 50,
      deltaY: 120,
      deltaX: 0,
      modifiers: ['control'],
      canScroll: true,
    });
    await wait(() => native.getZoomFactor() !== 1, 'Ctrl+wheel zoom');
    await click('Fit viewer');
    native.debugger.attach('1.3');
    try {
      await bounded(
        native.debugger.sendCommand('Input.synthesizePinchGesture', {
          x: 120,
          y: 120,
          scaleFactor: 1.5,
          gestureSourceType: 'touch',
        }),
        'native pinch gesture',
      );
      await wait(
        async () => (await page('window.visualViewport.scale')) > 1.01,
        'native pinch zoom',
      );
      await click('Fit viewer');
      await wait(
        async () => (await page('window.visualViewport.scale')) === 1,
        'Fit resets pinch zoom',
      );
    } finally {
      native.debugger.detach();
    }
    checks.push('Toolbar zoom, Ctrl+wheel, native pinch, Fit, fullscreen and form state retention');
    await evaluate(`document.querySelector('button[title="Hide file tree"]').click()`);
    await wait(() => manager.attached && manager.attached.getBounds().width > 400);
    assert.ok(manager.attached.getBounds().height > 300, 'Browser fills the workspace canvas');
    await evaluate(`document.querySelector('.ia-settings-button').click()`);
    await wait(() => !manager.attached, 'settings popover hides native surface');
    await evaluate(
      `Array.from(document.querySelectorAll('.ia-settings-row')).find(row=>row.textContent.includes('Model API')).querySelector('button').click()`,
    );
    await wait(() =>
      evaluate(`Boolean(document.querySelector('[aria-label="Model API settings"]'))`),
    );
    assert.equal(manager.attached, null, 'settings modal is not covered by the browser');
    await click('Close settings');
    await wait(() => manager.attached);
    checks.push('Browser fills canvas and detaches beneath settings overlays');
    if (process.env.HARNESS_BROWSER_SELFTEST_OUTPUT) {
      fs.mkdirSync(process.env.HARNESS_BROWSER_SELFTEST_OUTPUT, { recursive: true });
      const shot = await window.capturePage();
      fs.writeFileSync(
        path.join(process.env.HARNESS_BROWSER_SELFTEST_OUTPUT, 'browser-project-preview.png'),
        shot.toPNG(),
      );
      fs.writeFileSync(
        path.join(process.env.HARNESS_BROWSER_SELFTEST_OUTPUT, 'browser-page.png'),
        (await native.capturePage()).toPNG(),
      );
    }
    await evaluate(
      `document.querySelector('.ia-workspace button[title="Hide workspace"]').click()`,
    );
    await wait(() => !manager.attached, 'hide workspace detaches native view');
    await evaluate(`document.querySelector('button[title="Show workspace"]').click()`);
    await wait(() => manager.attached);
    assert.equal(await page(`document.querySelector('#draft').value`), 'Retained form state');
    await evaluate(`document.querySelector('button[title="Show file tree"]').click()`);
    await evaluate(`document.querySelector('button[title="notes.txt"]').click()`);
    await wait(() => !manager.attached);
    await click('Open browser');
    await wait(() => manager.attached);
    checks.push('Hide/reopen, source file switch and shared browser tabs');

    await evaluate(
      `(() => {const input=document.querySelector('input[aria-label="Browser address"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(url)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await evaluate(`document.querySelector('.rp-browser-toolbar').requestSubmit()`);
    await wait(() => active().url === url && !active().loading && !active().error);
    assert.equal(
      await page(`document.querySelector('h1').textContent`),
      'Local development server',
    );
    await page(`document.querySelector('#next').click()`);
    await wait(() => active().url.endsWith('/two') && !active().loading);
    await click('Browser back');
    await wait(() => active().url === url && !active().loading);
    await click('Browser forward');
    await wait(() => active().url.endsWith('/two') && !active().loading);
    const before = visits;
    await click('Reload page');
    await wait(() => visits > before && !active().loading);
    await page(`document.querySelector('#popup').click()`);
    await wait(() => state().tabs.length === 2 && !active().loading);
    assert.equal(state().tabs[1].title, 'Second page');
    await click('New browser tab');
    await wait(() => state().tabs.length === 3 && active().url === 'about:blank');
    await evaluate(`document.querySelector('button[aria-label="Close tab New tab"]').click()`);
    await wait(() => state().tabs.length === 2);
    checks.push(
      'Address entry, localhost, link navigation, back/forward, reload and tab open/close',
    );

    await evaluate(
      `window.viewerHost.browserCommand({projectId:'browser-a',tabId:${JSON.stringify(state().activeId)},action:'navigate',url:${JSON.stringify(url + 'slow')}})`,
    );
    await wait(() => active().loading);
    assert.equal(
      await evaluate(`document.querySelector('button[aria-label="Zoom in"]').disabled`),
      true,
    );
    await click('Stop loading page');
    await wait(() => !active().loading);
    await evaluate(
      `window.viewerHost.browserCommand({projectId:'browser-a',tabId:${JSON.stringify(state().activeId)},action:'navigate',url:'http://127.0.0.1:1/'})`,
    );
    await wait(() => Boolean(active().error));
    await wait(
      () =>
        !manager.attached &&
        evaluate(`Boolean(document.querySelector('.rp-browser-empty[role="alert"]'))`),
    );
    for (const address of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'app://viewer/index.html',
    ]) {
      assert.equal(
        await evaluate(
          `window.viewerHost.browserCommand({projectId:'browser-a',tabId:${JSON.stringify(state().activeId)},action:'navigate',url:${JSON.stringify(address)}}).then(()=>false,()=>true)`,
        ),
        true,
      );
    }
    checks.push('Stop loading, disabled zoom, load error UI and prohibited addresses');
    await evaluate(
      `window.viewerHost.browserOpen({projectId:'browser-a',url:${JSON.stringify(url)}})`,
    );
    await wait(() => !active().loading && manager.attached);
    await page(`document.cookie='browser_test=project_a;path=/'`);
    const retainedId = state().activeId;
    const lease = manager.presentation.ownerId;
    const bounds = manager.presentation.bounds;
    manager.present({ projectId: 'browser-a', ownerId: 'new-lease', bounds });
    manager.present({ projectId: 'browser-a', ownerId: lease, bounds: null });
    assert.ok(manager.attached, 'stale unmount cannot detach new view');
    await evaluate(`window.viewerHost.selectProject('browser-b')`);
    assert.equal(manager.attached, null);
    assert.throws(() => manager.state('browser-a'), /project/);
    const other = manager.open({ projectId: 'browser-b', url });
    await wait(() => !manager.projects.get('browser-b').tabs.get(other.activeId).loading);
    assert.equal(
      await manager.projects
        .get('browser-b')
        .tabs.get(other.activeId)
        .view.webContents.executeJavaScript('document.cookie'),
      '',
    );
    await evaluate(`window.viewerHost.selectProject('browser-a')`);
    assert.equal(state().activeId, retainedId);
    checks.push(
      'Project switch detaches view, cookies isolate projects, stale leases and tabs retain',
    );
    for (const [file, content] of Object.entries(originals))
      assert.equal(fs.readFileSync(path.join(directory, file), 'utf8'), content);
    fs.writeFileSync(path.join(directory, 'index.html'), 'changed');
    // The initial tab navigated away; its local capability still checks the original source hash.
    const localUrl = [...manager.files.previews.keys()].map(id =>
      manager.files.url(id, 'index.html'),
    )[0];
    assert.equal((await manager.files.handle({ url: localUrl }, 'browser-a')).status, 403);
    const contents = [...manager.projects.values()].flatMap(p =>
      [...p.tabs.values()].map(tab => tab.view.webContents),
    );
    manager.close();
    await wait(() => contents.every(wc => wc.isDestroyed()), 'native views closed');
    assert.ok(contents.every(wc => wc.isDestroyed()));
    checks.push('HTML hash invalidation, unchanged sources and native view shutdown');
    const report = { status: 'passed', platform: `${process.platform}-${process.arch}`, checks };
    if (process.env.HARNESS_BROWSER_SELFTEST_OUTPUT)
      fs.writeFileSync(
        path.join(process.env.HARNESS_BROWSER_SELFTEST_OUTPUT, 'report.json'),
        JSON.stringify(report, null, 2),
      );
    console.log(JSON.stringify(report));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { prepare, run };
