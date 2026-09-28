const channel = 'industrial-harness-kicad-v1';
let settled = false;
function report(type, error) {
  if (settled) return;
  settled = true;
  window.parent.postMessage({channel, type, error}, '*');
}
window.addEventListener('error', event => report('error', event.message || 'KiCad rendering failed.'));
window.addEventListener('unhandledrejection', event => report('error', String(event.reason?.message || event.reason)));

try {
  await import('./kicanvas.js');
  const response = await fetch('./manifest.json');
  if (!response.ok) throw Error(await response.text());
  const manifest = await response.json();
  const embed = document.createElement('kicanvas-embed');
  embed.setAttribute('controls', 'full');
  embed.setAttribute('controlslist', 'nooverlay nodownload nofullscreen');
  // The pinned runtime emits a composed, non-bubbling event from the actual viewer.
  embed.addEventListener('kicanvas:load', () => {
    requestAnimationFrame(() => requestAnimationFrame(() => report('ready')));
  }, {capture: true});
  for (const file of manifest.sources) {
    const sourceResponse = await fetch(file.url);
    if (!sourceResponse.ok) throw Error(await sourceResponse.text());
    const source = document.createElement('kicanvas-source');
    source.setAttribute('name', file.name);
    source.textContent = await sourceResponse.text();
    embed.appendChild(source);
  }
  document.body.appendChild(embed);
} catch (error) {report('error', String(error.message || error));}
