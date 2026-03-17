import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { IMAGES_BUCKET, IMAGE_STORAGE_PREFIXES } from "@/storage/prefixes";

export const dynamic = "force-dynamic";

function sanitizeFilename(name: string) {
  return String(name || "file")
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^\w.\-()+ ]+/g, "")
    .slice(0, 120) || "file";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookies().getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, options, value }) => cookies().set(name, value, options));
            } catch {
              // Ignore: called from server component context.
            }
          },
        },
      },
    );

    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user ?? null;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const instanceIdRaw = form.get("instanceId");
    const instanceId = typeof instanceIdRaw === "string" ? instanceIdRaw : "";

    if (!instanceId) {
      return NextResponse.json({ error: "Missing instanceId" }, { status: 400 });
    }

    // NOTE: Node 18 does not have a global `File` type. Next.js will provide a
    // Blob-like object (sometimes backed by `buffer.File`). Avoid `instanceof File`.
    if (!file || typeof file === "string" || typeof (file as any).arrayBuffer !== "function") {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const blob = file as unknown as Blob & { name?: string; size?: number; type?: string };
    const contentType = String((blob as any).type || "");
    const size = Number((blob as any).size || 0);
    const originalName = typeof (blob as any).name === "string" ? String((blob as any).name) : "logo";

    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    if (size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 2MB)" }, { status: 400 });
    }

    const supabaseAdmin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Load instance and verify membership/role
    const { data: instance, error: instanceError } = await supabaseAdmin
      .from("instances")
      .select("id, account_id")
      .eq("id", instanceId)
      .maybeSingle();

    if (instanceError) {
      return NextResponse.json({ error: instanceError.message || "Failed to load instance" }, { status: 500 });
    }
    if (!instance?.account_id) {
      return NextResponse.json({ error: "Instance not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("user_accounts")
      .select("user_status")
      .eq("user_id", user.id)
      .eq("account_id", instance.account_id)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message || "Failed to verify permissions" }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const allowedRoles = new Set(["owner", "admin"]);
    if (!allowedRoles.has(String((membership as any).user_status || ""))) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const safeName = sanitizeFilename(originalName);
    const objectPath = `${IMAGE_STORAGE_PREFIXES.logos}/${instanceId}/${Date.now()}-${safeName}`;

    const bytes = new Uint8Array(await (blob as any).arrayBuffer());
    const { error: uploadError, data: uploadData } = await supabaseAdmin.storage
      .from(IMAGES_BUCKET)
      .upload(objectPath, bytes, {
        cacheControl: "3600",
        contentType,
        upsert: false,
      });

    if (uploadError) {
      // This is where Storage RLS typically surfaces; using service role should bypass it.
      return NextResponse.json({ error: uploadError.message || "Upload failed" }, { status: 500 });
    }

    const { data: publicData } = supabaseAdmin.storage.from(IMAGES_BUCKET).getPublicUrl(uploadData.path);
    const url = publicData?.publicUrl || "";
    if (!url) {
      return NextResponse.json({ error: "Failed to resolve public URL" }, { status: 500 });
    }

    return NextResponse.json({ url });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ? String(e.message) : "Upload failed" },
      { status: 500 },
    );
  }
}
