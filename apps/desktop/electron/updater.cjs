class CoreUpdater {
  constructor({updater, packaged, channel = 'stable', onChange, canInstall}) {
    this.updater = updater;
    this.packaged = packaged;
    this.onChange = onChange;
    this.canInstall = canInstall;
    this.state = {status: packaged ? 'idle' : 'development', version: null, progress: null, error: null};
    if (!packaged) return;
    if (!['stable', 'beta'].includes(channel)) throw Error('Invalid Core update channel.');
    updater.channel = channel === 'stable' ? 'latest' : channel;
    updater.allowPrerelease = channel === 'beta';
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.on('checking-for-update', () => this.change({status: 'checking', error: null}));
    updater.on('update-available', info => this.change({status: 'available', version: info.version}));
    updater.on('update-not-available', () => this.change({status: 'current', version: null, progress: null}));
    updater.on('download-progress', progress => this.change({status: 'downloading', progress: Math.round(progress.percent)}));
    updater.on('update-downloaded', info => this.change({status: 'ready', version: info.version, progress: 100}));
    updater.on('error', error => this.change({status: 'error', error: String(error)}));
  }
  change(patch) {this.state = {...this.state, ...patch}; this.onChange(this.state);}
  snapshot() {return this.state;}
  async check() {
    if (!this.packaged) return this.state;
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'ready') return this.state;
    this.change({status: 'checking', error: null});
    try {await this.updater.checkForUpdates();}
    catch (error) {this.change({status: 'error', error: String(error)});}
    return this.state;
  }
  install() {
    if (this.state.status !== 'ready') throw Error('Core update is not ready.');
    this.canInstall();
    this.updater.quitAndInstall(false, true);
  }
}

module.exports = {CoreUpdater};
