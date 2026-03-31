#!/usr/bin/env node
/**
 * Fill `prompts.suggestion_label` using Groq (small/fast model) from each row's `prompt`.
 *
 * CSV mode from repo root (paths are relative to cwd):
 *   npm run scripts:fill-suggestion-labels -- prompts_rows.csv -o prompts_rows.labeled.csv
 *
 * Or from apps/widget:
 *   node ./scripts/fill-prompt-suggestion-labels.mjs ../../prompts_rows.csv -o ../../out.csv
 *
 * DB mode (updates `prompts` in Supabase directly):
 *   node ./scripts/fill-prompt-suggestion-labels.mjs --db --skip-existing
 *
 * Push CSV to DB (no AI): sets `prompts.suggestion_label` by `id`. Uses CSV `suggestion_label`
 * when set; if empty, falls back to truncated `prompt` so every row with an id can be updated.
 *   npm run scripts:fill-suggestion-labels -- prompts_rows.labeled.csv --push-csv
 *
 * Env:
 *   GROQ_API_KEY          (required for generate modes only)
 *   GROQ_MODEL            (optional, default: llama-3.1-8b-instant)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — for --db and --push-csv
 *
 * Flags:
 *   --output, -o <path>   CSV output path (default: <input>.labeled.csv)
 *   --dry-run             Do not write file or DB
 *   --skip-existing       Skip rows that already have a non-empty suggestion_label
 *   --limit <n>           Max rows to process (DB default fetch window: 5000 if omitted)
 *   --concurrency <n>     Parallel Groq / DB updates (default 3)
 *   --db                  Read/update Supabase `prompts` instead of CSV
 *   --push-csv            Upload `suggestion_label` from CSV to Supabase by row `id`
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import OpenAI from "openai";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, "../../../env/.env.shared.local") });
dotenv.config({ path: resolve(__dirname, "../.env.local") });

const LABEL_MAX = 50;

function parseArgs(argv) {
  const out = {
    inputPath: null,
    outputPath: null,
    dryRun: false,
    skipExisting: false,
    limit: null,
    concurrency: 3,
    db: false,
    pushCsv: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--push-csv" || a === "--import-csv") out.pushCsv = true;
    else if (a === "--db") out.db = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--skip-existing") out.skipExisting = true;
    else if (a === "--limit") out.limit = Math.max(0, Number(argv[++i] ?? 0)) || null;
    else if (a === "--concurrency") out.concurrency = Math.max(1, Number(argv[++i] ?? 1));
    else if (a === "-o" || a === "--output") out.outputPath = argv[++i] || null;
    else if (!a.startsWith("-") && !out.inputPath) out.inputPath = a;
  }
  return out;
}

/** RFC 4180-style parse: commas/newlines inside double quotes */
function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < content.length) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function escapeCsvField(s) {
  const str = String(s ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows) {
  return rows.map((r) => r.map(escapeCsvField).join(",")).join("\n") + "\n";
}

function cleanOneLine(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function clampLabel(s, max = LABEL_MAX) {
  const t = cleanOneLine(s);
  if (!t) return "";
  if (t.length <= max) return t;
  const slice = t.slice(0, Math.max(0, max - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${head}…`;
}

/** Matches `buildSuggestionLabel(fullPrompt)` when there is no short option (chip max length). */
function fallbackLabelFromPrompt(fullPrompt, maxLen = LABEL_MAX) {
  const p = String(fullPrompt || "").trim();
  if (!p) return "";
  return p.length <= maxLen ? p : `${p.slice(0, Math.max(0, maxLen - 1))}…`;
}

function indexSuggestionLabelColumn(header) {
  const i = header.indexOf("suggestion_label");
  if (i >= 0) return i;
  return header.indexOf("suggestion_labell");
}

const SYSTEM = [
  "You write a single short label for a UI suggestion chip (like a tag).",
  `Hard rules: Output exactly one line, plain text, max ${LABEL_MAX} characters, no quotes, no emojis.`,
  "Describe the specific visual or style choice the user is selecting — not the whole legal/boilerplate prompt.",
  "Ignore repeated instructions like photorealistic, no text, watermarks, split-screen, etc.",
  "If you see 'Refinement category: …' and 'Option: …', combine them into a tight phrase (e.g. 'Fluted oak vanity').",
  "If you see 'Option:' after a question about style, use that option as the core of the label.",
  "For short catalog-style prompts (e.g. 'Farmhouse kitchen with rustic charm'), keep that essence in few words.",
  "Do not end with a period.",
].join("\n");

function makeUserMessage(promptText) {
  return `Full prompt (may be long):\n---\n${String(promptText).trim()}\n---\n\nReturn only the chip label.`;
}

async function runWithConcurrency(items, concurrency, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * @param {{ inputPath: string, dryRun: boolean, limit: number | null, concurrency: number }} args
 */
async function pushLabeledCsvToDb(args) {
  if (!args.inputPath) {
    console.error("Usage: … <file.csv> --push-csv   (labeled export with id + suggestion_label)");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const abs = resolve(process.cwd(), args.inputPath);
  const raw = readFileSync(abs, "utf8");
  const rows = parseCsv(raw);
  if (rows.length < 2) {
    console.error("CSV has no data rows");
    process.exit(1);
  }
  const header = rows[0].map((h) => h.trim());
  const idxId = header.indexOf("id");
  const idxLabel = indexSuggestionLabelColumn(header);
  const idxPrompt = header.indexOf("prompt");
  if (idxId < 0 || idxLabel < 0) {
    console.error('CSV must include "id" and "suggestion_label" (or typo "suggestion_labell")');
    process.exit(1);
  }
  /** @type {{ id: string, suggestion_label: string }[]} */
  const updates = [];
  for (let r = 1; r < rows.length; r++) {
    while (rows[r].length < header.length) rows[r].push("");
    const id = String(rows[r][idxId] || "").trim();
    const fromCol = String(rows[r][idxLabel] || "").trim();
    const prompt = idxPrompt >= 0 ? String(rows[r][idxPrompt] || "").trim() : "";
    const suggestion_label = fromCol || fallbackLabelFromPrompt(prompt);
    if (!id) continue;
    if (!suggestion_label) continue;
    updates.push({ id, suggestion_label });
  }
  let list = updates;
  if (args.limit != null) list = list.slice(0, args.limit);
  console.log(
    `Push ${list.length} suggestion_label(s) to Supabase${args.dryRun ? " (dry-run)" : ""} (from ${abs})`
  );
  if (args.dryRun) {
    for (const u of list.slice(0, 5)) console.log(`  would update ${u.id} → ${u.suggestion_label}`);
    if (list.length > 5) console.log(`  … and ${list.length - 5} more`);
    return;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  let ok = 0;
  let fail = 0;
  await runWithConcurrency(list, args.concurrency, async (u) => {
    const { error } = await supabase.from("prompts").update({ suggestion_label: u.suggestion_label }).eq("id", u.id);
    if (error) {
      fail++;
      console.error(`  ✗ ${u.id}: ${error.message}`);
    } else {
      ok++;
      if (ok % 100 === 0) console.log(`  … ${ok} updated`);
    }
  });
  console.log(`Done: ${ok} updated, ${fail} failed`);
}

async function labelFromGroq(client, model, prompt) {
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: makeUserMessage(prompt) },
    ],
    temperature: 0.2,
    max_tokens: 64,
  });
  const rawLabel = completion.choices?.[0]?.message?.content || "";
  const label = clampLabel(rawLabel);
  if (!label) throw new Error("empty label");
  return label;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.pushCsv) {
    await pushLabeledCsvToDb(args);
    return;
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("Missing GROQ_API_KEY (not needed for --push-csv)");
    process.exit(1);
  }
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  /** @type {{ key: string, prompt: string }[]} */
  let tasks = [];

  /** CSV: rows, header idx, output path */
  let csvCtx = null;
  /** @type {import("@supabase/supabase-js").SupabaseClient | null} */
  let dbSupabase = null;

  if (args.db) {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error("DB mode requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
      process.exit(1);
    }
    dbSupabase = createClient(url, key, { auth: { persistSession: false } });
    const fetchCap = args.limit != null ? args.limit : 5000;
    let q = dbSupabase
      .from("prompts")
      .select("id, prompt, suggestion_label")
      .order("created_at", { ascending: true })
      .limit(fetchCap);
    if (args.skipExisting) {
      q = q.or('suggestion_label.is.null,suggestion_label.eq.""');
    }
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    tasks = rows
      .filter((r) => r?.id && String(r.prompt || "").trim())
      .map((r) => ({ key: r.id, prompt: r.prompt }));
  } else {
    if (!args.inputPath) {
      console.error(
        "Usage: node …/fill-prompt-suggestion-labels.mjs <export.csv> [-o out.csv] [flags]\n       node … --db [flags]\n       node … <labeled.csv> --push-csv"
      );
      process.exit(1);
    }
    const abs = resolve(process.cwd(), args.inputPath);
    const raw = readFileSync(abs, "utf8");
    const rows = parseCsv(raw);
    if (rows.length < 2) {
      console.error("CSV has no data rows");
      process.exit(1);
    }
    const header = rows[0].map((h) => h.trim());
    const idx = {
      id: header.indexOf("id"),
      prompt: header.indexOf("prompt"),
      label: header.indexOf("suggestion_label"),
    };
    if (idx.prompt < 0) {
      console.error('CSV must include a "prompt" column');
      process.exit(1);
    }
    if (idx.label < 0) {
      header.push("suggestion_label");
      idx.label = header.length - 1;
      rows[0] = header;
      for (let r = 1; r < rows.length; r++) {
        while (rows[r].length < header.length) rows[r].push("");
      }
    }
    for (let r = 1; r < rows.length; r++) {
      while (rows[r].length < header.length) rows[r].push("");
      const prompt = String(rows[r][idx.prompt] || "").trim();
      if (!prompt) continue;
      const existing = String(rows[r][idx.label] || "").trim();
      if (args.skipExisting && existing) continue;
      tasks.push({ key: String(r), prompt });
    }
    if (args.limit != null) tasks = tasks.slice(0, args.limit);
    csvCtx = {
      rows,
      idx,
      outputPath: args.outputPath || `${abs.replace(/\.csv$/i, "")}.labeled.csv`,
    };
  }

  console.log(`Processing ${tasks.length} row(s) with Groq model ${model}${args.dryRun ? " (dry-run)" : ""}`);

  /** @type {Map<string, string>} */
  const labelByKey = new Map();
  let fail = 0;

  await runWithConcurrency(tasks, args.concurrency, async (task) => {
    try {
      const label = await labelFromGroq(client, model, task.prompt);
      labelByKey.set(task.key, label);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${task.key}: ${e?.message || e}`);
    }
  });

  if (!args.dryRun && args.db && dbSupabase) {
    for (const task of tasks) {
      const label = labelByKey.get(task.key);
      if (!label) continue;
      const { error } = await dbSupabase.from("prompts").update({ suggestion_label: label }).eq("id", task.key);
      if (error) console.error(`  ✗ DB update ${task.key}: ${error.message}`);
    }
  }

  if (!args.dryRun && csvCtx) {
    const { rows, idx } = csvCtx;
    for (let r = 1; r < rows.length; r++) {
      const label = labelByKey.get(String(r));
      if (label) rows[r][idx.label] = label;
    }
    writeFileSync(csvCtx.outputPath, rowsToCsv(rows), "utf8");
    console.log(`Wrote ${csvCtx.outputPath}`);
  }

  console.log(`Done: ${labelByKey.size} ok, ${fail} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
