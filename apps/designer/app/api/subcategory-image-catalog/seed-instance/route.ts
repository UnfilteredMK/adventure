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

export const dynamic = "force-dynamic";

function normalizeServiceUrl(raw: unknown): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  return s.replace(/\/+$/, "");
}

function resolveFormServiceBaseUrls(): string[] {
  const isRuntimeProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  const serverDevModeFlag = String(process.env.AI_FORM_DEV_MODE || "").trim().toLowerCase();
  const clientDevModeFlag = isRuntimeProduction
    ? ""
    : String(process.env.NEXT_PUBLIC_AI_FORM_DEV_MODE || "").trim().toLowerCase();
  const forceDev = serverDevModeFlag === "true" || clientDevModeFlag === "true";
  const forceProd = serverDevModeFlag === "false" || clientDevModeFlag === "false";
  const isDevMode = forceDev || (!forceProd && !isRuntimeProduction);
  const devUrl = normalizeServiceUrl(process.env.DEV_DSPY_SERVICE_URL || "");
  const prodUrl = normalizeServiceUrl(process.env.PROD_DSPY_SERVICE_URL || process.env.DSPY_SERVICE_URL || "");
  const urls: string[] = [];
  if (isDevMode) {
    if (devUrl) urls.push(devUrl);
    if (prodUrl) urls.push(prodUrl);
  } else {
    if (prodUrl) urls.push(prodUrl);
    if (devUrl) urls.push(devUrl);
  }
  return Array.from(new Set(urls)).filter(Boolean);
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
      .select("id, account_id")
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
          subcategory,
          service_summary,
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
      const id = typeof subcategory?.id === "string" ? subcategory.id : typeof (row as any)?.category_subcategory_id === "string" ? (row as any).category_subcategory_id : "";
      if (!id || targets.has(id)) continue;
      targets.set(id, subcategory);
    }

    const summary = {
      checked: 0,
      failures: [] as Array<{ subcategoryId: string; error: string }>,
      seededSubcategories: 0,
      skippedCustom: 0,
      skippedExisting: 0,
      storedImages: 0,
    };

    logSeed("start", {
      baseUrls,
      instanceId,
      subcategoryCount: targets.size,
    });

    for (const [subcategoryId, rawSubcategory] of targets.entries()) {
      summary.checked += 1;
      const subcategory = rawSubcategory as any;
      if (!subcategory || !isSystemOwnedSubcategory(subcategory)) {
        logSeed("skip_custom", { instanceId, subcategoryId });
        summary.skippedCustom += 1;
        continue;
      }

      const existing = await listCatalogImages({
        accountId: null,
        includeGlobal: true,
        subcategoryId,
        supabase: admin,
      });
      if (existing.length > 0) {
        logSeed("skip_existing", {
          existingCount: existing.length,
          instanceId,
          subcategoryId,
        });
        summary.skippedExisting += 1;
        continue;
      }

      const subcategoryName = typeof subcategory?.subcategory === "string" ? String(subcategory.subcategory) : "Service";
      const categoryName =
        subcategory?.categories && typeof subcategory.categories === "object" && typeof subcategory.categories.name === "string"
          ? String(subcategory.categories.name)
          : null;
      const serviceSummary =
        typeof subcategory?.service_summary === "string" && subcategory.service_summary.trim()
          ? String(subcategory.service_summary).trim()
          : [categoryName, subcategoryName].filter(Boolean).join(": ");
      const payload = {
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

      logSeed("upstream_request", {
        categoryName,
        instanceId,
        serviceSummary,
        subcategoryId,
        subcategoryName,
      });

      const upstream = await callFormServiceUpstream({
        baseUrls,
        path: "/v1/api/subcategory-catalog/generate",
        payload,
      });
      if (!upstream.ok || !Array.isArray(upstream.json?.options)) {
        logSeed("upstream_failed", {
          error: upstream.error,
          instanceId,
          responseKeys: upstream.ok && upstream.json && typeof upstream.json === "object" ? Object.keys(upstream.json) : [],
          subcategoryId,
        });
        summary.failures.push({
          error: typeof upstream.error === "string" ? upstream.error : "Failed to generate seed images",
          subcategoryId,
        });
        continue;
      }

      const optionImageCount = upstream.json.options.filter(
        (item: any) =>
          item &&
          typeof item === "object" &&
          (typeof item.imageUrl === "string" || typeof item.image_url === "string" || typeof item.image === "string"),
      ).length;
      logSeed("upstream_response", {
        imageStats: upstream.json.imageStats ?? null,
        instanceId,
        optionCount: Array.isArray(upstream.json.options) ? upstream.json.options.length : 0,
        optionImageCount,
        plannerSource: upstream.json.plannerSource ?? null,
        question: upstream.json.question ?? null,
        requestId: upstream.json.requestId ?? null,
        subcategoryId,
        targetCount: upstream.json.targetCount ?? null,
      });

      const rawSeedOptions = Array.isArray(upstream.json?.concepts)
        ? upstream.json.concepts
        : Array.isArray(upstream.json?.options)
          ? upstream.json.options
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
        typeof upstream.json?.question === "string" && upstream.json.question.trim()
          ? String(upstream.json.question).trim()
          : `Choose a starting visual direction for ${subcategoryName}.`;

      const stored = await persistGeneratedCatalogImages({
        categoryName,
        generatedOptions: upstream.json.options,
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

      if (stored > 0) {
        logSeed("stored_success", {
          instanceId,
          stored,
          subcategoryId,
        });
        summary.seededSubcategories += 1;
        summary.storedImages += stored;
      } else {
        logSeed("stored_zero", {
          generatedOptionCount: Array.isArray(upstream.json.options) ? upstream.json.options.length : 0,
          instanceId,
          normalizedSeedOptionCount: seedOptions.length,
          subcategoryId,
        });
        summary.failures.push({
          error: "Generation completed but no images were stored",
          subcategoryId,
        });
      }
    }

    logSeed("done", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error: any) {
    logSeed("fatal", {
      error: error?.message ? String(error.message) : String(error),
    });
    return NextResponse.json(
      { error: error?.message ? String(error.message) : "Failed to seed subcategory catalog" },
      { status: 500 },
    );
  }
}
