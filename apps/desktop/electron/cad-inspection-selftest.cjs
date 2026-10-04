const assert = require('node:assert/strict');
async function verifyInspection(window, project) {
  const fs = require('node:fs'),
    path = require('node:path'),
    crypto = require('node:crypto');
  const evaluate = s => window.webContents.executeJavaScript(s, true);
  const pause = () => new Promise(resolve => setTimeout(resolve, 160));
  const original = ['model.FCStd', 'model.step', 'model.brep', 'model.cad-sketches.json'].map(
    name =>
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(project, name)))
        .digest('hex'),
  );
  const set = async (label, value) => {
    await evaluate(
      `(()=>{const node=document.querySelector('[aria-label=${JSON.stringify(label)}]');node.value=${JSON.stringify(String(value))};node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
    );
    await pause();
  };
  const clear = async () => {
    await evaluate(`document.querySelector('.rp-cad-tools button').click()`);
    await pause();
  };
  // Exercise actual screen-coordinate OCCT picking through the production pointer handlers.
  const scan = async predicate =>
    evaluate(`(async()=>{
    const node=document.querySelector('.rp-cad-viewport'),r=node.getBoundingClientRect();
    let attempts=0;
    for(let y=12;y<r.height-12;y+=8) for(let x=12;x<r.width-12;x+=8){
      const p={pointerId:1,clientX:r.left+x,clientY:r.top+y,bubbles:true};
      node.dispatchEvent(new PointerEvent('pointerdown',p));node.dispatchEvent(new PointerEvent('pointerup',p));
      await new Promise(resolve=>setTimeout(resolve,2));
      const item=[...document.querySelectorAll('.rp-cad-measure-item')].at(-1);
      if(item && (${predicate})) return {x,y,...item.dataset};
      if(++attempts>6000)break;
    }
    throw Error('Could not pick expected geometry; '+document.querySelector('.rp-cad').innerText);
  })()`);
  await evaluate(`document.querySelector('button[aria-label="Fit viewer"]').click()`);
  await pause();
  await set('选择面或边', 4);
  const face = await scan('Number(item.dataset.area)>0');
  const areas = [200, 100, 800 - 4 * Math.PI, 20 * Math.PI];
  assert.ok(
    areas.some(a => Math.abs(a - Number(face.area)) < 1e-6),
    JSON.stringify(face),
  );
  await clear();
  await set('选择面或边', 2);
  const edge = await scan('Math.abs(Number(item.dataset.length)-40)<1e-6');
  assert.equal(edge.kind, 'edge');
  const circle = await scan('Math.abs(Number(item.dataset.radius)-2)<1e-6');
  await pause(); // The measurement overlay projects endpoints on the next animation frame.
  assert.ok(Math.abs(Number(circle.length) - 4 * Math.PI) < 1e-6);
  const distance = await evaluate(
    `Number(document.querySelector('.rp-cad-distance').dataset.distance)`,
  );
  assert.ok(
    [8, Math.sqrt(89)].some(v => Math.abs(v - distance) < 1e-6),
    String(distance),
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.rp-cad-measure-overlay circle').length`),
    2,
  );
  const selected = await evaluate(`document.querySelector('.rp-cad').dataset.selected`);
  await evaluate(`document.querySelector('button[aria-label="Fullscreen viewer"]').click()`);
  // DOM fullscreen precedes the native macOS entrance animation. Exiting during
  // that animation is rejected by Electron, so wait before exercising exit.
  await new Promise(resolve => setTimeout(resolve, 2000));
  assert.equal(await evaluate(`document.querySelector('.rp-cad').dataset.selected`), selected);
  // Esc is already exercised by cad-selftest; use the other shared exit path
  // here so background packaged runs do not depend on native keyboard focus.
  await evaluate(`document.querySelector('button[aria-label="Exit viewer fullscreen"]').click()`);
  // macOS native fullscreen finishes its window transition after the DOM exits.
  // Capture and project dimensions only after both layouts have settled.
  const exitDeadline = Date.now() + 25000;
  while (await evaluate(`Boolean(document.fullscreenElement)`)) {
    if (Date.now() > exitDeadline)
      throw Error(
        'Fullscreen exit did not finish: ' +
          (await evaluate(`document.body.innerText.slice(-1000)`)),
      );
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(await evaluate(`Boolean(document.fullscreenElement)`), false);
  assert.equal(
    await evaluate(
      `(()=>{const host=document.querySelector('.rp-cad-viewport').getBoundingClientRect(),canvas=document.querySelector('.rp-cad canvas').getBoundingClientRect();return Math.abs(host.width-canvas.width)<1;})()`,
    ),
    true,
  );
  assert.equal(
    await evaluate(`Number(document.querySelector('.rp-cad-distance').dataset.distance)`),
    distance,
  );
  fs.writeFileSync(
    path.join(project, 'cad-measurement.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await clear();
  await set('选择面或边', 0);
  await evaluate(`document.querySelector('input[aria-label="剖切"]').click()`);
  await pause();
  await set('剖切位置', 25);
  const capture = async () =>
    window.webContents.capturePage(
      await evaluate(
        `(()=>{const r=document.querySelector('.rp-cad-viewport').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};})()`,
      ),
    );
  const section = (await capture()).toPNG();
  await evaluate(`document.querySelector('.rp-cad-tools button[aria-pressed]').click()`);
  await pause();
  assert.notDeepEqual(
    (await capture()).toPNG(),
    section,
    'reversing the section must change model pixels',
  );
  await set('剖切轴', 2);
  await set('剖切位置', 50);
  fs.writeFileSync(
    path.join(project, 'cad-section.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await evaluate(`document.querySelector('.rp-cad-tabs button:last-child').click()`);
  await pause();
  assert.equal(await evaluate(`document.querySelectorAll('.rp-cad-sketch-geometry').length`), 4);
  assert.equal(
    await evaluate(`document.querySelectorAll('.rp-cad-constraints button').length`),
    11,
  );
  assert.match(await evaluate(`document.querySelector('.rp-cad-valid').textContent`), /完全约束/);
  assert.match(
    await evaluate(`document.querySelector('.rp-cad-sketch-canvas svg').textContent`),
    /40 mm/,
  );
  await evaluate(
    `document.querySelector('.rp-cad-constraints button[data-constraint-index="9"]').click()`,
  );
  await pause();
  assert.equal(
    await evaluate(
      `document.querySelector('.rp-cad-sketch-geometry.selected').dataset.geometryIndex`,
    ),
    '0',
  );
  const { verifyNavigation, verifyWheel } = require('./navigation-selftest.cjs');
  const measure = () =>
    evaluate(`Number(document.querySelector('.rp-cad-sketch-body').dataset.sketchZoom)`);
  await verifyNavigation(window, measure);
  await verifyWheel(window, measure, (delta, ctrl) =>
    evaluate(
      `(()=>{const e=new WheelEvent('wheel',{deltaY:${delta},ctrlKey:${ctrl},cancelable:true});document.querySelector('.rp-cad-sketch-canvas').dispatchEvent(e);return e.defaultPrevented;})()`,
    ),
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.rp-cad-constraints button[aria-pressed="true"]').dataset.constraintIndex`,
    ),
    '9',
  );
  fs.writeFileSync(
    path.join(project, 'cad-sketch.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
  await evaluate(`document.querySelector('.rp-cad-tabs button:first-child').click()`);
  await pause();
  assert.equal(await evaluate(`document.querySelector('input[aria-label="剖切"]').checked`), true);
  await evaluate(`document.querySelector('input[aria-label="剖切"]').click()`);
  await pause();
  const final = ['model.FCStd', 'model.step', 'model.brep', 'model.cad-sketches.json'].map(name =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(project, name)))
      .digest('hex'),
  );
  assert.deepEqual(
    final,
    original,
    'Viewer inspection cannot alter model or native sketch artifacts',
  );
  console.log(
    'OCCT face/edge picking, 40 mm edge, Ø4 mm circle, analytic distance, capped sections, native constraints and shared navigation passed',
  );
}
module.exports = { verifyInspection };
