export const DESIGN_CONFIG_KEY_ORDER_V2 = [
  "color_theme",
  "primary_color",
  "secondary_color",
  "background_color",
  "font_family",
  "base_font_size",

  "header_enabled",
  "header_alignment",
  "brand_name_enabled",
  "brand_name",
  "logo_enabled",
  "logo_url",
  "logo_height",

  "layout_mode",

  "uploader_enabled",
  "uploader_max_images",
  "uploader_primary_text",
  "uploader_secondary_text",

  "suggestions_enabled",
  "suggestions_count",

  "gallery_columns",
  "gallery_max_images",
  "gallery_show_placeholder_images",
  "gallery_show_prompts",

  "demo_enabled",
  "demo_upload_message",
  "demo_generation_message",
  "demo_loop_count",
  "demo_click_to_dismiss",

  "lead_capture_enabled",
  "lead_capture_trigger",
  "lead_step1_title",
  "lead_step1_placeholder",
  "lead_step2_title",
  "lead_step2_name_placeholder",
  "lead_step2_phone_placeholder",

  // AI form toggle status (mirrors flow_config.enabled)
  "form_status_enabled",
  // Visual Pricing Journey rollout + pricing-gate experiment.
  "visual_pricing_journey_version",
  "pricing_gate_strategy",
  "pricing_gate_experiment_percent",
  "pricing_gate_experiment_key",
  // AI form UI toggles (stored in config; used by /adventure form UI)
  "form_show_progress_bar",
  "form_show_step_descriptions",
  // Full AI form configuration (formerly `instances.flow_config`, now stored in `instances.config`).
  "form_config",

  "iframe_width",
  "iframe_height",
  "iframe_loading",
  "iframe_sandbox",
  "iframe_referrerpolicy",
  "iframe_allowtransparency",
  "iframe_scrolling",

  "modal_width",
  "modal_height",
  "modal_max_width",
  "modal_max_height",
  "modal_backdrop_color",
  "modal_backdrop_opacity",
  "modal_background_color",
  "modal_border_radius",
  "modal_show_close_button",
  "modal_close_button_color",
  "modal_close_button_hover_color",
  "modal_close_on_backdrop",
  "modal_close_on_escape",
  "modal_animation_type",
  "modal_animation_duration",
  "modal_position",

  "full_width_layout",
  "sticky_header",
  "show_page_title",
  "show_breadcrumbs",
  "show_back_button",
  "content_max_width",
] as const;

export function orderObjectKeys<T extends Record<string, unknown>>(
  obj: T,
  keyOrder: readonly string[]
): T {
  const ordered: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const key of keyOrder) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      ordered[key] = obj[key];
      seen.add(key);
    }
  }

  const remainingKeys = Object.keys(obj)
    .filter((key) => !seen.has(key))
    .sort((a, b) => a.localeCompare(b));

  for (const key of remainingKeys) {
    ordered[key] = obj[key];
  }

  return ordered as T;
}

export function orderDesignConfigForSupabase<T extends Record<string, unknown>>(config: T): T {
  return orderObjectKeys(config, DESIGN_CONFIG_KEY_ORDER_V2);
}
