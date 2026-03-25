// Step state persistence and hydration

import { StepState } from '@/types/ai-form';

const STORAGE_PREFIX = 'ai_form_state_';
const SESSION_STORAGE_PREFIX = 'ai_form_state_session_';
const MAX_STORED_ARRAY_ITEMS = 24;
const MAX_STORED_OBJECT_KEYS = 40;
const MAX_STORED_STRING_LENGTH = 4000;

function compactString(value: string): string | null {
  const trimmed = String(value || "");
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("data:")) return null;
  if (trimmed.length <= MAX_STORED_STRING_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_STORED_STRING_LENGTH)}...[truncated]`;
}

function compactValue(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return compactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_STORED_ARRAY_ITEMS)
      .map((item) => compactValue(item))
      .filter((item) => item !== null && item !== undefined);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, MAX_STORED_OBJECT_KEYS);
    const next: Record<string, any> = {};
    for (const [key, entryValue] of entries) {
      if (typeof entryValue === "function") continue;
      const compacted = compactValue(entryValue);
      if (compacted === undefined) continue;
      next[key] = compacted;
    }
    return next;
  }
  return undefined;
}

function compactStepForStorage(step: any): any {
  if (!step || typeof step !== "object") return step;
  const next = compactValue(step) || {};
  if (next.__telemetry && typeof next.__telemetry === "object") {
    next.__telemetry = {
      batchId: next.__telemetry.batchId ?? null,
      modelRequestId: next.__telemetry.modelRequestId ?? null,
    };
  }
  next.skipCondition = undefined;
  return next;
}

function buildSerializedState(state: StepState, aggressive: boolean): Record<string, any> {
  const compactedStepData = compactValue(state.stepData) || {};
  const compactedSteps = state.steps.map((step) => compactStepForStorage(step));
  return {
    ...state,
    completedSteps: Array.from(state.completedSteps),
    stepData: compactedStepData,
    steps: aggressive
      ? compactedSteps.map((step) => ({
          id: step?.id,
          type: step?.type,
          componentType: step?.componentType,
          intent: step?.intent,
          question: step?.question,
          humanism: step?.humanism,
          copy: step?.copy,
          data: step?.data,
          content: step?.content,
          options: step?.options,
          blueprint: step?.blueprint,
          variant: step?.variant,
          columns: step?.columns,
          multi_select: step?.multi_select,
          min_selections: step?.min_selections,
          max_selections: step?.max_selections,
          __refinementStep: step?.__refinementStep,
          __refinementUploadStep: step?.__refinementUploadStep,
        }))
      : compactedSteps,
  };
}

function buildMinimalSerializedState(state: StepState): Record<string, any> {
  const currentStep = state.steps[state.currentStepIndex] || null;
  return {
    currentStepIndex: Number.isFinite(state.currentStepIndex) ? state.currentStepIndex : 0,
    sessionId: state.sessionId,
    skeletonVersion: (state as any).skeletonVersion ?? null,
    completedSteps: Array.from(state.completedSteps || []),
    stepData: compactValue(state.stepData) || {},
    steps: currentStep
      ? [
          {
            id: (currentStep as any)?.id ?? null,
            type: (currentStep as any)?.type ?? null,
            componentType: (currentStep as any)?.componentType ?? null,
            question: (currentStep as any)?.question ?? null,
            humanism: (currentStep as any)?.humanism ?? null,
            options: compactValue((currentStep as any)?.options) || [],
            copy: compactValue((currentStep as any)?.copy) || undefined,
            data: compactValue((currentStep as any)?.data) || undefined,
            blueprint: compactValue((currentStep as any)?.blueprint) || undefined,
          },
        ]
      : [],
  };
}

function getLocalStorageKey(instanceId: string): string {
  return `${STORAGE_PREFIX}${instanceId}`;
}

function getSessionStorageKey(instanceId: string): string {
  return `${SESSION_STORAGE_PREFIX}${instanceId}`;
}

export function saveStepState(instanceId: string, state: StepState): void {
  const key = getLocalStorageKey(instanceId);
  const sessionKey = getSessionStorageKey(instanceId);
  try {
    localStorage.setItem(key, JSON.stringify(buildSerializedState(state, false)));
    try {
      sessionStorage.removeItem(sessionKey);
    } catch {}
  } catch {
    try {
      localStorage.setItem(key, JSON.stringify(buildSerializedState(state, true)));
      console.warn('Saved compacted step state after quota pressure');
      return;
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {}
      try {
        localStorage.setItem(key, JSON.stringify(buildMinimalSerializedState(state)));
        console.warn('Saved minimal step state after clearing oversized local copy');
        return;
      } catch {
        try {
          sessionStorage.setItem(sessionKey, JSON.stringify(buildSerializedState(state, true)));
          console.warn('Saved compacted step state to sessionStorage after localStorage quota pressure');
          return;
        } catch {
          try {
            sessionStorage.setItem(sessionKey, JSON.stringify(buildMinimalSerializedState(state)));
            console.warn('Saved minimal step state to sessionStorage after quota pressure');
            return;
          } catch (finalError) {
            console.error('Failed to save step state:', finalError);
          }
        }
      }
    }
  }
}

export function loadStepState(instanceId: string): StepState | null {
  try {
    const key = getLocalStorageKey(instanceId);
    const sessionKey = getSessionStorageKey(instanceId);
    const stored = localStorage.getItem(key) ?? sessionStorage.getItem(sessionKey);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    return {
      ...parsed,
      completedSteps: new Set(parsed.completedSteps || []),
      steps: parsed.steps || []
    };
  } catch (error) {
    console.error('Failed to load step state:', error);
    return null;
  }
}

export function clearStepState(instanceId: string): void {
  try {
    const key = getLocalStorageKey(instanceId);
    const sessionKey = getSessionStorageKey(instanceId);
    localStorage.removeItem(key);
    sessionStorage.removeItem(sessionKey);
  } catch (error) {
    console.error('Failed to clear step state:', error);
  }
}

export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
