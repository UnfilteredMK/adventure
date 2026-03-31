import { createClient } from "@supabase/supabase-js";

import { applyThemeToConfig, getPresetByKey, getPresetForSubcategory, themeForSlugOrName } from "@/lib/demo-themes";
import { type DesignSettings } from "@/types/design";

export async function prefetchWidgetDemoInstance(
  instanceId: string,
  type: string,
  slug: string
): Promise<{
  instance: any;
  designConfig: DesignSettings;
  rawInstanceConfig: DesignSettings;
  initialThemeKey: string | null;
} | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey || !serviceKey) return null;

  const supabase = createClient(supabaseUrl, supabaseKey, {
    db: { schema: "public" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const cleanedSlug = String(slug || "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  const { data: instance, error: instanceError } = await supabase
    .from("instances")
    .select("*")
    .eq("id", instanceId)
    .single();

  if (instanceError || !instance) return null;

  const isDemoEnabled = !!((instance.config && (instance.config as any).demo_enabled === true) || (instance as any).demo_instance === true);
  const demoType = ((instance as any).demo_instance_type as string) || type || "industry";

  let selectedSubcategory: any | null = null;
  let selectedProspect: any | null = null;
  let demoTemplateConfig: any | null = null;

  if (demoType === "industry") {
    const { data: initialSubcategoryMatches, error: subcatError } = await supabaseAdmin
      .from("categories_subcategories")
      .select("id, slug, subcategory, demo_template_config")
      .eq("slug", cleanedSlug)
      .limit(1);
    let subcategoryMatches = initialSubcategoryMatches;

    if ((!subcategoryMatches || subcategoryMatches.length === 0) && !subcatError && cleanedSlug) {
      const { data: altMatches } = await supabaseAdmin
        .from("categories_subcategories")
        .select("id, slug, subcategory, demo_template_config")
        .ilike("subcategory", `%${cleanedSlug.replace(/-/g, " ")}%`)
        .limit(1);
      if (altMatches && altMatches.length > 0) {
        subcategoryMatches = altMatches;
      }
    }

    if (!subcatError) {
      selectedSubcategory = (subcategoryMatches && subcategoryMatches[0]) || null;
    }

    demoTemplateConfig = selectedSubcategory?.demo_template_config || null;
  } else {
    const { data: prospect, error: pErr } = await supabaseAdmin
      .from("prospects")
      .select("id, slug, company_name, logo_url, demo_theme_key, demo_template_config")
      .eq("slug", cleanedSlug)
      .maybeSingle();
    if (!pErr) selectedProspect = prospect;
    demoTemplateConfig = selectedProspect?.demo_template_config || null;
  }

  let mergedConfig: any = {
    ...(instance.config || {}),
  };

  if (isDemoEnabled) {
    const subcatName = selectedSubcategory?.subcategory || null;
    const prospectName = selectedProspect?.company_name || null;
    const brandName =
      (demoTemplateConfig && (demoTemplateConfig as any).brand_name) || prospectName || subcatName || (instance as any).name || "Demo";
    const titleText = (demoTemplateConfig && (demoTemplateConfig as any).title_text) || subcatName || prospectName || "Demo";
    (mergedConfig as any).header_enabled = true;
    (mergedConfig as any).brand_name_enabled = true;
    (mergedConfig as any).title_enabled = true;
    (mergedConfig as any).brand_name = brandName;
    (mergedConfig as any).title_text = titleText;
    (mergedConfig as any).demo_enabled = true;
  }

  let initialThemeKey: string | null = null;
  if (isDemoEnabled) {
    initialThemeKey =
      demoTemplateConfig && (demoTemplateConfig as any).theme_key
        ? String((demoTemplateConfig as any).theme_key).toLowerCase()
        : selectedProspect?.demo_theme_key
          ? String(selectedProspect.demo_theme_key).toLowerCase()
          : null;

    const preset = initialThemeKey
      ? getPresetByKey(initialThemeKey)
      : getPresetForSubcategory(selectedSubcategory?.subcategory || selectedProspect?.company_name || cleanedSlug);

    mergedConfig = { ...preset, ...mergedConfig };
    const theme = themeForSlugOrName(selectedSubcategory?.subcategory || selectedProspect?.company_name || cleanedSlug);
    mergedConfig = applyThemeToConfig(theme, mergedConfig);

    const subcatName = selectedSubcategory?.subcategory || null;
    const prospectName = selectedProspect?.company_name || null;
    const brandName =
      (demoTemplateConfig && (demoTemplateConfig as any).brand_name) || prospectName || subcatName || (instance as any).name || "Demo";
    const titleText = (demoTemplateConfig && (demoTemplateConfig as any).title_text) || subcatName || prospectName || "Demo";
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
    },
  } as any;

  const rawInstanceConfig: DesignSettings = (mergedConfig || {}) as any;
  const designConfig: DesignSettings = (rawInstanceConfig || {}) as any;

  return { instance: demoInstance, designConfig, rawInstanceConfig, initialThemeKey };
}
