export const DETERMINISTIC_CONSENT_ID = "step-pricing-accuracy-consent";
export const DETERMINISTIC_SERVICE_ID = "step-service-primary";
export const DETERMINISTIC_STYLE_ID = "step-style-direction";
/** Planner scope keys rendered as `step-<key>` before style in adventure flow. */
export const PRE_CONCEPT_SCOPE_STEP_IDS: ReadonlySet<string> = new Set([
  "step-project-type",
  "step-project-parts",
  "step-update-areas",
  "step-remodel-intensity",
]);
export const DETERMINISTIC_FULL_NAME_ID = "step-user-full-name";
export const DETERMINISTIC_SCENE_IMAGE_ID = "step-upload-scene-image";
export const DETERMINISTIC_USER_IMAGE_ID = "step-upload-user-image";
export const DETERMINISTIC_PRODUCT_IMAGE_ID = "step-upload-product-image";
export const DETERMINISTIC_BUDGET_ID = "step-budget-range";
export const PRICING_ESTIMATE_KEY = "__pricingEstimate";

export const FORM_STATE_SCHEMA_VERSION = "1";
export const DEFAULT_TOKEN_BUDGET_TOTAL = 3000;
export const DEFAULT_IMAGE_PREVIEW_AT_FRACTION = 0.9;
