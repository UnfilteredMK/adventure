#!/usr/bin/env node
/**
 * Clears the Vercel project "Install Command" dashboard override via REST API
 * so each app's vercel.json installCommand is respected (e.g. node vercel-install.cjs).
 *
 * Requires: VERCEL_TOKEN (https://vercel.com/account/tokens)
 * Team (omit for personal / Hobby): VERCEL_TEAM_ID, VERCEL_SCOPE, or teamScope in env/schema.json
 *
 * Usage:
 *   node scripts/vercel-clear-install-override.js
 *   node scripts/vercel-clear-install-override.js --dry-run
 *   node scripts/vercel-clear-install-override.js --project adv-widget --project adv-designer
 *   node scripts/vercel-clear-install-override.js --all-apps
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "env", "schema.json");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function loadSchema() {
  if (!fs.existsSync(SCHEMA_PATH)) return null;
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const allApps = argv.includes("--all-apps");
  const projects = [];
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project" && argv[i + 1]) {
      projects.push(argv[i + 1]);
      i += 1;
    }
  }
  return { dryRun, allApps, projects };
}

function defaultProjectNames(schema, allApps) {
  if (allApps && schema && schema.apps) {
    return Object.values(schema.apps)
      .map((a) => a.projectName)
      .filter(Boolean);
  }
  return ["adv-widget", "adv-designer"];
}

function resolveTeamId(schema) {
  const fromEnv =
    String(process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || "").trim() ||
    String(process.env.VERCEL_SCOPE || "").trim();
  if (fromEnv) return fromEnv;
  if (schema && schema.teamScope) return String(schema.teamScope).trim();
  return "";
}

function assertValidToken(token) {
  if (!token) {
    fail("Set VERCEL_TOKEN (create at https://vercel.com/account/tokens)");
  }
  // HTTP header values must be Latin-1. Placeholders like "…" crash fetch.
  if (/[\u0080-\uFFFF]/.test(token)) {
    fail(
      "VERCEL_TOKEN contains non-ASCII characters (likely a placeholder like \"…\"). Paste the real token value."
    );
  }
}

async function vercelFetch(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  const token = String(process.env.VERCEL_TOKEN || "").trim();
  const { dryRun, allApps, projects: cliProjects } = parseArgs(process.argv);
  const schema = loadSchema();
  const projectNames =
    cliProjects.length > 0 ? cliProjects : defaultProjectNames(schema, allApps);
  const teamId = resolveTeamId(schema);

  assertValidToken(token);

  const base = "https://api.vercel.com/v9/projects";

  for (const name of projectNames) {
    const q = new URLSearchParams();
    if (teamId) q.set("teamId", teamId);
    const getUrl = `${base}/${encodeURIComponent(name)}${q.toString() ? `?${q.toString()}` : ""}`;

    if (dryRun) {
      const { ok, status, json } = await vercelFetch(getUrl, token, { method: "GET" });
      if (!ok) {
        console.error(`GET ${name}: ${status}`, json?.error || json);
        continue;
      }
      const cmd = json?.installCommand;
      console.log(`${name}: installCommand = ${cmd === null || cmd === undefined ? "(auto / vercel.json)" : JSON.stringify(cmd)}`);
      continue;
    }

    const { ok, status, json } = await vercelFetch(getUrl, token, {
      method: "PATCH",
      body: JSON.stringify({ installCommand: null })
    });

    if (!ok) {
      console.error(`PATCH ${name}: ${status}`, json?.error || json);
      process.exitCode = 1;
      continue;
    }
    console.log(`Cleared install command override for ${name} (Vercel will use vercel.json).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
