import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/server/logger";
import { buildPreviewPricingFromConfig } from "@/lib/ai-form/components/structural-steps";
import { extractAIFormConfig } from "@/lib/ai-form/config/extract-ai-form-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function objectOrEmpty(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== "object") return {};
  if (Array.isArray(raw)) return {};
  return raw as Record<string, any>;
}

const SENSITIVE_KEY_RE = /(email|e-mail|phone|tel|name|token|secret|key|password)/i;

function truncate(s: string, max: number) {
  if (!s) return s;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function safeJson(value: unknown, maxChars: number) {
  try {
    return truncate(JSON.stringify(value), maxChars);
  } catch {
    return "<<unserializable>>";
  }
}

function sanitizeForLog(value: unknown, depth = 0, parentKey?: string): any {
  if (depth > 5) return "<<depth_limit>>";
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (parentKey && SENSITIVE_KEY_RE.test(parentKey)) return "<<redacted>>";
    return truncate(value, 240);
  }
  if (Array.isArray(value)) {
    const arr = value.slice(0, 40);
    return arr.map((v) => sanitizeForLog(v, depth + 1, parentKey));
  }
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    const entries = Object.entries(value as Record<string, any>).slice(0, 120);
    for (const [k, v] of entries) {
      out[k] = sanitizeForLog(v, depth + 1, k);
    }
    const keyCount = Object.keys(value as any).length;
    if (keyCount > entries.length) out.__truncatedKeys = keyCount - entries.length;
    return out;
  }
  return String(value);
}

function normalizeUseCase(raw?: any): "tryon" | "scene-placement" | "scene-refinement" | "scene" {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
  if (v === "tryon" || v === "try-on") return "tryon";
  if (v === "scene-placement") return "scene-placement";
  if (v === "scene-refinement") return "scene-refinement";
  if (v === "scene") return "scene";
  return "scene";
}

function normalizeServiceUrl(raw: string): string {
  let serviceUrl = String(raw || "").trim();
  if (!serviceUrl) return "";
  if (!/^https?:\/\//i.test(serviceUrl)) {
    serviceUrl = `https://${serviceUrl.replace(/^\/+/, "")}`;
  }
  return serviceUrl.replace(/\/+$/, "");
}

function resolveFormServiceBaseUrls(): string[] {
  const devModeFlag = process.env.NEXT_PUBLIC_AI_FORM_DEV_MODE;
  const forceDev = devModeFlag === "true";
  const forceProd = devModeFlag === "false";
  const isDevMode = forceDev || (!forceProd && process.env.NODE_ENV !== "production");
  const urls: string[] = [];

  const devUrl = normalizeServiceUrl(process.env.DEV_DSPY_SERVICE_URL || "");
  const prodUrl = normalizeServiceUrl(process.env.DSPY_SERVICE_URL || process.env.PROD_DSPY_SERVICE_URL || "");

  if (isDevMode) {
    if (devUrl) urls.push(devUrl);
    else if (prodUrl) urls.push(prodUrl);
  } else {
    if (prodUrl) urls.push(prodUrl);
    else if (devUrl) urls.push(devUrl);
  }

  return Array.from(new Set(urls));
}

function n(value: any): number | null {
  const num = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(num) ? num : null;
}

function parseRangeObject(
  raw: any,
  opts?: { allowNegative?: boolean }
): { low: number; high: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const low = n((raw as any).low ?? (raw as any).min ?? (raw as any).rangeLow ?? (raw as any).range_low);
  const high = n((raw as any).high ?? (raw as any).max ?? (raw as any).rangeHigh ?? (raw as any).range_high);
  if (low === null || high === null) return undefined;
  if (!opts?.allowNegative && (low <= 0 || high <= 0)) return undefined;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function parsePricingEstimate(
  json: any
): {
  totalMin: number;
  totalMax: number;
  currency: string;
  confidence?: string;
  requestId?: string;
  servicePriceRange?: { low: number; high: number };
  imagePriceRange?: { low: number; high: number };
  baselinePriceRange?: { low: number; high: number };
  deltaPriceRange?: { low: number; high: number };
  deltaDirection?: string;
  budgetTier?: string;
  budgetTierRanges?: Record<string, { low: number; high: number }>;
  priceDrivers?: Array<{ key: string; label: string }>;
  calibrationKey?: string;
} | null {
  if (!json || typeof json !== "object") return null;

  // Allow either direct payload or wrapped { estimate: {...} }
  const root = (json as any)?.estimate && typeof (json as any).estimate === "object" ? (json as any).estimate : json;

  const currency =
    String(
      (root as any)?.currency ??
        (root as any)?.currency_code ??
        (root as any)?.currencyCode ??
        (root as any)?.currency_symbol ??
        "USD"
    )
      .trim()
      .toUpperCase() || "USD";

  const candidates = [
    // New backend shape: { rangeLow, rangeHigh }
    { min: (root as any)?.rangeLow, max: (root as any)?.rangeHigh },
    { min: (root as any)?.range_low, max: (root as any)?.range_high },
    // Legacy shapes
    { min: (root as any)?.totalMin, max: (root as any)?.totalMax },
    { min: (root as any)?.total_min, max: (root as any)?.total_max },
    { min: (root as any)?.min, max: (root as any)?.max },
    { min: (root as any)?.min_price, max: (root as any)?.max_price },
    { min: (root as any)?.low, max: (root as any)?.high },
    { min: (root as any)?.range?.min, max: (root as any)?.range?.max },
    { min: (root as any)?.price_range?.min, max: (root as any)?.price_range?.max },
    { min: (root as any)?.estimate?.min, max: (root as any)?.estimate?.max },
    { min: (root as any)?.data?.min, max: (root as any)?.data?.max },
  ];

  for (const c of candidates) {
    const min0 = n(c.min);
    const max0 = n(c.max);
    if (min0 === null || max0 === null) continue;
    const totalMin = Math.min(min0, max0);
    const totalMax = Math.max(min0, max0);
    if (totalMin <= 0 || totalMax <= 0) continue;
    const confidence =
      typeof (root as any)?.confidence === "string" ? String((root as any).confidence).trim().toLowerCase() : undefined;
    const requestId =
      typeof (root as any)?.requestId === "string"
        ? String((root as any).requestId).trim()
        : typeof (root as any)?.request_id === "string"
          ? String((root as any).request_id).trim()
          : typeof (json as any)?.requestId === "string"
            ? String((json as any).requestId).trim()
            : typeof (json as any)?.request_id === "string"
            ? String((json as any).request_id).trim()
              : undefined;
    const servicePriceRange = parseRangeObject(root?.servicePriceRange ?? root?.service_price_range);
    const imagePriceRange = parseRangeObject(root?.imagePriceRange ?? root?.image_price_range) ?? {
      low: totalMin,
      high: totalMax,
    };
    const baselinePriceRange = parseRangeObject(root?.baselinePriceRange ?? root?.baseline_price_range);
    const deltaPriceRange = parseRangeObject(root?.deltaPriceRange ?? root?.delta_price_range, { allowNegative: true });
    const budgetTierRangesRaw = root?.budgetTierRanges ?? root?.budget_tier_ranges;
    const budgetTierRanges =
      budgetTierRangesRaw && typeof budgetTierRangesRaw === "object"
        ? Object.fromEntries(
            Object.entries(budgetTierRangesRaw)
              .map(([key, value]) => [key, parseRangeObject(value)])
              .filter((entry): entry is [string, { low: number; high: number }] => Boolean(entry[0] && entry[1]))
          )
        : undefined;
    const rawDrivers = Array.isArray(root?.priceDrivers ?? root?.price_drivers) ? (root?.priceDrivers ?? root?.price_drivers) : [];
    const priceDrivers = rawDrivers
      .map((item: any) => ({
        key: typeof item?.key === "string" ? item.key.trim() : "",
        label: typeof item?.label === "string" ? item.label.trim() : typeof item?.key === "string" ? item.key.trim() : "",
      }))
      .filter((item: { key: string; label: string }) => Boolean(item.key));
    return {
      totalMin,
      totalMax,
      currency,
      imagePriceRange,
      ...(confidence ? { confidence } : {}),
      ...(requestId ? { requestId } : {}),
      ...(servicePriceRange ? { servicePriceRange } : {}),
      ...(baselinePriceRange ? { baselinePriceRange } : {}),
      ...(deltaPriceRange ? { deltaPriceRange } : {}),
      ...(typeof root?.deltaDirection === "string" ? { deltaDirection: String(root.deltaDirection).trim().toLowerCase() } : {}),
      ...(typeof root?.budgetTier === "string" ? { budgetTier: String(root.budgetTier).trim().toLowerCase() } : {}),
      ...(budgetTierRanges && Object.keys(budgetTierRanges).length > 0 ? { budgetTierRanges } : {}),
      ...(priceDrivers.length > 0 ? { priceDrivers } : {}),
      ...(typeof root?.calibrationKey === "string" ? { calibrationKey: String(root.calibrationKey).trim() } : {}),
    };
  }
  return null;
}

function pickServiceIds(stepDataSoFar: Record<string, any>): string[] {
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

function normalizeOptionalString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function extractNameFromMaybeObject(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return normalizeOptionalString(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    return normalizeOptionalString((value as any).name ?? (value as any).label ?? (value as any).value);
  }
  return null;
}

function hasServiceContext(context: Record<string, any> | null | undefined): boolean {
  if (!context) return false;
  const svcSummary = normalizeOptionalString((context as any).serviceSummary ?? (context as any).service_summary);
  if (svcSummary) return true;
  const industryName = extractNameFromMaybeObject((context as any).industry);
  const serviceName = extractNameFromMaybeObject((context as any).service);
  return Boolean(industryName || serviceName);
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

function extractUpstreamError(json: any, rawText: string): string | null {
  const candidates = [
    typeof json?.error === "string" ? json.error : null,
    typeof json?.detail === "string" ? json.detail : null,
    typeof json?.message === "string" ? json.message : null,
    typeof json?.error?.message === "string" ? json.error.message : null,
    rawText && rawText.length < 4000 ? rawText : null,
  ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return candidates.length > 0 ? candidates[0].trim() : null;
}

function isMissingServiceContextError(msg: string | null): boolean {
  if (!msg) return false;
  return /missing service context/i.test(msg);
}

export async function POST(request: NextRequest, { params }: { params: { instanceId: string } }) {
  const instanceId = String(params.instanceId || "").trim();
  if (!instanceId) return NextResponse.json({ error: "Missing instanceId" }, { status: 400 });

  const reqId = `pricing-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  let bodyText = "";
  try {
    bodyText = await request.text();
  } catch {
    bodyText = "";
  }
  let body: any = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = {};
  }

  const sessionId =
    typeof body?.sessionId === "string"
      ? body.sessionId
      : typeof body?.session?.sessionId === "string"
        ? body.session.sessionId
        : null;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const useCase = normalizeUseCase(body?.useCase ?? body?.config?.useCase);
  const noCache = Boolean(body?.noCache ?? body?.request?.noCache);
  const instanceContext = objectOrEmpty(body?.instanceContext ?? body?.state?.context);

  const rawAnswers = objectOrEmpty(body?.stepDataSoFar ?? body?.state?.answers);
  const stepDataSoFar = Object.fromEntries(
    Object.entries(rawAnswers).filter(([key]) => typeof key === "string" && key && !key.startsWith("__"))
  );
  const answeredQA =
    Array.isArray(body?.answeredQA) && body.answeredQA.length > 0
      ? body.answeredQA
      : Array.isArray(body?.state?.answeredQA) && body.state.answeredQA.length > 0
        ? body.state.answeredQA
        : [];
  const askedStepIds =
    Array.isArray(body?.askedStepIds) && body.askedStepIds.length > 0
      ? body.askedStepIds
      : Array.isArray(body?.state?.askedStepIds) && body.state.askedStepIds.length > 0
        ? body.state.askedStepIds
        : [];

  logger.info("[ai-form:pricing] REQUEST", {
    reqId,
    instanceId,
    sessionId,
    useCase,
    noCache,
    bodyBytes: bodyText ? bodyText.length : 0,
    bodyKeys: body && typeof body === "object" ? Object.keys(body).slice(0, 60) : null,
    answerKeys: Object.keys(stepDataSoFar).slice(0, 120),
    askedStepIdsCount: askedStepIds.length,
    answeredQACount: answeredQA.length,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: instance, error: instanceError } = await supabase
    .from("instances")
    .select("*")
    .eq("id", instanceId)
    .maybeSingle();
  if (instanceError) {
    logger.error("[ai-form:pricing] INSTANCE_LOOKUP_ERROR", {
      reqId,
      instanceId,
      message: instanceError.message,
      details: (instanceError as any)?.details,
      hint: (instanceError as any)?.hint,
      code: (instanceError as any)?.code,
    });
    return NextResponse.json({ error: "Failed to load instance" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  // Merge in instance summaries so upstream can price without UUID resolution.
  const companySummary = typeof (instance as any)?.company_summary === "string" ? String((instance as any).company_summary).trim() : null;
  const instanceServiceSummary =
    typeof (instance as any)?.service_summary === "string" ? String((instance as any).service_summary).trim() : null;
  const aiFormConfig = extractAIFormConfig((instance as any)?.config);
  const configIndustry = normalizeOptionalString(aiFormConfig.industry);
  const configServices = Array.isArray(aiFormConfig.services)
    ? aiFormConfig.services.map((s: any) => (typeof s === "string" ? s.trim() : "")).filter(Boolean)
    : [];

  const selectedServiceIds = pickServiceIds(stepDataSoFar);
  const serviceSummarySnippets: string[] = [];
  if (selectedServiceIds.length > 0) {
    try {
      const { data: rows } = await supabase
        .from("categories_subcategories")
        .select("id, service_summary")
        .in("id", selectedServiceIds)
        .limit(50);
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const svc = typeof (row as any)?.service_summary === "string" ? String((row as any).service_summary).trim() : "";
          if (svc) serviceSummarySnippets.push(svc);
        }
      }
    } catch {}
  }
  const derivedServiceSummary = [companySummary, instanceServiceSummary, ...serviceSummarySnippets]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, 6)
    .join("\n\n") || null;

  const mergedContext: Record<string, any> = { ...instanceContext };
  if ("businessContext" in mergedContext) delete mergedContext.businessContext;
  if ((mergedContext.companySummary == null || mergedContext.companySummary === "") && companySummary) mergedContext.companySummary = companySummary;
  if ((mergedContext.serviceSummary == null || mergedContext.serviceSummary === "") && derivedServiceSummary) {
    mergedContext.serviceSummary = derivedServiceSummary;
  }
  // Ensure we always provide some service context to upstream when possible.
  if (mergedContext.industry == null && configIndustry) mergedContext.industry = { name: configIndustry };
  if (mergedContext.service == null && configServices.length > 0) mergedContext.service = { name: configServices[0] };
  if (!normalizeOptionalString(mergedContext.serviceSummary) && !normalizeOptionalString(mergedContext.service_summary)) {
    const fallbackSummary = buildServiceSummaryFallback({ industry: configIndustry, services: configServices });
    if (fallbackSummary) mergedContext.serviceSummary = fallbackSummary;
  }

  const schemaVersion =
    typeof body?.formState?.schemaVersion === "string"
      ? body.formState.schemaVersion
      : typeof body?.request?.schemaVersion === "string"
        ? body.request.schemaVersion
        : undefined;

  if (!hasServiceContext(mergedContext)) {
    logger.warn("[ai-form:pricing] MISSING_SERVICE_CONTEXT_FALLBACK", {
      reqId,
      instanceId,
      sessionId,
      useCase,
      noCache,
      configIndustry,
      configServicesCount: configServices.length,
    });
    const seedRange = buildPreviewPricingFromConfig(aiFormConfig.previewPricing, sessionId);
    const defaultServiceRange = { low: 5000, high: 150000 };
    return NextResponse.json(
      {
        estimate: {
          totalMin: seedRange.totalMin,
          totalMax: seedRange.totalMax,
          currency: seedRange.currency || "USD",
          source: "fallback_preview_missing_context",
          servicePriceRange: defaultServiceRange,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  let svcBase: string;
  const svcBases = resolveFormServiceBaseUrls();
  if (svcBases.length === 0) {
    logger.warn("[ai-form:pricing] NO_UPSTREAM_URLS_CONFIGURED", {
      reqId,
      instanceId,
      sessionId,
      useCase,
      noCache,
    });
    const seedRange = buildPreviewPricingFromConfig(aiFormConfig.previewPricing, sessionId);
    const defaultServiceRange = { low: 5000, high: 150000 };
    return NextResponse.json(
      {
        estimate: {
          totalMin: seedRange.totalMin,
          totalMax: seedRange.totalMax,
          currency: seedRange.currency || "USD",
          source: "fallback_preview",
          servicePriceRange: defaultServiceRange,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const attemptedEndpoints: string[] = [];
  const upstreamCompanySummary = typeof mergedContext?.companySummary === "string" ? mergedContext.companySummary.trim() : null;
  const upstreamServiceSummary = typeof mergedContext?.serviceSummary === "string" ? mergedContext.serviceSummary.trim() : null;
  const previewImageUrl =
    typeof body?.previewImageUrl === "string"
      ? body.previewImageUrl.trim()
      : typeof body?.preview_image_url === "string"
        ? body.preview_image_url.trim()
        : null;
  const pricingScenario =
    typeof body?.pricingScenario === "string"
      ? body.pricingScenario.trim().toLowerCase()
      : typeof body?.pricing_scenario === "string"
        ? body.pricing_scenario.trim().toLowerCase()
        : null;
  const baselineImageUrl =
    typeof body?.baselineImageUrl === "string"
      ? body.baselineImageUrl.trim()
      : typeof body?.baseline_image_url === "string"
        ? body.baseline_image_url.trim()
        : null;
  const baselinePriceRange =
    body?.baselinePriceRange && typeof body.baselinePriceRange === "object"
      ? body.baselinePriceRange
      : body?.baseline_price_range && typeof body.baseline_price_range === "object"
        ? body.baseline_price_range
        : null;
  const budgetRange =
    typeof body?.budgetRange === "number" || typeof body?.budgetRange === "string"
      ? body.budgetRange
      : typeof body?.budget_range === "number" || typeof body?.budget_range === "string"
        ? body.budget_range
        : null;
  const changedRefinementKeys = Array.isArray(body?.changedRefinementKeys)
    ? body.changedRefinementKeys
    : Array.isArray(body?.changed_refinement_keys)
      ? body.changed_refinement_keys
      : [];

  const upstreamPayload: Record<string, any> = {
    useCase,
    session: { sessionId, instanceId },
    // Pricing endpoint expects these at the top-level (not only in state.context).
    ...(upstreamCompanySummary ? { companySummary: upstreamCompanySummary } : {}),
    ...(upstreamServiceSummary ? { serviceSummary: upstreamServiceSummary } : {}),
    ...(previewImageUrl ? { previewImageUrl } : {}),
    ...(pricingScenario ? { pricingScenario } : {}),
    ...(baselineImageUrl ? { baselineImageUrl } : {}),
    ...(baselinePriceRange ? { baselinePriceRange } : {}),
    ...(budgetRange !== null && budgetRange !== "" ? { budgetRange } : {}),
    ...(changedRefinementKeys.length > 0 ? { changedRefinementKeys } : {}),
    state: {
      answers: stepDataSoFar,
      askedStepIds,
      answeredQA,
      context: mergedContext,
    },
    request: {
      noCache: noCache ? true : undefined,
      schemaVersion,
    },
  };

  // AI pricing with image analysis can take 20-30+ seconds; avoid premature timeouts
  const fetchTimeoutMs = 35000;
  const candidatePaths = [
    // Preferred (matches FastAPI path-param shape)
    `/v1/api/pricing/${encodeURIComponent(instanceId)}`,
    // Back-compat (extracts instanceId from payload)
    "/v1/api/pricing",
    // Widget/back-compat alias
    "/api/pricing",
  ];

  let lastFetchError: unknown = null;
  const totalAttempts = svcBases.length * candidatePaths.length;
  let attemptIndex = 0;

  for (const base of svcBases) {
    svcBase = base;
    for (const path of candidatePaths) {
      attemptIndex += 1;
      const svcEndpoint = new URL(path, svcBase).toString();
      attemptedEndpoints.push(svcEndpoint);

      let upstreamResp: Response;
      try {
        logger.info("[ai-form:pricing] UPSTREAM_REQUEST", {
          reqId,
          instanceId,
          sessionId,
          useCase,
          endpoint: svcEndpoint,
          attemptedEndpoints,
          payload: sanitizeForLog(upstreamPayload),
        });
        const timeoutSignal =
          typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? (AbortSignal as any).timeout(fetchTimeoutMs) : undefined;
        upstreamResp = await fetch(svcEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json", Accept: "application/json" },
          body: JSON.stringify(upstreamPayload),
          cache: "no-store",
          ...(timeoutSignal ? { signal: timeoutSignal } : {}),
        });
      } catch (e) {
        lastFetchError = e;
        logger.warn("[ai-form:pricing] UPSTREAM_UNREACHABLE", {
          reqId,
          instanceId,
          sessionId,
          useCase,
          ms: Date.now() - startedAt,
          endpoint: svcEndpoint,
          attemptedEndpoints,
          err: e instanceof Error ? e.message : String(e),
          willRetry: attemptIndex < totalAttempts,
        });
        continue;
      }

      const text = await upstreamResp.text().catch(() => "");
      const json = text
        ? (() => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })()
        : null;

      logger.info("[ai-form:pricing] UPSTREAM_RESPONSE", {
        reqId,
        instanceId,
        sessionId,
        useCase,
        ms: Date.now() - startedAt,
        endpoint: svcEndpoint,
        attemptedEndpoints,
        status: upstreamResp.status,
        ok: upstreamResp.ok,
        responsePreview: truncate(text, 2000),
        responseKeys: json && typeof json === "object" ? Object.keys(json as any).slice(0, 80) : null,
      });

      const upstreamErrorText = extractUpstreamError(json, text);
      const upstreamOkFlag =
        json && typeof json === "object" && "ok" in (json as any) ? Boolean((json as any).ok) : undefined;

      if (!upstreamResp.ok || upstreamOkFlag === false) {
        // If this is just an unsupported path shape, fall back to other pricing routes.
        if (upstreamResp.status === 404 || upstreamResp.status === 405) {
          logger.warn("[ai-form:pricing] UPSTREAM_PATH_UNSUPPORTED", {
            reqId,
            instanceId,
            sessionId,
            useCase,
            status: upstreamResp.status,
            ms: Date.now() - startedAt,
            endpoint: svcEndpoint,
            attemptedEndpoints,
            details: json ?? { rawPreview: text.slice(0, 800) },
            willRetry: attemptIndex < totalAttempts,
          });
          continue;
        }

        if ((upstreamResp.status === 400 || upstreamResp.status === 422 || upstreamOkFlag === false) && isMissingServiceContextError(upstreamErrorText)) {
          logger.warn("[ai-form:pricing] UPSTREAM_MISSING_CONTEXT_FALLBACK", {
            reqId,
            instanceId,
            sessionId,
            useCase,
            status: upstreamResp.status,
            ms: Date.now() - startedAt,
            endpoint: svcEndpoint,
            attemptedEndpoints,
            upstreamError: upstreamErrorText,
          });
          const seedRange = buildPreviewPricingFromConfig(aiFormConfig.previewPricing, sessionId);
          const defaultServiceRange = { low: 5000, high: 150000 };
          return NextResponse.json(
            {
              estimate: {
                totalMin: seedRange.totalMin,
                totalMax: seedRange.totalMax,
                currency: seedRange.currency || "USD",
                source: "fallback_preview_missing_context",
                servicePriceRange: defaultServiceRange,
              },
            },
            { status: 200, headers: { "Cache-Control": "no-store" } }
          );
        }

        logger.error("[ai-form:pricing] UPSTREAM_ERROR", {
          reqId,
          instanceId,
          sessionId,
          useCase,
          status: upstreamResp.status,
          ms: Date.now() - startedAt,
          endpoint: svcEndpoint,
          attemptedEndpoints,
          details: json ?? { rawPreview: text.slice(0, 800) },
          payloadPreview: safeJson(sanitizeForLog(upstreamPayload), 4000),
        });
        return NextResponse.json(
          { error: "Pricing service error", status: upstreamResp.status, details: json ?? { rawPreview: text.slice(0, 800) } },
          { status: upstreamResp.status, headers: { "Cache-Control": "no-store" } }
        );
      }

      const estimate = parsePricingEstimate(json);
      if (!estimate) {
        logger.warn("[ai-form:pricing] UPSTREAM_MISSING_ESTIMATE", {
          reqId,
          instanceId,
          sessionId,
          useCase,
          ms: Date.now() - startedAt,
          endpoint: svcEndpoint,
          attemptedEndpoints,
          upstreamKeys: json && typeof json === "object" ? Object.keys(json as any).slice(0, 60) : null,
          rawPreview: text.slice(0, 400),
          willRetry: attemptIndex < totalAttempts,
        });
        if (attemptIndex < totalAttempts) continue;
        return NextResponse.json(
          { error: "Pricing service returned no estimate", details: { rawPreview: text.slice(0, 400) } },
          { status: 502, headers: { "Cache-Control": "no-store" } }
        );
      }

      logger.info("[ai-form:pricing] RESPONSE", {
        reqId,
        instanceId,
        sessionId,
        useCase,
        ms: Date.now() - startedAt,
        endpoint: svcEndpoint,
        attemptedEndpoints,
        estimate,
      });

      const root = (json as any)?.estimate && typeof (json as any).estimate === "object" ? (json as any).estimate : json;
      const servicePriceRange =
        typeof (root as any)?.servicePriceRange === "object" && (root as any).servicePriceRange !== null
          ? (root as any).servicePriceRange
          : typeof (root as any)?.service_price_range === "object" && (root as any).service_price_range !== null
            ? (root as any).service_price_range
            : undefined;
      const serviceRange =
        servicePriceRange &&
        typeof servicePriceRange.low === "number" &&
        typeof servicePriceRange.high === "number"
          ? { low: servicePriceRange.low, high: servicePriceRange.high }
          : estimate.servicePriceRange &&
              typeof estimate.servicePriceRange.low === "number" &&
              typeof estimate.servicePriceRange.high === "number"
            ? {
                low: estimate.servicePriceRange.low,
                high: estimate.servicePriceRange.high,
              }
            : undefined;

      const imageRange =
        estimate.imagePriceRange &&
        typeof estimate.imagePriceRange.low === "number" &&
        typeof estimate.imagePriceRange.high === "number"
          ? { low: estimate.imagePriceRange.low, high: estimate.imagePriceRange.high }
          : undefined;
      const baselineRange =
        estimate.baselinePriceRange &&
        typeof estimate.baselinePriceRange.low === "number" &&
        typeof estimate.baselinePriceRange.high === "number"
          ? { low: estimate.baselinePriceRange.low, high: estimate.baselinePriceRange.high }
          : undefined;
      const deltaRange =
        estimate.deltaPriceRange &&
        typeof estimate.deltaPriceRange.low === "number" &&
        typeof estimate.deltaPriceRange.high === "number"
          ? { low: estimate.deltaPriceRange.low, high: estimate.deltaPriceRange.high }
          : undefined;
      return NextResponse.json(
        {
          estimate: {
            totalMin: estimate.totalMin,
            totalMax: estimate.totalMax,
            currency: estimate.currency,
            source: "ai",
            ...(estimate.confidence ? { confidence: estimate.confidence } : {}),
            ...(estimate.requestId ? { requestId: estimate.requestId } : {}),
            ...(serviceRange ? { servicePriceRange: serviceRange } : {}),
            ...(imageRange ? { imagePriceRange: imageRange } : {}),
            ...(baselineRange ? { baselinePriceRange: baselineRange } : {}),
            ...(deltaRange ? { deltaPriceRange: deltaRange } : {}),
            ...(estimate.deltaDirection ? { deltaDirection: estimate.deltaDirection } : {}),
            ...(estimate.budgetTier ? { budgetTier: estimate.budgetTier } : {}),
            ...(estimate.budgetTierRanges ? { budgetTierRanges: estimate.budgetTierRanges } : {}),
            ...(estimate.priceDrivers ? { priceDrivers: estimate.priceDrivers } : {}),
            ...(estimate.calibrationKey ? { calibrationKey: estimate.calibrationKey } : {}),
          },
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  logger.error("[ai-form:pricing] UPSTREAM_ALL_UNREACHABLE", {
    reqId,
    instanceId,
    sessionId,
    useCase,
    ms: Date.now() - startedAt,
    attemptedEndpoints,
    err: lastFetchError instanceof Error ? lastFetchError.message : lastFetchError ? String(lastFetchError) : null,
  });

  const seedRange = buildPreviewPricingFromConfig(aiFormConfig.previewPricing, sessionId);
  const defaultServiceRange = { low: 5000, high: 150000 };
  return NextResponse.json(
    {
      estimate: {
        totalMin: seedRange.totalMin,
        totalMax: seedRange.totalMax,
        currency: seedRange.currency || "USD",
        source: "fallback_preview",
        servicePriceRange: defaultServiceRange,
      },
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
