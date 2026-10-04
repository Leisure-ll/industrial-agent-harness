const crypto = require('node:crypto');
const path = require('node:path');
const {
  SCHEME,
  BrowserFiles,
  normalizeBrowserUrl,
  clippedBounds,
} = require('./browser-policy.cjs');

// Electron stays in the desktop adapter; web pages receive no Harness preload/API.
class BrowserManager {
  constructor({ electron, window, activeProject }) {
    this.electron = electron;
    this.window = window;
    this.activeProject = activeProject;
    this.projects = new Map();
    this.files = new BrowserFiles();
    this.presentation = null;
    this.attached = null;
    this.wheelZoom = (event, direction) => {
      if (![1, -1].includes(direction) || event.senderFrame !== event.sender.mainFrame) return;
      const state = this.projects.get(this.activeProject()?.id);
      const tab =
        state && [...state.tabs.values()].find(tab => tab.view.webContents === event.sender);
      if (tab && state.activeId === tab.id && this.attached === tab.view)
        this.zoom(state, tab, direction);
    };
    electron.ipcMain.on('browser:wheel-zoom', this.wheelZoom);
    window.on('closed', () => this.close());
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) this.hide();
    });
  }
  project(projectId) {
    if (this.closed) throw Error('Browser window is closed.');
    const project = this.activeProject();
    if (!project || project.id !== projectId)
      throw Error('Open this project before using its browser.');
    let state = this.projects.get(projectId);
    if (!state) {
      const partition = `persist:harness-browser-${crypto.createHash('sha256').update(project.path).digest('hex')}`;
      const session = this.electron.session.fromPartition(partition);
      session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      session.setPermissionCheckHandler(() => false);
      session.setDevicePermissionHandler(() => false);
      session.on('will-download', event => event.preventDefault());
      session.webRequest.onBeforeRequest((details, callback) => {
        const protocol = new URL(details.url).protocol;
        callback({
          cancel: ![
            'http:',
            'https:',
            'ws:',
            'wss:',
            'data:',
            'blob:',
            'about:',
            `${SCHEME}:`,
          ].includes(protocol),
        });
      });
      session.protocol.handle(SCHEME, async request => {
        const response = await this.files.handle(request, projectId);
        if (response.status >= 400) {
          const message = await response.clone().text();
          for (const tab of state.tabs.values()) {
            const topLevel = tab.url.split(/[?#]/)[0] === request.url.split(/[?#]/)[0];
            const samePreview =
              new URL(tab.url).hostname === new URL(request.url).hostname &&
              tab.url.startsWith(`${SCHEME}:`);
            if (
              topLevel ||
              (samePreview && /changed|outside|exceeds|Too many|does not belong/.test(message))
            ) {
              tab.error = message;
              this.publish(state);
            }
          }
        }
        return response;
      });
      state = { projectId, session, tabs: new Map(), activeId: null, revision: 0 };
      this.projects.set(projectId, state);
    }
    return state;
  }
  snapshot(state) {
    return {
      projectId: state.projectId,
      revision: state.revision,
      activeId: state.activeId,
      tabs: [...state.tabs.values()].map(tab => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        loading: tab.loading,
        error: tab.error,
        canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
        canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
        zoomPercent: Math.round(tab.view.webContents.getZoomFactor() * 100),
      })),
    };
  }
  publish(state) {
    if (this.closed) return;
    state.revision += 1;
    this.layout();
    if (!this.window.isDestroyed())
      this.window.webContents.send('browser:changed', this.snapshot(state));
  }
  state(projectId) {
    return this.snapshot(this.project(projectId));
  }
  open({ projectId, url = 'about:blank', reuse = false }) {
    const state = this.project(projectId);
    const normalized = normalizeBrowserUrl(url, this.files.origins(projectId));
    const existing = reuse && [...state.tabs.values()].find(tab => tab.url === normalized);
    if (existing) {
      state.activeId = existing.id;
      this.publish(state);
      return this.snapshot(state);
    }
    const total = [...this.projects.values()].reduce((count, p) => count + p.tabs.size, 0);
    if (state.tabs.size >= 8 || total >= 16)
      throw Error('Close a browser tab before opening another.');
    const view = new this.electron.WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'browser-preload.cjs'),
        session: state.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: false,
      },
    });
    const wc = view.webContents;
    wc.setZoomMode('isolated');
    // Trackpad magnification remains native; Fit also clears visual zoom.
    void wc.setVisualZoomLevelLimits(1, 3);
    const tab = {
      id: crypto.randomUUID(),
      view,
      url: normalized,
      title: 'New tab',
      loading: false,
      error: '',
      timer: null,
      revision: 0,
    };
    state.tabs.set(tab.id, tab);
    state.activeId = tab.id;
    const update = () => {
      if (wc.isDestroyed() || !state.tabs.has(tab.id)) return;
      const actual = wc.getURL();
      if (actual && !tab.loading && !tab.error) tab.url = actual;
      tab.title = wc.getTitle() || (tab.url === 'about:blank' ? 'New tab' : tab.url);
      this.publish(state);
    };
    wc.on('did-start-loading', () => {
      tab.loading = true;
      tab.error = '';
      clearTimeout(tab.timer);
      tab.timer = setTimeout(() => {
        tab.error = 'Page took too long to load. Try again.';
        wc.stop();
        tab.loading = false;
        update();
      }, 30000);
      update();
    });
    wc.on('did-stop-loading', () => {
      tab.loading = false;
      clearTimeout(tab.timer);
      update();
    });
    for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated'])
      wc.on(event, update);
    wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) {
        tab.error = `Unable to load page: ${description}`;
        update();
      }
    });
    wc.on('render-process-gone', () => {
      tab.error = 'Page stopped responding. Reload to retry.';
      update();
    });
    const allow = url => {
      try {
        const value = normalizeBrowserUrl(url, this.files.origins(projectId));
        return !value.startsWith(`${SCHEME}:`) || tab.url.startsWith(`${SCHEME}:`);
      } catch {
        return false;
      }
    };
    for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
      wc.on(name, (event, url) => {
        if (!allow(typeof url === 'string' ? url : url.url)) event.preventDefault();
      });
    }
    wc.setWindowOpenHandler(({ url }) => {
      if (allow(url)) {
        try {
          this.open({ projectId, url });
        } catch (error) {
          tab.error = error.message;
          update();
        }
      }
      return { action: 'deny' };
    });
    wc.on('zoom-changed', (_event, direction) =>
      this.zoom(state, tab, direction === 'in' ? 1 : -1),
    );
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if (key === 'escape') {
        this.window.webContents.send('browser:shortcut', { projectId, action: 'escape' });
        return;
      }
      if (!(input.meta || input.control)) return;
      const actions = {
        l: 'address',
        t: 'new',
        w: 'close',
        r: 'reload',
        '+': 'zoom-in',
        '=': 'zoom-in',
        '-': 'zoom-out',
        0: 'fit',
      };
      const action = actions[key];
      if (!action) return;
      event.preventDefault();
      if (action === 'address') {
        this.window.webContents.focus();
        this.window.webContents.send('browser:shortcut', { projectId, action });
      } else if (action === 'new') {
        try {
          this.open({ projectId });
        } catch (error) {
          tab.error = error.message;
          update();
        }
        this.window.webContents.focus();
        this.window.webContents.send('browser:shortcut', { projectId, action: 'address' });
      } else this.command({ projectId, tabId: tab.id, action });
    });
    this.navigate(state, tab, normalized);
    this.publish(state);
    return this.snapshot(state);
  }
  navigate(state, tab, url) {
    const wc = tab.view.webContents;
    tab.url = url;
    tab.error = '';
    tab.loading = true;
    const revision = ++tab.revision;
    void wc.loadURL(url).catch(error => {
      if (
        revision !== tab.revision ||
        !state.tabs.has(tab.id) ||
        wc.isDestroyed() ||
        error.code === 'ERR_ABORTED'
      )
        return;
      tab.error = `Unable to load page: ${error.message}`;
      tab.loading = false;
      this.publish(state);
    });
  }
  zoom(state, tab, direction) {
    if (tab.loading || tab.error) return;
    const wc = tab.view.webContents;
    wc.setZoomFactor(
      Math.max(
        0.25,
        Math.min(3, direction === 0 ? 1 : wc.getZoomFactor() * (direction > 0 ? 1.2 : 1 / 1.2)),
      ),
    );
    if (direction === 0)
      void wc
        .setVisualZoomLevelLimits(1, 1)
        .then(() => (wc.isDestroyed() ? undefined : wc.setVisualZoomLevelLimits(1, 3)));
    this.publish(state);
  }
  command({ projectId, tabId, action, url }) {
    const state = this.project(projectId);
    const tab = state.tabs.get(tabId);
    if (!tab) throw Error('Browser tab is no longer available.');
    const wc = tab.view.webContents;
    switch (action) {
      case 'select':
        state.activeId = tabId;
        break;
      case 'navigate':
        this.navigate(state, tab, normalizeBrowserUrl(url, this.files.origins(projectId)));
        break;
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        break;
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
        break;
      case 'reload':
        tab.error = '';
        wc.reload();
        break;
      case 'stop':
        wc.stop();
        break;
      case 'zoom-in':
        this.zoom(state, tab, 1);
        break;
      case 'zoom-out':
        this.zoom(state, tab, -1);
        break;
      case 'fit':
        this.zoom(state, tab, 0);
        break;
      case 'close':
        if (this.attached === tab.view) this.detach();
        state.tabs.delete(tabId);
        clearTimeout(tab.timer);
        wc.close({ waitForBeforeUnload: false });
        if (state.activeId === tabId) state.activeId = [...state.tabs.keys()].at(-1) || null;
        break;
      default:
        throw Error('Unsupported browser action.');
    }
    this.publish(state);
    return this.snapshot(state);
  }
  present({ projectId, ownerId, bounds }) {
    if (typeof ownerId !== 'string' || ownerId.length > 100) throw Error('Invalid browser view.');
    if (!bounds) {
      if (this.presentation?.ownerId === ownerId) this.hide();
      return;
    }
    this.project(projectId);
    this.presentation = { projectId, ownerId, bounds };
    this.layout();
  }
  layout() {
    if (this.window.isDestroyed()) return;
    const p = this.presentation;
    const state = p && this.projects.get(p.projectId);
    const tab = state?.tabs.get(state.activeId);
    const size = this.window.getContentBounds();
    const bounds = p && clippedBounds(p.bounds, size);
    const view =
      tab &&
      !tab.error &&
      tab.url !== 'about:blank' &&
      this.activeProject()?.id === p.projectId &&
      bounds.width > 0 &&
      bounds.height > 0
        ? tab.view
        : null;
    if (view !== this.attached) {
      this.detach();
      if (view) {
        this.window.contentView.addChildView(view);
        this.attached = view;
      }
    }
    if (view) view.setBounds(bounds);
  }
  detach() {
    if (this.attached && !this.window.isDestroyed())
      this.window.contentView.removeChildView(this.attached);
    this.attached = null;
  }
  hide() {
    this.presentation = null;
    this.detach();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.electron.ipcMain.removeListener('browser:wheel-zoom', this.wheelZoom);
    this.hide();
    for (const state of this.projects.values()) {
      for (const tab of state.tabs.values()) {
        clearTimeout(tab.timer);
        if (!tab.view.webContents.isDestroyed())
          tab.view.webContents.close({ waitForBeforeUnload: false });
      }
      state.tabs.clear();
      state.session.protocol.unhandle(SCHEME);
      state.session.removeAllListeners('will-download');
    }
    this.projects.clear();
    this.files.close();
  }
}
module.exports = { BrowserManager };
