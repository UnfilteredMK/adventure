import type { LayoutMode, TextAlign } from "@/types/design";

export interface DesignSettingsV2 {
  // Global style tokens (keep this small)
  color_theme?: string;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  font_family: string;
  base_font_size: number;

  // Branding
  header_enabled: boolean;
  header_alignment: TextAlign;
  brand_name_enabled: boolean;
  brand_name: string;
  logo_enabled: boolean;
  logo_url: string;
  logo_height: number;

  // Layout
  layout_mode: LayoutMode;

  // User input (functional)
  uploader_enabled: boolean;
  uploader_max_images: number;
  uploader_primary_text: string;
  uploader_secondary_text: string;

  suggestions_enabled: boolean;
  suggestions_count: number;

  // Gallery (functional)
  gallery_columns: number;
  gallery_max_images: number;
  gallery_show_placeholder_images: boolean;
  gallery_show_prompts: boolean;

  // Demo overlay
  demo_enabled: boolean;
  demo_upload_message: string;
  demo_generation_message: string;
  demo_loop_count: number;
  demo_click_to_dismiss: boolean;

  // Lead capture / form overlay
  lead_capture_enabled: boolean;
  lead_capture_trigger: "immediate" | "submit" | "halfway" | "on_download";
  lead_step1_title: string;
  lead_step1_placeholder: string;
  lead_step2_title: string;
  lead_step2_name_placeholder: string;
  lead_step2_phone_placeholder: string;

  // AI Form (Flow) status flag. Mirrors `instances.flow_config.enabled`.
  form_status_enabled: boolean;

  // AI Form UI toggles (stored in instances.config; default to on)
  form_show_progress_bar: boolean;
  form_show_step_descriptions: boolean;

  // Full AI Form config (formerly stored in `instances.flow_config`).
  // Stored as JSON to keep the V2 surface area stable.
  form_config: Record<string, unknown> | null;

  // Launch (iframe + modal + standalone) — keep mostly functional/technical knobs
  iframe_width: string;
  iframe_height: string;
  iframe_loading: "lazy" | "eager";
  iframe_sandbox: string;
  iframe_referrerpolicy: string;
  iframe_allowtransparency: boolean;
  iframe_scrolling: "auto" | "yes" | "no";

  modal_width: string;
  modal_height: string;
  modal_max_width: number;
  modal_max_height: number;
  modal_backdrop_color: string;
  modal_backdrop_opacity: number;
  modal_background_color: string;
  modal_border_radius: number;
  modal_show_close_button: boolean;
  modal_close_button_color: string;
  modal_close_button_hover_color: string;
  modal_close_on_backdrop: boolean;
  modal_close_on_escape: boolean;
  modal_animation_type: "fade" | "slide-up" | "slide-down" | "scale";
  modal_animation_duration: number;
  modal_position: "center" | "top" | "bottom";

  full_width_layout: boolean;
  sticky_header: boolean;
  show_page_title: boolean;
  show_breadcrumbs: boolean;
  show_back_button: boolean;
  content_max_width: number;
}

export const defaultDesignSettingsV2: DesignSettingsV2 = {
  color_theme: "custom",
  primary_color: "#000000",
  secondary_color: "#ffffff",
  background_color: "#ffffff",
  font_family: "Inter",
  base_font_size: 16,

  header_enabled: true,
  header_alignment: "center",
  brand_name_enabled: true,
  brand_name: "AI Studio",
  logo_enabled: false,
  logo_url: "",
  logo_height: 48,

  layout_mode: "prompt-bottom",

  uploader_enabled: true,
  uploader_max_images: 1,
  uploader_primary_text: "Add reference images to guide the AI generation",
  uploader_secondary_text: "Drag & drop or click to upload",

  suggestions_enabled: true,
  suggestions_count: 3,

  gallery_columns: 2,
  gallery_max_images: 4,
  gallery_show_placeholder_images: true,
  gallery_show_prompts: true,

  demo_enabled: true,
  demo_upload_message: "Upload your reference images to guide the AI",
  demo_generation_message: "Your AI-generated images will appear here",
  demo_loop_count: 3,
  demo_click_to_dismiss: false,

  lead_capture_enabled: false,
  lead_capture_trigger: "submit",
  lead_step1_title: "Where should we send your AI-generated photos?",
  lead_step1_placeholder: "Enter your email",
  lead_step2_title: "One last thing! We'll send your photos right away...",
  lead_step2_name_placeholder: "What's your name?",
  lead_step2_phone_placeholder: "Enter your phone number",

  form_status_enabled: false,
  form_show_progress_bar: true,
  form_show_step_descriptions: true,
  form_config: null,

  iframe_width: "500px",
  iframe_height: "600px",
  iframe_loading: "lazy",
  iframe_sandbox: "allow-scripts allow-same-origin allow-forms",
  iframe_referrerpolicy: "no-referrer-when-downgrade",
  iframe_allowtransparency: true,
  iframe_scrolling: "auto",

  modal_width: "80%",
  modal_height: "80%",
  modal_max_width: 600,
  modal_max_height: 800,
  modal_backdrop_color: "#000000",
  modal_backdrop_opacity: 0.5,
  modal_background_color: "#ffffff",
  modal_border_radius: 12,
  modal_show_close_button: true,
  modal_close_button_color: "#6b7280",
  modal_close_button_hover_color: "#374151",
  modal_close_on_backdrop: true,
  modal_close_on_escape: true,
  modal_animation_type: "fade",
  modal_animation_duration: 300,
  modal_position: "center",

  full_width_layout: false,
  sticky_header: false,
  show_page_title: true,
  show_breadcrumbs: false,
  show_back_button: false,
  content_max_width: 1200,
};
