import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  isSystemOwnedSubcategory,
  listCatalogImages,
  persistGeneratedCatalogImages,
  SUBCATEGORY_IMAGE_CATALOG_MODEL_ID,
  SUBCATEGORY_IMAGE_CATALOG_SEED_COUNT,
} from "@/lib/subcategory-image-catalog";
import {
  ensureRefinementLibraryForSubcategory,
  resolveDspyServiceBaseUrls,
} from "@adventure/refinement-server";

export const dynamic = "force-dynamic";

function resolveFormServiceBaseUrls(): string[] {
  return resolveDspyServiceBaseUrls();
}

function logSeed(label: string, data: Record<string, unknown>) {
  try {
    const text = JSON.stringify(data);
    console.log(`[subcategory-seed] ${label} ${text.length > 4000 ? `${text.slice(0, 4000)}...` : text}`);
  } catch {
    console.log(`[subcategory-seed] ${label}`);
  }
}

async function callFormServiceUpstream(params: {
  baseUrls: string[];
  path: string;
  payload: any;
}): Promise<{ ok: true; json: any } | { ok: false; error: any }> {
  let lastErr: any = null;
  for (const baseUrl of params.baseUrls) {
    const endpoint = new URL(params.path, baseUrl).toString();
    try {
      const resp = await fetch(endpoint, {
        body: JSON.stringify(params.payload),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const text = await resp.text().catch(() => "");
      const json = text
        ? (() => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })()
        : null;
      if (!resp.ok) {
        lastErr = { details: json ?? text.slice(0, 2000), status: resp.status };
        continue;
      }
      return { json: json ?? {}, ok: true };
    } catch (error) {
      lastErr = error instanceof Error ? error.message : String(error);
    }
  }
  return { error: lastErr, ok: false };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const instanceId = typeof body?.instanceId === "string" ? body.instanceId.trim() : "";
    if (!instanceId) {
      return NextResponse.json({ error: "Missing instanceId" }, { status: 400 });
    }

    const userClient = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookies().getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, options, value }) => cookies().set(name, value, options));
            } catch {}
          },
        },
      },
    );

    const { data: authData } = await userClient.auth.getUser();
    const user = authData?.user ?? null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: instance, error: instanceError } = await admin
      .from("instances")
      .select("id, account_id, company_summary")
      .eq("id", instanceId)
      .maybeSingle();
    if (instanceError) {
      return NextResponse.json({ error: instanceError.message || "Failed to load instance" }, { status: 500 });
    }
    if (!instance?.account_id) {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await admin
      .from("user_accounts")
      .select("user_status")
      .eq("user_id", user.id)
      .eq("account_id", instance.account_id)
      .maybeSingle();
    if (membershipError) {
      return NextResponse.json({ error: membershipError.message || "Failed to verify permissions" }, { status: 500 });
    }
    const allowedRoles = new Set(["owner", "admin"]);
    if (!membership || !allowedRoles.has(String((membership as any).user_status || ""))) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { data: instanceSubcategories, error: subcategoriesError } = await admin
      .from("instance_subcategories")
      .select(`
        category_subcategory_id,
        categories_subcategories (
          id,
          category_id,
          subcategory,
          service_summary,
          subcategory_components,
          account_id,
          user_id,
          categories ( name )
        )
      `)
      .eq("instance_id", instanceId);
    if (subcategoriesError) {
      return NextResponse.json({ error: subcategoriesError.message || "Failed to load services" }, { status: 500 });
    }

    const baseUrls = resolveFormServiceBaseUrls();
    if (baseUrls.length === 0) {
      return NextResponse.json({ error: "DSPy service URL is not configured" }, { status: 500 });
    }

    const targets = new Map<string, any>();
    for (const row of Array.isArray(instanceSubcategories) ? instanceSubcategories : []) {
      const subcategory = (row as any)?.categories_subcategories;
      const id =
        typeof subcategory?.id === "string"
          ? subcategory.id
          : typeof (row as any)?.category_subcategory_id === "string"
            ? (row as any).category_subcategory_id
            : "";
      if (!id || targets.has(id)) continue;
      targets.set(id, subcategory);
    }

    const summary = {
      catalogSeededSubcategories: 0,
      catalogSkippedExisting: 0,
      catalogStoredImages: 0,
      checked: 0,
      failures: [] as Array<{ subcategoryId: string; error: string }>,
      refinementPlannerCalls: 0,
      refinementSeededSubcategories: 0,
      refinementSkippedExisting: 0,
      refinementStoredImages: 0,
      skippedCustom: 0,
    };

    logSeed("start", {
      baseUrls,
      instanceId,
      subcategoryCount: targets.size,
    });

    for (const [subcategoryId, rawSubcategory] of Array.from(targets.entries())) {
      summary.checked += 1;
      const subcategory = rawSubcategory as any;
      if (!subcategory || !isSystemOwnedSubcategory(subcategory)) {
        logSeed("skip_custom", { instanceId, subcategoryId });
        summary.skippedCustom += 1;
        continue;
      }

      const categoryId = typeof subcategory?.category_id === "string" ? String(subcategory.category_id) : null;
      const subcategoryName = typeof subcategory?.subcategory === "string" ? String(subcategory.subcategory) : "Service";
      const categoryName =
        subcategory?.categories && typeof subcategory.categories === "object" && typeof subcategory.categories.name === "string"
          ? String(subcategory.categories.name)
          : null;
      const serviceSummary =
        typeof subcategory?.service_summary === "string" && subcategory.service_summary.trim()
          ? String(subcategory.service_summary).trim()
          : [categoryName, subcategoryName].filter(Boolean).join(": ");

      const existingCatalog = await listCatalogImages({
        accountId: null,
        includeGlobal: true,
        subcategoryId,
        supabase: admin,
      });

      if (existingCatalog.length > 0) {
        logSeed("style_seed_skip_existing", {
          existingCount: existingCatalog.length,
          instanceId,
          subcategoryId,
        });
        summary.catalogSkippedExisting += 1;
      } else {
        const catalogPayload = {
          categoryName,
          count: SUBCATEGORY_IMAGE_CATALOG_SEED_COUNT,
          industry: categoryName,
          instanceId,
          modelId: SUBCATEGORY_IMAGE_CATALOG_MODEL_ID,
          service: subcategoryName,
          serviceSummary,
          session: {
            instanceId,
            sessionId: `subcategory-seed:${subcategoryId}`,
          },
          subcategoryId,
          subcategoryName,
        };

        const upstreamCatalog = await callFormServiceUpstream({
          baseUrls,
          path: "/v1/api/subcategory-catalog/generate",
          payload: catalogPayload,
        });

        if (!upstreamCatalog.ok) {
          logSeed("style_seed_upstream_failed", {
            error: upstreamCatalog.error,
            instanceId,
            subcategoryId,
          });
          summary.failures.push({
            error: typeof upstreamCatalog.error === "string" ? upstreamCatalog.error : "Failed to generate subcategory catalog images",
            subcategoryId,
          });
        } else if (!Array.isArray(upstreamCatalog.json?.options)) {
          summary.failures.push({
            error: "Subcategory catalog response was missing generated options",
            subcategoryId,
          });
        } else {
          const rawSeedOptions = Array.isArray(upstreamCatalog.json?.concepts)
            ? upstreamCatalog.json.concepts
            : Array.isArray(upstreamCatalog.json?.options)
              ? upstreamCatalog.json.options
              : [];
          const seedOptions = rawSeedOptions
            .filter((item: any) => item && typeof item === "object")
            .map((item: any) => ({
              description:
                typeof item.description === "string"
                  ? item.description
                  : typeof item.descriptor === "string"
                    ? item.descriptor
                    : null,
              imagePrompt:
                typeof item.imagePrompt === "string"
                  ? item.imagePrompt
                  : typeof item.image_prompt === "string"
                    ? item.image_prompt
                    : null,
              label: typeof item.label === "string" ? item.label : null,
              priceTier:
                typeof item.priceTier === "string"
                  ? item.priceTier
                  : typeof item.price_tier === "string"
                    ? item.price_tier
                    : null,
              value: typeof item.value === "string" ? item.value : null,
            }));
          const question =
            typeof upstreamCatalog.json?.question === "string" && upstreamCatalog.json.question.trim()
              ? String(upstreamCatalog.json.question).trim()
              : `Choose a starting visual direction for ${subcategoryName}.`;

          const storedCatalogImages = await persistGeneratedCatalogImages({
            categoryName,
            generatedOptions: upstreamCatalog.json.options,
            instanceId,
            options: seedOptions,
            question,
            scope: "global",
            serviceSummary,
            source: "instance_seed",
            stepId: `internal-subcategory-seed:${subcategoryId}`,
            subcategoryId,
            subcategoryName,
            supabase: admin,
          });

          if (storedCatalogImages > 0) {
            summary.catalogSeededSubcategories += 1;
            summary.catalogStoredImages += storedCatalogImages;
            logSeed("style_seed_stored_success", {
              instanceId,
              storedCatalogImages,
              subcategoryId,
            });
          } else {
            summary.failures.push({
              error: "Catalog generation completed but no images were stored",
              subcategoryId,
            });
          }
        }
      }

      const refinementResult = await ensureRefinementLibraryForSubcategory({
        baseUrls,
        categoryId,
        categoryName,
        companySummary: (instance as any)?.company_summary ?? null,
        instanceId,
        mode: "instance_seed",
        serviceSummary,
        subcategoryId,
        subcategoryName,
        supabase: admin,
        existingSubcategoryComponents: (subcategory as any)?.subcategory_components,
        log: logSeed,
      });

      if (refinementResult.plannerCalled) {
        summary.refinementPlannerCalls += 1;
      }
      if (refinementResult.skipped) {
        summary.refinementSkippedExisting += 1;
        logSeed("refinement_skip_existing", { instanceId, subcategoryId });
      } else if (!refinementResult.ok) {
        summary.failures.push({
          error: refinementResult.error || "Refinement library seed failed",
          subcategoryId,
        });
        logSeed("refinement_seed_failed", {
          error: refinementResult.error,
          instanceId,
          subcategoryId,
        });
      } else {
        const n = refinementResult.storedImages || 0;
        summary.refinementStoredImages += n;
        if (n > 0) {
          summary.refinementSeededSubcategories += 1;
          logSeed("refinement_stored_success", {
            instanceId,
            storedRefinements: n,
            subcategoryId,
          });
        }
      }
    }

    logSeed("done", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error: any) {
    logSeed("fatal", {
      error: error?.message ? String(error.message) : String(error),
    });
    return NextResponse.json(
      { error: error?.message ? String(error.message) : "Failed to seed style-seed and refinement images" },
      { status: 500 },
    );
  }
}
