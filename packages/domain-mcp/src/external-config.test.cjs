const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig } = require('./external-registry.cjs');
test('MCP timeouts are optional, bounded, and preserve previously normalized registry records', () => {
  for (const config of [{ command: process.execPath, args: [] }, { url: 'http://127.0.0.1/mcp' }]) {
    const old = normalizeConfig(config);
    assert.equal(Object.hasOwn(old, 'requestTimeoutMs'), false);
    assert.deepEqual(normalizeConfig(old, undefined, false), old);
    for (const requestTimeoutMs of [100, 30000, 3600000]) {
      const saved = normalizeConfig({ ...config, requestTimeoutMs });
      assert.deepEqual(normalizeConfig(saved, undefined, false), saved);
    }
    for (const requestTimeoutMs of [0, 99, 3600001, 100.5, '30000', null])
      assert.throws(() => normalizeConfig({ ...config, requestTimeoutMs }), /requestTimeoutMs/);
  }
});
