const test = require('node:test');
const assert = require('node:assert/strict');
const { createViewerRegistry } = require('./registry.cjs');

test('Viewer registry selects plugins without embedding domain kinds in Core', () => {
  const registry = createViewerRegistry([
    {
      id: 'sample',
      matches: file => file.endsWith('.sample'),
      open: () => ({ status: 'rendered' }),
    },
  ]);
  assert.equal(registry.match('a.sample'), 'sample');
  assert.equal(registry.match('a.txt'), null);
  assert.deepEqual(registry.list(), ['sample']);
  assert.deepEqual(registry.get('sample').open(), { status: 'rendered' });
  assert.throws(
    () =>
      createViewerRegistry([
        { id: 'x', matches: () => true, open() {} },
        { id: 'x', matches: () => false, open() {} },
      ]),
    /duplicate/,
  );
});

test('automatic opening requires an explicit plugin opt-in and keeps the normal Registry match', () => {
  const plugin = { id: 'read-only', matches: file => file.endsWith('.sample'), open() {} };
  assert.equal(createViewerRegistry([plugin]).canAutoPreview('a.sample'), false);
  const registry = createViewerRegistry([{ ...plugin, autoPreview: true }]);
  assert.equal(registry.canAutoPreview('a.sample'), true);
  assert.equal(registry.canAutoPreview('a.unknown'), false);
});
