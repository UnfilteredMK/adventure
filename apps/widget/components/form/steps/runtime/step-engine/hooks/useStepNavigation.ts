import { useCallback } from "react";
import { emitTelemetry } from "@/lib/ai-form/telemetry";
import { batchIdFromIndex, normalizeBatchId } from "../utils/step-answers";
import { getStepType } from "../utils/step-answers";

type StepMeta = {
  batchId?: string | null;
  modelRequestId?: string | null;
  payloadRequest?: any | null;
  payloadResponse?: any | null;
};

export function useStepNavigation(args: {
  state: any;
  currentStep: any;
  sessionId: string;
  instanceId: string;
  formBatchIndex?: number;
  stepMetaRef: React.MutableRefObject<Map<string, StepMeta>>;
  isBootstrapStepIdValue: (stepId: string | null | undefined) => boolean;
  isStructuralStep: (step: any) => boolean;
  goToPreviousStep: () => Promise<void> | void;
  goToStep: (stepIndex: number) => void;
  setAdventureInputMode: (mode: "questions" | "prompt" | "budget" | "uploads") => void;
}) {
  const {
    state,
    currentStep,
    sessionId,
    instanceId,
    formBatchIndex,
    stepMetaRef,
    isBootstrapStepIdValue,
    isStructuralStep,
    goToPreviousStep,
    goToStep,
    setAdventureInputMode,
  } = args;

  const handleBack = useCallback(async () => {
    setAdventureInputMode("questions");
    if (!state || !currentStep) {
      await goToPreviousStep();
      return;
    }
    const fromIndex = state.currentStepIndex;
    const toIndex = Math.max(0, fromIndex - 1);
    const toStep = state.steps[toIndex];
    if (sessionId && toStep) {
      const toStepId = (toStep as any).id;
      const meta = stepMetaRef.current.get(toStepId);
      const isDeterministic = isStructuralStep(toStep) || isBootstrapStepIdValue(toStepId);
      const stepSource = isDeterministic ? "frontend_deterministic" : meta?.modelRequestId ? "backend_ai" : "unknown";
      const totalSteps = state?.steps?.length || 0;
      const requestPayload = meta?.payloadRequest ?? null;
      const responsePayload = meta?.payloadResponse ?? null;

      emitTelemetry({
        sessionId,
        instanceId,
        eventType: "step_backtracked",
        stepId: toStepId,
        batchId: normalizeBatchId(meta?.batchId) ?? batchIdFromIndex(formBatchIndex) ?? undefined,
        modelRequestId: meta?.modelRequestId ?? undefined,
        timestamp: Date.now(),
        payload: {
          step_number: toIndex + 1,
          total_steps: totalSteps,
          step_type: getStepType(toStep),
          is_deterministic: isDeterministic,
          source: stepSource,
          step_json: toStep,
          from_step_id: currentStep.id,
          to_step_id: toStepId,
          from_order: fromIndex + 1,
          to_order: toIndex + 1,
          request_payload: requestPayload,
          response_payload: responsePayload,
        },
      });
    }
    await goToPreviousStep();
  }, [
    currentStep,
    formBatchIndex,
    goToPreviousStep,
    instanceId,
    isBootstrapStepIdValue,
    isStructuralStep,
    sessionId,
    setAdventureInputMode,
    state,
    stepMetaRef,
  ]);

  const handleNavigateToStep = useCallback(
    (stepIndex: number) => {
      if (!state) return;
      if (stepIndex < state.currentStepIndex) {
        setAdventureInputMode("questions");
      }
      if (sessionId && stepIndex < state.currentStepIndex) {
        const fromStep = state.steps[state.currentStepIndex];
        const toStep = state.steps[stepIndex];
        if (fromStep && toStep) {
          const toStepId = (toStep as any).id;
          const meta = stepMetaRef.current.get(toStepId);
          const isDeterministic = isStructuralStep(toStep) || isBootstrapStepIdValue(toStepId);
          const stepSource = isDeterministic ? "frontend_deterministic" : meta?.modelRequestId ? "backend_ai" : "unknown";
          const totalSteps = state?.steps?.length || 0;

          emitTelemetry({
            sessionId,
            instanceId,
            eventType: "step_backtracked",
            stepId: toStepId,
            batchId: normalizeBatchId(meta?.batchId) ?? batchIdFromIndex(formBatchIndex) ?? undefined,
            modelRequestId: meta?.modelRequestId ?? undefined,
            timestamp: Date.now(),
            payload: {
              step_number: stepIndex + 1,
              total_steps: totalSteps,
              step_type: getStepType(toStep),
              is_deterministic: isDeterministic,
              source: stepSource,
              step_json: toStep,
              from_step_id: (fromStep as any).id,
              to_step_id: toStepId,
              from_order: state.currentStepIndex + 1,
              to_order: stepIndex + 1,
            },
          });
        }
      }
      goToStep(stepIndex);
    },
    [formBatchIndex, goToStep, instanceId, isBootstrapStepIdValue, isStructuralStep, sessionId, setAdventureInputMode, state, stepMetaRef]
  );

  return { handleBack, handleNavigateToStep };
}
