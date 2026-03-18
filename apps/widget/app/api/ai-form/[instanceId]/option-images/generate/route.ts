import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/server/logger";
import { normalizeReferenceImages, referenceImageSchemeCounts } from "@/lib/ai-form/utils/reference-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const OPTION_IMAGE_MODEL_ID = "black-forest-labs/flux-schnell";

function normalizeServiceUrl(raw: unknown): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  return s.replace(/\/+$/, "");
}

function resolveFormServiceBaseUrls(): string[] {
  const isRuntimeProduction =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  // Do not let NEXT_PUBLIC_* env toggle server upstreams in production.
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

export async function POST(request: NextRequest, { params }: { params: { instanceId: string } }) {
  const instanceId = String(params.instanceId || "").trim();
  if (!instanceId) return NextResponse.json({ ok: false, error: "Missing instanceId" }, { status: 400 });

  let body: any = {};
  try {
    body = await request.json();
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
    return NextResponse.json({ ok: false, error: "sessionId is required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  // Server-side kill switch: when disabled, return options without images to avoid upstream 500s.
  const optionImagesEnabled =
    String(process.env.OPTION_IMAGES_ENABLED || process.env.AI_FORM_OPTION_IMAGES || "")
      .trim()
      .toLowerCase() === "true";
  if (!optionImagesEnabled) {
    const stepIdEarly = typeof body?.stepId === "string" ? body.stepId.trim() : "";
    const questionEarly = typeof body?.question === "string" ? body.question.trim() : "Choose an option.";
    const optsFromBody = Array.isArray(body?.options) ? body.options : (body?.step && typeof body.step === "object" ? (body.step as any)?.options : null);
    const optionsEarly = Array.isArray(optsFromBody) ? optsFromBody : [];
    return NextResponse.json(
      { ok: true, stepId: stepIdEarly || null, question: questionEarly, options: optionsEarly },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const stepId = typeof body?.stepId === "string" ? body.stepId.trim() : "";
  const question = typeof body?.question === "string" ? body.question.trim() : undefined;
  const serviceSummary = typeof body?.serviceSummary === "string" ? body.serviceSummary.trim() : undefined;
  const service = typeof body?.service === "string" ? body.service.trim() : undefined;
  const industry = typeof body?.industry === "string" ? body.industry.trim() : undefined;
  const step = body?.step && typeof body.step === "object" && !Array.isArray(body.step) ? body.step : undefined;
  const options = Array.isArray(body?.options) ? body.options : undefined;

  // Extract budget from stepDataSoFar so option images can be calibrated to the user's budget tier.
  const stepDataSoFar = body?.stepDataSoFar && typeof body.stepDataSoFar === "object" ? body.stepDataSoFar : {};
  const budgetRange =
    stepDataSoFar?.["step-budget-range"] ??
    stepDataSoFar?.["budget_range"] ??
    stepDataSoFar?.["budgetRange"] ??
    body?.budgetRange ??
    null;
  const budgetRangeStr = budgetRange !== null && budgetRange !== undefined ? String(budgetRange) : undefined;

  const referenceImages = normalizeReferenceImages(body?.referenceImages, { allowData: true, max: 6 });

  const payload = {
    instanceId,
    session: { sessionId, instanceId },
    modelId: OPTION_IMAGE_MODEL_ID,
    ...(stepId ? { stepId } : {}),
    ...(question ? { question } : {}),
    ...(serviceSummary ? { serviceSummary } : {}),
    ...(service ? { service } : {}),
    ...(industry ? { industry } : {}),
    ...(referenceImages.length ? { referenceImages } : {}),
    ...(step ? { step } : {}),
    ...(options ? { options } : {}),
    ...(budgetRangeStr ? { budgetRange: budgetRangeStr } : {}),
  };

  logger.info("[option-images] normalized_reference_images", {
    instanceId,
    sessionId,
    stepId: stepId || null,
    count: referenceImages.length,
    schemes: referenceImageSchemeCounts(referenceImages),
    source: "body.referenceImages",
  });

  const baseUrls = resolveFormServiceBaseUrls();
  if (baseUrls.length === 0) {
    return NextResponse.json({ ok: false, error: "DSPy service URL is not configured" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  let lastErr: any = null;
  for (const baseUrl of baseUrls) {
    const endpoint = new URL("/v1/api/option-images/generate", baseUrl).toString();
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const text = await resp.text().catch(() => "");
      const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
      if (!resp.ok) {
        lastErr = { status: resp.status, details: json ?? text.slice(0, 2000) };
        logger.warn("[option-images] upstream_error", { instanceId, endpoint, status: resp.status, details: lastErr.details });
        continue;
      }
      return NextResponse.json(json ?? { ok: false, error: "Invalid JSON from upstream" }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      logger.warn("[option-images] upstream_fetch_failed", { instanceId, endpoint, error: lastErr });
      continue;
    }
  }

  // Graceful degradation: return 200 with empty options so the form continues to work.
  // Option images are enhancement; do not fail the flow when upstream is unreachable.
  logger.warn("[option-images] falling_back_to_empty", { instanceId, stepId: stepId || null, error: lastErr });
  return NextResponse.json(
    { ok: true, stepId: stepId || null, question: question || "Choose an option.", options: [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}
