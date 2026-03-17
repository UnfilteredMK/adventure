import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/server/logger";
import { isImageRefLike } from "@/lib/ai-form/utils/reference-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

function decodeDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return null;
  const contentType = String(match[1] || "image/png").toLowerCase();
  const base64Payload = String(match[2] || "").replace(/\s+/g, "");
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Payload, "base64");
  } catch {
    return null;
  }
  if (!buffer || buffer.length === 0 || buffer.length > MAX_BYTES) return null;
  return { contentType, buffer };
}

export async function POST(request: NextRequest) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const instanceId = typeof body?.instanceId === "string" ? body.instanceId.trim() : "";
  const image = typeof body?.image === "string" ? body.image.trim() : "";
  if (!instanceId) {
    return NextResponse.json({ ok: false, error: "instanceId is required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!image || !isImageRefLike(image, true)) {
    return NextResponse.json({ ok: false, error: "image is required" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  if (!image.startsWith("data:")) {
    return NextResponse.json({ ok: true, url: image, stored: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const decoded = decodeDataUrl(image);
  if (!decoded) {
    return NextResponse.json(
      { ok: false, error: "Invalid or too-large data URL image payload" },
      { status: 413, headers: { "Cache-Control": "no-store" } }
    );
  }

  logger.info("[upload-reference-image] bypass_storage", {
    instanceId,
    contentType: decoded.contentType,
    bytes: decoded.buffer.length,
  });
  return NextResponse.json({ ok: true, url: image, stored: false }, { headers: { "Cache-Control": "no-store" } });
}
