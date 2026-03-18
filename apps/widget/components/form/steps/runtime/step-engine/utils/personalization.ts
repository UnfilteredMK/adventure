import type { FormState } from "@/types/ai-form";
import { DETERMINISTIC_CONSENT_ID, DETERMINISTIC_FULL_NAME_ID, DETERMINISTIC_SERVICE_ID, DETERMINISTIC_STYLE_ID } from "../constants";
import { normalizeOptionalString } from "./core";
import { isFunctionCallStep } from "./function-calls";
import { isStructuralStep } from "./step-classification";

export function extractFirstName(fullNameRaw: unknown): string | null {
  const full = normalizeOptionalString(fullNameRaw);
  if (!full) return null;
  const first = full.split(/\s+/).filter(Boolean)[0] || "";
  return first ? first : null;
}

export function applyTemplate(text: string, vars: Record<string, string | null | undefined>): string {
  let out = String(text || "");
  for (const [k, v] of Object.entries(vars)) {
    const value = typeof v === "string" ? v : "";
    out = out.split(`{{${k}}}`).join(value);
  }
  return out;
}

export function isPersonalizableQuestionStep(step: any): boolean {
  if (!step || typeof step !== "object") return false;
  if (isStructuralStep(step)) return false;
  if (isFunctionCallStep(step)) return false;
  const id = String((step as any)?.id || "");
  if (id === DETERMINISTIC_FULL_NAME_ID) return false;
  if (id === DETERMINISTIC_CONSENT_ID || id.startsWith(DETERMINISTIC_SERVICE_ID)) return false;
  if (id === DETERMINISTIC_STYLE_ID) return false;
  return true;
}

export function personalizeStepCopy(step: any, stepData: Record<string, any> | null | undefined, formState: FormState | null) {
  if (!step || typeof step !== "object") return step;
  const fullName = normalizeOptionalString(formState?.userFullName ?? stepData?.[DETERMINISTIC_FULL_NAME_ID]) ?? null;
  const firstName = normalizeOptionalString(formState?.userFirstName ?? extractFirstName(fullName)) ?? null;
  if (!fullName && !firstName) return step;

  const vars = { firstName, fullName };

  if ("type" in (step as any) && !(step as any).componentType) {
    const s: any = step;
    const questionRaw = typeof s.question === "string" ? s.question : null;
    const humanismRaw = typeof (s as any).humanism === "string" ? (s as any).humanism : null;
    let nextQuestion = questionRaw ? applyTemplate(questionRaw, vars) : questionRaw;
    const nextHumanism = humanismRaw ? applyTemplate(humanismRaw, vars) : humanismRaw;

    if (firstName && nextQuestion && isPersonalizableQuestionStep(step) && !nextQuestion.toLowerCase().startsWith(firstName.toLowerCase())) {
      nextQuestion = `${firstName} - ${nextQuestion}`;
    }

    if (nextQuestion === questionRaw && nextHumanism === humanismRaw) return step;
    const next: any = { ...s };
    if (typeof nextQuestion === "string") next.question = nextQuestion;
    if (typeof nextHumanism === "string") (next as any).humanism = nextHumanism;
    return next;
  }

  const legacy: any = step;
  const headlineRaw = typeof legacy?.copy?.headline === "string" ? legacy.copy.headline : null;
  const subtextRaw = typeof legacy?.copy?.subtext === "string" ? legacy.copy.subtext : null;
  let nextHeadline = headlineRaw ? applyTemplate(headlineRaw, vars) : headlineRaw;
  const nextSubtext = subtextRaw ? applyTemplate(subtextRaw, vars) : subtextRaw;

  if (firstName && nextHeadline && isPersonalizableQuestionStep(step) && !nextHeadline.toLowerCase().startsWith(firstName.toLowerCase())) {
    nextHeadline = `${firstName} - ${nextHeadline}`;
  }

  if (nextHeadline === headlineRaw && nextSubtext === subtextRaw) return step;
  return {
    ...legacy,
    copy: {
      ...(legacy.copy || {}),
      ...(typeof nextHeadline === "string" ? { headline: nextHeadline } : {}),
      ...(typeof nextSubtext === "string" ? { subtext: nextSubtext } : {}),
    },
  };
}
