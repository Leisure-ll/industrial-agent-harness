#!/usr/bin/env node
const { packSourceDirectory } = require('../packages/domain-skills/src/index.cjs');
process.stdout.write(packSourceDirectory(process.argv[2]) + '\n');
