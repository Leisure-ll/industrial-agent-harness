// Existing UI regressions use English selectors independent of the test machine's language.
async function setLanguage(window, locale) {
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  const deadline = Date.now() + 15000;
  while (!(await evaluate(`Boolean(document.querySelector('.ia-settings-button'))`))) {
    if (Date.now() > deadline) throw Error('Application settings did not load.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await evaluate(`document.querySelector('.ia-settings-button').click()`);
  await evaluate(
    `(() => {const select=document.getElementById('ia-language');select.value=${JSON.stringify(locale)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await evaluate(`document.querySelector('.ia-settings-title button').click()`);
}
module.exports = { setLanguage };
