/**
 * Refinements endpoint — builds refinement image grids from DB-backed component + image catalog,
 * then asks the form service to generate question copy only for those grids.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/server/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefinementCatalogOption = {
  label: string;
  value: string;
  imageUrl: string;
};

type RefinementCatalogItem = {
  key: string;
  label: string;
  priority: number;
  options: RefinementCatalogOption[];
};

function coerceSubcategoryComponents(
  raw: unknown,
): Array<{ key: string; label: string; priority: number }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: Array<{ key: string; label: string; priority: number }> = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const key = typeof (entry as any).key === "string" ? (entry as any).key.trim() : "";
    if (!key) continue;
    const dedupeKey = key.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const label =
      typeof (entry as any).label === "string" && (entry as any).label.trim()
        ? (entry as any).label.trim()
        : key;
    const priorityRaw = Number((entry as any).priority);
    items.push({
      key,
      label,
      priority: Number.isFinite(priorityRaw) ? priorityRaw : index + 1,
    });
  }
  return items;
}

function normalizeServiceUrl(raw: string): string {
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
  const prodUrl = normalizeServiceUrl(process.env.DSPY_SERVICE_URL || process.env.PROD_DSPY_SERVICE_URL || "");

  const urls: string[] = [];
  if (isDevMode) {
    if (devUrl) urls.push(devUrl);
    if (prodUrl) urls.push(prodUrl);
  } else {
    if (prodUrl) urls.push(prodUrl);
    if (devUrl) urls.push(devUrl);
  }
  return Array.from(new Set(urls));
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const s = value.trim();
    return s.length > 0 ? s : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object") {
    const raw = (value as any).value ?? (value as any).id ?? (value as any).key;
    if (typeof raw === "string") {
      const s = raw.trim();
      return s.length > 0 ? s : null;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  }
  return null;
}

function pickPrimaryServiceId(stepDataSoFar: Record<string, any>): string | null {
  const raw =
    stepDataSoFar["step-service-primary"] ??
    stepDataSoFar["step-service"] ??
    stepDataSoFar["step_service_primary"] ??
    stepDataSoFar["step_service"];
  if (Array.isArray(raw)) return normalizeOptionalString(raw[0]);
  return normalizeOptionalString(raw);
}

function isReadyRefinementImage(row: any): boolean {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
  return (
    row?.status === "completed" &&
    String(meta?.generated_for || "").trim() === "refinement_option" &&
    String(meta?.refinement_status || "").trim() === "ready"
  );
}

function buildRefinementCatalog(rows: any[], rawComponents: unknown): RefinementCatalogItem[] {
  const components = coerceSubcategoryComponents(rawComponents);
  if (components.length === 0) return [];

  const buckets = new Map<
    string,
    RefinementCatalogItem & {
      seenVariationKeys: Set<string>;
    }
  >();
  for (const component of components) {
    buckets.set(component.key, {
      ...component,
      options: [],
      seenVariationKeys: new Set<string>(),
    });
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isReadyRefinementImage(row)) continue;
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
    const key = normalizeOptionalString(meta?.refinement_category_key);
    const imageUrl = normalizeOptionalString(row?.image_url);
    if (!key || !imageUrl || !buckets.has(key)) continue;

    const bucket = buckets.get(key)!;
    const value = normalizeOptionalString(meta?.refinement_variation_key) || String(row?.id || "");
    const label =
      normalizeOptionalString(meta?.refinement_variation_label) ||
      normalizeOptionalString(meta?.option_label) ||
      value;
    if (!value || !label) continue;

    const dedupeKey = value.toLowerCase();
    if (bucket.seenVariationKeys.has(dedupeKey)) continue;
    bucket.seenVariationKeys.add(dedupeKey);
    bucket.options.push({ label, value, imageUrl });
  }

  return Array.from(buckets.values())
    .map(({ seenVariationKeys: _seenVariationKeys, ...item }) => ({
      ...item,
      options: item.options.slice(0, 8),
    }))
    .filter((item) => item.options.length >= 2)
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

export async function POST(
  request: NextRequest,
  { params }: { params: { instanceId: string } }
) {
  const instanceId = params.instanceId;
  const reqId = `refinements-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = body?.sessionId || body?.session_id || "";
    const stepDataSoFar = body?.stepDataSoFar ?? body?.step_data_so_far ?? {};
    const askedStepIds = Array.isArray(body?.askedStepIds)
      ? body.askedStepIds
      : Array.isArray(body?.asked_step_ids)
        ? body.asked_step_ids
        : [];

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "sessionId is required" }, { status: 400 });
    }

    const selectedServiceId = pickPrimaryServiceId(stepDataSoFar);
    if (!selectedServiceId) {
      return NextResponse.json({ ok: true, miniSteps: [], requestId: reqId, schemaVersion: "1" });
    }

    const admin = createSupabaseAdminClient();
    const { data: instance, error: instanceError } = await admin.supabase
      .from("instances")
      .select("*")
      .eq("id", instanceId)
      .single();

    if (instanceError || !instance) {
      return NextResponse.json({ ok: false, error: "Instance not found" }, { status: 404 });
    }

    const { data: subcategory, error: subcategoryError } = await admin.supabase
      .from("categories_subcategories")
      .select("id, subcategory, category_id, service_summary, subcategory_components, categories(name)")
      .eq("id", selectedServiceId)
      .single();

    if (subcategoryError || !subcategory) {
      return NextResponse.json({ ok: true, miniSteps: [], requestId: reqId, schemaVersion: "1" });
    }

    const accountId = typeof (instance as any)?.account_id === "string" ? String((instance as any).account_id).trim() : "";
    const selectCols = "id, image_url, metadata, created_at, account_id, status";
    const [accountImages, globalImages] = await Promise.all([
      accountId
        ? admin.supabase
            .from("images")
            .select(selectCols)
            .eq("subcategory_id", selectedServiceId)
            .eq("account_id", accountId)
            .eq("status", "completed")
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
      admin.supabase
        .from("images")
        .select(selectCols)
        .eq("subcategory_id", selectedServiceId)
        .is("account_id", null)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const refinementCatalog = buildRefinementCatalog(
      [
        ...(Array.isArray(accountImages.data) ? accountImages.data : []),
        ...(Array.isArray(globalImages.data) ? globalImages.data : []),
      ],
      (subcategory as any)?.subcategory_components,
    );

    if (refinementCatalog.length === 0) {
      return NextResponse.json({ ok: true, miniSteps: [], requestId: reqId, schemaVersion: "1" });
    }

    const serviceSummary =
      typeof (subcategory as any)?.service_summary === "string" && String((subcategory as any).service_summary).trim()
        ? String((subcategory as any).service_summary).trim()
        : typeof (instance as any)?.company_summary === "string" && String((instance as any).company_summary).trim()
          ? String((instance as any).company_summary).trim()
          : typeof (instance as any)?.service_summary === "string" && String((instance as any).service_summary).trim()
            ? String((instance as any).service_summary).trim()
            : undefined;
    const businessContext =
      typeof (instance as any)?.business_context === "string" && String((instance as any).business_context).trim()
        ? String((instance as any).business_context).trim()
        : typeof (instance as any)?.config?.businessContext === "string" && String((instance as any).config.businessContext).trim()
          ? String((instance as any).config.businessContext).trim()
          : typeof (instance as any)?.config?.aiFormConfig?.businessContext === "string" &&
              String((instance as any).config.aiFormConfig.businessContext).trim()
            ? String((instance as any).config.aiFormConfig.businessContext).trim()
            : typeof (instance as any)?.name === "string" && String((instance as any).name).trim()
              ? String((instance as any).name).trim()
              : undefined;
    const industryName =
      typeof (subcategory as any)?.categories?.name === "string" && String((subcategory as any).categories.name).trim()
        ? String((subcategory as any).categories.name).trim()
        : typeof (instance as any)?.config?.industry === "string" && String((instance as any).config.industry).trim()
          ? String((instance as any).config.industry).trim()
          : "General";
    const serviceName =
      typeof (subcategory as any)?.subcategory === "string" && String((subcategory as any).subcategory).trim()
        ? String((subcategory as any).subcategory).trim()
        : typeof (instance as any)?.config?.service === "string"
          ? String((instance as any).config.service).trim()
          : null;

    const payload = {
      ...(body && typeof body === "object" ? body : {}),
      sessionId,
      stepDataSoFar,
      askedStepIds,
      instanceContext: {
        businessContext,
        serviceSummary,
        industry: {
          id: typeof (subcategory as any)?.category_id === "string" ? String((subcategory as any).category_id) : null,
          name: industryName,
        },
        service: {
          id: selectedServiceId,
          name: serviceName,
        },
      },
      refinementCatalog,
    };

    const baseUrls = resolveFormServiceBaseUrls();
    if (baseUrls.length === 0) {
      return NextResponse.json(
        { ok: false, error: "DSPY_SERVICE_URL not configured" },
        { status: 500 }
      );
    }

    let lastError: Error | null = null;
    let lastStatus: number | null = null;
    let lastBody: string | null = null;
    for (const baseUrl of baseUrls) {
      const endpoint = new URL(`/v1/api/form/${instanceId}/refinements`, baseUrl).toString();
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
          cache: "no-store",
        });
        if (resp.ok) {
          const json = await resp.json().catch(() => ({}));
          const miniSteps = Array.isArray(json?.miniSteps) ? json.miniSteps : [];
          logger.info("[refinements] SUCCESS", {
            reqId,
            instanceId,
            selectedServiceId,
            catalogCount: refinementCatalog.length,
            stepsCount: miniSteps.length,
            steps: miniSteps.map((s: any) => ({ id: s?.id, question: s?.question, type: s?.type })),
          });
          return NextResponse.json(json);
        }
        lastStatus = resp.status;
        lastBody = await resp.text().catch(() => null);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    const errMsg =
      lastError?.message ||
      (lastStatus != null ? `Service returned ${lastStatus}${lastBody ? `: ${lastBody.slice(0, 200)}` : ""}` : "Refinements service unreachable");
    logger.error("[refinements] ERROR", { reqId, instanceId, error: errMsg, lastStatus, selectedServiceId });
    return NextResponse.json(
      { ok: false, error: errMsg },
      { status: 502 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    logger.error("[refinements] ERROR", { reqId, error: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
