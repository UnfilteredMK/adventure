import { defaultDesignSettings, type DesignSettings, hexToRgba } from "@/types/design";
import { coerceDesignBoolean } from "@/lib/coerce-design-boolean";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const hexToRgb = (hex: string) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || "").trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
};

const rgbToHex = (r: number, g: number, b: number) => {
  const toHex = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const isHex = (c: string) => /^#([a-f\d]{3}|[a-f\d]{6})$/i.test((c || "").trim());

const normalizeHex = (c: string, fallback: string) => {
  const s = (c || "").trim();
  if (!isHex(s)) return fallback;
  const raw = s.toLowerCase();
  // Expand 3-digit hex (#fff) -> 6-digit hex (#ffffff)
  if (raw.length === 4) {
    const h = raw.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  return raw;
};

const lighten = (hex: string, amount = 0.2) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
};

const darken = (hex: string, amount = 0.15) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
};

const relativeLuminance = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  const srgb = [r, g, b].map((v) => v / 255);
  const lin = srgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

const textOn = (hex: string) => (relativeLuminance(hex) < 0.5 ? "#ffffff" : "#0f172a");

const hoverFor = (primary: string) => {
  const lum = relativeLuminance(primary);
  // If the primary is dark, hover should lift slightly; if light, hover should deepen.
  return lum < 0.2 ? lighten(primary, 0.12) : darken(primary, 0.12);
};

const THEME_PRESETS: Record<string, { primary: string; secondary: string; background: string }> = {
  "sunset-orange": { primary: "#ea580c", secondary: "#c2410c", background: "#fff7ed" },
  "royal-purple": { primary: "#7c3aed", secondary: "#6d28d9", background: "#faf5ff" },
  "emerald-green": { primary: "#059669", secondary: "#047857", background: "#f0fdf4" },
};

/**
 * Takes a minimal/partial config and fills in the rest with branded, nice-looking defaults.
 * Caller-supplied values always win; this only fills the gaps.
 * When brand_name is missing from config, uses instanceDisplayName if provided (e.g. instance.name).
 */
export function withWidgetDesignDefaults(
  input?: DesignSettings | null,
  instanceDisplayName?: string | null
): DesignSettings {
  const raw = (input || {}) as DesignSettings;
  const r = raw as Record<string, unknown>;
  const headerIn = raw.header_enabled ?? r.headerEnabled;
  const logoIn = raw.logo_enabled ?? r.logoEnabled;
  const brandEnabledIn = raw.brand_name_enabled ?? r.brandNameEnabled;

  const hasBrandName = raw.brand_name != null && String(raw.brand_name).trim() !== "";
  const instanceName = instanceDisplayName != null ? String(instanceDisplayName).trim() : "";
  const fillBrandFromInstance = coerceDesignBoolean(brandEnabledIn, true);
  const enrichedRaw = {
    ...(raw as any),
    ...(!hasBrandName && instanceName && fillBrandFromInstance ? { brand_name: instanceName } : {}),
  } as DesignSettings;

  const themeKey = String((raw as any)?.color_theme || "").trim().toLowerCase();
  const preset = themeKey ? THEME_PRESETS[themeKey] : undefined;

  // If `color_theme` is set, use it as a fallback for missing colors.
  // NOTE: widget configs are not always normalized to snake_case.
  // Accept common camelCase / legacy keys and promote them into the snake_case schema
  // so the form renderer (which reads `primary_color`/`secondary_color`) stays on-brand.
  const primaryCandidate =
    raw.primary_color ||
    (raw as any).primaryColor ||
    (raw as any).accent_color ||
    (raw as any).accentColor ||
    raw.submit_button_background_color ||
    (raw as any).submitButtonBackgroundColor ||
    "";
  const secondaryCandidate =
    raw.secondary_color ||
    (raw as any).secondaryColor ||
    raw.submit_button_hover_background_color ||
    (raw as any).submitButtonHoverBackgroundColor ||
    "";
  const backgroundCandidate =
    raw.background_color ||
    (raw as any).backgroundColor ||
    "";

  const primary = normalizeHex(primaryCandidate, preset?.primary || "#111827");
  const secondary = normalizeHex(secondaryCandidate, preset?.secondary || "#ffffff");
  const background = normalizeHex(backgroundCandidate, preset?.background || "#ffffff");

  const fontFamily = (raw.font_family || "Inter").trim() || "Inter";
  const baseFontSize = typeof raw.base_font_size === "number" ? raw.base_font_size : 16;

  const bgLum = relativeLuminance(background);
  const surfaceSolid = bgLum > 0.92 ? "#ffffff" : secondary;
  const surfaceSoft = bgLum > 0.92 ? "#ffffff" : hexToRgba("#ffffff", 0.76);
  const border = bgLum > 0.92 ? hexToRgba("#000000", 0.1) : hexToRgba(primary, 0.18);

  const text = bgLum < 0.2 ? "#ffffff" : "#0f172a";
  const mutedText = bgLum < 0.2 ? hexToRgba("#ffffff", 0.76) : "#475569";

  const radius = typeof raw.border_radius === "number" ? raw.border_radius : 14;
  const promptRadius = typeof raw.prompt_border_radius === "number" ? raw.prompt_border_radius : radius;

  const derived: DesignSettings = {
    // Brand primitives
    primary_color: primary,
    secondary_color: secondary,
    background_color: background,
    background_opacity: raw.background_opacity ?? 1,
    font_family: fontFamily,
    base_font_size: baseFontSize,

    // Container
    border_radius: radius,
    shadow_style: raw.shadow_style ?? "subtle",
    container_padding: raw.container_padding ?? 16,
    container_padding_top: raw.container_padding_top ?? 16,
    container_padding_right: raw.container_padding_right ?? 16,
    container_padding_bottom: raw.container_padding_bottom ?? 16,
    container_padding_left: raw.container_padding_left ?? 16,

    // Header / branding
    header_enabled: coerceDesignBoolean(headerIn, true),
    header_alignment: raw.header_alignment ?? "center",
    brand_name_enabled: coerceDesignBoolean(brandEnabledIn, true),
    brand_name_color: raw.brand_name_color ?? text,
    brand_name_font_family: raw.brand_name_font_family ?? fontFamily,
    brand_name_font_size: raw.brand_name_font_size ?? 22,
    logo_enabled: coerceDesignBoolean(logoIn, false),
    logo_height: raw.logo_height ?? 40,
    sticky_header: raw.sticky_header ?? false,

    // Layout defaults
    mobile_layout_mode: raw.mobile_layout_mode ?? "prompt-top",
    ui_scale: raw.ui_scale ?? 1.0,
    prompt_gallery_spacing: raw.prompt_gallery_spacing ?? 16,
    prompt_section_height: raw.prompt_section_height ?? 26,
    prompt_section_width:
      raw.prompt_section_width ??
      ((raw.layout_mode === "left-right" || raw.layout_mode === "right-left") ? 24 : 64),

    // Prompt section visuals
    prompt_background_color: raw.prompt_background_color ?? (bgLum > 0.92 ? surfaceSolid : surfaceSoft),
    prompt_border_style: raw.prompt_border_style ?? "solid",
    prompt_border_width: raw.prompt_border_width ?? 1,
    prompt_border_color: raw.prompt_border_color ?? border,
    prompt_border_radius: raw.prompt_border_radius ?? promptRadius,
    prompt_text_color: raw.prompt_text_color ?? text,
    prompt_font_family: raw.prompt_font_family ?? fontFamily,
    prompt_font_size: raw.prompt_font_size ?? baseFontSize,
    prompt_placeholder_color: raw.prompt_placeholder_color ?? mutedText,

    // Prompt input visuals
    prompt_input_background_color: raw.prompt_input_background_color ?? surfaceSolid,
    prompt_input_border_style: raw.prompt_input_border_style ?? "solid",
    prompt_input_border_width: raw.prompt_input_border_width ?? 1,
    prompt_input_border_color: raw.prompt_input_border_color ?? border,
    prompt_input_border_radius: raw.prompt_input_border_radius ?? 12,
    prompt_input_text_color: raw.prompt_input_text_color ?? text,
    prompt_input_placeholder_color: raw.prompt_input_placeholder_color ?? mutedText,

    // Uploader visuals
    uploader_background_color: raw.uploader_background_color ?? (bgLum > 0.92 ? surfaceSolid : surfaceSoft),
    uploader_border_style: raw.uploader_border_style ?? "dashed",
    uploader_border_width: raw.uploader_border_width ?? 1,
    uploader_border_color: raw.uploader_border_color ?? border,
    uploader_border_radius: raw.uploader_border_radius ?? 12,
    uploader_text_color: raw.uploader_text_color ?? mutedText,
    uploader_font_family: raw.uploader_font_family ?? fontFamily,
    uploader_font_size: raw.uploader_font_size ?? 14,

    // Suggestions visuals
    suggestion_background_color: raw.suggestion_background_color ?? surfaceSolid,
    suggestion_text_color: raw.suggestion_text_color ?? text,
    suggestion_border_style: raw.suggestion_border_style ?? "solid",
    suggestion_border_width: raw.suggestion_border_width ?? 1,
    suggestion_border_color: raw.suggestion_border_color ?? border,
    suggestion_border_radius: raw.suggestion_border_radius ?? 9999,
    suggestion_font_family: raw.suggestion_font_family ?? fontFamily,
    suggestion_font_size: raw.suggestion_font_size ?? 12,
    suggestion_shadow_style: raw.suggestion_shadow_style ?? "subtle",
    suggestion_arrow_icon: raw.suggestion_arrow_icon ?? true,

    // Buttons
    submit_button_background_color:
      raw.submit_button_background_color ?? (raw as any).submitButtonBackgroundColor ?? primary,
    submit_button_hover_background_color:
      raw.submit_button_hover_background_color ?? (raw as any).submitButtonHoverBackgroundColor ?? hoverFor(primary),
    submit_button_text_color: raw.submit_button_text_color ?? (raw as any).submitButtonTextColor ?? textOn(primary),
    submit_button_border_radius: raw.submit_button_border_radius ?? 12,

    // Gallery
    gallery_background_color: raw.gallery_background_color ?? "transparent",
    gallery_spacing: raw.gallery_spacing ?? 14,
    gallery_font_family: raw.gallery_font_family ?? fontFamily,
    gallery_font_size: raw.gallery_font_size ?? 14,
    gallery_shadow_style: raw.gallery_shadow_style ?? "subtle",
    gallery_show_placeholder_images: raw.gallery_show_placeholder_images ?? false,
    gallery_container_border_enabled: raw.gallery_container_border_enabled ?? true,
    gallery_container_border_width: raw.gallery_container_border_width ?? 1,
    gallery_container_border_style: raw.gallery_container_border_style ?? "solid",
    gallery_container_border_color: raw.gallery_container_border_color ?? border,
    gallery_container_border_radius: raw.gallery_container_border_radius ?? radius,
    gallery_image_border_enabled: raw.gallery_image_border_enabled ?? false,
    gallery_image_border_width: raw.gallery_image_border_width ?? 1,
    gallery_image_border_style: raw.gallery_image_border_style ?? "solid",
    gallery_image_border_color: raw.gallery_image_border_color ?? border,
    gallery_image_border_radius: raw.gallery_image_border_radius ?? 12,

    // Overlay defaults (even if the old overlay is disabled, used by newer UI elements)
    overlay_background_color: raw.overlay_background_color ?? hexToRgba(primary, 0.55),
    overlay_icon_color: raw.overlay_icon_color ?? textOn(primary),
    overlay_font_family: raw.overlay_font_family ?? fontFamily,
    overlay_font_size: raw.overlay_font_size ?? 13,
  };

  const merged = {
    ...(defaultDesignSettings as any),
    ...(derived as any),
    ...(enrichedRaw as any),
  } as DesignSettings;

  return {
    ...merged,
    header_enabled: coerceDesignBoolean(merged.header_enabled, true),
    brand_name_enabled: coerceDesignBoolean(merged.brand_name_enabled, true),
    logo_enabled: coerceDesignBoolean(merged.logo_enabled, false),
  } as DesignSettings;
}
