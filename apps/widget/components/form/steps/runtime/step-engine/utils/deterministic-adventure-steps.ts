import type { StepDefinition } from "@/types/ai-form";
import { deriveBudgetSliderRange, roundBudgetStep } from "./budget";
import {
  DETERMINISTIC_BUDGET_ID,
  DETERMINISTIC_PRODUCT_IMAGE_ID,
  DETERMINISTIC_SCENE_IMAGE_ID,
  DETERMINISTIC_USER_IMAGE_ID,
} from "../constants";

type NormalizedUseCase = "tryon" | "scene-placement" | "scene";

export function normalizeDeterministicUseCase(rawUseCase: unknown): NormalizedUseCase {
  const raw = String(rawUseCase || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
  if (raw === "tryon" || raw === "try-on") return "tryon";
  if (raw === "scene-placement") return "scene-placement";
  return "scene";
}

function buildOptionalSceneImageStep(): StepDefinition {
  return {
    id: DETERMINISTIC_SCENE_IMAGE_ID,
    componentType: "upload",
    intent: "collect_context",
    data: { required: false, maxFiles: 1, accept: "image/*", uploadRole: "sceneImage", camera: true },
    copy: {
      headline: "Have a photo handy?",
      subtext: "Optional - upload one for tailored results, or skip and we'll generate concept ideas.",
    },
  };
}

function buildRequiredSceneImageStep(): StepDefinition {
  return {
    id: DETERMINISTIC_SCENE_IMAGE_ID,
    componentType: "upload",
    intent: "collect_context",
    data: { required: true, maxFiles: 1, accept: "image/*", uploadRole: "sceneImage", camera: true },
    copy: {
      headline: "Upload a photo of the space",
      subtext: "Upload (or take) a photo of the room/area so we can generate the preview.",
    },
  };
}

function buildRequiredUserImageStep(): StepDefinition {
  return {
    id: DETERMINISTIC_USER_IMAGE_ID,
    componentType: "upload",
    intent: "collect_context",
    data: { required: true, maxFiles: 1, accept: "image/*", uploadRole: "userImage", camera: true },
    copy: {
      headline: "Upload a photo of the person",
      subtext: "Upload (or take) a photo so we can generate the try-on preview.",
    },
  };
}

function buildRequiredProductImageStep(): StepDefinition {
  return {
    id: DETERMINISTIC_PRODUCT_IMAGE_ID,
    componentType: "upload",
    intent: "collect_context",
    data: { required: true, maxFiles: 1, accept: "image/*", uploadRole: "productImage", camera: false },
    copy: {
      headline: "Upload a photo of the product",
      subtext: "Upload a clear product photo so we can place it accurately in the preview.",
    },
  };
}

export function buildDeterministicUploadSteps(rawUseCase: unknown): StepDefinition[] {
  const normalizedUseCase = normalizeDeterministicUseCase(rawUseCase);
  if (normalizedUseCase === "tryon") return [buildRequiredUserImageStep(), buildRequiredProductImageStep()];
  if (normalizedUseCase === "scene-placement") return [buildRequiredSceneImageStep(), buildRequiredProductImageStep()];
  return [buildOptionalSceneImageStep()];
}

export function buildDeterministicBudgetStep(params: {
  config?: any;
  pricingSeed?: any;
  budgetApiRange?: { min: number; max: number; currency: string } | null;
  useCase?: unknown;
  required?: boolean;
}): StepDefinition {
  const { config, pricingSeed, budgetApiRange, useCase, required = true } = params;
  const cfg = config?.previewPricing;
  const seededRange =
    pricingSeed?.servicePriceRange ??
    pricingSeed?.imagePriceRange ??
    (typeof pricingSeed?.totalMin === "number" && typeof pricingSeed?.totalMax === "number"
      ? { low: pricingSeed.totalMin, high: pricingSeed.totalMax }
      : null);
  const apiMin = Number(seededRange?.low ?? budgetApiRange?.min);
  const apiMax = Number(seededRange?.high ?? budgetApiRange?.max);
  const hasApiBounds = Number.isFinite(apiMin) && Number.isFinite(apiMax) && apiMin > 0 && apiMax > 0;
  const cfgMin = Number(cfg?.totalMin);
  const cfgMax = Number(cfg?.totalMax);
  const currency =
    typeof pricingSeed?.currency === "string" && pricingSeed.currency.trim()
      ? pricingSeed.currency.trim().toUpperCase()
      : typeof budgetApiRange?.currency === "string" && budgetApiRange.currency.trim()
        ? budgetApiRange.currency.trim().toUpperCase()
        : "USD";
  const normalizedUseCase = normalizeDeterministicUseCase(useCase);
  const defaultMin = normalizedUseCase === "tryon" ? 500 : 2000;
  const defaultMax = normalizedUseCase === "tryon" ? 10000 : 50000;
  const derived = deriveBudgetSliderRange(cfgMin, cfgMax, defaultMin, defaultMax);
  const min = hasApiBounds ? Math.min(apiMin, apiMax) : derived.min;
  const max = hasApiBounds ? Math.max(apiMin, apiMax) : derived.max;
  const step = hasApiBounds ? Math.max(100, roundBudgetStep(max - min)) : derived.step;
  return {
    id: DETERMINISTIC_BUDGET_ID,
    componentType: "slider",
    intent: "collect_context",
    data: {
      required,
      min,
      max,
      step: Math.max(100, step),
      currency,
      unit: "$",
      unitType: "currency",
      format: "currency",
    },
    copy: {
      headline: "What budget range should we design around?",
      subtext: "Move the slider to set your target spend so that we can make this more accurate.",
    },
    blueprint: required ? undefined : { presentation: { allow_skip: true } },
  } as StepDefinition;
}
