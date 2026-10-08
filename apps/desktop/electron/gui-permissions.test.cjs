const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guiPermissions, guiPermissionSettingsUrl } = require('./gui-permissions.cjs');

test('desktop authorization reads both OS permissions without prompting', () => {
  for (const screen of ['granted', 'denied', 'restricted', 'not-determined', 'unknown']) {
    for (const accessibility of [true, false]) {
      assert.deepEqual(
        guiPermissions(
          {
            getMediaAccessStatus(type) {
              assert.equal(type, 'screen');
              return screen;
            },
            isTrustedAccessibilityClient(prompt) {
              assert.equal(prompt, false);
              return accessibility;
            },
          },
          'darwin',
        ),
        { screen, accessibility: accessibility ? 'granted' : 'denied' },
      );
    }
  }
});

test('failed permission reads remain unknown; other platforms do not claim macOS authorization', () => {
  assert.deepEqual(
    guiPermissions(
      {
        getMediaAccessStatus() {
          throw Error('Unavailable');
        },
        isTrustedAccessibilityClient() {
          return true;
        },
      },
      'darwin',
    ),
    { screen: 'unknown', accessibility: 'granted' },
  );
  assert.deepEqual(guiPermissions({}, 'darwin'), { screen: 'unknown', accessibility: 'unknown' });
  assert.equal(guiPermissions({}, 'win32'), null);
  assert.equal(guiPermissions({}, 'linux'), null);
});

test('system settings navigation only accepts the two desktop permission pages', () => {
  assert.match(guiPermissionSettingsUrl('screen', 'darwin'), /\?Privacy_ScreenCapture$/);
  assert.match(guiPermissionSettingsUrl('accessibility', 'darwin'), /\?Privacy_Accessibility$/);
  for (const permission of ['__proto__', 'camera', 'https://example.com'])
    assert.throws(() => guiPermissionSettingsUrl(permission, 'darwin'), /Invalid/);
  assert.throws(() => guiPermissionSettingsUrl('screen', 'win32'), /macOS/);
});
