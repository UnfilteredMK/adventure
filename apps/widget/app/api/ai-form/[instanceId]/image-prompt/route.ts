import { NextResponse } from "next/server";
import { logger } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { instanceId: string } }) {
  const instanceId = String(params.instanceId || "").trim();
  logger.warn("[image-prompt] deprecated_route_called", {
    instanceId: instanceId || null,
  });
  return NextResponse.json(
    {
      ok: false,
      error: "deprecated",
      message: "Prompt generation now happens inside /api/generate requests. Do not call /api/ai-form/:instanceId/image-prompt.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(_request: Request, { params }: { params: { instanceId: string } }) {
  return POST(_request, { params });
}
