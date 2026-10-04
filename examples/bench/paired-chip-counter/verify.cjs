const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const projectDir = process.argv[2],
  outputDir = process.argv[3];
const result = spawnSync(
  'iverilog',
  [
    '-g2012',
    '-s',
    'tb',
    '-o',
    path.join(outputDir, 'verification.vvp'),
    path.join(projectDir, 'counter.sv'),
    path.join(__dirname, 'tb.sv'),
  ],
  { encoding: 'utf8', timeout: 10000, shell: false },
);
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status !== 0 || result.error) process.exit(1);
const simulation = spawnSync('vvp', [path.join(outputDir, 'verification.vvp')], {
  encoding: 'utf8',
  timeout: 10000,
  shell: false,
});
process.stdout.write(simulation.stdout || '');
process.stderr.write(simulation.stderr || '');
fs.writeFileSync(
  path.join(outputDir, 'verification-evidence.json'),
  JSON.stringify({
    verifierId: 'chip-counter-iverilog-v1',
    status: simulation.status === 0 && !simulation.error ? 'passed' : 'failed',
    checks: ['reset', 'enable-hold', 'increment', 'wrap', 'reset-priority'],
    exitCode: simulation.status,
  }) + '\n',
);
process.exitCode = simulation.status === 0 && !simulation.error ? 0 : 1;
