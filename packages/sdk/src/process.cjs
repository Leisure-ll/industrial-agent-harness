const { spawn, spawnSync } = require('node:child_process');

// Start one process group so cancellation also reaps tool/session descendants.
function startProcess(executable, args, options = {}) {
  return spawn(executable, args, {
    ...options,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function signalProcess(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      if (signal === 'SIGKILL') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.on('error', () => child.kill(signal));
      } else child.kill(signal);
    } else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code === 'ESRCH') return;
    // Darwin excludes zombies when signalling a group and reports EPERM when
    // no live members remain. Verify that state without hiding a real denial
    // against a live tool descendant.
    if (process.platform === 'darwin' && error.code === 'EPERM') {
      const group = spawnSync('/bin/ps', ['-g', String(child.pid), '-o', 'stat='], {
        encoding: 'utf8',
        timeout: 1000,
      });
      if (
        !group.error &&
        [0, 1].includes(group.status) &&
        !group.stderr.trim() &&
        group.stdout.split('\n').every(state => !state.trim() || state.trim().startsWith('Z'))
      )
        return;
    }
    throw error;
  }
}

module.exports = { startProcess, signalProcess };
