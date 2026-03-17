import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { DEFAULT_IMAGE_PREVIEW_AT_FRACTION } from "../constants";
import { clamp01 } from "../utils/core";
import { countPreviewGateQuestions } from "../utils/step-classification";
import { hasMeaningfulAnswer } from "../utils/step-answers";

interface UsePreviewEligibilityParams {
  addSteps: (steps: any[], append?: boolean, options?: { insertAtIndex?: number }) => void;
  completedQuestionCount: number;
  currentStepId?: string | null;
  /** Upload steps only – used for checking if deterministic uploads are pending. */
  desiredDeterministicUploadSteps: any[];
  /** Full deterministic steps (budget + upload) in order – used when injecting fallback. */
  desiredDeterministicStepsForInsert?: any[];
  flowPlanSessionId?: string | null;
  formStateMetricProgress?: number | null;
  hasReceivedQuestionsFromGenerateSteps: boolean;
  initialQuestionCountSnapshot?: number | null;
  isBootstrapStepId: (stepId: string | null | undefined) => boolean;
  progressPercentage?: number | null;
  previewEverEnabled: boolean;
  setPreviewEverEnabled: Dispatch<SetStateAction<boolean>>;
  state: any;
  updateStepData: (stepId: string, data: any) => void;
  config?: any;
}

export function usePreviewEligibility({
  addSteps,
  completedQuestionCount,
  currentStepId,
  desiredDeterministicUploadSteps,
  desiredDeterministicStepsForInsert,
  flowPlanSessionId,
  formStateMetricProgress,
  hasReceivedQuestionsFromGenerateSteps,
  initialQuestionCountSnapshot,
  isBootstrapStepId,
  progressPercentage,
  previewEverEnabled,
  setPreviewEverEnabled,
  state,
  updateStepData,
  config,
}: UsePreviewEligibilityParams) {
  const previewQuestionCount = useMemo(() => {
    if (!state?.steps) return 0;
    return countPreviewGateQuestions(state.steps);
  }, [state?.steps]);

  const imagePreviewAfterAnsweredQuestionsOverride = useMemo(() => {
    if (typeof window !== "undefined") {
      const raw = new URLSearchParams(window.location.search).get("image_preview_after");
      const n = raw !== null ? Number(raw) : NaN;
      if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
    }
    const cfgRaw = Number((config as any)?.imagePreviewAfterQuestions);
    if (Number.isFinite(cfgRaw)) return Math.max(0, Math.floor(cfgRaw));
    return null;
  }, [config]);

  const imagePreviewAtFraction = useMemo(() => {
    let fraction = DEFAULT_IMAGE_PREVIEW_AT_FRACTION;
    if (typeof window !== "undefined") {
      const raw = new URLSearchParams(window.location.search).get("image_preview_at");
      const n = raw !== null ? Number(raw) : NaN;
      if (Number.isFinite(n)) fraction = n > 1 ? n / 100 : n;
    }
    const cfgFrac = Number((config as any)?.imagePreviewAtFraction);
    if (Number.isFinite(cfgFrac)) fraction = cfgFrac;
    return clamp01(fraction);
  }, [config]);

  const imagePreviewAfterAnsweredQuestions = useMemo(() => {
    if (typeof imagePreviewAfterAnsweredQuestionsOverride === "number") return imagePreviewAfterAnsweredQuestionsOverride;
    const total = Math.max(0, Math.floor(initialQuestionCountSnapshot ?? previewQuestionCount));
    if (total === 0) return Number.MAX_SAFE_INTEGER;
    return Math.max(1, Math.ceil(total * imagePreviewAtFraction));
  }, [imagePreviewAfterAnsweredQuestionsOverride, initialQuestionCountSnapshot, previewQuestionCount, imagePreviewAtFraction]);

  const backendAllowsPreview = Boolean(state?.stepData?.__capabilities?.image_preview === true);
  const backendReadyForImageGen = Boolean(
    (state?.stepData as any)?.__readyForImageGen === true ||
      (typeof (state?.stepData as any)?.__satiety === "number" &&
        Number.isFinite((state?.stepData as any)?.__satiety) &&
        Number((state?.stepData as any)?.__satiety) >= 1)
  );

  const deterministicUploadsPending = useMemo(() => {
    if (!state?.steps || state.steps.length === 0) return false;
    const stepData = state.stepData || {};
    const completed = state.completedSteps;
    const stepIdsInFlow = new Set((state.steps || []).map((s: any) => String((s as any)?.id || "")));

    for (const step of desiredDeterministicUploadSteps) {
      const stepId = String((step as any)?.id || "");
      if (!stepId) continue;
      if (!stepIdsInFlow.has(stepId)) return true;

      const isRequired = (step as any)?.data?.required !== false;
      const hasValue = hasMeaningfulAnswer((stepData as any)?.[stepId]);
      if (isRequired) {
        if (!hasValue) return true;
        continue;
      }
      if (!hasValue && !(completed && typeof (completed as any).has === "function" && (completed as any).has(stepId))) return true;
    }
    return false;
  }, [desiredDeterministicUploadSteps, state?.completedSteps, state?.stepData, state?.steps]);

  useEffect(() => {
    if (!state || !flowPlanSessionId) return;
    const caps = (state.stepData as any)?.__capabilities;
    if (caps && typeof caps === "object" && !Array.isArray(caps) && (caps as any).image_preview === true) return;
    if (!hasReceivedQuestionsFromGenerateSteps) return;
    updateStepData("__capabilities", { ...(caps && typeof caps === "object" ? caps : {}), image_preview: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasReceivedQuestionsFromGenerateSteps, state, flowPlanSessionId]);

  const effectiveFlowProgressFraction = useMemo(() => {
    const metric = typeof formStateMetricProgress === "number" && Number.isFinite(formStateMetricProgress) ? formStateMetricProgress : null;
    if (metric !== null) return clamp01(metric);
    const pct = typeof progressPercentage === "number" && Number.isFinite(progressPercentage) ? progressPercentage : null;
    return pct !== null ? clamp01(pct / 100) : 0;
  }, [formStateMetricProgress, progressPercentage]);

  const frontendPreviewEligibleWithoutDeterministicUploads = useMemo(() => {
    if (!backendAllowsPreview) return false;
    if (isBootstrapStepId(currentStepId)) return false;
    if (backendReadyForImageGen) return true;
    if (typeof imagePreviewAfterAnsweredQuestionsOverride === "number") {
      if (completedQuestionCount < imagePreviewAfterAnsweredQuestionsOverride) return false;
      return true;
    }
    if (effectiveFlowProgressFraction < imagePreviewAtFraction) return false;
    return true;
  }, [
    backendAllowsPreview,
    backendReadyForImageGen,
    completedQuestionCount,
    currentStepId,
    effectiveFlowProgressFraction,
    imagePreviewAfterAnsweredQuestionsOverride,
    imagePreviewAtFraction,
    isBootstrapStepId,
  ]);

  const frontendPreviewEligible = useMemo(() => {
    if (!frontendPreviewEligibleWithoutDeterministicUploads) return false;
    if (deterministicUploadsPending) return false;
    return true;
  }, [deterministicUploadsPending, frontendPreviewEligibleWithoutDeterministicUploads]);

  useEffect(() => {
    if (!flowPlanSessionId) return;
    if (!state?.steps || state.steps.length === 0) return;
    if (!frontendPreviewEligibleWithoutDeterministicUploads) return;
    if (!deterministicUploadsPending) return;

    const stepsToAdd = Array.isArray(desiredDeterministicStepsForInsert) && desiredDeterministicStepsForInsert.length > 0
      ? desiredDeterministicStepsForInsert
      : desiredDeterministicUploadSteps;
    const desiredIds = stepsToAdd.map((s: any) => String(s?.id || "")).filter(Boolean);
    if (desiredIds.length === 0) return;

    const existing = new Set((state.steps || []).map((s: any) => String((s as any)?.id || "")));
    const missing = desiredIds.filter((id) => !existing.has(id));
    if (missing.length === 0) return;

    const afterCurrent = Math.max(0, (state.currentStepIndex ?? 0) + 1);
    addSteps(stepsToAdd, false, { insertAtIndex: afterCurrent });
  }, [
    addSteps,
    desiredDeterministicUploadSteps,
    desiredDeterministicStepsForInsert,
    deterministicUploadsPending,
    flowPlanSessionId,
    frontendPreviewEligibleWithoutDeterministicUploads,
    state,
  ]);

  useEffect(() => {
    if (frontendPreviewEligible) setPreviewEverEnabled(true);
  }, [frontendPreviewEligible, setPreviewEverEnabled]);

  const previewEnabled =
    hasReceivedQuestionsFromGenerateSteps &&
    backendAllowsPreview &&
    !isBootstrapStepId(currentStepId) &&
    (previewEverEnabled || frontendPreviewEligible);

  return {
    backendAllowsPreview,
    backendReadyForImageGen,
    effectiveFlowProgressFraction,
    frontendPreviewEligible,
    frontendPreviewEligibleWithoutDeterministicUploads,
    imagePreviewAfterAnsweredQuestions,
    imagePreviewAfterAnsweredQuestionsOverride,
    imagePreviewAtFraction,
    previewEnabled,
    previewQuestionCount,
  };
}
