const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function run(window, { manager, runtime }) {
  const reportDir = process.env.HARNESS_CAD_INSTALL_REPORT_DIR;
  if (!reportDir) throw Error('CAD install selftest requires an evidence directory.');
  fs.mkdirSync(reportDir, { recursive: true });
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script, timeout = 60000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(script)) return;
      const failure = await evaluate(
        `document.querySelector('.ia-domains-modal [role="alert"], .ia-capability-section > .ia-project-error[role="alert"]')?.textContent || ''`,
      );
      if (failure) throw Error('CAD preparation failed: ' + failure);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error(
      'CAD installation UI timed out: ' +
        script +
        '\n' +
        (await evaluate('document.body.innerText.slice(-5000)')),
    );
  }
  const before = await evaluate('window.viewerHost.domainStatus()');
  if (process.argv.includes('--cad-install-restart')) {
    assert.equal(before.installed.find(item => item.domain === 'cad')?.runtimeState, 'ready');
    assert.equal(
      await evaluate('window.viewerHost.projectBindings().then(state => state.projects.length)'),
      1,
    );
    assert.equal(runtime().listActions().length, 2);
    assert.equal(runtime().latestCheckpoint()?.state.status, 'verified');
    fs.writeFileSync(
      path.join(reportDir, 'restart.json'),
      JSON.stringify({ ready: true, projectRestored: true, actions: 2 }),
    );
    console.log('Packaged CAD restart: dependency, project and verified actions retained.');
    return;
  }
  assert.equal(before.installed.length, 0);
  // Optional CI/local cache is the exact official DMG, checked again by the
  // production manager. Neither app mounting nor native verification is mocked.
  const cacheFile = process.env.HARNESS_CAD_INSTALL_ARCHIVE;
  if (cacheFile) {
    const bundled = new (require('@industrial-agent-harness/pack-manager').PackManager)();
    const catalog = bundled.bundledCatalog(path.join(process.resourcesPath, 'bootstrap-packs'));
    const archive = fs.readFileSync(
      path.join(
        process.resourcesPath,
        'bootstrap-packs',
        catalog.packs.find(item => item.domain === 'cad').url,
      ),
    );
    const { bundle } = require('@industrial-agent-harness/pack-manager').decodeArchive(archive);
    const asset = bundle.runtimeAssets[0];
    const cache = path.join(manager.runtimeAssets.directory, 'cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.copyFileSync(cacheFile, path.join(cache, asset.sha256 + '.dmg'));
  }
  await evaluate(
    `(()=>{window.__cadInstallProgress=[]; window.viewerHost.onDomainProgress(progress=>window.__cadInstallProgress.push(progress));return true;})()`,
  );
  await wait(
    `Array.from(document.querySelectorAll('.ia-domain-install-row')).some(row=>row.textContent.includes('CAD'))`,
  );
  fs.writeFileSync(
    path.join(reportDir, 'first-run.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.ia-domain-install-row')).find(row=>row.textContent.includes('CAD')).querySelector('input').click()`,
  );
  await wait(`!document.querySelector('.ia-domains-primary').disabled`);
  await evaluate(`document.querySelector('.ia-domains-primary').click()`);
  await wait(
    `window.viewerHost.domainStatus().then(status=>status.installed.some(item=>item.domain==='cad' && item.runtimeState==='ready') && !document.querySelector('.ia-domains-modal'))`,
    20 * 60 * 1000,
  );
  const bundle = manager.list().find(item => item.domain === 'cad');
  const dependency = manager.runtimeAssets.status(bundle.runtimeAssets)[0];
  assert.equal(dependency.ready, true);
  assert.ok(dependency.executable.startsWith(manager.directory));
  const project = path.join(reportDir, 'project');
  fs.mkdirSync(project);
  await evaluate(
    `window.viewerHost.createProject(${JSON.stringify({ directory: project, domain: 'cad', name: 'CAD install acceptance' })})`,
  );
  const profile = {
    provider: 'openai_legacy',
    endpoint: process.env.HARNESS_CAD_INSTALL_MODEL_ENDPOINT,
    model: 'controlled-cad-install',
    contextSize: 32768,
    thinking: false,
    apiKey: 'local-cad-install-test-key',
  };
  await evaluate(`window.viewerHost.modelSave(${JSON.stringify(profile)})`);
  await window.reload();
  await wait(`Boolean(document.querySelector('.ia-project-row'))`);
  await evaluate(`document.querySelector('.ia-project-row').click()`);
  await wait(`Boolean(document.querySelector('.ia-project-start'))`);
  await evaluate(`document.querySelector('.ia-project-start').click()`);
  async function task(prompt, completed) {
    await wait(`Boolean(document.querySelector('.ia-composer textarea'))`);
    await evaluate(
      `(()=>{const area=document.querySelector('.ia-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,${JSON.stringify(prompt)});area.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await new Promise(resolve => setTimeout(resolve, 100));
    await evaluate(`document.querySelector('.ia-send').click()`);
    const end = Date.now() + 120000;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(document.querySelector('.ia-approval button'))`))
        await evaluate(`document.querySelector('.ia-approval button').click()`);
      if (
        runtime().listActions().length === completed &&
        (await evaluate(
          `!document.querySelector('button[title="Stop agent"]') && document.querySelector('.ia-agent-flow')?.textContent.includes('CAD_INSTALL_TASK_OK')`,
        ))
      )
        return;
      const error = await evaluate(`document.querySelector('.ia-flow-error')?.textContent || ''`);
      if (error) throw Error(error);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error(
      'Packaged native Kimi CAD task timed out: ' +
        (await evaluate('document.body.innerText.slice(-5000)')),
    );
  }
  await task(
    'CAD_INSTALL_BUILD: FreeCAD 建模一个 40×20×5 mm 底板，在 (10,10) 打半径 2 mm 的贯穿孔。',
    1,
  );
  await task('CAD_INSTALL_EDIT: 把宽度改成30，孔半径改为3；保留旧模型并验证新尺寸。', 2);
  const actions = runtime().listActions(),
    verifications = runtime().listVerifications();
  assert.deepEqual(actions.map(action => action.toolId).sort(), [
    'cad.freecad.build',
    'cad.freecad.edit',
  ]);
  assert.ok(verifications.every(item => item.status === 'passed'));
  const models = runtime()
    .list('artifact')
    .filter(item => item.kind === 'model.cad.fcstd');
  assert.equal(models.length, 2);
  const edited = models.find(
    item => item.actionId === actions.find(action => action.toolId === 'cad.freecad.edit').id,
  );
  const readback = runtime()
    .list('artifact')
    .find(item => item.kind === 'report.cad.readback' && item.actionId === edited.actionId);
  const geometry = JSON.parse(fs.readFileSync(path.join(project, readback.relativePath), 'utf8'));
  // Verification already compares analytic dimensions and independently reopened volume.
  assert.ok(
    Math.abs(
      actions.find(item => item.id === edited.actionId).verification.metrics.volume -
        (6000 - 45 * Math.PI),
    ) < 0.001,
  );
  // Companion hash keys contain original basenames. Open the original artifact
  // from the file tree, preserving its provenance and verification association.
  await evaluate(`document.querySelector('.ia-chat-actions button:last-child').click()`);
  await wait(`Boolean(document.querySelector('.ia-file-tree-toggle'))`);
  await evaluate(`document.querySelector('.ia-file-tree-toggle').click()`);
  const relative = edited.relativePath;
  // The shared artifact opener goes through the same registered Viewer path;
  // use the registered output entry instead of a detached display fixture.
  const segments = relative.split('/');
  for (let index = 0; index < segments.length - 1; index++) {
    const folder = segments.slice(0, index + 1).join('/');
    await wait(
      `Boolean(document.querySelector('.ia-file-list button[title=${JSON.stringify(folder)}]'))`,
    );
    const next = segments.slice(0, index + 2).join('/');
    if (
      !(await evaluate(
        `Boolean(document.querySelector('.ia-file-list button[title=${JSON.stringify(next)}]'))`,
      ))
    )
      await evaluate(
        `document.querySelector('.ia-file-list button[title=${JSON.stringify(folder)}]').click()`,
      );
  }
  await wait(
    `Boolean(document.querySelector('.ia-file-list button[title=${JSON.stringify(relative)}]'))`,
  );
  await evaluate(
    `document.querySelector('.ia-file-list button[title=${JSON.stringify(relative)}]').click()`,
  );
  await wait(
    `Number(document.querySelector('.ia-file-view:not([hidden])')?.querySelector('.rp-cad canvas')?.dataset.renderedTriangles)>20 && document.querySelector('.ia-file-view:not([hidden])')?.querySelector('.rp-cad canvas')?.dataset.geometry==='brep'`,
  );
  fs.writeFileSync(
    path.join(reportDir, 'cad-viewer.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  // A lost runtime executable must become repairable through the ordinary UI.
  fs.rmSync(dependency.executable);
  await evaluate(`document.querySelector('.ia-settings-button').click()`);
  await wait(`Boolean(document.querySelector('.ia-settings-row'))`);
  await evaluate(
    `Array.from(document.querySelectorAll('.ia-settings-row')).find(row=>row.textContent.includes('Domains')).querySelector('button').click()`,
  );
  await wait(
    `document.querySelector('.ia-pack-card .ia-pack-badge')?.textContent.includes('Needs preparation')`,
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.ia-pack-actions button')).find(node=>node.textContent.includes('Prepare / retry')).click()`,
  );
  await wait(
    `document.querySelector('.ia-pack-card .ia-pack-badge')?.textContent.includes('Ready to use') && !document.querySelector('.ia-domain-progress')`,
    10 * 60 * 1000,
  );
  fs.writeFileSync(
    path.join(reportDir, 'domain-ready.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  fs.writeFileSync(
    path.join(reportDir, 'acceptance.json'),
    JSON.stringify(
      {
        platform: `${process.platform}-${process.arch}`,
        packaged: true,
        dependency: { ...dependency, executable: path.relative(reportDir, dependency.executable) },
        actions: actions.map(item => ({ id: item.id, toolId: item.toolId, status: item.status })),
        verifications,
        checkpoint: runtime().latestCheckpoint(),
        readback: geometry,
        viewer: 'OCCT BREP',
        repaired: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Packaged CAD installation → native Kimi approvals → FreeCAD build/edit → independent readback → OCCT Viewer → repair passed:',
    reportDir,
  );
}
module.exports = { run };
