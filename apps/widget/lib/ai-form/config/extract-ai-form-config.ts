import type { AIFormConfig } from "@/types/ai-form";

type AnyRecord = Record<string, any>;

function isPlainObject(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickFirst<T>(...values: Array<T | undefined | null>): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * Consolidated AI-form config extraction.
 *
 * Preferred source: `instance.config.<key>`
 * Legacy fallback:  `instance.config.aiFormConfig.<key>`
 *
 * Defaults are aligned to backend behavior (generate-steps/pricing).
 */
export function extractAIFormConfig(instanceConfig: unknown): AIFormConfig {
  const cfg = isPlainObject(instanceConfig) ? instanceConfig : {};
  const legacy = isPlainObject(cfg.aiFormConfig) ? (cfg.aiFormConfig as AnyRecord) : {};

  // Intentionally allow root keys to override legacy (consolidation).
  const maxSteps = pickFirst<number>(cfg.maxSteps, legacy.maxSteps) ?? 20;
  const maxImages = pickFirst<number>(cfg.maxImages, legacy.maxImages) ?? 3;
  const requiredInputs = pickFirst<string[]>(cfg.requiredInputs, legacy.requiredInputs) ?? ["email"];
  const pricingVisibility =
    pickFirst<AIFormConfig["pricingVisibility"]>(cfg.pricingVisibility, legacy.pricingVisibility) ?? "after_designer";
  const pricingMode = pickFirst<AIFormConfig["pricingMode"]>(cfg.pricingMode, legacy.pricingMode) ?? "range";
  const quoteBeforeLead = Boolean(pickFirst<boolean>(cfg.quoteBeforeLead, legacy.quoteBeforeLead) ?? false);
  const upgradesEnabled = Boolean(pickFirst<boolean>(cfg.upgradesEnabled, legacy.upgradesEnabled) ?? false);
  const allowRefinement = Boolean(pickFirst<boolean>(cfg.allowRefinement, legacy.allowRefinement) ?? false);
  const leadCaptureEnabled = pickFirst<boolean>(
    cfg.leadCaptureEnabled,
    cfg.lead_capture_enabled,
    legacy.leadCaptureEnabled,
    legacy.lead_capture_enabled
  );
  const leadCaptureRequired = pickFirst<boolean>(
    cfg.leadCaptureRequired,
    cfg.lead_capture_required,
    legacy.leadCaptureRequired,
    legacy.lead_capture_required,
    // If caller uses "enabled" semantics, treat it as required=true/false for now.
    leadCaptureEnabled
  );
  const previewPricing = pickFirst<AIFormConfig["previewPricing"]>(cfg.previewPricing, legacy.previewPricing);
  const visualPricingJourneyVersion = pickFirst<AIFormConfig["visualPricingJourneyVersion"]>(
    cfg.visual_pricing_journey_version,
    cfg.visualPricingJourneyVersion,
    legacy.visual_pricing_journey_version,
    legacy.visualPricingJourneyVersion
  );
  const pricingGateStrategy = pickFirst<AIFormConfig["pricingGateStrategy"]>(
    cfg.pricing_gate_strategy,
    cfg.pricingGateStrategy,
    legacy.pricing_gate_strategy,
    legacy.pricingGateStrategy
  );
  const pricingGateExperimentPercent = pickFirst<number>(
    cfg.pricing_gate_experiment_percent,
    cfg.pricingGateExperimentPercent,
    legacy.pricing_gate_experiment_percent,
    legacy.pricingGateExperimentPercent
  );
  const pricingGateExperimentKey = pickFirst<string>(
    cfg.pricing_gate_experiment_key,
    cfg.pricingGateExperimentKey,
    legacy.pricing_gate_experiment_key,
    legacy.pricingGateExperimentKey
  );

  return {
    // The rejected stacked V1 intentionally does not reactivate when old
    // instance data still contains `v1`. Only the new studio flag opts in.
    visualPricingJourneyVersion:
      visualPricingJourneyVersion === "studio_v1" ? "studio_v1" : "legacy",
    pricingGateStrategy:
      pricingGateStrategy === "coarse_visible" || pricingGateStrategy === "experiment"
        ? pricingGateStrategy
        : "blurred",
    pricingGateExperimentPercent:
      Number.isFinite(Number(pricingGateExperimentPercent))
        ? Math.max(0, Math.min(100, Number(pricingGateExperimentPercent)))
        : 50,
    pricingGateExperimentKey:
      typeof pricingGateExperimentKey === "string" && pricingGateExperimentKey.trim()
        ? pricingGateExperimentKey.trim()
        : "visual-pricing-v1-gate-1",
    maxSteps,
    maxImages,
    requiredInputs,
    pricingVisibility,
    pricingMode,
    quoteBeforeLead,
    upgradesEnabled,
    allowRefinement,
    // Keep undefined if not provided so callers can preserve existing defaults/behavior.
    ...(leadCaptureRequired !== undefined ? { leadCaptureRequired } : {}),
    ...(previewPricing !== undefined ? { previewPricing } : {}),
    // Keep these pass-through for now (they're safe and help consolidate later).
    ...(pickFirst<any>(cfg.allowedBuyerRefinements, legacy.allowedBuyerRefinements) !== undefined
      ? { allowedBuyerRefinements: pickFirst<any>(cfg.allowedBuyerRefinements, legacy.allowedBuyerRefinements) }
      : {}),
    ...(pickFirst<any>(cfg.minConfidenceForUploads, legacy.minConfidenceForUploads) !== undefined
      ? { minConfidenceForUploads: pickFirst<any>(cfg.minConfidenceForUploads, legacy.minConfidenceForUploads) }
      : {}),
    ...(pickFirst<any>(cfg.minConfidenceForPricing, legacy.minConfidenceForPricing) !== undefined
      ? { minConfidenceForPricing: pickFirst<any>(cfg.minConfidenceForPricing, legacy.minConfidenceForPricing) }
      : {}),
    ...(pickFirst<any>(cfg.maxQualifyQuestions, legacy.maxQualifyQuestions) !== undefined
      ? { maxQualifyQuestions: pickFirst<any>(cfg.maxQualifyQuestions, legacy.maxQualifyQuestions) }
      : {}),
    ...(pickFirst<any>(cfg.minQuestionsBeforeVisual, legacy.minQuestionsBeforeVisual) !== undefined
      ? { minQuestionsBeforeVisual: pickFirst<any>(cfg.minQuestionsBeforeVisual, legacy.minQuestionsBeforeVisual) }
      : {}),
    ...(pickFirst<any>(cfg.businessContext, legacy.businessContext) !== undefined
      ? { businessContext: pickFirst<any>(cfg.businessContext, legacy.businessContext) }
      : {}),
    ...(pickFirst<any>(cfg.industry, legacy.industry) !== undefined
      ? { industry: pickFirst<any>(cfg.industry, legacy.industry) }
      : {}),
    ...(pickFirst<any>(cfg.services, legacy.services) !== undefined
      ? { services: pickFirst<any>(cfg.services, legacy.services) }
      : {}),
  };
}
