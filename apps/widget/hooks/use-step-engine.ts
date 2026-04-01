// Step Engine Hook - Manages step progression and state

import { useState, useCallback, useEffect, useRef } from 'react';
import { StepState, StepDefinition, FlowPlan, UIStep } from '@/types/ai-form';
import { saveStepState, loadStepState, clearStepState } from '@/lib/ai-form/state/step-state';
import { clearSession } from "@/lib/ai-form/session-manager";
import {
  buildContextState,
  updateContextEntry as updateContextEntryInState,
  removeContextEntry as removeContextEntryInState,
  type ContextState,
} from '@/lib/ai-form/state/context-state';
import { STEP_INTENT_METADATA } from '@/lib/ai-form/state/step-intent-metadata';
import { DETERMINISTIC_SERVICE_ID } from "@/components/form/steps/runtime/step-engine/constants";
import { DETERMINISTIC_PRICED_IMAGE_GRID_ID } from "@/components/form/steps/static/deterministic-priced-image-grid-step";
import { LOCAL_SKELETON_FLOW_MODE } from "@/components/form/steps/runtime/step-engine/utils/build-local-skeleton";
import { isFunctionCallStep } from "@/components/form/steps/runtime/step-engine/utils/function-calls";
import { isStructuralStep } from "@/components/form/steps/runtime/step-engine/utils/step-classification";

/** Keys merged into a fresh session so implicit single-service seeds survive sessionId churn. */
const SERVICE_BOOTSTRAP_STEP_DATA_KEYS = [
  DETERMINISTIC_SERVICE_ID,
  "service_primary",
  "step-service",
  "step_service_primary",
  "step_service",
] as const;

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function hasMeaningfulAnswer(answer: any) {
  if (answer === null || answer === undefined) return false;
  if (typeof answer === "string") return answer.trim().length > 0;
  if (Array.isArray(answer)) return answer.length > 0;
  if (typeof answer === "object") return Object.keys(answer).length > 0;
  return true;
}

function getMetricGain(step: any): number {
  const raw =
    (step as any)?.metric_gain ??
    (step as any)?.expected_metric_gain ??
    (step as any)?.importance_weight ??
    0.12;
  const n = Number(raw);
  // Gains are intended to be 0..1 contributions.
  return clamp01(Number.isFinite(n) ? n : 0.12);
}

function keepMergedStepForLocalSkeleton(step: StepDefinition | UIStep, flowPlanStepIds: Set<string>): boolean {
  const id = String((step as any)?.id || "").trim();
  if (!id) return false;
  if (flowPlanStepIds.has(id)) return true;
  if (isStructuralStep(step)) return true;
  if (isFunctionCallStep(step)) return true;
  const t = String((step as any)?.type || "").toLowerCase();
  if (t === "composite") return true;
  if (id === DETERMINISTIC_PRICED_IMAGE_GRID_ID) return true;
  return false;
}

/** Drop legacy planner/JIT steps from persisted state; reorder as flowPlan + tail (structural, priced grid, …). */
function sanitizeAndOrderLocalSkeletonSteps(
  savedSteps: (StepDefinition | UIStep)[],
  planSteps: (StepDefinition | UIStep)[],
  previousIndex: number
): { steps: (StepDefinition | UIStep)[]; currentStepIndex: number } {
  const planIds = new Set(planSteps.map((s) => s.id));
  const kept = savedSteps.filter((s) => keepMergedStepForLocalSkeleton(s, planIds));
  const byId = new Map(kept.map((s) => [s.id, s]));
  const out: (StepDefinition | UIStep)[] = [];
  const used = new Set<string>();
  for (const p of planSteps) {
    const existing = byId.get(p.id);
    if (existing) {
      // Prefer the flow-plan step so DB-driven scope options replace stale persisted copies (same id).
      const existingMeta = (existing as any).__telemetry;
      const incomingMeta = (p as any).__telemetry;
      out.push({
        ...(p as any),
        __telemetry: existingMeta?.batchId || existingMeta?.modelRequestId ? existingMeta : incomingMeta,
      } as StepDefinition | UIStep);
      used.add(p.id);
    } else {
      out.push(p);
      used.add(p.id);
    }
  }
  for (const s of savedSteps) {
    const id = s.id;
    if (used.has(id)) continue;
    const copy = byId.get(id);
    if (!copy) continue;
    out.push(copy);
    used.add(id);
  }
  const prevId =
    previousIndex >= 0 && previousIndex < savedSteps.length ? savedSteps[previousIndex]?.id : null;
  let idx = prevId ? out.findIndex((s) => s.id === prevId) : -1;
  if (idx < 0) {
    idx = Math.max(0, Math.min(previousIndex, out.length - 1));
  }
  return {
    steps: out,
    currentStepIndex: Math.max(0, Math.min(idx, Math.max(0, out.length - 1))),
  };
}

/** Deterministic step IDs (budget, upload) – new API questions must insert before these. Keep in sync with step-engine constants. */
const DETERMINISTIC_BOUNDARY_IDS = new Set([
  "step-budget-range",
  "step-upload-scene-image",
  "step-upload-user-image",
  "step-upload-product-image",
]);

interface UseStepEngineOptions {
  instanceId: string;
  /**
   * Scope key used for session-manager caching.
   * Usually equals `instanceId`, but demo/adventure surfaces may namespace it.
   */
  sessionScopeKey?: string;
  flowPlan: FlowPlan | null;
  fetchNextStep?: (args: {
    stepId: string;
    answer: any;
    stepDataSoFar: Record<string, any>;
    stepsSoFar: (StepDefinition | UIStep)[];
  }) => Promise<{ nextStep: StepDefinition | UIStep | null; done: boolean; plannerStatePatch?: Record<string, any> }>;
  onStepComplete?: (stepId: string, data: any) => void;
  onFlowComplete?: (allData: Record<string, any>) => void;
  isReady?: boolean;
  extra?: { useCase?: string; subcategoryName?: string | null };
  excludedStepIds?: string[];
}

export function useStepEngine({
  instanceId,
  sessionScopeKey,
  flowPlan,
  fetchNextStep,
  onStepComplete,
  onFlowComplete,
  isReady,
  extra,
  excludedStepIds
}: UseStepEngineOptions) {
  const effectiveSessionScopeKey = sessionScopeKey || instanceId;
  const [state, setState] = useState<StepState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingNext, setIsFetchingNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextState, setContextState] = useState<ContextState | null>(null);
  const stepStartTimeRef = useRef<Record<string, number>>({});
  const maxVisitedIndexRef = useRef<number>(0);
  const maxProgressRef = useRef<number>(0);
  const freshResetForSessionRef = useRef<string | null>(null);

  useEffect(() => {
    maxVisitedIndexRef.current = 0;
    maxProgressRef.current = 0;
  }, [flowPlan?.sessionId]);

  // Initialize or load state
  useEffect(() => {
    if (!flowPlan) {
      setIsLoading(false);
      return;
    }

    // Playground/embed flows may reuse the same instanceId. If `?fresh=1` is present,
    // clear the persisted state so the engine always starts at step 1.
    try {
      if (typeof window !== "undefined") {
        const sp = new URLSearchParams(window.location.search);
        const rawFresh = sp.get("fresh");
        const v = rawFresh ? String(rawFresh).trim().toLowerCase() : "";
        const isFresh =
          Boolean(v) && v !== "0" && v !== "false" && v !== "no" && v !== "off";
        if (isFresh && freshResetForSessionRef.current !== flowPlan.sessionId) {
          const existing = loadStepState(instanceId);
          // Adventure bootstrap may have just written deterministic service seed for the
          // brand-new session. Preserve that fresh-session seed instead of wiping it.
          if (!existing || existing.sessionId !== flowPlan.sessionId) {
            clearStepState(instanceId);
          }
          freshResetForSessionRef.current = flowPlan.sessionId;
        }
      }
    } catch {}

    const excludedIds = new Set((excludedStepIds || []).filter(Boolean));
    const filterExcludedSteps = <T extends { id: string }>(steps: T[]) =>
      steps.filter((step) => !excludedIds.has(String(step?.id || "")));

    const filteredFlowPlanSteps = filterExcludedSteps(flowPlan.steps);
    const flowStepsById = new Map(filteredFlowPlanSteps.map((step) => [step.id, step]));
    const hydrateStepTelemetry = (steps: (StepDefinition | UIStep)[]) =>
      steps.map((step) => {
        const incoming = flowStepsById.get(step.id);
        const incomingMeta = incoming && typeof incoming === "object" ? (incoming as any).__telemetry : null;
        if (!incomingMeta) return step;
        const existingMeta = (step as any).__telemetry;
        if (existingMeta?.batchId || existingMeta?.modelRequestId) return step;
        return {
          ...step,
          __telemetry: incomingMeta,
        };
      });

    // Try to load existing state
    const savedState = loadStepState(instanceId);
    const matchesSkeletonVersion =
      !flowPlan.skeletonVersion || (savedState as any)?.skeletonVersion === flowPlan.skeletonVersion;
    
    if (savedState && savedState.sessionId === flowPlan.sessionId && matchesSkeletonVersion) {
      // MERGE STATE: Restore state but merge in any new steps from flowPlan
      // This prevents reset loops when new steps arrive from next-batch
      let filteredSavedSteps = filterExcludedSteps(savedState.steps);
      let mergeSavedIndex = savedState.currentStepIndex;

      if (flowPlan.mode === LOCAL_SKELETON_FLOW_MODE) {
        const cleaned = sanitizeAndOrderLocalSkeletonSteps(
          filteredSavedSteps,
          filteredFlowPlanSteps,
          mergeSavedIndex
        );
        filteredSavedSteps = cleaned.steps;
        mergeSavedIndex = cleaned.currentStepIndex;
      }

      const existingStepIds = new Set(filteredSavedSteps.map(s => s.id));
      const newSteps = filteredFlowPlanSteps.filter(step => !existingStepIds.has(step.id));
      
      if (newSteps.length > 0) {
        console.log('[useStepEngine] Merging new steps into existing state', {
          existingSteps: savedState.steps.length,
          newSteps: newSteps.length,
          newStepIds: newSteps.map(s => s.id),
        });
        
        // Use addSteps logic: insert new steps before structural OR deterministic (budget/upload) steps
        const structuralTypes = ['upload', 'designer', 'lead_capture', 'pricing', 'confirmation'];
        const mergedSteps = [...filteredSavedSteps];
        let mergedCurrentStepIndex = Math.max(0, Math.min(mergeSavedIndex, Math.max(0, filteredSavedSteps.length - 1)));
        
        // Find insertion point (before first structural or deterministic boundary step)
        let insertIndex = mergedSteps.length;
        for (let i = 0; i < mergedSteps.length; i++) {
          const step = mergedSteps[i];
          const stepId = String((step as any)?.id || "");
          if (DETERMINISTIC_BOUNDARY_IDS.has(stepId)) {
            insertIndex = i;
            break;
          }
          const componentType = ('componentType' in step) ? step.componentType : (step.type === 'file_upload' || step.type === 'upload' ? 'upload' : 'text');
          if (structuralTypes.includes(componentType)) {
            insertIndex = i;
            break;
          }
        }

        // Insert unique new steps
        const uniqueNewSteps = newSteps.filter(ns => !mergedSteps.some(es => es.id === ns.id));
        mergedSteps.splice(insertIndex, 0, ...uniqueNewSteps);

        // If we inserted before (or at) the current step, shift the index forward
        // so the user stays on the same logical step and doesn't "jump backwards".
        if (insertIndex <= mergedCurrentStepIndex) {
          mergedCurrentStepIndex += uniqueNewSteps.length;
        }
        
        const mergedState: StepState = {
          ...savedState,
          steps: hydrateStepTelemetry(mergedSteps),
          currentStepIndex: mergedCurrentStepIndex,
          skeletonVersion: flowPlan.skeletonVersion ?? null,
        };
        setState(mergedState);
        saveStepState(instanceId, mergedState);
      } else {
        // No new steps, just restore existing state
        const hydratedState: StepState = {
          ...savedState,
          steps: hydrateStepTelemetry(filteredSavedSteps),
          currentStepIndex: Math.max(0, Math.min(mergeSavedIndex, Math.max(0, filteredSavedSteps.length - 1))),
          skeletonVersion: flowPlan.skeletonVersion ?? null,
        };
        setState(hydratedState);
        saveStepState(instanceId, hydratedState);
      }
      setIsLoading(false);
    } else {
      // Initialize new state - deduplicate steps by ID
      const seenIds = new Set<string>();
      const deduplicatedSteps = filteredFlowPlanSteps.filter((step) => {
        if (seenIds.has(step.id)) {
          console.warn('[Flow] Duplicate step ID in flowPlan - filtering out', {
            stepId: step.id,
            intent: ('intent' in step ? (step as any).intent : undefined),
            type: ('type' in step ? (step as any).type : undefined),
          });
          return false;
        }
        seenIds.add(step.id);
        return true;
      });
      
      if (deduplicatedSteps.length !== filteredFlowPlanSteps.length) {
        console.warn('[Flow] Filtered duplicate steps during initialization', {
          originalCount: filteredFlowPlanSteps.length,
          deduplicatedCount: deduplicatedSteps.length,
        });
      }
      
      const persistedBootstrap = loadStepState(instanceId);
      const bootstrapStepData: Record<string, any> = {};
      if (persistedBootstrap?.stepData && typeof persistedBootstrap.stepData === "object") {
        for (const key of SERVICE_BOOTSTRAP_STEP_DATA_KEYS) {
          if (persistedBootstrap.stepData[key] !== undefined) {
            bootstrapStepData[key] = persistedBootstrap.stepData[key];
          }
        }
      }

      const newState: StepState = {
        currentStepIndex: 0,
        steps: deduplicatedSteps,
        completedSteps: new Set(),
        stepData: bootstrapStepData,
        sessionId: flowPlan.sessionId,
        skeletonVersion: flowPlan.skeletonVersion ?? null,
      };
      setState(newState);
      saveStepState(instanceId, newState);
      setIsLoading(false);
    }
  }, [instanceId, flowPlan, excludedStepIds]);

  // Track step start time
  useEffect(() => {
    if (state) {
      const currentStep = state.steps[state.currentStepIndex];
      if (currentStep) {
        stepStartTimeRef.current[currentStep.id] = Date.now();
      }
      if (state.currentStepIndex >= 0) {
        maxVisitedIndexRef.current = Math.max(maxVisitedIndexRef.current, state.currentStepIndex);
      }
    }
  }, [state?.currentStepIndex]);

  // Build context state from step data
  useEffect(() => {
    if (!state) {
      setContextState(null);
      return;
    }

    const ctx = buildContextState({
      stepDataSoFar: state.stepData,
      steps: state.steps,
      metadata: STEP_INTENT_METADATA,
      extra,
    });
    setContextState(ctx);
  }, [state?.stepData, state?.steps, extra?.useCase, extra?.subcategoryName]);

  const goToNextStep = useCallback(async (stepData?: any) => {
    if (!state) return;

    const currentStep = state.steps[state.currentStepIndex];
    if (!currentStep) return;

    // Clear any previous progressive error when user continues.
    setError(null);

    const resolvedStepData = stepData !== undefined ? stepData : state.stepData[currentStep.id];

    // Save step data
    const updatedStepData = {
      ...state.stepData,
      [currentStep.id]: resolvedStepData
    };

    // Mark step as completed
    const updatedCompletedSteps = new Set(state.completedSteps);
    updatedCompletedSteps.add(currentStep.id);

    // Call step complete callback
    if (onStepComplete) {
      onStepComplete(currentStep.id, resolvedStepData);
    }

    // Check if we should skip next step
    const nextIndex = state.currentStepIndex + 1;
    let actualNextIndex = nextIndex;

    // CRITICAL: Always advance if there's a next step available
    if (nextIndex < state.steps.length) {
      const nextStep = state.steps[nextIndex];
      const isUIStep = 'type' in nextStep && !('componentType' in nextStep);
      const skipCondition = isUIStep ? undefined : (nextStep as StepDefinition).skipCondition;
      if (skipCondition) {
        const shouldSkip = skipCondition(updatedStepData);
        if (shouldSkip) {
          actualNextIndex = nextIndex + 1;
          // Recursively check if the next step should also be skipped
          while (actualNextIndex < state.steps.length) {
            const checkStep = state.steps[actualNextIndex];
            const checkIsUIStep = 'type' in checkStep && !('componentType' in checkStep);
            const checkSkipCondition = checkIsUIStep ? undefined : (checkStep as StepDefinition).skipCondition;
            if (checkSkipCondition && checkSkipCondition(updatedStepData)) {
              actualNextIndex++;
            } else {
              break;
            }
          }
        }
      }
      // If we have a valid next step, advance immediately
      console.log('[Flow] ✅ Next step available, advancing', {
        fromIndex: state.currentStepIndex,
        toIndex: actualNextIndex,
        stepId: state.steps[actualNextIndex]?.id,
        totalSteps: state.steps.length,
      });
    } else {
      console.log('[Flow] ⏳ No next step available yet', {
        currentIndex: state.currentStepIndex,
        totalSteps: state.steps.length,
      });
    }

    // IMPORTANT: satiety/readyForImageGen should NOT "jump" the user forward to designer.
    // Readiness is used only to decide whether to fetch/generate more QUESTIONS (JIT batching),
    // not to reorder the already-streamed step sequence.

    // CRITICAL: Always check precomputed steps FIRST before making API calls
    if (actualNextIndex >= state.steps.length) {
      // First, check if we have precomputed steps available
      const precomputedSteps = flowPlan?.steps || [];
      const precomputedIndex = state.steps.length;
      // Check if there are more steps - use state.steps directly (everything happens in state now)
      // If we're not ready and have steps, assume more might come from JIT batching
      const hasMoreSteps = !isReady && state.steps.length > 0;
      
      if (precomputedIndex < precomputedSteps.length) {
        // We have a precomputed step available - use it directly
        const nextPrecomputedStep = precomputedSteps[precomputedIndex];
        
        // CRITICAL: Check for duplicates before adding
        if (state.steps.some((s) => s.id === nextPrecomputedStep.id)) {
          console.warn('[Flow] Duplicate precomputed step detected - skipping', {
            stepId: nextPrecomputedStep.id,
            stepIndex: precomputedIndex,
            existingStepIds: state.steps.map(s => s.id),
          });
          
          // Skip this step and try the next one, or mark as complete if no more steps
          if (precomputedIndex + 1 < precomputedSteps.length) {
            // Try next precomputed step
            const nextNextStep = precomputedSteps[precomputedIndex + 1];
            if (!state.steps.some((s) => s.id === nextNextStep.id)) {
              const appendedSteps = [...state.steps, nextNextStep];
              const newState: StepState = {
                ...state,
                steps: appendedSteps,
                currentStepIndex: state.steps.length,
                completedSteps: updatedCompletedSteps,
                stepData: updatedStepData,
              };
              setState(newState);
              saveStepState(instanceId, newState);
              return;
            }
          }
          
          // If we can't find a non-duplicate next step, check if there are more steps coming
          if (hasMoreSteps) {
            console.log('[Flow] All remaining precomputed steps are duplicates, but more steps may come - waiting for JIT batching');
            // Don't call onFlowComplete - wait for next-batch
            const newState: StepState = {
              ...state,
              currentStepIndex: state.currentStepIndex,
              completedSteps: updatedCompletedSteps,
              stepData: updatedStepData,
            };
            setState(newState);
            saveStepState(instanceId, newState);
            return;
          }
          
          // No more steps anywhere - mark as complete
          // BUT: If readyForImageGen is true, wait for structural steps instead
          if (isReady) {
            console.log('[Flow] Ready for image gen but all remaining steps are duplicates - waiting for structural steps');
            const newState: StepState = {
              ...state,
              currentStepIndex: state.currentStepIndex,
              completedSteps: updatedCompletedSteps,
              stepData: updatedStepData,
            };
            setState(newState);
            saveStepState(instanceId, newState);
            return;
          }
          console.log('[Flow] All remaining precomputed steps are duplicates and no more steps - marking complete');
          if (onFlowComplete) {
            onFlowComplete(updatedStepData);
          }
          return;
        }
        
        console.log('[Flow] Using precomputed step from flowPlan', {
          stepIndex: precomputedIndex,
          stepId: nextPrecomputedStep.id,
          totalPrecomputed: precomputedSteps.length,
          currentStateSteps: state.steps.length,
        });
        
        const appendedSteps = [...state.steps, nextPrecomputedStep];
        const newState: StepState = {
          ...state,
          steps: appendedSteps,
          currentStepIndex: state.steps.length, // jump to the appended step
          completedSteps: updatedCompletedSteps,
          stepData: updatedStepData,
        };
        setState(newState);
        saveStepState(instanceId, newState);
        return;
      }
      
      // If we've reached maxSteps, mark as complete
      // BUT: If readyForImageGen is true, wait for structural steps instead
      if (flowPlan && state.steps.length >= flowPlan.maxSteps) {
        if (isReady) {
          console.log('[Flow] Ready for image gen but reached maxSteps - waiting for structural steps', {
            stepsLength: state.steps.length,
            maxSteps: flowPlan?.maxSteps,
          });
          const newState: StepState = {
            ...state,
            currentStepIndex: state.currentStepIndex,
            completedSteps: updatedCompletedSteps,
            stepData: updatedStepData,
          };
          setState(newState);
          saveStepState(instanceId, newState);
          return;
        }
        console.log('[Flow] Flow complete (maxSteps) - calling onFlowComplete', { 
          stepsLength: state.steps.length, 
          maxSteps: flowPlan?.maxSteps,
          updatedStepData 
        });
        if (onFlowComplete) {
          onFlowComplete(updatedStepData);
        }
        return;
      }
      
      // If we are ready (isReady reached), but haven't reached structural steps in state.steps,
      // we don't call onFlowComplete yet. We'll check precomputed steps below.
      // If NO more precomputed steps exist and NO structural steps were found, THEN we complete.
      
      // If we've exhausted precomputed steps BUT there are more steps coming, wait for JIT batching
      // Don't mark as complete yet - the StepEngine will trigger next-batch fetch
      // CRITICAL: If we are already ready (isReady is true), don't wait for more questions - just finish
      if (precomputedIndex >= precomputedSteps.length && hasMoreSteps) {
        console.log('[Flow] Exhausted precomputed steps, but more steps may come - waiting for JIT batching', {
          stepsLength: state.steps.length,
          precomputedSteps: precomputedSteps.length,
        });
        // Update step data but don't advance yet - wait for JIT batch to add new steps
        // The StepEngine useEffect will trigger the batch fetch, and when steps arrive via addSteps, we'll auto-advance
        const newState: StepState = {
          ...state,
          currentStepIndex: state.currentStepIndex, // Stay on current step until new steps arrive
          completedSteps: updatedCompletedSteps,
          stepData: updatedStepData,
        };
        setState(newState);
        saveStepState(instanceId, newState);
        // Return here - don't try to fetch via old API, let JIT batching handle it
        return;
      }
      
      // If we've exhausted precomputed steps, mark as complete
      // BUT: If readyForImageGen is true, wait for structural steps instead
      if (flowPlan && precomputedIndex >= precomputedSteps.length && !hasMoreSteps) {
        const shouldCompleteLocalSkeletonFlow = isReady && flowPlan.mode === LOCAL_SKELETON_FLOW_MODE;
        if (isReady && !shouldCompleteLocalSkeletonFlow) {
          console.log('[Flow] Ready for image gen but exhausted all steps - waiting for structural steps', {
            stepsLength: state.steps.length,
            precomputedSteps: precomputedSteps.length,
          });
          const newState: StepState = {
            ...state,
            currentStepIndex: state.currentStepIndex,
            completedSteps: updatedCompletedSteps,
            stepData: updatedStepData,
          };
          setState(newState);
          saveStepState(instanceId, newState);
          return;
        }
        if (shouldCompleteLocalSkeletonFlow) {
          console.log('[Flow] Local skeleton exhausted all steps - calling onFlowComplete', {
            stepsLength: state.steps.length,
            precomputedSteps: precomputedSteps.length,
            updatedStepData,
          });
        }
        console.log('[Flow] Exhausted all steps - calling onFlowComplete', { 
          stepsLength: state.steps.length, 
          precomputedSteps: precomputedSteps.length,
          updatedStepData 
        });
        if (onFlowComplete) {
          onFlowComplete(updatedStepData);
        }
        return;
      }
      
      // Only fetch next step if we've exhausted ALL precomputed steps AND haven't reached maxSteps
      // This should NEVER happen if precompute is working correctly
      // CRITICAL: Skip if we are already ready
      if (fetchNextStep && flowPlan && state.steps.length < flowPlan.maxSteps && !isReady) {
        console.error('[Flow] ERROR: Fetching step via API - precompute should have generated all steps!', {
          currentSteps: state.steps.length,
          precomputedSteps: precomputedSteps.length,
          maxSteps: flowPlan.maxSteps,
          flowPlanStepIds: precomputedSteps.map(s => s.id),
          stateStepIds: state.steps.map(s => s.id),
        });
        setIsFetchingNext(true);
        try {
          let res: { nextStep: StepDefinition | UIStep | null; done: boolean; plannerStatePatch?: Record<string, any> };
          try {
            res = await fetchNextStep({
              stepId: currentStep.id,
              answer: resolvedStepData,
              stepDataSoFar: updatedStepData,
              stepsSoFar: state.steps,
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to fetch next step');
            return;
          }

          // Merge planner state patch (server-provided) into persisted stepDataSoFar under __ keys.
          // This is how we persist section routing state across requests without server-side sessions.
          const patchedStepData = (res?.plannerStatePatch && typeof res.plannerStatePatch === 'object')
            ? { ...updatedStepData, ...res.plannerStatePatch }
            : updatedStepData;

          if (res?.nextStep) {
            // Single-step progression: append exactly one next step.
            // Guard against duplicates (should be rare; server also guards).
            if (state.steps.some((s) => s.id === res!.nextStep!.id)) {
              setError('Planner returned a duplicate step. Please retry.');
              return;
            }
            const appendedSteps = [...state.steps, res.nextStep];
            const newState: StepState = {
              ...state,
              steps: appendedSteps,
              currentStepIndex: state.steps.length, // jump to the first appended step
              completedSteps: updatedCompletedSteps,
              stepData: patchedStepData,
            };
            setState(newState);
            saveStepState(instanceId, newState);
            return;
          }

          if (res?.done) {
            // BUT: If readyForImageGen is true, wait for structural steps instead
            if (isReady) {
              console.log('[Flow] Ready for image gen but fetchNextStep returned done - waiting for structural steps');
              const newState: StepState = {
                ...state,
                currentStepIndex: state.currentStepIndex,
                completedSteps: updatedCompletedSteps,
                stepData: patchedStepData,
              };
              setState(newState);
              saveStepState(instanceId, newState);
              return;
            }
            console.log('[Flow] Form complete - calling onFlowComplete', { updatedStepData });
            if (onFlowComplete) {
              onFlowComplete(patchedStepData);
            } else {
              console.warn('[Flow] onFlowComplete handler not provided');
            }
            clearStepState(instanceId);
            // Treat completion as a new session boundary for subsequent reloads/restarts.
            // This prevents lead gates (pricing pill) from staying unlocked when the form restarts.
            try { clearSession(effectiveSessionScopeKey); } catch {}
            return;
          }
        } finally {
          setIsFetchingNext(false);
        }
      }

      // No progressive next-step available - check if there are more steps coming
      if (hasMoreSteps) {
        console.log('[Flow] No progressive next-step, but more steps may come - waiting for JIT batching', {
          stepsLength: state.steps.length,
        });
        // Don't call onFlowComplete - wait for next-batch
        const newState: StepState = {
          ...state,
          currentStepIndex: state.currentStepIndex,
          completedSteps: updatedCompletedSteps,
          stepData: updatedStepData,
        };
        setState(newState);
        saveStepState(instanceId, newState);
        return;
      }
      
      // CRITICAL: If readyForImageGen is true, we should NOT complete - we should wait for structural steps
      // (designer/upload steps) to be added. Only complete if we're NOT ready for image gen.
      if (isReady) {
        console.log('[Flow] Ready for image gen but no more steps - waiting for structural steps to be added', {
          stepsLength: state.steps.length,
          isReady,
        });
        // Don't call onFlowComplete - wait for structural steps (designer/upload) to be added
        const newState: StepState = {
          ...state,
          currentStepIndex: state.currentStepIndex,
          completedSteps: updatedCompletedSteps,
          stepData: updatedStepData,
        };
        setState(newState);
        saveStepState(instanceId, newState);
        return;
      }
      
      // No more steps anywhere AND not ready for image gen - flow complete
      console.log('[Flow] No more steps available - calling onFlowComplete', { 
        updatedStepData,
        stepsLength: state.steps.length,
        isReady,
      });
      if (onFlowComplete) {
        onFlowComplete(updatedStepData);
      } else {
        console.warn('[Flow] onFlowComplete handler not provided');
      }
      clearStepState(instanceId);
      // Treat completion as a new session boundary for subsequent reloads/restarts.
      try { clearSession(effectiveSessionScopeKey); } catch {}
      return;
    }

    // Update state
    const newState: StepState = {
      ...state,
      currentStepIndex: actualNextIndex,
      completedSteps: updatedCompletedSteps,
        stepData: updatedStepData
    };

    setState(newState);
    saveStepState(instanceId, newState);
  }, [effectiveSessionScopeKey, fetchNextStep, flowPlan, instanceId, isReady, onFlowComplete, onStepComplete, state]);

  const goToPreviousStep = useCallback(() => {
    setState((prev) => {
      if (!prev || prev.currentStepIndex === 0) return prev;
      const newState: StepState = {
        ...prev,
        currentStepIndex: prev.currentStepIndex - 1,
      };
      saveStepState(instanceId, newState);
      return newState;
    });
  }, [instanceId]);

  const goToStep = useCallback((stepIndex: number) => {
    if (!state || stepIndex < 0 || stepIndex >= state.steps.length) return;

    const newState: StepState = {
      ...state,
      currentStepIndex: stepIndex
    };

    setState(newState);
    saveStepState(instanceId, newState);
  }, [state, instanceId]);

  const updateStepData = useCallback((stepId: string, data: any) => {
    setState((prev) => {
      if (!prev) return prev;
      const newState: StepState = {
        ...prev,
        stepData: {
          ...prev.stepData,
          [stepId]: data
        }
      };
      saveStepState(instanceId, newState);
      return newState;
    });
  }, [state, instanceId]);

  const patchStep = useCallback(
    (stepId: string, patch: Record<string, any>) => {
      if (!stepId || !patch || typeof patch !== "object") return;
      setState((prev) => {
        if (!prev) return prev;
        const idx = prev.steps.findIndex((s) => (s as any)?.id === stepId);
        if (idx < 0) return prev;
        const current = prev.steps[idx] as any;
        const nextStep = { ...current, ...patch };
        const nextSteps = prev.steps.slice();
        nextSteps[idx] = nextStep;
        const newState: StepState = { ...prev, steps: nextSteps };
        saveStepState(instanceId, newState);
        return newState;
      });
    },
    [instanceId]
  );

  const getCurrentStep = useCallback((): StepDefinition | UIStep | null => {
    if (!state) return null;
    return state.steps[state.currentStepIndex] || null;
  }, [state]);

  const getStepProgress = useCallback((): { current: number; total: number; percentage: number } => {
    if (!state) return { current: 0, total: 0, percentage: 0 };
    const structuralTypes = ['upload', 'designer', 'lead_capture', 'pricing', 'confirmation'];
    const questionSteps: Array<{ id: string; gain: number }> = [];

    state.steps.forEach((step) => {
      // Backend-directed dynamic actions (functionCall) should not affect progress math.
      if ((step as any)?.functionCall) return;
      const stepType = ('type' in step) ? (step as any).type : undefined;
      const componentType = ('componentType' in step) ? step.componentType : 
        (stepType === 'file_upload' || stepType === 'upload' ? 'upload' : 
         stepType === 'designer' ? 'designer' :
         stepType === 'lead_capture' ? 'lead_capture' :
         stepType === 'pricing' ? 'pricing' :
         stepType === 'confirmation' ? 'confirmation' : 'text');
      if (structuralTypes.includes(componentType)) return;
      questionSteps.push({ id: step.id, gain: getMetricGain(step) });
    });

    // Progress is a *stateful* cumulative metric gain (0..1), not "answered/total".
    // This avoids the "hits 100% after Q1" issue when we append more questions later.
    const gained = questionSteps.reduce((acc, s) => {
      const answered = hasMeaningfulAnswer(state.stepData?.[s.id]);
      return acc + (answered ? s.gain : 0);
    }, 0);

    const current = clamp01(gained);
    const pct = Math.round(current * 100);
    maxProgressRef.current = Math.max(maxProgressRef.current, pct);

    return { current, total: 1, percentage: maxProgressRef.current };
  }, [state]);

  const addSteps = useCallback(
    (
      newSteps: (StepDefinition | UIStep)[],
      autoAdvance: boolean = false,
      opts?: { insertAtIndex?: number | null; moveExisting?: boolean }
    ) => {
    if (!newSteps || newSteps.length === 0) return;
    const excludedIds = new Set((excludedStepIds || []).filter(Boolean));

    setState((prev) => {
      if (!prev) return prev;

      // APPEND NEW STEPS: Append at the end of all question steps (before structural steps)
      // This creates a unified form: batch1 questions -> batch2 questions -> structural steps
      const existingStepIdMap = new Map<string, number>();
      prev.steps.forEach((step, index) => {
        existingStepIdMap.set(step.id, index);
      });

      const moveExisting = Boolean(opts?.moveExisting);

      // Filter out duplicates by default; optionally allow *moving* existing, incomplete steps.
      const stepIdsToMove = new Set<string>();
      const stepsToInsert: (StepDefinition | UIStep)[] = [];
      for (const step of newSteps) {
        if (!step || typeof step !== "object") continue;
        const stepId = (step as any).id;
        if (!stepId) continue;
        if (excludedIds.has(String(stepId))) continue;
        const existingIndex = existingStepIdMap.get(stepId);
        if (existingIndex === undefined) {
          stepsToInsert.push(step);
          continue;
        }
        if (!moveExisting) continue;

        const alreadyCompleted = Boolean(prev.completedSteps && (prev.completedSteps as any).has?.(stepId));
        const alreadyAnswered = hasMeaningfulAnswer((prev.stepData as any)?.[stepId]);
        if (alreadyCompleted || alreadyAnswered) continue;

        stepIdsToMove.add(stepId);
        stepsToInsert.push(step);
      }

      if (stepsToInsert.length === 0) {
        console.warn('[StepEngine] All requested steps already exist (or were ineligible to move), skipping addSteps');
        return prev;
      }

      // FIND INSERTION POINT:
      // - Default: append at the end of all question steps (before first structural step AFTER the current step)
      // - Optional: caller can provide an absolute insert index (used for deterministic, mid-form injections)
      const structuralTypes = ['upload', 'designer', 'lead_capture', 'pricing', 'confirmation'];
      let insertIndex = prev.steps.length; // Default: append at end

      const requestedInsertAtIndex = typeof opts?.insertAtIndex === "number" && Number.isFinite(opts.insertAtIndex)
        ? Math.max(0, Math.min(prev.steps.length, Math.floor(opts.insertAtIndex)))
        : null;

      if (typeof requestedInsertAtIndex === "number") {
        insertIndex = requestedInsertAtIndex;
      } else {
        // Find the first structural OR deterministic (budget/upload) step after the current step.
        // New API questions must go before budget + upload so order stays: API questions -> budget -> upload.
        for (let i = prev.currentStepIndex + 1; i < prev.steps.length; i++) {
          const step = prev.steps[i];
          const stepId = String((step as any)?.id || "");
          if (DETERMINISTIC_BOUNDARY_IDS.has(stepId)) {
            insertIndex = i;
            break;
          }
          const stepType = ('type' in step) ? (step as any).type : undefined;
          const componentType = ('componentType' in step) ? step.componentType : 
            (stepType === 'file_upload' || stepType === 'upload' ? 'upload' : 
             stepType === 'designer' ? 'designer' :
             stepType === 'lead_capture' ? 'lead_capture' :
             stepType === 'pricing' ? 'pricing' :
             stepType === 'confirmation' ? 'confirmation' : 'text');

          if (structuralTypes.includes(componentType)) {
            insertIndex = i;
            break;
          }
        }
      }

      // If no structural steps found after current step, append at the end
      // This ensures batch 2 questions are always appended after batch 1 questions
      // and never before the user's current position

      // Log to verify options are preserved when adding steps
      const multipleChoiceSteps = stepsToInsert.filter(s => {
        const stepType = ('type' in s) ? (s as any).type : undefined;
        return stepType === 'multiple_choice' || stepType === 'choice';
      });
      if (multipleChoiceSteps.length > 0) {
        console.log('[useStepEngine.addSteps] Adding steps - verifying options preserved:', {
          count: stepsToInsert.length,
          stepIds: stepsToInsert.map(s => s.id),
          multipleChoiceSteps: multipleChoiceSteps.map(s => ({
            id: (s as any).id,
            type: (s as any).type,
            hasOptions: Array.isArray((s as any).options),
            optionsCount: Array.isArray((s as any).options) ? (s as any).options.length : 0,
            allKeys: Object.keys(s), // Show all keys to verify nothing is stripped
          })),
        });
      }

      const allSteps = [...prev.steps];

      // If we're moving existing steps, remove them first (and adjust indices accordingly).
      let newCurrentStepIndex = prev.currentStepIndex;
      if (moveExisting && stepIdsToMove.size > 0) {
        const removedIndices: number[] = [];
        for (const id of stepIdsToMove) {
          const idx = existingStepIdMap.get(id);
          if (typeof idx === "number") removedIndices.push(idx);
        }
        removedIndices.sort((a, b) => a - b);

        const removedBeforeCurrent = removedIndices.filter((i) => i < prev.currentStepIndex).length;
        if (removedBeforeCurrent > 0) newCurrentStepIndex = Math.max(0, newCurrentStepIndex - removedBeforeCurrent);

        const removedBeforeInsert = removedIndices.filter((i) => i < insertIndex).length;
        insertIndex = Math.max(0, insertIndex - removedBeforeInsert);

        for (let i = allSteps.length - 1; i >= 0; i -= 1) {
          if (stepIdsToMove.has(allSteps[i].id)) allSteps.splice(i, 1);
        }

        // Keep insertIndex within bounds after removals.
        insertIndex = Math.max(0, Math.min(allSteps.length, insertIndex));
      }

      // Log BEFORE insertion to see what we're working with
      console.log('[Flow] 🔍 BEFORE adding steps:', {
        currentStepIndex: prev.currentStepIndex,
        currentStepId: prev.steps[prev.currentStepIndex]?.id,
        totalSteps: prev.steps.length,
        insertIndex,
        requestedInsertAtIndex,
        newStepsCount: stepsToInsert.length,
        newStepIds: stepsToInsert.map(s => s.id),
        stepsBeforeInsertion: prev.steps.map((s, i) => ({ index: i, id: s.id })),
      });

      allSteps.splice(insertIndex, 0, ...stepsToInsert);

      // Calculate new currentStepIndex
      // CRITICAL: Only adjust index if steps were inserted BEFORE the current step
      // If steps are appended AFTER the current step (prefetch), keep the same index
      // This ensures batch 2 can load silently in background without disrupting user
      // Special-case: inserting the very first steps into an empty flow.
      // Keep the index at 0 so the user lands on the first generated step (not past the end).
      if (prev.steps.length === 0) {
        newCurrentStepIndex = 0;
        console.log("[Flow] 🌱 Initial insert into empty flow - setting currentStepIndex=0", {
          insertIndex,
          newStepsCount: stepsToInsert.length,
        });
      } else {
        // CRITICAL: When appending batch 2 after current step, NEVER change the index
        // Only adjust if steps were inserted BEFORE the current step
        const stepsInsertedBeforeCurrent = insertIndex <= newCurrentStepIndex;

        if (stepsInsertedBeforeCurrent) {
          // Steps were inserted before or at current step, shift index forward to maintain position
          newCurrentStepIndex = newCurrentStepIndex + stepsToInsert.length;
          console.log('[Flow] 📍 Adjusting step index (steps inserted before current)', {
            fromIndex: prev.currentStepIndex,
            toIndex: newCurrentStepIndex,
            insertIndex,
            stepsInsertedBeforeCurrent,
            reason: 'Steps inserted before current step - must shift index forward',
          });
        } else {
          // Steps appended after current step - KEEP THE SAME INDEX (no change)
          // This is the critical case for batch 2 prefetch - user should stay on their current step
          newCurrentStepIndex = prev.currentStepIndex; // Explicitly keep same index
          console.log('[Flow] ✅ Silent append - KEEPING SAME STEP INDEX', {
            currentStepIndex: prev.currentStepIndex,
            newCurrentStepIndex,
            insertIndex,
            stepsInsertedBeforeCurrent,
            reason: 'Steps appended AFTER current step - user stays on same step, no disruption',
          });
        }
      }

      // Log AFTER to verify the step at the index is still the same
      const stepAtNewIndex = allSteps[newCurrentStepIndex];
      const stepAtOldIndex = allSteps[prev.currentStepIndex];
      console.log('[Flow] 🔍 AFTER adding steps:', {
        oldIndex: prev.currentStepIndex,
        oldStepId: stepAtOldIndex?.id,
        newIndex: newCurrentStepIndex,
        newStepId: stepAtNewIndex?.id,
        stepsAfterInsertion: allSteps.map((s, i) => ({ index: i, id: s.id })),
        indexChanged: newCurrentStepIndex !== prev.currentStepIndex,
        stepIdChanged: stepAtNewIndex?.id !== stepAtOldIndex?.id,
      });

      // Auto-advance logic: Only if explicitly requested (user was on last step waiting for generated steps)
      if (autoAdvance) {
        const shouldJumpToInsertedNeighbor =
          typeof requestedInsertAtIndex === "number" && requestedInsertAtIndex === prev.currentStepIndex + 1;
        if (shouldJumpToInsertedNeighbor) {
          newCurrentStepIndex = insertIndex;
          console.log('[Flow] 🚀 Auto-advancing to inserted adjacent step', {
            fromIndex: prev.currentStepIndex,
            toIndex: newCurrentStepIndex,
            insertIndex,
            reason: 'Deterministic step inserted immediately after current step',
          });
        }

        // User was on last step waiting - advance to first newly generated step
        const wasOnLastStep = prev.currentStepIndex >= (prev.steps.length - 1);
        if (!shouldJumpToInsertedNeighbor && wasOnLastStep && insertIndex > newCurrentStepIndex) {
          // New steps appended after last step - advance to the first one
          newCurrentStepIndex = insertIndex;
          console.log('[Flow] 🚀 Auto-advancing to first newly generated step', {
            fromIndex: prev.currentStepIndex,
            toIndex: newCurrentStepIndex,
            insertIndex,
            reason: 'User was on last step waiting, next steps ready',
          });
        }
      }

      const newState: StepState = {
        ...prev,
        steps: allSteps,
        currentStepIndex: newCurrentStepIndex,
      };

      // Determine if these are question steps or structural steps for logging
      const isQuestionStep = (step: any) => {
        const stepType = ('type' in step) ? (step as any).type : undefined;
        const componentType = ('componentType' in step) ? step.componentType : 
          (stepType === 'file_upload' || stepType === 'upload' ? 'upload' : 
           stepType === 'designer' ? 'designer' :
           stepType === 'lead_capture' ? 'lead_capture' :
           stepType === 'pricing' ? 'pricing' :
           stepType === 'confirmation' ? 'confirmation' : 'text');
        return !['upload', 'designer', 'lead_capture', 'pricing', 'confirmation'].includes(componentType);
      };
      const areQuestionSteps = stepsToInsert.every(isQuestionStep);

      console.log('[StepEngine] ✅ Steps INSERTED at index ' + insertIndex, {
        addedCount: stepsToInsert.length,
        totalSteps: allSteps.length,
        existingSteps: prev.steps.length,
        newStepIds: stepsToInsert.map(s => s.id),
        currentStepIndex: newCurrentStepIndex,
        autoAdvance,
        requestedInsertAtIndex,
        stepType: areQuestionSteps ? 'question steps (batch 2)' : 'structural steps',
        unifiedForm: areQuestionSteps ? '✅ Batch 2 questions appended at end of question steps' : '✅ Structural steps appended after all questions',
      });

      saveStepState(instanceId, newState);
      return newState;
    });
  }, [excludedStepIds, instanceId]
  );

  const isStepCompleted = useCallback((stepId: string): boolean => {
    if (!state) return false;
    return state.completedSteps.has(stepId);
  }, [state]);

  const canGoBack = useCallback((): boolean => {
    if (!state) return false;
    return state.currentStepIndex > 0;
  }, [state]);

  const canGoForward = useCallback((): boolean => {
    if (!state) return false;
    return state.currentStepIndex < state.steps.length - 1;
  }, [state]);

  const editContextEntry = useCallback((stepId: string, newAnswer: any) => {
    if (!state || !contextState) return;

    // Update step data
    const updatedStepData = {
      ...state.stepData,
      [stepId]: newAnswer,
    };

    // Rebuild context state
    const updatedContextState = updateContextEntryInState(
      contextState,
      stepId,
      newAnswer,
      state.steps,
      extra
    );

    // Update state
    const newState: StepState = {
      ...state,
      stepData: updatedStepData,
    };

    setState(newState);
    setContextState(updatedContextState);
    saveStepState(instanceId, newState);
  }, [state, contextState, instanceId, extra?.useCase, extra?.subcategoryName]);

  const removeContextEntry = useCallback((stepId: string) => {
    if (!state || !contextState) return;

    // Remove from step data
    const updatedStepData = { ...state.stepData };
    delete updatedStepData[stepId];

    // Rebuild context state
    const updatedContextState = removeContextEntryInState(
      contextState,
      stepId,
      state.steps,
      extra
    );

    // Update state
    const newState: StepState = {
      ...state,
      stepData: updatedStepData,
    };

    setState(newState);
    setContextState(updatedContextState);
    saveStepState(instanceId, newState);
  }, [state, contextState, instanceId, extra?.useCase, extra?.subcategoryName]);

  const markStepComplete = useCallback((stepId: string) => {
    if (!stepId) return;
    setState((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.completedSteps);
      if (next.has(stepId)) return prev;
      next.add(stepId);
      const newState = { ...prev, completedSteps: next };
      saveStepState(instanceId, newState);
      return newState;
    });
  }, [instanceId]);

  /** Remove steps by ID (e.g. budget/upload after first image — they move to the bottom bar). */
  const removeStepsByIds = useCallback((stepIds: Set<string>) => {
    if (!stepIds || stepIds.size === 0) return;
    setState((prev) => {
      if (!prev?.steps?.length) return prev;
      const kept: (StepDefinition | UIStep)[] = [];
      const oldIdxToNewIdx: number[] = [];
      prev.steps.forEach((s: any, oldIdx: number) => {
        if (!stepIds.has(String((s as any)?.id || ""))) {
          oldIdxToNewIdx[oldIdx] = kept.length;
          kept.push(s);
        }
      });
      if (kept.length === prev.steps.length) return prev;
      const currentIdx = prev.currentStepIndex ?? 0;
      const currentStep = prev.steps[currentIdx];
      const currentId = currentStep ? String((currentStep as any)?.id || "") : "";
      let newIndex: number;
      if (stepIds.has(currentId)) {
        const nextKeptIdx = prev.steps.findIndex((s: any, i: number) => i > currentIdx && !stepIds.has(String((s as any)?.id || "")));
        newIndex = nextKeptIdx >= 0 ? (oldIdxToNewIdx[nextKeptIdx] ?? kept.length - 1) : kept.length - 1;
      } else {
        newIndex = oldIdxToNewIdx[currentIdx] ?? kept.length - 1;
      }
      newIndex = Math.max(0, Math.min(newIndex, kept.length - 1));
      const newState = { ...prev, steps: kept, currentStepIndex: newIndex };
      saveStepState(instanceId, newState);
      return newState;
    });
  }, [instanceId]);

  return {
    state,
    isLoading,
    isFetchingNext,
    error,
    contextState,
    currentStep: getCurrentStep(),
    progress: getStepProgress(),
    goToNextStep,
    goToPreviousStep,
    goToStep,
    updateStepData,
    patchStep,
    markStepComplete,
    editContextEntry,
    removeContextEntry,
    isStepCompleted,
    canGoBack,
    canGoForward,
    stepStartTimeRef,
    addSteps, // JIT batching: Add new steps to the state
    removeStepsByIds,
  };
}
