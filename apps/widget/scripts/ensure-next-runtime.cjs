const fs = require("fs");
const path = require("path");

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function safeRm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

const cwd = process.cwd();
const nextDir = path.join(cwd, ".next");
const runtimePath = path.join(nextDir, "server", "webpack-runtime.js");
const chunksDir = path.join(nextDir, "server", "chunks");
const vendorChunksDir = path.join(nextDir, "server", "chunks", "vendor-chunks");
const serverVendorChunksDir = path.join(nextDir, "server", "vendor-chunks");
const cacheDir = path.join(cwd, "node_modules", ".cache");

if (!exists(runtimePath) || !exists(chunksDir)) {
  process.exit(0);
}

// Ensure cache dir exists (avoids occasional ENOENT rename failures during webpack persistent caching)
try {
  fs.mkdirSync(path.join(nextDir, "cache"), { recursive: true });
  fs.mkdirSync(path.join(nextDir, "cache", "webpack"), { recursive: true });
  fs.mkdirSync(path.join(nextDir, "cache", "webpack", "client-development-fallback"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(nextDir, "cache", "webpack", "server-development-fallback"), {
    recursive: true,
  });
} catch {}

let runtimeText = "";
try {
  runtimeText = fs.readFileSync(runtimePath, "utf8");
} catch {
  process.exit(0);
}

const usesChunksPath = runtimeText.includes('require("./chunks/"');
if (usesChunksPath) {
  process.exit(0);
}

const usesRootPath =
  runtimeText.includes('require("./"+') ||
  runtimeText.includes('require("./" +') ||
  runtimeText.includes('require("./"+t.u') ||
  runtimeText.includes('require("./" + t.u') ||
  runtimeText.includes('require("./" + __webpack_require__.u');

if (!usesRootPath) {
  process.exit(0);
}

// If the runtime expects chunks at `.next/server/*.js` but they were emitted into
// `.next/server/chunks/*.js`, create tiny shims so `require("./193.js")` resolves.
let chunkFiles = [];
try {
  chunkFiles = fs.readdirSync(chunksDir);
} catch {
  chunkFiles = [];
}

const numericChunks = chunkFiles.filter((f) => /^\d+\.js$/.test(f));
if (numericChunks.length === 0) {
  console.warn(
    "[widget] Detected stale Next.js server runtime but found no numeric chunks. Clearing .next cache."
  );
  safeRm(nextDir);
  safeRm(cacheDir);
  process.exit(0);
}

const serverDir = path.join(nextDir, "server");
for (const file of numericChunks) {
  const shimPath = path.join(serverDir, file);
  const targetRel = `./chunks/${file}`;
  const shim = `module.exports = require(${JSON.stringify(targetRel)});\n`;

  let current = null;
  try {
    current = fs.readFileSync(shimPath, "utf8");
  } catch {}

  if (current !== shim) {
    try {
      fs.writeFileSync(shimPath, shim, "utf8");
    } catch {}
  }
}

let vendorChunkFiles = [];
try {
  vendorChunkFiles = fs.readdirSync(vendorChunksDir);
} catch {
  vendorChunkFiles = [];
}

if (vendorChunkFiles.length > 0) {
  try {
    fs.mkdirSync(serverVendorChunksDir, { recursive: true });
  } catch {}
  for (const file of vendorChunkFiles) {
    if (!file.endsWith(".js")) continue;
    const shimPath = path.join(serverVendorChunksDir, file);
    const targetRel = `../chunks/vendor-chunks/${file}`;
    const shim = `module.exports = require(${JSON.stringify(targetRel)});\n`;

    let current = null;
    try {
      current = fs.readFileSync(shimPath, "utf8");
    } catch {}

    if (current !== shim) {
      try {
        fs.writeFileSync(shimPath, shim, "utf8");
      } catch {}
    }
  }
}

console.warn(
  `[widget] Next.js server runtime expects root chunk requires; created ${numericChunks.length} numeric shims and ${vendorChunkFiles.length} vendor shims in .next/server/`
);
