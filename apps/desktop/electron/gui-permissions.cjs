// Reading these statuses never prompts for or grants system access.
function guiPermissions(systemPreferences, platform = process.platform) {
  if (platform !== 'darwin') return null;
  let screen = 'unknown';
  let accessibility = 'unknown';
  try {
    const value = systemPreferences.getMediaAccessStatus('screen');
    if (['granted', 'denied', 'restricted', 'not-determined'].includes(value)) screen = value;
  } catch {
    /* An unavailable OS query must not look like authorization. */
  }
  try {
    accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied';
  } catch {
    /* Keep the unknown state independently of screen capture. */
  }
  return { screen, accessibility };
}

function guiPermissionSettingsUrl(permission, platform = process.platform) {
  if (platform !== 'darwin') throw Error('System permission settings require macOS.');
  const pages = { screen: 'Privacy_ScreenCapture', accessibility: 'Privacy_Accessibility' };
  if (!Object.hasOwn(pages, permission)) throw Error('Invalid desktop permission.');
  return `x-apple.systempreferences:com.apple.preference.security?${pages[permission]}`;
}

module.exports = { guiPermissions, guiPermissionSettingsUrl };
