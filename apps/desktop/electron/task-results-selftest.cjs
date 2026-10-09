const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { saveBindings } = require('./project-bindings.cjs');
const { saveProfile } = require('./model-config.cjs');
const { startResultsModel } = require('../../../tests/integration/fixtures/task-results-model.cjs');
const { verifyNavigation, verifyWheel } = require('./navigation-selftest.cjs');
let model;
async function prepare(config, modelDirectory) {
  const directory = path.join(config, 'result-project');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'manual.txt'), 'Manually selected file.');
  saveBindings(config, {
    activeId: 'result-project',
    projects: [
      {
        id: 'result-project',
        name: 'Task results',
        path: fs.realpathSync(directory),
        domain: 'cad',
      },
    ],
  });
  model = await startResultsModel();
  process.env.INDUSTRIAL_MODEL_API_KEY = 'controlled-result-selftest';
  saveProfile(modelDirectory, {
    provider: 'openai_legacy',
    endpoint: model.endpoint,
    model: 'controlled-results',
    contextSize: 131072,
    thinking: false,
  });
}
async function run(window) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script, timeout = 120000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      await evaluate(
        `(()=>{const card=[...document.querySelectorAll('.ia-approval')].find(card=>!card.classList.contains('ia-approval-resolved'));const button=card?.querySelector('button');if(button&&!button.disabled)button.click();})()`,
      );
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(
      'Result selftest timed out: ' +
        script +
        '; UI=' +
        (await evaluate('document.body.innerText.slice(-3500)')),
    );
  }
  await wait(`Boolean(document.querySelector('.ia-composer textarea'))`);
  await evaluate(
    `(()=>{const input=document.querySelector('.ia-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Create a FreeCAD plate, modify its width twice, then inspect the final model');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await new Promise(resolve => setTimeout(resolve, 100));
  await evaluate(`document.querySelector('.ia-send').click()`);
  await wait(
    `document.querySelector('.ia-task-results')?.textContent.includes('Results ready') && Number(document.querySelector('.ia-file-view:not([hidden]) .rp-cad canvas')?.dataset.renderedTriangles)>=12`,
  );
  assert.equal(await evaluate(`document.querySelectorAll('.ia-result-card').length`), 7);
  assert.equal(
    await evaluate(
      `document.querySelector('.ia-file-view:not([hidden]) .rp-cad canvas').dataset.geometry`,
    ),
    'brep',
  );
  const measure = () =>
    evaluate(`Number(document.querySelector('.ia-file-view:not([hidden]) .rp-cad').dataset.zoom)`);
  await verifyNavigation(window, measure);
  await verifyWheel(window, measure, (deltaY, ctrlKey) =>
    evaluate(
      `(()=>{const event=new WheelEvent('wheel',{deltaY:${deltaY},ctrlKey:${ctrlKey},cancelable:true});document.querySelector('.ia-file-view:not([hidden]) .rp-cad-viewport').dispatchEvent(event);return event.defaultPrevented;})()`,
    ),
  );
  console.log('Native cards, automatic preview and Viewer navigation passed.');
  // Opening a report during a later request must suppress its automatic model preview.
  await evaluate(
    `(()=>{const button=[...document.querySelectorAll('.ia-result-file')].find(button=>button.textContent==='readback.json');button?.click();})()`,
  );
  await wait(`Boolean(document.querySelector('.ia-file-view:not([hidden]) .rp-document'))`, 20000);
  await evaluate(
    `(()=>{const input=document.querySelector('.ia-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Repeat the FreeCAD build and continuous edits');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await new Promise(resolve => setTimeout(resolve, 100));
  await evaluate(`document.querySelector('.ia-send').click()`);
  await wait(`Boolean(document.querySelector('button[aria-label="Stop agent"]'))`);
  await evaluate(
    `[...document.querySelectorAll('.ia-result-file')].find(button=>button.textContent==='readback.json')?.click()`,
  );
  await wait(
    `document.querySelectorAll('.ia-result-card').length===14 && [...document.querySelectorAll('.ia-task-results')].at(-1)?.textContent.includes('Results ready')`,
  );
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.ia-file-view:not([hidden]) .rp-document'))`),
    true,
    'completion preserves the manually opened report',
  );
  console.log('Manual report focus preserved after the second native request.');
  await window.webContents.reload();
  await wait(`document.querySelectorAll('.ia-result-card').length===14`);
  assert.equal(
    await evaluate(`Boolean(document.querySelector('.ia-file-view:not([hidden]) .rp-cad canvas'))`),
    false,
    'history replay never opens a model',
  );
  await evaluate(
    `(()=>{const cards=[...document.querySelectorAll('.ia-result-card')];cards.filter(card=>card.textContent.includes('Modified model')).at(-1)?.querySelector('button')?.click();})()`,
  );
  await wait(
    `Number(document.querySelector('.ia-file-view:not([hidden]) .rp-cad canvas')?.dataset.renderedTriangles)>=12`,
  );
  console.log('History replay preserved cards without automatic opening.');
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  let image;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      image = await window.webContents.capturePage();
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  const output =
    process.env.HARNESS_RESULT_SCREENSHOT ||
    path.join(require('node:os').tmpdir(), 'task-results-66.png');
  fs.writeFileSync(output, image.toPNG());
  console.log(
    'Task result cards, automatic native preview, manual report entry, focus preservation, history replay and Viewer navigation passed:',
    output,
  );
  model.close();
}
module.exports = { prepare, run };
