#!/usr/bin/env node
/**
 * Installs from monorepo root. Shipped inside apps/widget so it is always present in the
 * deployment bundle. Uses only Node (no bash — avoids exit 127 on Vercel).
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function findMonorepoRoot() {
  const tryDir = (start) => {
    let d = start;
    for (;;) {
      const lock = path.join(d, "package-lock.json");
      const pkgPath = path.join(d, "package.json");
      if (fs.existsSync(lock) && fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
          if (pkg.name === "adventure-monorepo") return d;
        } catch {
          /* continue */
        }
      }
      const parent = path.dirname(d);
      if (parent === d) break;
      d = parent;
    }
    return null;
  };
  return tryDir(process.cwd()) || tryDir(__dirname);
}

const root = findMonorepoRoot();
if (!root) {
  console.error(
    "vercel-install: adventure-monorepo root not found. Use: npm run prod:widget (deploys from git root).",
  );
  process.exit(1);
}
process.chdir(root);
console.error("vercel-install: cwd", root);
try {
  execSync("npm ci --no-audit --no-fund", { stdio: "inherit" });
} catch {
  console.error("vercel-install: npm ci failed; running npm install");
  execSync("npm install --no-audit --no-fund", { stdio: "inherit" });
}
