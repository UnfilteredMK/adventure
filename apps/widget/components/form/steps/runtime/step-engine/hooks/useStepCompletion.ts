import { useCallback } from "react";
import { FormState } from "@/types/ai-form";
import { emitTelemetry } from "@/lib/ai-form/telemetry";
import { loadServiceCatalog } from "@/lib/ai-form/state/service-catalog-storage";
import { buildDeterministicStyleStep } from "../../../static/deterministic-style-step";
import { DETERMINISTIC_PRICED_IMAGE_GRID_ID } from "../../../static/deterministic-priced-image-grid-step";
import {
  DETERMINISTIC_FULL_NAME_ID,
  DETERMINISTIC_SCENE_IMAGE_ID,
  DETERMINISTIC_SERVICE_ID,
  DETERMINISTIC_STYLE_ID,
  PRE_CONCEPT_SCOPE_STEP_IDS,
} from "../constants";
import { updatePreviewCacheSnapshot } from "../../../image-preview-experience/gallery/preview-cache-bridge";
import { hydrateServiceCatalogFromWidget } from "../utils/generate-steps-batch";
import { buildLocalPostServiceSteps } from "../utils/build-local-skeleton";
import { saveFormState } from "../utils/form-state";
import { extractFirstName } from "../utils/personalization";
import { getMetricGain } from "../utils/pricing-context";
import { isBootstrapStepIdValue, isQuestionStepForAskedIds, isStructuralStep } from "../utils/step-classification";
import {
  batchIdFromIndex,
  detectFilledOther,
  deterministicAnswersPresent,
  getStepType,
  getValueType,
  hasMeaningfulAnswer,
  legacyAliasKeyForStepId,
  normalizeBatchId,
} from "../utils/step-answers";
import { clamp01, normalizeOptionalString } from "../utils/core";

type StepMeta = {
  batchId?: string | null;
  modelRequestId?: string | null;
  payloadRequest?: any | null;
  payloadResponse?: any | null;
};

export function useStepCompletion(args: {
  currentStep: any;
  state: any;
  answeredRefinementQuestionCount: number;
  isStepAnsweredForCounts: (step: any, stepData: Record<string, any> | null | undefined) => boolean;
  previewHasImage: boolean;
  instanceId: string;
  sessionId: string;
  flowPlan: any;
  formState: FormState | null;
  setFormState: (state: FormState) => void;
  onStepComplete?: (stepId: string, data: any) => void;
  selectedServiceId: string | null;
  serviceCatalogSnapshot: any;
  deterministicStyleStep: any;
  disableLegacyBudgetUploadSteps: boolean;
  localSkeletonMode?: boolean;
  config: any;
  batchingRef: React.MutableRefObject<boolean>;
  sceneUploadJustCompletedRef: React.MutableRefObject<boolean>;
  pendingRefinementPreviewAdvanceRef: React.MutableRefObject<null | { stepId: string; data: any }>;
  pendingRefinementPreviewAdvanceStageRef: React.MutableRefObject<"idle" | "waiting_for_start" | "waiting_for_finish">;
  stepMetaRef: React.MutableRefObject<Map<string, StepMeta>>;
  stepStartRef: React.MutableRefObject<Record<string, number>>;
  lastModelRequestIdRef: React.MutableRefObject<string | null>;
  updateStepData: (stepId: string, data: any) => void;
  addSteps: (steps: any[], autoAdvance?: boolean, options?: { insertAtIndex?: number; moveExisting?: boolean }) => void;
  markStepComplete: (stepId: string) => void;
  goToStep: (stepIndex: number) => void;
  goToNextStep: (data?: any) => Promise<void> | void;
  requestNextBatch: (
    stepDataSoFar: Record<string, any>,
    opts: { showLoading: boolean; wasOnLastStep: boolean; reason: string; onError?: (e: unknown) => void }
  ) => void;
  trackStepComplete: (stepId: string, payload: any) => void;
  setPendingPreviewSceneUploadUrl: (url: string | null) => void;
  setPreviewRefreshNonce: React.Dispatch<React.SetStateAction<number>>;
  setPreviewAutoGenerationPending: (value: boolean) => void;
  refinementUploadStepId: string;
}) {
  const {
    currentStep,
    state,
    answeredRefinementQuestionCount,
    isStepAnsweredForCounts,
    previewHasImage,
    instanceId,
    sessionId,
    flowPlan,
    formState,
    setFormState,
    onStepComplete,
    selectedServiceId,
    serviceCatalogSnapshot,
    deterministicStyleStep,
    disableLegacyBudgetUploadSteps,
    localSkeletonMode = false,
    config,
    batchingRef,
    sceneUploadJustCompletedRef,
    pendingRefinementPreviewAdvanceRef,
    pendingRefinementPreviewAdvanceStageRef,
    stepMetaRef,
    stepStartRef,
    lastModelRequestIdRef,
    updateStepData,
    addSteps,
    markStepComplete,
    goToStep,
    goToNextStep,
    requestNextBatch,
    trackStepComplete,
    setPendingPreviewSceneUploadUrl,
    setPreviewRefreshNonce,
    setPreviewAutoGenerationPending,
    refinementUploadStepId,
  } = args;

  const handleStepComplete = useCallback(
    async (data: any) => {
      if (!currentStep) return;
      const isPricedImageGridStep = currentStep.id === DETERMINISTIC_PRICED_IMAGE_GRID_ID;
      const isRefinementSceneUploadStep = currentStep.id === "step-refinement-upload-scene-image";
      const isSceneUploadStep = currentStep.id === DETERMINISTIC_SCENE_IMAGE_ID || currentStep.id === refinementUploadStepId;
      const isRefinementQuestionStep = Boolean((currentStep as any)?.__refinementStep);
      const wasRefinementQuestionAlreadyAnswered = isRefinementQuestionStep && isStepAnsweredForCounts(currentStep, state?.stepData);
      const nextAnsweredRefinementQuestionCount =
        answeredRefinementQuestionCount +
        (isRefinementQuestionStep && hasMeaningfulAnswer(data) && !wasRefinementQuestionAlreadyAnswered ? 1 : 0);
      const isSceneUploadSkipped =
        isSceneUploadStep &&
        (data === null || data === undefined || data === "__skip__" || data === "" || (Array.isArray(data) && data.length === 0));
      if (isSceneUploadSkipped) setPendingPreviewSceneUploadUrl(null);

      const shouldMirrorRefinementSceneUpload =
        isRefinementSceneUploadStep &&
        typeof data === "string" &&
        (data.startsWith("http://") || data.startsWith("https://") || data.startsWith("data:image/"));
      const shouldPauseForRefinementPreviewRefresh = Boolean(
        previewHasImage &&
          isRefinementQuestionStep &&
          hasMeaningfulAnswer(data) &&
          nextAnsweredRefinementQuestionCount > 0 &&
          nextAnsweredRefinementQuestionCount % 2 === 0
      );
      const uploadedSceneImageUrl =
        isSceneUploadStep &&
        typeof data === "string" &&
        (data.startsWith("http://") || data.startsWith("https://") || data.startsWith("data:image/"))
          ? data
          : null;

      const resolvedStepData = (() => {
        if (!isPricedImageGridStep || typeof data !== "string") return data;
        const selectedOption = Array.isArray((currentStep as any)?.options)
          ? (currentStep as any).options.find((option: any) => String(option?.value || option?.label || "") === data)
          : null;
        if (!selectedOption) return data;
        return {
          value: data,
          label: String(selectedOption?.label || ""),
          imageUrl: typeof selectedOption?.imageUrl === "string" ? selectedOption.imageUrl : data,
          priceRange:
            selectedOption?.priceRange && typeof selectedOption.priceRange === "object"
              ? {
                  low: Number(selectedOption.priceRange.low),
                  high: Number(selectedOption.priceRange.high),
                  currency: typeof selectedOption.priceRange.currency === "string" ? selectedOption.priceRange.currency : "USD",
                }
              : null,
          previewIndex:
            typeof selectedOption?.previewIndex === "number" && Number.isFinite(selectedOption.previewIndex)
              ? selectedOption.previewIndex
              : null,
          previewRunId: typeof selectedOption?.previewRunId === "string" ? selectedOption.previewRunId : null,
        };
      })();

      const persistStepAnswer = () => {
        updateStepData(currentStep.id, resolvedStepData);
        if (
          isPricedImageGridStep &&
          resolvedStepData &&
          typeof resolvedStepData === "object" &&
          typeof (resolvedStepData as any).imageUrl === "string"
        ) {
          updateStepData("__selectedPreviewImage", {
            imageUrl: (resolvedStepData as any).imageUrl,
            priceRange: (resolvedStepData as any).priceRange ?? null,
            selectedAt: Date.now(),
          });
        }
        if (shouldMirrorRefinementSceneUpload) updateStepData(DETERMINISTIC_SCENE_IMAGE_ID, resolvedStepData);
      };

      if (
        isPricedImageGridStep &&
        sessionId &&
        resolvedStepData &&
        typeof resolvedStepData === "object" &&
        typeof (resolvedStepData as any).previewIndex === "number"
      ) {
        updatePreviewCacheSnapshot(instanceId, sessionId, (cache) => {
          if (!cache || !Array.isArray(cache.runs)) return cache;
          const previewRunId = typeof (resolvedStepData as any).previewRunId === "string" ? (resolvedStepData as any).previewRunId : null;
          const nextRunId = previewRunId || cache.activeRunId || cache.runs[cache.runs.length - 1]?.id || null;
          return {
            ...cache,
            activeRunId: nextRunId,
            selectedConceptIndex: Math.max(0, Math.floor((resolvedStepData as any).previewIndex)),
            viewMode: "single",
            updatedAt: Date.now(),
          };
        });
      }

      if (uploadedSceneImageUrl && previewHasImage) {
        setPendingPreviewSceneUploadUrl(uploadedSceneImageUrl);
        setPreviewRefreshNonce((prev) => prev + 1);
      }
      if (shouldPauseForRefinementPreviewRefresh) {
        setPreviewAutoGenerationPending(true);
        setPreviewRefreshNonce((prev) => prev + 1);
      }

      const stepTypeForMetrics = getStepType(currentStep);
      const gateContextForMetrics = normalizeOptionalString((currentStep as any)?.blueprint?.validation?.gate_context);
      const isLeadStepForMetrics = stepTypeForMetrics === "lead_capture" || currentStep.id.startsWith("step-lead");

      if (sessionId) {
        const stepId = currentStep.id;
        const meta = stepMetaRef.current.get(stepId);
        const start = stepStartRef.current[stepId];
        const now = Date.now();
        const latencyMs = typeof start === "number" ? now - start : null;
        if (meta?.modelRequestId) lastModelRequestIdRef.current = meta.modelRequestId;
        const isDeterministic = isStructuralStep(currentStep) || isBootstrapStepIdValue(stepId);
        const stepSource = isDeterministic ? "frontend_deterministic" : meta?.modelRequestId ? "backend_ai" : "unknown";
        const totalSteps = state?.steps?.length || 0;
        const stepNumber = (state?.currentStepIndex ?? 0) + 1;

        emitTelemetry({
          sessionId,
          instanceId,
          eventType: "step_answered",
          stepId,
          batchId: normalizeBatchId(meta?.batchId) ?? batchIdFromIndex(formState?.batchIndex) ?? undefined,
          modelRequestId: meta?.modelRequestId ?? undefined,
          timestamp: now,
          payload: {
            step_number: stepNumber,
            total_steps: totalSteps,
            step_type: stepTypeForMetrics,
            is_deterministic: isDeterministic,
            source: stepSource,
            latency_ms: latencyMs,
            value_type: getValueType(resolvedStepData),
            filled_other: detectFilledOther(resolvedStepData),
            step_json: currentStep,
            answer_value: resolvedStepData,
            has_options: Array.isArray((currentStep as any)?.options),
            options_count: Array.isArray((currentStep as any)?.options) ? (currentStep as any).options.length : 0,
            question: (currentStep as any)?.question || null,
            request_payload: meta?.payloadRequest ?? null,
            response_payload: meta?.payloadResponse ?? null,
            gate_context: gateContextForMetrics,
          },
        });

        if (isLeadStepForMetrics) {
          emitTelemetry({
            sessionId,
            instanceId,
            eventType: "conversion",
            stepId,
            batchId: normalizeBatchId(meta?.batchId) ?? undefined,
            modelRequestId: meta?.modelRequestId ?? undefined,
            timestamp: now,
            payload: {
              step_number: stepNumber,
              total_steps: totalSteps,
              step_type: stepTypeForMetrics,
              is_deterministic: isDeterministic,
              source: stepSource,
              step_json: currentStep,
              conversion_type: "lead_submitted",
              gate_context: gateContextForMetrics,
            },
          });
        }
      }

      trackStepComplete(currentStep.id, {
        droppedOff: false,
        backNavigation: false,
        leadInputCompleted: isLeadStepForMetrics,
        componentType: ("componentType" in currentStep ? currentStep.componentType : "unknown") as any,
        metadata: gateContextForMetrics ? { gate_context: gateContextForMetrics } : undefined,
      });

      if (onStepComplete) onStepComplete(currentStep.id, resolvedStepData);

      const isLastKnownStep = Boolean(state && state.currentStepIndex >= state.steps.length - 1);
      const updatedStepDataSoFar: Record<string, any> = {
        ...(state?.stepData || {}),
        [currentStep.id]: resolvedStepData,
        ...(shouldMirrorRefinementSceneUpload ? { [DETERMINISTIC_SCENE_IMAGE_ID]: resolvedStepData } : {}),
      };
      const nextSelectedServiceId =
        currentStep.id === DETERMINISTIC_SERVICE_ID && typeof data === "string" && data.trim() ? data.trim() : selectedServiceId;
      const nextSelectedServiceMeta =
        nextSelectedServiceId && serviceCatalogSnapshot?.byServiceId ? (serviceCatalogSnapshot.byServiceId as any)[nextSelectedServiceId] : null;
      const nextDeterministicStyleStep = buildDeterministicStyleStep(nextSelectedServiceMeta);
      const localPostServiceSteps =
        localSkeletonMode && currentStep.id === DETERMINISTIC_SERVICE_ID
          ? buildLocalPostServiceSteps(nextSelectedServiceMeta)
          : [];
      let effectiveDeterministicStyleStep = nextDeterministicStyleStep || deterministicStyleStep;
      if (!effectiveDeterministicStyleStep && sessionId) {
        const persistedCatalog = loadServiceCatalog(sessionId);
        const byServiceId = persistedCatalog?.byServiceId;
        if (byServiceId && typeof byServiceId === "object") {
          for (const item of Object.values(byServiceId as Record<string, any>)) {
            const candidate = buildDeterministicStyleStep(item);
            if (candidate) {
              effectiveDeterministicStyleStep = candidate;
              break;
            }
          }
        }
      }
      if (!effectiveDeterministicStyleStep && disableLegacyBudgetUploadSteps) {
        const fallbackServiceOption = await hydrateServiceCatalogFromWidget({
          instanceId,
          sessionId: sessionId || "",
          nextSelectedServiceId: nextSelectedServiceId || null,
        });
        const fallbackStyleStep = buildDeterministicStyleStep(fallbackServiceOption);
        if (fallbackStyleStep) effectiveDeterministicStyleStep = fallbackStyleStep;
      }
      const scopeStepIdsInFlow = (state?.steps || [])
        .map((step: any) => String((step as any)?.id || ""))
        .filter((stepId) => PRE_CONCEPT_SCOPE_STEP_IDS.has(stepId));
      const completesAdventureScopeGate =
        disableLegacyBudgetUploadSteps &&
        PRE_CONCEPT_SCOPE_STEP_IDS.has(currentStep.id) &&
        scopeStepIdsInFlow.length > 0 &&
        scopeStepIdsInFlow.every((stepId) => hasMeaningfulAnswer(updatedStepDataSoFar[stepId]));
      const shouldRouteToAdventureStyleStep =
        !localSkeletonMode &&
        completesAdventureScopeGate &&
        Boolean(effectiveDeterministicStyleStep) &&
        !hasMeaningfulAnswer(updatedStepDataSoFar[DETERMINISTIC_STYLE_ID]);
      const shouldRouteToDeterministicStyleStep =
        !disableLegacyBudgetUploadSteps &&
        currentStep.id === DETERMINISTIC_SERVICE_ID &&
        Boolean(nextDeterministicStyleStep) &&
        !hasMeaningfulAnswer(updatedStepDataSoFar[DETERMINISTIC_STYLE_ID]);

      if (flowPlan?.sessionId && formState) {
        const now = Date.now();
        if (currentStep.id === DETERMINISTIC_FULL_NAME_ID) {
          const fullName = normalizeOptionalString(resolvedStepData);
          const firstName = extractFirstName(fullName);
          const nextState: FormState = {
            ...formState,
            ...(fullName ? { userFullName: fullName } : {}),
            ...(firstName ? { userFirstName: firstName } : {}),
          };
          setFormState(nextState);
          saveFormState(flowPlan.sessionId, nextState);
        }
        if (isLeadStepForMetrics) {
          const email = normalizeOptionalString((resolvedStepData as any)?.email);
          const gateContext = gateContextForMetrics || "design_and_estimate";
          const leadGates = {
            ...(formState.leadGates && typeof formState.leadGates === "object" ? formState.leadGates : {}),
            [gateContext]: {
              ...(formState.leadGates?.[gateContext] || {}),
              completedAt: now,
            },
          };
          const nextState: FormState = {
            ...formState,
            leadCaptured: true,
            ...(email ? { leadEmail: email } : {}),
            leadCapturedAt: formState.leadCapturedAt ?? now,
            leadGates,
          };
          setFormState(nextState);
          saveFormState(flowPlan.sessionId, nextState);
        }
      }

      if (flowPlan?.sessionId && formState && isQuestionStepForAskedIds(currentStep) && hasMeaningfulAnswer(resolvedStepData)) {
        const counted = new Set(formState.metricProgressCountedStepIds || []);
        if (!counted.has(currentStep.id)) {
          counted.add(currentStep.id);
          const nextMetric = clamp01((formState.metricProgress ?? 0) + getMetricGain(currentStep));
          const nextState: FormState = {
            ...formState,
            metricProgress: nextMetric,
            metricProgressCountedStepIds: Array.from(counted),
          };
          setFormState(nextState);
          saveFormState(flowPlan.sessionId, nextState);
        }
      }

      if (isQuestionStepForAskedIds(currentStep)) {
        const alias = legacyAliasKeyForStepId(currentStep.id);
        if (alias && alias !== currentStep.id && (state?.stepData || {})[alias] === undefined) updateStepData(alias, resolvedStepData);
      }

      if (shouldPauseForRefinementPreviewRefresh) {
        persistStepAnswer();
        pendingRefinementPreviewAdvanceRef.current = { stepId: currentStep.id, data: resolvedStepData };
        pendingRefinementPreviewAdvanceStageRef.current = "waiting_for_start";
        return;
      }

      if (localPostServiceSteps.length > 0) {
        persistStepAnswer();
        markStepComplete(currentStep.id);
        addSteps(localPostServiceSteps as any[], true, {
          insertAtIndex: (state?.currentStepIndex ?? 0) + 1,
          moveExisting: true,
        });
        return;
      }

      if (shouldRouteToAdventureStyleStep || shouldRouteToDeterministicStyleStep) {
        const existingStyleIndex = (state?.steps || []).findIndex((step: any) => String((step as any)?.id || "") === DETERMINISTIC_STYLE_ID);
        persistStepAnswer();
        markStepComplete(currentStep.id);
        if (existingStyleIndex >= 0) {
          goToStep(existingStyleIndex);
          return;
        }
        if (effectiveDeterministicStyleStep) {
          addSteps([effectiveDeterministicStyleStep as any], true, {
            insertAtIndex: (state?.currentStepIndex ?? 0) + 1,
            moveExisting: true,
          });
          if (!shouldRouteToAdventureStyleStep) {
            requestNextBatch(updatedStepDataSoFar, { showLoading: false, wasOnLastStep: false, reason: "style-copy" });
          }
          return;
        }
      }

      const prefetchStepsBeforeEndRaw = Number((config as any)?.prefetchStepsBeforeEnd ?? 0);
      const prefetchStepsBeforeEnd = Number.isFinite(prefetchStepsBeforeEndRaw) ? Math.max(0, Math.floor(prefetchStepsBeforeEndRaw)) : 0;
      const currentStepIndex = state?.currentStepIndex ?? -1;
      const totalStepsCount = state?.steps?.length ?? 0;
      const stepsRemaining = Math.max(0, totalStepsCount - 1 - currentStepIndex);
      const hasDeterministicAnswers = deterministicAnswersPresent({ steps: state?.steps, stepData: state?.stepData });
      const isOnLastStep = isLastKnownStep;
      const batchCurrentlyLoading = batchingRef.current;
      const shouldPrefetchNextBatch =
        prefetchStepsBeforeEnd > 0 &&
        hasDeterministicAnswers &&
        !isOnLastStep &&
        !batchCurrentlyLoading &&
        stepsRemaining <= prefetchStepsBeforeEnd;

      if (isOnLastStep) {
        markStepComplete(currentStep.id);
        const hasValidSceneData =
          isSceneUploadStep &&
          !isSceneUploadSkipped &&
          (typeof data === "string"
            ? data.startsWith("http") || data.startsWith("data:image")
            : Array.isArray(data) && data.some((v) => typeof v === "string" && (v.startsWith("http") || v.startsWith("data:image"))));
        if (hasValidSceneData) sceneUploadJustCompletedRef.current = true;
        persistStepAnswer();
        if (!localSkeletonMode && !batchingRef.current) {
          requestNextBatch(updatedStepDataSoFar, {
            showLoading: true,
            wasOnLastStep: true,
            reason: "completed-last-known-step",
          });
        }
        await goToNextStep(resolvedStepData);
        return;
      } else if (shouldPrefetchNextBatch && !batchingRef.current) {
        persistStepAnswer();
        await goToNextStep(resolvedStepData);
      } else {
        await goToNextStep(resolvedStepData);
      }
    },
    [
      addSteps,
      answeredRefinementQuestionCount,
      batchingRef,
      config,
      currentStep,
      deterministicStyleStep,
      disableLegacyBudgetUploadSteps,
      formState,
      flowPlan?.sessionId,
      goToNextStep,
      goToStep,
      instanceId,
      isStepAnsweredForCounts,
      localSkeletonMode,
      markStepComplete,
      onStepComplete,
      pendingRefinementPreviewAdvanceRef,
      pendingRefinementPreviewAdvanceStageRef,
      previewHasImage,
      refinementUploadStepId,
      requestNextBatch,
      sceneUploadJustCompletedRef,
      selectedServiceId,
      serviceCatalogSnapshot,
      sessionId,
      setFormState,
      setPendingPreviewSceneUploadUrl,
      setPreviewAutoGenerationPending,
      setPreviewRefreshNonce,
      state,
      stepMetaRef,
      stepStartRef,
      trackStepComplete,
      updateStepData,
      lastModelRequestIdRef,
    ]
  );

  return { handleStepComplete };
}
