import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { applyThemeToConfig, themeForSlugOrName, getPresetForSubcategory, getPresetByKey } from '@/lib/demo-themes';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { instanceId: string; type: string; slug: string } }
) {
  try {
    const initialsFrom = (subcategory: string | null | undefined): string => {
      const words = String(subcategory || '')
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean);
      if (words.length === 0) return 'AI';
      const chars = words.slice(0, 2).map(w => w[0]!.toUpperCase());
      return chars.join('');
    };

    const monogramDataUrl = (subcategory: string | null | undefined, colorHex?: string): string => {
      const initials = initialsFrom(subcategory);
      const bg = colorHex || '#111827';
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="16" fill="${bg}"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="56" font-weight="700" font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial">${initials}</text>
</svg>`;
      const base64 = Buffer.from(svg, 'utf8').toString('base64');
      return `data:image/svg+xml;base64,${base64}`;
    };

    // iconFor removed: logo/icon should be provided by demo_template_config or prospect.logo_url
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing environment variables' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      db: { schema: 'public' },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    // Use service role key for subcategory queries to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const { instanceId, type } = params;
    // Normalize slug: collapse multiple dashes, trim leading/trailing dashes, lowercase
    const rawSlug = params.slug || '';
    const cleanedSlug = rawSlug.replace(/-+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

    // First, verify the base instance exists
    const { data: instance, error: instanceError } = await supabase
      .from('instances')
      .select('*')
      .eq('id', instanceId)
      .single();

    if (instanceError || !instance) {
      return NextResponse.json({ error: 'Base instance not found' }, { status: 404 });
    }

    // Determine demo mode and type from instance
    const isDemoEnabled = !!((instance.config && (instance.config as any).demo_enabled === true) || (instance as any).demo_instance === true);
    const demoType = ((instance as any).demo_instance_type as string) || type || 'industry';

    // Load source row based on demo type
    let selectedSubcategory: any | null = null;
    let selectedProspect: any | null = null;
    let demoTemplateConfig: any | null = null;
    let demoBranding: any | null = null;

    if (demoType === 'industry') {
      // Look up subcategory by slug
      let { data: subcategoryMatches, error: subcatError } = await supabaseAdmin
        .from('categories_subcategories')
        .select('id, slug, subcategory, demo_template_config, subcategory_components, subcategory_scope')
        .eq('slug', cleanedSlug)
        .limit(1);

      if ((!subcategoryMatches || subcategoryMatches.length === 0) && !subcatError && cleanedSlug) {
        const { data: altMatches } = await supabaseAdmin
          .from('categories_subcategories')
          .select('id, slug, subcategory, demo_template_config, subcategory_components, subcategory_scope')
          .ilike('subcategory', `%${cleanedSlug.replace(/-/g, ' ')}%`)
          .limit(1);
        if (altMatches && altMatches.length > 0) {
          subcategoryMatches = altMatches;
        }
      }

      if (!subcatError) {
        selectedSubcategory = (subcategoryMatches && subcategoryMatches[0]) || null;
      }

      // Optional: verify linkage
      if (selectedSubcategory) {
        await supabaseAdmin
          .from('instance_subcategories')
          .select('category_subcategory_id')
          .eq('instance_id', instanceId)
          .eq('category_subcategory_id', selectedSubcategory.id)
          .maybeSingle();
      }

      demoTemplateConfig = selectedSubcategory?.demo_template_config || null;
    } else {
      // Prospect demo path
      const { data: prospect, error: pErr } = await supabaseAdmin
        .from('prospects')
        .select('id, slug, company_name, logo_url, demo_theme_key, demo_template_config')
        .eq('slug', cleanedSlug)
        .maybeSingle();
      if (!pErr) selectedProspect = prospect;
      demoTemplateConfig = selectedProspect?.demo_template_config || null;
    }

    let mergedConfig: any = {
      ...(instance.config || {}),
    };

    if (isDemoEnabled) {
      // Only take header/title/logo related fields from demo template config
      // Force header/title/logo to demo values or sensible fallbacks
      const subcatName = selectedSubcategory?.subcategory || null;
      const prospectName = selectedProspect?.company_name || null;
      const brandName = (demoTemplateConfig && (demoTemplateConfig as any).brand_name) || prospectName || subcatName || (instance as any).name || 'Demo';
      const titleText = (demoTemplateConfig && (demoTemplateConfig as any).title_text) || subcatName || prospectName || 'Demo';
      (mergedConfig as any).header_enabled = true;
      (mergedConfig as any).brand_name_enabled = true;
      (mergedConfig as any).title_enabled = true;
      (mergedConfig as any).brand_name = brandName;
      (mergedConfig as any).title_text = titleText;
      (mergedConfig as any).demo_enabled = true;
    }

    // Prefer logo/icon stored in demo_template_config (or prospect.logo_url). As a final fallback, use a monogram.
    if (isDemoEnabled) {
      const tplLogo = (demoTemplateConfig && (demoTemplateConfig as any).logo_url) ? String((demoTemplateConfig as any).logo_url) : '';
      const demoLogo = tplLogo || (selectedProspect?.logo_url ? String(selectedProspect.logo_url) : '');
      (mergedConfig as any).logo_url = demoLogo
        ? demoLogo
        : monogramDataUrl(
            demoType === 'prospect' ? (selectedProspect?.company_name || 'AI') : (selectedSubcategory?.subcategory || 'AI'),
            (mergedConfig as any).primary_color
          );
      if (typeof (mergedConfig as any).logo_enabled === 'undefined' || (mergedConfig as any).logo_enabled === false) {
        (mergedConfig as any).logo_enabled = true;
      }
    }

    // Apply local demo theme preset to strongly override styling for demo rendering
    if (isDemoEnabled) {
      // Prefer a full preset from stored theme key on demo_template_config, else infer
      const storedThemeKey = (demoTemplateConfig && (demoTemplateConfig as any).theme_key)
        ? String((demoTemplateConfig as any).theme_key).toLowerCase()
        : (selectedProspect?.demo_theme_key ? String(selectedProspect.demo_theme_key).toLowerCase() : null);
      const preset = storedThemeKey
        ? getPresetByKey(storedThemeKey)
        : getPresetForSubcategory(selectedSubcategory?.subcategory || selectedProspect?.company_name || cleanedSlug);
      // Apply preset first so forced header/title below wins
      mergedConfig = { ...preset, ...mergedConfig };
      const theme = themeForSlugOrName(selectedSubcategory?.subcategory || selectedProspect?.company_name || cleanedSlug);
      mergedConfig = applyThemeToConfig(theme, mergedConfig);
      // Re-assert brand/title after theme application to avoid accidental override
      const subcatName = selectedSubcategory?.subcategory || null;
      const prospectName = selectedProspect?.company_name || null;
      const brandName = (demoTemplateConfig && (demoTemplateConfig as any).brand_name) || prospectName || subcatName || (instance as any).name || 'Demo';
      const titleText = (demoTemplateConfig && (demoTemplateConfig as any).title_text) || subcatName || prospectName || 'Demo';
      (mergedConfig as any).header_enabled = true;
      (mergedConfig as any).brand_name_enabled = true;
      (mergedConfig as any).title_enabled = true;
      (mergedConfig as any).brand_name = brandName;
      (mergedConfig as any).title_text = titleText;
    }

    const demoInstance = {
      ...instance,
      config: mergedConfig,
      active_demo: {
        type,
        slug: cleanedSlug,
        subcategory: selectedSubcategory || null,
        prospect: selectedProspect || null,
      }
    } as any;

    const debug = {
      selected_subcategory_id: selectedSubcategory ? (selectedSubcategory as any).id : null,
      has_demo_template_config: !!demoTemplateConfig,
      has_demo_branding: !!(demoTemplateConfig && (demoTemplateConfig as any).logo_url) || !!(selectedProspect?.logo_url),
      merged_brand_name: mergedConfig?.brand_name || null,
      source: isDemoEnabled ? (demoType === 'prospect' ? 'prospect_demo' : 'subcategory_demo') : 'instance_config',
      inferred_logo_url: (mergedConfig as any).logo_url || null
    };

    return NextResponse.json({ success: true, instance: demoInstance, debug });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { instanceId: string; type: string; slug: string } }
) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Missing environment variables' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const { type, slug } = params;
    const body = await request.json().catch(() => ({}));
    const themeKey = String(body?.themeKey || '').toLowerCase();
    if (!themeKey) {
      return NextResponse.json({ error: 'themeKey required' }, { status: 400 });
    }

    if (type === 'industry') {
      // Merge theme_key into existing demo_template_config without destroying brand_name/logo_url
      const { data: row, error: readErr } = await supabaseAdmin
        .from('categories_subcategories')
        .select('id, demo_template_config, subcategory')
        .eq('slug', slug)
        .maybeSingle();
      if (readErr || !row) return NextResponse.json({ error: readErr?.message || 'Not found' }, { status: 404 });
      const currentCfg = (row as any).demo_template_config || {};
      const newCfg = { ...currentCfg, theme_key: themeKey };
      const { error: upErr } = await supabaseAdmin
        .from('categories_subcategories')
        .update({ demo_template_config: newCfg })
        .eq('id', (row as any).id);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    if (type === 'prospect') {
      // Update prospects demo_theme_key and merge theme_key into demo_template_config
      const { data: prow, error: preadErr } = await supabaseAdmin
        .from('prospects')
        .select('id, demo_template_config')
        .eq('slug', slug)
        .maybeSingle();
      if (preadErr || !prow) return NextResponse.json({ error: preadErr?.message || 'Not found' }, { status: 404 });
      const currentCfg = (prow as any).demo_template_config || {};
      const newCfg = { ...currentCfg, theme_key: themeKey };
      const { error: upErr } = await supabaseAdmin
        .from('prospects')
        .update({ demo_theme_key: themeKey, demo_template_config: newCfg })
        .eq('id', (prow as any).id);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unsupported type' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
