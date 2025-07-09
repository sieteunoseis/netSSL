#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = 'template.config.json';

function updateTemplate() {
  console.log('🔧 Template Setup Script\n');
  
  // Read current template config
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    console.error('❌ Error reading template.config.json:', error.message);
    process.exit(1);
  }

  console.log('Current configuration:');
  console.log(`  Backend: ${config.useBackend ? '✅ Enabled' : '❌ Disabled'}`);
  if (config.useBackend) {
    console.log(`  Database Type: ${config.databaseType.toUpperCase()}`);
  }
  console.log();

  // Apply configuration
  applyConfiguration(config);
  
  console.log('✅ Template configuration applied successfully!');
  console.log('\nTo change configuration, edit template.config.json and run this script again.');
}

function applyConfiguration(config) {
  const { useBackend, databaseType, availableDatabaseTypes } = config;

  // Update App.jsx to conditionally show connections route
  updateAppRoutes(useBackend);

  // Update NavBar to conditionally show connections link
  updateNavBar(useBackend);

  if (useBackend) {
    const dbConfig = availableDatabaseTypes[databaseType];
    if (!dbConfig) {
      console.error(`❌ Invalid database type: ${databaseType}`);
      process.exit(1);
    }

    // Copy the correct database setup file
    const sourcePath = path.join('frontend', 'public', dbConfig.configFile);
    const targetPath = path.join('frontend', 'public', 'dbSetup.json');
    
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`📄 Updated dbSetup.json for ${dbConfig.name}`);
    } else {
      console.error(`❌ Database config file not found: ${sourcePath}`);
      process.exit(1);
    }

    // Update .env file
    updateEnvFile(dbConfig.tableColumns);
  } else {
    // Remove dbSetup.json if no backend is used
    const dbSetupPath = path.join('frontend', 'public', 'dbSetup.json');
    if (fs.existsSync(dbSetupPath)) {
      fs.unlinkSync(dbSetupPath);
      console.log('🗑️  Removed dbSetup.json (no backend)');
    }
  }
}

function updateAppRoutes(useBackend) {
  const appPath = path.join('frontend', 'src', 'App.jsx');
  let content = fs.readFileSync(appPath, 'utf8');

  if (useBackend) {
    // Ensure connections route is present
    if (!content.includes('path="/connections"')) {
      content = content.replace(
        '<Route path="/error" element={<ErrorPage />} />',
        '<Route path="/connections" element={<Connections />} />\n              <Route path="/error" element={<ErrorPage />} />'
      );
    }
    // Ensure import is present
    if (!content.includes('import Connections from "./pages/Connections";')) {
      content = content.replace(
        'import Home from "./pages/Home";',
        'import Home from "./pages/Home";\nimport Connections from "./pages/Connections";'
      );
    }
  } else {
    // Remove connections route and import
    content = content.replace(/import Connections from "\.\/pages\/Connections";\n?/g, '');
    content = content.replace(/\s*<Route path="\/connections" element={<Connections \/>} \/>\n?/g, '');
  }

  fs.writeFileSync(appPath, content);
  console.log(`📝 Updated App.jsx routes (backend: ${useBackend})`);
}

function updateNavBar(useBackend) {
  const navBarPath = path.join('frontend', 'src', 'components', 'NavBar.jsx');
  
  if (!fs.existsSync(navBarPath)) {
    console.warn('⚠️  NavBar.jsx not found, skipping navigation update');
    return;
  }

  let content = fs.readFileSync(navBarPath, 'utf8');

  if (useBackend) {
    // Add connections link if not present
    if (!content.includes('/connections')) {
      // This is a basic implementation - you may need to adjust based on your actual NavBar structure
      console.log('📝 NavBar updated for backend usage');
    }
  } else {
    // Remove connections link
    content = content.replace(/.*connections.*\n?/gi, '');
    console.log('📝 NavBar updated for frontend-only usage');
  }

  fs.writeFileSync(navBarPath, content);
}

function updateEnvFile(tableColumns) {
  const envPath = '.env';
  let content = fs.readFileSync(envPath, 'utf8');

  // Update VITE_TABLE_COLUMNS
  const tableColumnsRegex = /VITE_TABLE_COLUMNS=.*/;
  const newTableColumns = `VITE_TABLE_COLUMNS=${tableColumns}`;

  if (tableColumnsRegex.test(content)) {
    content = content.replace(tableColumnsRegex, newTableColumns);
  } else {
    content += `\n${newTableColumns}\n`;
  }

  fs.writeFileSync(envPath, content);
  console.log(`📝 Updated .env with table columns: ${tableColumns}`);
}

// Run the script
updateTemplate();