const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'distribution.json');
let distributionDomain = null;
if (fs.existsSync(file)) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 1 || typeof value.domain !== 'string' || !value.domain.trim())
    throw Error('Invalid packaged domain binding.');
  distributionDomain = value.domain;
}
module.exports = { distributionDomain };
