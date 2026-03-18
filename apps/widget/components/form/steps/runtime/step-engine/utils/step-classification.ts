import { DETERMINISTIC_CONSENT_ID, DETERMINISTIC_SERVICE_ID, DETERMINISTIC_STYLE_ID } from "../constants";
import { isFunctionCallStep } from "./function-calls";

export function isStructuralStep(step: any): boolean {
  const structuralTypes = ["upload", "gallery", "lead_capture", "pricing", "confirmation"];
  const stepType = "type" in step ? step.type : undefined;
  const componentType =
    "componentType" in step
      ? step.componentType
      : stepType === "file_upload" || stepType === "upload"
        ? "upload"
        : stepType === "gallery"
            ? "gallery"
            : stepType === "lead_capture"
              ? "lead_capture"
              : stepType === "pricing"
                ? "pricing"
                : stepType === "confirmation"
                  ? "confirmation"
                  : "text";
  return structuralTypes.includes(componentType);
}

export function isQuestionStepForAskedIds(step: any): boolean {
  if (!step || typeof step !== "object") return false;
  const stepId = String((step as any)?.id || "").trim();
  const stepType = String((step as any)?.type || "").trim().toLowerCase();
  if (stepId === "step-promptInput" || stepType === "prompt_input") return false;
  if (isStructuralStep(step)) return false;
  if (isFunctionCallStep(step)) return false;
  return true;
}

export function isPreviewGateQuestionStep(step: any): boolean {
  if (!isQuestionStepForAskedIds(step)) return false;
  const stepId = String((step as any)?.id || "");
  if (stepId.startsWith(DETERMINISTIC_SERVICE_ID)) return false;
  if (stepId === DETERMINISTIC_CONSENT_ID) return false;
  if (stepId === DETERMINISTIC_STYLE_ID) return false;
  return true;
}

export function countPreviewGateQuestions(steps: any[]): number {
  const seen = new Set<string>();
  let count = 0;
  for (const step of steps || []) {
    if (!step || typeof step !== "object") continue;
    const stepId = String((step as any)?.id || "");
    if (!stepId) continue;
    if (seen.has(stepId)) continue;
    seen.add(stepId);
    if (isPreviewGateQuestionStep(step)) count += 1;
  }
  return count;
}
