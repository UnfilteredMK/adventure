#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function log() {}

function logStep(step, message) {
  log(`\n${step}. ${message}`);
}

function logSuccess(message) {
  log(`✅ ${message}`);
}

function logError(message) {
  log(`❌ ${message}`);
}

function logWarning(message) {
  log(`⚠️  ${message}`);
}

function sortObjectKeys(obj) {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return obj;
  }

  const sorted = {};
  Object.keys(obj)
    .sort()
    .forEach((key) => {
      sorted[key] = sortObjectKeys(obj[key]);
    });

  return sorted;
}

function sortConfigsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, "utf8");
    let modified = false;

    const configRegex = /(const\s+\w+\s*=\s*\{[\s\S]*?\};)/g;
    content = content.replace(configRegex, (match) => {
      try {
        const objectMatch = match.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          const objectStr = objectMatch[0];
          const jsonStr = objectStr.replace(/'/g, '"').replace(/(\w+):/g, '"$1":');
          const parsed = JSON.parse(jsonStr);
          const sorted = sortObjectKeys(parsed);
          const sortedStr = JSON.stringify(sorted, null, 2)
            .replace(/"/g, "'")
            .replace(/'(\w+)':/g, "$1:");

          const newMatch = match.replace(objectStr, sortedStr);
          modified = true;
          return newMatch;
        }
      } catch (e) {
        // leave as-is
      }
      return match;
    });

    if (modified) {
      fs.writeFileSync(filePath, content, "utf8");
      logSuccess(`Sorted configs in ${path.relative(process.cwd(), filePath)}`);
    }
  } catch (error) {
    logWarning(`Could not process ${filePath}: ${error.message}`);
  }
}

function sortConfigsInDirectory(dir) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory() && !file.startsWith(".") && file !== "node_modules") {
      sortConfigsInDirectory(filePath);
    } else if (file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js") || file.endsWith(".jsx")) {
      sortConfigsInFile(filePath);
    }
  });
}

async function main() {
  log("🚀 Starting Supabase Update Process...");

  const root = repoRoot();
  const designerDir = path.join(root, "apps", "designer");
  const widgetDir = path.join(root, "apps", "widget");

  try {
    logStep(1, "Updating shared Supabase types...");
    execSync(
      `cd "${root}" && npm run supabase:gen:types`,
      { stdio: "inherit" }
    );
    logSuccess("Shared Supabase types updated");

    logStep(2, "Sorting config objects alphabetically in Designer app...");
    sortConfigsInDirectory(path.join(designerDir, "src"));
    logSuccess("Designer configs sorted");

    logStep(3, "Sorting config objects alphabetically in Widget app...");
    sortConfigsInDirectory(widgetDir);
    logSuccess("Widget configs sorted");

    logStep(4, "Ensuring package.json scripts exist...");

    // Designer package.json
    const designerPackagePath = path.join(designerDir, "package.json");
    const designerPackage = JSON.parse(fs.readFileSync(designerPackagePath, "utf8"));
    if (!designerPackage.scripts["db:update"]) {
      designerPackage.scripts["db:update"] = "node ../../scripts/update-supabase.js";
    }
    if (!designerPackage.scripts["sort:configs"]) {
      designerPackage.scripts["sort:configs"] = "node ../../scripts/sort-configs.js";
    }
    fs.writeFileSync(designerPackagePath, JSON.stringify(designerPackage, null, 2) + "\n");

    // Widget package.json
    const widgetPackagePath = path.join(widgetDir, "package.json");
    const widgetPackage = JSON.parse(fs.readFileSync(widgetPackagePath, "utf8"));
    if (!widgetPackage.scripts["db:update"]) {
      widgetPackage.scripts["db:update"] = "node ../../scripts/update-supabase.js";
    }
    if (!widgetPackage.scripts["sort:configs"]) {
      widgetPackage.scripts["sort:configs"] = "node ../../scripts/sort-configs.js";
    }
    fs.writeFileSync(widgetPackagePath, JSON.stringify(widgetPackage, null, 2) + "\n");

    logSuccess("package.json scripts updated");

    log("\n🎉 Supabase Update Complete!");
  } catch (error) {
    logError(`Failed to update Supabase: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, sortObjectKeys };
