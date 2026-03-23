import { DETERMINISTIC_FULL_NAME_ID } from "../constants";
import { shouldExcludeStepFromAnsweredQA } from "@/lib/ai-form/answered-qa";
import { clamp01 } from "./core";
import { isFunctionCallStep } from "./function-calls";

export function safeStableJsonForPricingContext(stepData: Record<string, any>) {
  const excluded = new Set<string>([
    "step-upload-scene-image",
    "step-upload-user-image",
    "step-upload-product-image",
    "step-designer",
    "step-lead-capture",
    "step-lead-name",
    "step-lead-phone",
    "step-pricing",
    "step-confirmation",
    DETERMINISTIC_FULL_NAME_ID,
  ]);
  const keys = Object.keys(stepData || {})
    .filter((k) => typeof k === "string" && k && !k.startsWith("__") && !excluded.has(k))
    .sort();
  const snapshot: Record<string, any> = {};
  for (const k of keys) snapshot[k] = stepData[k];
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(snapshot, (_key, value) => {
      if (typeof value === "function") return undefined;
      if (typeof value === "bigint") return value.toString();
      if (value && typeof value === "object") {
        if (seen.has(value as object)) return "[Circular]";
        seen.add(value as object);
        const v: any = value;
        if (typeof v?.name === "string" && typeof v?.size === "number" && typeof v?.type === "string") {
          return { name: v.name, size: v.size, type: v.type };
        }
      }
      return value;
    });
  } catch {
    try {
      return JSON.stringify({ keys });
    } catch {
      return "{}";
    }
  }
}

export function getMetricGain(step: any): number {
  const raw = (step as any)?.metric_gain ?? (step as any)?.expected_metric_gain ?? (step as any)?.importance_weight ?? 0.12;
  const n = Number(raw);
  return clamp01(Number.isFinite(n) ? n : 0.12);
}

export function buildAnsweredQA(params: { steps: any[]; stepData: Record<string, any>; max?: number }) {
  const { steps, stepData, max = 40 } = params;
  const qa: Array<{ stepId: string; question: string; answer: any }> = [];
  for (const step of steps || []) {
    if (isFunctionCallStep(step)) continue;
    const stepId = (step as any)?.id;
    if (!stepId || typeof stepId !== "string") continue;
    if (shouldExcludeStepFromAnsweredQA(stepId)) continue;
    const answer = stepData?.[stepId];
    if (answer === null || answer === undefined) continue;
    if (typeof answer === "string" && answer.trim().length === 0) continue;
    if (Array.isArray(answer) && answer.length === 0) continue;
    if (typeof answer === "object" && !Array.isArray(answer) && Object.keys(answer).length === 0) continue;

    const question = (step as any)?.question ?? (step as any)?.content?.prompt ?? (step as any)?.copy?.headline ?? String(stepId);
    qa.push({ stepId, question: String(question || stepId), answer });
    if (qa.length >= max) break;
  }
  return qa;
}
