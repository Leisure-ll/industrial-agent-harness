// Deterministic fixture repair: exercises runner/verifier plumbing, never model quality.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.argv[2], 'counter.sv');
const source = fs.readFileSync(file, 'utf8');
if (!source.includes('else count <= count + 1;')) throw Error('Unexpected frozen fixture.');
fs.writeFileSync(
  file,
  source.replace('else count <= count + 1;', 'else if (enable) count <= count + 1;'),
);
process.stdout.write(JSON.stringify({ type: 'engineering_smoke', model: null }) + '\n');
