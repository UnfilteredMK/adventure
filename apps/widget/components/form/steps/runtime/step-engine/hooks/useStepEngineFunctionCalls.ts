import { useEffect } from "react";
import { emitTelemetry } from "@/lib/ai-form/telemetry";
import {
  extractCompositeBlockCalls,
  getFunctionCallOutputs,
  getMinTriggerCount,
  getTriggerProgress,
  isFunctionCallStep,
  type FunctionCallHint,
  type FunctionCallOutput,
} from "../utils/function-calls";
import { batchIdFromIndex, getStepType, normalizeBatchId } from "../utils/step-answers";
import { isBootstrapStepIdValue, isStructuralStep } from "../utils/step-classification";

type StepMeta = {
  batchId?: string | null;
  modelRequestId?: string | null;
  payloadRequest?: any | null;
  payloadResponse?: any | null;
};

export function useStepEngineFunctionCalls(args: {
  state: any;
  instanceId: string;
  flowPlanSessionId?: string;
  config: any;
  updateStepData: (stepId: string, data: any) => void;
  functionCallOutputsRef: React.MutableRefObject<Record<string, FunctionCallOutput>>;
  functionCallInFlightRef: React.MutableRefObject<Set<string>>;
  sessionId: string;
  prevIndexRef: React.MutableRefObject<number | null>;
  stepMetaRef: React.MutableRefObject<Map<string, StepMeta>>;
  formBatchIndex?: number;
}) {
  const {
    state,
    instanceId,
    flowPlanSessionId,
    config,
    updateStepData,
    functionCallOutputsRef,
    functionCallInFlightRef,
    sessionId,
    prevIndexRef,
    stepMetaRef,
    formBatchIndex,
  } = args;

  useEffect(() => {
    functionCallOutputsRef.current = getFunctionCallOutputs(state?.stepData || {});
  }, [functionCallOutputsRef, state?.stepData]);

  useEffect(() => {
    if (!state || !instanceId) return;
    if (process.env.NEXT_PUBLIC_ENABLE_AI_FORM_FUNCTION_CALLS !== "true") return;

    const steps = state.steps || [];
    const stepData = state.stepData || {};
    const outputs = functionCallOutputsRef.current || {};
    const candidates: Array<{ callKey: string; functionCall: FunctionCallHint }> = [];
    for (const s of steps) {
      const stepId = (s as any)?.id;
      const blockCalls = extractCompositeBlockCalls(s);
      if (blockCalls.length > 0) {
        for (const call of blockCalls) {
          const callKey = String(call.callKey || "");
          if (!callKey) continue;
          candidates.push({ callKey, functionCall: call.functionCall });
        }
      } else if (stepId && isFunctionCallStep(s)) {
        candidates.push({ callKey: String(stepId), functionCall: (s as any).functionCall as FunctionCallHint });
      }
    }
    if (candidates.length === 0) return;

    const commitOutput = (stepId: string, next: FunctionCallOutput) => {
      const merged = { ...functionCallOutputsRef.current, [stepId]: next };
      functionCallOutputsRef.current = merged;
      updateStepData("__functionCallOutputs", merged);
    };

    const run = async (callKey: string, functionCall: FunctionCallHint) => {
      const startedAt = Date.now();
      const triggerKeys = Array.isArray(functionCall?.triggerAfterStepKeys) ? functionCall.triggerAfterStepKeys : [];
      const { satisfied, total } = getTriggerProgress(state.stepData || {}, triggerKeys);
      const minCount = getMinTriggerCount(functionCall, triggerKeys);
      try {
        const readyToRun = total === 0 ? true : satisfied >= minCount;
        if (!readyToRun) {
          const existing = functionCallOutputsRef.current?.[callKey] ?? null;
          commitOutput(callKey, {
            status: existing?.status === "complete" ? "complete" : "idle",
            functionCall,
            triggerSatisfiedCount: satisfied,
            triggerTotalCount: total,
            triggerMinCount: minCount,
            startedAt: existing?.startedAt ?? null,
            completedAt: existing?.completedAt ?? null,
            error: existing?.error ?? null,
            result: existing?.result ?? null,
          });
          return;
        }

        functionCallInFlightRef.current.add(callKey);
        commitOutput(callKey, {
          status: "running",
          functionCall,
          triggerSatisfiedCount: satisfied,
          triggerTotalCount: total,
          triggerMinCount: minCount,
          startedAt,
          completedAt: null,
          error: null,
          result: null,
        });

        const resp = await fetch(`/api/ai-form/${encodeURIComponent(instanceId)}/execute-function`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            sessionId: flowPlanSessionId,
            stepId: callKey,
            functionCall,
            stepDataSoFar: state.stepData || {},
            existingStepIds: steps.map((s: any) => s?.id).filter(Boolean),
            useCase: config?.useCase,
            config,
          }),
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          const message = typeof (json as any)?.error === "string" ? (json as any).error : `Function execution failed (${resp.status})`;
          throw new Error(message);
        }
        commitOutput(callKey, {
          status: "complete",
          functionCall,
          triggerSatisfiedCount: satisfied,
          triggerTotalCount: total,
          triggerMinCount: minCount,
          startedAt: functionCallOutputsRef.current?.[callKey]?.startedAt ?? startedAt,
          completedAt: Date.now(),
          error: null,
          result: json,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        commitOutput(callKey, {
          status: "error",
          functionCall,
          triggerSatisfiedCount: satisfied,
          triggerTotalCount: total,
          triggerMinCount: minCount,
          startedAt: functionCallOutputsRef.current?.[callKey]?.startedAt ?? startedAt,
          completedAt: Date.now(),
          error: message,
          result: null,
        });
      } finally {
        functionCallInFlightRef.current.delete(callKey);
      }
    };

    for (const c of candidates) {
      const callKey = c.callKey;
      const functionCall = c.functionCall;
      if (!callKey || typeof callKey !== "string" || !functionCall) continue;
      const callName = typeof functionCall?.name === "string" ? functionCall.name : null;
      if (callName === "generateInitialImage") {
        const triggerKeys = Array.isArray(functionCall?.triggerAfterStepKeys) ? functionCall.triggerAfterStepKeys : [];
        const { satisfied, total } = getTriggerProgress(stepData, triggerKeys);
        const minCount = getMinTriggerCount(functionCall, triggerKeys);
        const existing = outputs?.[callKey];
        const status = existing?.status;
        if (status !== "complete" && status !== "running") {
          commitOutput(callKey, {
            status: "idle",
            functionCall,
            triggerSatisfiedCount: satisfied,
            triggerTotalCount: total,
            triggerMinCount: minCount,
            startedAt: existing?.startedAt ?? null,
            completedAt: existing?.completedAt ?? null,
            error: null,
            result: existing?.result ?? null,
          });
        }
        continue;
      }
      const existing = outputs?.[callKey];
      const status = existing?.status;
      if (status === "running") continue;
      if (functionCallInFlightRef.current.has(callKey)) continue;
      const triggerKeys = Array.isArray(functionCall?.triggerAfterStepKeys) ? functionCall.triggerAfterStepKeys : [];
      const { satisfied, total } = getTriggerProgress(stepData, triggerKeys);
      const minCount = getMinTriggerCount(functionCall, triggerKeys);
      const readyToRun = total === 0 ? true : satisfied >= minCount;
      const shouldStartFirstRun = (status === undefined || status === "idle" || status === "error") && readyToRun;
      if (!shouldStartFirstRun) continue;
      void run(callKey, functionCall);
    }
  }, [config, flowPlanSessionId, functionCallInFlightRef, functionCallOutputsRef, instanceId, state?.stepData, state?.steps, updateStepData]);

  useEffect(() => {
    if (!state || !sessionId) return;
    const prevIndex = prevIndexRef.current;
    const nextIndex = state.currentStepIndex;
    if (prevIndex !== null && nextIndex > prevIndex + 1) {
      for (let i = prevIndex + 1; i < nextIndex; i += 1) {
        const skipped = state.steps[i];
        if (!skipped) continue;
        const stepId = (skipped as any).id;
        if (!stepId) continue;
        const meta = stepMetaRef.current.get(stepId);
        const isDeterministic = isStructuralStep(skipped) || isBootstrapStepIdValue(stepId);
        const stepSource = isDeterministic ? "frontend_deterministic" : meta?.modelRequestId ? "backend_ai" : "unknown";
        const totalSteps = state?.steps?.length || 0;

        emitTelemetry({
          sessionId,
          instanceId,
          eventType: "step_skipped",
          stepId,
          batchId: normalizeBatchId(meta?.batchId) ?? batchIdFromIndex(formBatchIndex) ?? undefined,
          modelRequestId: meta?.modelRequestId ?? undefined,
          timestamp: Date.now(),
          payload: {
            step_number: i + 1,
            total_steps: totalSteps,
            step_type: getStepType(skipped),
            is_deterministic: isDeterministic,
            source: stepSource,
            step_json: skipped,
            from_order: prevIndex + 1,
            to_order: nextIndex + 1,
          },
        });
      }
    }
    prevIndexRef.current = nextIndex;
  }, [formBatchIndex, instanceId, prevIndexRef, sessionId, state?.currentStepIndex, state?.steps, stepMetaRef]);
}
