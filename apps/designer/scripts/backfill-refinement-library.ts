/**
 * One-time backfill: re-plan refinement components + option seeds, drop stale refinement_option rows,
 * regenerate missing images. Uses the same pipeline as instance seeding with forceReplan.
 *
 * From apps/designer (requires env in .env.local):
 *   npx tsx scripts/backfill-refinement-library.ts --dry-run --ids=<uuid>,<uuid>
 *   npx tsx scripts/backfill-refinement-library.ts --ids=<uuid>,<uuid>
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import {
  ensureRefinementLibraryForSubcategory,
  planRefinementLibrary,
  resolveDspyServiceBaseUrls,
} from "@adventure/refinement-server";

config({ path: ".env.local" });

function parseArgs(argv: string[]) {
  const out = { dryRun: false, ids: [] as string[] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--ids") out.ids = String(argv[++i] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return out;
}

async function main() {
  const { dryRun, ids } = parseArgs(process.argv.slice(2));
  if (ids.length === 0) {
    console.error("Usage: --ids=id1,id2 [--dry-run]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const baseUrls = resolveDspyServiceBaseUrls();
  if (baseUrls.length === 0) {
    console.error("DSPy service URL not configured (DEV_DSPY_SERVICE_URL / DSPY_SERVICE_URL)");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  for (const subcategoryId of ids) {
    const { data: row, error } = await supabase
      .from("categories_subcategories")
      .select("id, subcategory, category_id, service_summary, subcategory_components, categories(name)")
      .eq("id", subcategoryId)
      .maybeSingle();

    if (error || !row) {
      console.error(`Skip ${subcategoryId}:`, error?.message || "not found");
      continue;
    }

    const categoryName =
      row.categories && typeof row.categories === "object" && typeof (row.categories as any).name === "string"
        ? String((row.categories as any).name).trim()
        : null;
    const subcategoryName = typeof row.subcategory === "string" ? row.subcategory.trim() : "Service";
    const serviceSummary =
      typeof row.service_summary === "string" && row.service_summary.trim()
        ? row.service_summary.trim()
        : [categoryName, subcategoryName].filter(Boolean).join(": ");

    if (dryRun) {
      const planned = await planRefinementLibrary({
        baseUrls,
        categoryId: typeof row.category_id === "string" ? row.category_id : null,
        categoryName,
        companySummary: null,
        serviceSummary,
        subcategoryId,
        subcategoryName,
      });
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            ok: planned.ok ? planned.json?.ok : false,
            subcategoryId,
            preview: planned.ok && planned.json?.ok ? planned.json : planned,
          },
          null,
          2,
        ),
      );
      continue;
    }

    const result = await ensureRefinementLibraryForSubcategory({
      baseUrls,
      categoryId: typeof row.category_id === "string" ? row.category_id : null,
      categoryName,
      companySummary: null,
      forceReplan: true,
      instanceId: null,
      mode: "instance_seed",
      serviceSummary,
      subcategoryId,
      subcategoryName,
      supabase,
      existingSubcategoryComponents: row.subcategory_components,
      log: (label, data) => console.log(`[backfill] ${label}`, JSON.stringify(data)),
    });

    console.log(
      JSON.stringify(
        {
          subcategoryId,
          ...result,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
