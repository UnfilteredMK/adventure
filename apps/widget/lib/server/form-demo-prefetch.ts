import { createClient } from "@supabase/supabase-js";

import { applyThemeToConfig, getPresetByKey, themeForSlugOrName } from "@/lib/demo-themes";
import { defaultDesignSettings, type DesignSettings } from "@/types/design";

function extractFormDesignConfig(instance: any): DesignSettings {
  return (
    instance?.designSettings ||
    instance?.designConfig ||
    instance?.design_settings ||
    instance?.config?.designSettings ||
    instance?.config?.design ||
    instance?.design ||
    defaultDesignSettings
  );
}

export async function prefetchFormDemoInstance(
  instanceId: string,
  type: string,
  slug: string,
): Promise<{
  instance: any;
  designConfig: DesignSettings;
  initialThemeKey: string | null;
} | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) return null;

  const supabase = createClient(supabaseUrl, supabaseKey, {
    db: { schema: "public" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const supabaseAdmin = serviceKey
    ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;

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

  const demoType = ((instance as any).demo_instance_type as string) || type || "industry";

  let selectedSubcategory: any | null = null;
  let selectedProspect: any | null = null;
  let demoTemplateConfig: any | null = null;

	  if (supabaseAdmin) {
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
  }

  const initialThemeKey =
    demoTemplateConfig && typeof (demoTemplateConfig as any).theme_key === "string" && (demoTemplateConfig as any).theme_key.trim()
      ? String((demoTemplateConfig as any).theme_key).toLowerCase()
      : selectedProspect?.demo_theme_key
        ? String(selectedProspect.demo_theme_key).toLowerCase()
        : null;

  const demoInstance = {
    ...instance,
    active_demo: {
      type,
      slug: cleanedSlug,
      subcategory: selectedSubcategory || null,
      prospect: selectedProspect || null,
    },
  } as any;

  const rawDesignConfig = extractFormDesignConfig(demoInstance);
  let designConfig: DesignSettings = {
    ...defaultDesignSettings,
    ...(rawDesignConfig as any),
  } as any;

	  // Apply a demo theme immediately so the loading screen reflects the demo styling.
	  if (initialThemeKey) {
	    const preset = getPresetByKey(initialThemeKey);
	    const safePreset: any = { ...(preset as any) };
	    delete safePreset.logo_url;
	    delete safePreset.brand_name;
	    delete safePreset.title_text;
	    designConfig = { ...(designConfig as any), ...(safePreset as any) } as any;
	  } else {
	    const inferred = themeForSlugOrName(selectedSubcategory?.subcategory || selectedProspect?.company_name || cleanedSlug);
	    designConfig = applyThemeToConfig(inferred as any, designConfig as any) as any;
	  }
  (designConfig as any).demo_enabled = true;

  return { instance: demoInstance, designConfig, initialThemeKey };
}
