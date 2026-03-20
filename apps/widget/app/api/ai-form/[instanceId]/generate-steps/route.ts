/**
 * Generate Steps Endpoint (JSON) — unified flow entrypoint
 *
 * - Replaces /flow/precompute and /flow/next-batch
 * - Streams steps via SSE for fast UX (internally), but returns buffered JSON to clients
 * - Enforces a configurable max AI batch-call cap (default 2)
 *
 * Deterministic responsibilities (TS):
 * - instance + DB grounding (RAG-ish)
 * - deterministic service fork step (if not selected)
 * - universal deterministic steps
 * - structural steps (uploads/designer/lead/pricing/confirm) appended only when ready
 *
 * AI responsibilities (DSPy subprocess, max 1 call per request):
 * - batch mini-step schemas (and later: copy blocks)
 *
 * NOTE: Today we stream steps as soon as DSPy returns JSONL/JSON.
 * True token streaming from Groq is enabled in the subprocess wrapper when supported,
 * but we still parse and emit steps incrementally (line-by-line) over SSE.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/server/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { getServiceGrounding } from "@/lib/ai-form/context/grounding";
import { extractAIFormConfig } from "@/lib/ai-form/config/extract-ai-form-config";
import { IMAGE_GEN_THRESHOLD } from "@/lib/ai-form/state/context-state";
// Batch sizes are now dynamic - calculated from actual generated steps

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NewBatchRequest = {
  sessionId: string;
  stepDataSoFar?: Record<string, any>;
  askedStepIds?: string[];
  /** Optional: plain-English "memory" (question + answer pairs) provided by the client. */
  answeredQA?: Array<{ stepId: string; question: string; answer: any }>;
  existingStepIds?: string[];
  questionStepIds?: string[];
  formState?: {
    formId?: string;
    batchIndex?: number;
    maxBatches?: number;
    tokenBudgetTotal?: number;
    tokensUsedSoFar?: number;
    askedStepIds?: string[];
    /** @deprecated Use askedStepIds */
    alreadyAskedKeys?: string[];
    schemaVersion?: string;
  };
  useCase?: string;
  instanceContext?: {
    // Single values (back-compat, deprecated - use arrays instead)
    industry?: { id?: string | null; name?: string | null };
    service?: { id?: string | null; name?: string | null };
    // Array versions (new - preferred)
    categories?: Array<{ id?: string | null; name?: string | null }>;
    subcategories?: Array<{ id?: string | null; name?: string | null }>;
  };
  // If true, the client is requesting a "fresh" run (e.g. ?fresh=1).
  // We treat this as debug intent and will log full payloads (may include user text / PII).
  noCache?: boolean;
};

function parseSseDataFrame(frame: string): any | null {
  const lines = frame.split("\n");
  const dataLines: string[] = [];
  for (const ln of lines) {
    const line = ln.trimEnd();
    if (!line) continue;
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  const text = dataLines.join("\n").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}


function canonicalizeStepId(raw: string) {
  return String(raw || "").trim().replace(/_/g, "-");
}

function stripEmojisAndNormalizeWhitespace(text: string): string {
  // Keep copy professional by removing emojis/pictographs.
  // Node 20 supports Unicode property escapes.
  return String(text || "")
    .replace(/[\u200D\uFE0E\uFE0F]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeMiniStep(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  const step: any = { ...raw };

  if (typeof step.id === "string" && step.id.trim()) {
    step.id = canonicalizeStepId(step.id);
  }

  for (const key of ["question", "humanism", "visual_hint", "headline", "subtext", "helper"]) {
    if (typeof step[key] === "string") step[key] = stripEmojisAndNormalizeWhitespace(step[key]);
  }

  if (Array.isArray(step.options)) {
    const nextOpts = step.options
      .map((opt: any) => {
        if (typeof opt === "string") return stripEmojisAndNormalizeWhitespace(opt);
        if (opt && typeof opt === "object") {
          const o: any = { ...opt };
          if (typeof o.label === "string") o.label = stripEmojisAndNormalizeWhitespace(o.label);
          if (typeof o.value === "string") o.value = o.value.trim();
          // Canonicalize option image field (camelCase only).
          if (typeof o.imageUrl !== "string" || !o.imageUrl.trim()) {
            if (typeof o.image_url === "string" && o.image_url.trim()) o.imageUrl = o.image_url.trim();
            else if (typeof o.image === "string" && o.image.trim()) o.imageUrl = o.image.trim();
          } else {
            o.imageUrl = o.imageUrl.trim();
          }
          // Enforce canonical field only.
          if ("image_url" in o) delete o.image_url;
          if ("image" in o) delete o.image;
          return o;
        }
        return opt;
      })
      .filter((opt: any) => {
        if (typeof opt === "string") return opt.trim().length > 0;
        if (opt && typeof opt === "object") {
          const labelOk = typeof opt.label === "string" ? opt.label.trim().length > 0 : true;
          const valueOk = typeof opt.value === "string" ? opt.value.trim().length > 0 : true;
          return labelOk && valueOk;
        }
        return Boolean(opt);
      });

    const hasOther = nextOpts.some((o: any) => {
      if (typeof o === "string") return o.toLowerCase() === "other";
      if (o && typeof o === "object") {
        const v = typeof o.value === "string" ? o.value.toLowerCase() : "";
        const l = typeof o.label === "string" ? o.label.toLowerCase() : "";
        return v === "other" || l === "other";
      }
      return false;
    });
    if (!hasOther && nextOpts.length > 0 && nextOpts.length < 12) {
      const usesObjectOptions = nextOpts.some((o: any) => o && typeof o === "object" && !Array.isArray(o));
      nextOpts.push(usesObjectOptions ? { label: "Other", value: "other" } : "Other");
    }

    step.options = nextOpts;
  }

  // Guardrail: never emit image_choice_grid without imageUrl fields.
  // If the upstream marks a step as image grid but provides no option thumbnails,
  // degrade to a normal multiple choice step (prevents blank “image tiles” UX).
  if (step?.type === "image_choice_grid" && Array.isArray(step.options)) {
    const anyHasImageUrl = step.options.some((o: any) => o && typeof o === "object" && typeof o.imageUrl === "string" && o.imageUrl.trim().length > 0);
    if (!anyHasImageUrl) {
      step.type = "multiple_choice";
    }
  }

  return step;
}

function isCatalogBackedStyleStep(step: any): boolean {
  const rawId = String(step?.id || step?.key || "").trim().toLowerCase();
  return rawId === "style_direction" || rawId === "step-style-direction";
}

function buildCatalogStyleOptions(rows: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
    const generatedFor = String(meta?.generated_for || "").trim();
    if (!meta || (generatedFor !== "style_seed" && generatedFor !== "subcategory_catalog")) continue;
    const label =
      typeof meta.option_label === "string" && meta.option_label.trim()
        ? meta.option_label.trim()
        : typeof meta.option_value === "string" && meta.option_value.trim()
          ? meta.option_value.trim()
          : "";
    const value =
      typeof meta.option_value === "string" && meta.option_value.trim()
        ? meta.option_value.trim()
        : label;
    const imageUrl = typeof row?.image_url === "string" ? row.image_url.trim() : "";
    if (!label || !value || !imageUrl) continue;
    const dedupeKey =
      typeof meta.catalog_key === "string" && meta.catalog_key.trim()
        ? meta.catalog_key.trim().toLowerCase()
        : value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      label,
      value,
      imageUrl,
      ...(typeof meta.option_description === "string" && meta.option_description.trim()
        ? { description: meta.option_description.trim() }
        : {}),
      ...(typeof meta.price_tier === "string" && meta.price_tier.trim()
        ? { priceTier: meta.price_tier.trim() }
        : {}),
    });
  }
  return out;
}

function isStepIdLike(raw: unknown): boolean {
  const s = typeof raw === "string" ? raw : "";
  if (!s) return false;
  return s.startsWith("step-") || s.startsWith("step_");
}

function serializeUnknownErrorForWire(err: unknown): any {
  try {
    if (!err) return { name: "Error", message: "Unknown error" };
    if (err instanceof Error) {
      const anyErr = err as any;
      return {
        name: err.name || "Error",
        message: err.message || "Error",
        ...(anyErr?.code ? { code: String(anyErr.code) } : {}),
        ...(anyErr?.cause ? { cause: serializeUnknownErrorForWire(anyErr.cause) } : {}),
        ...(process.env.LOG_STACKS === "true" || process.env.AI_FORM_DEBUG === "true" ? { stack: err.stack } : {}),
      };
    }
    if (typeof err === "string") return { name: "Error", message: err };
    if (typeof err === "object") {
      const anyErr = err as any;
      const message = typeof anyErr?.message === "string" ? anyErr.message : undefined;
      const name = typeof anyErr?.name === "string" ? anyErr.name : undefined;
      const code = typeof anyErr?.code === "string" ? anyErr.code : undefined;
      return { name: name || "Error", message: message || "Unknown error", ...(code ? { code } : {}) };
    }
    return { name: "Error", message: String(err) };
  } catch {
    return { name: "Error", message: "Unknown error" };
  }
}

function normalizeServiceValue(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "object") {
    const raw = (value as any).value ?? (value as any).id ?? (value as any).key;
    if (typeof raw === "string") return raw.trim() || null;
    if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  }
  return null;
}

function normalizeOptionalString(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "object") {
    const raw = (value as any).value ?? (value as any).id ?? (value as any).key;
    if (typeof raw === "string") return raw.trim() || null;
    if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  }
  return null;
}

function pickServiceIds(stepDataSoFar: Record<string, any>): string[] {
  const v =
    stepDataSoFar["step-service-primary"] ??
    stepDataSoFar["step-service"] ??
    stepDataSoFar["step_service_primary"] ??
    stepDataSoFar["step_service"];

  if (Array.isArray(v)) {
    return v
      .map((item) => normalizeServiceValue(item))
      .filter((id): id is string => Boolean(id))
      .slice(0, 5);
  }
  const single = normalizeServiceValue(v);
  if (single) return [single];
  return [];
}

function getDefaultMaxBatches(): number {
  const raw = Number(process.env.AI_FORM_MAX_BATCH_CALLS || 2);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(1, Math.min(8, Math.floor(raw)));
}

function clampMaxBatches(raw: any): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return getDefaultMaxBatches();
  return Math.max(1, Math.min(8, Math.floor(n)));
}

function normalizeFormState(
  raw: NewBatchRequest["formState"],
  sessionId: string,
  params?: { maxBatches?: number }
) {
  const maxBatches = typeof params?.maxBatches === "number" ? clampMaxBatches(params.maxBatches) : getDefaultMaxBatches();
  const batchIndex = Number.isFinite(raw?.batchIndex) ? Math.max(0, Number(raw?.batchIndex)) : 0;
  const tokenBudgetTotal = Number.isFinite(raw?.tokenBudgetTotal) ? Math.max(0, Number(raw?.tokenBudgetTotal)) : 3000;
  const tokensUsedSoFar = Number.isFinite(raw?.tokensUsedSoFar) ? Math.max(0, Number(raw?.tokensUsedSoFar)) : 0;
  const askedStepIds = Array.isArray(raw?.askedStepIds)
    ? raw?.askedStepIds.map((k) => String(k)).filter(Boolean)
    : Array.isArray(raw?.alreadyAskedKeys)
      ? raw?.alreadyAskedKeys.map((k) => String(k)).filter(Boolean)
      : [];

  return {
    formId: String(raw?.formId || sessionId),
    batchIndex: Math.min(batchIndex, Math.max(0, maxBatches - 1)),
    maxBatches,
    tokenBudgetTotal,
    tokensUsedSoFar,
    askedStepIds,
    schemaVersion: typeof raw?.schemaVersion === "string" ? raw?.schemaVersion : "1",
  };
}

export async function POST(request: NextRequest, { params }: { params: { instanceId: string } }) {
  const instanceId = params.instanceId;
  const reqId = `generate-steps-${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const t0 = Date.now();

  // Capture the upstream (Python/DSPy) JSON response so JSON-mode can return it directly (no frame-walking).
  let upstreamJson: any = null;
  // Capture the question steps we actually emitted (including fallbacks/dedupe).
  // JSON-mode must return these, not only the upstream payload, since we may augment steps locally.
  let emittedMiniStepsSnapshot: any[] = [];
	  // Capture the final "complete" frame we computed so JSON-mode can return
	  // structural steps + satiety gates even when we don't stream frames.
	  let completeFrameSnapshot: any = null;
    // Debug snapshots: surfaced in JSON response when enabled.
    let debugEnabledSnapshot: boolean = false;
    let upstreamDebugSnapshot: any = null;

	  const encoder = new TextEncoder();
	  const stream = new ReadableStream({
	    async start(controller) {
      const enqueue = (obj: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };


	      try {
	        let body: NewBatchRequest;
	        let bodyText = "";
	        try {
	          bodyText = await request.text();
          if (!bodyText || bodyText.trim().length === 0) {
            enqueue({ type: "error", error: "Request body is required" });
            controller.close();
            return;
	          }
	          body = JSON.parse(bodyText) as NewBatchRequest;
	        } catch (parseError) {
	          enqueue({ type: "error", error: "Invalid JSON in request body", details: parseError instanceof Error ? parseError.message : String(parseError) });
	          controller.close();
	          return;
	        }

          const debugEnabled =
            (body as any)?.debug === true ||
            process.env.AI_FORM_DEBUG === "true" ||
            (body as any)?.request?.debug === true;
          debugEnabledSnapshot = debugEnabled;

	          const stepDataSoFar = body.stepDataSoFar && typeof body.stepDataSoFar === "object" ? body.stepDataSoFar : {};
	          const askedStepIdsFromClient = Array.isArray((body as any).askedStepIds)
	            ? (body as any).askedStepIds.map((v: any) => String(v || "")).filter(Boolean)
	            : [];
          const incomingQuestionStepIds = askedStepIdsFromClient;
          const existingStepIds = Array.isArray(body.existingStepIds) ? body.existingStepIds : askedStepIdsFromClient;
          const streamedQuestionSteps: any[] = [];

	          // Log API request (keep it readable: omit full `stepDataSoFar` values and internal `__*` keys)
	          const stepDataKeysForLog = Object.keys(stepDataSoFar || {})
	            .filter((k) => typeof k === "string" && k && !k.startsWith("__"))
	            .slice(0, 120);
	          const instanceContextForLog =
	            body?.instanceContext && typeof body.instanceContext === "object" && !Array.isArray(body.instanceContext)
	              ? { ...(body.instanceContext as any), businessContext: undefined }
	              : body?.instanceContext;
	          logger.info("[generate-steps] REQUEST", {
	            reqId,
	            instanceId,
	            body: {
	              ...body,
	              stepDataSoFar: undefined,
	              instanceContext: instanceContextForLog,
	              stepDataKeys: stepDataKeysForLog,
                debugEnabled,
	            },
	          });

	        if (!body?.sessionId) {
	          enqueue({ type: "error", error: "sessionId is required" });
	          controller.close();
	          return;
	        }

        // Load instance + subcategory check in parallel
        const admin = createSupabaseAdminClient();
        const supabase = admin.supabase;
        const [instanceResult, subcatResult] = await Promise.all([
          supabase.from("instances").select("*").eq("id", instanceId).single(),
          supabase.from("instance_subcategories").select("category_subcategory_id").eq("instance_id", instanceId).limit(1).then(
            (r) => r,
            () => ({ data: null, error: null })
          ),
        ]);

        const { data: instance, error: instanceError } = instanceResult;
        if (instanceError || !instance) {
          enqueue({ type: "error", error: "Instance not found" });
          controller.close();
          return;
        }

	        const aiFormConfig = extractAIFormConfig((instance as any)?.config);

	          const companySummary = normalizeOptionalString((instance as any)?.company_summary);
	          const instanceServiceSummary = normalizeOptionalString((instance as any)?.service_summary);

	        // Call cap enforcement: backend-owned.
		        const maxCalls = clampMaxBatches(body.formState?.maxBatches);
		        const formState = normalizeFormState(body.formState, body.sessionId, { maxBatches: maxCalls });
		        const batchIndex = formState.batchIndex; // 0-based
	        // Reserve `batch-0` for deterministic bootstrap steps rendered client-side.
	        // This endpoint always generates AI question batches (batch-1, batch-2, ...).
	        const batchId = `batch-${batchIndex + 1}`;

	        // Resolve selected service ids (selected during deterministic bootstrap)
	        const serviceIds = pickServiceIds(stepDataSoFar);

	        const serviceSelectionId = "step-service-primary";

	        let serviceRequired = false;
	        try {
	          const { data: instanceSubcats, error: instanceSubcatsError } = subcatResult;
	          if (!instanceSubcatsError) {
	            serviceRequired = Array.isArray(instanceSubcats) && instanceSubcats.length > 0;
	          }
	        } catch {}

	        if (serviceRequired && serviceIds.length === 0) {
	          const completeFrame = {
	            type: "complete",
	            sessionId: body.sessionId,
	            batchId,
	            maxSteps: aiFormConfig.maxSteps || 20,
	            isLastBatch: false,
	            readyForImageGen: false,
	            callsUsed: batchIndex,
	            maxCalls,
	            didCall: false,
	            ms: Date.now() - t0,
	          };
	          completeFrameSnapshot = completeFrame;
	          enqueue({
	            type: "error",
	            error: "Missing required deterministic answer",
	            details: `Answer '${serviceSelectionId}' before calling generate-steps.`,
	          });
		          enqueue(completeFrame);
	          controller.close();
	          return;
	        }

        // Determine category/subcategory labels for grounding
        // Support both single values (back-compat) and arrays (new)
        const clientIndustryId = normalizeOptionalString((body as any)?.instanceContext?.industry?.id);
        const clientIndustryName = normalizeOptionalString((body as any)?.instanceContext?.industry?.name);
        const clientServiceId = normalizeOptionalString((body as any)?.instanceContext?.service?.id);
        const clientServiceName = normalizeOptionalString((body as any)?.instanceContext?.service?.name);
        
        // Extract arrays from instanceContext (new format)
        const clientCategories = Array.isArray((body as any)?.instanceContext?.categories)
          ? (body as any).instanceContext.categories
          : [];
        const clientSubcategories = Array.isArray((body as any)?.instanceContext?.subcategories)
          ? (body as any).instanceContext.subcategories
          : [];

        // Query ALL categories/subcategories for selected services (not just first)
        const allSubcategories: Array<{ id: string; name: string; categoryId: string | null }> = [];
        const allCategories: Array<{ id: string; name: string }> = [];
        const categoryIdSet = new Set<string>();
        const serviceSummaryBySubcategoryId = new Map<string, string>();
        const serviceSummarySnippets: string[] = [];
        
        if (serviceIds.length > 0) {
          const { data: rows } = await supabase
            .from("categories_subcategories")
            .select("id, subcategory, category_id, service_summary")
            .in("id", serviceIds);
          
          if (Array.isArray(rows)) {
            for (const row of rows) {
              const subcatId = String(row?.id || "");
              const subcatName = String((row as any).subcategory || "");
              const catId = (row as any).category_id ? String((row as any).category_id) : null;
              const svcSummary = normalizeOptionalString((row as any).service_summary);
              
              if (subcatId && subcatName) {
                allSubcategories.push({ id: subcatId, name: subcatName, categoryId: catId });
                if (catId) categoryIdSet.add(catId);
                if (svcSummary) {
                  serviceSummaryBySubcategoryId.set(subcatId, svcSummary);
                  serviceSummarySnippets.push(svcSummary);
                }
              }
            }
          }
        }
        
        // Query all unique categories
        if (categoryIdSet.size > 0) {
          const { data: catRows } = await supabase
            .from("categories")
            .select("id, name")
            .in("id", Array.from(categoryIdSet));
          
          if (Array.isArray(catRows)) {
            for (const cat of catRows) {
              const catId = String(cat?.id || "");
              const catName = String((cat as any).name || "");
              if (catId && catName) {
                allCategories.push({ id: catId, name: catName });
              }
            }
          }
        }
        
        // Merge client-provided arrays with DB-resolved arrays (dedupe by ID)
        const mergedCategories = new Map<string, { id: string; name: string }>();
        const mergedSubcategories = new Map<string, { id: string; name: string; categoryId: string | null }>();
        
        // Add DB-resolved categories/subcategories
        for (const cat of allCategories) {
          mergedCategories.set(cat.id, cat);
        }
        for (const subcat of allSubcategories) {
          mergedSubcategories.set(subcat.id, subcat);
        }
        
        // Add client-provided categories/subcategories (override if present)
        for (const cat of clientCategories) {
          const id = normalizeOptionalString(cat?.id);
          const name = normalizeOptionalString(cat?.name);
          if (id && name) {
            mergedCategories.set(id, { id, name });
          }
        }
        for (const subcat of clientSubcategories) {
          const id = normalizeOptionalString(subcat?.id);
          const name = normalizeOptionalString(subcat?.name);
          if (id && name) {
            // Try to find categoryId from DB data if not provided
            const dbSubcat = allSubcategories.find(s => s.id === id);
            const categoryId = normalizeOptionalString(subcat?.categoryId) || dbSubcat?.categoryId || null;
            mergedSubcategories.set(id, { id, name, categoryId });
          }
        }
        
        const finalCategories = Array.from(mergedCategories.values());
        const finalSubcategories = Array.from(mergedSubcategories.values());
        
        // For back-compat: use first category/subcategory as single values
        const firstCategory = finalCategories[0] || null;
        const firstSubcategory = finalSubcategories[0] || null;
        
        const effectiveServiceId = serviceIds[0] || firstSubcategory?.id || clientServiceId || null;
        const effectiveServiceName =
          (firstSubcategory?.name && firstSubcategory.name.trim()) || clientServiceName || null;
        const effectiveIndustryId = firstCategory?.id || clientIndustryId || null;
        const effectiveIndustryName =
          (firstCategory?.name && firstCategory.name.trim()) || clientIndustryName || null;
        const inferredIndustry = effectiveIndustryName || (aiFormConfig as any).industry || "General";
        let catalogStyleOptionsPromise: Promise<any[]> | null = null;

        const getCatalogStyleOptions = async (): Promise<any[]> => {
          if (!effectiveServiceId) return [];
          if (!catalogStyleOptionsPromise) {
            catalogStyleOptionsPromise = (async () => {
              const selectCols = "id, image_url, metadata, created_at, account_id";
              const accountId = typeof (instance as any)?.account_id === "string" ? String((instance as any).account_id).trim() : "";
              const [accountResult, globalResult] = await Promise.all([
                accountId
                  ? supabase
                      .from("images")
                      .select(selectCols)
                      .eq("subcategory_id", effectiveServiceId)
                      .eq("account_id", accountId)
                      .eq("status", "completed")
                      .order("created_at", { ascending: false })
                      .limit(100)
                  : Promise.resolve({ data: [], error: null }),
                supabase
                  .from("images")
                  .select(selectCols)
                  .eq("subcategory_id", effectiveServiceId)
                  .is("account_id", null)
                  .eq("status", "completed")
                  .order("created_at", { ascending: false })
                  .limit(100),
              ]);

              const merged = [
                ...(Array.isArray(accountResult.data) ? accountResult.data : []),
                ...(Array.isArray(globalResult.data) ? globalResult.data : []),
              ];
              const options = buildCatalogStyleOptions(merged);

              if (debugEnabled) {
                logger.info("[generate-steps] STYLE_CATALOG_LOOKUP", {
                  reqId,
                  instanceId,
                  accountRows: Array.isArray(accountResult.data) ? accountResult.data.length : 0,
                  globalRows: Array.isArray(globalResult.data) ? globalResult.data.length : 0,
                  optionCount: options.length,
                  subcategoryId: effectiveServiceId,
                });
              }

              return options;
            })().catch((error) => {
              logger.warn("[generate-steps] STYLE_CATALOG_LOOKUP_FAILED", {
                reqId,
                instanceId,
                error: error instanceof Error ? error.message : String(error),
                subcategoryId: effectiveServiceId,
              });
              return [];
            });
          }
          return catalogStyleOptionsPromise;
        };

		        const grounding = getServiceGrounding({
		          categoryName: effectiveIndustryName,
		          subcategoryName: effectiveServiceName,
		          subcategoryId: effectiveServiceId,
		          industry: inferredIndustry,
		          trafficSource: "Direct",
		          stepDataSoFar,
		        });

	        // Call cap enforcement (per session) - batchIndex already calculated above
	        const callsRemaining = Math.max(0, maxCalls - batchIndex);

        // REMOVED: Universal deterministic steps - let DSPy generate ALL questions including residential/commercial
        // This ensures all questions are AI-generated and varied, not hardcoded
        const stepIndexStart = 0;

	        if (callsRemaining <= 0) {
	          // Call cap reached: stop asking new generated questions.
	          // Satiety is tracked for metrics only and should not block the form.
	          const completeFrame = {
	            type: "complete",
	            sessionId: body.sessionId,
	            maxSteps: aiFormConfig.maxSteps || 20,
	            isLastBatch: true,
	            readyForImageGen: true,
	            threshold: IMAGE_GEN_THRESHOLD,
            maxCalls,
            ms: Date.now() - t0,
            message: "AI call cap reached.",
            didCall: false,
          };
          completeFrameSnapshot = completeFrame;
          enqueue(completeFrame);
          controller.close();
          return;
        }

        // Calculate satiety from stepData - simple ratio of answered steps
        // NOTE: totalStepsCount should only include question steps (not structural steps like uploads/designer)
        const structuralStepIds = new Set([
          "step-upload-scene-image",
          "step-upload-user-image",
          "step-upload-product-image",
          "step-designer",
          "step-lead-capture",
          "step-pricing",
          "step-confirmation",
        ]);
        const nonSatietyStepIds = new Set([
          ...structuralStepIds,
          // Service selection is deterministic and should not count toward satiety.
          "step-service-primary",
          "step-service",
          "step_service_primary",
          "step_service",
        ]);
	        // Build askedStepIds for DSPy:
	        // - Use QUESTION step IDs (asked whether answered or not) so DSPy doesn't re-ask.
	        // - Never send legacy "plan keys" here; DSPy expects step IDs for de-duping.
		        const uploadStepIds = new Set([
          "step-upload-scene-image",
          "step-upload-user-image",
          "step-upload-product-image",
        ]);
        
        const answeredQuestionStepIds = Object.keys(stepDataSoFar || {})
          .filter((k) => typeof k === "string" && isStepIdLike(k) && !k.startsWith("__") && !nonSatietyStepIds.has(k));

	        const alreadyAskedKeysBase = [
	          ...(askedStepIdsFromClient || []).filter((k: string) => isStepIdLike(k)),
	          ...answeredQuestionStepIds,
	          // Defensive: never include uploads in asked question ids
	          ...existingStepIds.filter(
              (id: string) => isStepIdLike(id) && !uploadStepIds.has(id) && !nonSatietyStepIds.has(id),
            ),
	        ].slice(0, 200);
        // Normalize IDs for DSPy: canonicalize to hyphenated step ids.
        const askedStepIdSet = new Set<string>();
        for (const k of alreadyAskedKeysBase) {
          const id = canonicalizeStepId(String(k || ""));
          if (!id) continue;
          askedStepIdSet.add(id);
        }

        const askedStepIds = Array.from(askedStepIdSet).slice(0, 120);

        const normalizeServiceUrl = (raw: string): string => {
          let serviceUrl = String(raw || "").trim();
          if (!serviceUrl) return "";
          if (!/^https?:\/\//i.test(serviceUrl)) {
            serviceUrl = `https://${serviceUrl.replace(/^\/+/, "")}`;
          }
          return serviceUrl.replace(/\/+$/, "");
        };

        const resolveFormServiceBaseUrls = (): string[] => {
          const isRuntimeProduction =
            process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
          // Server routes must not trust NEXT_PUBLIC_* flags in production.
          // Allow an explicit server-side override via AI_FORM_DEV_MODE only.
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
        };

        const baseUrls = resolveFormServiceBaseUrls();
        if (baseUrls.length === 0) {
          throw new Error("DSPY_SERVICE_URL or PROD_DSPY_SERVICE_URL is not set (required for sif-api-service)");
        }

        // Build payload matching DSPy API schema:
        // - required: session, currentBatch, state
        // - optional: request
        const batchNumber = batchIndex + 1; // Convert 0-based to 1-based (0→1, 1→2)

        // maxSteps is a SUGGESTION to DSPy, not a hard cap. Max 4 questions before concept.
        const calculatedMaxSteps = 4;

	        const includeMeta = process.env.AI_FORM_DEBUG === "true" || (body as any).noCache === true;
        
        // Payload: keep stable schema, but include grounding so the model can "remember"
        // the selected service in plain English (it cannot resolve UUIDs on its own).
        const effectiveUseCase =
          typeof body.useCase === "string" && body.useCase.trim().length > 0
            ? body.useCase.trim()
            : typeof (instance as any)?.use_case === "string" && String((instance as any).use_case).trim().length > 0
              ? String((instance as any).use_case).trim()
              : typeof (instance as any)?.useCase === "string" && String((instance as any).useCase).trim().length > 0
                ? String((instance as any).useCase).trim()
                : null;

	        const derivedServiceSummary = [companySummary, instanceServiceSummary, ...serviceSummarySnippets]
	          .map((s) => (typeof s === "string" ? s.trim() : ""))
	          .filter(Boolean)
	          .slice(0, 6)
	          .join("\n\n") || null;

	        const payload = {
          // Forward useCase to the Python service (prefer request value when present).
          useCase: effectiveUseCase,
          // Option images disabled for now; keep capability for future use.
          optionImages: false,
          // 1. SESSION (Required)
          session: {
            sessionId: body.sessionId,
            instanceId,
          },
          
          // 2. CURRENT BATCH (Required)
          currentBatch: {
            batchId,
            batchNumber,
            maxSteps: calculatedMaxSteps,
          },
          
          // 3. STATE (Required)
		          state: {
		            answers: stepDataSoFar,
		            askedStepIds,
		            grounding,
		            context: {
	                companySummary,
	                serviceSummary: derivedServiceSummary,
	                serviceSummariesBySubcategoryId: Object.fromEntries(serviceSummaryBySubcategoryId.entries()),
		              industry: inferredIndustry,
	                // Preferred naming (new): industry/service (single values for back-compat).
	                industryId: effectiveIndustryId,
                industryName: effectiveIndustryName,
                serviceId: effectiveServiceId,
                serviceName: effectiveServiceName,
                // Array versions (new - preferred): multiple categories/subcategories.
                categories: finalCategories.map(c => ({ id: c.id, name: c.name })),
                subcategories: finalSubcategories.map(s => ({ id: s.id, name: s.name, categoryId: s.categoryId })),
                // Back-compat (old): category/subcategory (single values).
	              categoryName: effectiveIndustryName,
	              subcategoryName: effectiveServiceName,
	              subcategoryId: effectiveServiceId,
		              trafficSource: "Direct",
		            },
		            answeredQA: Array.isArray((body as any)?.answeredQA) ? (body as any).answeredQA : null,
		          },
          
          // OPTIONAL: Request metadata
	          request: {
	            noCache: (body as any).noCache === true,
	            schemaVersion: "2026-01-23.1",
	            includeMeta,
	          },
	        };

        let stepIndex = stepIndexStart;
        const seen = new Set<string>([
          ...existingStepIds,
          ...incomingQuestionStepIds,
          ...Object.keys(stepDataSoFar || {}).filter((k) => typeof k === "string" && isStepIdLike(k) && !k.startsWith("__")),
        ]);

	        const emitMiniStep = async (mini: any) => {
	          try {
	            let sanitized = sanitizeMiniStep(mini);
              if (isCatalogBackedStyleStep(sanitized)) {
                return;
              }
              const styleOptionsMissing = isCatalogBackedStyleStep(sanitized) && (!Array.isArray(sanitized?.options) || sanitized.options.length === 0);
              if (styleOptionsMissing) {
                const catalogOptions = await getCatalogStyleOptions();
                if (catalogOptions.length > 0) {
                  sanitized = {
                    ...sanitized,
                    type: "image_choice_grid",
                    options: catalogOptions,
                  };
                }
              }
	            // BYPASS MAPPER: Use shared contract types directly
	            const stepId = sanitized?.id;
	            if (!stepId) {
	              return;
	            }

	            if (seen.has(stepId)) {
	              return;
	            }
	            seen.add(stepId);
	            streamedQuestionSteps.push(sanitized);
	
	            // Keep schema stable but sanitize copy (e.g., strip emojis) for consistent UX.
	            enqueue({ type: "step", step: sanitized, index: stepIndex++, source: "dspy_batch", ms: Date.now() - t0 });
		          } catch {
		            // Silently continue on step emit errors
		          }
		        };

        // Stream mini steps as they arrive (JSONL) OR fall back to full JSON.
        let streamMiniStepCount = 0;

        // Call the external AI form service and translate its response into our existing SSE envelope.
	        // Service expects JSON POST to /v1/api/form (no SSE, no ?stream=1).
	        let dspySvcEndpoint = "";
	        const upstreamDebug: any = { attempts: [] as any[], selected: null as string | null };
          upstreamDebugSnapshot = upstreamDebug;
	        
	        let svcResp: Response | null = null;
	        let dspyError: any = null;

              const UPSTREAM_TIMEOUT_MS = 45_000;

              for (const baseUrl of baseUrls) {
                const endpoint = new URL(`/v1/api/form/${instanceId}`, baseUrl).toString();
                dspySvcEndpoint = endpoint;
                const attempt: any = { endpoint };
                upstreamDebug.attempts.push(attempt);

                const tFetch0 = Date.now();
                if (debugEnabled) {
                  try {
                    const u = new URL(endpoint);
                    logger.info("[generate-steps] UPSTREAM_REQUEST", {
                      reqId,
                      instanceId,
                      upstream: { origin: u.origin, path: u.pathname },
                      batchId,
                      batchIndex,
                    });
                  } catch {
                    logger.info("[generate-steps] UPSTREAM_REQUEST", {
                      reqId,
                      instanceId,
                      upstream: { endpoint },
                      batchId,
                      batchIndex,
                    });
                  }
                }

                let resp: Response | null = null;
                const abortController = new AbortController();
                const timeoutHandle = setTimeout(() => abortController.abort(), UPSTREAM_TIMEOUT_MS);
                try {
                  resp = await fetch(endpoint, {
                    method: "POST",
                    headers: { "content-type": "application/json", Accept: "application/json" },
                    body: JSON.stringify(payload),
                    cache: "no-store",
                    signal: abortController.signal,
                  });
                  attempt.status = resp.status;
                  attempt.ok = resp.ok;
                } catch (e) {
                  dspyError = e;
                  attempt.fetchError = serializeUnknownErrorForWire(e);
                } finally {
                  clearTimeout(timeoutHandle);
                }

                if (debugEnabled) {
                  logger.info("[generate-steps] UPSTREAM_RESPONSE", {
                    reqId,
                    instanceId,
                    ok: Boolean(resp?.ok),
                    status: resp?.status ?? null,
                    ms: Date.now() - tFetch0,
                  });
                }

                if (dspyError) {
                  continue;
                }

                if (!resp || !resp.ok) {
                  const text = resp ? await resp.text().catch(() => "") : "";
                  attempt.statusText = resp?.statusText ?? null;
                  attempt.responsePreview = text.slice(0, 500);
                  continue;
                }

                svcResp = resp;
                upstreamDebug.selected = endpoint;
                break;
              }

              if (!svcResp) {
                const lastAttempt = upstreamDebug.attempts[upstreamDebug.attempts.length - 1] || null;
                const hint = lastAttempt?.status ? `status=${lastAttempt.status}` : lastAttempt?.fetchError ? "fetch_error" : "no_response";
                dspyError = dspyError || new Error(`DSPy service unreachable (${hint})`);
              }

              if (dspyError && debugEnabled) {
                logger.error("[generate-steps] UPSTREAM_ERROR", {
                  reqId,
                  instanceId,
                  error: serializeUnknownErrorForWire(dspyError),
                  upstream: upstreamDebug,
                });
              }

        // Minimal SSE parser (kept as fallback if the upstream ever returns event-stream).
        let resultMeta: any = null;
        let resultError: any = null;
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        let decoder: TextDecoder | null = null;
        let buf = "";
        let rawUpstream = "";
        let rawUpstreamTruncated = false;
        const RAW_UPSTREAM_MAX_CHARS = 20_000;

          const processFrame = async (frame: string) => {
          const lines = frame.split("\n");
          let event: string | null = null;
          const dataLines: string[] = [];
          for (const ln of lines) {
            const line = ln.trimEnd();
            if (!line) continue;
            if (line.startsWith("event:")) {
              event = line.slice("event:".length).trim();
              continue;
            }
            if (line.startsWith("data:")) {
              dataLines.push(line.slice("data:".length).trim());
              continue;
            }
          }
          const dataText = dataLines.join("\n").trim();
          const data = dataText ? (() => { try { return JSON.parse(dataText); } catch { return null; } })() : null;

          if (event === "mini_step" && data && typeof data === "object") {
            streamMiniStepCount++;
            await emitMiniStep(data);
            return;
          }
          if (event === "meta" && data && typeof data === "object") {
            // IMPORTANT: Do NOT emit steps from meta.miniSteps; they were already streamed as mini_step events.
            resultMeta = data;
            return;
          }
          if (event === "error" && data && typeof data === "object") {
            // Do not clobber an existing meta snapshot; keep the error separately.
            resultError = data;
            return;
          }
        };

        if (!dspyError && svcResp) {
          const ct = (svcResp.headers.get("content-type") || "").toLowerCase();
          const isEventStream = ct.includes("text/event-stream");

          if (isEventStream && svcResp.body) {
            reader = svcResp.body.getReader();
            decoder = new TextDecoder();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              const chunkText = decoder.decode(value, { stream: true });
              if (!rawUpstreamTruncated) {
                const remaining = RAW_UPSTREAM_MAX_CHARS - rawUpstream.length;
                if (remaining > 0) {
                  rawUpstream += chunkText.length > remaining ? chunkText.slice(0, remaining) : chunkText;
                }
                if (rawUpstream.length >= RAW_UPSTREAM_MAX_CHARS) rawUpstreamTruncated = true;
              }
              buf += chunkText;
              let idx: number;
              while ((idx = buf.indexOf("\n\n")) >= 0) {
                const frame = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                if (frame.trim()) await processFrame(frame);
              }
            }
            if (buf.trim()) await processFrame(buf);
          } else {
            const text = await svcResp.text().catch(() => "");
            if (!rawUpstreamTruncated) {
              rawUpstream = text.length > RAW_UPSTREAM_MAX_CHARS ? text.slice(0, RAW_UPSTREAM_MAX_CHARS) : text;
              rawUpstreamTruncated = text.length > RAW_UPSTREAM_MAX_CHARS;
            }
            const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
            if (json && typeof json === "object") {
              resultMeta = json;
              if (debugEnabled) {
                try {
                  const dc = (json as any)?.debugContext;
                  const stats = dc?.optionImageStats;
                  const miniTypes = Array.isArray((json as any)?.miniSteps) ? (json as any).miniSteps.map((s: any) => s?.type).filter(Boolean) : [];
                  const gridCount = miniTypes.filter((t: any) => t === "image_choice_grid").length;
                  logger.info("[generate-steps] UPSTREAM_OPTION_IMAGES", {
                    reqId,
                    instanceId,
                    generateOptionImages: dc?.generateOptionImages,
                    optionImageStats: stats ?? null,
                    upstreamImageChoiceGridCount: gridCount,
                  });
                } catch {}
              }
              const minis = Array.isArray((json as any).miniSteps) ? (json as any).miniSteps : [];
              for (const mini of minis) {
                await emitMiniStep(mini);
                streamMiniStepCount++;
              }
            } else if (text) {
              resultError = { message: "Invalid JSON from DSPy service", rawPreview: text.slice(0, 500) };
            }
          }
        }

	        const result: any =
	          resultMeta ??
	          (resultError ? { error: (resultError as any)?.message || "DSPy service error", details: resultError } : null) ??
	          { ok: true, miniSteps: [], requestId: `svc_${Date.now()}` };
	        upstreamJson = result;

	        // Handle errors - check early, log concisely
	        if (dspyError || result?.error) {
	          // If we already received steps, silently continue (steps were already sent to frontend)
	          if (streamMiniStepCount > 0) {
            // Clear the error so we can continue processing
            if (result) {
              result.error = undefined;
            }
            // Don't return early, let the normal flow complete
	          } else {
	            // No steps generated - this is a real failure
	            const details = {
	              upstream: upstreamDebug,
	              error: dspyError ? serializeUnknownErrorForWire(dspyError) : null,
	              response: result?.details || result?.rawPreview || result?.error || null,
	            };
	            enqueue({ type: "error", error: "DSPy service error", details, ms: Date.now() - t0 });
	            controller.close();
	            return;
	          }
	        }

        // Check if no steps were generated but we expected some
        // Don't fail - let the client handle empty steps gracefully


        // Planning is not part of the contract; this route only returns question steps + optional usage.

        // CRITICAL: Only send structural steps when readyForImageGen is true
		        // This prevents upload steps from appearing too early (e.g., on step 1)
		        const isFinalBatchByCap = (batchIndex + 1) >= maxCalls;
		        const readyForImageGen = Boolean((result as any)?.readyForImageGen) || isFinalBatchByCap;
	        // If the model decides no questions are needed (0 steps) but satiety is already at/above threshold,
	        // treat this as terminal and send structural steps immediately to avoid a redundant follow-up call.
	        const noQuestionStepsFromModel = streamMiniStepCount === 0;
	        const forceReadyBecauseNoQuestions =
	          noQuestionStepsFromModel && typeof (result as any)?.satiety === "number"
	            ? (result as any).satiety >= IMAGE_GEN_THRESHOLD
	            : noQuestionStepsFromModel && readyForImageGen;
	        const effectiveReadyForImageGen = readyForImageGen || forceReadyBecauseNoQuestions;
	        const effectiveIsFinalBatchByCap = isFinalBatchByCap || forceReadyBecauseNoQuestions;

        // Calculate final satiety after all steps are generated
        // Satiety should only count QUESTION steps (not structural steps like uploads/designer/lead)
        // Filter out structural steps from existingStepIds
	        const finalQuestionStepIds = (Array.isArray(body.questionStepIds) ? body.questionStepIds : existingStepIds)
	          .filter((id: string) => !nonSatietyStepIds.has(id));
	        const finalAnsweredSteps = Object.keys(stepDataSoFar || {})
	          .filter((k: string) => !k.startsWith("__") && !nonSatietyStepIds.has(k)).length;
        // Total question steps = existing question steps + newly generated question steps
        const finalTotalSteps = finalQuestionStepIds.length + streamMiniStepCount;
	        const finalSatiety = finalTotalSteps > 0 ? Math.min(1.0, finalAnsweredSteps / finalTotalSteps) : 0;
	        
	        const modelRequestId = (result as any)?.requestId || (result as any)?.request_id || reqId;

	        enqueue({
	          type: "meta",
	          batchId,
	          modelRequestId,
	          payloadRequest: payload,
	          payloadResponse: {
	            meta: resultMeta,
	            error: resultError,
            upstream: result,
          },
        });

		        const completeFrame = {
		          type: "complete",
		          sessionId: body.sessionId,
		          batchId,
		          modelRequestId,
		          maxSteps: aiFormConfig.maxSteps || 20,
		          isLastBatch: effectiveIsFinalBatchByCap,
		          readyForImageGen: effectiveReadyForImageGen,
	          threshold: IMAGE_GEN_THRESHOLD,
	          callsUsed: batchIndex + 1,
	          maxCalls,
	          satiety: finalSatiety,
          answeredSteps: finalAnsweredSteps,
          totalSteps: finalTotalSteps,
	          ms: Date.now() - t0,
	          didCall: true,
	          message: forceReadyBecauseNoQuestions
	            ? `Generated batch ${batchIndex + 1}/${maxCalls} (${batchId}) — no questions needed.`
	            : `Generated batch ${batchIndex + 1}/${maxCalls} (${batchId}).`,
	        };
          completeFrameSnapshot = completeFrame;
          emittedMiniStepsSnapshot = streamedQuestionSteps.slice();
        enqueue(completeFrame);
        controller.close();
      } catch (e) {
        const duration = Date.now() - t0;
        const errorMsg = e instanceof Error ? e.message : "Internal server error";
        try {
          enqueue({ 
            type: "error", 
            error: errorMsg,
            details: e instanceof Error ? e.stack : String(e)
          });
        } catch {
          // Silently continue
        }
        controller.close();
        
        logger.error("[generate-steps] ERROR", {
          message: errorMsg,
          durationMs: duration,
          error: e instanceof Error ? { name: e.name, stack: e.stack } : String(e),
        });
      }
    },
  });

  // Stop returning frames/event-stream: always buffer and return a single JSON object.
  {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const frames: any[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const obj = parseSseDataFrame(frame);
        if (obj && typeof obj === "object") frames.push(obj);
      }
    }
    if (buf.trim()) {
      const obj = parseSseDataFrame(buf);
      if (obj && typeof obj === "object") frames.push(obj);
    }

	    // Treat the upstream Python/DSPy response as the source of truth.
      const requestId = upstreamJson?.requestId ?? upstreamJson?.request_id ?? reqId;
      const schemaVersion = upstreamJson?.schemaVersion ?? upstreamJson?.schema_version ?? null;
      // Return the steps we emitted (includes local fallbacks + dedupe), falling back to upstream only
      // if (for some reason) we emitted none.
	      const miniSteps =
	        Array.isArray(emittedMiniStepsSnapshot) && emittedMiniStepsSnapshot.length > 0
	          ? emittedMiniStepsSnapshot
	          : Array.isArray(upstreamJson?.miniSteps)
	            ? upstreamJson.miniSteps
	            : [];
	      const sanitizedMiniSteps = Array.isArray(miniSteps) ? miniSteps.map(sanitizeMiniStep) : [];
			    const lmUsage = upstreamJson?.lmUsage ?? null;
		    const deterministicCopy =
		      upstreamJson &&
		      typeof (upstreamJson as any)?.deterministicCopy === "object" &&
		      !Array.isArray((upstreamJson as any).deterministicCopy)
		        ? (upstreamJson as any).deterministicCopy
		        : undefined;
		    const responsePayload = {
		        requestId,
		        schemaVersion,
		        miniSteps: sanitizedMiniSteps,
		        deterministicCopy: deterministicCopy ?? undefined,
		        lmUsage,
	        // Backend-owned capability flags (frontend must be reactive, never predictive).
	        capabilities: {
	          // Capability (not readiness): this flow supports showing a progressive image preview rail.
	          // The client still gates *when* to show/generate the preview (e.g. at ~60% progress),
	          // so we keep this flag stable across the whole batch.
	          image_preview: true,
	        },
	        readyForImageGen:
          typeof completeFrameSnapshot?.readyForImageGen === "boolean"
            ? completeFrameSnapshot.readyForImageGen
            : undefined,
        satiety: typeof completeFrameSnapshot?.satiety === "number" ? completeFrameSnapshot.satiety : undefined,
        answeredSteps:
          typeof completeFrameSnapshot?.answeredSteps === "number" ? completeFrameSnapshot.answeredSteps : undefined,
        totalSteps: typeof completeFrameSnapshot?.totalSteps === "number" ? completeFrameSnapshot.totalSteps : undefined,
        callsUsed: typeof completeFrameSnapshot?.callsUsed === "number" ? completeFrameSnapshot.callsUsed : undefined,
        maxCalls: typeof completeFrameSnapshot?.maxCalls === "number" ? completeFrameSnapshot.maxCalls : undefined,
        didCall: typeof completeFrameSnapshot?.didCall === "boolean" ? completeFrameSnapshot.didCall : undefined,
      };
      // Log API response (the only response log we want for this route)
      logger.info("[generate-steps] RESPONSE", {
        reqId,
        instanceId,
        response: responsePayload,
      });
		    return NextResponse.json(
		      responsePayload,
		      {
	        headers: {
	          "Cache-Control": "no-store",
	        },
	      }
	    );
  }
}
