const assert = require('node:assert/strict');
const fs = require('node:fs');

async function viewportRect(window) {
  return window.webContents.executeJavaScript(
    `
    (() => {
      const r = document.querySelector('.ia-file-view:not([hidden])')?.querySelector('.rp-cad-viewport').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.floor(r.width), height: Math.floor(r.height) };
    })()
  `,
    true,
  );
}

async function captureSettled(window, { rect, output } = {}) {
  // React state, OCCT pose/resize and Chromium composition finish on separate
  // frames. Inspect actual settled pixels after allowing queued pose frames.
  await window.webContents.executeJavaScript(
    `new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(Error('CAD render frames did not arrive within 5 seconds.')),5000);
      requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));
    })`,
    true,
  );
  let image,
    previous,
    stable = 0;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    image = await window.webContents.capturePage(rect);
    const pixels = image.toBitmap();
    stable = previous?.equals(pixels) ? stable + 1 : 0;
    previous = pixels;
    if (stable >= 2) break;
  }
  // Retain the last frame on failure too.
  if (output) fs.writeFileSync(output, image.toPNG());
  assert.ok(stable >= 2, 'CAD screenshot did not settle within 5 seconds.');
  return image;
}

module.exports = { viewportRect, captureSettled };
