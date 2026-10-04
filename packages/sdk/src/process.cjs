const { spawn } = require('node:child_process');

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
    if (error.code !== 'ESRCH') throw error;
  }
}

module.exports = { startProcess, signalProcess };
