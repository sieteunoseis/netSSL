#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get the version type from command line args (patch, minor, major)
const versionType = process.argv[2] || 'patch';
const message = process.argv[3] || 'Version bump';

// Validate version type
if (!['patch', 'minor', 'major'].includes(versionType)) {
  console.error('❌ Invalid version type. Use: patch, minor, or major');
  process.exit(1);
}

try {
  // Bump the version
  console.log(`📦 Bumping ${versionType} version...`);
  execSync(`npm version ${versionType} --no-git-tag-version`, { stdio: 'inherit' });
  
  // Get the new version
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );
  const newVersion = packageJson.version;
  
  // Stage the changes
  console.log('📝 Staging changes...');
  execSync('git add package.json package-lock.json frontend/src/version.json', { stdio: 'inherit' });
  
  // Create commit
  console.log('💾 Creating commit...');
  const commitMessage = `chore: bump version to ${newVersion} - ${message}`;
  execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' });
  
  console.log(`✅ Successfully bumped version to ${newVersion}`);
  console.log(`   Commit message: ${commitMessage}`);
  
} catch (error) {
  console.error('❌ Error bumping version:', error.message);
  process.exit(1);
}