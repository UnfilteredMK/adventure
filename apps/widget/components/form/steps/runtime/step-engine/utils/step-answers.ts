import { DETERMINISTIC_CONSENT_ID, DETERMINISTIC_SERVICE_ID, DETERMINISTIC_STYLE_ID } from "../constants";
import { normalizeOptionalString } from "./core";

export function pickPrimaryServiceId(stepData: Record<string, any>): string | null {
  const raw =
    stepData[DETERMINISTIC_SERVICE_ID] ??
    stepData["step-service"] ??
    stepData["step_service_primary"] ??
    stepData["step_service"];
  if (Array.isArray(raw)) return normalizeOptionalString(raw[0]);
  return normalizeOptionalString(raw);
}

export function batchIdFromIndex(index?: number | null): string | null {
  if (typeof index === "number" && index >= 0) return `batch-${index + 1}`;
  return null;
}

export function normalizeBatchId(batchId: string | null | undefined): string | null {
  if (!batchId) return null;
  if (batchId === "ContextCore") return "batch-0";
  if (batchId === "PersonalGuide") return "batch-1";
  if (batchId.startsWith("Batch")) {
    const match = batchId.match(/Batch(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      return `batch-${num - 1}`;
    }
  }
  return batchId;
}

export function getStepType(step: any): string {
  if (!step || typeof step !== "object") return "unknown";
  const isUIStep = "type" in step && !("componentType" in step);
  return isUIStep ? String((step as any).type || "unknown") : String((step as any).componentType || "unknown");
}

export function getValueType(value: any): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function detectFilledOther(value: any): boolean {
  if (!value) return false;
  if (typeof value === "string") {
    const t = value.toLowerCase();
    return t === "other" || t.startsWith("other:") || t.includes("other/");
  }
  if (Array.isArray(value)) return value.some((item) => detectFilledOther(item));
  if (typeof value === "object") {
    const keys = Object.keys(value);
    const matches = ["other", "otherText", "other_text", "custom", "customValue", "custom_value"];
    if (keys.some((k) => matches.includes(k))) return true;
    const val = (value as any).value;
    if (typeof val === "string") return detectFilledOther(val);
  }
  return false;
}

export function hasMeaningfulAnswer(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function legacyAliasKeyForStepId(stepId: string): string | null {
  const id = String(stepId || "");
  if (!id.startsWith("step-")) return null;
  const core = id.slice("step-".length);
  if (!core) return null;
  return core.replace(/-/g, "_");
}

export function deterministicAnswersPresent(params: {
  steps: Array<any> | null | undefined;
  stepData: Record<string, any> | null | undefined;
}): boolean {
  const stepData = params.stepData || {};
  const steps = Array.isArray(params.steps) ? params.steps : [];
  const needsConsent = steps.some((s: any) => s?.id === DETERMINISTIC_CONSENT_ID);
  const consentOk = !needsConsent || typeof stepData[DETERMINISTIC_CONSENT_ID] === "string";
  const needsService = steps.some((s: any) => s?.id === DETERMINISTIC_SERVICE_ID);
  const serviceOk = !needsService || typeof stepData[DETERMINISTIC_SERVICE_ID] === "string";
  const needsStyle = steps.some((s: any) => s?.id === DETERMINISTIC_STYLE_ID);
  const styleOk = !needsStyle || hasMeaningfulAnswer(stepData[DETERMINISTIC_STYLE_ID]);
  return consentOk && serviceOk && styleOk;
}
