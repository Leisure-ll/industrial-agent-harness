const assert = require('node:assert/strict');
const { test } = require('node:test');

const core = import('../src/i18n/core.ts');

test('language follows the primary system language, with a safe English fallback', async () => {
  const { systemLocale, normalizePreference } = await core;
  assert.equal(systemLocale(['zh-CN', 'en-US']), 'zh-CN');
  assert.equal(systemLocale(['zh-Hant-TW']), 'zh-CN');
  assert.equal(systemLocale(['en-GB', 'zh-CN']), 'en');
  assert.equal(systemLocale(['de-DE']), 'en');
  assert.equal(systemLocale([]), 'en');
  for (const value of [null, undefined, '', 'invalid', '{}'])
    assert.equal(normalizePreference(value), 'system');
  assert.equal(normalizePreference('en'), 'en');
  assert.equal(normalizePreference('zh-CN'), 'zh-CN');
});

test('preferences persist and unavailable storage does not prevent switching', async () => {
  const { readPreference, savePreference, languageStorageKey } = await core;
  const data = new Map();
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  assert.equal(readPreference(storage), 'system');
  for (const choice of ['zh-CN', 'en', 'system']) {
    savePreference(storage, choice);
    assert.equal(data.get(languageStorageKey), choice);
    assert.equal(readPreference(storage), choice);
  }
  const blocked = {
    getItem() {
      throw Error('Storage disabled');
    },
    setItem() {
      throw Error('Storage disabled');
    },
  };
  assert.equal(readPreference(blocked), 'system');
  assert.doesNotThrow(() => savePreference(blocked, 'zh-CN'));
});

test('translations preserve data, interpolate once, and fall back for unknown messages', async () => {
  const { translate } = await core;
  assert.equal(translate('zh-CN', 'Settings'), '设置');
  assert.equal(translate('en', 'Settings'), 'Settings');
  assert.equal(translate('en', '草图与约束'), 'Sketches and constraints');
  assert.equal(translate('zh-CN', 'Error: Wait for the chat to open.'), 'Error: 请等待聊天打开。');
  const name = '<img src=x> 中文 {0} $&';
  assert.equal(translate('zh-CN', 'New chat in {0}', { 0: name }), `在 ${name} 中新建聊天`);
  assert.equal(
    translate('en', 'Unregistered runtime diagnostic'),
    'Unregistered runtime diagnostic',
  );
  assert.equal(translate('en', 'New chat in {0}'), 'New chat in {0}');
});

test('both catalogs have nonempty translations and matching interpolation parameters', async () => {
  const { messages } = await import('../src/i18n/messages.ts');
  const { viewerMessages } = await import('@industrial-agent-harness/viewer-builtin/text-messages');
  const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, pair] of Object.entries({ ...messages, ...viewerMessages })) {
    assert.equal(pair.length, 2, key);
    assert.ok(
      pair.every(value => typeof value === 'string' && value.trim()),
      key,
    );
    assert.deepEqual(parameters(pair[0]), parameters(pair[1]), key);
  }
  for (const key of Object.keys(messages).filter(key => Object.hasOwn(viewerMessages, key)))
    assert.deepEqual(messages[key], viewerMessages[key], `Shared label: ${key}`);
});
