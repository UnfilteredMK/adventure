export type DemoTheme = {
  name: string;
  primary: string;
  accents?: {
    border?: string;
    hover?: string;
  };
  overrides?: Record<string, any>;
};

export const DEMO_THEMES: Record<string, DemoTheme> = {
  green: { name: 'Green', primary: '#16a34a' },
  charcoal: { 
    name: 'Charcoal', 
    primary: '#111827', // darker charcoal
    overrides: {
      // Black-like, but slightly lighter charcoal surfaces
      background_color: '#0b0b0b',
      sidebar_background_color: '#0c0c0c',
      prompt_background_color: '#0d0d0d',
      uploader_background_color: '#0d0d0d',
      overlay_background_color: 'rgba(0,0,0,0.6)',
      title_color: '#ffffff',
      brand_name_color: '#ffffff',
      prompt_text_color: '#f3f4f6',
      prompt_input_text_color: '#ffffff',
      suggestion_text_color: '#e5e7eb',
      iframe_border_color: '#262626',
      prompt_border_color: '#262626',
      prompt_input_border_color: '#262626',
      gallery_image_border_color: '#262626',
      suggestion_border_color: '#262626',
      logo_border_color: '#262626',
      gallery_container_border_color: '#262626'
    }
  },
  pink: { name: 'Pink', primary: '#ec4899' },
  amber: { name: 'Amber', primary: '#f59e0b' },
  cyan: { name: 'Cyan', primary: '#06b6d4' },
  orange: { name: 'Orange', primary: '#ea580c' },
  slate: { 
    name: 'Slate', 
    primary: '#0f172a', // darker slate
    overrides: {
      // Black-like, but with a slate tint and slightly lighter surfaces
      background_color: '#0c1220',
      sidebar_background_color: '#0d1424',
      prompt_background_color: '#0e1526',
      uploader_background_color: '#0e1526',
      overlay_background_color: 'rgba(15,23,42,0.65)',
      title_color: '#ffffff',
      brand_name_color: '#ffffff',
      prompt_text_color: '#e2e8f0',
      prompt_input_text_color: '#ffffff',
      suggestion_text_color: '#cbd5e1',
      iframe_border_color: '#334155',
      prompt_border_color: '#334155',
      prompt_input_border_color: '#334155',
      gallery_image_border_color: '#334155',
      suggestion_border_color: '#334155',
      logo_border_color: '#334155',
      gallery_container_border_color: '#334155'
    }
  },
  violet: { name: 'Violet', primary: '#8b5cf6' },
  teal: { name: 'Teal', primary: '#0891b2' },
  neutral: { name: 'Neutral', primary: '#111827' },
};

export function themeForSlugOrName(subcategory: string | null | undefined): DemoTheme {
  const key = (subcategory || '').toLowerCase();
  const map: Array<{ match: string[]; theme: keyof typeof DEMO_THEMES }> = [
    { match: ['landscaping','landscape','lawn','garden','tree','irrigation','sprinkler'], theme: 'green' },
    { match: ['pave','paving','driveway','asphalt','concrete'], theme: 'charcoal' },
    { match: ['makeup','cosmetic','lashes','lash'], theme: 'pink' },
    { match: ['hair','barber','styling','color'], theme: 'amber' },
    { match: ['nail','manicure','pedicure'], theme: 'pink' },
    { match: ['tattoo'], theme: 'neutral' },
    { match: ['pool','spa','hot tub'], theme: 'cyan' },
    { match: ['solar'], theme: 'amber' },
    { match: ['roof','roofing'], theme: 'slate' },
    { match: ['siding','window','windows','door','garage'], theme: 'cyan' },
    { match: ['paint','painting','wallpaper'], theme: 'amber' },
    { match: ['floor','flooring','tile','hardwood','carpet'], theme: 'violet' },
    { match: ['kitchen','cabinet','countertop'], theme: 'orange' },
    { match: ['plumb','plumbing','pipe','drain'], theme: 'teal' },
    { match: ['electric','electrical','wiring','lighting','light'], theme: 'green' },
    { match: ['security','camera','cctv'], theme: 'cyan' },
    { match: ['deck','patio','pergola','gazebo'], theme: 'amber' },
    { match: ['clean','cleaning','maid'], theme: 'cyan' },
    { match: ['junk','haul','removal','moving','mover'], theme: 'pink' },
    { match: ['dental','orthodont'], theme: 'cyan' },
    { match: ['furniture','sofa'], theme: 'violet' },
  ];
  for (const row of map) {
    if (row.match.some(m => key.includes(m))) return DEMO_THEMES[row.theme];
  }
  return DEMO_THEMES.neutral;
}

// Shared helpers for building presets
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const hexToRgb = (hex: string) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#000000');
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
};
const rgbToHex = (r: number, g: number, b: number) => {
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(clamp(Math.round(r),0,255))}${toHex(clamp(Math.round(g),0,255))}${toHex(clamp(Math.round(b),0,255))}`;
};
const lighten = (hex: string, amount = 0.2) => {
  const { r, g, b } = hexToRgb(hex);
  const nr = r + (255 - r) * amount;
  const ng = g + (255 - g) * amount;
  const nb = b + (255 - b) * amount;
  return rgbToHex(nr, ng, nb);
};
const darken = (hex: string, amount = 0.15) => {
  const { r, g, b } = hexToRgb(hex);
  const nr = r * (1 - amount);
  const ng = g * (1 - amount);
  const nb = b * (1 - amount);
  return rgbToHex(nr, ng, nb);
};
const toRgba = (hex: string, alpha = 0.5) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
};

function buildPreset(primary: string, base: Partial<Record<string, any>> = {}): Record<string, any> {
  const hover = darken(primary, 0.2);
  const border = lighten(primary, 0.35);
  const panelBg = lighten(primary, 0.94);
  const subtleBg = lighten(primary, 0.96);
  const overlayBg = toRgba(primary, 0.6);
  const subtleText = '#374151';
  const strongText = '#111827';

  return {
    cta_text: "Get started by uploading a reference image or entering a prompt",
    logo_url: "",
    cta_color: primary,
    brand_name: "SIF - Demo",
    title_text: "Create Amazing AI Images",
    cta_enabled: false,
    font_family: "Inter",
    layout_mode: "prompt-bottom",
    logo_height: 48,
    title_color: strongText,
    demo_enabled: true,
    iframe_width: "500px",
    logo_enabled: true,
    shadow_style: "medium",
    border_radius: 12,
    cta_font_size: 16,
    iframe_border: true,
    iframe_height: "600px",
    iframe_shadow: "medium",
    primary_color: primary,
    prompt_margin: 0,
    title_enabled: false,
    base_font_size: 16,
    header_enabled: true,
    iframe_loading: "lazy",
    iframe_sandbox: "allow-scripts allow-same-origin allow-forms",
    prompt_padding: 16,
    cta_font_family: "Inter",
    demo_loop_count: 3,
    gallery_columns: 2,
    gallery_spacing: 16,
    overlay_enabled: true,
    secondary_color: "#ffffff",
    title_font_size: 20,
    background_color: panelBg,
    background_image: "",
    brand_name_color: "#1f2937",
    header_alignment: "center",
    iframe_scrolling: "auto",
    lead_step1_title: "Where should we send your AI-generated photos?",
    lead_step2_title: "One last thing! We'll send your photos right away...",
    prompt_font_size: 16,
    uploader_enabled: true,
    container_padding: 24,
    gallery_font_size: 14,
    logo_border_color: border,
    logo_border_width: 0,
    mobile_font_scale: 0.9,
    overlay_font_size: 14,
    prompt_text_color: subtleText,
    suggestions_count: 3,
    title_font_family: "Inter",
    background_opacity: 1,
    brand_name_enabled: true,
    gallery_max_images: 8,
    logo_border_radius: 8,
    mobile_layout_mode: "prompt-bottom",
    overlay_icon_color: "#ffffff",
    prompt_font_family: "Inter",
    uploader_font_size: 14,
    background_gradient: "",
    demo_upload_message: "Upload your reference images to guide the AI",
    gallery_font_family: "Inter",
    iframe_border_color: border,
    iframe_border_width: 1,
    overlay_font_family: "Inter",
    prompt_border_color: border,
    prompt_border_style: "solid",
    prompt_border_width: 1,
    suggestions_enabled: true,
    uploader_icon_style: "folder",
    uploader_max_images: 1,
    uploader_text_color: "#475569",
    brand_name_font_size: 28,
    gallery_shadow_style: "medium",
    gallery_show_prompts: true,
    iframe_border_radius: 12,
    lead_capture_enabled: true,
    lead_capture_trigger: "submit",
    lead_modal_font_size: 14,
    prompt_border_radius: 12,
    prompt_section_width: 28,
    suggestion_font_size: 12,
    uploader_font_family: "Inter",
    container_padding_top: 24,
    demo_click_to_dismiss: false,
    gallery_border_radius: 12,
    iframe_referrerpolicy: "no-referrer-when-downgrade",
    lead_modal_text_color: "#000000",
    prompt_section_height: 30,
    suggestion_arrow_icon: true,
    suggestion_text_color: subtleText,
    uploader_border_color: border,
    uploader_border_style: "dashed",
    uploader_border_width: 2,
    uploader_primary_text: "Add reference images to guide the AI generation",
    brand_name_font_family: "Inter",
    container_padding_left: 24,
    gallery_section_height: 70,
    lead_modal_font_family: "Inter",
    lead_step1_placeholder: "Enter your email",
    mobile_gallery_columns: 1,
    prompt_gallery_spacing: 24,
    prompt_input_font_size: 16,
    suggestion_font_family: "Inter",
    uploader_border_radius: 12,
    container_padding_right: 24,
    demo_generation_message: "Your AI-generated images will appear here",
    prompt_background_color: subtleBg,
    prompt_input_text_color: strongText,
    suggestion_border_color: border,
    suggestion_border_style: "solid",
    suggestion_border_width: 1,
    suggestion_shadow_style: "subtle",
    uploader_secondary_text: "Drag & drop or click to upload",
    container_padding_bottom: 24,
    gallery_background_color: "transparent",
    iframe_allowtransparency: true,
    lead_modal_border_radius: 12,
    overlay_background_color: overlayBg,
    overlay_download_enabled: true,
    prompt_input_font_family: "Inter",
    prompt_placeholder_color: "#64748b",
    prompt_section_alignment: "center",
    sidebar_background_color: subtleBg,
    submit_button_text_color: "#ffffff",
    suggestion_border_radius: 8,
    overlay_reference_enabled: true,
    prompt_input_border_color: border,
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    uploader_background_color: subtleBg,
    gallery_image_border_color: border,
    gallery_image_border_style: "solid",
    gallery_image_border_width: 1,
    prompt_input_border_radius: 8,
    prompt_overflow_protection: true,
    gallery_image_border_radius: 8,
    lead_modal_background_color: "#ffffff",
    lead_step2_name_placeholder: "What's your name?",
    submit_button_border_radius: 8,
    suggestion_background_color: "#ffffff",
    gallery_image_border_enabled: false,
    lead_step2_phone_placeholder: "Enter your phone number",
    prompt_input_background_color: "#f8fafc",
    gallery_container_border_color: border,
    gallery_container_border_style: "solid",
    gallery_container_border_width: 1,
    prompt_input_placeholder_color: "#9ca3af",
    submit_button_background_color: primary,
    gallery_container_border_radius: 12,
    gallery_container_border_enabled: false,
    submit_button_hover_background_color: hover,
    ...base
  };
}

export const DEMO_THEME_PRESETS: Record<string, Record<string, any>> = {
  green: buildPreset('#16a34a', { layout_mode: 'prompt-bottom', mobile_layout_mode: 'prompt-bottom' }),
  charcoal: {
    ...buildPreset('#111827', { layout_mode: 'prompt-bottom', mobile_layout_mode: 'prompt-bottom' }),
    // Dark, slightly lighter than pure black surfaces
    primary_color: '#111827',
    cta_color: '#111827',
    submit_button_background_color: '#111827',
    submit_button_hover_background_color: '#1b1b1b',
    submit_button_text_color: '#ffffff',
    background_color: '#0b0b0b',
    sidebar_background_color: '#0c0c0c',
    prompt_background_color: '#0d0d0d',
    uploader_background_color: '#0d0d0d',
    overlay_background_color: 'rgba(0,0,0,0.6)',
    title_color: '#ffffff',
    brand_name_color: '#ffffff',
    prompt_text_color: '#f3f4f6',
    prompt_input_text_color: '#ffffff',
    suggestion_text_color: '#e5e7eb',
    iframe_border_color: '#262626',
    prompt_border_color: '#262626',
    prompt_input_border_color: '#262626',
    gallery_image_border_color: '#262626',
    suggestion_border_color: '#262626',
    logo_border_color: '#262626',
    gallery_container_border_color: '#262626'
  },
  pink: buildPreset('#ec4899'),
  amber: buildPreset('#f59e0b'),
  cyan: buildPreset('#06b6d4'),
  orange: buildPreset('#ea580c'),
  slate: {
    ...buildPreset('#0f172a', { layout_mode: 'prompt-bottom', mobile_layout_mode: 'prompt-bottom' }),
    // Dark slate-tinted surfaces, lighter than pure black
    primary_color: '#0f172a',
    cta_color: '#0f172a',
    submit_button_background_color: '#0f172a',
    submit_button_hover_background_color: '#1b1f2e',
    submit_button_text_color: '#ffffff',
    background_color: '#0c1220',
    sidebar_background_color: '#0d1424',
    prompt_background_color: '#0e1526',
    uploader_background_color: '#0e1526',
    overlay_background_color: 'rgba(15,23,42,0.65)',
    title_color: '#ffffff',
    brand_name_color: '#ffffff',
    prompt_text_color: '#e2e8f0',
    prompt_input_text_color: '#ffffff',
    suggestion_text_color: '#cbd5e1',
    iframe_border_color: '#334155',
    prompt_border_color: '#334155',
    prompt_input_border_color: '#334155',
    gallery_image_border_color: '#334155',
    suggestion_border_color: '#334155',
    logo_border_color: '#334155',
    gallery_container_border_color: '#334155'
  },
  violet: buildPreset('#8b5cf6'),
  teal: buildPreset('#0891b2'),
  neutral: buildPreset('#111827'),
  forest: buildPreset('#065f46'),
  ocean: buildPreset('#0ea5e9'),
  rose: buildPreset('#f43f5e'),
  sand: buildPreset('#d4a373'),
  lemon: buildPreset('#eab308'),
  indigo: buildPreset('#6366f1'),
  // Boilerplate full dark (all black) theme
  black: {
    ...buildPreset('#000000'),
    primary_color: '#000000',
    cta_color: '#000000',
    background_color: '#000000',
    sidebar_background_color: '#000000',
    prompt_background_color: '#000000',
    uploader_background_color: '#000000',
    overlay_background_color: 'rgba(0,0,0,0.7)',
    title_color: '#ffffff',
    brand_name_color: '#ffffff',
    prompt_text_color: '#ffffff',
    prompt_input_text_color: '#ffffff',
    suggestion_text_color: '#ffffff',
    submit_button_background_color: '#000000',
    submit_button_hover_background_color: '#111111',
    submit_button_text_color: '#ffffff',
    iframe_border_color: '#222222',
    prompt_border_color: '#222222',
    prompt_input_border_color: '#222222',
    gallery_image_border_color: '#222222',
    suggestion_border_color: '#222222',
    logo_border_color: '#222222',
    gallery_container_border_color: '#222222'
  },
  // Boilerplate full light (all white) theme
  white: {
    ...buildPreset('#ffffff'),
    primary_color: '#ffffff',
    cta_color: '#ffffff',
    background_color: '#ffffff',
    sidebar_background_color: '#ffffff',
    prompt_background_color: '#ffffff',
    uploader_background_color: '#ffffff',
    overlay_background_color: 'rgba(255,255,255,0.6)',
    title_color: '#111827',
    brand_name_color: '#111827',
    prompt_text_color: '#111827',
    prompt_input_text_color: '#111827',
    suggestion_text_color: '#111827',
    submit_button_background_color: '#ffffff',
    submit_button_hover_background_color: '#f3f4f6',
    submit_button_text_color: '#111827',
    iframe_border_color: '#e5e7eb',
    prompt_border_color: '#e5e7eb',
    prompt_input_border_color: '#e5e7eb',
    gallery_image_border_color: '#e5e7eb',
    suggestion_border_color: '#e5e7eb',
    logo_border_color: '#e5e7eb',
    gallery_container_border_color: '#e5e7eb'
  }
};

export function getPresetForSubcategory(subcategory: string | null | undefined): Record<string, any> {
  const theme = themeForSlugOrName(subcategory);
  return DEMO_THEME_PRESETS[theme.name.toLowerCase()] || DEMO_THEME_PRESETS.neutral;
}

export function getPresetByKey(key: string | null | undefined): Record<string, any> {
  const k = String(key || '').toLowerCase();
  return DEMO_THEME_PRESETS[k] || DEMO_THEME_PRESETS.neutral;
}

export function buildProspectDemoConfig(themeKey: string | null | undefined, overrides?: Record<string, any>): Record<string, any> {
  const preset = getPresetByKey(themeKey);
  return { ...preset, ...(overrides || {}) };
}

export function applyThemeToConfig(theme: DemoTheme, config: Record<string, any>): Record<string, any> {
  // Backwards-compatible: layer theme accents onto an existing config
  // Only apply theme colors if they're not already explicitly set in the config
  const primary = theme.primary;
  const hover = theme.accents?.hover || darken(primary, 0.2);
  const border = theme.accents?.border || lighten(primary, 0.35);
  const panelBg = lighten(primary, 0.94);
  const subtleBg = lighten(primary, 0.96);
  const overlayBg = toRgba(primary, 0.6);
  const subtleText = '#374151';
  const strongText = '#111827';

  // Build theme defaults, but only for fields not already in config
  const themeDefaults: Record<string, any> = {};
  
  // Only apply if not already set
  if (!config.primary_color) themeDefaults.primary_color = primary;
  if (!config.cta_color) themeDefaults.cta_color = primary;
  if (!config.submit_button_background_color) themeDefaults.submit_button_background_color = primary;
  if (!config.submit_button_hover_background_color) themeDefaults.submit_button_hover_background_color = hover;
  if (!config.submit_button_text_color) themeDefaults.submit_button_text_color = '#ffffff';
  if (!config.iframe_border_color) themeDefaults.iframe_border_color = border;
  if (!config.prompt_border_color) themeDefaults.prompt_border_color = border;
  if (!config.prompt_input_border_color) themeDefaults.prompt_input_border_color = border;
  if (!config.gallery_image_border_color) themeDefaults.gallery_image_border_color = border;
  if (!config.suggestion_border_color) themeDefaults.suggestion_border_color = border;
  if (!config.logo_border_color) themeDefaults.logo_border_color = border;
  if (!config.gallery_container_border_color) themeDefaults.gallery_container_border_color = border;
  if (!config.background_color) themeDefaults.background_color = panelBg;
  if (!config.sidebar_background_color) themeDefaults.sidebar_background_color = subtleBg;
  if (!config.prompt_background_color) themeDefaults.prompt_background_color = subtleBg;
  if (!config.uploader_background_color) themeDefaults.uploader_background_color = subtleBg;
  if (!config.title_color) themeDefaults.title_color = strongText;
  if (!config.brand_name_color) themeDefaults.brand_name_color = '#1f2937';
  if (!config.prompt_text_color) themeDefaults.prompt_text_color = subtleText;
  if (!config.prompt_input_text_color) themeDefaults.prompt_input_text_color = strongText;
  if (!config.prompt_placeholder_color) themeDefaults.prompt_placeholder_color = '#64748b';
  if (!config.suggestion_text_color) themeDefaults.suggestion_text_color = subtleText;
  if (!config.overlay_background_color) themeDefaults.overlay_background_color = overlayBg;

  return {
    ...themeDefaults,
    ...config,
    // Allow theme-level overrides (used for charcoal/slate to behave like black)
    ...(theme.overrides || {})
  };
}

