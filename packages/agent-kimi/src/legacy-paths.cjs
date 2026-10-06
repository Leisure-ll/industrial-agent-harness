const path = require('node:path');
const crypto = require('node:crypto');

// Read-only addresses for archived Python histories and existing diagnostic
// fixtures. New sessions never use these paths to persist agent context.
function createKimiPaths(home) {
  const sessionsDir = workDir =>
    path.join(home, 'sessions', crypto.createHash('md5').update(workDir, 'utf8').digest('hex'));
  return { home, sessionsDir, sessionDir: (workDir, id) => path.join(sessionsDir(workDir), id) };
}
module.exports = { createKimiPaths };
