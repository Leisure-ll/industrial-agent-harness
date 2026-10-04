const { ipcRenderer } = require('electron');

// Isolated world only: no API is exposed to page scripts. Ordinary wheels scroll.
window.addEventListener(
  'wheel',
  event => {
    if ((event.ctrlKey || event.metaKey) && event.deltaY) {
      event.preventDefault();
      ipcRenderer.send('browser:wheel-zoom', event.deltaY < 0 ? 1 : -1);
    }
  },
  { passive: false, capture: true },
);
