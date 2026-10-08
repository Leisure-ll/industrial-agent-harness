const assert = require('node:assert/strict');
const { setLanguage } = require('./selftest-language.cjs');

function prepare() {
  // No engine is launched by a settings toggle. Avoid downloading in this UI test.
  process.env.GUI_BRIDGE_BIN = process.execPath;
}
async function run(window, systemPreferences, shell) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  async function wait(script) {
    const deadline = Date.now() + 15000;
    while (!(await evaluate(script))) {
      if (Date.now() > deadline) throw Error('Desktop permission UI did not settle: ' + script);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const realScreen = systemPreferences.getMediaAccessStatus;
  const realAccessibility = systemPreferences.isTrustedAccessibilityClient;
  const realOpenExternal = shell.openExternal;
  const actual = await evaluate('window.viewerHost.guiState()');
  const links = [];
  let screen = 'denied',
    accessibility = false,
    unavailable = false;
  try {
    if (process.platform === 'darwin') {
      systemPreferences.getMediaAccessStatus = type => {
        assert.equal(type, 'screen');
        if (unavailable) throw Error('Unavailable query');
        return screen;
      };
      systemPreferences.isTrustedAccessibilityClient = prompt => {
        assert.equal(prompt, false);
        return accessibility;
      };
    }
    shell.openExternal = async url => {
      links.push(url);
    };
    await setLanguage(window, 'zh-CN');
    await evaluate("document.querySelector('.ia-settings-button').click()");
    await wait("document.querySelector('.ia-computer-use button')?.textContent === '已关闭'");
    await evaluate("document.querySelector('.ia-computer-use .ia-settings-row button').click()");
    await wait(
      "document.querySelector('.ia-computer-use .ia-settings-row button')?.textContent === '已开启'",
    );
    await wait("window.viewerHost.guiState().then(state => state.install === 'ready')");
    if (process.platform === 'darwin') {
      await wait(
        "document.querySelector('.ia-gui-status')?.textContent.includes('还需授权') && document.querySelectorAll('.ia-gui-permissions button').length === 2",
      );
      await evaluate("document.querySelector('.ia-gui-permissions button').click()");
      await wait('true');
      assert.match(links[0], /\?Privacy_ScreenCapture$/);
      screen = 'granted';
      await evaluate("window.dispatchEvent(new Event('focus'))");
      await wait(
        "document.querySelectorAll('.ia-gui-permissions button').length === 1 && document.querySelector('.ia-gui-permissions button').textContent.includes('辅助功能')",
      );
      await evaluate("document.querySelector('.ia-gui-permissions button').click()");
      await wait('true');
      assert.match(links[1], /\?Privacy_Accessibility$/);
      accessibility = true;
      await evaluate("window.dispatchEvent(new Event('focus'))");
      await wait("document.querySelector('.ia-gui-status')?.textContent === '已授权'");
      assert.equal(
        await evaluate("document.querySelectorAll('.ia-gui-permissions button').length"),
        0,
      );
      unavailable = true;
      await evaluate("window.dispatchEvent(new Event('focus'))");
      await wait(
        "document.querySelector('.ia-gui-status')?.textContent.includes('暂时无法确认权限')",
      );
      assert.equal(
        await evaluate("document.querySelector('.ia-gui-status')?.textContent.includes('已授权')"),
        false,
      );
      assert.equal(
        await evaluate("document.querySelectorAll('.ia-gui-permissions button').length"),
        1,
      );
    } else {
      await wait("document.querySelector('.ia-gui-status')?.textContent === '可以使用'");
      assert.equal(
        await evaluate("document.querySelectorAll('.ia-gui-permissions button').length"),
        0,
      );
    }
    assert.equal(
      await evaluate("document.querySelector('.ia-computer-use').textContent.includes('v0.')"),
      false,
    );
    await evaluate("document.querySelector('.ia-computer-use .ia-settings-row button').click()");
    await wait(
      "document.querySelector('.ia-computer-use .ia-settings-row button')?.textContent === '已关闭'",
    );
    assert.equal(window.isDestroyed(), false, 'Enabling and disabling do not quit the app');
    console.log(
      'Desktop settings selftest passed: enable/disable, permission states, unknown fallback, focus refresh and bounded settings links.',
      JSON.stringify({ platform: process.platform, actualPermissions: actual.permissions }),
    );
  } finally {
    systemPreferences.getMediaAccessStatus = realScreen;
    systemPreferences.isTrustedAccessibilityClient = realAccessibility;
    shell.openExternal = realOpenExternal;
  }
}
module.exports = { prepare, run };
