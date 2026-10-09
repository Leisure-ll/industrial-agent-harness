const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function run(window, evidence) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`Resource settings timed out: ${script}`);
  }
  async function openGlobal() {
    await wait(`Boolean(document.querySelector('.ia-settings-button'))`);
    await evaluate(`document.querySelector('.ia-settings-button').click()`);
    await wait(
      `Array.from(document.querySelectorAll('.ia-settings-row')).some(row=>row.innerText.includes('MCP & Skills'))`,
    );
    await evaluate(
      `Array.from(document.querySelectorAll('.ia-settings-row')).find(row=>row.innerText.includes('MCP & Skills')).querySelector('button').click()`,
    );
    await wait(`Boolean(document.querySelector('.ia-capability'))`);
    await wait(`Boolean(document.querySelector('.ia-capability-nav button[title="Skills"]'))`);
    await evaluate(`document.querySelector('.ia-capability-nav button[title="Skills"]').click()`);
    await wait(
      `document.querySelectorAll('.ia-project-resources input[type="checkbox"]').length>=3`,
    );
  }
  async function closeGlobal() {
    await evaluate(`document.querySelector('.ia-capability-header button').click()`);
    await wait(`!document.querySelector('.ia-capability')`);
  }
  async function projectMode(mode) {
    await wait(
      `document.querySelector('.ia-project-resources [data-resource-id="chip.netlist.inspect"] select')&&!document.querySelector('.ia-project-resources [data-resource-id="chip.netlist.inspect"] select').disabled`,
    );
    await evaluate(
      `(() => {const select=document.querySelector('.ia-project-resources [data-resource-id="chip.netlist.inspect"] select');select.value='${mode}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await wait(
      `document.querySelector('.ia-project-resources [data-resource-id="chip.netlist.inspect"] select').value==='${mode}'&&!document.querySelector('.ia-project-resources [data-resource-id="chip.netlist.inspect"] select').disabled`,
    );
  }
  assert.equal(
    await evaluate(
      `document.querySelector('.ia-new-chat').closest('.ia-project-chats').dataset.projectId`,
    ),
    'log-test',
    'new chat belongs to the selected project',
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.ia-sidebar > .ia-new-chat').length`),
    0,
    'no global new-chat action',
  );
  await openGlobal();
  assert.ok(
    await evaluate(`document.querySelector('.ia-capability').innerText.includes('Chip Pack')`),
  );
  await evaluate(
    `document.querySelector('.ia-capability [data-resource-id="chip.netlist.inspect"] input[type="checkbox"]').click()`,
  );
  await wait(
    `window.viewerHost.resourceGet({}).then(state=>state.global.skills.includes('chip.netlist.inspect'))`,
  );
  fs.writeFileSync(
    path.join(evidence, 'global-resources.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await closeGlobal();
  await evaluate(`document.querySelector('.ia-project-list button.selected').click()`);
  await wait(
    `document.querySelector('.ia-project-resources [data-resource-id="chip.netlist.inspect"] select')?.value==='inherit'`,
  );
  await projectMode('enabled');
  assert.deepEqual(
    await evaluate(
      `window.viewerHost.projectBindings().then(state=>window.viewerHost.resourceGet({projectId:state.activeId})).then(state=>state.effective.skills.includes('chip.netlist.inspect')?[]:['chip.netlist.inspect'])`,
    ),
    ['chip.netlist.inspect'],
  );
  assert.equal(
    await evaluate(
      `window.viewerHost.resourceSet({projectId:'other-test',kind:'skill',id:'chip.netlist.inspect',mode:'enabled'}).then(()=>false,()=>true)`,
    ),
    true,
    'inactive project cannot mutate policy',
  );
  assert.equal(
    await evaluate(
      `window.viewerHost.resourceSet({kind:'mcp',id:'unknown',mode:'enabled'}).then(()=>false,()=>true)`,
    ),
    true,
    'unregistered MCP cannot be added',
  );
  fs.writeFileSync(
    path.join(evidence, 'project-resources.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.ia-project-list button')).find(button=>button.innerText.includes('Other project')).click()`,
  );
  await wait(
    `document.querySelector('.ia-project-page h1')?.innerText==='Other project'&&document.querySelector('.ia-project-resources [data-resource-id="chip.netlist.inspect"] select')?.value==='inherit'`,
  );
  assert.deepEqual(
    await evaluate(
      `window.viewerHost.projectBindings().then(state=>window.viewerHost.resourceGet({projectId:state.activeId})).then(state=>state.effective.skills.includes('chip.netlist.inspect')?[]:['chip.netlist.inspect'])`,
    ),
    [],
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.ia-new-chat').closest('.ia-project-chats').dataset.projectId`,
    ),
    'other-test',
  );
  await evaluate(
    `Array.from(document.querySelectorAll('.ia-project-list button')).find(button=>button.innerText.includes('Agent log test')).click()`,
  );
  await wait(
    `document.querySelector('.ia-project-page h1')?.innerText==='Agent log test'&&document.querySelector('.ia-project-resources [data-resource-id="chip.netlist.inspect"] select')?.value==='enabled'`,
  );
  await projectMode('inherit');
  assert.deepEqual(
    await evaluate(
      `window.viewerHost.projectBindings().then(state=>window.viewerHost.resourceGet({projectId:state.activeId})).then(state=>state.effective.skills.includes('chip.netlist.inspect')?[]:['chip.netlist.inspect'])`,
    ),
    [],
  );
  await openGlobal();
  await evaluate(
    `document.querySelector('.ia-capability [data-resource-id="chip.netlist.inspect"] input[type="checkbox"]').click()`,
  );
  await wait(`window.viewerHost.resourceGet({}).then(state=>state.global.skills.length===0)`);
  await closeGlobal();
  // Returning from global settings remounts project controls to refresh inherited values.
  await wait(
    `document.querySelector('.ia-project-resources [data-resource-id="chip.netlist.inspect"] select')?.selectedOptions[0].text.toLowerCase().includes('enabled')`,
  );
  await projectMode('disabled');
  assert.deepEqual(
    await evaluate(
      `window.viewerHost.projectBindings().then(state=>window.viewerHost.resourceGet({projectId:state.activeId})).then(state=>state.effective.skills.includes('chip.netlist.inspect')?[]:['chip.netlist.inspect'])`,
    ),
    [],
  );
  await projectMode('inherit');
  await evaluate(`document.querySelector('.ia-project-start').click()`);
  await wait(`Boolean(document.querySelector('.ia-composer textarea'))`);
}
module.exports = { run };
