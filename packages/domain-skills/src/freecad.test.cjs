const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateRecipe,
  validateInputs,
} = require('../../../domain-packs/freecad/runtime/recipe.cjs');
const { loadRegistry } = require('./installed.cjs');
const { resolve } = require('../../capability-broker/src/index.cjs');
test('FreeCAD recipe bounds dimensions, code injection, references and operation count', () => {
  const recipe = {
    parameters: { W: 20 },
    features: [{ id: 'Body', op: 'box', length: 10, width: 'W', height: 5 }],
    result: 'Body',
  };
  assert.equal(validateRecipe(recipe).features[0].width, 20);
  for (const input of [
    { ...recipe, script: 'import os' },
    { ...recipe, features: [{ ...recipe.features[0], width: '__import__("os")' }] },
    { ...recipe, features: [{ ...recipe.features[0], height: 0 }] },
    { ...recipe, features: [{ id: 'Cut', op: 'cut', base: 'Missing', tool: 'Body' }] },
    { ...recipe, features: Array(51).fill(recipe.features[0]) },
  ])
    assert.throws(() => validateRecipe(input));
  assert.throws(() => validateInputs('build', { recipe, expect: { bounds: [Infinity, 1, 1] } }));
});
test('CAD disclosure selects real native tools and registers a host Runtime without an MCP bypass', () => {
  const registry = loadRegistry();
  const resolution = resolve(
    { domain: 'cad', task: 'FreeCAD 3D 参数化草图拉伸打孔零件建模' },
    registry.capabilities,
  );
  assert.ok(resolution.scope.tools.includes('cad.freecad.build'));
  assert.ok(registry.runtimePacks.some(pack => pack.domain === 'cad'));
  assert.equal(
    registry.providerPacks.find(pack => pack.id === 'freecad-local').provider.transport,
    'runtime',
  );
  const pack = registry.providerPacks.find(pack => pack.id === 'freecad-local');
  require('./pack-resources.cjs').validateResources(
    require('node:path').resolve(__dirname, '../../../domain-packs/freecad'),
    pack.provider,
  );
});
test('CAD edit validates real feature/parameter changes and discloses the exact user prompt', () => {
  const { applyChanges } = require('../../../domain-packs/freecad/runtime/recipe.cjs');
  const recipe = {
    parameters: { W: 20 },
    features: [
      { id: 'Body', op: 'sketch_pad', profile: 'rectangle', length: 40, width: 'W', height: 5 },
    ],
    result: 'Body',
  };
  assert.equal(
    validateRecipe(applyChanges(recipe, { parameters: { W: 30 } })).features[0].width,
    30,
  );
  assert.throws(() => applyChanges(recipe, { parameters: { Missing: 10 } }), /Unknown/);
  assert.throws(() => applyChanges(recipe, { features: [{ id: 'Body', height: -1 }] }), /positive/);
  assert.throws(() => validateInputs('edit', { file: 'part.FCStd', changes: { script: 'evil' } }));
  const r = resolve({ domain: 'cad', task: '修改零件的形状' }, loadRegistry().capabilities);
  assert.ok(r.scope.tools.includes('cad.freecad.edit'));
});
