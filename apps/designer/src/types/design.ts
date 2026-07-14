// Streamlined Design Types - Minimal and Essential Only
export type LayoutMode = "left-right" | "right-left" | "prompt-top" | "prompt-bottom" | "mobile-optimized";
export type BorderStyle = "solid" | "dashed" | "dotted" | "none";
export type ShadowStyle = "none" | "subtle" | "medium" | "large" | "glow";
export type TextAlign = "left" | "center" | "right";
export type PromptAlignment = "left" | "center" | "right";

// Core Design Interface - Much Simpler and Focused
export interface DesignSettings {
  // ===========================================
  // OVERALL STYLE SETTINGS
  // ===========================================
  background_color?: string;
  background_opacity?: number; // 0-1 for background transparency
  background_gradient?: string;
  background_image?: string;
  container_padding?: number; // Legacy: applies to all sides when individual padding not specified
  container_padding_top?: number; // Individual padding controls
  container_padding_right?: number;
  container_padding_bottom?: number;
  container_padding_left?: number;
  border_radius?: number;
  shadow_style?: ShadowStyle;
  sidebar_background_color?: string; // Background color for the designer sidebar
  
  // ===========================================
  // PREVIEW SETTINGS
  // ===========================================
  max_width?: number; // Maximum width for preview container
  max_height?: number; // Maximum height for preview container
  scale_factor?: number; // Scale factor for preview content
  
  // ===========================================
  // LAYOUT CONFIGURATION
  // ===========================================
  layout_mode?: LayoutMode;
  prompt_section_width?: number; // Percentage for left-right layout
  prompt_section_height?: number; // Percentage for top-bottom layout
  prompt_gallery_spacing?: number; // Spacing between prompt and gallery sections
  gallery_section_height?: number; // Percentage for gallery section height
  
  // ===========================================
  // PROMPT SECTION
  // ===========================================
  prompt_background_color?: string;
  prompt_border_style?: BorderStyle;
  prompt_border_color?: string;
  prompt_border_width?: number;
  prompt_border_radius?: number;
  prompt_text_color?: string;
  prompt_font_family?: string;
  prompt_font_size?: number;
  prompt_placeholder_color?: string;
  prompt_section_alignment?: PromptAlignment; // Controls horizontal alignment in top/bottom layouts
  // Prompt container spacing and behavior
  prompt_padding?: number;
  prompt_margin?: number;
  prompt_overflow_protection?: boolean;
  submit_button_background_color?: string;
  submit_button_text_color?: string;
  submit_button_hover_background_color?: string;
  // Submit button extras
  submit_button_border_radius?: number;
  
  // ===========================================
  // PROMPT INPUT FIELD (the actual textarea/input)
  // ===========================================
  prompt_input_background_color?: string;
  prompt_input_border_style?: BorderStyle;
  prompt_input_border_color?: string;
  prompt_input_border_width?: number;
  prompt_input_border_radius?: number;
  prompt_input_text_color?: string;
  prompt_input_font_family?: string;
  prompt_input_font_size?: number;
  prompt_input_placeholder_color?: string;
  
  // ===========================================
  // HEADER SECTION
  // ===========================================
  header_enabled?: boolean;
  header_alignment?: TextAlign; // left, center, right
  
  // Logo Settings
  logo_enabled?: boolean;
  logo_url?: string;
  logo_height?: number;
  logo_border_width?: number;
  logo_border_color?: string;
  logo_border_radius?: number;
  
  // Brand Name Settings
  brand_name?: string;
  brand_name_enabled?: boolean;
  brand_name_color?: string;
  brand_name_font_family?: string;
  brand_name_font_size?: number;
  
  // ===========================================
  // TITLE/CTA SECTION
  // ===========================================
  title_enabled?: boolean;
  title_text?: string;
  title_color?: string;
  title_font_family?: string;
  title_font_size?: number;
  cta_text?: string;
  cta_enabled?: boolean;
  cta_font_family?: string;
  cta_font_size?: number;
  cta_color?: string;
  
  // ===========================================
  // IFRAME SETTINGS (when layout_mode is 'iframe')
  // ===========================================
  iframe_width?: string; // e.g., "100%", "800px"
  iframe_height?: string; // e.g., "600px", "100vh"
  iframe_border?: boolean;
  iframe_border_width?: number;
  iframe_border_color?: string;
  iframe_border_radius?: number;
  iframe_shadow?: ShadowStyle;
  iframe_loading?: "lazy" | "eager";
  iframe_sandbox?: string; // e.g., "allow-scripts allow-same-origin allow-forms"
  iframe_referrerpolicy?: string;
  iframe_allowtransparency?: boolean;
  iframe_scrolling?: "auto" | "yes" | "no";
  
  // ===========================================
  // IMAGE UPLOADER SECTION
  // ===========================================
  uploader_enabled?: boolean;
  uploader_max_images?: number; // Maximum number of reference images (1-6)
  uploader_background_color?: string;
  uploader_border_style?: BorderStyle;
  uploader_border_color?: string;
  uploader_border_width?: number;
  uploader_border_radius?: number;
  uploader_text_color?: string;
  uploader_font_family?: string;
  uploader_font_size?: number;
  uploader_icon_style?: string; // For upload folder/icon design
  uploader_primary_text?: string; // Main upload text (e.g., "Add reference images to guide the AI generation")
  uploader_secondary_text?: string; // Secondary text (e.g., "Drag & drop or click to upload")
  
  // Suggestion Buttons
  suggestions_enabled?: boolean;
  suggestions_count?: number;
  suggestion_background_color?: string;
  suggestion_text_color?: string;
  suggestion_border_style?: BorderStyle;
  suggestion_border_color?: string;
  suggestion_border_width?: number;
  suggestion_border_radius?: number;
  suggestion_font_family?: string;
  suggestion_font_size?: number;
  suggestion_shadow_style?: ShadowStyle;
  suggestion_arrow_icon?: boolean;
  
  // ===========================================
  // IMAGE GALLERY SECTION
  // ===========================================
  gallery_background_color?: string;
  gallery_border_radius?: number;
  gallery_spacing?: number;
  gallery_columns?: number;
  gallery_max_images?: number;
  gallery_shadow_style?: ShadowStyle;
  gallery_font_family?: string;
  gallery_font_size?: number;

  // Gallery Container Border
  gallery_container_border_enabled?: boolean;
  gallery_container_border_width?: number;
  gallery_container_border_color?: string;
  gallery_container_border_style?: BorderStyle;
  gallery_container_border_radius?: number;

  // Individual Image Border
  gallery_image_border_enabled?: boolean;
  gallery_image_border_width?: number;
  gallery_image_border_color?: string;
  gallery_image_border_style?: BorderStyle;
  gallery_image_border_radius?: number;
  
  // Gallery Overlay Settings
  overlay_enabled?: boolean;
  overlay_download_enabled?: boolean;
  overlay_reference_enabled?: boolean;
  overlay_background_color?: string;
  overlay_icon_color?: string;
  overlay_font_family?: string;
  overlay_font_size?: number;
  gallery_show_prompts?: boolean; // Whether to show prompts on gallery images
  gallery_show_placeholder_images?: boolean; // Whether to show preloaded/sample images in the gallery
  
  // ===========================================
  // RESPONSIVE SETTINGS
  // ===========================================
  mobile_layout_mode?: LayoutMode;
  mobile_gallery_columns?: number;
  mobile_font_scale?: number;

  // ===========================================
  // DEMO OVERLAY SETTINGS
  // ===========================================
  demo_enabled?: boolean;
  demo_upload_message?: string;
  demo_generation_message?: string;
  demo_loop_count?: number; // Number of times to loop the demo (1-10)
  demo_click_to_dismiss?: boolean; // Whether clicking anywhere dismisses the demo

  // ===========================================
  // LEAD CAPTURE SETTINGS
  // ===========================================
  // When to show the lead capture modal
  lead_capture_trigger?: 'immediate' | 'submit' | 'halfway' | 'on_download';
  lead_capture_enabled?: boolean;
  lead_step1_title?: string;
  lead_step1_placeholder?: string;
  lead_step2_title?: string;
  lead_step2_name_placeholder?: string;
  lead_step2_phone_placeholder?: string;

  // AI Form (Flow) status flag. Mirrors `instances.flow_config.enabled`.
  form_status_enabled?: boolean;

  // Visual Pricing Journey V1 rollout and pricing-gate experiment.
  visual_pricing_journey_version?: "legacy" | "v1" | "studio_v1";
  pricing_gate_strategy?: "blurred" | "coarse_visible" | "experiment";
  pricing_gate_experiment_percent?: number;
  pricing_gate_experiment_key?: string;

  lead_modal_background_color?: string;
  lead_modal_text_color?: string;
  lead_modal_border_radius?: number;
  lead_modal_font_family?: string;
  lead_modal_font_size?: number;

  // Branding
  primary_color?: string;
  secondary_color?: string;
  font_family?: string;
  base_font_size?: number;

  // Modal settings
  modal_backdrop_color?: string;
  modal_backdrop_opacity?: number;
  modal_width?: string;
  modal_height?: string;
  modal_max_width?: number;
  modal_max_height?: number;
  modal_border_radius?: number;
  modal_background_color?: string;
  modal_show_close_button?: boolean;
  modal_close_button_color?: string;
  modal_close_button_hover_color?: string;
  modal_close_on_backdrop?: boolean;
  modal_close_on_escape?: boolean;
  modal_animation_type?: 'fade' | 'slide-up' | 'slide-down' | 'scale';
  modal_animation_duration?: number;
  modal_position?: 'center' | 'top' | 'bottom';

  // Standalone settings
  full_width_layout?: boolean;
  sticky_header?: boolean;
  show_page_title?: boolean;
  show_breadcrumbs?: boolean;
  show_back_button?: boolean;
  page_background_color?: string;
  content_max_width?: number;
}

// Default settings - much cleaner
export const defaultDesignSettings: DesignSettings = {
  background_color: "#ffffff",
  background_gradient: "",
  background_image: "",
  background_opacity: 1,
  base_font_size: 16,
  border_radius: 12,
  brand_name: "AI Studio",
  brand_name_color: "#1f2937",
  brand_name_enabled: true,
  brand_name_font_family: "Inter",
  brand_name_font_size: 24,
  container_padding: 16,
  container_padding_bottom: 16,
  container_padding_left: 16,
  container_padding_right: 16,
  container_padding_top: 16,
  // Prompt container spacing & behavior defaults
  prompt_padding: 16,
  prompt_margin: 0,
  prompt_overflow_protection: true,
  cta_color: "#374151",
  cta_enabled: false,
  cta_font_family: "Inter",
  cta_font_size: 16,
  cta_text: "Get started by uploading a reference image or entering a prompt",
  demo_click_to_dismiss: false,
  demo_enabled: true,
  demo_generation_message: "Your AI-generated images will appear here",
  demo_loop_count: 3,
  demo_upload_message: "Upload your reference images to guide the AI",
  font_family: "Inter",
  gallery_background_color: "transparent",
  gallery_columns: 2,
  gallery_max_images: 4,
  gallery_container_border_color: "#e5e7eb",
  gallery_container_border_enabled: false,
  gallery_container_border_radius: 12,
  gallery_container_border_style: "solid",
  gallery_container_border_width: 1,
  gallery_font_family: "Inter",
  gallery_font_size: 14,
  gallery_image_border_color: "#e5e7eb",
  gallery_image_border_enabled: false,
  gallery_image_border_radius: 8,
  gallery_image_border_style: "solid",
  gallery_image_border_width: 1,
  gallery_shadow_style: "subtle",
  gallery_spacing: 12,
  header_alignment: "center",
  header_enabled: true,
  iframe_allowtransparency: true,
  iframe_border: true,
  iframe_border_color: "#e5e7eb",
  iframe_border_radius: 12,
  iframe_border_width: 1,
  iframe_height: "760px",
  iframe_loading: "lazy",
  iframe_referrerpolicy: "no-referrer-when-downgrade",
  iframe_sandbox: "allow-scripts allow-same-origin allow-forms",
  iframe_scrolling: "auto",
  iframe_shadow: "medium",
  iframe_width: "100%",
  layout_mode: "prompt-bottom",
  lead_capture_enabled: false,
  lead_capture_trigger: 'submit',
  visual_pricing_journey_version: "legacy",
  pricing_gate_strategy: "blurred",
  pricing_gate_experiment_percent: 50,
  lead_modal_background_color: "#ffffff",
  lead_modal_border_radius: 12,
  lead_modal_text_color: "#000000",
  lead_modal_font_family: "Inter",
  lead_modal_font_size: 14,
  lead_step1_placeholder: "Enter your email",
  lead_step1_title: "Where should we send your AI-generated photos?",
  lead_step2_name_placeholder: "What's your name?",
  lead_step2_phone_placeholder: "Enter your phone number",
  lead_step2_title: "One last thing! We'll send your photos right away...",
  logo_border_color: "#e5e7eb",
  logo_border_radius: 4,
  logo_border_width: 0,
  logo_enabled: false,
  logo_height: 48,
  logo_url: "",
  mobile_font_scale: 0.9,
  mobile_gallery_columns: 1,
  mobile_layout_mode: "prompt-top",
  overlay_background_color: "rgba(0, 0, 0, 0.5)",
  overlay_download_enabled: true,
  overlay_enabled: true,
  overlay_font_family: "Inter",
  overlay_font_size: 14,
  overlay_icon_color: "#ffffff",
  overlay_reference_enabled: true,
  gallery_show_prompts: true,
  gallery_show_placeholder_images: true,
  primary_color: "#000000",
  prompt_background_color: "transparent",
  prompt_border_color: "#e5e7eb",
  prompt_border_radius: 12,
  prompt_border_style: "none",
  prompt_border_width: 0,
  prompt_font_family: "Inter",
  prompt_font_size: 15,
  prompt_input_background_color: "transparent",
  prompt_input_border_color: "#e5e7eb",
  prompt_input_border_radius: 12,
  prompt_input_border_style: "solid",
  prompt_input_border_width: 1,
  prompt_input_font_family: "Inter",
  prompt_input_font_size: 15,
  prompt_input_placeholder_color: "#9ca3af",
  prompt_input_text_color: "#374151",
  prompt_placeholder_color: "#9ca3af",
  prompt_section_alignment: "center",
  prompt_section_height: 30,
  prompt_gallery_spacing: 16,
  gallery_section_height: 70,
  prompt_section_width: 60,
  prompt_text_color: "#374151",
  secondary_color: "#ffffff",
  shadow_style: "subtle",
  sidebar_background_color: "#ffffff",
  submit_button_background_color: "#3b82f6",
  submit_button_hover_background_color: "#2563eb",
  submit_button_text_color: "#ffffff",
  submit_button_border_radius: 8,
  suggestion_arrow_icon: true,
  suggestion_background_color: "#ffffff",
  suggestion_border_color: "#e5e7eb",
  suggestion_border_radius: 8,
  suggestion_border_style: "solid",
  suggestion_border_width: 1,
  suggestion_font_family: "Inter",
  suggestion_font_size: 12,
  suggestion_shadow_style: "subtle",
  suggestion_text_color: "#374151",
  suggestions_count: 3,
  suggestions_enabled: true,
  title_color: "#374151",
  title_enabled: false,
  title_font_family: "Inter",
  title_font_size: 20,
  title_text: "Create Amazing AI Images",
  uploader_background_color: "#f8fafc",
  uploader_border_color: "#cbd5e1",
  uploader_border_radius: 12,
  uploader_border_style: "dashed",
  uploader_border_width: 2,
  uploader_enabled: true,
  uploader_font_family: "Inter",
  uploader_font_size: 14,
  uploader_icon_style: "folder",
  uploader_max_images: 1,
  uploader_primary_text: "Add reference images to guide the AI generation",
  uploader_secondary_text: "Drag & drop or click to upload",
  uploader_text_color: "#64748b",

  // Modal settings
  modal_backdrop_color: "#000000",
  modal_backdrop_opacity: 0.5,
  modal_width: "80%",
  modal_height: "80%",
  modal_max_width: 600,
  modal_max_height: 800,
  modal_border_radius: 12,
  modal_background_color: "#ffffff",
  modal_show_close_button: true,
  modal_close_button_color: "#6b7280",
  modal_close_button_hover_color: "#374151",
  modal_close_on_backdrop: true,
  modal_close_on_escape: true,
  modal_animation_type: "fade",
  modal_animation_duration: 300,
  modal_position: "center",

  // Standalone settings
  full_width_layout: false,
  sticky_header: false,
  show_page_title: true,
  show_breadcrumbs: false,
  show_back_button: false,
  page_background_color: "#ffffff",
  content_max_width: 1200
};

// Theme Presets - Comprehensive Design Themes
export interface DesignTheme {
  name: string;
  description?: string;
  
  // ===========================================
  // OVERALL STYLE SETTINGS
  // ===========================================
  background_color?: string;
  background_opacity?: number; // 0-1 for background transparency
  background_gradient?: string;
  background_image?: string;
  container_padding?: number; // Legacy: applies to all sides when individual padding not specified
  container_padding_top?: number; // Individual padding controls
  container_padding_right?: number;
  container_padding_bottom?: number;
  container_padding_left?: number;
  border_radius?: number;
  shadow_style?: ShadowStyle;
  sidebar_background_color?: string; // Background color for the designer sidebar
  
  // ===========================================
  // PREVIEW SETTINGS
  // ===========================================
  max_width?: number; // Maximum width for preview container
  max_height?: number; // Maximum height for preview container
  scale_factor?: number; // Scale factor for preview content
  
  // ===========================================
  // HEADER SECTION
  // ===========================================
  header_enabled?: boolean;
  header_alignment?: TextAlign;
  
  // Logo Settings
  logo_enabled?: boolean;
  logo_url?: string;
  logo_height?: number;
  logo_border_width?: number;
  logo_border_color?: string;
  logo_border_radius?: number;
  
  // Brand Name Settings
  brand_name?: string;
  brand_name_enabled?: boolean;
  brand_name_color?: string;
  brand_name_font_family?: string;
  brand_name_font_size?: number;
  
  // ===========================================
  // TITLE/CTA SECTION
  // ===========================================
  title_enabled?: boolean;
  title_text?: string;
  title_color?: string;
  title_font_family?: string;
  title_font_size?: number;
  cta_text?: string;
  cta_enabled?: boolean;
  cta_font_family?: string;
  cta_font_size?: number;
  cta_color?: string;
  
  // ===========================================
  // LAYOUT CONFIGURATION
  // ===========================================
  layout_mode?: LayoutMode;
  prompt_section_width?: number;
  prompt_section_height?: number;
  prompt_gallery_spacing?: number; // Spacing between prompt and gallery sections
  
  // ===========================================
  // IFRAME SETTINGS
  // ===========================================
  iframe_width?: string;
  iframe_height?: string;
  iframe_border?: boolean;
  iframe_border_width?: number;
  iframe_border_color?: string;
  iframe_border_radius?: number;
  iframe_shadow?: ShadowStyle;
  iframe_loading?: "lazy" | "eager";
  iframe_sandbox?: string;
  iframe_referrerpolicy?: string;
  iframe_allowtransparency?: boolean;
  iframe_scrolling?: "auto" | "yes" | "no";
  
  // ===========================================
  // IMAGE UPLOADER SECTION
  // ===========================================
  uploader_enabled?: boolean;
  uploader_max_images?: number;
  uploader_background_color?: string;
  uploader_border_style?: BorderStyle;
  uploader_border_color?: string;
  uploader_border_width?: number;
  uploader_border_radius?: number;
  uploader_text_color?: string;
  uploader_font_family?: string;
  uploader_font_size?: number;
  uploader_icon_style?: string;
  uploader_primary_text?: string;
  uploader_secondary_text?: string;
  
  // ===========================================
  // PROMPT SECTION
  // ===========================================
  prompt_background_color?: string;
  prompt_border_style?: BorderStyle;
  prompt_border_color?: string;
  prompt_border_width?: number;
  prompt_border_radius?: number;
  prompt_text_color?: string;
  prompt_font_family?: string;
  prompt_font_size?: number;
  prompt_placeholder_color?: string;
  prompt_section_alignment?: PromptAlignment; // Controls horizontal alignment in top/bottom layouts
  // Prompt container spacing and behavior
  prompt_padding?: number;
  prompt_margin?: number;
  prompt_overflow_protection?: boolean;
  submit_button_background_color?: string;
  submit_button_text_color?: string;
  submit_button_hover_background_color?: string;
  // Submit button extras
  submit_button_border_radius?: number;
  
  // ===========================================
  // PROMPT INPUT FIELD (the actual textarea/input)
  // ===========================================
  prompt_input_background_color?: string;
  prompt_input_border_style?: BorderStyle;
  prompt_input_border_color?: string;
  prompt_input_border_width?: number;
  prompt_input_border_radius?: number;
  prompt_input_text_color?: string;
  prompt_input_font_family?: string;
  prompt_input_font_size?: number;
  prompt_input_placeholder_color?: string;
  
  // Suggestion Buttons
  suggestions_enabled?: boolean;
  suggestions_count?: number;
  suggestion_background_color?: string;
  suggestion_text_color?: string;
  suggestion_border_style?: BorderStyle;
  suggestion_border_color?: string;
  suggestion_border_width?: number;
  suggestion_border_radius?: number;
  suggestion_font_family?: string;
  suggestion_font_size?: number;
  suggestion_shadow_style?: ShadowStyle;
  suggestion_arrow_icon?: boolean;
  
  // ===========================================
  // IMAGE GALLERY SECTION
  // ===========================================
  gallery_background_color?: string;
  gallery_border_radius?: number;
  gallery_spacing?: number;
  gallery_columns?: number;
  gallery_max_images?: number;
  gallery_shadow_style?: ShadowStyle;
  gallery_font_family?: string;
  gallery_font_size?: number;
  
  // Gallery Container Border
  gallery_container_border_enabled?: boolean;
  gallery_container_border_width?: number;
  gallery_container_border_color?: string;
  gallery_container_border_style?: BorderStyle;
  gallery_container_border_radius?: number;

  // Individual Image Border
  gallery_image_border_enabled?: boolean;
  gallery_image_border_width?: number;
  gallery_image_border_color?: string;
  gallery_image_border_style?: BorderStyle;
  gallery_image_border_radius?: number;
  
  // Gallery Overlay Settings
  overlay_enabled?: boolean;
  overlay_download_enabled?: boolean;
  overlay_reference_enabled?: boolean;
  overlay_background_color?: string;
  overlay_icon_color?: string;
  overlay_font_family?: string;
  overlay_font_size?: number;
  
  // ===========================================
  // RESPONSIVE SETTINGS
  // ===========================================
  mobile_layout_mode?: LayoutMode;
  mobile_gallery_columns?: number;
  mobile_font_scale?: number;

  // ===========================================
  // DEMO OVERLAY SETTINGS
  // ===========================================
  demo_enabled?: boolean;
  demo_upload_message?: string;
  demo_generation_message?: string;
  demo_loop_count?: number; // Number of times to loop the demo (1-10)

  // Legacy/Compatibility - keeping accent_color for easy theming
  accent_color?: string;

  // ===========================================
  // LEAD CAPTURE SETTINGS
  // ===========================================
  lead_capture_enabled?: boolean;
  lead_step1_title?: string;
  lead_step1_placeholder?: string;
  lead_step2_name_placeholder?: string;
  lead_step2_phone_placeholder?: string;
  lead_modal_background_color?: string;
  lead_modal_text_color?: string;
  lead_modal_border_radius?: number;
  lead_modal_font_family?: string;
  lead_modal_font_size?: number;

  // Branding
  primary_color?: string;
  secondary_color?: string;
  font_family?: string;
  base_font_size?: number;

  // ===========================================
  // IMPLEMENTATION-SPECIFIC SETTINGS
  // ===========================================
  
  // E-commerce specific
  show_product_prices?: boolean;
  show_add_to_cart?: boolean;
  show_product_variants?: boolean;
  enable_cart_notifications?: boolean;
  show_cart_count?: boolean;
  
  // Service specific
  show_contact_form?: boolean;
  show_phone_field?: boolean;
  show_email_field?: boolean;
  show_service_pricing?: boolean;
  show_availability_calendar?: boolean;
  
  // Universal (both ecomm and service)
  enable_dynamic_content?: boolean;
  show_type_selector?: boolean;
  
  // Modal specific
  modal_close_on_backdrop?: boolean;
  modal_show_close_button?: boolean;
  modal_close_on_escape?: boolean;
  modal_backdrop_opacity?: number;
  modal_backdrop_color?: string;
  modal_border_radius?: number;
  modal_animation_type?: 'fade' | 'slide-up' | 'slide-down' | 'scale';
  modal_animation_duration?: number;
  
  // Standalone specific
  full_width_layout?: boolean;
  sticky_header?: boolean;
  show_page_title?: boolean;
  show_breadcrumbs?: boolean;
  show_back_button?: boolean;
  page_background_color?: string;
  content_max_width?: number;
  
  // Modal specific additional
  modal_max_width?: number;
  modal_max_height?: number;
  modal_position?: 'center' | 'top' | 'bottom';
  modal_width?: string;
  modal_height?: string;
  modal_background_color?: string;
  modal_close_button_color?: string;
  modal_close_button_hover_color?: string;
}

// Helper function to get complete theme with defaults
export const getCompleteTheme = (theme: DesignTheme): DesignSettings => ({
  // Overall Style
  background_color: theme.background_color ?? "#ffffff",
  background_opacity: theme.background_opacity ?? 1,
  background_gradient: theme.background_gradient ?? "",
  background_image: theme.background_image ?? "",
  container_padding: theme.container_padding ?? 24,
  container_padding_top: theme.container_padding_top ?? theme.container_padding ?? 24,
  container_padding_right: theme.container_padding_right ?? theme.container_padding ?? 24,
  container_padding_bottom: theme.container_padding_bottom ?? theme.container_padding ?? 24,
  container_padding_left: theme.container_padding_left ?? theme.container_padding ?? 24,
  border_radius: theme.border_radius ?? 12,
  shadow_style: theme.shadow_style ?? "medium",
  sidebar_background_color: theme.sidebar_background_color ?? "#ffffff",
  
  // Layout
  layout_mode: theme.layout_mode ?? "prompt-bottom",
  prompt_section_width: theme.prompt_section_width ?? 40,
  prompt_section_height: theme.prompt_section_height ?? 30,
  
  // Prompt Section
  prompt_background_color: theme.prompt_background_color ?? "transparent",
  prompt_border_style: theme.prompt_border_style ?? "solid",
  prompt_border_color: theme.prompt_border_color ?? "#e5e7eb",
  prompt_border_width: theme.prompt_border_width ?? 1,
  prompt_border_radius: theme.prompt_border_radius ?? 12,
  prompt_text_color: theme.prompt_text_color ?? "#374151",
  prompt_font_family: theme.prompt_font_family ?? "Inter",
  prompt_font_size: theme.prompt_font_size ?? 16,
  prompt_placeholder_color: theme.prompt_placeholder_color ?? "#9ca3af",
  prompt_padding: theme.prompt_padding ?? 16,
  prompt_margin: theme.prompt_margin ?? 0,
  prompt_overflow_protection: theme.prompt_overflow_protection ?? true,
  prompt_section_alignment: theme.prompt_section_alignment ?? "center",
  submit_button_background_color: theme.submit_button_background_color ?? theme.accent_color ?? "#3b82f6",
  submit_button_text_color: theme.submit_button_text_color ?? "#ffffff",
  submit_button_hover_background_color: theme.submit_button_hover_background_color ?? "#2563eb",
  submit_button_border_radius: theme.submit_button_border_radius ?? 8,
  
  // Prompt Input Field
  prompt_input_background_color: theme.prompt_input_background_color ?? "transparent",
  prompt_input_border_style: theme.prompt_input_border_style ?? "solid",
  prompt_input_border_color: theme.prompt_input_border_color ?? "#e5e7eb",
  prompt_input_border_width: theme.prompt_input_border_width ?? 1,
  prompt_input_border_radius: theme.prompt_input_border_radius ?? 8,
  prompt_input_text_color: theme.prompt_input_text_color ?? "#374151",
  prompt_input_font_family: theme.prompt_input_font_family ?? "Inter",
  prompt_input_font_size: theme.prompt_input_font_size ?? 16,
  prompt_input_placeholder_color: theme.prompt_input_placeholder_color ?? "#9ca3af",
  
  // Header
  header_enabled: theme.header_enabled ?? true,
  header_alignment: theme.header_alignment ?? "center",
  
  // Logo Settings
  logo_enabled: theme.logo_enabled ?? false,
  logo_url: theme.logo_url ?? "",
  logo_height: theme.logo_height ?? 48,
  logo_border_width: theme.logo_border_width ?? 0,
  logo_border_color: theme.logo_border_color ?? "#e5e7eb",
  logo_border_radius: theme.logo_border_radius ?? 4,
  
  // Brand Name Settings
  brand_name: theme.brand_name ?? "AI Studio",
  brand_name_enabled: theme.brand_name_enabled ?? true,
  brand_name_color: theme.brand_name_color ?? "#1f2937",
  brand_name_font_family: theme.brand_name_font_family ?? "Inter",
  brand_name_font_size: theme.brand_name_font_size ?? 28,
  
  // Title/CTA Section
  title_enabled: theme.title_enabled ?? false,
  title_text: theme.title_text ?? "Create Amazing AI Images",
  title_color: theme.title_color ?? "#374151",
  title_font_family: theme.title_font_family ?? "Inter",
  title_font_size: theme.title_font_size ?? 20,
  cta_text: theme.cta_text ?? "Get started by uploading a reference image or entering a prompt",
  cta_enabled: theme.cta_enabled ?? false,
  cta_font_family: theme.cta_font_family ?? "Inter",
  cta_font_size: theme.cta_font_size ?? 16,
  cta_color: theme.cta_color ?? "#374151",
  
  // Iframe Settings
  iframe_width: theme.iframe_width ?? "100%",
  iframe_height: theme.iframe_height ?? "760px",
  iframe_border: theme.iframe_border ?? true,
  iframe_border_width: theme.iframe_border_width ?? 1,
  iframe_border_color: theme.iframe_border_color ?? "#e5e7eb",
  iframe_border_radius: theme.iframe_border_radius ?? 12,
  iframe_shadow: theme.iframe_shadow ?? "medium",
  iframe_loading: theme.iframe_loading ?? "lazy",
  iframe_sandbox: theme.iframe_sandbox ?? "allow-scripts allow-same-origin allow-forms",
  iframe_referrerpolicy: theme.iframe_referrerpolicy ?? "no-referrer-when-downgrade",
  iframe_allowtransparency: theme.iframe_allowtransparency ?? true,
  iframe_scrolling: theme.iframe_scrolling ?? "auto",
  
  // Image Uploader Section
  uploader_enabled: theme.uploader_enabled ?? true,
  uploader_max_images: theme.uploader_max_images ?? 1, // Updated to match gallery_max_images
  uploader_background_color: theme.uploader_background_color ?? "#f8fafc",
  uploader_border_style: theme.uploader_border_style ?? "dashed",
  uploader_border_color: theme.uploader_border_color ?? "#cbd5e1",
  uploader_border_width: theme.uploader_border_width ?? 2,
  uploader_border_radius: theme.uploader_border_radius ?? 12,
  uploader_text_color: theme.uploader_text_color ?? "#64748b",
  uploader_font_family: theme.uploader_font_family ?? "Inter",
  uploader_font_size: theme.uploader_font_size ?? 14,
  uploader_icon_style: theme.uploader_icon_style ?? "folder",
  uploader_primary_text: theme.uploader_primary_text ?? "Add reference images to guide the AI generation",
  uploader_secondary_text: theme.uploader_secondary_text ?? "Drag & drop or click to upload",
  
  // Suggestion Buttons
  suggestions_enabled: theme.suggestions_enabled ?? true,
  suggestions_count: theme.suggestions_count ?? 3,
  suggestion_background_color: theme.suggestion_background_color ?? "#ffffff",
  suggestion_text_color: theme.suggestion_text_color ?? "#374151",
  suggestion_border_style: theme.suggestion_border_style ?? "solid",
  suggestion_border_color: theme.suggestion_border_color ?? "#e5e7eb",
  suggestion_border_width: theme.suggestion_border_width ?? 1,
  suggestion_border_radius: theme.suggestion_border_radius ?? 8,
  suggestion_font_family: theme.suggestion_font_family ?? "Inter",
  suggestion_font_size: theme.suggestion_font_size ?? 12,
  suggestion_shadow_style: theme.suggestion_shadow_style ?? "subtle",
  suggestion_arrow_icon: theme.suggestion_arrow_icon ?? true,
  
  // Image Gallery Section
  gallery_background_color: theme.gallery_background_color ?? "transparent",
  gallery_border_radius: theme.gallery_border_radius ?? 12,
  gallery_spacing: theme.gallery_spacing ?? 16,
  gallery_columns: theme.gallery_columns ?? 2,
  gallery_max_images: theme.gallery_max_images ?? 4, // Consistent value
  gallery_shadow_style: theme.gallery_shadow_style ?? "medium",
  gallery_font_family: theme.gallery_font_family ?? "Inter",
  gallery_font_size: theme.gallery_font_size ?? 14,
  
  // Gallery Container Border
  gallery_container_border_enabled: theme.gallery_container_border_enabled ?? false,
  gallery_container_border_width: theme.gallery_container_border_width ?? 1,
  gallery_container_border_color: theme.gallery_container_border_color ?? "#e5e7eb",
  gallery_container_border_style: theme.gallery_container_border_style ?? "solid",
  gallery_container_border_radius: theme.gallery_container_border_radius ?? 12,

  // Individual Image Border
  gallery_image_border_enabled: theme.gallery_image_border_enabled ?? false,
  gallery_image_border_width: theme.gallery_image_border_width ?? 1,
  gallery_image_border_color: theme.gallery_image_border_color ?? "#e5e7eb",
  gallery_image_border_style: theme.gallery_image_border_style ?? "solid",
  gallery_image_border_radius: theme.gallery_image_border_radius ?? 8,
  
  // Gallery Overlay Settings
  overlay_enabled: theme.overlay_enabled ?? true,
  overlay_download_enabled: theme.overlay_download_enabled ?? true,
  overlay_reference_enabled: theme.overlay_reference_enabled ?? true,
  overlay_background_color: theme.overlay_background_color ?? "rgba(0, 0, 0, 0.5)",
  overlay_icon_color: theme.overlay_icon_color ?? "#ffffff",
  overlay_font_family: theme.overlay_font_family ?? "Inter",
  overlay_font_size: theme.overlay_font_size ?? 14,
  
  // Responsive Settings
  mobile_layout_mode: theme.mobile_layout_mode ?? "prompt-top",
  mobile_gallery_columns: theme.mobile_gallery_columns ?? 1,
  mobile_font_scale: theme.mobile_font_scale ?? 0.9,
  
  // Demo Overlay
  demo_enabled: theme.demo_enabled ?? true,
  demo_upload_message: theme.demo_upload_message ?? "Upload your reference images to guide the AI",
  demo_generation_message: theme.demo_generation_message ?? "Your AI-generated images will appear here",
  demo_loop_count: theme.demo_loop_count ?? 3,

  // Lead Capture Settings
  lead_capture_enabled: theme.lead_capture_enabled ?? false,
  lead_capture_trigger: (theme as any).lead_capture_trigger ?? 'submit',
  lead_step1_title: theme.lead_step1_title ?? "Where should we send your AI-generated photos?",
  lead_step1_placeholder: theme.lead_step1_placeholder ?? "Enter your email",
  lead_step2_name_placeholder: theme.lead_step2_name_placeholder ?? "What's your name?",
  lead_step2_phone_placeholder: theme.lead_step2_phone_placeholder ?? "Enter your phone number",
  lead_modal_background_color: theme.lead_modal_background_color ?? "#ffffff",
  lead_modal_text_color: theme.lead_modal_text_color ?? "#000000",
  lead_modal_border_radius: theme.lead_modal_border_radius ?? 12,
  lead_modal_font_family: theme.lead_modal_font_family ?? "Inter",
  lead_modal_font_size: theme.lead_modal_font_size ?? 14,

  // Branding
  primary_color: theme.primary_color ?? "#000000",
  secondary_color: theme.secondary_color ?? "#ffffff",
  font_family: theme.font_family ?? "Inter",
  base_font_size: theme.base_font_size ?? 16,
});

export const designThemes: DesignTheme[] = [
  {
    name: "Modern Light",
    description: "Cool blue-gray minimal",
    // Overall styling
    background_color: "#ffffff",
    background_opacity: 1,
    background_gradient: "",
    background_image: "",
    accent_color: "#3b82f6",
    container_padding: 24,
    border_radius: 12,
    shadow_style: "medium",
    sidebar_background_color: "#ffffff",
    
    // Preview settings
    max_width: 1200,
    max_height: 800,
    scale_factor: 1,
    
    // Layout configuration
    layout_mode: "prompt-top",
    prompt_section_width: 40,
    prompt_section_height: 30,
    prompt_gallery_spacing: 24,
    
    // Prompt section
    prompt_background_color: "#f9fafb",
    prompt_text_color: "#1e293b",
    prompt_border_color: "#e5e7eb",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 12,
    prompt_placeholder_color: "#64748b",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#3b82f6",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#2563eb",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#1e293b",
    prompt_input_border_color: "#e5e7eb",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 8,
    prompt_input_placeholder_color: "#64748b",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    // Suggestions
    suggestions_enabled: true,
    suggestions_count: 3,
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#374151",
    suggestion_border_color: "#e5e7eb",
    suggestion_border_style: "solid",
    suggestion_border_width: 1,
    suggestion_border_radius: 8,
    suggestion_font_family: "Inter",
    suggestion_font_size: 12,
    suggestion_shadow_style: "subtle",
    suggestion_arrow_icon: true,
    
    // Uploader
    uploader_enabled: true,
    uploader_max_images: 1, // Updated to match gallery_max_images
    uploader_background_color: "#f8fafc",
    uploader_border_color: "#cbd5e1",
    uploader_text_color: "#64748b",
    uploader_border_style: "dashed",
    uploader_border_width: 2,
    uploader_border_radius: 12,
    uploader_font_family: "Inter",
    uploader_font_size: 14,
    uploader_icon_style: "folder",
    uploader_primary_text: "Add reference images to guide the AI generation",
    uploader_secondary_text: "Drag & drop or click to upload",
    
    // Gallery
    gallery_background_color: "transparent",
    gallery_border_radius: 12,
    gallery_spacing: 16,
    gallery_columns: 2,
    gallery_max_images: 4, // Consistent value
    gallery_shadow_style: "medium",
    gallery_font_family: "Inter",
    gallery_font_size: 14,
    
    // Gallery Container Border
    gallery_container_border_enabled: false,
    gallery_container_border_width: 1,
    gallery_container_border_color: "#e5e7eb",
    gallery_container_border_style: "solid",
    gallery_container_border_radius: 12,
    
    // Individual Image Border
    gallery_image_border_enabled: false,
    gallery_image_border_width: 1,
    gallery_image_border_color: "#e5e7eb",
    gallery_image_border_style: "solid",
    gallery_image_border_radius: 8,
    
    // Gallery Overlay
    overlay_enabled: true,
    overlay_download_enabled: true,
    overlay_reference_enabled: true,
    overlay_background_color: "rgba(0, 0, 0, 0.5)",
    overlay_icon_color: "#ffffff",
    overlay_font_family: "Inter",
    overlay_font_size: 14,
    
    // Responsive
    mobile_layout_mode: "prompt-top",
    mobile_gallery_columns: 1,
    mobile_font_scale: 0.9,
    
    // Demo Overlay
    demo_enabled: true,
    demo_upload_message: "Upload your reference images to guide the AI",
    demo_generation_message: "Your AI-generated images will appear here",
    demo_loop_count: 3
  },
  {
    name: "Soft Pearl",
    description: "Warm beige elegance",
    
    // Overall styling
    background_color: "#fdfaf6",
    background_opacity: 1,
    background_gradient: "",
    background_image: "",
    accent_color: "#d4a373",
    container_padding: 32,
    border_radius: 16,
    shadow_style: "subtle",
    sidebar_background_color: "#fdfaf6",
    
    // Preview settings
    max_width: 1200,
    max_height: 800,
    scale_factor: 1,
    
    // Header
    header_enabled: true,
    header_alignment: "center",
    brand_name_color: "#292524",
    brand_name_font_family: "Inter",
    brand_name_font_size: 32,
    
    // Logo settings
    logo_enabled: false,
    logo_url: "",
    logo_height: 48,
    logo_border_width: 0,
    logo_border_color: "#e7e5e4",
    logo_border_radius: 4,
    
    // Title/CTA
    title_enabled: false,
    title_text: "Create Amazing AI Images",
    title_color: "#292524",
    title_font_family: "Inter",
    title_font_size: 20,
    cta_enabled: false,
    cta_text: "Get started by uploading a reference image or entering a prompt",
    cta_color: "#292524",
    cta_font_family: "Inter",
    cta_font_size: 16,
    
    // Layout
    layout_mode: "prompt-top",
    prompt_section_width: 40,
    prompt_section_height: 30,
    prompt_gallery_spacing: 32,
    
    // Prompt styling
    prompt_background_color: "#faf6f1",
    prompt_text_color: "#292524",
    prompt_border_color: "#e7e5e4",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 16,
    prompt_placeholder_color: "#78716c",
    prompt_font_family: "Inter",
    prompt_font_size: 17,
    prompt_section_alignment: "center",
    submit_button_background_color: "#d4a373",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#c4946a",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#292524",
    prompt_input_border_color: "#e7e5e4",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 12,
    prompt_input_placeholder_color: "#78716c",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 17,
    
    // Suggestions
    suggestions_enabled: true,
    suggestions_count: 3,
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#292524",
    suggestion_border_color: "#e7e5e4",
    suggestion_border_style: "solid",
    suggestion_border_width: 1,
    suggestion_border_radius: 12,
    suggestion_font_family: "Inter",
    suggestion_font_size: 12,
    suggestion_shadow_style: "subtle",
    suggestion_arrow_icon: true,
    
    // Uploader
    uploader_enabled: true,
    uploader_max_images: 1, // Updated to match gallery_max_images
    uploader_background_color: "#faf6f1",
    uploader_border_color: "#e7e5e4",
    uploader_text_color: "#78716c",
    uploader_border_style: "dashed",
    uploader_border_width: 2,
    uploader_border_radius: 16,
    uploader_font_family: "Inter",
    uploader_font_size: 14,
    uploader_icon_style: "folder",
    uploader_primary_text: "Add reference images to guide the AI generation",
    uploader_secondary_text: "Drag & drop or click to upload",
    
    // Gallery
    gallery_background_color: "transparent",
    gallery_border_radius: 16,
    gallery_spacing: 20,
    gallery_columns: 2,
    gallery_max_images: 4, // Consistent value
    gallery_shadow_style: "subtle",
    gallery_font_family: "Inter",
    gallery_font_size: 14,
    
    // Gallery Container Border
    gallery_container_border_enabled: false,
    gallery_container_border_width: 1,
    gallery_container_border_color: "#e7e5e4",
    gallery_container_border_style: "solid",
    gallery_container_border_radius: 16,
    
    // Individual Image Border
    gallery_image_border_enabled: false,
    gallery_image_border_width: 1,
    gallery_image_border_color: "#e7e5e4",
    gallery_image_border_style: "solid",
    gallery_image_border_radius: 12,
    
    // Gallery Overlay
    overlay_enabled: true,
    overlay_download_enabled: true,
    overlay_reference_enabled: true,
    overlay_background_color: "rgba(0, 0, 0, 0.5)",
    overlay_icon_color: "#ffffff",
    overlay_font_family: "Inter",
    overlay_font_size: 14,
    
    // Responsive
    mobile_layout_mode: "prompt-top",
    mobile_gallery_columns: 1,
    mobile_font_scale: 0.9,
    
    // Demo Overlay
    demo_enabled: true,
    demo_upload_message: "Upload your reference images to guide the AI",
    demo_generation_message: "Your AI-generated images will appear here",
    demo_loop_count: 3
  },
  {
    name: "Arctic White",
    description: "Clean and minimal white theme",
    
    // Overall styling
    background_color: "#ffffff",
    background_opacity: 1,
    background_gradient: "",
    background_image: "",
    accent_color: "#0f172a",
    container_padding: 24,
    border_radius: 12,
    shadow_style: "medium",
    sidebar_background_color: "#ffffff",
    
    // Prompt section
    prompt_background_color: "#ffffff",
    prompt_text_color: "#0f172a",
    prompt_border_color: "#e2e8f0",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 12,
    prompt_placeholder_color: "#64748b",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#0f172a",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#1e293b",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#0f172a",
    prompt_input_border_color: "#e2e8f0",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 8,
    prompt_input_placeholder_color: "#64748b",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    // Gallery
    gallery_background_color: "transparent",
    gallery_border_radius: 12,
    gallery_spacing: 16,
    gallery_columns: 2, // Updated to be consistent with other themes
    gallery_max_images: 4,
    gallery_shadow_style: "medium",
    gallery_font_family: "Inter",
    gallery_font_size: 14,
    
    // Gallery Container Border
    gallery_container_border_enabled: false,
    gallery_container_border_width: 1,
    gallery_container_border_color: "#e5e7eb",
    gallery_container_border_style: "solid",
    gallery_container_border_radius: 12,
    
    // Individual Image Border
    gallery_image_border_enabled: false,
    gallery_image_border_width: 1,
    gallery_image_border_color: "#e5e7eb",
    gallery_image_border_style: "solid",
    gallery_image_border_radius: 8,
    
    // Gallery Overlay
    overlay_enabled: true,
    overlay_download_enabled: true,
    overlay_reference_enabled: true,
    overlay_background_color: "rgba(0, 0, 0, 0.5)",
    overlay_icon_color: "#ffffff",
    overlay_font_family: "Inter",
    overlay_font_size: 14,
    
    // Responsive
    mobile_layout_mode: "prompt-top",
    mobile_gallery_columns: 1,
    mobile_font_scale: 0.9,
    
    // Demo Overlay
    demo_enabled: true,
    demo_upload_message: "Upload your reference images to guide the AI",
    demo_generation_message: "Your AI-generated images will appear here",
    demo_loop_count: 3
  },
  {
    name: "Forest Green",
    description: "Natural and balanced",
    
    // Overall styling
    background_color: "#f8faf8",
    background_opacity: 1,
    background_gradient: "",
    background_image: "",
    accent_color: "#059669",
    container_padding: 28,
    border_radius: 12,
    shadow_style: "medium",
    sidebar_background_color: "#f8faf8",
    
    // Prompt section
    prompt_background_color: "#f0fdf4",
    prompt_text_color: "#064e3b",
    prompt_border_color: "#d1fae5",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 12,
    prompt_placeholder_color: "#047857",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#059669",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#047857",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#064e3b",
    prompt_input_border_color: "#d1fae5",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 8,
    prompt_input_placeholder_color: "#047857",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    // Suggestions
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#064e3b",
    suggestion_border_color: "#d1fae5",
    
    // Uploader
    uploader_background_color: "#f0fdf4",
    uploader_border_color: "#d1fae5",
    uploader_text_color: "#047857",
    uploader_max_images: 1,
    
    // Gallery
    gallery_background_color: "transparent",
    gallery_border_radius: 12,
    gallery_spacing: 16,
    gallery_columns: 2,
    gallery_max_images: 4,
    gallery_shadow_style: "medium",
    gallery_font_family: "Inter",
    gallery_font_size: 14,
    
    // Gallery Container Border
    gallery_container_border_enabled: false,
    gallery_container_border_width: 1,
    gallery_container_border_color: "#d1fae5",
    gallery_container_border_style: "solid",
    gallery_container_border_radius: 12,
    
    // Individual Image Border
    gallery_image_border_enabled: false,
    gallery_image_border_width: 1,
    gallery_image_border_color: "#d1fae5",
    gallery_image_border_style: "solid",
    gallery_image_border_radius: 8,
    
    // Gallery Overlay
    overlay_enabled: true,
    overlay_download_enabled: true,
    overlay_reference_enabled: true,
    overlay_background_color: "rgba(0, 0, 0, 0.5)",
    overlay_icon_color: "#ffffff",
    overlay_font_family: "Inter",
    overlay_font_size: 14,
    
    // Responsive
    mobile_layout_mode: "prompt-top",
    mobile_gallery_columns: 1,
    mobile_font_scale: 0.9,
    
    // Demo Overlay
    demo_enabled: true,
    demo_upload_message: "Upload your reference images to guide the AI",
    demo_generation_message: "Your AI-generated images will appear here",
    demo_loop_count: 3
  },
  {
    name: "Royal Purple",
    description: "Rich and sophisticated",
    
    // Overall styling
    background_color: "#faf5ff",
    background_opacity: 1,
    background_gradient: "",
    background_image: "",
    accent_color: "#7c3aed",
    container_padding: 32,
    border_radius: 16,
    shadow_style: "large",
    sidebar_background_color: "#faf5ff",
    
    // Prompt section
    prompt_background_color: "#f5f3ff",
    prompt_text_color: "#4c1d95",
    prompt_border_color: "#ddd6fe",
    prompt_placeholder_color: "#6d28d9",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 16,
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#7c3aed",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#6d28d9",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#4c1d95",
    prompt_input_border_color: "#ddd6fe",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 12,
    prompt_input_placeholder_color: "#6d28d9",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    // Suggestions
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#4c1d95",
    suggestion_border_color: "#ddd6fe",
    suggestion_border_style: "solid",
    suggestion_border_width: 1,
    suggestion_border_radius: 12,
    suggestion_font_family: "Inter",
    suggestion_font_size: 12,
    suggestion_shadow_style: "subtle",
    
    // Uploader
    uploader_background_color: "#f5f3ff",
    uploader_border_color: "#ddd6fe",
    uploader_text_color: "#6d28d9",
    uploader_border_style: "dashed",
    uploader_border_width: 2,
    uploader_border_radius: 16,
    uploader_font_family: "Inter",
    uploader_font_size: 14,
    
    // Gallery styling only (no structural settings)
    gallery_background_color: "transparent",
    gallery_border_radius: 16,
    gallery_shadow_style: "large",
    gallery_font_family: "Inter",
    gallery_font_size: 14,
    
    // Gallery Container Border
    gallery_container_border_enabled: false,
    gallery_container_border_width: 1,
    gallery_container_border_color: "#ddd6fe",
    gallery_container_border_style: "solid",
    gallery_container_border_radius: 16,
    
    // Individual Image Border
    gallery_image_border_enabled: false,
    gallery_image_border_width: 1,
    gallery_image_border_color: "#ddd6fe",
    gallery_image_border_style: "solid",
    gallery_image_border_radius: 12,
    
    // Gallery Overlay
    overlay_background_color: "rgba(0, 0, 0, 0.5)",
    overlay_icon_color: "#ffffff",
    overlay_font_family: "Inter",
    overlay_font_size: 14,
    demo_loop_count: 3
  },
  {
    name: "Ocean Blue",
    description: "Deep and calming",
    background_color: "#f0f9ff",
    accent_color: "#0284c7",
    prompt_background_color: "#f0f9ff",
    prompt_text_color: "#0c4a6e",
    prompt_border_color: "#bae6fd",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 12,
    prompt_placeholder_color: "#0369a1",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#0284c7",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#0369a1",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#0c4a6e",
    prompt_input_border_color: "#bae6fd",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 8,
    prompt_input_placeholder_color: "#0369a1",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#0c4a6e",
    suggestion_border_color: "#bae6fd",
    uploader_background_color: "#f0f9ff",
    uploader_border_color: "#bae6fd",
    uploader_text_color: "#0369a1",
    container_padding: 24,
    border_radius: 12,
    shadow_style: "medium",
    demo_loop_count: 3
  },
  {
    name: "Sunset Orange",
    description: "Warm and inviting",
    background_color: "#fff7ed",
    accent_color: "#ea580c",
    prompt_background_color: "#fff7ed",
    prompt_text_color: "#7c2d12",
    prompt_border_color: "#fed7aa",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 14,
    prompt_placeholder_color: "#c2410c",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#ea580c",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#c2410c",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#7c2d12",
    prompt_input_border_color: "#fed7aa",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 10,
    prompt_input_placeholder_color: "#c2410c",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#7c2d12",
    suggestion_border_color: "#fed7aa",
    uploader_background_color: "#fff7ed",
    uploader_border_color: "#fed7aa",
    uploader_text_color: "#c2410c",
    container_padding: 28,
    border_radius: 14,
    shadow_style: "medium",
    demo_loop_count: 3
  },
  {
    name: "Cherry Blossom",
    description: "Delicate and fresh",
    background_color: "#fdf2f8",
    accent_color: "#db2777",
    prompt_background_color: "#fdf2f8",
    prompt_text_color: "#831843",
    prompt_border_color: "#fbcfe8",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 16,
    prompt_placeholder_color: "#be185d",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#db2777",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#be185d",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#831843",
    prompt_input_border_color: "#fbcfe8",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 12,
    prompt_input_placeholder_color: "#be185d",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#831843",
    suggestion_border_color: "#fbcfe8",
    uploader_background_color: "#fdf2f8",
    uploader_border_color: "#fbcfe8",
    uploader_text_color: "#be185d",
    container_padding: 24,
    border_radius: 16,
    shadow_style: "medium",
    demo_loop_count: 3
  },
  {
    name: "Midnight Blue",
    description: "Professional and focused",
    background_color: "#f8fafc",
    accent_color: "#1e40af",
    prompt_background_color: "#f8fafc",
    prompt_text_color: "#1e3a8a",
    prompt_border_color: "#bfdbfe",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 10,
    prompt_placeholder_color: "#1e40af",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#1e40af",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#1e3a8a",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#1e3a8a",
    prompt_input_border_color: "#bfdbfe",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 8,
    prompt_input_placeholder_color: "#1e40af",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#1e3a8a",
    suggestion_border_color: "#bfdbfe",
    uploader_background_color: "#f8fafc",
    uploader_border_color: "#bfdbfe",
    uploader_text_color: "#1e40af",
    container_padding: 24,
    border_radius: 10,
    shadow_style: "medium",
    demo_loop_count: 3
  },
  {
    name: "Golden Sand",
    description: "Warm and luxurious",
    background_color: "#fffbeb",
    accent_color: "#b45309",
    prompt_background_color: "#fffbeb",
    prompt_text_color: "#78350f",
    prompt_border_color: "#fde68a",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 14,
    prompt_placeholder_color: "#92400e",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#b45309",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#92400e",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#78350f",
    prompt_input_border_color: "#fde68a",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 10,
    prompt_input_placeholder_color: "#92400e",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#78350f",
    suggestion_border_color: "#fde68a",
    uploader_background_color: "#fffbeb",
    uploader_border_color: "#fde68a",
    uploader_text_color: "#92400e",
    container_padding: 32,
    border_radius: 14,
    shadow_style: "medium",
    demo_loop_count: 3
  },
  {
    name: "Emerald Green",
    description: "Fresh and vibrant",
    background_color: "#f0fdf4",
    accent_color: "#059669",
    prompt_background_color: "#f0fdf4",
    prompt_text_color: "#064e3b",
    prompt_border_color: "#6ee7b7",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 12,
    prompt_placeholder_color: "#047857",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#059669",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#047857",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#064e3b",
    prompt_input_border_color: "#6ee7b7",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 8,
    prompt_input_placeholder_color: "#047857",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#064e3b",
    suggestion_border_color: "#6ee7b7",
    uploader_background_color: "#f0fdf4",
    uploader_border_color: "#6ee7b7",
    uploader_text_color: "#047857",
    container_padding: 28,
    border_radius: 12,
    shadow_style: "medium",
    demo_loop_count: 3
  },
  {
    name: "Lavender Dream",
    description: "Soft and soothing",
    background_color: "#f5f3ff",
    accent_color: "#7c3aed",
    prompt_background_color: "#f5f3ff",
    prompt_text_color: "#4c1d95",
    prompt_border_color: "#c4b5fd",
    prompt_border_style: "solid",
    prompt_border_width: 1,
    prompt_border_radius: 14,
    prompt_placeholder_color: "#6d28d9",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_section_alignment: "center",
    submit_button_background_color: "#7c3aed",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#6d28d9",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#4c1d95",
    prompt_input_border_color: "#c4b5fd",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 10,
    prompt_input_placeholder_color: "#6d28d9",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#4c1d95",
    suggestion_border_color: "#c4b5fd",
    uploader_background_color: "#f5f3ff",
    uploader_border_color: "#c4b5fd",
    uploader_text_color: "#6d28d9",
    container_padding: 26,
    border_radius: 14,
    shadow_style: "medium",
    demo_loop_count: 3
  }
];

// Curated Google Fonts List - Diverse and Distinctive
export const fontOptions = [
  // Sans-Serif - Clean and Modern
  { value: "Inter", label: "Inter", category: "Sans-Serif", weight: "300,400,500,600,700" },
  { value: "Roboto", label: "Roboto", category: "Sans-Serif", weight: "300,400,500,700" },
  { value: "Poppins", label: "Poppins", category: "Sans-Serif", weight: "300,400,500,600,700" },
  { value: "Montserrat", label: "Montserrat", category: "Sans-Serif", weight: "300,400,500,600,700" },
  { value: "Open Sans", label: "Open Sans", category: "Sans-Serif", weight: "300,400,600,700" },
  { value: "Lato", label: "Lato", category: "Sans-Serif", weight: "300,400,700" },
  { value: "Nunito", label: "Nunito", category: "Sans-Serif", weight: "300,400,600,700" },
  { value: "Work Sans", label: "Work Sans", category: "Sans-Serif", weight: "300,400,500,600,700" },
  { value: "Source Sans Pro", label: "Source Sans Pro", category: "Sans-Serif", weight: "300,400,600,700" },
  { value: "Raleway", label: "Raleway", category: "Sans-Serif", weight: "300,400,500,600,700" },
  
  // Display & Decorative - Unique Character
  { value: "Playfair Display", label: "Playfair Display", category: "Serif", weight: "400,500,600,700" },
  { value: "Oswald", label: "Oswald", category: "Display", weight: "300,400,500,600,700" },
  { value: "Bebas Neue", label: "Bebas Neue", category: "Display", weight: "400" },
  { value: "Dancing Script", label: "Dancing Script", category: "Handwriting", weight: "400,500,600,700" },
  { value: "Pacifico", label: "Pacifico", category: "Handwriting", weight: "400" },
  { value: "Lobster", label: "Lobster", category: "Display", weight: "400" },
  { value: "Righteous", label: "Righteous", category: "Display", weight: "400" },
  { value: "Fredoka One", label: "Fredoka One", category: "Display", weight: "400" },
  { value: "Abril Fatface", label: "Abril Fatface", category: "Display", weight: "400" },
  { value: "Anton", label: "Anton", category: "Display", weight: "400" },
  
  // Serif - Classic and Elegant  
  { value: "Merriweather", label: "Merriweather", category: "Serif", weight: "300,400,700" },
  { value: "Lora", label: "Lora", category: "Serif", weight: "400,500,600,700" },
  { value: "Crimson Text", label: "Crimson Text", category: "Serif", weight: "400,600,700" },
  { value: "EB Garamond", label: "EB Garamond", category: "Serif", weight: "400,500,600,700" },
  { value: "Libre Baskerville", label: "Libre Baskerville", category: "Serif", weight: "400,700" },
  { value: "Old Standard TT", label: "Old Standard TT", category: "Serif", weight: "400,700" },
  { value: "Cormorant Garamond", label: "Cormorant Garamond", category: "Serif", weight: "300,400,500,600,700" },
  
  // Unique & Rounded
  { value: "Comfortaa", label: "Comfortaa", category: "Display", weight: "300,400,500,600,700" },
  { value: "Quicksand", label: "Quicksand", category: "Sans-Serif", weight: "300,400,500,600,700" },
  { value: "Varela Round", label: "Varela Round", category: "Sans-Serif", weight: "400" },
  { value: "Rubik", label: "Rubik", category: "Sans-Serif", weight: "300,400,500,600,700" },
  
  // Monospace - Code Style
  { value: "JetBrains Mono", label: "JetBrains Mono", category: "Monospace", weight: "300,400,500,600,700" },
  { value: "Fira Code", label: "Fira Code", category: "Monospace", weight: "300,400,500,600,700" },
  { value: "Source Code Pro", label: "Source Code Pro", category: "Monospace", weight: "300,400,500,600,700" },
  { value: "Roboto Mono", label: "Roboto Mono", category: "Monospace", weight: "300,400,500,600,700" },
  
  // Creative & Artistic
  { value: "Satisfy", label: "Satisfy", category: "Handwriting", weight: "400" },
  { value: "Great Vibes", label: "Great Vibes", category: "Handwriting", weight: "400" },
  { value: "Amatic SC", label: "Amatic SC", category: "Handwriting", weight: "400,700" },
  { value: "Bangers", label: "Bangers", category: "Display", weight: "400" },
  { value: "Press Start 2P", label: "Press Start 2P", category: "Display", weight: "400" },
  
  // Modern Trending
  { value: "Space Grotesk", label: "Space Grotesk", category: "Sans-Serif", weight: "300,400,500,600,700" },
  { value: "DM Sans", label: "DM Sans", category: "Sans-Serif", weight: "400,500,700" },
  { value: "Plus Jakarta Sans", label: "Plus Jakarta Sans", category: "Sans-Serif", weight: "300,400,500,600,700" },
  { value: "Outfit", label: "Outfit", category: "Sans-Serif", weight: "300,400,500,600,700" },
  { value: "Manrope", label: "Manrope", category: "Sans-Serif", weight: "300,400,500,600,700" },
  { value: "Red Hat Display", label: "Red Hat Display", category: "Sans-Serif", weight: "300,400,500,600,700" },
];

// Helper function to load Google Font dynamically - Optimized for speed
export const loadGoogleFont = (fontFamily: string, weights: string = "300,400,500,600,700") => {
  // Skip system fonts
  if (fontFamily === 'inherit' || fontFamily === 'sans-serif' || fontFamily === 'serif') {
    return;
  }

  // Check if font is already loaded
  const fontId = `font-${fontFamily.replace(/\s+/g, '-')}`;
  if (document.getElementById(fontId)) return;

  try {
    // Create and append Google Fonts link with optimized loading
    const link = document.createElement('link');
    link.id = fontId;
    link.href = `https://fonts.googleapis.com/css2?family=${fontFamily.replace(/\s+/g, '+')}:wght@${weights}&display=swap`;
    link.rel = 'stylesheet';
    link.crossOrigin = 'anonymous';
    
    // Add error handling for CORS issues in development
    link.onerror = () => {};
    
    document.head.appendChild(link);
  } catch (error) {}
};

// Get fonts by category
export const getFontsByCategory = (category?: string) => {
  if (!category) return fontOptions;
  return fontOptions.filter(font => font.category === category);
};

// Export fontOptionsArray for compatibility
export const fontOptionsArray = fontOptions;

// Get font categories
export const fontCategories = [
  { value: "all", label: "All Fonts" },
  { value: "Sans-Serif", label: "Sans-Serif" },
  { value: "Serif", label: "Serif" },
  { value: "Display", label: "Display" },
  { value: "Monospace", label: "Monospace" }
];

// Legacy compatibility - keeping minimal backwards compatibility
export type WidgetStyle = "modern" | "minimal" | "classic" | "bold" | "playful";
export const stylePresets: Record<WidgetStyle, Partial<DesignSettings>> = {
  modern: {
    border_radius: 12,
    shadow_style: "medium",
    container_padding: 24,
  },
  minimal: {
    border_radius: 8,
    shadow_style: "subtle",
    container_padding: 16,
  },
  classic: {
    border_radius: 0,
    shadow_style: "none",
    container_padding: 20,
  },
  bold: {
    border_radius: 0,
    shadow_style: "large",
    container_padding: 24,
  },
  playful: {
    border_radius: 20,
    shadow_style: "medium",
    container_padding: 16,
  }
};

// Utility function to convert hex color + opacity to rgba
export const hexToRgba = (hex: string, opacity: number = 1): string => {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Handle 3-character hex codes
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }
  
  // Parse hex to RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Clamp opacity between 0 and 1
  opacity = Math.max(0, Math.min(1, opacity));
  
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

// Utility function to get background color with opacity
export const getBackgroundColor = (color?: string, opacity?: number): string => {
  if (!color) return 'transparent';
  if (opacity === undefined || opacity === 1) return color;
  if (color.startsWith('rgba') || color.startsWith('rgb')) return color;
  return hexToRgba(color, opacity);
};

// Utility function to get effective padding values
export const getEffectivePadding = (settings: DesignSettings) => {
  const fallback = settings.container_padding !== undefined ? settings.container_padding : 24;
  
  return {
    top: settings.container_padding_top !== undefined ? settings.container_padding_top : fallback,
    right: settings.container_padding_right !== undefined ? settings.container_padding_right : fallback,
    bottom: settings.container_padding_bottom !== undefined ? settings.container_padding_bottom : fallback,
    left: settings.container_padding_left !== undefined ? settings.container_padding_left : fallback,
  };
};

// Utility function to get CSS padding string
export const getPaddingCSS = (settings: DesignSettings): string => {
  const padding = getEffectivePadding(settings);
  return `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`;
};

export const DEFAULT_THEMES: DesignTheme[] = [
  {
    name: "Default Light",
    description: "Clean and modern light theme",
    
    // Overall styling
    background_color: "#ffffff",
    background_opacity: 1,
    background_gradient: "",
    background_image: "",
    container_padding: 24,
    border_radius: 12,
    shadow_style: "medium",
    sidebar_background_color: "#ffffff",
    
    // Preview settings
    max_width: 1200,
    max_height: 800,
    scale_factor: 1,
    
    // Header
    header_enabled: true,
    header_alignment: "center",
    brand_name_color: "#1f2937",
    brand_name_font_family: "Inter",
    brand_name_font_size: 28,
    
    // Logo settings
    logo_enabled: false,
    logo_url: "",
    logo_height: 48,
    logo_border_width: 0,
    logo_border_color: "#e5e7eb",
    logo_border_radius: 4,
    
    // Title/CTA
    title_enabled: false,
    title_text: "Create Amazing AI Images",
    title_color: "#374151",
    title_font_family: "Inter",
    title_font_size: 20,
    cta_enabled: false,
    cta_text: "Get started by uploading a reference image or entering a prompt",
    cta_color: "#374151",
    cta_font_family: "Inter",
    cta_font_size: 16,
    
    // Layout
    layout_mode: "prompt-top",
    prompt_section_width: 40,
    prompt_section_height: 30,
    prompt_gallery_spacing: 24,
    
    // Prompt styling
    prompt_background_color: "#f9fafb",
    prompt_text_color: "#1e293b",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_border_radius: 12,
    prompt_border_color: "#e5e7eb",
    prompt_border_width: 1,
    prompt_border_style: "solid",
    prompt_placeholder_color: "#64748b",
    prompt_section_alignment: "center",
    
    // Theme accent and submit button
    accent_color: "#3b82f6",
    submit_button_background_color: "#3b82f6",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#2563eb",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#1e293b",
    prompt_input_border_color: "#e5e7eb",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 8,
    prompt_input_placeholder_color: "#64748b",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    // Suggestions
    suggestions_enabled: true,
    suggestions_count: 3,
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#374151",
    suggestion_border_style: "solid",
    suggestion_border_color: "#e5e7eb",
    suggestion_border_width: 1,
    suggestion_border_radius: 8,
    suggestion_font_family: "Inter",
    suggestion_font_size: 12,
    suggestion_shadow_style: "subtle",
    suggestion_arrow_icon: true,
    
    // Uploader
    uploader_enabled: true,
    uploader_max_images: 1, // Updated to match gallery_max_images
    uploader_background_color: "#f8fafc",
    uploader_border_style: "dashed",
    uploader_border_color: "#e5e7eb",
    uploader_border_width: 2,
    uploader_border_radius: 12,
    uploader_text_color: "#64748b",
    uploader_font_family: "Inter",
    uploader_font_size: 14,
    uploader_icon_style: "folder",
    uploader_primary_text: "Add reference images to guide the AI generation",
    uploader_secondary_text: "Drag & drop or click to upload",
    
    // Gallery
    gallery_background_color: "transparent",
    gallery_border_radius: 12,
    gallery_spacing: 16,
    gallery_columns: 2,
    gallery_max_images: 4, // Consistent value
    gallery_shadow_style: "medium",
    gallery_font_family: "Inter",
    gallery_font_size: 14,
    
    // Gallery Container Border
    gallery_container_border_enabled: false,
    gallery_container_border_width: 1,
    gallery_container_border_color: "#e5e7eb",
    gallery_container_border_style: "solid",
    gallery_container_border_radius: 12,
    
    // Individual Image Border
    gallery_image_border_enabled: false,
    gallery_image_border_width: 1,
    gallery_image_border_color: "#e5e7eb",
    gallery_image_border_style: "solid",
    gallery_image_border_radius: 8,
    
    // Gallery Overlay
    overlay_enabled: true,
    overlay_download_enabled: true,
    overlay_reference_enabled: true,
    overlay_background_color: "rgba(0, 0, 0, 0.5)",
    overlay_icon_color: "#ffffff",
    overlay_font_family: "Inter",
    overlay_font_size: 14,
    
    // Responsive
    mobile_layout_mode: "prompt-top",
    mobile_gallery_columns: 1,
    mobile_font_scale: 0.9,
    
    // Demo Overlay
    demo_enabled: true,
    demo_upload_message: "Upload your reference images to guide the AI",
    demo_generation_message: "Your AI-generated images will appear here",
    demo_loop_count: 3
  },
  {
    name: "Warm Earth",
    description: "Earthy tones with warm accents",
    
    // Overall styling
    background_color: "#fffbf5",
    background_opacity: 1,
    background_gradient: "",
    background_image: "",
    container_padding: 32,
    border_radius: 16,
    shadow_style: "subtle",
    sidebar_background_color: "#fffbf5",
    
    // Preview settings
    max_width: 1200,
    max_height: 800,
    scale_factor: 1,
    
    // Header
    header_enabled: true,
    header_alignment: "center",
    brand_name_color: "#292524",
    brand_name_font_family: "Inter",
    brand_name_font_size: 32,
    
    // Logo settings
    logo_enabled: false,
    logo_url: "",
    logo_height: 48,
    logo_border_width: 0,
    logo_border_color: "#e7e5e4",
    logo_border_radius: 4,
    
    // Title/CTA
    title_enabled: false,
    title_text: "Create Amazing AI Images",
    title_color: "#44403c",
    title_font_family: "Inter",
    title_font_size: 20,
    cta_enabled: false,
    cta_text: "Get started by uploading a reference image or entering a prompt",
    cta_color: "#44403c",
    cta_font_family: "Inter",
    cta_font_size: 16,
    
    // Layout
    layout_mode: "prompt-top",
    prompt_section_width: 40,
    prompt_section_height: 30,
    prompt_gallery_spacing: 24,
    
    // Prompt styling
    prompt_background_color: "#faf7f0",
    prompt_text_color: "#44403c",
    prompt_font_family: "Inter",
    prompt_font_size: 17,
    prompt_border_radius: 16,
    prompt_border_color: "#e7e5e4",
    prompt_border_width: 1,
    prompt_border_style: "solid",
    prompt_placeholder_color: "#78716c",
    prompt_section_alignment: "center",
    
    // Theme accent and submit button
    accent_color: "#d97706",
    submit_button_background_color: "#d97706",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#c26500",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#44403c",
    prompt_input_border_color: "#e7e5e4",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 12,
    prompt_input_placeholder_color: "#78716c",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 17,
    
    // Suggestions
    suggestions_enabled: true,
    suggestions_count: 3,
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#44403c",
    suggestion_border_style: "solid",
    suggestion_border_color: "#e7e5e4",
    suggestion_border_width: 1,
    suggestion_border_radius: 12,
    suggestion_font_family: "Inter",
    suggestion_font_size: 12,
    suggestion_shadow_style: "subtle",
    suggestion_arrow_icon: true,
    
    // Uploader
    uploader_enabled: true,
    uploader_max_images: 1, // Updated to match gallery_max_images
    uploader_background_color: "#faf7f0",
    uploader_border_style: "dashed",
    uploader_border_color: "#e7e5e4",
    uploader_border_width: 2,
    uploader_border_radius: 16,
    uploader_text_color: "#78716c",
    uploader_font_family: "Inter",
    uploader_font_size: 14,
    uploader_icon_style: "folder",
    uploader_primary_text: "Add reference images to guide the AI generation",
    uploader_secondary_text: "Drag & drop or click to upload",
    
    // Gallery
    gallery_background_color: "transparent",
    gallery_border_radius: 16,
    gallery_spacing: 20,
    gallery_columns: 2,
    gallery_max_images: 4, // Consistent value
    gallery_shadow_style: "subtle",
    gallery_font_family: "Inter",
    gallery_font_size: 14,
    
    // Gallery Container Border
    gallery_container_border_enabled: false,
    gallery_container_border_width: 1,
    gallery_container_border_color: "#e7e5e4",
    gallery_container_border_style: "solid",
    gallery_container_border_radius: 16,
    
    // Individual Image Border
    gallery_image_border_enabled: false,
    gallery_image_border_width: 1,
    gallery_image_border_color: "#e7e5e4",
    gallery_image_border_style: "solid",
    gallery_image_border_radius: 12,
    
    // Gallery Overlay
    overlay_enabled: true,
    overlay_download_enabled: true,
    overlay_reference_enabled: true,
    overlay_background_color: "rgba(0, 0, 0, 0.5)",
    overlay_icon_color: "#ffffff",
    overlay_font_family: "Inter",
    overlay_font_size: 14,
    
    // Responsive
    mobile_layout_mode: "prompt-top",
    mobile_gallery_columns: 1,
    mobile_font_scale: 0.9,
    
    // Demo Overlay
    demo_enabled: true,
    demo_upload_message: "Upload your reference images to guide the AI",
    demo_generation_message: "Your AI-generated images will appear here",
    demo_loop_count: 3
  },
  {
    name: "Ocean Blue",
    description: "Cool and refreshing blue theme",
    
    // Overall styling
    background_color: "#f8fafc",
    background_opacity: 1,
    background_gradient: "",
    background_image: "",
    container_padding: 20,
    border_radius: 8,
    shadow_style: "large",
    sidebar_background_color: "#f8fafc",
    
    // Preview settings
    max_width: 1200,
    max_height: 800,
    scale_factor: 1,
    
    // Header
    header_enabled: true,
    header_alignment: "center",
    brand_name_color: "#1a202c",
    brand_name_font_family: "Inter",
    brand_name_font_size: 28,
    
    // Logo settings
    logo_enabled: false,
    logo_url: "",
    logo_height: 48,
    logo_border_width: 0,
    logo_border_color: "#cbd5e1",
    logo_border_radius: 4,
    
    // Title/CTA
    title_enabled: false,
    title_text: "Create Amazing AI Images",
    title_color: "#1a202c",
    title_font_family: "Inter",
    title_font_size: 20,
    cta_enabled: false,
    cta_text: "Get started by uploading a reference image or entering a prompt",
    cta_color: "#1a202c",
    cta_font_family: "Inter",
    cta_font_size: 16,
    
    // Layout
    layout_mode: "prompt-top",
    prompt_section_width: 40,
    prompt_section_height: 30,
    prompt_gallery_spacing: 24,
    
    // Prompt styling
    prompt_background_color: "#f1f5f9",
    prompt_text_color: "#1a202c",
    prompt_font_family: "Inter",
    prompt_font_size: 16,
    prompt_border_radius: 8,
    prompt_border_color: "#cbd5e1",
    prompt_border_width: 1,
    prompt_border_style: "solid",
    prompt_placeholder_color: "#a0aec0",
    prompt_section_alignment: "center",
    
    // Theme accent and submit button
    accent_color: "#0ea5e9",
    submit_button_background_color: "#0ea5e9",
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: "#0b87c7",
    
    // Prompt input field
    prompt_input_background_color: "#ffffff",
    prompt_input_text_color: "#1a202c",
    prompt_input_border_color: "#cbd5e1",
    prompt_input_border_style: "solid",
    prompt_input_border_width: 1,
    prompt_input_border_radius: 6,
    prompt_input_placeholder_color: "#a0aec0",
    prompt_input_font_family: "Inter",
    prompt_input_font_size: 16,
    
    // Suggestions
    suggestions_enabled: true,
    suggestions_count: 3,
    suggestion_background_color: "#ffffff",
    suggestion_text_color: "#1a202c",
    suggestion_border_style: "solid",
    suggestion_border_color: "#cbd5e1",
    suggestion_border_width: 1,
    suggestion_border_radius: 6,
    suggestion_font_family: "Inter",
    suggestion_font_size: 12,
    suggestion_shadow_style: "subtle",
    suggestion_arrow_icon: true,
    
    // Uploader
    uploader_enabled: true,
    uploader_max_images: 1, // Updated to match gallery_max_images
    uploader_background_color: "#f1f5f9",
    uploader_border_style: "dashed",
    uploader_border_color: "#cbd5e1",
    uploader_border_width: 2,
    uploader_border_radius: 8,
    uploader_text_color: "#a0aec0",
    uploader_font_family: "Inter",
    uploader_font_size: 14,
    uploader_icon_style: "folder",
    uploader_primary_text: "Add reference images to guide the AI generation",
    uploader_secondary_text: "Drag & drop or click to upload",
    
    // Gallery
    gallery_background_color: "transparent",
    gallery_border_radius: 8,
    gallery_spacing: 16,
    gallery_columns: 2,
    gallery_max_images: 4, // Consistent value
    gallery_shadow_style: "large",
    gallery_font_family: "Inter",
    gallery_font_size: 14,
    
    // Gallery Container Border
    gallery_container_border_enabled: false,
    gallery_container_border_width: 1,
    gallery_container_border_color: "#cbd5e1",
    gallery_container_border_style: "solid",
    gallery_container_border_radius: 8,
    
    // Individual Image Border
    gallery_image_border_enabled: false,
    gallery_image_border_width: 1,
    gallery_image_border_color: "#cbd5e1",
    gallery_image_border_style: "solid",
    gallery_image_border_radius: 6,
    
    // Gallery Overlay
    overlay_enabled: true,
    overlay_download_enabled: true,
    overlay_reference_enabled: true,
    overlay_background_color: "rgba(0, 0, 0, 0.5)",
    overlay_icon_color: "#ffffff",
    overlay_font_family: "Inter",
    overlay_font_size: 14,
    
    // Responsive
    mobile_layout_mode: "prompt-top",
    mobile_gallery_columns: 1,
    mobile_font_scale: 0.9,
    
    // Demo Overlay
    demo_enabled: true,
    demo_upload_message: "Upload your reference images to guide the AI",
    demo_generation_message: "Your AI-generated images will appear here",
    demo_loop_count: 3
  }
];

// Color theory helper functions
const hexToHSL = (hex: string): { h: number; s: number; l: number } => {
  // Remove the # if present
  hex = hex.replace('#', '');
  
  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    
    h /= 6;
  }
  
  return { h: h * 360, s: s * 100, l: l * 100 };
};

const HSLToHex = (h: number, s: number, l: number): string => {
  h = h % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  
  let r = 0;
  let g = 0;
  let b = 0;
  
  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else if (h >= 300 && h < 360) {
    r = c; g = 0; b = x;
  }
  
  const toHex = (n: number): string => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

// Theme generation function
export const generateTheme = (name: string): DesignTheme => {
  // Generate a seed based on the name
  let seed = 0;
  for (let i = 0; i < name.length; i++) {
    seed = ((seed << 5) - seed) + name.charCodeAt(i);
    seed = seed & seed;
  }
  
  // Generate base hue from seed
  const baseHue = Math.abs(seed) % 360;
  
  // Generate accent color (complementary or triadic)
  const accentHue = (baseHue + (Math.abs(seed) % 2 === 0 ? 180 : 120)) % 360;
  
  // Generate base colors
  const baseColor = HSLToHex(baseHue, 30, 98); // Light base
  const accentColor = HSLToHex(accentHue, 80, 55); // Vibrant accent
  const textColor = HSLToHex(baseHue, 20, 15); // Dark text
  const borderColor = HSLToHex(baseHue, 15, 90); // Light border
  const promptBg = HSLToHex(baseHue, 20, 97); // Slightly tinted background
  
  // Determine style based on name characteristics
  const isElegant = /elegant|luxury|premium|refined|classic/.test(name.toLowerCase());
  const isPlayful = /playful|fun|bright|creative|vibrant/.test(name.toLowerCase());
  const isMinimal = /minimal|clean|simple|modern|sleek/.test(name.toLowerCase());
  
  // Style configuration
  const style = {
    borderRadius: isElegant ? 8 : isPlayful ? 16 : 12,
    shadowStyle: isElegant ? "medium" : isPlayful ? "large" : "subtle",
    padding: isMinimal ? 20 : isElegant ? 32 : 24,
    fontSize: isElegant ? 17 : 16,
  } as const;
  
  return {
    name,
    description: `Generated theme based on "${name}"`,
    
    // Overall styling
    background_color: baseColor,
    background_opacity: 1,
    background_gradient: "",
    background_image: "",
    container_padding: style.padding,
    border_radius: style.borderRadius,
    shadow_style: style.shadowStyle as ShadowStyle,
    sidebar_background_color: baseColor,
    
    // Preview settings
    max_width: 1200,
    max_height: 800,
    scale_factor: 1,
    
    // Header
    header_enabled: true,
    header_alignment: "center",
    brand_name_color: textColor,
    brand_name_font_family: "Inter",
    brand_name_font_size: style.fontSize + 12,
    
    // Logo settings
    logo_enabled: false,
    logo_url: "",
    logo_height: 48,
    logo_border_width: 0,
    logo_border_color: borderColor,
    logo_border_radius: 4,
    
    // Title/CTA
    title_enabled: false,
    title_text: "Create Amazing AI Images",
    title_color: textColor,
    title_font_family: "Inter",
    title_font_size: style.fontSize + 4,
    cta_enabled: false,
    cta_text: "Get started by uploading a reference image or entering a prompt",
    cta_color: textColor,
    cta_font_family: "Inter",
    cta_font_size: style.fontSize,
    
    // Layout
    layout_mode: "prompt-bottom",
    prompt_section_width: 40,
    prompt_section_height: 30,
    prompt_gallery_spacing: style.padding,
    
    // Prompt styling
    prompt_background_color: promptBg,
    prompt_text_color: textColor,
    prompt_font_family: "Inter",
    prompt_font_size: style.fontSize,
    prompt_border_radius: style.borderRadius,
    prompt_border_color: borderColor,
    prompt_border_width: 1,
    prompt_border_style: "solid",
    prompt_placeholder_color: HSLToHex(baseHue, 20, 60),
    prompt_section_alignment: "center",
    
    // Theme accent and submit button
    accent_color: accentColor,
    submit_button_background_color: accentColor,
    submit_button_text_color: "#ffffff",
    submit_button_hover_background_color: HSLToHex(accentHue, 85, 45),
    
    // Suggestions styling
    suggestions_enabled: true,
    suggestions_count: 3,
    suggestion_background_color: "#ffffff",
    suggestion_text_color: textColor,
    suggestion_font_family: "Inter",
    suggestion_font_size: style.fontSize - 4,
    suggestion_border_radius: style.borderRadius - 4,
    suggestion_border_color: borderColor,
    suggestion_border_width: 1,
    suggestion_border_style: "solid",
    suggestion_shadow_style: "subtle",
    suggestion_arrow_icon: true,
    
    // Uploader styling
    uploader_enabled: true,
    uploader_max_images: 1, // Updated to match gallery_max_images
    uploader_background_color: promptBg,
    uploader_border_color: HSLToHex(baseHue, 30, 80),
    uploader_text_color: HSLToHex(baseHue, 20, 40),
    uploader_font_family: "Inter",
    uploader_font_size: style.fontSize - 2,
    uploader_border_radius: style.borderRadius,
    uploader_border_width: 2,
    uploader_border_style: "dashed",
    uploader_icon_style: "folder",
    uploader_primary_text: "Add reference images to guide the AI generation",
    uploader_secondary_text: "Drag & drop or click to upload",
    
    // Gallery styling
    gallery_background_color: "transparent",
    gallery_spacing: style.padding - 8,
    gallery_border_radius: style.borderRadius,
    gallery_columns: 2,
    gallery_max_images: 4, // Consistent value
    gallery_shadow_style: style.shadowStyle as ShadowStyle,
    gallery_font_family: "Inter",
    gallery_font_size: style.fontSize - 2,
    
    // Gallery Container Border
    gallery_container_border_enabled: false,
    gallery_container_border_width: 1,
    gallery_container_border_color: borderColor,
    gallery_container_border_style: "solid",
    gallery_container_border_radius: style.borderRadius,
    
    // Individual Image Border
    gallery_image_border_enabled: false,
    gallery_image_border_width: 1,
    gallery_image_border_color: borderColor,
    gallery_image_border_style: "solid",
    gallery_image_border_radius: style.borderRadius - 4,
    
    // Gallery Overlay
    overlay_enabled: true,
    overlay_download_enabled: true,
    overlay_reference_enabled: true,
    overlay_background_color: "rgba(0, 0, 0, 0.5)",
    overlay_icon_color: "#ffffff",
    overlay_font_family: "Inter",
    overlay_font_size: style.fontSize - 2,
    
    // Responsive
    mobile_layout_mode: "prompt-top",
    mobile_gallery_columns: 1,
    mobile_font_scale: 0.9,
    
    // Demo Overlay
    demo_enabled: true,
    demo_upload_message: "Upload your reference images to guide the AI",
    demo_generation_message: "Your AI-generated images will appear here",
    demo_loop_count: 3
  };
};

export interface Template {
  id?: string;
  name: string;
  description: string;
  category: string;
  category_description?: string;
  subcategories: string[];
  subcategory_descriptions?: Record<string, string>;
  example_images: string[];
  example_prompts: string[];
  status?: 'active' | 'pending_review' | 'verification_needed';
  user_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TemplateCategory {
  name: string;
  subcategories: {
    name: string;
    templates: Template[];
  }[];
}

export interface LayoutProps {
  config: DesignSettings;
  prompt: string;
  setPrompt: (prompt: string) => void;
  isLoading: boolean;
  suggestions: { text: string }[];
  referenceImages: string[];
  generatedImages: { image: string | null }[];
  fullPage?: boolean;
  deployment?: boolean;
  containerWidth?: number;
  instanceId: string;
  onGenerateGallery: () => void;
  onPromptSubmit: () => void;
  onSuggestionClick: (suggestion: { text: string }) => void;
  onImageUpload: (image: string | null) => void;
  onImageRemove: (index: number) => void;
  onRefreshSuggestions: () => void;
  isSubmissionLimitReached?: boolean;
  submissionCount?: number;
  maxSubmissions?: number;
  hideInMobile?: boolean;
}
