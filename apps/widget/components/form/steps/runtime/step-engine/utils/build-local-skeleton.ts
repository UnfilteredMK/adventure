import type { StepDefinition, UIStep } from "@/types/ai-form";
import { buildDeterministicStyleStep } from "../../../static/deterministic-style-step";

export const LOCAL_SKELETON_FLOW_MODE = "local_skeleton";
export const LOCAL_SKELETON_VERSION = "local-skeleton-v1";
export const LOCAL_SCOPE_STEP_ID = "step-project-scope";

export type LocalSkeletonServiceOption = {
  value?: string | null;
  label?: string | null;
  serviceName?: string | null;
  serviceSummary?: string | null;
  subcategoryComponents?: Array<{ key?: string | null; label?: string | null; priority?: number | null }>;
  styleQuestion?: string | null;
  styleOptions?: Array<{
    label?: string | null;
    value?: string | null;
    imageUrl?: string | null;
    description?: string | null;
  }>;
};

function normalizeServiceLabel(serviceOption: LocalSkeletonServiceOption | null | undefined): string {
  const label =
    typeof serviceOption?.label === "string" && serviceOption.label.trim()
      ? serviceOption.label.trim()
      : typeof serviceOption?.serviceName === "string" && serviceOption.serviceName.trim()
        ? serviceOption.serviceName.trim()
        : "project";
  return label;
}

export function resolveSelectedServiceOption(
  serviceOptions: LocalSkeletonServiceOption[],
  selectedServiceId?: string | null
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

export function buildLocalScopeStep(serviceOption: LocalSkeletonServiceOption | null | undefined): UIStep {
  const serviceLabel = normalizeServiceLabel(serviceOption);
  const components = Array.isArray(serviceOption?.subcategoryComponents)
    ? serviceOption.subcategoryComponents
        .map((component) => ({
          key: String(component?.key || "").trim(),
          label: String(component?.label || component?.key || "").trim(),
          priority: Number(component?.priority ?? 0),
        }))
        .filter((component) => component.key && component.label)
        .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))
    : [];

  if (components.length > 0) {
    return {
      id: LOCAL_SCOPE_STEP_ID,
      type: components.length > 6 ? "chips_multi" : "multiple_choice",
      question: `What parts of your ${serviceLabel.toLowerCase()} are in scope?`,
      humanism: "Select everything you'd like us to focus on.",
      options: components.slice(0, 12).map((component) => ({
        label: component.label,
        value: component.key,
      })),
      multi_select: true,
      min_selections: 1,
      columns: components.length > 6 ? 1 : 2,
      metricGain: 0.14,
      blueprint: { presentation: { continue_label: "Continue" } },
    } as UIStep;
  }

  return {
    id: LOCAL_SCOPE_STEP_ID,
    type: "multiple_choice",
    question: `How big is your ${serviceLabel.toLowerCase()} project?`,
    humanism: "Pick the option that feels closest.",
    options: [
      { label: "A quick refresh", value: "refresh" },
      { label: "A focused update", value: "partial_update" },
      { label: "A full transformation", value: "full_project" },
    ],
    multi_select: false,
    columns: 1,
    variant: "cards",
    metricGain: 0.14,
    blueprint: { presentation: { auto_advance: true, continue_label: "Continue" } },
  } as UIStep;
}

export function buildLocalPostServiceSteps(serviceOption: LocalSkeletonServiceOption | null | undefined): Array<StepDefinition | UIStep> {
  if (!serviceOption) return [];
  const scopeStep = buildLocalScopeStep(serviceOption);
  const styleStep = buildDeterministicStyleStep(serviceOption);
  return styleStep ? [scopeStep, styleStep] : [scopeStep];
}

export function buildLocalSkeletonFlow(params: {
  serviceOptions: LocalSkeletonServiceOption[];
  selectedServiceId?: string | null;
}): Array<StepDefinition | UIStep> {
  const { serviceOptions, selectedServiceId } = params;
  const steps: Array<StepDefinition | UIStep> = [];
  const serviceStep = buildServiceSelectionStep(serviceOptions);
  if (serviceStep) steps.push(serviceStep);
  const selectedService = resolveSelectedServiceOption(serviceOptions, selectedServiceId);
  if (selectedService) {
    steps.push(...buildLocalPostServiceSteps(selectedService));
  }
  return steps;
}
