const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function verifyResize(window, project) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  const pause = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms));
  const layout = () =>
    evaluate(`(()=>{
    const chat=document.querySelector('.ia-chat'), workspace=document.querySelector('.ia-workspace'), columns=document.querySelector('.ia-columns');
    return {chat:chat.getBoundingClientRect().width,workspace:workspace.getBoundingClientRect().width,
      minChat:parseFloat(getComputedStyle(chat).minWidth),minWorkspace:parseFloat(getComputedStyle(workspace).minWidth),overflow:columns.scrollWidth-columns.clientWidth};
  })()`);
  const capture = async () =>
    window.webContents.capturePage(
      await evaluate(`(()=>{
    const r=document.querySelector('.rp-cad-viewport').getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};
  })()`),
    );
  const modelRatio = image => {
    const { width, height } = image.getSize();
    const pixels = image.toBitmap();
    assert.equal(pixels.length, width * height * 4);
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1,
      count = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4,
          low = Math.min(pixels[i], pixels[i + 2]),
          high = Math.max(pixels[i], pixels[i + 2]),
          green = pixels[i + 1];
        // OCCT blue solid pixels, excluding the gradient and green annotations.
        if (green > 130 && green > low + 25 && high > green + 5 && high > low + 40) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          count++;
        }
      }
    assert.ok(count > 500, 'The actual rendered solid must be visible.');
    assert.ok(
      minX > 1 && minY > 1 && maxX < width - 2 && maxY < height - 2,
      'The reference solid must not be cropped.',
    );
    return (maxX - minX + 1) / (maxY - minY + 1);
  };
  const sameShape = (image, ratio, context) => {
    const actual = modelRatio(image);
    assert.ok(
      Math.abs(actual / ratio - 1) < 0.02,
      `${context} stretched the solid: ${ratio} → ${actual}`,
    );
  };
  async function drag(before, ratio, context) {
    await evaluate(`(()=>{
    const node=document.querySelector('[aria-label="Resize chat and workspace"]'),r=node.getBoundingClientRect();
    const p={pointerId:42,button:0,clientX:r.left+r.width/2,clientY:r.top+80,bubbles:true};
    node.dispatchEvent(new PointerEvent('pointerdown',p));
    node.dispatchEvent(new PointerEvent('pointermove',{...p,clientX:p.clientX-180}));
    node.dispatchEvent(new PointerEvent('pointerup',{...p,clientX:p.clientX-180}));
  })()`);
    await pause();
    const wider = await layout();
    // Hosted macOS desktops can clamp the initial window below 1440 px. The
    // divider must stop at the chat minimum even when less than 180 px is free.
    const movement = Math.min(180, before.chat - before.minChat);
    assert.ok(movement > 2, `The drag must exercise available space: ${JSON.stringify(before)}`);
    assert.ok(
      Math.abs(wider.workspace - before.workspace - movement) < 2 &&
        Math.abs(before.chat - wider.chat - movement) < 2,
      JSON.stringify({ before, wider, movement }),
    );
    assert.ok(wider.chat >= wider.minChat - 1 && wider.overflow <= 1, JSON.stringify(wider));
    sameShape(await capture(), ratio, context);
    console.log('CAD divider drag:', JSON.stringify({ context, before, wider, movement }));
    return wider;
  }
  await evaluate(`document.querySelector('button[aria-label="Fit viewer"]').click()`);
  await pause();
  const before = await layout(),
    ratio = modelRatio(await capture());
  await drag(before, ratio, 'Dragging the workspace divider');
  const key = key =>
    evaluate(
      `document.querySelector('[aria-label="Resize chat and workspace"]').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}));`,
    );
  await key('Home');
  await pause();
  const expanded = await layout();
  assert.ok(Math.abs(expanded.chat - 280) < 2, JSON.stringify(expanded));
  const originalSize = window.getContentSize();
  try {
    window.setContentSize(1000, 800);
    await pause();
    const smaller = await layout();
    assert.ok(
      smaller.chat >= smaller.minChat - 1 &&
        smaller.workspace >= smaller.minWorkspace - 1 &&
        smaller.overflow <= 1,
      JSON.stringify(smaller),
    );
    await evaluate(
      `document.querySelector('[aria-label="Resize chat and workspace"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));`,
    );
    await pause();
    await evaluate(`document.querySelector('button[aria-label="Fit viewer"]').click()`);
    await pause();
    const narrow = await layout();
    assert.ok(narrow.chat - narrow.minChat < 180, 'The narrow case must exercise the drag limit.');
    const limited = await drag(narrow, modelRatio(await capture()), 'Dragging in a narrow window');
    assert.ok(Math.abs(limited.chat - limited.minChat) < 2, JSON.stringify(limited));
  } finally {
    window.setContentSize(...originalSize);
  }
  await pause();
  await key('End');
  await pause();
  const minimum = await layout();
  assert.ok(Math.abs(minimum.workspace - minimum.minWorkspace) < 2, JSON.stringify(minimum));
  await evaluate(
    `document.querySelector('[aria-label="Resize chat and workspace"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));`,
  );
  await pause();
  assert.ok(
    Math.abs((await layout()).workspace - before.workspace) < 2,
    'Double-click must restore the default split.',
  );
  await evaluate(`document.querySelector('button[aria-label="Fit viewer"]').click()`);
  await pause();
  const fitted = await capture(),
    fittedRatio = modelRatio(fitted),
    restoredWidth = (await layout()).workspace;
  await evaluate(`document.querySelector('button[aria-label="Fullscreen viewer"]').click()`);
  await pause(2000);
  assert.equal(await evaluate(`Boolean(document.fullscreenElement)`), true);
  const fullscreen = await capture();
  sameShape(fullscreen, fittedRatio, 'Entering fullscreen');
  fs.writeFileSync(path.join(project, 'cad-resize-before.png'), fitted.toPNG());
  fs.writeFileSync(path.join(project, 'cad-resize-fullscreen.png'), fullscreen.toPNG());
  await evaluate(`document.querySelector('button[aria-label="Exit viewer fullscreen"]').click()`);
  const deadline = Date.now() + 25000;
  while (await evaluate(`Boolean(document.fullscreenElement)`)) {
    if (Date.now() > deadline) throw Error('Fullscreen exit did not finish.');
    await pause(100);
  }
  await pause(1000);
  sameShape(await capture(), fittedRatio, 'Exiting fullscreen');
  assert.ok(
    Math.abs((await layout()).workspace - restoredWidth) < 2,
    'Fullscreen must retain the split width.',
  );
  console.log(
    'CAD pixel proportions survive divider drag and fullscreen; 280 px chat, window shrink, keyboard limits and split reset passed',
  );
}
module.exports = { verifyResize };
