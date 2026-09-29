const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {startModel} = require('../../../tests/integration/fixtures/domain-mcp-model.cjs');
const {saveBindings} = require('./project-bindings.cjs');
const {saveProfile, defaults} = require('./model-config.cjs');
let fixture, directory, evidence;
async function prepare(config, modelDirectory) {
  fixture = await startModel(); evidence = path.dirname(config);
  directory = path.join(config, 'mcp-project'); fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(directory, 'eda.yaml'), 'name: mcp-test\ntop: top\nruntime:\n  kind: local\ninputs: {}\nactions: {}\nrequired_verification: []\n');
  saveBindings(config, {activeId: 'mcp-chip', projects: [{id: 'mcp-chip', name: 'Chip MCP test', path: fs.realpathSync(directory), domain: 'chip'}]});
  saveProfile(modelDirectory, {...defaults, provider: 'openai_legacy', endpoint: fixture.endpoint, model: 'controlled-mcp', thinking: false});
}
async function run(window) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script) {const deadline = Date.now() + 30000; while (Date.now() < deadline) {if (await evaluate(script)) return; await new Promise(resolve => setTimeout(resolve, 100));} throw Error(`MCP UI timed out: ${script}\n${await evaluate('document.body.innerText')}`);}
  try {
    await wait(`Boolean(document.querySelector('.ia-project-row'))`);
    assert.equal(await evaluate(`window.viewerHost.resourceGet({projectId:'mcp-chip'}).then(state=>state.catalog.mcpServers[0].id)`), 'chip-pack.eda');
    await evaluate(`document.querySelector('.ia-project-row').click()`);
    await wait(`document.querySelector('.ia-project-resources')?.innerText.includes('Chip Pack')`);
    await evaluate(`window.viewerHost.resourceSet({projectId:'mcp-chip',kind:'mcp',id:'chip-pack.eda',mode:'disabled'})`);
    assert.deepEqual(await evaluate(`window.viewerHost.resolve({task:'create_goal for MCP integration'}).then(result=>result.scope.tools)`), []);
    await evaluate(`window.viewerHost.resourceSet({projectId:'mcp-chip',kind:'mcp',id:'chip-pack.eda',mode:'inherit'})`);
    await evaluate(`document.querySelector('.ia-project-start').click()`);
    await wait(`Boolean(document.querySelector('.ia-composer textarea'))`);
    await evaluate(`(() => {const area=document.querySelector('.ia-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,'create_goal for MCP integration');area.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(`document.querySelector('.ia-send').click()`);
    // Every MCP invocation goes through the real pinned Kimi approval path.
    for (let index = 0; index < 3; index++) {
      await wait(`Boolean(document.querySelector('.ia-approval button'))`);
      await evaluate(`document.querySelector('.ia-approval button').click()`);
      await wait(`!document.querySelector('.ia-approval')`);
    }
    await wait(`document.querySelector('.ia-agent-flow')?.innerText.includes('MCP_CONTEXT_CONFIRMED')&&!document.querySelector('button[title="Stop agent"]')`);
    assert.ok(JSON.stringify(fixture.requests.at(-1).messages).includes('MCP_INTEGRATION_GOAL'));
    assert.ok(fs.existsSync(path.join(directory, '.eda')));
    fs.writeFileSync(path.join(evidence, 'chip-pack-mcp.png'), (await window.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ok: true, provider: 'chip-pack.eda', desktop: true, pinnedKimi: true, approvals: 3, persistedContext: true, screenshot: path.join(evidence, 'chip-pack-mcp.png')}));
  } finally {fixture.close();}
}
module.exports = {prepare, run};
