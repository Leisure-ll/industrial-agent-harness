const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  defaults,
  validateProfile,
  thinkingEffort,
  configToml,
  sessionEnv,
  saveProfile,
  readProfile,
  writeCliConfig,
} = require('./model-config.cjs');

test('model config keeps the key out of files and passes it only to the session', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-model-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  saveProfile(dir, defaults);
  const shareDir = writeCliConfig(dir, defaults);
  assert.deepEqual(readProfile(dir), defaults);
  assert.match(
    fs.readFileSync(path.join(shareDir, 'config.toml'), 'utf8'),
    /default_model = "industrial"/,
  );
  assert.ok(!fs.readFileSync(path.join(shareDir, 'config.toml'), 'utf8').includes('secret-token'));
  assert.equal(sessionEnv(defaults, 'secret-token').KIMI_API_KEY, 'secret-token');
  assert.ok(!JSON.stringify(readProfile(dir)).includes('secret-token'));
  assert.match(configToml(defaults), /capabilities = \["thinking"\]/);
});

test('the session caps requested completion tokens instead of the remaining window', () => {
  const profile = validateProfile({
    ...defaults,
    provider: 'openai_legacy',
    endpoint: 'http://127.0.0.1:9/v1',
    model: 'Qwen3.8-27B',
    contextSize: 262144,
  });
  assert.match(configToml(profile), /max_output_size = 65536/);
  assert.equal(
    sessionEnv(defaults, 'secret-token').HARNESS_MODEL_API_KEY,
    'secret-token',
    'the model key is supplied through the configured environment reference',
  );
  assert.match(configToml(defaults), /max_output_size = 65536/);
  assert.match(configToml({ ...profile, contextSize: 8192 }), /max_output_size = 2048/);
  assert.equal(sessionEnv(profile, 'secret-token').KIMI_CODE_NO_AUTO_UPDATE, '1');
  assert.match(
    configToml(profile),
    /max_context_size = 262144/,
    'the declared window stays the true model limit',
  );
});

test('endpoint validation rejects remote plaintext and embedded credentials', () => {
  assert.throws(() => validateProfile({ ...defaults, endpoint: 'http://example.com/v1' }), /HTTPS/);
  assert.throws(
    () => validateProfile({ ...defaults, endpoint: 'https://key@example.com/v1' }),
    /credentials/,
  );
  assert.equal(
    validateProfile({ ...defaults, endpoint: 'http://127.0.0.1:8000/v1' }).endpoint,
    'http://127.0.0.1:8000/v1',
  );
});

test('model image capability is conservative in Auto and explicitly overridable', () => {
  const m3 = {
    provider: 'openai_legacy',
    endpoint: 'https://api.minimaxi.com/v1',
    model: 'Minimax-M3',
    contextSize: 1000000,
    thinking: true,
  };
  assert.equal(
    validateProfile(m3).imageInput,
    true,
    'legacy official M3 profile acquires known capability',
  );
  assert.match(configToml(m3), /"thinking","image_in"/);
  assert.equal(validateProfile({ ...m3, model: 'MiniMax-M2.7' }).imageInput, false);
  assert.equal(validateProfile({ ...m3, endpoint: 'https://custom.example/v1' }).imageInput, false);
  assert.equal(validateProfile({ ...m3, imageInputMode: 'disabled' }).imageInput, false);
  assert.equal(
    validateProfile({ ...defaults, model: 'custom-vision', imageInputMode: 'enabled' }).imageInput,
    true,
  );
  assert.throws(() => validateProfile({ ...m3, imageInputMode: 'unknown' }), /Choose Auto/);
  assert.throws(() => validateProfile({ ...m3, imageInput: 'true' }), /enabled or disabled/);
  assert.doesNotMatch(configToml({ ...m3, imageInputMode: 'disabled' }), /image_in/);
});

test('HARNESS_TRUSTED_PLAINTEXT_HOSTS allows explicit self-hosted plaintext endpoints', t => {
  const previous = process.env.HARNESS_TRUSTED_PLAINTEXT_HOSTS;
  t.after(() => {
    if (previous === undefined) delete process.env.HARNESS_TRUSTED_PLAINTEXT_HOSTS;
    else process.env.HARNESS_TRUSTED_PLAINTEXT_HOSTS = previous;
  });
  process.env.HARNESS_TRUSTED_PLAINTEXT_HOSTS = '192.168.1.50, gpu.local:48000';
  assert.equal(
    validateProfile({ ...defaults, endpoint: 'http://192.168.1.50:48000/v1' }).endpoint,
    'http://192.168.1.50:48000/v1',
  );
  assert.equal(
    validateProfile({ ...defaults, endpoint: 'http://gpu.local:48000/v1' }).endpoint,
    'http://gpu.local:48000/v1',
  );
  assert.throws(
    () => validateProfile({ ...defaults, endpoint: 'http://gpu.local:9999/v1' }),
    /HTTPS/,
  );
  assert.throws(() => validateProfile({ ...defaults, endpoint: 'http://example.com/v1' }), /HTTPS/);
});

test('official MiniMax Chat Completions repairs a saved Moonshot protocol without changing its destination or key', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-model-protocol-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const host of ['api.minimaxi.com', 'api.minimax.io', 'api.minimax.cn']) {
    const profile = { ...defaults, endpoint: `https://${host}/v1/`, model: 'MiniMax-M3' };
    fs.writeFileSync(path.join(dir, 'model-profile.json'), JSON.stringify(profile));
    const resolved = readProfile(dir);
    assert.equal(resolved.provider, 'openai_legacy');
    assert.equal(resolved.endpoint, `https://${host}/v1`);
    assert.equal(resolved.model, profile.model);
    assert.equal(resolved.thinking, true);
    assert.equal(resolved.imageInput, true);
    assert.equal(sessionEnv(resolved, 'test-secret').OPENAI_API_KEY, 'test-secret');
    assert.equal(sessionEnv(resolved, 'test-secret').KIMI_API_KEY, undefined);
    const config = fs.readFileSync(path.join(writeCliConfig(dir, resolved), 'config.toml'), 'utf8');
    assert.match(config, /type = "openai"/);
    assert.match(config, /effort = "on"/);
    assert.doesNotMatch(config, /test-secret/);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, 'model-profile.json'), 'utf8')).provider,
      'kimi',
      'reading an old profile does not rewrite user settings',
    );
    assert.equal(saveProfile(dir, profile).provider, 'openai_legacy');
  }
  for (const endpoint of [
    'https://api.minimaxi.com/anthropic',
    'https://api.minimaxi.com:8443/v1',
    'https://api.minimaxi.com.example/v1',
    'https://custom.example/v1',
  ])
    assert.equal(
      validateProfile({ ...defaults, endpoint, model: 'MiniMax-M3' }).provider,
      'kimi',
      'other protocols and gateways retain the explicit selection',
    );
  assert.equal(
    validateProfile({ ...defaults, endpoint: 'https://api.minimaxi.com/v1', model: 'custom-model' })
      .provider,
    'kimi',
  );
});

test('thinking defaults follow the selected API instead of forcing high on every vendor', () => {
  assert.equal(thinkingEffort(defaults), 'high');
  assert.equal(thinkingEffort({ ...defaults, thinking: false }), 'off');
  const compatible = validateProfile({
    ...defaults,
    provider: 'openai_legacy',
    endpoint: 'https://custom.example/v1',
    model: 'custom-thinking',
  });
  assert.equal(thinkingEffort(compatible), 'on');
  assert.match(configToml(compatible), /effort = "on"/);
  assert.match(configToml({ ...compatible, thinking: false }), /effort = "off"/);
});
