const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

// Issue #70: model and project state mutated through IPC without any React
// component callback (the CDP-driven path) left the renderer's mount-time
// snapshots stale until a manual page reload. The main process now broadcasts
// model:changed / projects:changed and the renderer re-pulls on receipt (and
// on window focus). This selftest drives the exact non-UI path: it invokes the
// preload API directly from evaluate, bypassing every component save handler.
async function run(window) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script, label) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw Error(`Model sync selftest timed out: ${label ?? script}`);
  }
  const composerStatus = `document.querySelector('.ia-composer-hint [role="status"]')?.textContent`;
  await wait(`Boolean(${composerStatus})`, 'composer hint rendered');
  await wait(
    `${composerStatus} === 'Configure the Model API in Settings to run Kimi'`,
    'initial unconfigured hint',
  );

  // Save a model profile plus API key through the preload API only — no
  // ModelSettings dialog, so no onSaved callback ever runs in React.
  const saved = await evaluate(
    `window.viewerHost.modelSave(${JSON.stringify({
      provider: 'kimi',
      endpoint: 'https://api.example.com/v1',
      model: 'selftest-model',
      contextSize: 262144,
      imageInput: false,
      apiKey: 'selftest-key',
    })}).then(() => window.viewerHost.modelGet())`,
  );
  assert.equal(saved.hasApiKey, true, 'main process reports the key immediately');
  // The broadcast must refresh agentStatus without a page reload.
  await wait(`${composerStatus} === 'Kimi ready'`, 'composer unblocked without reload');

  // Create a project through the preload API only; the sidebar list must show
  // it without a reload.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-model-sync-'));
  const created = await evaluate(
    `window.viewerHost.createProject(${JSON.stringify({
      directory,
      domain: 'chip',
      name: 'Sync Watch Fixture',
    })})`,
  );
  assert.ok(
    created.projects.some(item => item.name === 'Sync Watch Fixture'),
    'project:create returns the new binding',
  );
  await wait(
    `Array.from(document.querySelectorAll('.ia-project-row-name')).some(node => node.textContent === 'Sync Watch Fixture')`,
    'sidebar shows the externally created project',
  );
  await wait(
    `document.querySelector('.ia-project-row.selected .ia-project-row-name')?.textContent === 'Sync Watch Fixture'`,
    'externally created project is the active row',
  );

  // The reload regression check: after a real reload the same state must still
  // hold (broadcast fixes must not depend on the in-memory snapshot).
  window.webContents.reload();
  await wait(
    `Array.from(document.querySelectorAll('.ia-project-row-name')).some(node => node.textContent === 'Sync Watch Fixture')`,
    'project survives reload',
  );
  await wait(`${composerStatus} === 'Kimi ready'`, 'configured state survives reload');
  console.log(
    'Model sync selftest passed: non-UI model:save and project:create refresh the composer and sidebar without a reload.',
  );
}

module.exports = { run };
