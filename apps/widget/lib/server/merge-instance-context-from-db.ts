import type { SupabaseClient } from "@supabase/supabase-js";
import { extractAIFormConfig } from "@/lib/ai-form/config/extract-ai-form-config";

/** Service / subcategory UUIDs from step answers (matches pricing route). */
export function pickServiceIds(stepDataSoFar: Record<string, any>): string[] {
  const candidates = [
    stepDataSoFar?.service_primary,
    stepDataSoFar?.["step-service-primary"],
    stepDataSoFar?.serviceId,
    stepDataSoFar?.service_id,
    stepDataSoFar?.subcategoryId,
    stepDataSoFar?.subcategory_id,
  ];
  const ids: string[] = [];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) ids.push(c.trim());
    else if (Array.isArray(c)) {
      for (const v of c) {
        if (typeof v === "string" && v.trim()) ids.push(v.trim());
      }
    }
  }
  return Array.from(new Set(ids)).slice(0, 20);
}

export function normalizeOptionalString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function buildServiceSummaryFallback(params: { industry?: string | null; services?: string[] | null }): string | null {
  const industry = normalizeOptionalString(params.industry ?? null);
  const services = Array.isArray(params.services) ? params.services.map((s) => normalizeOptionalString(s)).filter(Boolean) : [];
  if (!industry && services.length === 0) return null;
  const parts: string[] = [];
  if (industry) parts.push(`Industry: ${industry}.`);
  if (services.length > 0) parts.push(`Services: ${services.join(", ")}.`);
  return parts.join(" ");
}

/**
 * Merge DB-backed instance + selected-service summaries into instanceContext
 * (same rules as /api/ai-form/[instanceId]/pricing).
 */
export async function mergeInstanceContextFromDb(args: {
  supabase: SupabaseClient;
  instance: Record<string, any>;
  stepDataSoFar: Record<string, any>;
  instanceContext: Record<string, any>;
}): Promise<Record<string, any>> {
  const { supabase, instance, stepDataSoFar, instanceContext } = args;

  const companySummary =
    typeof instance?.company_summary === "string" ? String(instance.company_summary).trim() : null;
  const instanceServiceSummary =
    typeof instance?.service_summary === "string" ? String(instance.service_summary).trim() : null;
  const aiFormConfig = extractAIFormConfig(instance?.config);
  const configIndustry = normalizeOptionalString(aiFormConfig.industry);
  const configServices = Array.isArray(aiFormConfig.services)
    ? aiFormConfig.services.map((s: any) => (typeof s === "string" ? s.trim() : "")).filter(Boolean)
    : [];

  const selectedServiceIds = pickServiceIds(stepDataSoFar || {});
  const serviceSummarySnippets: string[] = [];
  /** Display label from `categories_subcategories.subcategory` (same source as widget serviceOptions). */
  const subcategoryLabelById = new Map<string, string>();
  if (selectedServiceIds.length > 0) {
    try {
      const { data: rows } = await supabase
        .from("categories_subcategories")
        .select("id, subcategory, service_summary")
        .in("id", selectedServiceIds)
        .limit(50);
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const id = typeof (row as any)?.id === "string" ? String((row as any).id).trim() : "";
          const rawSub = typeof (row as any)?.subcategory === "string" ? String((row as any).subcategory).trim() : "";
          if (id && rawSub) {
            const cleaned = rawSub.replace(/\s*\(service\)\s*$/i, "").trim() || rawSub;
            subcategoryLabelById.set(id, cleaned);
          }
          const svc = typeof (row as any)?.service_summary === "string" ? String((row as any).service_summary).trim() : "";
          if (svc) serviceSummarySnippets.push(svc);
        }
      }
    } catch {
      // non-fatal: instance + config fallbacks still apply
    }
  }

  const derivedServiceSummary =
    [companySummary, instanceServiceSummary, ...serviceSummarySnippets]
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .slice(0, 6)
      .join("\n\n") || null;

  const mergedContext: Record<string, any> = { ...instanceContext };
  if ("businessContext" in mergedContext) delete mergedContext.businessContext;
  if ((mergedContext.companySummary == null || mergedContext.companySummary === "") && companySummary) {
    mergedContext.companySummary = companySummary;
  }
  if ((mergedContext.serviceSummary == null || mergedContext.serviceSummary === "") && derivedServiceSummary) {
    mergedContext.serviceSummary = derivedServiceSummary;
  }
  if (mergedContext.industry == null && configIndustry) mergedContext.industry = { name: configIndustry };
  if (mergedContext.service == null && configServices.length > 0) mergedContext.service = { name: configServices[0] };
  if (!normalizeOptionalString(mergedContext.serviceSummary) && !normalizeOptionalString(mergedContext.service_summary)) {
    const fallbackSummary = buildServiceSummaryFallback({ industry: configIndustry, services: configServices });
    if (fallbackSummary) mergedContext.serviceSummary = fallbackSummary;
  }

  /** Client/catalog often send `name: "Service"` when the real label lives on the subcategory row. */
  function isPlaceholderServiceName(name: unknown): boolean {
    const t = typeof name === "string" ? name.trim().toLowerCase() : "";
    return !t || t === "service";
  }
  const firstSelectedId = selectedServiceIds[0];
  const dbServiceLabel = firstSelectedId ? subcategoryLabelById.get(firstSelectedId) : undefined;
  if (dbServiceLabel) {
    const existing =
      mergedContext.service != null && typeof mergedContext.service === "object"
        ? (mergedContext.service as Record<string, unknown>)
        : {};
    const curName = existing.name;
    if (isPlaceholderServiceName(curName)) {
      mergedContext.service = {
        ...existing,
        id: typeof existing.id === "string" && existing.id.trim() ? existing.id : firstSelectedId,
        name: dbServiceLabel,
      };
    }
  }

  return mergedContext;
}
