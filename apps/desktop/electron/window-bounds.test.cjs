const assert = require('node:assert/strict');
const { test } = require('node:test');
const { windowBounds } = require('./window-bounds.cjs');

test('startup fits usable desktop space, including small displays and taskbar offsets', () => {
  assert.deepEqual(windowBounds({ x: 0, y: 24, width: 1366, height: 744 }), {
    x: 0,
    y: 24,
    width: 1366,
    height: 744,
    minWidth: 640,
    minHeight: 480,
  });
  assert.deepEqual(windowBounds({ x: -800, y: 40, width: 600, height: 420 }), {
    x: -800,
    y: 40,
    width: 600,
    height: 420,
    minWidth: 600,
    minHeight: 420,
  });
  assert.deepEqual(windowBounds({ x: 0, y: 25, width: 1920, height: 1055 }), {
    x: 240,
    y: 103,
    width: 1440,
    height: 900,
    minWidth: 640,
    minHeight: 480,
  });
});

test('monitor removal and resolution changes bring the current window back into usable bounds', () => {
  assert.deepEqual(
    windowBounds(
      { x: 0, y: 32, width: 1280, height: 688 },
      {
        x: -1800,
        y: -30,
        width: 1600,
        height: 1000,
      },
    ),
    { x: 0, y: 32, width: 1280, height: 688, minWidth: 640, minHeight: 480 },
  );
  const unchanged = { x: 110, y: 220, width: 900, height: 600 };
  const { minWidth, minHeight, ...bounds } = windowBounds(
    { x: 0, y: 24, width: 1920, height: 1056 },
    unchanged,
  );
  assert.deepEqual(
    bounds,
    unchanged,
    'An already visible window should keep its size and position',
  );
});
