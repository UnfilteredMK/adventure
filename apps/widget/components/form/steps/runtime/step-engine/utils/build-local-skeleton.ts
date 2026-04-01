import type { StepDefinition, UIStep } from "@/types/ai-form";
import { buildDeterministicStyleStep } from "../../../static/deterministic-style-step";
import { buildDeterministicBudgetStep, buildDeterministicUploadSteps } from "./deterministic-adventure-steps";

export const LOCAL_SKELETON_FLOW_MODE = "local_skeleton";
export const LOCAL_SKELETON_VERSION = "local-skeleton-v5";
export const LOCAL_SCOPE_STEP_ID = "step-project-scope";
/** Refinement checklist when both DB scope presets and components exist (second scope step). */
export const LOCAL_PARTS_STEP_ID = "step-project-parts";

export type LocalSkeletonServiceOption = {
  value?: string | null;
  label?: string | null;
  serviceName?: string | null;
  serviceSummary?: string | null;
  /** Preset strings from categories_subcategories.subcategory_scope (first scope question). */
  subcategoryScope?: string[] | null;
  subcategoryComponents?: Array<{ key?: string | null; label?: string | null; priority?: number | null }>;
  styleQuestion?: string | null;
  styleOptions?: Array<{
    label?: string | null;
    value?: string | null;
    imageUrl?: string | null;
    description?: string | null;
  }>;
};

function normalizeSubcategoryScopeStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const s = typeof x === "string" ? x.trim() : "";
    if (s.length < 1) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.slice(0, 200));
    if (out.length >= 12) break;
  }
  return out;
}

function scopePresetValue(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || `scope_${index}`;
}

type ChoiceOpt = { label: string; value: string };

function stepHasOtherOption(opts: ChoiceOpt[]): boolean {
  return opts.some((o) => {
    const v = String(o?.value || "").toLowerCase();
    const l = String(o?.label || "").toLowerCase();
    return v === "other" || l === "other";
  });
}

/** Matches generate-steps `sanitizeMiniStep`: append Other when there is room and it is not already listed. */
function withOtherChoiceOption(opts: ChoiceOpt[]): ChoiceOpt[] {
  if (opts.length === 0 || opts.length >= 12 || stepHasOtherOption(opts)) return opts;
  return [...opts, { label: "Other", value: "other" }];
}

function normalizeServiceLabel(serviceOption: LocalSkeletonServiceOption | null | undefined): string {
  const label =
    typeof serviceOption?.label === "string" && serviceOption.label.trim()
      ? serviceOption.label.trim()
      : typeof serviceOption?.serviceName === "string" && serviceOption.serviceName.trim()
        ? serviceOption.serviceName.trim()
        : "project";
  return label;
}

/** Placeholder labels from API fallbacks — using them in "your X project?" reads as broken copy ("service project"). */
function isGenericServiceLabel(label: string): boolean {
  const s = label.trim().toLowerCase();
  return !s || s === "service" || s === "project";
}

export function resolveSelectedServiceOption(
  serviceOptions: LocalSkeletonServiceOption[],
  selectedServiceId?: string | null,
): LocalSkeletonServiceOption | null {
  const normalizedId = typeof selectedServiceId === "string" ? selectedServiceId.trim() : "";
  if (normalizedId) {
    const direct = serviceOptions.find((option) => String(option?.value || "").trim() === normalizedId);
    if (direct) return direct;
  }
  return serviceOptions.length === 1 ? serviceOptions[0] : null;
}

export function buildServiceSelectionStep(serviceOptions: LocalSkeletonServiceOption[]): UIStep | null {
  if (!Array.isArray(serviceOptions) || serviceOptions.length <= 1) return null;
  return {
    id: "step-service-primary",
    type: "multiple_choice",
    question: "What service are you interested in?",
    humanism: "Choose one to get started.",
    options: serviceOptions.slice(0, 40).map((option) => ({
      label: String(option?.label || option?.serviceName || "Service"),
      value: String(option?.value || ""),
    })),
    multi_select: false,
    columns: 2,
    variant: "cards",
    metricGain: 0.08,
    blueprint: { presentation: { auto_advance: true, continue_label: "Continue" } },
  } as UIStep;
}

function normalizeComponents(serviceOption: LocalSkeletonServiceOption | null | undefined) {
  return Array.isArray(serviceOption?.subcategoryComponents)
    ? serviceOption.subcategoryComponents
        .map((component) => ({
          key: String(component?.key || "").trim(),
          label: String(component?.label || component?.key || "").trim(),
          priority: Number(component?.priority ?? 0),
        }))
        .filter((component) => component.key && component.label)
        .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))
    : [];
}

function buildPresetScopeStep(
  serviceOption: LocalSkeletonServiceOption | null | undefined,
  presets: string[],
): UIStep {
  const serviceLabel = normalizeServiceLabel(serviceOption);
  const scopeQuestion = isGenericServiceLabel(serviceLabel)
    ? "What's the scope of this project?"
    : `What kind of ${serviceLabel.toLowerCase()} project is this?`;
  const presetOptions = withOtherChoiceOption(
    presets.map((label, i) => ({
      label,
      value: scopePresetValue(label, i),
    })),
  );
  return {
    id: LOCAL_SCOPE_STEP_ID,
    type: "multiple_choice",
    question: scopeQuestion,
    humanism: "Pick the option that fits best.",
    options: presetOptions,
    multi_select: false,
    columns: presetOptions.length > 4 ? 1 : 2,
    variant: "cards",
    metricGain: 0.14,
    blueprint: { presentation: { auto_advance: true, continue_label: "Continue" } },
  } as UIStep;
}

function buildPartsScopeStep(
  serviceOption: LocalSkeletonServiceOption | null | undefined,
  components: ReturnType<typeof normalizeComponents>,
  usePartsOnlyStepId: boolean,
): UIStep {
  const serviceLabel = normalizeServiceLabel(serviceOption);
  const scopeQuestion = isGenericServiceLabel(serviceLabel)
    ? "Which parts of this project should we focus on?"
    : `What parts of your ${serviceLabel.toLowerCase()} are in scope?`;
  const partOptions = withOtherChoiceOption(
    components.slice(0, 12).map((component) => ({
      label: component.label,
      value: component.key,
    })),
  );
  return {
    id: usePartsOnlyStepId ? LOCAL_SCOPE_STEP_ID : LOCAL_PARTS_STEP_ID,
    type: partOptions.length > 6 ? "chips_multi" : "multiple_choice",
    question: scopeQuestion,
    humanism: "Select everything you'd like us to focus on.",
    options: partOptions,
    multi_select: true,
    min_selections: 1,
    columns: partOptions.length > 6 ? 1 : 2,
    metricGain: 0.14,
    blueprint: { presentation: { continue_label: "Continue" } },
  } as UIStep;
}

function buildGenericExtentStep(serviceOption: LocalSkeletonServiceOption | null | undefined): UIStep {
  const serviceLabel = normalizeServiceLabel(serviceOption);
  const scaleQuestion = isGenericServiceLabel(serviceLabel)
    ? "How extensive is this project?"
    : `How big is your ${serviceLabel.toLowerCase()} project?`;

  return {
    id: LOCAL_SCOPE_STEP_ID,
    type: "multiple_choice",
    question: scaleQuestion,
    humanism: "Pick the option that feels closest.",
    options: withOtherChoiceOption([
      { label: "A quick refresh", value: "refresh" },
      { label: "A focused update", value: "partial_update" },
      { label: "A full transformation", value: "full_project" },
    ]),
    multi_select: false,
    columns: 1,
    variant: "cards",
    metricGain: 0.14,
    blueprint: { presentation: { auto_advance: true, continue_label: "Continue" } },
  } as UIStep;
}

/**
 * Deterministic scope steps for local skeleton: DB `subcategory_scope` first (when set),
 * then refinement `subcategory_components`, else generic extent.
 * When both presets and components exist, presets use step-project-scope and parts use step-project-parts.
 */
export function buildLocalScopeSteps(serviceOption: LocalSkeletonServiceOption | null | undefined): UIStep[] {
  const presets = normalizeSubcategoryScopeStrings(serviceOption?.subcategoryScope);
  const components = normalizeComponents(serviceOption);
  const steps: UIStep[] = [];

  if (presets.length > 0) {
    steps.push(buildPresetScopeStep(serviceOption, presets));
  }

  if (components.length > 0) {
    steps.push(buildPartsScopeStep(serviceOption, components, presets.length === 0));
  }

  if (presets.length === 0 && components.length === 0) {
    steps.push(buildGenericExtentStep(serviceOption));
  }

  return steps;
}

/** @deprecated Prefer buildLocalScopeSteps — this returns only the first scope step (legacy). */
export function buildLocalScopeStep(serviceOption: LocalSkeletonServiceOption | null | undefined): UIStep {
  const steps = buildLocalScopeSteps(serviceOption);
  return steps[0] ?? buildGenericExtentStep(serviceOption);
}

export function buildLocalPostServiceSteps(serviceOption: LocalSkeletonServiceOption | null | undefined): Array<StepDefinition | UIStep> {
  return buildLocalPostServiceStepsWithConfig({ serviceOption });
}

export function buildLocalPostServiceStepsWithConfig(params: {
  serviceOption: LocalSkeletonServiceOption | null | undefined;
  useCase?: string | null;
  previewPricing?: any;
}): Array<StepDefinition | UIStep> {
  const { serviceOption, useCase, previewPricing } = params;
  if (!serviceOption) return [];
  const scopeSteps = buildLocalScopeSteps(serviceOption);
  const styleStep = buildDeterministicStyleStep(serviceOption);
  const budgetStep = buildDeterministicBudgetStep({
    config: { previewPricing },
    useCase,
  });
  const uploadSteps = buildDeterministicUploadSteps(useCase);
  return styleStep ? [...scopeSteps, styleStep, budgetStep, ...uploadSteps] : [...scopeSteps, budgetStep, ...uploadSteps];
}

export function buildLocalSkeletonFlow(params: {
  serviceOptions: LocalSkeletonServiceOption[];
  selectedServiceId?: string | null;
  useCase?: string | null;
  previewPricing?: any;
}): Array<StepDefinition | UIStep> {
  const { serviceOptions, selectedServiceId, useCase, previewPricing } = params;
  const steps: Array<StepDefinition | UIStep> = [];
  const serviceStep = buildServiceSelectionStep(serviceOptions);
  if (serviceStep) steps.push(serviceStep);
  const selectedService = resolveSelectedServiceOption(serviceOptions, selectedServiceId);
  if (selectedService) {
    steps.push(
      ...buildLocalPostServiceStepsWithConfig({
        serviceOption: selectedService,
        useCase,
        previewPricing,
      }),
    );
  }
  return steps;
}
