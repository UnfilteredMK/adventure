import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/server/logger";
import { resolveDspyServiceBaseUrl } from "@/lib/ai-form/dspy/service-sse";
import { normalizeReferenceImages, referenceImageSchemeCounts } from "@/lib/ai-form/utils/reference-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeServiceUrl(raw: string): string {
  let serviceUrl = String(raw || "").trim();
  if (!serviceUrl) return "";
  if (!/^https?:\/\//i.test(serviceUrl)) {
    serviceUrl = `https://${serviceUrl.replace(/^\/+/, "")}`;
  }
  return serviceUrl.replace(/\/+$/, "");
}

function resolveFormServiceBaseUrl(): string {
  const devModeFlag = process.env.NEXT_PUBLIC_AI_FORM_DEV_MODE;
  const forceDev = devModeFlag === "true";
  const forceProd = devModeFlag === "false";
  const isDevMode = forceDev || (!forceProd && process.env.NODE_ENV !== "production");

  const devUrl = normalizeServiceUrl(process.env.DEV_DSPY_SERVICE_URL || "");
  const prodUrl = normalizeServiceUrl(process.env.DSPY_SERVICE_URL || process.env.PROD_DSPY_SERVICE_URL || "");

  const raw = isDevMode ? (devUrl || prodUrl) : (prodUrl || devUrl);
  if (!raw) {
    throw new Error("DSPY service URL is not set (set DSPY_SERVICE_URL or DEV_DSPY_SERVICE_URL)");
  }
  return resolveDspyServiceBaseUrl(raw);
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

  const useCase = typeof body?.useCase === "string" ? body.useCase : undefined;
  const stepDataSoFar = body?.stepDataSoFar && typeof body.stepDataSoFar === "object" && !Array.isArray(body.stepDataSoFar) ? body.stepDataSoFar : {};
  const answeredQA = Array.isArray(body?.answeredQA) ? body.answeredQA : [];
  const instanceContext =
    body?.instanceContext && typeof body.instanceContext === "object" && !Array.isArray(body.instanceContext)
      ? body.instanceContext
      : {};

  const referenceImages = normalizeReferenceImages(body?.referenceImages, { allowData: true, max: 6 });
  const sceneImage = typeof body?.sceneImage === "string" ? body.sceneImage.trim() : "";
  const productImage = typeof body?.productImage === "string" ? body.productImage.trim() : "";
  const modelId = typeof body?.modelId === "string" ? body.modelId.trim() : undefined;
  const negativePrompt = typeof body?.negativePrompt === "string" ? body.negativePrompt.trim() : undefined;
  const noCache = Boolean(body?.noCache);

  const generationIntent =
    typeof body?.generationIntent === "string" ? body.generationIntent.trim() : undefined;
  const originalReferenceImage =
    typeof body?.originalReferenceImage === "string" ? body.originalReferenceImage.trim() : undefined;
  const generationIndex =
    typeof body?.generationIndex === "number" && Number.isFinite(body.generationIndex)
      ? body.generationIndex
      : undefined;

  const payload = {
    instanceId,
    session: { sessionId, instanceId },
    useCase,
    stepDataSoFar,
    referenceImages,
    answeredQA,
    instanceContext,
    ...(sceneImage ? { sceneImage } : {}),
    ...(productImage ? { productImage } : {}),
    ...(modelId ? { modelId } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(noCache ? { noCache: true } : {}),
    ...(generationIntent ? { generationIntent } : {}),
    ...(originalReferenceImage ? { originalReferenceImage } : {}),
    ...(generationIndex !== undefined ? { generationIndex } : {}),
  };

  logger.info("[image-prompt] normalized_reference_images", {
    instanceId,
    sessionId,
    count: referenceImages.length,
    schemes: referenceImageSchemeCounts(referenceImages),
    source: "body.referenceImages",
  });

  const svcBase = resolveFormServiceBaseUrl();
  const endpoint = new URL("/v1/api/image/prompt", svcBase).toString();

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("[image-prompt] upstream_fetch_failed", { instanceId, endpoint, error: msg });
    return NextResponse.json({ ok: false, error: "Upstream prompt service unreachable", details: msg }, { status: 502 });
  }

  const text = await resp.text().catch(() => "");
  const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!resp.ok) {
    return NextResponse.json(
      { ok: false, error: "upstream_error", status: resp.status, details: json ?? text.slice(0, 2000) },
      { status: resp.status, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(json ?? { ok: false, error: "Invalid JSON from upstream" }, { headers: { "Cache-Control": "no-store" } });
}

