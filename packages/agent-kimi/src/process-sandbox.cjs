const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const quoteShell = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const seatbeltString = value => JSON.stringify(value);

function executablePath(executable, environment) {
  if (executable.includes(path.sep)) return fs.realpathSync(executable);
  for (const directory of (environment.PATH || process.env.PATH || '').split(path.delimiter)) {
    try {
      const target = fs.realpathSync(path.join(directory, executable));
      fs.accessSync(target, fs.constants.X_OK);
      return target;
    } catch {}
  }
  throw Error('Kimi executable is unavailable.');
}

function createProcessSandbox({
  executable = 'kimi',
  shareDir,
  projectDir,
  protectedPaths = [],
  environment = process.env,
  platform = process.platform,
}) {
  if (platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec'))
    throw Error(
      `Industrial agent execution is unavailable on ${platform}: a verified process write boundary is required.`,
    );
  const project = fs.realpathSync(projectDir);
  const share = fs.realpathSync(shareDir);
  const protectedRoots = [
    project,
    ...protectedPaths.filter(fs.existsSync).map(file => fs.realpathSync(file)),
  ];
  if (protectedRoots.some(root => share === root || share.startsWith(root + path.sep)))
    throw Error('Agent session storage must be outside the protected project and runtime.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'industrial-kimi-boundary-'));
  fs.chmodSync(directory, 0o700);
  const scratch = path.join(directory, 'scratch');
  fs.mkdirSync(scratch, { mode: 0o700 });
  // Kimi 1.51.0 requires a writable --work-dir at startup. Use a stable
  // session workspace, while the actual engineering project stays read-only.
  const workDir = path.join(share, 'workspace');
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const projectLink = path.join(workDir, 'project');
  if (!fs.existsSync(projectLink)) fs.symlinkSync(project, projectLink);
  const profile = path.join(directory, 'agent.sb');
  // Descendant processes inherit the Seatbelt restriction. Native Shell,
  // WriteFile, Python and project-controlled MCP children cannot write facts.
  // Runtime tools run in the parent host process, with a separate policy check.
  fs.writeFileSync(
    profile,
    `(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath ${seatbeltString(share)}) (subpath ${seatbeltString(fs.realpathSync(scratch))}) (literal "/dev/null"))\n${protectedRoots.map(root => `(deny file-write* (subpath ${seatbeltString(root)}))`).join('\n')}\n(deny appleevent-send)\n`,
    { mode: 0o400 },
  );
  const wrapper = path.join(directory, 'kimi');
  const target = executablePath(executable, environment);
  fs.writeFileSync(
    wrapper,
    `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quoteShell(profile)} ${quoteShell(target)} "$@"\n`,
    { mode: 0o500 },
  );
  return {
    executable: wrapper,
    env: { ...environment, TMPDIR: scratch + path.sep },
    directory,
    workDir,
    boundary: {
      platform: 'darwin',
      projectWritable: false,
      projectDir: project,
      agentWorkDir: workDir,
      writableRoots: [share, scratch],
      mechanism: 'seatbelt',
      hostRuntimeRequired: true,
    },
    close() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

module.exports = { createProcessSandbox };
