import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchPreviewSuggestionsForInstance } from "@/lib/preview-suggestions-query";
import { logger } from "@/lib/server/logger";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(
  request: NextRequest,
  { params }: { params: { instanceId: string } }
) {
  try {
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 });
    }

    const instanceId = params.instanceId;
    if (!instanceId) {
      return NextResponse.json({ error: "instanceId required" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const count = Math.min(12, Math.max(1, parseInt(searchParams.get("count") || "5", 10) || 5));

    const supabase = createClient(supabaseUrl, supabaseKey);
    const suggestions = await fetchPreviewSuggestionsForInstance(supabase, instanceId, count);

    return NextResponse.json({ suggestions });
  } catch (e) {
    logger.error("preview-suggestions GET failed", { error: e });
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }
}
