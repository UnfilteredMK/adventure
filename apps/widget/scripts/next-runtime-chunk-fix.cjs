const path = require("path");
const Module = require("module");

function normalizePath(p) {
  return typeof p === "string" ? p.split(path.sep).join("/") : "";
}

const logged = new Set();

function isWebpackRuntime(parentFilename) {
  if (typeof parentFilename !== "string") return false;
  const normalized = normalizePath(parentFilename);
  return normalized.endsWith("/.next/server/webpack-runtime.js");
}

function toChunkShimRequest(request) {
  if (typeof request !== "string") return null;
  const m = request.match(/^\.\/(\d+)\.js$/);
  if (!m) return null;
  return `./chunks/${m[1]}.js`;
}

function toVendorChunkShimRequest(request) {
  if (typeof request !== "string") return null;
  const m = request.match(/^\.\/vendor-chunks\/(.+)\.js$/);
  if (!m) return null;
  return `./chunks/vendor-chunks/${m[1]}.js`;
}

function installResolvePatch() {
  const current = Module._resolveFilename;
  if (current && current.__widgetNextRuntimeChunkFixInstalled) return;

  function patchedResolveFilename(request, parent, isMain, options) {
    try {
      return current.call(this, request, parent, isMain, options);
    } catch (err) {
      if (!err || err.code !== "MODULE_NOT_FOUND") throw err;
      const parentFilename = parent && parent.filename;
      if (!isWebpackRuntime(parentFilename)) throw err;

      const altCandidates = [toChunkShimRequest(request), toVendorChunkShimRequest(request)].filter(Boolean);
      if (altCandidates.length === 0) throw err;

      for (const alt of altCandidates) {
        const key = `${request}=>${alt}`;
        if (!logged.has(key)) {
          logged.add(key);
          // eslint-disable-next-line no-console
          console.warn(`[widget] Remapping ${request} to ${alt} for Next server runtime chunks.`);
        }
        try {
          return current.call(this, alt, parent, isMain, options);
        } catch (altErr) {
          if (!altErr || altErr.code !== "MODULE_NOT_FOUND") throw altErr;
        }
      }
      throw err;
    }
  }

  patchedResolveFilename.__widgetNextRuntimeChunkFixInstalled = true;
  Module._resolveFilename = patchedResolveFilename;
}

// Next.js overwrites `Module._resolveFilename` when it loads
// `next/dist/server/require-hook`. Re-install after that happens.
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  const result = originalLoad.apply(this, arguments);
  try {
    if (typeof request === "string") {
      const normalized = request.includes(path.sep) ? normalizePath(request) : request;
      if (normalized === "next/dist/server/require-hook" || normalized.endsWith("/next/dist/server/require-hook")) {
        installResolvePatch();
      }
    }
  } catch {}
  return result;
};

installResolvePatch();
