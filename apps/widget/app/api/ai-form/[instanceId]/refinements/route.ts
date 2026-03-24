/**
 * Refinements endpoint — builds refinement image grids from DB-backed component + image catalog,
 * then asks the form service to generate question copy only for those grids.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildRefinementCatalogForWidget,
  coerceSubcategoryComponentsForWidget,
  ensureRefinementLibraryForSubcategory,
  resolveDspyServiceBaseUrls,
} from "@adventure/refinement-server";
import { logger } from "@/lib/server/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(
  request: NextRequest,
  { params }: { params: { instanceId: string } }
) {
  const instanceId = params.instanceId;
  const reqId = `refinements-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const debugEnabled = (() => {
      try {
        const url = new URL(request.url);
        const v = (url.searchParams.get("debug") || "").trim().toLowerCase();
        return v === "1" || v === "true" || v === "yes" || v === "on";
      } catch {
        return false;
      }
    })();
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
      logger.info("[refinements] EMPTY", {
        reqId,
        instanceId,
        reason: "missing_selected_service",
      });
      return NextResponse.json({
        ok: true,
        miniSteps: [],
        requestId: reqId,
        schemaVersion: "1",
        ...(debugEnabled ? { debug: { reason: "missing_selected_service" } } : {}),
      });
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
      logger.info("[refinements] EMPTY", {
        reqId,
        instanceId,
        selectedServiceId,
        reason: "subcategory_not_found",
      });
      return NextResponse.json({
        ok: true,
        miniSteps: [],
        requestId: reqId,
        schemaVersion: "1",
        ...(debugEnabled ? { debug: { reason: "subcategory_not_found", selectedServiceId } } : {}),
      });
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

    let mergedImages = [
      ...(Array.isArray(accountImages.data) ? accountImages.data : []),
      ...(Array.isArray(globalImages.data) ? globalImages.data : []),
    ];
    let refinedSubcategory: typeof subcategory = subcategory;

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

    const componentCount = coerceSubcategoryComponentsForWidget((refinedSubcategory as any)?.subcategory_components).length;
    const componentKeys = coerceSubcategoryComponentsForWidget((refinedSubcategory as any)?.subcategory_components)
      .map((component) => String(component.key || "").trim())
      .filter(Boolean);
    const readyImageCount = mergedImages.filter((row) => isReadyRefinementImage(row)).length;
    let refinementCatalog = buildRefinementCatalogForWidget(
      mergedImages,
      (refinedSubcategory as any)?.subcategory_components,
    );

    if (refinementCatalog.length === 0) {
      const repairBaseUrls = resolveDspyServiceBaseUrls();
      const plannerServiceSummary =
        (serviceSummary && serviceSummary.trim()) ||
        [industryName, serviceName || "Service"].filter(Boolean).join(": ") ||
        `${industryName} service`;
      if (repairBaseUrls.length > 0) {
        const repair = await ensureRefinementLibraryForSubcategory({
          baseUrls: repairBaseUrls,
          categoryId: typeof (refinedSubcategory as any)?.category_id === "string" ? String((refinedSubcategory as any).category_id) : null,
          categoryName: industryName,
          companySummary:
            typeof (instance as any)?.company_summary === "string" && String((instance as any).company_summary).trim()
              ? String((instance as any).company_summary).trim()
              : null,
          instanceId,
          mode: "lazy_repair",
          serviceSummary: plannerServiceSummary,
          subcategoryId: selectedServiceId,
          subcategoryName: serviceName || "Service",
          supabase: admin.supabase,
          existingSubcategoryComponents: (refinedSubcategory as any)?.subcategory_components,
          log: (label, data) => {
            logger.info(`[refinements-repair] ${label}`, { reqId, instanceId, selectedServiceId, ...data });
          },
        });

        if (!repair.ok && repair.plannerCalled) {
          logger.warn("[refinements] repair_failed", {
            reqId,
            instanceId,
            selectedServiceId,
            error: repair.error,
          });
        }

        if (repair.ok && repair.componentsPersisted) {
          const { data: subFresh, error: subFreshErr } = await admin.supabase
            .from("categories_subcategories")
            .select("id, subcategory, category_id, service_summary, subcategory_components, categories(name)")
            .eq("id", selectedServiceId)
            .single();
          if (!subFreshErr && subFresh) {
            refinedSubcategory = subFresh as typeof subcategory;
          }

          const [accountImages2, globalImages2] = await Promise.all([
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
          mergedImages = [
            ...(Array.isArray(accountImages2.data) ? accountImages2.data : []),
            ...(Array.isArray(globalImages2.data) ? globalImages2.data : []),
          ];
          refinementCatalog = buildRefinementCatalogForWidget(
            mergedImages,
            (refinedSubcategory as any)?.subcategory_components,
          );
        }
      }

      if (refinementCatalog.length === 0) {
        logger.info("[refinements] EMPTY", {
          reqId,
          instanceId,
          selectedServiceId,
          reason: "empty_refinement_catalog",
          componentCount,
          componentKeys,
          readyImageCount,
        });
        return NextResponse.json({
          ok: true,
          miniSteps: [],
          requestId: reqId,
          schemaVersion: "1",
          ...(debugEnabled
            ? {
                debug: {
                  reason: "empty_refinement_catalog",
                  selectedServiceId,
                  componentCount,
                  componentKeys,
                  readyImageCount,
                },
              }
            : {}),
        });
      }
    }

    const payload = {
      ...(body && typeof body === "object" ? body : {}),
      sessionId,
      stepDataSoFar,
      askedStepIds,
      instanceContext: {
        businessContext,
        serviceSummary,
        industry: {
          id: typeof (refinedSubcategory as any)?.category_id === "string" ? String((refinedSubcategory as any).category_id) : null,
          name: industryName,
        },
        service: {
          id: selectedServiceId,
          name: serviceName,
        },
      },
      refinementCatalog,
    };

    const baseUrls = resolveDspyServiceBaseUrls();
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
            componentCount,
            componentKeys,
            readyImageCount,
            catalogCount: refinementCatalog.length,
            catalogSummary: refinementCatalog.map((item) => ({
              key: item.key,
              optionCount: Array.isArray(item.options) ? item.options.length : 0,
            })),
            stepsCount: miniSteps.length,
            steps: miniSteps.map((s: any) => ({ id: s?.id, question: s?.question, type: s?.type })),
          });
          return NextResponse.json(
            debugEnabled
              ? {
                  ...json,
                  debug: {
                    selectedServiceId,
                    componentCount,
                    componentKeys,
                    readyImageCount,
                    catalogSummary: refinementCatalog.map((item) => ({
                      key: item.key,
                      optionCount: Array.isArray(item.options) ? item.options.length : 0,
                    })),
                  },
                }
              : json
          );
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
