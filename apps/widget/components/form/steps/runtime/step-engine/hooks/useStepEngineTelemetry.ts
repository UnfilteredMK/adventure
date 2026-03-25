import { useEffect, useRef } from "react";
import { emitTelemetry } from "@/lib/ai-form/telemetry";
import { batchIdFromIndex, normalizeBatchId } from "../utils/step-answers";
import { getStepType } from "../utils/step-answers";

type StepMeta = {
  batchId?: string | null;
  modelRequestId?: string | null;
  payloadRequest?: any | null;
  payloadResponse?: any | null;
};

export function useStepEngineDropoffTelemetry(args: {
  sessionId: string;
  currentStep: any;
  flowCompletedRef: React.MutableRefObject<boolean>;
  stepMetaRef: React.MutableRefObject<Map<string, StepMeta>>;
  isStructuralStep: (step: any) => boolean;
  isBootstrapStepIdValue: (stepId: string | null | undefined) => boolean;
  state: any;
  instanceId: string;
  formBatchIndex?: number;
}) {
  const { sessionId, currentStep, flowCompletedRef, stepMetaRef, isStructuralStep, isBootstrapStepIdValue, state, instanceId, formBatchIndex } =
    args;
  const dropoffFiredRef = useRef<Set<string>>(new Set());
  const pageLoadTimeRef = useRef<number>(Date.now());
  const isInitialMountRef = useRef<boolean>(true);

  useEffect(() => {
    if (isInitialMountRef.current) {
      pageLoadTimeRef.current = Date.now();
      isInitialMountRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!sessionId || !currentStep) return;
    const stepId = currentStep.id;
    const dropoffKey = `${sessionId}-${stepId}`;
    if (dropoffFiredRef.current.has(dropoffKey)) return;

    const handleDropoff = (e: Event) => {
      if (flowCompletedRef.current) return;
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const isFresh = params.get("fresh") === "1" || params.get("fresh") === "true";
        if (isFresh) return;
      }
      const timeSinceLoad = Date.now() - pageLoadTimeRef.current;
      if (timeSinceLoad < 10000) return;
      if (e.type === "pagehide" && (e as PageTransitionEvent).persisted) return;
      if (process.env.NODE_ENV === "development" && e.type === "beforeunload" && timeSinceLoad < 30000) return;
      if (dropoffFiredRef.current.has(dropoffKey)) return;
      dropoffFiredRef.current.add(dropoffKey);

      const meta = stepMetaRef.current.get(stepId);
      const isDeterministic = isStructuralStep(currentStep) || isBootstrapStepIdValue(stepId);
      const stepSource = isDeterministic ? "frontend_deterministic" : meta?.modelRequestId ? "backend_ai" : "unknown";
      const totalSteps = state?.steps?.length || 0;
      const stepNumber = (state?.currentStepIndex ?? 0) + 1;

      emitTelemetry(
        {
          sessionId,
          instanceId,
          eventType: "dropoff",
          stepId,
          batchId: normalizeBatchId(meta?.batchId) ?? batchIdFromIndex(formBatchIndex) ?? undefined,
          modelRequestId: meta?.modelRequestId ?? undefined,
          timestamp: Date.now(),
          payload: {
            step_number: stepNumber,
            total_steps: totalSteps,
            step_type: getStepType(currentStep),
            is_deterministic: isDeterministic,
            source: stepSource,
            step_json: currentStep,
            has_options: Array.isArray((currentStep as any)?.options),
            options_count: Array.isArray((currentStep as any)?.options) ? (currentStep as any).options.length : 0,
            question: (currentStep as any)?.question || null,
            order: stepNumber,
            request_payload: meta?.payloadRequest ?? null,
            response_payload: meta?.payloadResponse ?? null,
          },
        },
        { beacon: true }
      );
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!flowCompletedRef.current) handleDropoff(e);
    };
    const handlePageHide = (e: PageTransitionEvent) => {
      if (!e.persisted && !flowCompletedRef.current) handleDropoff(e);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [
    currentStep,
    flowCompletedRef,
    formBatchIndex,
    instanceId,
    isBootstrapStepIdValue,
    isStructuralStep,
    sessionId,
    state?.currentStepIndex,
    state?.steps?.length,
    stepMetaRef,
  ]);
}
