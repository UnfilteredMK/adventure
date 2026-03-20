#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {}

function logStep(step, message) {
  log(`\n${step}. ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Function to sort object keys alphabetically
function sortObjectKeys(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return obj;
  }
  
  const sorted = {};
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = sortObjectKeys(obj[key]);
  });
  
  return sorted;
}

// Function to sort config objects in TypeScript files
function sortConfigsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // Find and sort config objects
    const configRegex = /(const\s+\w+\s*=\s*\{[\s\S]*?\};)/g;
    content = content.replace(configRegex, (match) => {
      // Try to parse as JSON-like object
      try {
        // Extract the object part
        const objectMatch = match.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          const objectStr = objectMatch[0];
          // Replace single quotes with double quotes for JSON parsing
          const jsonStr = objectStr.replace(/'/g, '"').replace(/(\w+):/g, '"$1":');
          const parsed = JSON.parse(jsonStr);
          const sorted = sortObjectKeys(parsed);
          const sortedStr = JSON.stringify(sorted, null, 2)
            .replace(/"/g, "'")
            .replace(/'(\w+)':/g, '$1:');
          
          const newMatch = match.replace(objectStr, sortedStr);
          modified = true;
          return newMatch;
        }
      } catch (e) {
        // If parsing fails, leave as is
      }
      return match;
    });
    
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      logSuccess(`Sorted configs in ${path.relative(process.cwd(), filePath)}`);
    }
  } catch (error) {
    logWarning(`Could not process ${filePath}: ${error.message}`);
  }
}

// Function to recursively find and sort configs in directories
function sortConfigsInDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      sortConfigsInDirectory(filePath);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
      sortConfigsInFile(filePath);
    }
  });
}

async function main() {
  log('🚀 Starting Supabase Update Process...', 'bright');
  
  try {
    // Step 1: Update shared types
    logStep(1, 'Updating shared Supabase types...');
    execSync('npm run supabase:gen:types', { stdio: 'inherit' });
    logSuccess('Shared Supabase types updated');
    
    // Step 2: Sort configs in Designer app
    logStep(2, 'Sorting config objects alphabetically in Designer app...');
    sortConfigsInDirectory('apps/designer/src');
    logSuccess('Designer configs sorted');
    
    // Step 3: Sort configs in Widget app
    logStep(3, 'Sorting config objects alphabetically in Widget app...');
    sortConfigsInDirectory('apps/widget');
    logSuccess('Widget configs sorted');
    
    // Step 4: Update package.json scripts
    logStep(4, 'Updating package.json scripts...');
    
    // Update designer package.json
    const designerPackagePath = 'apps/designer/package.json';
    const designerPackage = JSON.parse(fs.readFileSync(designerPackagePath, 'utf8'));
    if (!designerPackage.scripts['db:update']) {
      designerPackage.scripts['db:update'] = 'node ../../scripts/update-supabase.js';
      fs.writeFileSync(designerPackagePath, JSON.stringify(designerPackage, null, 2) + '\n');
      logSuccess('Added db:update script to designer package.json');
    }
    
    // Update widget package.json
    const widgetPackagePath = 'apps/widget/package.json';
    const widgetPackage = JSON.parse(fs.readFileSync(widgetPackagePath, 'utf8'));
    if (!widgetPackage.scripts['db:update']) {
      widgetPackage.scripts['db:update'] = 'node ../../scripts/update-supabase.js';
      fs.writeFileSync(widgetPackagePath, JSON.stringify(widgetPackage, null, 2) + '\n');
      logSuccess('Added db:update script to widget package.json');
    }
    
    // Update root package.json
    const rootPackagePath = 'package.json';
    if (fs.existsSync(rootPackagePath)) {
      const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
      if (!rootPackage.scripts['db:update']) {
        rootPackage.scripts['db:update'] = 'node scripts/update-supabase.js';
        fs.writeFileSync(rootPackagePath, JSON.stringify(rootPackage, null, 2) + '\n');
        logSuccess('Added db:update script to root package.json');
      }
    }
    
    log('\n🎉 Supabase Update Complete!', 'bright');
    log('\nYou can now run:', 'cyan');
    log('  npm run db:update    (from any app directory)', 'yellow');
    log('  pnpm run db:update   (from any app directory)', 'yellow');
    log('\nThis will:', 'cyan');
    log('  • Update Supabase types for both apps', 'yellow');
    log('  • Sort all config objects alphabetically', 'yellow');
    log('  • Keep everything in sync', 'yellow');
    
  } catch (error) {
    logError(`Failed to update Supabase: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main, sortObjectKeys }; 
