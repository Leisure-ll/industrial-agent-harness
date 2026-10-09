const assert = require('node:assert/strict');
const fs = require('node:fs');

// DOM readiness does not prove that Chromium has
// presented that state, especially when a packaged test window is occluded.
async function captureSettled(
  window,
  { output, readyScript, timeoutMs = 7000, animated = false } = {},
) {
  const contents = window.webContents;
  const throttled = contents.getBackgroundThrottling();
  contents.setBackgroundThrottling(false);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  const checkReady = async () => {
    if (readyScript)
      assert.ok(await contents.executeJavaScript(readyScript, true), 'Screenshot state changed.');
  };
  let image;
  try {
    await checkReady();
    await contents.executeJavaScript(
      `new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Screenshot render frames did not arrive.')), ${timeoutMs});
        document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
          clearTimeout(timer); resolve();
        })));
      })`,
      true,
    );
    // Unlike a delay or two equal capturePage results, a presentation event
    // after explicit invalidation proves the compositor produced a new frame.
    let subscribed = false;
    let timer;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(Error('Screenshot compositor did not repaint.')),
          timeoutMs,
        );
        contents.beginFrameSubscription(false, presented => {
          if (!presented.isEmpty()) {
            image = presented;
            resolve();
          }
        });
        subscribed = true;
        contents.invalidate();
      });
    } finally {
      clearTimeout(timer);
      if (subscribed) contents.endFrameSubscription();
    }
    let previous;
    let stable = 0;
    let captures = 0;
    let transientErrors = 0;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        image = await contents.capturePage(undefined, { stayAwake: true });
      } catch (error) {
        if (++transientErrors > 2 || !String(error).includes('UnknownVizError')) throw error;
        contents.invalidate();
        continue;
      }
      assert.ok(!image.isEmpty(), 'Screenshot compositor returned an empty image.');
      captures++;
      const pixels = image.toBitmap();
      stable = previous?.equals(pixels) ? stable + 1 : 0;
      previous = pixels;
      if (animated ? captures >= 3 : stable >= 2) break;
    }
    assert.ok(
      animated ? captures >= 3 : stable >= 2,
      'Screenshot did not settle within the time limit.',
    );
    await checkReady();
    if (output) fs.writeFileSync(output, image.toPNG());
    return image;
  } catch (error) {
    // Keep diagnostics separate from the success artifact; a failed capture
    // must never produce the file the smoke runner treats as passing evidence.
    if (output && image && !image.isEmpty())
      fs.writeFileSync(output.replace(/\.png$/, '') + '.failed.png', image.toPNG());
    throw error;
  } finally {
    if (!contents.isDestroyed()) contents.setBackgroundThrottling(throttled);
  }
}

module.exports = { captureSettled };
