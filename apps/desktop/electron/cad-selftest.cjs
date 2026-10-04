const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { saveBindings } = require('./project-bindings.cjs');
const { verifyNavigation, verifyWheel } = require('./navigation-selftest.cjs');
const { createProjectRuntime } = require('@industrial-agent-harness/harness-core');
let project;
async function prepare(config) {
  project = path.join(config, 'cad-project');
  fs.mkdirSync(project, { recursive: true });
  const { runtime } = createProjectRuntime({ projectDir: project, domain: 'cad' });
  try {
    const state = await runtime.inspect();
    const out = await runtime.execute(
      {
        toolId: 'cad.freecad.build',
        inputs: {
          recipe: {
            features: [
              {
                id: 'Plate',
                op: 'sketch_pad',
                profile: 'rectangle',
                length: 40,
                width: 20,
                height: 5,
              },
              {
                id: 'Drilled',
                op: 'hole',
                base: 'Plate',
                radius: 2,
                height: 5,
                origin: [10, 10, 0],
              },
            ],
            result: 'Drilled',
          },
          expect: { volume: 4000 - 20 * Math.PI, solids: 1 },
        },
        expectedStateId: state.id,
      },
      {
        scope: {
          domain: 'cad',
          projectId: state.projectId,
          stateId: state.id,
          tools: ['cad.freecad.build'],
        },
        approval: true,
      },
    );
    assert.equal(out.verification.status, 'passed', JSON.stringify(out.action));
    for (const name of ['model.FCStd', 'model.step', 'model.stl', 'model.cad-preview.json']) {
      const file = out.artifacts.find(a => path.basename(a.relativePath) === name);
      fs.copyFileSync(path.join(project, file.relativePath), path.join(project, name));
    }
  } finally {
    runtime.close();
  }
  fs.writeFileSync(path.join(project, 'bad.stl'), 'invalid');
  saveBindings(config, {
    activeId: 'cad-selftest',
    projects: [
      {
        id: 'cad-selftest',
        name: 'FreeCAD project',
        path: fs.realpathSync(project),
        domain: 'cad',
      },
    ],
  });
}
async function run(window) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script) {
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      if (await evaluate(script)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('CAD selftest timed out: ' + script);
  }
  await wait(`document.querySelector('.ia-domain-pill')?.innerText.includes('CAD')`);
  await evaluate(`document.querySelector('.ia-chat-actions button:last-child').click()`);
  await wait(`Boolean(document.querySelector('.ia-file-tree-toggle'))`);
  await evaluate(`document.querySelector('.ia-file-tree-toggle').click()`);
  async function open(name) {
    await wait(
      `Boolean(document.querySelector('.ia-file-list button[title=${JSON.stringify(name)}]'))`,
    );
    await evaluate(
      `document.querySelector('.ia-file-list button[title=${JSON.stringify(name)}]').click()`,
    );
    await wait(
      `document.querySelector('.rp-cad strong')?.textContent===${JSON.stringify(name)} && Number(document.querySelector('.rp-cad canvas')?.dataset.renderedTriangles)>20 && document.querySelector('.ia-viewer-footer')?.innerText.includes('CAD · Ready')`,
    );
  }
  await open('model.FCStd');
  const measure = () => evaluate(`Number(document.querySelector('.rp-cad').dataset.zoom)`);
  await verifyNavigation(window, measure);
  await verifyWheel(window, measure, (delta, ctrl) =>
    evaluate(
      `(()=>{const event=new WheelEvent('wheel',{deltaY:${delta},ctrlKey:${ctrl},cancelable:true});document.querySelector('.rp-cad-viewport').dispatchEvent(event);return event.defaultPrevented;})()`,
    ),
  );
  const yaw = await evaluate(`document.querySelector('.rp-cad').dataset.yaw`);
  await evaluate(
    `(()=>{const node=document.querySelector('.rp-cad-viewport');node.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,clientX:100,clientY:100,bubbles:true}));node.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:145,clientY:120,bubbles:true}));node.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));})()`,
  );
  await wait(`document.querySelector('.rp-cad').dataset.yaw!==${JSON.stringify(yaw)}`);
  const rotated = await evaluate(`document.querySelector('.rp-cad').dataset.yaw`);
  await evaluate(
    `(()=>{const node=document.querySelector('.rp-cad-viewport');node.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,clientX:100,clientY:100,shiftKey:true,bubbles:true}));node.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:125,clientY:115,shiftKey:true,bubbles:true}));node.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));})()`,
  );
  await wait(
    `Number(document.querySelector('.rp-cad').dataset.panX)===25 && Number(document.querySelector('.rp-cad').dataset.panY)===15`,
  );
  await evaluate(`document.querySelector('button[aria-label="Fullscreen viewer"]').click()`);
  await wait(`Boolean(document.fullscreenElement)`);
  assert.equal(await evaluate(`document.querySelector('.rp-cad').dataset.yaw`), rotated);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait(`!document.fullscreenElement`);
  assert.equal(await evaluate(`document.querySelector('.rp-cad').dataset.yaw`), rotated);
  fs.writeFileSync(
    path.join(project, 'cad-viewer.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await open('model.step');
  await open('model.stl');
  await evaluate(`document.querySelector('.ia-file-list button[title="bad.stl"]').click()`);
  await wait(`document.body.innerText.includes('Unsupported STL encoding')`);
  assert.equal(
    await evaluate(
      `!document.querySelector('button[aria-label="Zoom in"]') || document.querySelector('button[aria-label="Zoom in"]').disabled`,
    ),
    true,
  );
  console.log(
    'FreeCAD native build → file tree → Registry → solid mesh → rotation/pan/zoom/wheel/Fit/fullscreen/Esc/failure passed:',
    project,
  );
}
module.exports = { prepare, run };
