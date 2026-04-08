"use client";

// Step Engine - Main component that orchestrates the form flow
import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useSearchParams } from "next/navigation";
import { useStepEngine } from '@/hooks/use-step-engine';
import { useFormMetrics } from '@/hooks/use-form-metrics';
import { FlowPlan, FormState, UIStep } from '@/types/ai-form';
import { useFormTheme } from '../../demo/FormThemeProvider';
import { emitFeedback, emitTelemetry } from '@/lib/ai-form/telemetry';
import { isDevModeEnabled } from '@/lib/ai-form/dev-mode';
import { DevModeOverlay, type DevModeStats, type DevModeUIState } from '../../dev-helpers/DevModeOverlay';
import { loadServiceCatalog } from '@/lib/ai-form/state/service-catalog-storage';
import { AdventureLoader } from "../../AdventureLoader";
import { Button } from "@/components/ui/button";
import { collectReferenceImagesFromStepData } from "@/lib/ai-form/utils/reference-images";
import { useExperienceState } from "@/components/form/state/ExperienceState";
import { usePreviewEligibility } from "./step-engine/hooks/usePreviewEligibility";
import { usePreviewLayout } from "./step-engine/hooks/usePreviewLayout";
import { usePreviewCacheBridge } from "./step-engine/hooks/usePreviewCacheBridge";
import { useForceLightDocumentTheme } from "./step-engine/hooks/useForceLightDocumentTheme";
import { useStepEngineUiConfig } from "./step-engine/hooks/useStepEngineUiConfig";
import { useStepEngineBudget } from "./step-engine/hooks/useStepEngineBudget";
import { useRefinementOrchestration } from "./step-engine/hooks/useRefinementOrchestration";
import { useStepNavigation } from "./step-engine/hooks/useStepNavigation";
import { useStepEngineDropoffTelemetry } from "./step-engine/hooks/useStepEngineTelemetry";
import { useStepCompletion } from "./step-engine/hooks/useStepCompletion";
import { useStepEngineFunctionCalls } from "./step-engine/hooks/useStepEngineFunctionCalls";
import { StepEngineHeaderSection } from "./step-engine/sections/StepEngineHeaderSection";
import { StepEngineBodySection } from "./step-engine/sections/StepEngineBodySection";
import { buildDeterministicStyleStep } from "../static/deterministic-style-step";
import {
  buildDeterministicPricedImageGridStep,
  DETERMINISTIC_PRICED_IMAGE_GRID_ID,
} from "../static/deterministic-priced-image-grid-step";
import {
  DETERMINISTIC_BUDGET_ID,
  DETERMINISTIC_FULL_NAME_ID,
  DETERMINISTIC_PRODUCT_IMAGE_ID,
  DETERMINISTIC_SCENE_IMAGE_ID,
  DETERMINISTIC_SERVICE_ID,
  DETERMINISTIC_STYLE_ID,
  PRE_CONCEPT_SCOPE_STEP_IDS,
  DETERMINISTIC_USER_IMAGE_ID,
  FORM_STATE_SCHEMA_VERSION,
  PRICING_ESTIMATE_KEY,
} from "./step-engine/constants";
import { clamp01, fnv1a32, joinSummaries, mergeUniqueStrings, normalizeOptionalString } from "./step-engine/utils/core";
import type { Suggestion } from "@/types";
import { inferSuggestionToolbarMode } from "@/lib/suggestion-toolbar";
import {
  getActivePreviewRunSnapshot,
  updatePreviewCacheSnapshot,
} from "../image-preview-experience/gallery/preview-cache-bridge";
import { buildLeadCaptureStep } from "@/lib/ai-form/components/structural-steps";
import {
  type FunctionCallOutput,
} from "./step-engine/utils/function-calls";
import { loadFormState, normalizeFormState, saveFormState } from "./step-engine/utils/form-state";
import { extractFirstName, personalizeStepCopy } from "./step-engine/utils/personalization";
import { buildAnsweredQA, getMetricGain } from "./step-engine/utils/pricing-context";
import { normalizePricingEstimate } from "./step-engine/utils/pricing-estimate";
import { buildStepJoggerSteps } from "./step-engine/utils/step-jogger";
import {
  fetchAndAppendGenerateStepsBatch,
} from "./step-engine/utils/generate-steps-batch";
import { LOCAL_SKELETON_FLOW_MODE } from "./step-engine/utils/build-local-skeleton";
import {
  countPreviewGateQuestions,
  isBootstrapStepIdValue,
  isPreviewGateQuestionStep,
  isQuestionStepForAskedIds,
  isStructuralStep,
} from "./step-engine/utils/step-classification";
import {
  batchIdFromIndex,
  detectFilledOther,
  deterministicAnswersPresent,
  getStepType,
  getValueType,
  hasMeaningfulAnswer,
  legacyAliasKeyForStepId,
  normalizeBatchId,
  pickPrimaryServiceId,
} from "./step-engine/utils/step-answers";

type StepMeta = {
  batchId?: string | null;
  modelRequestId?: string | null;
  payloadRequest?: any | null;
  payloadResponse?: any | null;
};

interface StepEngineProps {
  instanceId: string;
  /**
   * Scope key used for session-manager caching.
   * Usually equals `instanceId`, but demo/adventure surfaces may namespace it.
   */
  sessionScopeKey?: string;
  flowPlan: FlowPlan | null;
  onFlowComplete?: (allData: Record<string, any>) => void;
  onStepComplete?: (stepId: string, data: any) => void;
  entrySource?: string;
  sessionGoal?: string;
  flowLayout?: {
    /** Defaults to true when undefined. */
    showProgressBar?: boolean;
    /** Defaults to true when undefined. */
    showStepNumbers?: boolean;
  } | null;
  formUI?: {
    /** `instances.config.form_show_progress_bar` (defaults to true when undefined). */
    showProgressBar?: boolean;
    /** `instances.config.form_show_step_descriptions` (defaults to true when undefined). */
    showStepDescriptions?: boolean;
  } | null;
  config?: {
    businessContext?: string;
    industry?: string;
    useCase?: string;
    previewPricing?: { totalMin: number; totalMax: number; currency?: string; randomizePct?: number };
    leadCaptureRequired?: boolean;
  };
  /** Disable deprecated pre-image budget/upload legacy steps (Adventure route). */
  disableLegacyBudgetUploadSteps?: boolean;
  /** When true, render widget-style branding header above the step jogger. */
  showBrandingHeader?: boolean;
  onMeta?: (meta: { [key: string]: any }) => void;
}

export function StepEngine({
  instanceId,
  sessionScopeKey,
  flowPlan,
  onFlowComplete,
  onStepComplete,
  entrySource,
  sessionGoal,
  flowLayout,
  formUI,
  config,
  disableLegacyBudgetUploadSteps = false,
  showBrandingHeader = false,
  onMeta
}: StepEngineProps) {
  const {
    excludedAdventureStepIds,
    legacyBudgetUploadEnabled,
    showProgressBar,
    showStepDescriptions,
    effectiveSessionScopeKey,
  } = useStepEngineUiConfig({
    instanceId,
    sessionScopeKey,
    disableLegacyBudgetUploadSteps,
    flowLayout,
    formUI,
  });
  const REFINEMENT_UPLOAD_STEP_ID = "step-refinement-upload-scene-image";
  const { setFacts } = useExperienceState();
  const searchParams = useSearchParams();
  const { theme, config: designConfig } = useFormTheme();
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const batchingRef = useRef(false);
  const initialAutofetchRef = useRef(false);
  const inFlightBatchIndexesRef = useRef<Set<number>>(new Set());
  const completedBatchIndexesRef = useRef<Set<number>>(new Set());
  const [maxVisitedIndex, setMaxVisitedIndex] = useState(0);
  const [formState, setFormState] = useState<FormState | null>(null);
  const leadCapturedForUI = Boolean(formState?.leadCaptured);
  // Mirrors instances.config.lead_capture_enabled via extractAIFormConfig → leadCaptureRequired.
  const previewLeadGateActive = config?.leadCaptureRequired !== false;
  const effectiveLeadCompleteForPreviewFlow = leadCapturedForUI || !previewLeadGateActive;
  // Backend-owned call cap for this session. Not persisted; not hard-coded.
  const backendMaxCallsRef = useRef<number | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const stepMetaRef = useRef<Map<string, StepMeta>>(new Map());
  const stepStartRef = useRef<Record<string, number>>({});
  const prevIndexRef = useRef<number | null>(null);
  const lastBatchMetaRef = useRef<StepMeta | null>(null);
  const lastModelRequestIdRef = useRef<string | null>(null);
  const pendingBatchTraceRef = useRef<{ requestPayload?: any; responsePayload?: any } | null>(null);
  const flowCompletedRef = useRef(false);
  const functionCallInFlightRef = useRef<Set<string>>(new Set());
  const functionCallOutputsRef = useRef<Record<string, FunctionCallOutput>>({});
  const [flowCompleted, setFlowCompleted] = useState(false);
  const [easeFeedbackSent, setEaseFeedbackSent] = useState(false);
  const [reflectionFeedbackSent, setReflectionFeedbackSent] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewHasImage, setPreviewHasImage] = useState(false);
  const [previewSurfaceMode, setPreviewSurfaceMode] = useState<"gallery" | "single" | "empty">("empty");
  /** Last mode reported by ImagePreviewExperience — used to detect entering single view (e.g. gallery → single). */
  const previewSurfaceReportedRef = useRef<"gallery" | "single" | "empty">("empty");
  /** `previewEnabled` is derived later via `usePreviewEligibility`; back-handler reads this ref on click. */
  const previewEnabledForBackNavRef = useRef(false);
  const [, setPreviewAdvanceGateOpen] = useState(false);
  const pendingPreviewAdvanceRef = useRef<null | { stepId: string; data: any }>(null);
  const leadCapturedAdvancedRef = useRef(false);
  const leadCapturedAdvanceStepIdRef = useRef<string | null>(null);
  const leadGateLocksQuestionAreaRef = useRef(false);
  /** When true, we just completed a scene upload step and are fetching the next batch; prefer preview "generating" loader over "Getting you accurate pricing..." to avoid overlapping loaders. */
  const sceneUploadJustCompletedRef = useRef(false);
  const [adventureInputMode, setAdventureInputMode] = useState<
    "questions" | "ideas" | "prompt" | "budget" | "uploads"
  >("questions");
  const [designControlsRevealed, setDesignControlsRevealed] = useState(false);
  const [questionPaneRevealedByUser, setQuestionPaneRevealedByUser] = useState(false);
  const previewPaneAutoCollapsedRef = useRef(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptSubmitCount, setPromptSubmitCount] = useState(0);
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0);
  const [previewAutoGenerationPending, setPreviewAutoGenerationPending] = useState(false);
  const [previewAutoGenerationBusy, setPreviewAutoGenerationBusy] = useState(false);
  const pendingRefinementPreviewAdvanceRef = useRef<null | { stepId: string; data: any }>(null);
  const pendingRefinementPreviewAdvanceStageRef = useRef<"idle" | "waiting_for_start" | "waiting_for_finish">("idle");
  const [pendingPreviewSceneUploadUrl, setPendingPreviewSceneUploadUrl] = useState<string | null>(null);
  // Once the preview experience is enabled, keep it enabled (avoids flicker if total steps change as new batches load).
  const [previewEverEnabled, setPreviewEverEnabled] = useState(false);
  // Snapshot the initial question count from the first `generate-steps` response so the 60% gate
  // doesn't shift around as we append more AI batches later.
  const [initialQuestionCountSnapshot, setInitialQuestionCountSnapshot] = useState<number | null>(null);
  // Never show image preview until we have received at least one generate-steps response that returned steps.
  const [hasReceivedQuestionsFromGenerateSteps, setHasReceivedQuestionsFromGenerateSteps] = useState(false);
  const devModeEnabled = useMemo(() => isDevModeEnabled(), []);
  const layoutDebugEnabled = useMemo(() => {
    const v = (searchParams.get("layout_debug") || "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }, [searchParams]);
  const previousSelectedServiceIdRef = useRef<string | null>(null);
  const pricedGridPresentedRunIdRef = useRef<string | null>(null);
  
  const { trackStepStart, trackStepComplete } = useFormMetrics({
    instanceId,
    sessionId: flowPlan?.sessionId || '',
    entrySource,
    sessionGoal
  });
	  const contextExtra = useMemo(() => ({ useCase: config?.useCase }), [config?.useCase]);
	  const sessionId = flowPlan?.sessionId || "";
  const localSkeletonMode = flowPlan?.mode === LOCAL_SKELETON_FLOW_MODE;
  const { previewCacheSnapshot } = usePreviewCacheBridge({ instanceId, sessionId });
  useForceLightDocumentTheme();

  const handleFlowComplete = useCallback(
    (allData: Record<string, any>) => {
      if (flowCompletedRef.current) return;
      flowCompletedRef.current = true;
      setFlowCompleted(true);
      if (localSkeletonMode) {
        if (instanceId && sessionId) {
          updatePreviewCacheSnapshot(instanceId, sessionId, (cache) => {
            const activeRun = getActivePreviewRunSnapshot(cache);
            if (!cache || !activeRun || !Array.isArray(activeRun.images) || activeRun.images.length === 0) {
              return cache;
            }
            const maxIndex = Math.max(0, activeRun.images.length - 1);
            const rawSelectedIndex =
              typeof cache.selectedConceptIndex === "number" && Number.isFinite(cache.selectedConceptIndex)
                ? Math.floor(cache.selectedConceptIndex)
                : 0;
            const nextSelectedIndex = Math.max(0, Math.min(maxIndex, rawSelectedIndex));
            return {
              ...cache,
              activeRunId: activeRun.id,
              selectedConceptIndex: nextSelectedIndex,
              viewMode: "single",
              status: cache.status === "running" ? "complete" : cache.status,
              message: null,
              error: null,
              updatedAt: Date.now(),
            };
          });
        }
        setPreviewEverEnabled(true);
        setPreviewVisible(true);
      }

      if (sessionId) {
        emitTelemetry({
          sessionId,
          instanceId,
          eventType: "form_completed",
          timestamp: Date.now(),
          payload: {
            total_answers: Object.keys(allData || {}).length,
          },
        });
        emitTelemetry({
          sessionId,
          instanceId,
          eventType: "conversion",
          timestamp: Date.now(),
          payload: {
            conversion_type: "form_completed",
          },
        });
      }

      if (onFlowComplete) {
        onFlowComplete(allData);
      }
    },
    [instanceId, localSkeletonMode, onFlowComplete, sessionId]
  );

  const {
    state,
    isLoading: engineLoading,
    isFetchingNext,
    error: engineError,
    contextState,
    currentStep,
    progress,
    goToNextStep,
    goToPreviousStep,
    goToStep,
    addSteps,
    removeStepsByIds,
    updateStepData,
    patchStep,
    markStepComplete,
    removeContextEntry,
  } = useStepEngine({
    instanceId,
    sessionScopeKey: effectiveSessionScopeKey,
    flowPlan,
    onFlowComplete: handleFlowComplete,
    extra: contextExtra,
    excludedStepIds: excludedAdventureStepIds,
    // Local skeleton: never wait for JIT generate-steps batching; only image-gen / structural append paths apply.
    isReady: localSkeletonMode,
  });
  const {
    budgetSliderConfig,
    budgetValue,
    deterministicBudgetStep,
    desiredDeterministicUploadSteps,
    handleBudgetChange,
    normalizedUseCase,
  } = useStepEngineBudget({
    config,
    stateStepData: state?.stepData,
    stateSteps: state?.steps || [],
    instanceId,
    sessionId,
    hasReceivedQuestionsFromGenerateSteps,
    legacyBudgetUploadEnabled,
    updateStepData,
  });

  const applyIdeaSuggestion = useCallback(
    (s: Suggestion) => {
      const target = inferSuggestionToolbarMode(s);
      if (target === "budget") {
        setAdventureInputMode("budget");
        if (typeof budgetValue === "number" && Number.isFinite(budgetValue) && budgetSliderConfig) {
          const { min, max, step } = budgetSliderConfig;
          const raw = Math.min(max, budgetValue + 3000);
          if (raw > budgetValue) {
            const snapped = Math.round((raw - min) / step) * step + min;
            handleBudgetChange(Math.min(max, snapped));
          }
        }
        setPreviewRefreshNonce((n) => n + 1);
        return;
      }
      if (target === "uploads") {
        setAdventureInputMode("uploads");
        return;
      }
      setPromptDraft(String(s.prompt || s.text || "").trim());
      setPromptSubmitCount((c) => c + 1);
      setPreviewRefreshNonce((c) => c + 1);
    },
    [budgetSliderConfig, budgetValue, handleBudgetChange]
  );

  const serviceCatalogSnapshot = useMemo(
    () => (sessionId ? loadServiceCatalog(sessionId) : null),
    [sessionId, state?.stepData]
  );
  const selectedServiceId = useMemo(
    () => pickPrimaryServiceId((state?.stepData || {}) as Record<string, any>),
    [state?.stepData]
  );
  const scopeStepIdsInFlow = useMemo(
    () =>
      (state?.steps || [])
        .map((step: any) => String((step as any)?.id || ""))
        .filter((stepId) => PRE_CONCEPT_SCOPE_STEP_IDS.has(stepId)),
    [state?.steps]
  );
  const scopePricingReady = useMemo(
    () =>
      Boolean(
        selectedServiceId &&
          scopeStepIdsInFlow.length > 0 &&
          scopeStepIdsInFlow.every((stepId) => hasMeaningfulAnswer((state?.stepData || {})[stepId]))
      ),
    [scopeStepIdsInFlow, selectedServiceId, state?.stepData]
  );
  const scopePricingHash = useMemo(() => {
    if (!scopePricingReady || !selectedServiceId) return "";
    const scopeAnswers = Object.fromEntries(
      scopeStepIdsInFlow.map((stepId) => [stepId, (state?.stepData || {})[stepId] ?? null])
    );
    try {
      return fnv1a32(
        JSON.stringify({
          serviceId: selectedServiceId,
          useCase: config?.useCase ?? null,
          scopeAnswers,
        })
      );
    } catch {
      return "";
    }
  }, [config?.useCase, scopePricingReady, scopeStepIdsInFlow, selectedServiceId, state?.stepData]);
  const selectedServiceMeta = selectedServiceId ? (serviceCatalogSnapshot?.byServiceId as any)?.[selectedServiceId] : null;
  const activePreviewRun = useMemo(
    () => getActivePreviewRunSnapshot(previewCacheSnapshot),
    [previewCacheSnapshot]
  );
  const pricedImageGridStep = useMemo(
    () =>
      buildDeterministicPricedImageGridStep({
        cache: previewCacheSnapshot,
        run: activePreviewRun,
      }),
    [activePreviewRun, previewCacheSnapshot]
  );
  const deterministicStyleStep = useMemo(() => {
    const fromSelected = buildDeterministicStyleStep(selectedServiceMeta);
    if (fromSelected) return fromSelected;
    const byServiceId = serviceCatalogSnapshot?.byServiceId;
    if (byServiceId && typeof byServiceId === "object") {
      for (const item of Object.values(byServiceId as Record<string, any>)) {
        const candidate = buildDeterministicStyleStep(item);
        if (candidate) return candidate;
      }
    }
    return buildDeterministicStyleStep(null);
  }, [selectedServiceMeta, serviceCatalogSnapshot]);

  const { awaitingRefinementAdvance } = useRefinementOrchestration({
    previewHasImage,
    flowPlanSessionId: flowPlan?.sessionId,
    instanceId,
    effectiveLeadCompleteForPreviewFlow,
    addSteps,
    currentStep,
    patchStep,
    stateCurrentStepIndex: state?.currentStepIndex ?? 0,
    stateStepData: state?.stepData,
    stateSteps: state?.steps || [],
    isStructuralStep,
    goToStep,
    goToNextStep,
    refinementUploadStepId: REFINEMENT_UPLOAD_STEP_ID,
    pendingRefinementPreviewAdvanceRef,
    pendingRefinementPreviewAdvanceStageRef,
    previewAutoGenerationBusy,
  });

  const effectiveCurrentStep = useMemo(
    () => (currentStep ? personalizeStepCopy(currentStep, state?.stepData || {}, formState) : currentStep),
    [currentStep, formState, state?.stepData]
  );

  // Keep image_choice_grid as-is in preview mode so price_tier badges and option images remain visible.
  // The previous downgrade to multiple_choice was hiding budget/quality cues from the user.
  const stepForRenderer = useMemo(() => {
    return effectiveCurrentStep;
  }, [effectiveCurrentStep]);

  // --- Progressive option thumbnails (current + next step) ---
  const optionImageInFlightRef = useRef<Set<string>>(new Set());

  const shouldProgressivelyGenerateOptionImages = useCallback((step: any): boolean => {
    // Option images disabled for now; keep capability for future use.
    if (true) return false;
    if (!step || typeof step !== "object") return false;
    if ((step as any)?.functionCall) return false;
    const type = String((step as any)?.type || "").toLowerCase();
    if (type !== "multiple_choice") return false;
    // Skip when step has no options (e.g. refinement steps before options are loaded)
    const opts = (step as any)?.options;
    if (!Array.isArray(opts) || opts.length === 0) return false;
    const id = String((step as any)?.id || "");
    if (!id) return false;
    const options = Array.isArray((step as any)?.options) ? (step as any).options : [];
    if (options.length < 2) return false;
    if (options.length > 12) return false;
    // Skip if any option already has an imageUrl.
    if (options.some((o: any) => o && typeof o === "object" && typeof o.imageUrl === "string" && o.imageUrl.trim())) return false;
    const k = id.toLowerCase();
    // Keep heuristic simple + stable: only clearly-visual preference steps.
    return [
      "style",
      "direction",
      "color",
      "palette",
      "tone",
      "finish",
      "material",
      "shape",
      "pattern",
      "texture",
      "look",
      "vibe",
      "lighting",
      "fixture",
      "hardware",
      "cabinet",
      "backsplash",
      "tile",
      "countertop",
      "flooring",
      "sink",
      "faucet",
      "vanity",
      "mirror",
      "appliance",
    ].some((needle) => k.includes(needle));
  }, []);

  const applyOptionImagesToStep = useCallback(
    (stepId: string, optionsWithImages: any[]) => {
      if (!stepId || !Array.isArray(optionsWithImages)) return;
      const map = new Map<string, string>();
      for (const o of optionsWithImages) {
        if (!o || typeof o !== "object") continue;
        const label = typeof o.label === "string" ? o.label : "";
        const value = typeof o.value === "string" ? o.value : "";
        const img =
          typeof o.imageUrl === "string"
            ? o.imageUrl
            : typeof (o as any).image_url === "string"
              ? (o as any).image_url
              : typeof (o as any).image === "string"
                ? (o as any).image
                : "";
        if (img && (label || value)) map.set(value || label, img);
      }
      if (map.size === 0) return;
      const current = (state?.steps || []).find((s: any) => s?.id === stepId) as any;
      if (!current) return;
      const prevOpts = Array.isArray(current?.options) ? current.options : [];
      const nextOpts = prevOpts.map((o: any) => {
        if (!o || typeof o !== "object") return o;
        const key = String(o.value || o.label || "");
        const img = map.get(key);
        return img ? { ...o, imageUrl: img } : o;
      });
      const anyHasImage = nextOpts.some((o: any) => o && typeof o === "object" && typeof o.imageUrl === "string" && o.imageUrl.trim());
      if (!anyHasImage) return;
      patchStep(stepId, { type: "image_choice_grid", options: nextOpts });
    },
    [patchStep, state?.steps]
  );

  const optionImageReferenceImages = useMemo(
    () => collectReferenceImagesFromStepData((state?.stepData ?? {}) as Record<string, any>, 6),
    [state?.stepData]
  );

  const requestOptionImagesForStep = useCallback(
    async (step: any) => {
      if (!sessionId || !instanceId || !step) return;
      const stepId = String(step.id || "");
      if (!stepId) return;
      const inFlightKey = `${sessionId}:${stepId}`;
      if (optionImageInFlightRef.current.has(inFlightKey)) return;
      optionImageInFlightRef.current.add(inFlightKey);
      try {
        const serviceSummary =
          typeof (formState as any)?.serviceSummary === "string"
            ? String((formState as any).serviceSummary).trim()
            : typeof (state?.stepData as any)?.__serviceSummary === "string"
              ? String((state?.stepData as any).__serviceSummary).trim()
              : null;
        const res = await fetch(`/api/ai-form/${instanceId}/option-images/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId,
            stepId,
            step: { id: stepId, question: (step as any)?.question, options: (step as any)?.options },
            serviceSummary,
            // Pass current step data so the image generator can calibrate to the user's budget tier.
            stepDataSoFar: state?.stepData ?? {},
            referenceImages: optionImageReferenceImages,
          }),
        });
        const json = await res.json().catch(() => null);
        if (json && json.ok && Array.isArray(json.options)) {
          applyOptionImagesToStep(stepId, json.options);
        }
      } catch {
        // Best-effort only
      } finally {
        optionImageInFlightRef.current.delete(inFlightKey);
      }
    },
    [applyOptionImagesToStep, formState, instanceId, optionImageReferenceImages, sessionId, state?.stepData]
  );

  useEffect(() => {
    if (!sessionId || !instanceId || !state?.steps || state.steps.length === 0) return;
    const idx = state.currentStepIndex ?? 0;
    const candidates = [state.steps[idx], state.steps[idx + 1]].filter(Boolean) as any[];
    for (const step of candidates) {
      if (shouldProgressivelyGenerateOptionImages(step)) {
        void requestOptionImagesForStep(step);
      }
    }
  }, [
    instanceId,
    requestOptionImagesForStep,
    sessionId,
    shouldProgressivelyGenerateOptionImages,
    state?.currentStepIndex,
    state?.steps,
  ]);

  // Prefetch option images for all refinement steps as soon as first preview image is ready.
  // This ensures refinement choice images are loaded by the time the user reaches those steps.
  useEffect(() => {
    if (!previewHasImage || !sessionId || !instanceId || !state?.steps || state.steps.length === 0) return;
    for (const step of state.steps) {
      if (shouldProgressivelyGenerateOptionImages(step)) {
        void requestOptionImagesForStep(step);
      }
    }
  }, [
    instanceId,
    previewHasImage,
    requestOptionImagesForStep,
    sessionId,
    shouldProgressivelyGenerateOptionImages,
    state?.steps,
  ]);

  useEffect(() => {
    if (!sessionId || !instanceId || !state?.steps?.length) return;
    if (!pricedImageGridStep) return;

    const existingIndex = state.steps.findIndex((step: any) => String((step as any)?.id || "") === DETERMINISTIC_PRICED_IMAGE_GRID_ID);
    if (existingIndex >= 0) {
      patchStep(DETERMINISTIC_PRICED_IMAGE_GRID_ID, pricedImageGridStep as any);
      return;
    }

    const stepsToInsert: UIStep[] = [pricedImageGridStep as UIStep];
    if (!effectiveLeadCompleteForPreviewFlow && !state.steps.some((step: any) => String((step as any)?.id || "") === "step-lead-capture")) {
      stepsToInsert.push(buildLeadCaptureStep({ mode: "email", requiredInputs: ["email"], compact: true, gateContext: "estimate" }) as UIStep);
    }
    addSteps(stepsToInsert, false, {
      insertAtIndex: Math.min(state.steps.length, (state.currentStepIndex ?? 0) + 1),
    });
  }, [
    addSteps,
    effectiveLeadCompleteForPreviewFlow,
    instanceId,
    patchStep,
    pricedImageGridStep,
    sessionId,
    state?.currentStepIndex,
    state?.steps,
  ]);

  useEffect(() => {
    if (!activePreviewRun?.id) return;
    if (!state?.steps?.length) return;
    const pricedAnswer = (state.stepData as any)?.[DETERMINISTIC_PRICED_IMAGE_GRID_ID];
    const answeredRunId =
      pricedAnswer && typeof pricedAnswer === "object" && typeof (pricedAnswer as any).previewRunId === "string"
        ? String((pricedAnswer as any).previewRunId)
        : null;
    if (hasMeaningfulAnswer(pricedAnswer) && answeredRunId === activePreviewRun.id) return;
    if (hasMeaningfulAnswer(pricedAnswer) && answeredRunId && answeredRunId !== activePreviewRun.id) {
      // New preview run generated: force a fresh priced-image selection for this run.
      updateStepData(DETERMINISTIC_PRICED_IMAGE_GRID_ID, null);
      updateStepData("__selectedPreviewImage", null);
    }
    if (!hasMeaningfulAnswer(pricedAnswer)) {
      const rawIndex =
        typeof previewCacheSnapshot?.selectedConceptIndex === "number" && Number.isFinite(previewCacheSnapshot.selectedConceptIndex)
          ? Math.floor(previewCacheSnapshot.selectedConceptIndex)
          : previewCacheSnapshot?.viewMode === "single"
            ? 0
            : null;
      if (rawIndex !== null && Array.isArray(activePreviewRun.images) && activePreviewRun.images.length > 0) {
        const previewIndex = Math.max(0, Math.min(activePreviewRun.images.length - 1, rawIndex));
        const imageUrl = typeof activePreviewRun.images[previewIndex] === "string" ? activePreviewRun.images[previewIndex] : null;
        if (imageUrl) {
          const selectedPricing = Array.isArray((activePreviewRun as any).imagePricing)
            ? (activePreviewRun as any).imagePricing?.[previewIndex]
            : null;
          const lowRaw = Number((selectedPricing as any)?.totalMin);
          const highRaw = Number((selectedPricing as any)?.totalMax);
          const normalizedPriceRange =
            Number.isFinite(lowRaw) && Number.isFinite(highRaw)
              ? {
                  low: Math.max(0, Math.min(lowRaw, highRaw)),
                  high: Math.max(0, Math.max(lowRaw, highRaw)),
                  currency:
                    typeof (selectedPricing as any)?.currency === "string" && String((selectedPricing as any).currency).trim()
                      ? String((selectedPricing as any).currency).trim().toUpperCase()
                      : "USD",
                }
              : null;
          updateStepData(DETERMINISTIC_PRICED_IMAGE_GRID_ID, {
            value: imageUrl,
            label: `Similar project ${previewIndex + 1}`,
            imageUrl,
            priceRange: normalizedPriceRange,
            previewIndex,
            previewRunId: activePreviewRun.id,
          });
          updateStepData("__selectedPreviewImage", {
            imageUrl,
            priceRange: normalizedPriceRange,
            selectedAt: Date.now(),
          });
          return;
        }
      }
    }
    if (leadCapturedForUI) return;
    if (!questionPaneRevealedByUser && !designControlsRevealed) return;
    const pricedIndex = state.steps.findIndex((step: any) => String((step as any)?.id || "") === DETERMINISTIC_PRICED_IMAGE_GRID_ID);
    if (pricedIndex < 0) return;
    const currentIndex = state.currentStepIndex ?? 0;
    // Respect explicit backtracking. If the user navigates to a step before the priced grid,
    // do not immediately force them back into the gallery selection step.
    if (currentIndex < pricedIndex) return;
    if (currentStep?.id === DETERMINISTIC_PRICED_IMAGE_GRID_ID || currentStep?.id === "step-lead-capture") return;
    if (pricedGridPresentedRunIdRef.current === activePreviewRun.id && currentIndex === pricedIndex) return;
    pricedGridPresentedRunIdRef.current = activePreviewRun.id;
    goToStep(pricedIndex);
  }, [
    activePreviewRun,
    activePreviewRun?.id,
    currentStep?.id,
    goToStep,
    leadCapturedForUI,
    designControlsRevealed,
    previewCacheSnapshot?.selectedConceptIndex,
    previewCacheSnapshot?.viewMode,
    questionPaneRevealedByUser,
    updateStepData,
    state?.currentStepIndex,
    state?.stepData,
    state?.steps,
  ]);
  // Auto-skip deterministic upload steps that have already been answered (image already uploaded).
  // When the user uploads a file, the step gets an answer. On subsequent visits/renders the step
  // would reappear; we silently advance past it so the upload thumbnail in the preview takes over.
  useEffect(() => {
    if (!currentStep) return;
    const uploadStepIds = [DETERMINISTIC_SCENE_IMAGE_ID, DETERMINISTIC_USER_IMAGE_ID, DETERMINISTIC_PRODUCT_IMAGE_ID];
    if (!uploadStepIds.includes(currentStep.id)) return;
    const existingValue = state?.stepData?.[currentStep.id];
    if (!existingValue) return;
    void goToNextStep(existingValue);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep?.id]);

  const belowPreviewControlStepIds = useMemo(() => {
    const uploadIds = desiredDeterministicUploadSteps
      .map((step: any) => String(step?.id || ""))
      .filter(Boolean);
    return new Set([
      DETERMINISTIC_BUDGET_ID,
      ...uploadIds,
      REFINEMENT_UPLOAD_STEP_ID,
    ]);
  }, [desiredDeterministicUploadSteps]);
  const leadCaptureStepIds = useMemo(
    () => new Set(["step-lead-capture", "step-lead-name", "step-lead-phone"]),
    []
  );

  // After lead capture, budget/upload controls live in the bottom control bar.
  // Remove their dedicated steps from the guided sequence, but keep their values in stepData
  // so future image generations and refinements still have the data.
  useEffect(() => {
    if (!effectiveLeadCompleteForPreviewFlow) return;
    if (!previewHasImage) return;
    if (!state?.steps?.length) return;
    const hasInlineControlSteps = state.steps.some((step: any) =>
      belowPreviewControlStepIds.has(String((step as any)?.id || ""))
    );
    if (!hasInlineControlSteps) return;
    removeStepsByIds(belowPreviewControlStepIds);
  }, [belowPreviewControlStepIds, effectiveLeadCompleteForPreviewFlow, previewHasImage, removeStepsByIds, state?.steps]);

  // If lead capture completed from the preview modal/popover, remove any inline lead-capture
  // step that was inserted earlier so it doesn't block refinement-step focus/advance.
  useEffect(() => {
    if (!effectiveLeadCompleteForPreviewFlow) return;
    if (!state?.steps?.length) return;
    const hasInlineLeadStep = state.steps.some((step: any) => leadCaptureStepIds.has(String((step as any)?.id || "")));
    if (!hasInlineLeadStep) return;
    leadCapturedAdvancedRef.current = false;
    removeStepsByIds(leadCaptureStepIds);
  }, [effectiveLeadCompleteForPreviewFlow, leadCaptureStepIds, removeStepsByIds, state?.steps]);

  // After lead capture, reveal the compacted question pane immediately so pricing
  // and refinement controls unlock together instead of waiting for a second CTA.
  useEffect(() => {
    if (!leadCapturedForUI) return;
    setAdventureInputMode("questions");
    setDesignControlsRevealed(true);
  }, [leadCapturedForUI]);

  useEffect(() => {
    if (!effectiveLeadCompleteForPreviewFlow) return;
    if (!previewHasImage) return;
    if (!questionPaneRevealedByUser && !designControlsRevealed) return;
    if (!currentStep || !state?.steps?.length) return;
    const currentStepId = String(currentStep.id || "");
    if (!belowPreviewControlStepIds.has(currentStepId)) return;

    const currentIndex = state.currentStepIndex ?? 0;
    const nextVisibleIndex = state.steps.findIndex((step: any, index: number) => {
      if (index <= currentIndex) return false;
      const stepId = String((step as any)?.id || "");
      return stepId.length > 0 && !belowPreviewControlStepIds.has(stepId);
    });
    if (nextVisibleIndex > currentIndex) {
      goToStep(nextVisibleIndex);
      return;
    }

    const previousVisibleIndex = [...state.steps]
      .map((step: any, index: number) => ({ stepId: String((step as any)?.id || ""), index }))
      .reverse()
      .find(({ stepId, index }) => index < currentIndex && stepId.length > 0 && !belowPreviewControlStepIds.has(stepId))
      ?.index;
    if (typeof previousVisibleIndex === "number" && previousVisibleIndex >= 0) {
      goToStep(previousVisibleIndex);
    }
  }, [
    belowPreviewControlStepIds,
    currentStep,
    goToStep,
    designControlsRevealed,
    effectiveLeadCompleteForPreviewFlow,
    previewHasImage,
    questionPaneRevealedByUser,
    state?.currentStepIndex,
    state?.steps,
  ]);

  // If we blocked an auto-advance due to the preview gate, resume once lead is captured.
  useEffect(() => {
    if (!effectiveLeadCompleteForPreviewFlow) return;
    if (!questionPaneRevealedByUser && !designControlsRevealed) return;
    const pending = pendingPreviewAdvanceRef.current;
    if (pending) {
      if (!currentStep || currentStep.id !== pending.stepId) {
        pendingPreviewAdvanceRef.current = null;
        return;
      }
      pendingPreviewAdvanceRef.current = null;
      setPreviewAdvanceGateOpen(false);
      void goToNextStep(pending.data);
      return;
    }
    // Lead captured via pill: auto-advance to show the next guided question.
    if (!previewHasImage || !currentStep) return;
    if (leadCapturedAdvancedRef.current) return;
    const currentIndex = state?.currentStepIndex ?? -1;
    const nextVisibleIndex = (state?.steps || []).findIndex((step: any, index: number) => {
      if (index <= currentIndex) return false;
      const stepId = String((step as any)?.id || "");
      return stepId.length > 0 && !belowPreviewControlStepIds.has(stepId);
    });
    if (nextVisibleIndex > currentIndex) {
      leadCapturedAdvancedRef.current = true;
      leadCapturedAdvanceStepIdRef.current = currentStep.id;
      goToStep(nextVisibleIndex);
      return;
    }
    if (belowPreviewControlStepIds.has(String(currentStep.id || ""))) return;
    leadCapturedAdvancedRef.current = true;
    leadCapturedAdvanceStepIdRef.current = currentStep.id;
    const stepData = (state?.stepData as Record<string, unknown>)?.[currentStep.id] ?? {};
    void goToNextStep(stepData);
  }, [
    belowPreviewControlStepIds,
    currentStep,
    goToNextStep,
    goToStep,
    designControlsRevealed,
    effectiveLeadCompleteForPreviewFlow,
    previewHasImage,
    questionPaneRevealedByUser,
    state?.currentStepIndex,
    state?.stepData,
    state?.steps,
  ]);

  // --- Shared pricing seed (service + scope) ---
  const pricingEstimateAbortRef = useRef<AbortController | null>(null);
  const pricingEstimateInFlightHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!flowPlan?.sessionId) return;
    if (!instanceId) return;
    if (!state?.stepData || !state?.steps) return;
    if (!scopePricingReady) return;
    if (!scopePricingHash) return;

    if (pricingEstimateInFlightHashRef.current === scopePricingHash) return;

    const existing = normalizePricingEstimate(state.stepData?.[PRICING_ESTIMATE_KEY]);
    const existingStatus = typeof existing?.status === "string" ? String(existing.status) : null;
    const existingHash =
      typeof existing?.scopeHash === "string"
        ? String(existing.scopeHash)
        : typeof existing?.contextHash === "string"
          ? String(existing.contextHash)
          : null;
    // "running" is not terminal: requests can be aborted during step-data churn; allow retry when not actually in-flight.
    if (existingHash === scopePricingHash && (existingStatus === "complete" || existingStatus === "error")) {
      return;
    }

    const scopeStepIdSet = new Set<string>(scopeStepIdsInFlow);
    const stepsForPricingQA = (state.steps || []).filter((step: any) => {
      const stepId = String((step as any)?.id || "");
      return stepId === DETERMINISTIC_SERVICE_ID || scopeStepIdSet.has(stepId);
    });
    const answeredQA = buildAnsweredQA({ steps: stepsForPricingQA as any[], stepData: state.stepData || {}, max: 80 });
    const askedStepIds = Array.isArray(formState?.askedStepIds) ? formState.askedStepIds : [];
    const serviceCatalog = loadServiceCatalog(flowPlan.sessionId);
    const serviceMeta = selectedServiceId ? (serviceCatalog?.byServiceId as any)?.[selectedServiceId] : null;
    const cachedServiceSummary =
      typeof formState?.serviceSummary === "string" ? String(formState.serviceSummary).trim() : null;
    const perServiceSummary =
      typeof serviceMeta?.serviceSummary === "string" ? String(serviceMeta.serviceSummary).trim() : null;
    const serviceSummary = joinSummaries(cachedServiceSummary, perServiceSummary);
    const businessContext =
      typeof (config as any)?.businessContext === "string"
        ? String((config as any).businessContext).trim()
        : typeof formState?.businessContext === "string"
          ? String(formState.businessContext).trim()
          : null;
    const instanceContext = {
      businessContext: businessContext || undefined,
      serviceSummary: serviceSummary || undefined,
      industry: {
        id: typeof serviceMeta?.industryId === "string" ? serviceMeta.industryId : null,
        name:
          typeof serviceMeta?.industryName === "string"
            ? serviceMeta.industryName
            : typeof (config as any)?.industry === "string"
              ? String((config as any).industry)
              : null,
      },
      service: {
        id: selectedServiceId,
        name: typeof serviceMeta?.serviceName === "string" ? serviceMeta.serviceName : null,
      },
    };
    const formStatePayload = formState
      ? {
          formId: formState.formId,
          batchIndex: formState.batchIndex,
          tokenBudgetTotal: formState.tokenBudgetTotal,
          tokensUsedSoFar: formState.tokensUsedSoFar,
          askedStepIds,
          metricProgress: formState.metricProgress,
          metricProgressCountedStepIds: formState.metricProgressCountedStepIds,
          alreadyAskedKeys: askedStepIds,
          totalQuestionSteps: formState.totalQuestionSteps,
          answeredQuestionCount: formState.answeredQuestionCount,
          schemaVersion: formState.schemaVersion,
        }
      : {
          formId: flowPlan.sessionId,
          askedStepIds,
          schemaVersion: FORM_STATE_SCHEMA_VERSION,
        };

    pricingEstimateAbortRef.current?.abort();
    const controller = new AbortController();
    pricingEstimateAbortRef.current = controller;
    pricingEstimateInFlightHashRef.current = scopePricingHash;

    try {
      console.log("[pricing:seed] start", {
        sessionId: flowPlan.sessionId,
        instanceId,
        scopePricingHash,
        answeredQACount: answeredQA.length,
      });
    } catch {}

    updateStepData(PRICING_ESTIMATE_KEY, {
      status: "running",
      sourcePhase: "scope_seed",
      contextHash: scopePricingHash,
      scopeHash: scopePricingHash,
      startedAt: Date.now(),
    });

    void (async () => {
      try {
        const res = await fetch(`/api/ai-form/${instanceId}/pricing`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: flowPlan.sessionId,
            useCase: (config as any)?.useCase,
            stepDataSoFar: state.stepData || {},
            answeredQA,
            askedStepIds,
            formState: formStatePayload,
            instanceContext,
          }),
          cache: "no-store",
          signal: controller.signal,
        });

        const json = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            typeof (json as any)?.error === "string" ? String((json as any).error) : `Pricing estimate failed (${res.status})`;
          try {
            console.warn("[pricing:seed] error", { sessionId: flowPlan.sessionId, instanceId, status: res.status, message, json });
          } catch {}
          updateStepData(PRICING_ESTIMATE_KEY, {
            status: "error",
            sourcePhase: "scope_seed",
            contextHash: scopePricingHash,
            scopeHash: scopePricingHash,
            error: message,
            errorDetails: json,
            updatedAt: Date.now(),
          });
          return;
        }

        const est = (json as any)?.estimate ?? json;
        const normalizedEstimate = normalizePricingEstimate(est);
        if (!normalizedEstimate || !Number.isFinite(normalizedEstimate.totalMin) || !Number.isFinite(normalizedEstimate.totalMax)) {
          try {
            console.warn("[pricing:seed] invalid numbers", { sessionId: flowPlan.sessionId, instanceId, est, json });
          } catch {}
          updateStepData(PRICING_ESTIMATE_KEY, {
            status: "error",
            sourcePhase: "scope_seed",
            contextHash: scopePricingHash,
            scopeHash: scopePricingHash,
            error: "Pricing estimate returned invalid numbers",
            errorDetails: json,
            updatedAt: Date.now(),
          });
          return;
        }

        updateStepData(PRICING_ESTIMATE_KEY, {
          ...normalizedEstimate,
          status: "complete",
          sourcePhase: "scope_seed",
          contextHash: scopePricingHash,
          scopeHash: scopePricingHash,
          updatedAt: Date.now(),
        });
        try {
          console.log("[pricing:seed] complete", {
            sessionId: flowPlan.sessionId,
            instanceId,
            totalMin: normalizedEstimate.totalMin,
            totalMax: normalizedEstimate.totalMax,
            currency: normalizedEstimate.currency,
            calibrationKey: normalizedEstimate.calibrationKey,
          });
        } catch {}
      } catch (e) {
        if ((e as any)?.name === "AbortError") return;
        try {
          console.warn("[pricing:seed] exception", { sessionId: flowPlan?.sessionId, instanceId, err: e });
        } catch {}
        updateStepData(PRICING_ESTIMATE_KEY, {
          status: "error",
          sourcePhase: "scope_seed",
          contextHash: scopePricingHash,
          scopeHash: scopePricingHash,
          error: e instanceof Error ? e.message : String(e),
          updatedAt: Date.now(),
        });
      } finally {
        pricingEstimateInFlightHashRef.current = null;
      }
    })();

    return () => {};
  }, [
    config,
    flowPlan?.sessionId,
    formState,
    instanceId,
    scopePricingHash,
    scopePricingReady,
    scopeStepIdsInFlow,
    selectedServiceId,
    state?.stepData,
    state?.steps,
    updateStepData,
  ]);

  useEffect(() => {
    if (!flowPlan?.sessionId) return;
    setMaxVisitedIndex(0);
    flowCompletedRef.current = false;
    setFlowCompleted(false);
    setEaseFeedbackSent(false);
    setReflectionFeedbackSent(false);
    setPreviewVisible(false);
    setPreviewEverEnabled(false);
    setQuestionPaneRevealedByUser(false);
    previewPaneAutoCollapsedRef.current = false;
    setInitialQuestionCountSnapshot(null);
    setHasReceivedQuestionsFromGenerateSteps(false);
    stepMetaRef.current.clear();
    prevIndexRef.current = null;
    lastBatchMetaRef.current = null;
    lastModelRequestIdRef.current = null;
    pendingBatchTraceRef.current = null;
    batchingRef.current = false;
    initialAutofetchRef.current = false;
    inFlightBatchIndexesRef.current = new Set();
    completedBatchIndexesRef.current = new Set();
  }, [flowPlan?.sessionId]);

  useEffect(() => {
    if (!flowPlan?.sessionId) {
      setFormState(null);
      return;
    }
    const stored = loadFormState(flowPlan.sessionId);
    const nextState = stored ?? normalizeFormState({ formId: flowPlan.sessionId }, flowPlan.sessionId);
    setFormState(nextState);
    if (!stored) {
      saveFormState(flowPlan.sessionId, nextState);
    }
  }, [flowPlan?.sessionId]);

  // Sync FormState when other components patch localStorage (e.g. lead capture modals inside steps).
  useEffect(() => {
    if (!flowPlan?.sessionId) return;
    const session = flowPlan.sessionId;
    const handler = (e: Event) => {
      try {
        const detail = (e as any)?.detail;
        if (!detail || detail.sessionId !== session) return;
        const patch = detail?.patch;
        if (patch && typeof patch === "object" && !Array.isArray(patch)) {
          setFormState((prev) => {
            const base = prev ?? normalizeFormState({ formId: session }, session);
            const merged = normalizeFormState({ ...(base as any), ...(patch as any) }, session);
            saveFormState(session, merged);
            return merged;
          });
          try {
            if ("leadCaptured" in (patch as any) || "leadEmail" in (patch as any) || "leadPhone" in (patch as any)) {
              console.log("[formState] patched", { sessionId: session, patch });
            }
          } catch {}
          return;
        }
        const stored = loadFormState(session);
        if (!stored) return;
        setFormState(stored);
      } catch {}
    };
    window.addEventListener("sif_form_state_updated", handler as any);
    return () => window.removeEventListener("sif_form_state_updated", handler as any);
  }, [flowPlan?.sessionId]);

  // Deterministically inject a lightweight personalization step around ~30% into the question flow.
  // If the user has already progressed past the target index, inject immediately after the current step.
  // NOTE: "What's your name?" deterministic step temporarily disabled per request.

  // When image is generated + lead captured, hide budget + upload from UI only — keep them in state
  // so pricing, uploads, and API requests still have the data. Just filter from jogger (below).

  // Insert deterministic steps (budget, then upload) as the last steps before preview.
  // Order: all API-generated steps first, then budget, then upload. No API questions after these.
  // Skip when previewHasImage — budget/upload are in the bottom bar.
  useEffect(() => {
    if (!legacyBudgetUploadEnabled) return;
    if (!flowPlan?.sessionId) return;
    if (!state?.steps || state.steps.length === 0) return;
    if (!localSkeletonMode && !hasReceivedQuestionsFromGenerateSteps) return;
    if (previewHasImage) return;

    const desiredDeterministicSteps = [deterministicBudgetStep, ...desiredDeterministicUploadSteps];
    const desiredIds = new Set(desiredDeterministicSteps.map((s: any) => String(s?.id || "")).filter(Boolean));
    if (desiredIds.size === 0) return;

    const previewGateSteps = (state.steps || []).filter((s: any) => isPreviewGateQuestionStep(s));
    // Fallback: also allow insert when we have any non-bootstrap question (e.g. scope steps like project-type)
    const hasApiGeneratedSteps = state.steps.some(
      (s: any) => s?.id && !isBootstrapStepIdValue(String(s.id)) && isQuestionStepForAskedIds(s)
    );
    if (previewGateSteps.length === 0 && !hasApiGeneratedSteps) return;

    // Place budget + upload immediately after the final API-generated (preview-gate) question.
    let desiredInsertIndex = state.steps.length;
    for (let i = state.steps.length - 1; i >= 0; i -= 1) {
      const s = state.steps[i];
      if (isPreviewGateQuestionStep(s)) {
        desiredInsertIndex = i + 1;
        break;
      }
    }
    // Fallback: if no preview gate found but we have API steps, insert after the last non-bootstrap question
    if (previewGateSteps.length === 0 && desiredInsertIndex === state.steps.length) {
      for (let i = state.steps.length - 1; i >= 0; i -= 1) {
        const s = state.steps[i];
        if (s?.id && !isBootstrapStepIdValue(String(s.id)) && isQuestionStepForAskedIds(s)) {
          desiredInsertIndex = i + 1;
          break;
        }
      }
    }

    const afterCurrent = Math.max(0, (state.currentStepIndex ?? 0) + 1);
    const insertAtIndex = Math.max(desiredInsertIndex, afterCurrent);

    const stepData = state.stepData || {};
    const completed = state.completedSteps;
    const indexById = new Map<string, number>();
    state.steps.forEach((s: any, i: number) => {
      const id = String((s as any)?.id || "");
      if (id) indexById.set(id, i);
    });
    const allPresent = Array.from(desiredIds).every((id) => indexById.has(id));
    const budgetIdx = indexById.get(DETERMINISTIC_BUDGET_ID);

    // Patch budget step config if it exists and differs (e.g. API-loaded min/max).
    if (typeof budgetIdx === "number") {
      const currentBudgetStep = (state.steps || [])[budgetIdx] as any;
      const budgetData = (deterministicBudgetStep as any)?.data || {};
      const budgetCopy = (deterministicBudgetStep as any)?.copy || {};
      const budgetBlueprint = (deterministicBudgetStep as any)?.blueprint;
      const nextQuestion = String(budgetCopy.headline || "What budget range should we design around?");
      const nextMin = Number(budgetData.min ?? 2000);
      const nextMax = Number(budgetData.max ?? 50000);
      const nextStep = Number(budgetData.step ?? 500);
      const nextCurrency = String(budgetData.currency || "USD");
      const nextUnit = String(budgetData.unit || "$");
      const nextUnitType = String(budgetData.unitType || "currency");
      const nextFormat = String(budgetData.format || "currency");
      const nextRequired = budgetData.required !== false;
      const isDifferent =
        String(currentBudgetStep?.question || "") !== nextQuestion ||
        Number(currentBudgetStep?.min) !== nextMin ||
        Number(currentBudgetStep?.max) !== nextMax ||
        Number(currentBudgetStep?.step) !== nextStep ||
        String(currentBudgetStep?.currency || "") !== nextCurrency ||
        String(currentBudgetStep?.unit || "") !== nextUnit ||
        String(currentBudgetStep?.unitType || "") !== nextUnitType ||
        String(currentBudgetStep?.format || "") !== nextFormat ||
        currentBudgetStep?.data?.required !== nextRequired;
      if (isDifferent) {
        patchStep(DETERMINISTIC_BUDGET_ID, {
          componentType: "slider",
          type: "slider",
          question: nextQuestion,
          min: nextMin,
          max: nextMax,
          step: nextStep,
          currency: nextCurrency,
          unit: nextUnit,
          unitType: nextUnitType,
          format: nextFormat,
          data: {
            min: nextMin,
            max: nextMax,
            step: nextStep,
            currency: nextCurrency,
            unit: nextUnit,
            unitType: nextUnitType,
            format: nextFormat,
            required: nextRequired,
          },
          blueprint: budgetBlueprint,
          copy: {
            headline: nextQuestion,
            subtext: String(budgetCopy.subtext || ""),
          },
        });
      }
    }

    if (localSkeletonMode && allPresent) return;

    // Reposition if any deterministic step is too late (e.g. after a later-arriving API question).
    const needsReposition =
      allPresent &&
      Array.from(desiredIds).some((id) => {
        const idx = indexById.get(id);
        if (typeof idx !== "number") return false;
        if (idx <= insertAtIndex) return false;
        if (hasMeaningfulAnswer((stepData as any)[id])) return false;
        if (completed && typeof (completed as any).has === "function" && (completed as any).has(id)) return false;
        return true;
      });

    if (!allPresent || needsReposition) {
      addSteps(desiredDeterministicSteps, false, { insertAtIndex, moveExisting: true });
    }
  }, [
    addSteps,
    deterministicBudgetStep,
    desiredDeterministicUploadSteps,
    flowPlan?.sessionId,
    hasReceivedQuestionsFromGenerateSteps,
    legacyBudgetUploadEnabled,
    localSkeletonMode,
    patchStep,
    previewHasImage,
    state,
  ]);

  const strippedLegacyAdventureStepsRef = useRef<string>("");
  useEffect(() => {
    if (legacyBudgetUploadEnabled) return;
    if (!state?.steps?.length) return;
    const legacyIdsPresent = (state.steps || [])
      .map((step: any) => String((step as any)?.id || ""))
      .filter((stepId) =>
        stepId === DETERMINISTIC_BUDGET_ID ||
        stepId === DETERMINISTIC_SCENE_IMAGE_ID ||
        stepId === DETERMINISTIC_USER_IMAGE_ID ||
        stepId === DETERMINISTIC_PRODUCT_IMAGE_ID
      );
    if (legacyIdsPresent.length === 0) {
      strippedLegacyAdventureStepsRef.current = "";
      return;
    }
    const signature = legacyIdsPresent.join("|");
    if (strippedLegacyAdventureStepsRef.current === signature) return;
    strippedLegacyAdventureStepsRef.current = signature;
    removeStepsByIds(new Set(legacyIdsPresent));
  }, [legacyBudgetUploadEnabled, removeStepsByIds, state?.steps]);

  useEffect(() => {
    if (!state) return;
    setMaxVisitedIndex((prev) => Math.max(prev, state.currentStepIndex || 0));
  }, [state?.currentStepIndex]);

  useEffect(() => {
    if (!state?.steps || state.steps.length === 0) return;
    for (const step of state.steps) {
      if (!step || typeof step !== "object") continue;
      const stepId = (step as any).id;
      if (!stepId || stepMetaRef.current.has(stepId)) continue;
      const meta = (step as any).__telemetry;
      if (meta && (meta.batchId || meta.modelRequestId)) {
        stepMetaRef.current.set(stepId, {
          batchId: normalizeBatchId(meta.batchId) ?? null,
          modelRequestId: meta.modelRequestId ?? null,
          payloadRequest: meta.payloadRequest ?? null,
          payloadResponse: meta.payloadResponse ?? null,
        });
      }
    }
  }, [state?.steps]);


  // Track rendered steps to prevent duplicates (persist across re-renders)
  const renderedStepsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!currentStep || !sessionId) return;
    const stepId = currentStep.id;
    const renderKey = `${sessionId}-${stepId}`;
    
    // Skip if already rendered in this session (deduplication)
    if (renderedStepsRef.current.has(renderKey)) {
      return;
    }
    renderedStepsRef.current.add(renderKey);
    
    const order = (state?.currentStepIndex ?? 0) + 1;
    const meta = stepMetaRef.current.get(stepId);
    const fallbackBatchId = batchIdFromIndex(formState?.batchIndex);
    const now = Date.now();
    stepStartRef.current[stepId] = now;
    trackStepStart(stepId);
    if (meta?.modelRequestId) {
      lastModelRequestIdRef.current = meta.modelRequestId;
    }
    
    // Determine step source and characteristics
    const isDeterministic =
      isStructuralStep(currentStep) ||
      isBootstrapStepIdValue(stepId);
    const stepSource = isDeterministic ? 'frontend_deterministic' : (meta?.modelRequestId ? 'backend_ai' : 'unknown');
    const totalSteps = state?.steps?.length || 0;
    
    // Emit step_rendered with full step data
    const requestPayload = meta?.payloadRequest ?? null;
    const responsePayload = meta?.payloadResponse ?? null;

    emitTelemetry({
      sessionId,
      instanceId,
      eventType: "step_rendered",
      stepId,
      batchId: normalizeBatchId(meta?.batchId) ?? fallbackBatchId ?? undefined,
      modelRequestId: meta?.modelRequestId ?? undefined,
      timestamp: now,
      payload: {
        step_number: order,
        total_steps: totalSteps,
        step_type: getStepType(currentStep),
        is_deterministic: isDeterministic,
        source: stepSource,
        step_json: currentStep, // Full step object
        has_options: Array.isArray((currentStep as any)?.options),
        options_count: Array.isArray((currentStep as any)?.options) ? (currentStep as any).options.length : 0,
        question: (currentStep as any)?.question || null,
        variant: (currentStep as any)?.variant || null,
        columns: (currentStep as any)?.columns || null,
        required: (currentStep as any)?.required !== false,
        request_payload: requestPayload,
        response_payload: responsePayload,
      },
    });
  }, [currentStep?.id, instanceId, sessionId, trackStepStart]);

  useEffect(() => {
    if (!formState || !flowPlan?.sessionId || !state) return;
    const questionIds = (state.steps || [])
      .filter((step) => isQuestionStepForAskedIds(step))
      .map((step) => step.id)
      .filter(Boolean);
    const merged = mergeUniqueStrings(formState.askedStepIds, questionIds);
    if (merged.length === formState.askedStepIds.length) return;
    const nextState = { ...formState, askedStepIds: merged, alreadyAskedKeys: merged };
    setFormState(nextState);
    saveFormState(flowPlan.sessionId, nextState);
  }, [formState, flowPlan?.sessionId, state]);

  const isStepAnsweredForCounts = useCallback(
    (step: any, stepData?: Record<string, any> | null) => {
      const id = String((step as any)?.id || "");
      const value = stepData?.[id];
      if (hasMeaningfulAnswer(value)) return true;
      if (
        stepData &&
        Object.prototype.hasOwnProperty.call(stepData, id) &&
        (id === DETERMINISTIC_BUDGET_ID ||
          id === DETERMINISTIC_SCENE_IMAGE_ID ||
          id === DETERMINISTIC_USER_IMAGE_ID ||
          id === DETERMINISTIC_PRODUCT_IMAGE_ID)
      ) {
        return value === null || value === "__skip__";
      }
      return false;
    },
    []
  );

  // Keep form state total/answered question counts in sync when backend adds steps or user answers.
  useEffect(() => {
    if (!formState || !flowPlan?.sessionId || !state?.steps) return;
    const questionSteps = (state.steps || []).filter((step) => isQuestionStepForAskedIds(step));
    const total = questionSteps.length;
    const answered = questionSteps.filter((step) => isStepAnsweredForCounts(step, state?.stepData)).length;
    if (formState.totalQuestionSteps === total && formState.answeredQuestionCount === answered) return;
    const nextState = { ...formState, totalQuestionSteps: total, answeredQuestionCount: answered };
    setFormState(nextState);
    saveFormState(flowPlan.sessionId, nextState);
  }, [flowPlan?.sessionId, formState, isStepAnsweredForCounts, state?.stepData, state?.steps]);

  useStepEngineFunctionCalls({
    state,
    instanceId,
    flowPlanSessionId: flowPlan?.sessionId,
    config,
    updateStepData,
    functionCallOutputsRef,
    functionCallInFlightRef,
    sessionId,
    prevIndexRef,
    stepMetaRef,
    formBatchIndex: formState?.batchIndex,
  });

  const isInitialLoading = Boolean(engineLoading || !flowPlan);

  const fetchAndAppendBatch = useCallback(
    async (stepDataSoFar: Record<string, any>, showLoading: boolean = false, wasOnLastStep: boolean = false) => {
      if (!flowPlan?.sessionId) return;
      await fetchAndAppendGenerateStepsBatch(stepDataSoFar, showLoading, wasOnLastStep, {
        instanceId,
        flowPlanSessionId: flowPlan.sessionId,
        flowPlan,
        state,
        formState,
        config,
        onMeta,
        deterministicStyleStep,
        disableLegacyBudgetUploadSteps,
        legacyBudgetUploadEnabled,
        initialQuestionCountSnapshot,
        setBatchError,
        setIsBatchLoading,
        setFormState,
        setHasReceivedQuestionsFromGenerateSteps,
        setInitialQuestionCountSnapshot,
        setPreviewEverEnabled,
        updateStepData,
        addSteps,
        patchStep,
        batchingRef,
        pendingBatchTraceRef,
        completedBatchIndexesRef,
        inFlightBatchIndexesRef,
        lastBatchMetaRef,
        lastModelRequestIdRef,
        backendMaxCallsRef,
        stepMetaRef,
        sceneUploadJustCompletedRef,
      });
    },
    [
      addSteps,
      config,
      deterministicStyleStep,
      disableLegacyBudgetUploadSteps,
      flowPlan,
      formState,
      initialQuestionCountSnapshot,
      instanceId,
      legacyBudgetUploadEnabled,
      onMeta,
      patchStep,
      state,
      updateStepData,
    ]
  );

  const requestNextBatch = useCallback(
    (
      stepDataSoFar: Record<string, any>,
      opts: { showLoading: boolean; wasOnLastStep: boolean; reason: string; onError?: (e: unknown) => void }
    ) => {
      if (localSkeletonMode) {
        console.log(`[StepEngine] Local skeleton mode: skipped generate-steps request (${opts.reason})`);
        return;
      }
      const singlePlanModeEnabled = true;
      const allowFollowUpBatchRequest = opts.wasOnLastStep || opts.reason === "initial-autofetch";
      if (singlePlanModeEnabled && !allowFollowUpBatchRequest) {
        // Consolidated mode: question planning runs once at startup.
        // Allow follow-up generation when the user actually exhausts the current batch.
        console.log(`[StepEngine] Single-plan mode: skipped generate-steps request (${opts.reason})`);
        return;
      }
      fetchAndAppendBatch(stepDataSoFar, opts.showLoading, opts.wasOnLastStep).catch((e) => {
        console.warn(`[StepEngine] generate-steps fetch failed (${opts.reason})`, e);
        opts.onError?.(e);
      });
    },
    [fetchAndAppendBatch, localSkeletonMode]
  );

  useEffect(() => {
    if (localSkeletonMode) return;
    if (!state) return;
    const previousServiceId = previousSelectedServiceIdRef.current;
    const serviceChanged = Boolean(previousServiceId && previousServiceId !== selectedServiceId);
    previousSelectedServiceIdRef.current = selectedServiceId;

    const existingStyleStep = (state.steps || []).find((step: any) => String((step as any)?.id || "") === DETERMINISTIC_STYLE_ID) as any;
    if (!deterministicStyleStep) {
      if (serviceChanged && existingStyleStep) {
        removeContextEntry(DETERMINISTIC_STYLE_ID);
      }
      return;
    }

    const steps = state.steps || [];
    const stepData = (state.stepData || {}) as Record<string, any>;
    const scopeSteps = steps.filter((step: any) => PRE_CONCEPT_SCOPE_STEP_IDS.has(String((step as any)?.id || "")));
    const scopeSatisfied =
      scopeSteps.length > 0
        ? scopeSteps.every((step: any) => hasMeaningfulAnswer(stepData[String((step as any)?.id || "")]))
        : hasReceivedQuestionsFromGenerateSteps;

    if (!scopeSatisfied) {
      return;
    }

    if (!existingStyleStep) {
      let lastScopeIndex = -1;
      for (let i = 0; i < steps.length; i += 1) {
        const id = String((steps[i] as any)?.id || "");
        if (PRE_CONCEPT_SCOPE_STEP_IDS.has(id)) lastScopeIndex = i;
      }
      const insertAtIndex = lastScopeIndex >= 0 ? lastScopeIndex + 1 : 1;
      addSteps([deterministicStyleStep as any], false, {
        insertAtIndex,
        moveExisting: true,
      });
      if (!disableLegacyBudgetUploadSteps) {
        requestNextBatch(stepData, {
          showLoading: false,
          wasOnLastStep: false,
          reason: "style-copy-after-scope",
        });
      }
      return;
    }

    const existingSignature = JSON.stringify({
      question: existingStyleStep?.question ?? null,
      humanism: existingStyleStep?.humanism ?? null,
      options: Array.isArray(existingStyleStep?.options) ? existingStyleStep.options : [],
      multi_select: Boolean(existingStyleStep?.multi_select),
      min_selections: existingStyleStep?.min_selections ?? null,
      max_selections: existingStyleStep?.max_selections ?? null,
      columns: existingStyleStep?.columns ?? null,
    });
    const nextSignature = JSON.stringify({
      question: (deterministicStyleStep as any).question ?? null,
      humanism: (deterministicStyleStep as any).humanism ?? null,
      options: Array.isArray((deterministicStyleStep as any)?.options) ? (deterministicStyleStep as any).options : [],
      multi_select: Boolean((deterministicStyleStep as any)?.multi_select),
      min_selections: (deterministicStyleStep as any)?.min_selections ?? null,
      max_selections: (deterministicStyleStep as any)?.max_selections ?? null,
      columns: (deterministicStyleStep as any)?.columns ?? null,
    });
    if (existingSignature !== nextSignature || existingStyleStep?.type !== "image_choice_grid") {
      patchStep(DETERMINISTIC_STYLE_ID, {
        type: "image_choice_grid",
        question: (deterministicStyleStep as any).question,
        humanism: (deterministicStyleStep as any).humanism,
        options: (deterministicStyleStep as any).options,
        multi_select: Boolean((deterministicStyleStep as any)?.multi_select),
        min_selections: (deterministicStyleStep as any)?.min_selections,
        max_selections: (deterministicStyleStep as any)?.max_selections,
        columns: (deterministicStyleStep as any)?.columns,
      } as any);
    }

    if (serviceChanged) {
      removeContextEntry(DETERMINISTIC_STYLE_ID);
    }
  }, [addSteps, deterministicStyleStep, disableLegacyBudgetUploadSteps, hasReceivedQuestionsFromGenerateSteps, localSkeletonMode, patchStep, removeContextEntry, requestNextBatch, selectedServiceId, state]);

  // If the user refreshes after completing deterministic steps, there may be no AI steps yet.
  // In that case, automatically fetch the first batch once we have the deterministic answers.
  useEffect(() => {
    if (localSkeletonMode) return;
    if (!state || !flowPlan?.sessionId) return;
    if (initialAutofetchRef.current) return;
    const stepData = state.stepData || {};
    const hasDeterministicAnswers = deterministicAnswersPresent({ steps: state.steps, stepData });
    if (!hasDeterministicAnswers) return;

    const hasAnyNonDeterministicStep = (state.steps || []).some((step: any) => {
      const stepId = step?.id;
      if (!stepId) return false;
      if (isBootstrapStepIdValue(stepId)) return false;
      return true;
    });
    if (hasAnyNonDeterministicStep) return;

    // Only auto-fetch the very first AI batch; never chain-follow-up batches without user action.
    const baseState = formState ?? loadFormState(flowPlan.sessionId) ?? normalizeFormState({ formId: flowPlan.sessionId }, flowPlan.sessionId);
    if (baseState.batchIndex !== 0) return;

    initialAutofetchRef.current = true;
    requestNextBatch(stepData, {
      showLoading: true,
      wasOnLastStep: true,
      reason: "initial-autofetch",
      onError: () => {
        initialAutofetchRef.current = false;
      },
    });
  }, [state, flowPlan?.sessionId, formState, localSkeletonMode, requestNextBatch]);

  useStepEngineDropoffTelemetry({
    sessionId,
    currentStep,
    flowCompletedRef,
    stepMetaRef,
    isStructuralStep,
    isBootstrapStepIdValue,
    state,
    instanceId,
    formBatchIndex: formState?.batchIndex,
  });
  const { handleBack: navigateStepBack, handleNavigateToStep } = useStepNavigation({
    state,
    currentStep,
    sessionId,
    instanceId,
    formBatchIndex: formState?.batchIndex,
    stepMetaRef,
    isBootstrapStepIdValue,
    isStructuralStep,
    goToPreviousStep,
    goToStep,
    setAdventureInputMode,
  });
  const [stepNavReturnToGalleryNonce, setStepNavReturnToGalleryNonce] = useState(0);
  const handleBack = useCallback(async () => {
    const idx = state?.currentStepIndex ?? 0;
    const atFirstStep = idx <= 0;
    if (atFirstStep && previewEnabledForBackNavRef.current && previewHasImage) {
      setAdventureInputMode("questions");
      setStepNavReturnToGalleryNonce((n) => n + 1);
      return;
    }
    await navigateStepBack();
  }, [navigateStepBack, previewHasImage, setAdventureInputMode, state?.currentStepIndex]);
  const handleStepJoggerNavigate = useCallback(
    (stepIndex: number) => {
      setQuestionPaneRevealedByUser(true);
      handleNavigateToStep(stepIndex);
    },
    [handleNavigateToStep]
  );

  const handlePreviewSurfaceModeChange = useCallback((mode: "gallery" | "single" | "empty") => {
    const prev = previewSurfaceReportedRef.current;
    previewSurfaceReportedRef.current = mode;
    setPreviewSurfaceMode(mode);
    // Only switch to Ideas when leaving the concept grid for a single hero — not on first image (empty→single),
    // so guided flow stays on the Questions tab for the next form steps.
    if (mode === "single" && prev === "gallery") {
      setAdventureInputMode("ideas");
    }
  }, []);

  const completedQuestionCount = useMemo(() => {
    if (!state?.steps || !state?.stepData) return 0;
    const previewTriggerStepIds = new Set<string>([
      DETERMINISTIC_SCENE_IMAGE_ID,
      DETERMINISTIC_USER_IMAGE_ID,
      DETERMINISTIC_PRODUCT_IMAGE_ID,
      REFINEMENT_UPLOAD_STEP_ID,
    ]);
    return state.steps.filter((step) => {
      const stepId = String((step as any)?.id || "");
      const isPreviewTriggerStep = isPreviewGateQuestionStep(step) || previewTriggerStepIds.has(stepId);
      if (!isPreviewTriggerStep) return false;
      return isStepAnsweredForCounts(step, state.stepData);
    }).length;
  }, [isStepAnsweredForCounts, state?.stepData, state?.steps]);

  const autoPreviewAnsweredQuestionCount = useMemo(() => {
    if (!state?.steps || !state?.stepData) return 0;
    return state.steps.filter((step) => {
      if (!isPreviewGateQuestionStep(step)) return false;
      return isStepAnsweredForCounts(step, state.stepData);
    }).length;
  }, [isStepAnsweredForCounts, state?.stepData, state?.steps]);

  const hasRefinementQuestions = useMemo(() => {
    if (!state?.steps?.length) return false;
    return state.steps.some((step) => Boolean((step as any)?.__refinementStep));
  }, [state?.steps]);

  const answeredRefinementQuestionCount = useMemo(() => {
    if (!state?.steps || !state?.stepData) return 0;
    return state.steps.filter((step) => {
      if (!(step as any)?.__refinementStep) return false;
      return isStepAnsweredForCounts(step, state.stepData);
    }).length;
  }, [isStepAnsweredForCounts, state?.stepData, state?.steps]);

  const previewAutoAnsweredQuestionCount = hasRefinementQuestions
    ? answeredRefinementQuestionCount
    : autoPreviewAnsweredQuestionCount;
  const previewAutoGenerationCounterScope = hasRefinementQuestions ? "refinement" : "base";
  const { handleStepComplete } = useStepCompletion({
    currentStep,
    state,
    answeredRefinementQuestionCount,
    isStepAnsweredForCounts,
    previewHasImage,
    instanceId,
    sessionId,
    flowPlan,
    formState,
    setFormState: (next) => setFormState(next),
    onStepComplete,
    selectedServiceId,
    serviceCatalogSnapshot,
    deterministicStyleStep,
    disableLegacyBudgetUploadSteps,
    localSkeletonMode,
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
    refinementUploadStepId: REFINEMENT_UPLOAD_STEP_ID,
  });

  // If the user resumes a session where steps are already present (e.g. from localStorage),
  // make sure the preview system is allowed to activate without requiring a fresh generate-steps request.
  useEffect(() => {
    if (localSkeletonMode && state?.steps?.length) {
      setHasReceivedQuestionsFromGenerateSteps(true);
    }
    if (hasReceivedQuestionsFromGenerateSteps) return;
    if (!state?.steps || state.steps.length === 0) return;
    const hasAnyNonBootstrapQuestion = state.steps.some((s) => {
      const id = String((s as any)?.id || "");
      if (!id) return false;
      if (isBootstrapStepIdValue(id)) return false;
      return isQuestionStepForAskedIds(s);
    });
    if (hasAnyNonBootstrapQuestion) setHasReceivedQuestionsFromGenerateSteps(true);
  }, [hasReceivedQuestionsFromGenerateSteps, localSkeletonMode, state?.steps]);

  useEffect(() => {
    if (!localSkeletonMode) return;
    if (!state?.steps?.length) return;
    if (initialQuestionCountSnapshot !== null) return;
    setInitialQuestionCountSnapshot(countPreviewGateQuestions(state.steps));
  }, [initialQuestionCountSnapshot, localSkeletonMode, state?.steps]);

  useEffect(() => {
    if (!localSkeletonMode) return;
    if (!state) return;
    const caps = (state.stepData as any)?.__capabilities;
    if (caps && typeof caps === "object" && !Array.isArray(caps) && (caps as any).image_preview === true) return;
    updateStepData("__capabilities", {
      ...(caps && typeof caps === "object" && !Array.isArray(caps) ? caps : {}),
      image_preview: true,
    });
  }, [localSkeletonMode, state, state?.stepData, updateStepData]);

  const showEasePrompt = false;

  const handleEaseFeedback = useCallback(
    (vote: "up" | "down") => {
      if (!sessionId) return;
      setEaseFeedbackSent(true);
      const stepId = currentStep?.id;
      const meta = stepId ? stepMetaRef.current.get(stepId) : null;
      const requestPayload = meta?.payloadRequest ?? null;
      const responsePayload = meta?.payloadResponse ?? null;
      emitFeedback({
        sessionId,
        instanceId,
        stepId: stepId || null,
        modelRequestId: meta?.modelRequestId ?? null,
        source: "user",
        vote,
        timestamp: Date.now(),
        payload: {
          request: requestPayload,
          response: responsePayload,
          prompt: "ease",
          order: (state?.currentStepIndex ?? 0) + 1,
        },
      });
    },
    [currentStep?.id, instanceId, sessionId, state?.currentStepIndex]
  );

  const handleReflectionFeedback = useCallback(
    (rating: number, comment: string) => {
      if (!sessionId) return;
      if (reflectionFeedbackSent) return;
      setReflectionFeedbackSent(true);
      emitFeedback({
        sessionId,
        instanceId,
        stepId: "flow-complete",
        modelRequestId: lastModelRequestIdRef.current,
        source: "user",
        rating,
        comment: comment || null,
        timestamp: Date.now(),
        payload: {
          prompt: "reflection",
        },
      });
    },
    [instanceId, reflectionFeedbackSent, sessionId]
  );

  const devModeStats = useMemo<DevModeStats | null>(() => {
    if (!state) return null;
    const questionSteps = state.steps.filter((step) => isQuestionStepForAskedIds(step));
    const answeredQuestionSteps = questionSteps.filter((step) => {
      return hasMeaningfulAnswer(state.stepData[step.id]);
    }).length;
    const satietyRaw = state.stepData?.__satiety;
    const satiety =
      typeof satietyRaw === "number" && Number.isFinite(satietyRaw)
        ? Math.max(0, Math.min(1, satietyRaw))
        : null;
    const flowProgressPercent =
      typeof progress?.percentage === "number" && Number.isFinite(progress.percentage) ? progress.percentage : null;
    return {
      totalSteps: state.steps.length,
      currentStepIndex: state.currentStepIndex,
      completedSteps: state.completedSteps.size,
      questionStepsCount: questionSteps.length,
      answeredQuestionSteps,
      // Exclude internal/system keys like "__satiety" and "__capabilities" for a more accurate view of user-provided data.
      answeredKeys: Object.keys(state.stepData || {}).filter((k) => !k.startsWith("__")).length,
      satiety,
      flowProgressPercent,
    };
  }, [progress?.percentage, state]);

  const {
    backendAllowsPreview,
    effectiveFlowProgressFraction,
    frontendPreviewEligible,
    imagePreviewAfterAnsweredQuestions,
    imagePreviewAfterAnsweredQuestionsOverride,
    imagePreviewAtFraction,
    previewEnabled,
    previewQuestionCount,
  } = usePreviewEligibility({
    addSteps,
    completedQuestionCount,
    config,
    currentStepId: currentStep?.id,
    desiredDeterministicUploadSteps: disableLegacyBudgetUploadSteps ? [] : desiredDeterministicUploadSteps,
    desiredDeterministicStepsForInsert: disableLegacyBudgetUploadSteps ? [] : [deterministicBudgetStep, ...desiredDeterministicUploadSteps],
    flowPlanSessionId: flowPlan?.sessionId,
    formStateMetricProgress: formState?.metricProgress ?? null,
    hasReceivedQuestionsFromGenerateSteps,
    initialQuestionCountSnapshot,
    isBootstrapStepId: isBootstrapStepIdValue,
    previewEverEnabled,
    progressPercentage: progress?.percentage ?? null,
    setPreviewEverEnabled,
    mustAnswerBeforePreviewStepId: localSkeletonMode && deterministicStyleStep ? DETERMINISTIC_STYLE_ID : null,
    suppressDeterministicStepInsert: Boolean(disableLegacyBudgetUploadSteps || (effectiveLeadCompleteForPreviewFlow && previewHasImage)),
    state,
    updateStepData,
  });
  previewEnabledForBackNavRef.current = previewEnabled;

  const isBacktrackingInForm = Boolean(state && (state.currentStepIndex ?? 0) < maxVisitedIndex);

  // Consolidated mode: question flow is always owned by the step engine.
  const leadGateLocksQuestionArea = false;
  useEffect(() => {
    leadGateLocksQuestionAreaRef.current = leadGateLocksQuestionArea;
  }, [leadGateLocksQuestionArea]);

  const isWaitingForNextBatch = Boolean(isBatchLoading && state && state.currentStepIndex >= state.steps.length - 1);
  const hasSceneImageInStepData = useMemo(() => {
    const stepData = state?.stepData as Record<string, unknown> | undefined;
    if (!stepData) return false;
    for (const key of ["step-upload-scene-image", "step-refinement-upload-scene-image"]) {
      const raw = stepData[key];
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" && raw ? [raw] : [];
      if (arr.some((v) => typeof v === "string" && v.length > 0)) return true;
    }
    return false;
  }, [state?.stepData]);
  // After scene upload completes, show ImagePreviewExperience with "generating" immediately instead of "Getting you accurate pricing..."
  // Use ref when state hasn't updated yet (avoids overlapping "Getting you accurate pricing..." and "Generating your design + pricing..." loaders)
  const showPreviewGeneratingEarly = Boolean(
    (hasSceneImageInStepData || sceneUploadJustCompletedRef.current) &&
      (!effectiveCurrentStep || isWaitingForNextBatch) &&
      !previewEnabled
  );
  const isStyleStepActive = Boolean(currentStep?.id === DETERMINISTIC_STYLE_ID);
  const showPreviewSection = previewEnabled || showPreviewGeneratingEarly || isInitialLoading;

  const {
    isAdventureSurface,
    isDesktopViewport,
    isMobileViewport,
    previewColumnRef,
    previewMaxPx,
    previewRailOpen,
    previewViewportRef,
    questionContentRef,
    questionScale,
    questionViewportRef,
    useDesktopPreviewLayout,
    useMobilePreviewLayout,
    usePreviewDominantLayout,
  } = usePreviewLayout({
    currentStepId: currentStep?.id,
    previewEnabled: showPreviewSection,
    showBrandingHeader,
  });

  const previewRailActive = showPreviewSection;
  const density = previewRailActive ? "compact" : "normal";
  useEffect(() => {
    if (!showPreviewSection) setPreviewVisible(false);
    else if (showPreviewGeneratingEarly) setPreviewVisible(true);
  }, [showPreviewSection, showPreviewGeneratingEarly]);
  useEffect(() => {
    if (!showPreviewSection) setPreviewSurfaceMode("empty");
  }, [showPreviewSection]);
  useEffect(() => {
    if (!previewHasImage) {
      previewPaneAutoCollapsedRef.current = false;
      return;
    }
    if (previewPaneAutoCollapsedRef.current) return;
    previewPaneAutoCollapsedRef.current = true;
    setQuestionPaneRevealedByUser(false);
  }, [previewHasImage]);

  const isPreviewGenerationStage = Boolean(previewEnabled && !previewHasImage);
  const pricedGridStepActive = Boolean(currentStep?.id === DETERMINISTIC_PRICED_IMAGE_GRID_ID);
  const showAccuratePricingLoader =
    !showPreviewSection &&
    (!effectiveCurrentStep || isWaitingForNextBatch) &&
    !isPreviewGenerationStage &&
    !showPreviewGeneratingEarly;
  const hasLoadedFirstNonBootstrapQuestion = Boolean(
    hasReceivedQuestionsFromGenerateSteps ||
      (state?.steps || []).some((step: any) => {
        const stepId = String((step as any)?.id || "");
        if (!stepId || isBootstrapStepIdValue(stepId)) return false;
        return isQuestionStepForAskedIds(step);
      })
  );
  const showUnifiedStartupLoader = Boolean(
    !(engineError || batchError) &&
      (isInitialLoading || (!hasLoadedFirstNonBootstrapQuestion && (isBatchLoading || showAccuratePricingLoader)))
  );

  const devModeUI = useMemo<DevModeUIState>(
    () => ({
      density,
      preview: {
        hasReceivedQuestionsFromGenerateSteps,
        backendAllowsPreview,
        frontendPreviewEligible,
        previewEverEnabled,
        previewEnabled,
        previewVisible,
        completedQuestionCount,
        previewQuestionCount,
        effectiveFlowProgressFraction,
        imagePreviewAtFraction,
        imagePreviewAfterAnsweredQuestionsOverride,
        imagePreviewAfterAnsweredQuestions,
        initialQuestionCountSnapshot,
      },
      prompts: {
        easePromptVisible: showEasePrompt,
        reflectionPromptVisible: flowCompleted && !reflectionFeedbackSent,
      },
    }),
    [
      backendAllowsPreview,
      completedQuestionCount,
      density,
      effectiveFlowProgressFraction,
      flowCompleted,
      frontendPreviewEligible,
      hasReceivedQuestionsFromGenerateSteps,
      imagePreviewAfterAnsweredQuestions,
      imagePreviewAfterAnsweredQuestionsOverride,
      imagePreviewAtFraction,
      initialQuestionCountSnapshot,
      previewEnabled,
      previewEverEnabled,
      previewQuestionCount,
      previewVisible,
      reflectionFeedbackSent,
      showEasePrompt,
    ]
  );
  const previewGenerationStepIdRef = useRef<string | null>(null);
  const [previewQuestionRevealReady, setPreviewQuestionRevealReady] = useState(false);
  useEffect(() => {
    if (!previewEnabled) {
      previewGenerationStepIdRef.current = null;
      setPreviewQuestionRevealReady(true);
      return;
    }
    if (!previewHasImage) {
      previewGenerationStepIdRef.current = String(currentStep?.id || "") || null;
      setPreviewQuestionRevealReady(false);
      return;
    }
    const capturedId = previewGenerationStepIdRef.current;
    const currentId = String(currentStep?.id || "");
    if (!capturedId) {
      setPreviewQuestionRevealReady(true);
      return;
    }
    const allowSameStepRevealForLocalSkeletonStyle = Boolean(
      localSkeletonMode &&
        flowCompleted &&
        capturedId === DETERMINISTIC_STYLE_ID &&
        currentId === DETERMINISTIC_STYLE_ID
    );
    // When moving forward: hide on the captured step to prevent stale content flash.
    // When backtracking: always show—user explicitly navigated back to see the question.
    // When lead captured: always show—unlock to reveal the next guided question.
    if (
      !currentId ||
      (currentId === capturedId &&
        !isBacktrackingInForm &&
        !effectiveLeadCompleteForPreviewFlow &&
        !allowSameStepRevealForLocalSkeletonStyle)
    ) {
      setPreviewQuestionRevealReady(false);
      return;
    }
    setPreviewQuestionRevealReady(true);
  }, [
    currentStep?.id,
    previewEnabled,
    previewHasImage,
    isBacktrackingInForm,
    effectiveLeadCompleteForPreviewFlow,
    flowCompleted,
    localSkeletonMode,
  ]);
  const previewLayoutActive = Boolean(
    (usePreviewDominantLayout || useDesktopPreviewLayout) &&
      (previewHasImage || previewVisible || !previewQuestionRevealReady)
  );
  const allowConceptGallery = Boolean(localSkeletonMode && flowCompleted);
  useEffect(() => {
    if (!previewAutoGenerationPending) return;
    if (previewAutoGenerationBusy) {
      setPreviewAutoGenerationPending(false);
    }
  }, [previewAutoGenerationBusy, previewAutoGenerationPending]);
  useEffect(() => {
    if (!previewAutoGenerationPending) return;
    if (!hasRefinementQuestions || !previewHasImage) {
      setPreviewAutoGenerationPending(false);
    }
  }, [hasRefinementQuestions, previewAutoGenerationPending, previewHasImage]);
  const isAutoPreviewRefreshLocked = Boolean(previewHasImage && previewAutoGenerationBusy);
  const galleryPreviewActive = Boolean(showPreviewSection && previewHasImage);
  const currentStepSupportsQuestionPane = Boolean(
    currentStep &&
      !isStructuralStep(currentStep) &&
      !flowCompleted
  );
  const forceQuestionPaneVisibleForBacktracking = Boolean(
    isBacktrackingInForm && currentStepSupportsQuestionPane
  );
  /** Concept grid (priced grid / post-complete gallery): full-height preview until user opens a tile in single mode. */
  const conceptPickerStepActive = Boolean(pricedGridStepActive || allowConceptGallery);
  const hideQuestionPaneUntilConceptSingle = Boolean(
    !forceQuestionPaneVisibleForBacktracking &&
      previewEnabled &&
      conceptPickerStepActive &&
      previewSurfaceMode !== "single"
  );
  // Once a preview image exists, keep the pane available (Ideas + questions) even if we're still on the
  // same step as generation — otherwise previewQuestionRevealReady stays false and the pane never mounts.
  const showQuestionPaneUnderPreview =
    forceQuestionPaneVisibleForBacktracking ||
    /** Mobile: while preview is generating (or early loading shell), keep the pane mounted for one vertical scroll with the preview. */
    (useMobilePreviewLayout &&
      !previewHasImage &&
      (isPreviewGenerationStage || showPreviewGeneratingEarly)) ||
    (
      !isPreviewGenerationStage &&
      (previewQuestionRevealReady || previewHasImage) &&
      (!useMobilePreviewLayout || previewHasImage || isBacktrackingInForm)
    );

  const isLeadPricingPresentationActive = Boolean(
    previewHasImage && leadCapturedForUI && !designControlsRevealed && !isBacktrackingInForm
  );
  const shouldRevealCompactedQuestionPane = Boolean(
    isBacktrackingInForm ||
      forceQuestionPaneVisibleForBacktracking ||
      designControlsRevealed ||
      questionPaneRevealedByUser ||
      !galleryPreviewActive ||
      previewHasImage
  );
  const gatedQuestionPaneUnderPreview = Boolean(
    showQuestionPaneUnderPreview && shouldRevealCompactedQuestionPane
  );

  const handleKeepDesigning = useCallback(() => {
    setAdventureInputMode("questions");
    setDesignControlsRevealed(true);
    setQuestionPaneRevealedByUser(true);
  }, []);
  // Hide while advancing after lead capture (waiting for next step to load)
  const advancingStepId = leadCapturedAdvanceStepIdRef.current;
  const isAdvancingAfterLeadCapture = Boolean(
    advancingStepId && currentStep?.id === advancingStepId
  );
  useEffect(() => {
    const captured = leadCapturedAdvanceStepIdRef.current;
    if (captured && currentStep?.id && currentStep.id !== captured) {
      leadCapturedAdvanceStepIdRef.current = null;
    }
  }, [currentStep?.id]);
  const hideQuestionPane = Boolean(
    isInitialLoading ||
    !gatedQuestionPaneUnderPreview ||
    isAdvancingAfterLeadCapture ||
    hideQuestionPaneUntilConceptSingle
  );
  useEffect(() => {
    const committedRaw = (state?.stepData as any)?.["step-refinement-upload-scene-image"];
    const committed =
      Array.isArray(committedRaw)
        ? committedRaw.find((x) => typeof x === "string" && x)
        : typeof committedRaw === "string"
          ? committedRaw
          : null;
    if (!pendingPreviewSceneUploadUrl || !committed) return;
    if (String(committed) === String(pendingPreviewSceneUploadUrl)) {
      setPendingPreviewSceneUploadUrl(null);
    }
  }, [pendingPreviewSceneUploadUrl, state?.stepData]);
  useEffect(() => {
    setFacts((prev) => ({
      ...prev,
      viewportMode: isMobileViewport ? "mobile" : isDesktopViewport ? "desktop" : "desktop",
      showBranding: Boolean(showBrandingHeader),
      showProgress: Boolean(showProgressBar),
      showTimeline: Boolean(showStepDescriptions && state?.steps && state.steps.length > 0),
      previewEnabled: Boolean(previewEnabled),
      previewVisible: Boolean(previewVisible),
      previewHasImage: Boolean(previewHasImage),
      leadCaptured: Boolean(effectiveLeadCompleteForPreviewFlow),
      showQuestionPane: Boolean(gatedQuestionPaneUnderPreview),
      showEaseFeedback: Boolean(showEasePrompt),
      showReflectionFeedback: Boolean(flowCompleted && !reflectionFeedbackSent),
    }));
  }, [
    flowCompleted,
    isDesktopViewport,
    isMobileViewport,
    effectiveLeadCompleteForPreviewFlow,
    previewEnabled,
    previewHasImage,
    previewVisible,
    gatedQuestionPaneUnderPreview,
    isPreviewGenerationStage,
    reflectionFeedbackSent,
    setFacts,
    showBrandingHeader,
    showEasePrompt,
    showProgressBar,
    showStepDescriptions,
    state?.steps,
  ]);

  const refinementUploadInputRef = useRef<HTMLInputElement>(null);
  const [refinementUploading, setRefinementUploading] = useState(false);

  const effectiveError = engineError || batchError;

  if (effectiveError) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6 text-center">
        <div className="max-w-md">
          <p className="text-red-500 mb-4">{effectiveError}</p>
          <Button
            type="button"
            onClick={() => window.location.reload()}
            className="h-11 px-6 text-sm font-semibold"
            style={{
              backgroundColor: theme.buttonStyle?.backgroundColor || theme.primaryColor,
              color: theme.buttonStyle?.textColor || "#ffffff",
              fontFamily: theme.fontFamily,
              borderRadius: `${theme.borderRadius}px`,
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (showUnifiedStartupLoader && !engineError && !batchError) {
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <AdventureLoader phase="initial" active={true} className="min-h-0 py-8" />
      </div>
    );
  }

  // Satiety is now calculated from state.steps directly in ConfidenceHUD
  const currentStepMeta = currentStep
    ? {
        ...stepMetaRef.current.get(currentStep.id),
        order: (state?.currentStepIndex ?? 0) + 1,
      }
    : null;
  const guidedThumbnailMode = Boolean(previewLayoutActive && showQuestionPaneUnderPreview && !pricedGridStepActive);
  const compactQuestionHost = Boolean(previewLayoutActive && showQuestionPaneUnderPreview && previewHasImage && !pricedGridStepActive);
  const compactStepType = String((stepForRenderer as any)?.type || (stepForRenderer as any)?.componentType || "").toLowerCase();
  const compactLargeQuestionHost = compactStepType === "image_choice_grid";
  const isRefinementUploadStep = String((stepForRenderer as any)?.id) === REFINEMENT_UPLOAD_STEP_ID;
  const hasPreviewSubsections = showEasePrompt;
  const stepJoggerSteps = buildStepJoggerSteps({
    steps: state?.steps || [],
    currentStepIndex: state?.currentStepIndex ?? 0,
    maxVisitedIndex,
    effectiveLeadCompleteForPreviewFlow,
    previewHasImage,
    belowPreviewControlStepIds,
    refinementUploadStepId: REFINEMENT_UPLOAD_STEP_ID,
    getStepMetaById: (stepId) => stepMetaRef.current.get(stepId) ?? null,
  });
  const stepJoggerVisible = Boolean(showStepDescriptions && stepJoggerSteps.length > 1);
  return (
	  <div
	    className="flex w-full flex-col bg-transparent text-foreground max-sm:h-auto max-sm:min-h-min max-sm:overflow-visible sm:h-full sm:min-h-0 sm:overflow-hidden"
	    style={{ color: theme.textColor }}
	  >
	      {/* Header always owns its height budget so the body starts below it. */}
        <StepEngineHeaderSection
          showProgressBar={showProgressBar}
          metricProgress={formState?.metricProgress}
          progressPercentage={progress?.percentage ?? null}
          stepJoggerVisible={stepJoggerVisible}
          stepJoggerSteps={stepJoggerSteps}
          currentStepIndex={state?.currentStepIndex || 0}
          maxVisitedIndex={maxVisitedIndex}
          onNavigateToStep={handleStepJoggerNavigate}
          onSetAdventureInputModeQuestions={() => setAdventureInputMode("questions")}
          theme={{ primaryColor: theme.primaryColor, textColor: theme.textColor, fontFamily: theme.fontFamily }}
        />

	      {/* Main body inherits the post-header height budget. */}
        <StepEngineBodySection
          previewColumnRef={previewColumnRef}
          previewLayoutActive={previewLayoutActive}
          isMobileViewport={isMobileViewport}
          usePreviewDominantLayout={usePreviewDominantLayout}
          previewRailOpen={previewRailOpen}
          showPreviewSection={showPreviewSection}
          previewEnabled={previewEnabled}
          leadPricingPresentationActive={isLeadPricingPresentationActive}
          previewViewportRef={previewViewportRef}
          pricedGridStepActive={pricedGridStepActive}
          allowConceptGallery={allowConceptGallery}
          styleStepActive={isStyleStepActive}
          showQuestionPaneUnderPreview={gatedQuestionPaneUnderPreview}
          adventureInputMode={adventureInputMode}
          previewAutoAnsweredQuestionCount={previewAutoAnsweredQuestionCount}
          previewAutoGenerationCounterScope={previewAutoGenerationCounterScope}
          config={config}
          hasPreviewSubsections={hasPreviewSubsections}
          instanceId={instanceId}
          isAdventureSurface={isAdventureSurface}
          isRefinementUploadStep={isRefinementUploadStep}
          previewMaxPx={previewMaxPx}
          previewHasImage={previewHasImage}
          previewSurfaceMode={previewSurfaceMode}
          previewRefreshNonce={previewRefreshNonce}
          stepNavReturnToGalleryNonce={stepNavReturnToGalleryNonce}
          pendingPreviewSceneUploadUrl={pendingPreviewSceneUploadUrl}
          promptDraft={promptDraft}
          promptSubmitCount={promptSubmitCount}
          sessionId={sessionId}
          setPreviewAutoGenerationBusy={setPreviewAutoGenerationBusy}
          setPreviewHasImage={setPreviewHasImage}
          setPreviewVisible={setPreviewVisible}
          onPreviewSurfaceModeChange={handlePreviewSurfaceModeChange}
          state={state}
          useDesktopPreviewLayout={useDesktopPreviewLayout}
          useMobilePreviewLayout={useMobilePreviewLayout}
          hideQuestionPane={hideQuestionPane}
          compactQuestionHost={compactQuestionHost}
          compactLargeQuestionHost={compactLargeQuestionHost}
          flowCompleted={flowCompleted}
          handleBack={handleBack}
          handleEaseFeedback={handleEaseFeedback}
          handleReflectionFeedback={handleReflectionFeedback}
          handleStepComplete={handleStepComplete}
          isBatchLoading={isBatchLoading}
          isFetchingNext={isFetchingNext || isAutoPreviewRefreshLocked}
          effectiveLeadCompleteForPreviewFlow={effectiveLeadCompleteForPreviewFlow}
          leadGateLocksQuestionArea={leadGateLocksQuestionArea}
          setAdventureInputMode={setAdventureInputMode}
          onApplyIdeaSuggestion={applyIdeaSuggestion}
          budgetSliderConfig={budgetSliderConfig}
          budgetValue={budgetValue}
          handleBudgetChange={handleBudgetChange}
          setPromptDraft={setPromptDraft}
          onPromptSubmit={(uploadedUrl?: string) => {
            if (uploadedUrl && typeof uploadedUrl === "string") setPendingPreviewSceneUploadUrl(uploadedUrl);
            setPromptSubmitCount((prev) => prev + 1);
            setPreviewRefreshNonce((prev) => prev + 1);
          }}
          onRegeneratePreview={(uploadedUrl?: string) => {
            if (uploadedUrl && typeof uploadedUrl === "string") {
              setPendingPreviewSceneUploadUrl(uploadedUrl);
              updateStepData(REFINEMENT_UPLOAD_STEP_ID, uploadedUrl);
              updateStepData(DETERMINISTIC_SCENE_IMAGE_ID, uploadedUrl);
            }
            setPreviewRefreshNonce((prev) => prev + 1);
          }}
          questionContentRef={questionContentRef}
          questionScale={questionScale}
          questionViewportRef={questionViewportRef}
          refinementUploadInputRef={refinementUploadInputRef}
          refinementUploading={refinementUploading}
          reflectionFeedbackSent={reflectionFeedbackSent}
          setRefinementUploading={setRefinementUploading}
          showStepTransitionSkeleton={
            ((isFetchingNext && !showAccuratePricingLoader) || awaitingRefinementAdvance) &&
            !isPreviewGenerationStage &&
            !showPreviewGeneratingEarly
          }
          previewGeneratingFocused={isPreviewGenerationStage || showPreviewGeneratingEarly}
          showAccuratePricingLoader={showAccuratePricingLoader}
          showEasePrompt={showEasePrompt}
          onKeepDesigning={handleKeepDesigning}
          stepForRenderer={stepForRenderer}
          theme={{
            borderRadius: theme.borderRadius,
            fontFamily: theme.fontFamily,
            primaryColor: theme.primaryColor,
            secondaryColor: theme.secondaryColor,
            textColor: theme.textColor,
          }}
          layoutDebugEnabled={layoutDebugEnabled}
          effectiveCurrentStep={effectiveCurrentStep}
          guidedThumbnailMode={guidedThumbnailMode}
        />
	      <DevModeOverlay
	        enabled={devModeEnabled}
	        sessionId={sessionId}
	        instanceId={instanceId}
          sessionScopeKey={effectiveSessionScopeKey}
	        step={currentStep}
	        meta={currentStepMeta}
	        stats={devModeStats}
	        ui={devModeUI}
	      />
	  </div>
	  );
}
