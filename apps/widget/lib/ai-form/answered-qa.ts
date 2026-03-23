import type { StepDefinition, UIStep } from "@/types/ai-form";

type StepLike = StepDefinition | UIStep | null | undefined;

const ANSWERED_QA_EXCLUDED_STEP_IDS = new Set<string>([
  "step-budget-range",
  "step-promptInput",
  "step-pricing",
  "step-pricing-accuracy-consent",
  "step-confirmation",
  "step-designer",
  "step-refinement-upload-scene-image",
]);

export interface AnsweredQAItem {
  stepId: string;
  question: string;
  answer: any;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getQuestionTextFromStep(step: StepLike): string | null {
  if (!step) return null;
  const asUIStep = step as UIStep;
  const asDefinition = step as StepDefinition;
  const candidates = [
    normalizeText(asUIStep.question),
    normalizeText((asUIStep as any)?.intent ?? ""),
    normalizeText((asDefinition as any)?.intent ?? ""),
    normalizeText(asDefinition.copy?.headline ?? ""),
    normalizeText(asDefinition.copy?.subtext ?? ""),
    normalizeText(asDefinition.copy?.helper ?? ""),
    normalizeText(asDefinition.content?.prompt ?? ""),
    normalizeText(asDefinition.content?.helperText ?? ""),
  ];
  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  return step.id || null;
}

function isNonEmptyAnswer(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function shouldExcludeStepFromAnsweredQA(stepId: unknown): boolean {
  const normalized = String(stepId || "").trim();
  if (!normalized) return true;
  if (normalized.startsWith("__")) return true;
  if (ANSWERED_QA_EXCLUDED_STEP_IDS.has(normalized)) return true;
  if (normalized.startsWith("step-upload-")) return true;
  if (normalized.startsWith("step-lead")) return true;
  return false;
}

export function buildAnsweredQAFromSteps(
  steps: Array<StepDefinition | UIStep | null | undefined> | undefined,
  stepDataSoFar: Record<string, any>,
  max = 60
): AnsweredQAItem[] {
  const questionLookup = new Map<string, string>();
  for (const step of steps || []) {
    const id = step?.id;
    if (!id) continue;
    const question = getQuestionTextFromStep(step);
    if (question) {
      questionLookup.set(id, question);
    }
  }

  const keys = Object.keys(stepDataSoFar || {})
    .filter((k) => typeof k === "string" && k && !shouldExcludeStepFromAnsweredQA(k))
    .sort();

  const answeredQA: AnsweredQAItem[] = [];
  for (const stepId of keys) {
    const answer = stepDataSoFar[stepId];
    if (!isNonEmptyAnswer(answer)) continue;
    const question = questionLookup.get(stepId) ?? stepId;
    answeredQA.push({ stepId, question, answer });
    if (answeredQA.length >= max) break;
  }

  return answeredQA;
}
