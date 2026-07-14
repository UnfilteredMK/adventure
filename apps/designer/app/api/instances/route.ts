import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';
import { compactDesignConfigToV2 } from '@/lib/design-config-v2';
import { defaultDesignSettingsV2 } from '@/types/design-v2';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookies().getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookies().set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
      }
    );
    
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Use RLS - no manual filtering needed
    const { data: instances } = await supabase
      .from("instances")
      .select("*")
      .order("created_at", { ascending: false });
    return NextResponse.json({ instances });
  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookies().getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookies().set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
      }
    );
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    
    const body = await request.json();
    const { name, description, use_case, website_url, company_summary } = body;
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    const initialConfig = compactDesignConfigToV2(
      {
        ...defaultDesignSettingsV2,
        suggestions_enabled: false,
        visual_pricing_journey_version: 'legacy',
        form_status_enabled: true,
        form_show_progress_bar: true,
        form_show_step_descriptions: true,
        lead_capture_enabled: true,
        gallery_show_placeholder_images: false,
      },
      { fillDefaults: true },
    );
    
    // Use RLS - user_id will be set automatically via RLS
    const { data: instance, error } = await supabase
      .from("instances")
      .insert({
        name,
        description,
        user_id: user.id,
        slug,
        use_case: use_case || 'scene', // Default to 'scene' if not provided
        website_url: typeof website_url === 'string' && website_url.trim().length > 0 ? website_url.trim() : null,
        company_summary: typeof company_summary === 'string' && company_summary.trim().length > 0 ? company_summary.trim() : null,
        is_public: true, // Default to public for new instances
        submission_limit_enabled: false,
        max_submissions_per_session: 5,
        config: initialConfig,
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(instance);
  } catch (error) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
