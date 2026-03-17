/**
 * Structural Step Templates
 * 
 * Deterministic builders for structural steps (designer, lead_capture, pricing, confirmation, upload).
 * These don't need AI generation - just use form state to determine placement and minimal copy.
 */

import type { AIFormConfig } from "@/types/ai-form";
import type {
  ConfirmationUI,
  DesignerUI,
  FileUploadUI,
  LeadCaptureUI,
  PricingUI,
} from "@/types/ai-form-ui-contract";

// RequiredUpload type (matches form-state.ts)
export type RequiredUpload = {
  stepId: string;
  label: string;
  role: "sceneImage" | "userImage" | "productImage";
  required?: boolean;
  allowSkip?: boolean;
};

export type PreviewPricingRange = { totalMin: number; totalMax: number; currency?: string };

function clampNumber(n: any, fallback: number, min: number, max: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function roundTo(n: number, step: number) {
  if (!Number.isFinite(n) || step <= 0) return n;
  return Math.round(n / step) * step;
}

export function buildPreviewPricingFromConfig(raw: any, seed?: string | null): PreviewPricingRange {
  const baseMin = clampNumber(raw?.totalMin ?? raw?.min ?? raw?.total_min, 200, 25, 100000);
  const baseMax = clampNumber(raw?.totalMax ?? raw?.max ?? raw?.total_max, 400, 25, 100000);
  const currency =
    typeof raw?.currency === "string" && raw.currency.trim() ? String(raw.currency).trim().toUpperCase() : "USD";

  const min0 = Math.min(baseMin, baseMax);
  const max0 = Math.max(baseMin, baseMax);

  // Keep ranges readable and stable (no per-session seeding/jitter): round to nearest $10 and enforce a sensible spread.
  // `seed` is accepted for backwards compatibility but intentionally unused.
  void seed;
  const roundedMin = roundTo(min0, 10);
  const roundedMax = roundTo(max0, 10);
  const totalMin = Math.max(25, Math.min(roundedMin, roundedMax - 10));
  const totalMax = Math.max(totalMin + 10, roundedMax);

  return { totalMin, totalMax, currency };
}

/**
 * Build a designer step (visual hook)
 */
export function buildDesignerStep(params?: { includePricing?: boolean; previewPricing?: any; seed?: string | null }): DesignerUI {
  const step: any = {
    id: "step-designer",
    type: "designer",
    question: "Let's create your design",
    humanism: "We'll generate a personalized visual based on your preferences.",
    required: false,
    allow_refinements: true,
    blueprint: { presentation: { continue_label: "Continue" } },
  };
  if (params?.includePricing) {
    step.data = { ...(step.data || {}), pricing: buildPreviewPricingFromConfig(params.previewPricing, params.seed) };
  }
  return step;
}

/**
 * Build a lead capture step
 */
export function buildLeadCaptureStep(params: {
  mode?: "email" | "name" | "phone" | "full";
  requiredInputs?: string[];
  compact?: boolean;
  gateContext?: "design" | "design_and_estimate" | "estimate" | "photos" | "results";
}): LeadCaptureUI {
  const { mode = "full", requiredInputs = ["email"], compact = true, gateContext } = params;

  const normalizedRequiredInputs = Array.from(
    new Set(
      (Array.isArray(requiredInputs) ? requiredInputs : [])
        .map((x) => String(x || "").trim().toLowerCase())
        .filter((x) => x === "email" || x === "phone" || x === "name")
    )
  ) as Array<"email" | "phone" | "name">;

  // If the caller uses mode "full" but only requires email, treat it as email-first.
  const effectiveMode =
    mode === "full" &&
    normalizedRequiredInputs.length === 1 &&
    normalizedRequiredInputs[0] === "email"
      ? "email"
      : mode;
  
  const stepId =
    effectiveMode === "email"
      ? "step-lead-capture"
      : effectiveMode === "name"
        ? "step-lead-name"
        : effectiveMode === "phone"
          ? "step-lead-phone"
          : "step-lead-capture";
  
  const headlineByGateContext: Record<
    NonNullable<typeof gateContext>,
    { question: string; humanism: string }
  > = {
    design: { question: "Where should we send your design?", humanism: "We'll email it to you." },
    design_and_estimate: { question: "Where should we send your design and estimate?", humanism: "We'll email it to you." },
    estimate: { question: "Where should we send your estimate?", humanism: "We'll email it to you." },
    photos: { question: "Where should we send your photos?", humanism: "We'll email them to you." },
    results: { question: "Where should we send your results?", humanism: "We'll email them to you." },
  };

  const gateCopy = gateContext ? headlineByGateContext[gateContext] : null;

  const wantsEmail =
    effectiveMode === "email" ||
    (effectiveMode === "full" && normalizedRequiredInputs.includes("email"));

  const headline = gateCopy?.question
    ? gateCopy.question
    : wantsEmail
      ? "Where should we send this?"
      : effectiveMode === "name"
        ? "What's your name?"
        : "What's your phone number?";

  const humanism = gateCopy?.humanism
    ? gateCopy.humanism
    : wantsEmail
      ? "We'll email it to you."
      : "We'll only use it to contact you about your request.";

  const step: LeadCaptureUI = {
    id: stepId,
    type: "lead_capture",
    question: headline,
    humanism,
    required_inputs: (normalizedRequiredInputs as any) || null,
    compact,
    blueprint: gateContext ? { validation: { gate_context: gateContext } } : undefined,
  };
  return step;
}

/**
 * Build a pricing step
 */
export function buildPricingStep(cfg: AIFormConfig): PricingUI {
  const pricingMode = cfg.pricingMode ?? "range";
  
  const step: PricingUI = {
    id: "step-pricing",
    type: "pricing",
    question: "Your estimate",
    humanism: "Based on your selections so far.",
    required: false,
    blueprint: {
      presentation: { continue_label: "Continue" },
      validation: { pricing_mode: pricingMode },
    },
  };
  return step;
}

/**
 * Build a confirmation step
 */
export function buildConfirmationStep(): ConfirmationUI {
  const step: ConfirmationUI = {
    id: "step-confirmation",
    type: "confirmation",
    question: "Confirm your details",
    humanism: "One last review before we submit.",
    required: false,
    blueprint: { presentation: { continue_label: "Confirm" } },
  };
  return step;
}

/**
 * Build an upload step
 */
export function buildUploadStep(upload: RequiredUpload): FileUploadUI {
  const isRequired = upload.required === true;
  const allowSkip = typeof upload.allowSkip === "boolean" ? upload.allowSkip : !isRequired;
  const roleLabel =
    upload.role === "sceneImage"
      ? "a photo of the area"
      : upload.role === "userImage"
        ? "a photo of the person"
        : "a photo of the product";
  const questionLabel = upload.label || `Upload ${roleLabel}`;
  const step: FileUploadUI = {
    id: upload.stepId,
    type: "upload",
    question: questionLabel,
    humanism: isRequired
      ? "Please upload an image so we can generate your design."
      : "This helps improve accuracy. You can skip if you don't have one ready.",
    required: isRequired,
    upload_role: upload.role,
    max_files: 1,
    allow_skip: allowSkip,
    blueprint: { presentation: { continue_label: "Continue" } },
  };
  return step;
}
