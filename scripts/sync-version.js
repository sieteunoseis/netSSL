#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read version from root package.json
const rootPackageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

// Write version to frontend version.json
const versionInfo = {
  version: rootPackageJson.version
};

fs.writeFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'version.json'),
  JSON.stringify(versionInfo, null, 2)
);

console.log(`✅ Synced version ${rootPackageJson.version} to frontend`);