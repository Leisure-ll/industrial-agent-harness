// Existing UI regressions use English selectors independent of the test machine's language.
async function setLanguage(window, locale) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  const wait = async (script, message) => {
    const deadline = Date.now() + 15000;
    while (!(await evaluate(script))) {
      if (Date.now() > deadline) throw Error(message);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  await wait(
    `Boolean(document.querySelector('.ia-settings-button'))`,
    'Application settings did not load.',
  );
  await evaluate(
    `if (!document.querySelector('.ia-settings-popover')) document.querySelector('.ia-settings-button').click()`,
  );
  await wait(`Boolean(document.getElementById('ia-language'))`, 'Language settings did not open.');
  await evaluate(
    `(() => {const select=document.getElementById('ia-language');select.value=${JSON.stringify(locale)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  // The select changes synchronously, but the translated tree and document lang
  // change on React's next commit. Wait for both before closing the popover.
  await wait(
    `document.getElementById('ia-language')?.value === ${JSON.stringify(locale)} && document.documentElement.lang === ${JSON.stringify(locale)}`,
    `Application language did not switch to ${locale}.`,
  );
  await evaluate(`document.querySelector('.ia-settings-title button').click()`);
  await wait(
    `!document.querySelector('.ia-settings-popover') && document.querySelector('.ia-settings-button')?.getAttribute('aria-expanded') === 'false'`,
    'Language settings did not close.',
  );
}
module.exports = { setLanguage };
