"use client";

// Step Engine - Main component that orchestrates the form flow
import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from "next/navigation";
import { useStepEngine } from '@/hooks/use-step-engine';
import { useFormMetrics } from '@/hooks/use-form-metrics';
import { FlowPlan, FormState, StepDefinition, UIStep } from '@/types/ai-form';
import { useFormTheme } from '../../demo/FormThemeProvider';
import { emitFeedback, emitTelemetry } from '@/lib/ai-form/telemetry';
import { isDevModeEnabled } from '@/lib/ai-form/dev-mode';
import { DevModeOverlay, type DevModeStats, type DevModeUIState } from '../../dev-helpers/DevModeOverlay';
import { saveUIPlan } from '@/lib/ai-form/state/ui-plan-storage';
import { saveFormPlan } from '@/lib/ai-form/state/form-plan-storage';
import { loadServiceCatalog } from '@/lib/ai-form/state/service-catalog-storage';
import { cn } from "@/lib/utils";
import { AdventureLoader } from "../../AdventureLoader";
import { Button } from "@/components/ui/button";
import { collectReferenceImagesFromStepData } from "@/lib/ai-form/utils/reference-images";
import { useExperienceState } from "@/components/form/state/ExperienceState";
import { usePreviewEligibility } from "./step-engine/hooks/usePreviewEligibility";
import { usePreviewLayout } from "./step-engine/hooks/usePreviewLayout";
import { PreviewSection } from "./step-engine/sections/PreviewSection";
import { FormQuestionSection } from "./step-engine/sections/FormQuestionPaneSection";
import { buildDeterministicStyleStep } from "../static/deterministic-style-step";
import {
  DETERMINISTIC_BUDGET_ID,
  DETERMINISTIC_CONSENT_ID,
  DETERMINISTIC_FULL_NAME_ID,
  DETERMINISTIC_PRODUCT_IMAGE_ID,
  DETERMINISTIC_SCENE_IMAGE_ID,
  DETERMINISTIC_SERVICE_ID,
  DETERMINISTIC_STYLE_ID,
  DETERMINISTIC_USER_IMAGE_ID,
  FORM_STATE_SCHEMA_VERSION,
  PRICING_ESTIMATE_KEY,
} from "./step-engine/constants";
import { deriveBudgetSliderRange, roundBudgetStep } from "./step-engine/utils/budget";
import { hexToRgba } from "@/types/design";
import { clamp01, fnv1a32, joinSummaries, mergeUniqueStrings, normalizeOptionalString } from "./step-engine/utils/core";
import {
  extractCompositeBlockCalls,
  getFunctionCallOutputs,
  getMinTriggerCount,
  getTriggerProgress,
  isFunctionCallStep,
  type FunctionCallHint,
  type FunctionCallOutput,
} from "./step-engine/utils/function-calls";
import { loadFormState, normalizeFormState, saveFormState } from "./step-engine/utils/form-state";
import { extractFirstName, personalizeStepCopy } from "./step-engine/utils/personalization";
import { buildAnsweredQA, getMetricGain, safeStableJsonForPricingContext } from "./step-engine/utils/pricing-context";
import {
  countPreviewGateQuestions,
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
  /** When true, render widget-style branding header above the step jogger. */
  showBrandingHeader?: boolean;
  onMeta?: (meta: { [key: string]: any }) => void;
}

function isBootstrapStepIdValue(stepId: string | null | undefined): boolean {
  const id = String(stepId || "");
  return id.startsWith(DETERMINISTIC_SERVICE_ID) || id === DETERMINISTIC_CONSENT_ID || id === DETERMINISTIC_STYLE_ID;
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
  showBrandingHeader = false,
  onMeta
}: StepEngineProps) {
  const REFINEMENT_UPLOAD_STEP_ID = "step-refinement-upload-scene-image";
  const { setFacts } = useExperienceState();
  const searchParams = useSearchParams();
  const { theme, config: designConfig } = useFormTheme();
  const effectiveSessionScopeKey = sessionScopeKey || instanceId;
  const normalizeBool = (value: any): boolean | null => {
    if (value === true) return true;
    if (value === false) return false;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
      return null;
    }
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
      if (v === "false" || v === "0" || v === "no" || v === "off") return false;
      return null;
    }
    return null;
  };
  // Prefer consolidated `instances.config.form_*` keys when present; fall back to legacy flow_layout flags.
  const uiShowProgressBar = normalizeBool(formUI?.showProgressBar);
  const uiShowStepDescriptions = normalizeBool(formUI?.showStepDescriptions);
  const showProgressBar =
    uiShowProgressBar !== null ? uiShowProgressBar : flowLayout?.showProgressBar !== false;
  const showStepDescriptions =
    uiShowStepDescriptions !== null ? uiShowStepDescriptions : flowLayout?.showStepNumbers !== false;
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
  const [, setPreviewAdvanceGateOpen] = useState(false);
  const pendingPreviewAdvanceRef = useRef<null | { stepId: string; data: any }>(null);
  const leadCapturedAdvancedRef = useRef(false);
  const leadCapturedAdvanceStepIdRef = useRef<string | null>(null);
  const leadGateLocksQuestionAreaRef = useRef(false);
  /** When true, we just completed a scene upload step and are fetching the next batch; prefer preview "generating" loader over "Getting you accurate pricing..." to avoid overlapping loaders. */
  const sceneUploadJustCompletedRef = useRef(false);
  const [adventureInputMode, setAdventureInputMode] = useState<"questions" | "prompt" | "budget" | "uploads">("questions");
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
  const [budgetApiRange, setBudgetApiRange] = useState<{ min: number; max: number; currency: string } | null>(null);
  const budgetApiLoadedSessionRef = useRef<string | null>(null);
  const devModeEnabled = useMemo(() => isDevModeEnabled(), []);
  const layoutDebugEnabled = useMemo(() => {
    const v = (searchParams.get("layout_debug") || "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }, [searchParams]);
  const previousSelectedServiceIdRef = useRef<string | null>(null);
  
  const { trackStepStart, trackStepComplete } = useFormMetrics({
    instanceId,
    sessionId: flowPlan?.sessionId || '',
    entrySource,
    sessionGoal
  });
	  const contextExtra = useMemo(() => ({ useCase: config?.useCase }), [config?.useCase]);
	  const sessionId = flowPlan?.sessionId || "";

	  // Dark mode is disabled for now; the form design config owns colors.
	  // Keep this effect above any early returns to avoid hook-order issues.
	  useEffect(() => {
	    if (typeof document === "undefined") return;
	    document.documentElement.classList.remove("dark");
	    try {
	      window.localStorage.setItem("sif_theme", "light");
	    } catch {}
	  }, []);

  const optionalSceneImageStep: StepDefinition = useMemo(
    () => ({
      id: DETERMINISTIC_SCENE_IMAGE_ID,
      componentType: "upload",
      intent: "collect_context",
      data: {
        required: false,
        maxFiles: 1,
        accept: "image/*",
        uploadRole: "sceneImage",
        camera: true,
      },
      copy: {
        headline: "Have a photo handy?",
        subtext: "Optional — upload one for tailored results, or skip and we'll generate concept ideas.",
      },
    }),
    []
  );

  const requiredSceneImageStep: StepDefinition = useMemo(
    () => ({
      id: DETERMINISTIC_SCENE_IMAGE_ID,
      componentType: "upload",
      intent: "collect_context",
      data: {
        required: true,
        maxFiles: 1,
        accept: "image/*",
        uploadRole: "sceneImage",
        camera: true,
      },
      copy: {
        headline: "Upload a photo of the space",
        subtext: "Upload (or take) a photo of the room/area so we can generate the preview.",
      },
    }),
    []
  );

  const requiredUserImageStep: StepDefinition = useMemo(
    () => ({
      id: DETERMINISTIC_USER_IMAGE_ID,
      componentType: "upload",
      intent: "collect_context",
      data: {
        required: true,
        maxFiles: 1,
        accept: "image/*",
        uploadRole: "userImage",
        camera: true,
      },
      copy: {
        headline: "Upload a photo of the person",
        subtext: "Upload (or take) a photo so we can generate the try-on preview.",
      },
    }),
    []
  );

  const requiredProductImageStep: StepDefinition = useMemo(
    () => ({
      id: DETERMINISTIC_PRODUCT_IMAGE_ID,
      componentType: "upload",
      intent: "collect_context",
      data: {
        required: true,
        maxFiles: 1,
        accept: "image/*",
        uploadRole: "productImage",
        camera: false,
      },
      copy: {
        headline: "Upload a photo of the product",
        subtext: "Upload a clear product photo so we can place it accurately in the preview.",
      },
    }),
    []
  );

  const normalizedUseCase = useMemo((): "tryon" | "scene-placement" | "scene" => {
    const raw = String(config?.useCase || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-")
      .replace(/\s+/g, "-");
    if (raw === "tryon" || raw === "try-on") return "tryon";
    if (raw === "scene-placement") return "scene-placement";
    if (raw === "scene") return "scene";
    return "scene";
  }, [config?.useCase]);

  const desiredDeterministicUploadSteps = useMemo(() => {
    // Upload step(s) are a deterministic checkpoint before preview generation.
    // This ensures users see/provide the anchor image before the first generate run.
    if (normalizedUseCase === "tryon") return [requiredUserImageStep, requiredProductImageStep];
    if (normalizedUseCase === "scene-placement") return [requiredSceneImageStep, requiredProductImageStep];
    return [optionalSceneImageStep];
  }, [
    normalizedUseCase,
    optionalSceneImageStep,
    requiredProductImageStep,
    requiredSceneImageStep,
    requiredUserImageStep,
  ]);

  const deterministicBudgetStep: StepDefinition = useMemo(() => {
    const cfg = (config as any)?.previewPricing;
    const apiMin = Number(budgetApiRange?.min);
    const apiMax = Number(budgetApiRange?.max);
    const hasApiBounds = Number.isFinite(apiMin) && Number.isFinite(apiMax) && apiMin > 0 && apiMax > 0;
    const cfgMin = Number(cfg?.totalMin);
    const cfgMax = Number(cfg?.totalMax);
    const currency =
      typeof budgetApiRange?.currency === "string" && budgetApiRange.currency.trim()
        ? budgetApiRange.currency.trim().toUpperCase()
        : "USD";
    const defaultMin = normalizedUseCase === "tryon" ? 500 : 2000;
    const defaultMax = normalizedUseCase === "tryon" ? 10000 : 50000;
    const derived = deriveBudgetSliderRange(cfgMin, cfgMax, defaultMin, defaultMax);
    const min = hasApiBounds ? Math.min(apiMin, apiMax) : derived.min;
    const max = hasApiBounds ? Math.max(apiMin, apiMax) : derived.max;
    const step = hasApiBounds ? Math.max(100, roundBudgetStep(max - min)) : derived.step;
    return {
      id: DETERMINISTIC_BUDGET_ID,
      componentType: "slider",
      intent: "collect_context",
      data: {
        required: true,
        min,
        max,
        step: Math.max(100, step),
        currency,
        unit: "$",
        unitType: "currency",
        format: "currency",
      },
      copy: {
        headline: "What budget range should we design around?",
        subtext: "Move the slider to set your target spend so pricing and image quality stay aligned.",
      },
    };
  }, [budgetApiRange, config, normalizedUseCase]);

  const budgetSliderConfig = useMemo(() => {
    const data = (deterministicBudgetStep as any)?.data || {};
    return {
      min: Number(data.min ?? 2000),
      max: Number(data.max ?? 50000),
      step: Number(data.step ?? 500),
      currency: typeof data.currency === "string" && data.currency.trim() ? String(data.currency).trim().toUpperCase() : "USD",
    };
  }, [deterministicBudgetStep]);

  const handleFlowComplete = useCallback(
    (allData: Record<string, any>) => {
      if (flowCompletedRef.current) return;
      flowCompletedRef.current = true;
      setFlowCompleted(true);

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
    [instanceId, onFlowComplete, sessionId]
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
    extra: contextExtra
  });
  const serviceCatalogSnapshot = useMemo(
    () => (sessionId ? loadServiceCatalog(sessionId) : null),
    [sessionId, state?.stepData]
  );
  const selectedServiceId = useMemo(
    () => pickPrimaryServiceId((state?.stepData || {}) as Record<string, any>),
    [state?.stepData]
  );
  const selectedServiceMeta = selectedServiceId ? (serviceCatalogSnapshot?.byServiceId as any)?.[selectedServiceId] : null;
  const deterministicStyleStep = useMemo(
    () => buildDeterministicStyleStep(selectedServiceMeta),
    [selectedServiceMeta]
  );

  const budgetValue = useMemo((): number | null => {
    const raw = (state?.stepData as any)?.[DETERMINISTIC_BUDGET_ID];
    const v = Array.isArray(raw) ? raw[0] : raw;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }, [state?.stepData]);

  useEffect(() => {
    if (!sessionId || !instanceId) return;
    if (!hasReceivedQuestionsFromGenerateSteps) return;
    if (budgetApiLoadedSessionRef.current === sessionId) return;
    budgetApiLoadedSessionRef.current = sessionId;

    const stepData = (state?.stepData as any) || {};
    const questionStepIds = (state?.steps || [])
      .filter((step) => isQuestionStepForAskedIds(step))
      .map((step) => String((step as any)?.id || ""))
      .filter(Boolean);

    fetch(`/api/ai-form/${instanceId}/pricing`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        sessionId,
        stepDataSoFar: stepData,
        askedStepIds: questionStepIds,
        noCache: false,
        useCase: config?.useCase,
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Budget pricing ${r.status}`))))
      .then((json: any) => {
        const estimate = json?.estimate && typeof json.estimate === "object" ? json.estimate : json;
        const range = estimate?.servicePriceRange && typeof estimate.servicePriceRange === "object"
          ? estimate.servicePriceRange
          : null;
        const low = Number(range?.low ?? estimate?.totalMin);
        const high = Number(range?.high ?? estimate?.totalMax);
        if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0) return;
        const currency =
          typeof estimate?.currency === "string" && estimate.currency.trim() ? String(estimate.currency).trim().toUpperCase() : "USD";
        setBudgetApiRange({ min: Math.min(low, high), max: Math.max(low, high), currency });
      })
      .catch((e) => {
        console.warn("[StepEngine] budget pricing seed failed", e);
      });
  }, [config?.useCase, hasReceivedQuestionsFromGenerateSteps, instanceId, sessionId, state?.stepData, state?.steps]);

  const handleBudgetChange = useCallback(
    (value: number) => {
      updateStepData(DETERMINISTIC_BUDGET_ID, value);
    },
    [updateStepData]
  );

  // Async refinements: only fetch after the first concept is shown and lead capture
  // has been explicitly completed for this session. Then prepend a deterministic
  // upload step and inject refinement questions immediately after the user's
  // current post-preview position so they do not land behind the current step.
  const refinementsFetchedRef = useRef(false);
  const refinementAdvanceFromStepIdRef = useRef<string | null>(null);
  const pendingRefinementFocusStepIdRef = useRef<string | null>(null);
  const [awaitingRefinementAdvance, setAwaitingRefinementAdvance] = useState(false);
  useEffect(() => {
    if (!previewHasImage || !flowPlan?.sessionId || !instanceId) return;
    if (!effectiveLeadCompleteForPreviewFlow) return;
    if (refinementsFetchedRef.current) return;
    refinementsFetchedRef.current = true;

    const steps = state?.steps || [];
    const stepData = state?.stepData || {};
    const questionStepIds = steps
      .filter((s: any) => isQuestionStepForAskedIds(s))
      .map((s: any) => String((s as any)?.id || ""))
      .filter(Boolean);

    fetch(`/api/ai-form/${instanceId}/refinements`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        sessionId: flowPlan.sessionId,
        stepDataSoFar: stepData,
        askedStepIds: questionStepIds,
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Refinements ${r.status}`))))
      .then((json: any) => {
        const miniSteps = Array.isArray(json?.miniSteps) ? json.miniSteps : [];
        // Skip refinement upload when user already went through step-upload-scene-image
        const alreadyHasSceneUpload = steps.some(
          (s: any) => String((s as any)?.id || "") === DETERMINISTIC_SCENE_IMAGE_ID
        );
        const deterministicUploadStep = {
          id: REFINEMENT_UPLOAD_STEP_ID,
          type: "file_upload",
          question: "",
          humanism: "Start from your real space for better refinements.",
          required: false,
          allow_skip: true,
          upload_role: "scene",
          blueprint: { presentation: { continue_label: "Continue", allow_skip: true } },
        } as any;
        const incoming = alreadyHasSceneUpload ? miniSteps : [deterministicUploadStep, ...miniSteps];
        const existingIds = new Set(
          steps.map((s: any) => String((s as any)?.id || "")).filter(Boolean)
        );
        incoming.forEach((step: any) => {
          const stepId = String((step as any)?.id || "");
          if (!stepId || !existingIds.has(stepId)) return;
          patchStep(stepId, {
            __refinementStep: stepId !== REFINEMENT_UPLOAD_STEP_ID,
            __refinementUploadStep: stepId === REFINEMENT_UPLOAD_STEP_ID,
          });
        });
        const deduped = incoming.filter((s: any) => {
          const id = String((s as any)?.id || "");
          return id && !existingIds.has(id);
        });
        if (deduped.length === 0) return;

        const markedDeduped = deduped.map((step: any) => {
          const stepId = String((step as any)?.id || "");
          if (!stepId) return step;
          return {
            ...step,
            __refinementStep: stepId !== REFINEMENT_UPLOAD_STEP_ID,
            __refinementUploadStep: stepId === REFINEMENT_UPLOAD_STEP_ID,
          };
        });

        const firstRefinementQuestionId =
          markedDeduped.find((s: any) => String((s as any)?.id || "") !== REFINEMENT_UPLOAD_STEP_ID)?.id || null;

        const currentIdx = state?.currentStepIndex ?? 0;
        const designerIdx = steps.findIndex((s: any) => String((s as any)?.id || "") === "step-designer");
        const minPreviewInsertIndex = designerIdx >= 0 ? designerIdx + 1 : 0;
        const insertAtIndex = Math.min(
          steps.length,
          Math.max(minPreviewInsertIndex, currentIdx + 1)
        );
        // Auto-advance if user is already at/past the insertion point (finished all planner questions).
        const userIsWaiting = currentIdx >= steps.length - 1;
        if (userIsWaiting && currentStep?.id) {
          refinementAdvanceFromStepIdRef.current = String(currentStep.id);
          setAwaitingRefinementAdvance(true);
        }
        if (!userIsWaiting && currentStep && isStructuralStep(currentStep) && firstRefinementQuestionId) {
          pendingRefinementFocusStepIdRef.current = String(firstRefinementQuestionId);
        }
        addSteps(markedDeduped, userIsWaiting, { insertAtIndex });
        if (!userIsWaiting) {
          refinementAdvanceFromStepIdRef.current = null;
          setAwaitingRefinementAdvance(false);
        }
      })
      .catch((e) => {
        refinementsFetchedRef.current = false; // Allow retry on error
        refinementAdvanceFromStepIdRef.current = null;
        setAwaitingRefinementAdvance(false);
        if (typeof console !== "undefined" && console.warn) {
          console.warn("[StepEngine] Refinements fetch failed", e);
        }
      });
  }, [
    previewHasImage,
    flowPlan?.sessionId,
    instanceId,
    effectiveLeadCompleteForPreviewFlow,
    addSteps,
    currentStep?.id,
    patchStep,
    state?.currentStepIndex,
    state?.stepData,
    state?.steps,
  ]);

  useEffect(() => {
    if (!awaitingRefinementAdvance) return;
    const fromStepId = refinementAdvanceFromStepIdRef.current;
    const currentId = String(currentStep?.id || "");
    if (!fromStepId || !currentId) return;
    if (currentId !== fromStepId) {
      refinementAdvanceFromStepIdRef.current = null;
      setAwaitingRefinementAdvance(false);
    }
  }, [awaitingRefinementAdvance, currentStep?.id]);

  useEffect(() => {
    const targetStepId = pendingRefinementFocusStepIdRef.current;
    if (!targetStepId) return;
    const steps = state?.steps || [];
    const targetIndex = steps.findIndex((step: any) => String((step as any)?.id || "") === targetStepId);
    if (targetIndex < 0) return;
    if (String(currentStep?.id || "") === targetStepId) {
      pendingRefinementFocusStepIdRef.current = null;
      return;
    }
    pendingRefinementFocusStepIdRef.current = null;
    goToStep(targetIndex);
  }, [currentStep?.id, goToStep, state?.steps]);

  useEffect(() => {
    if (previewHasImage) return;
    refinementAdvanceFromStepIdRef.current = null;
    pendingRefinementFocusStepIdRef.current = null;
    pendingRefinementPreviewAdvanceRef.current = null;
    pendingRefinementPreviewAdvanceStageRef.current = "idle";
    setAwaitingRefinementAdvance(false);
  }, [previewHasImage]);

  useEffect(() => {
    const stage = pendingRefinementPreviewAdvanceStageRef.current;
    const pending = pendingRefinementPreviewAdvanceRef.current;
    if (!pending) {
      pendingRefinementPreviewAdvanceStageRef.current = "idle";
      return;
    }
    if (stage === "waiting_for_start") {
      if (!previewAutoGenerationBusy) return;
      pendingRefinementPreviewAdvanceStageRef.current = "waiting_for_finish";
      return;
    }
    if (stage !== "waiting_for_finish" || previewAutoGenerationBusy) return;
    if (!currentStep || currentStep.id !== pending.stepId) {
      pendingRefinementPreviewAdvanceRef.current = null;
      pendingRefinementPreviewAdvanceStageRef.current = "idle";
      return;
    }
    pendingRefinementPreviewAdvanceRef.current = null;
    pendingRefinementPreviewAdvanceStageRef.current = "idle";
    void goToNextStep(pending.data);
  }, [currentStep, goToNextStep, previewAutoGenerationBusy]);

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

  // When lead is captured: switch to Guided tab so user sees next questions immediately.
  useEffect(() => {
    if (leadCapturedForUI) setAdventureInputMode("questions");
  }, [leadCapturedForUI]);

  useEffect(() => {
    if (!effectiveLeadCompleteForPreviewFlow) return;
    if (!previewHasImage) return;
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
    effectiveLeadCompleteForPreviewFlow,
    previewHasImage,
    state?.currentStepIndex,
    state?.steps,
  ]);

  // If we blocked an auto-advance due to the preview gate, resume once lead is captured.
  useEffect(() => {
    if (!effectiveLeadCompleteForPreviewFlow) return;
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
    effectiveLeadCompleteForPreviewFlow,
    previewHasImage,
    state?.currentStepIndex,
    state?.stepData,
    state?.steps,
  ]);

  // --- Pricing estimate (AI) ---
  const pricingEstimateAbortRef = useRef<AbortController | null>(null);
  const pricingEstimateInFlightHashRef = useRef<string | null>(null);

  const pricingContextHash = useMemo(() => {
    const stable = safeStableJsonForPricingContext(state?.stepData || {});
    return stable ? fnv1a32(stable) : "";
  }, [state?.stepData]);

  useEffect(() => {
    if (!flowPlan?.sessionId) return;
    if (!instanceId) return;
    if (!state?.stepData || !state?.steps) return;
    if (!effectiveLeadCompleteForPreviewFlow) return;
    if (!pricingContextHash) return;

	    if (pricingEstimateInFlightHashRef.current === pricingContextHash) return;

	    const existing = state.stepData?.[PRICING_ESTIMATE_KEY];
	    const existingObj = existing && typeof existing === "object" ? (existing as any) : null;
	    const existingStatus = typeof existingObj?.status === "string" ? String(existingObj.status) : null;
	    const existingHash = typeof existingObj?.contextHash === "string" ? String(existingObj.contextHash) : null;
	    // "running" is not terminal: requests can be aborted during step-data churn; allow retry when not actually in-flight.
	    if (existingHash === pricingContextHash && (existingStatus === "complete" || existingStatus === "error")) {
	      return;
	    }

    const pricingIndex = (state.steps || []).findIndex((s: any) => String((s as any)?.id || "") === "step-pricing");
    const stepsForPricingQA = pricingIndex > 0 ? (state.steps || []).slice(0, pricingIndex) : (state.steps || []);
    const answeredQA = buildAnsweredQA({ steps: stepsForPricingQA as any[], stepData: state.stepData || {}, max: 80 });
    const askedStepIds = Array.isArray(formState?.askedStepIds) ? formState.askedStepIds : [];
    const selectedServiceId = pickPrimaryServiceId(state.stepData || {});
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
    pricingEstimateInFlightHashRef.current = pricingContextHash;

    try {
      console.log("[pricing] start", {
        sessionId: flowPlan.sessionId,
        instanceId,
        pricingContextHash,
        answeredQACount: answeredQA.length,
      });
    } catch {}

    updateStepData(PRICING_ESTIMATE_KEY, {
      status: "running",
      contextHash: pricingContextHash,
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
            console.warn("[pricing] error", { sessionId: flowPlan.sessionId, instanceId, status: res.status, message, json });
          } catch {}
          updateStepData(PRICING_ESTIMATE_KEY, {
            status: "error",
            contextHash: pricingContextHash,
            error: message,
            errorDetails: json,
            updatedAt: Date.now(),
          });
          return;
        }

        const est = (json as any)?.estimate ?? json;
        const totalMin = Number((est as any)?.totalMin);
        const totalMax = Number((est as any)?.totalMax);
        const currency =
          typeof (est as any)?.currency === "string" ? String((est as any).currency).trim().toUpperCase() : "USD";
        const confidence =
          typeof (est as any)?.confidence === "string" ? String((est as any).confidence).trim().toLowerCase() : null;
        const requestId =
          typeof (est as any)?.requestId === "string" ? String((est as any).requestId).trim() : null;

        if (!Number.isFinite(totalMin) || !Number.isFinite(totalMax)) {
          try {
            console.warn("[pricing] invalid numbers", { sessionId: flowPlan.sessionId, instanceId, est, json });
          } catch {}
          updateStepData(PRICING_ESTIMATE_KEY, {
            status: "error",
            contextHash: pricingContextHash,
            error: "Pricing estimate returned invalid numbers",
            errorDetails: json,
            updatedAt: Date.now(),
          });
          return;
        }

        const normalizedMin = Math.min(totalMin, totalMax);
        const normalizedMax = Math.max(totalMin, totalMax);
        updateStepData(PRICING_ESTIMATE_KEY, {
          status: "complete",
          contextHash: pricingContextHash,
          totalMin: normalizedMin,
          totalMax: normalizedMax,
          currency,
          source: typeof (est as any)?.source === "string" ? String((est as any).source) : "ai",
          ...(confidence ? { confidence } : {}),
          ...(requestId ? { requestId } : {}),
          updatedAt: Date.now(),
        });
        try {
          console.log("[pricing] complete", {
            sessionId: flowPlan.sessionId,
            instanceId,
            totalMin: normalizedMin,
            totalMax: normalizedMax,
            currency,
            confidence,
            requestId,
          });
        } catch {}
      } catch (e) {
        if ((e as any)?.name === "AbortError") return;
        try {
          console.warn("[pricing] exception", { sessionId: flowPlan?.sessionId, instanceId, err: e });
        } catch {}
        updateStepData(PRICING_ESTIMATE_KEY, {
          status: "error",
          contextHash: pricingContextHash,
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
    effectiveLeadCompleteForPreviewFlow,
    pricingContextHash,
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
    if (!flowPlan?.sessionId) return;
    if (!state?.steps || state.steps.length === 0) return;
    if (!hasReceivedQuestionsFromGenerateSteps) return;
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
      const nextQuestion = String(budgetCopy.headline || "What budget range should we design around?");
      const nextMin = Number(budgetData.min ?? 2000);
      const nextMax = Number(budgetData.max ?? 50000);
      const nextStep = Number(budgetData.step ?? 500);
      const nextCurrency = String(budgetData.currency || "USD");
      const nextUnit = String(budgetData.unit || "$");
      const nextUnitType = String(budgetData.unitType || "currency");
      const nextFormat = String(budgetData.format || "currency");
      const isDifferent =
        String(currentBudgetStep?.question || "") !== nextQuestion ||
        Number(currentBudgetStep?.min) !== nextMin ||
        Number(currentBudgetStep?.max) !== nextMax ||
        Number(currentBudgetStep?.step) !== nextStep ||
        String(currentBudgetStep?.currency || "") !== nextCurrency ||
        String(currentBudgetStep?.unit || "") !== nextUnit ||
        String(currentBudgetStep?.unitType || "") !== nextUnitType ||
        String(currentBudgetStep?.format || "") !== nextFormat;
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
            required: true,
          },
          copy: {
            headline: nextQuestion,
            subtext: String(budgetCopy.subtext || ""),
          },
        });
      }
    }

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
    patchStep,
    previewHasImage,
    state,
  ]);

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

  // Log state changes
  useEffect(() => {
    if (state) {
      console.log('[StepEngine] State updated', {
        currentStepIndex: state.currentStepIndex,
        totalSteps: state.steps.length,
        currentStepId: state.steps[state.currentStepIndex]?.id,
        completedStepsCount: state.completedSteps?.size || 0,
        stepDataKeys: Object.keys(state.stepData || {}),
        stepDataCount: Object.keys(state.stepData || {}).length,
      });
    }
  }, [state?.currentStepIndex, state?.steps.length, state?.stepData]);

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
      if (id === DETERMINISTIC_SCENE_IMAGE_ID && stepData && Object.prototype.hasOwnProperty.call(stepData, id)) {
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

  // Log context state changes
  useEffect(() => {
    if (contextState) {
      console.log('[StepEngine] Context state updated', {
        entriesCount: contextState.entries?.length || 0,
        entries: contextState.entries?.map(e => ({
          question: e.question?.slice(0, 50),
          answer: typeof e.answer === 'string' ? e.answer.slice(0, 50) : e.answer,
        })) || [],
      });
    }
  }, [contextState]);

  useEffect(() => {
    functionCallOutputsRef.current = getFunctionCallOutputs(state?.stepData || {});
  }, [state?.stepData]);

  // Execute backend-directed function calls once prerequisites are met.
  // Results are persisted in `state.stepData.__functionCallOutputs` (step-state localStorage is keyed by instanceId).
  useEffect(() => {
    if (!state || !instanceId) return;

    // IMPORTANT:
    // Function-call steps are a backend-driven mechanism, but they must never spam network calls.
    // Until we have a strict allowlist + UX surfaces for these calls, keep auto-execution OFF by default.
    // Enable locally via: NEXT_PUBLIC_ENABLE_AI_FORM_FUNCTION_CALLS=true
    if (process.env.NEXT_PUBLIC_ENABLE_AI_FORM_FUNCTION_CALLS !== "true") return;

    const stepData = state.stepData || {};
    const outputs = getFunctionCallOutputs(stepData);
    const steps = state.steps || [];

    const candidates: Array<{ callKey: string; functionCall: FunctionCallHint }> = [];
    for (const s of steps) {
      const stepId = (s as any)?.id;
      const blockCalls = extractCompositeBlockCalls(s);
      // If a composite step has block-level calls, prefer those and ignore a step-level functionCall (dedupe).
      if (blockCalls.length > 0) {
        candidates.push(...blockCalls);
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
        // Progressive trigger semantics:
        // - If there are triggers, run as soon as we've satisfied `minCount` of them.
        // - If there are no triggers, run immediately.
        const readyToRun = total === 0 ? true : satisfied >= minCount;
        if (!readyToRun) {
          // Not ready yet: persist progress without starting the call.
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
            sessionId: flowPlan?.sessionId,
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
          const message =
            typeof (json as any)?.error === "string" ? (json as any).error : `Function execution failed (${resp.status})`;
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

      // IMPORTANT: Steps (question flow) and experiences (preview rail) are separate systems.
      // We do NOT auto-run step-embedded image preview generation. The preview rail is enabled by frontend gating logic.
      const callName = typeof functionCall?.name === "string" ? functionCall.name : null;
      if (callName === "generateInitialImage") {
        // Still record progress in the UI (idle) but never execute.
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
      const shouldStartFirstRun =
        (status === undefined || status === "idle" || status === "error") && readyToRun;
      if (!shouldStartFirstRun) continue;

      void run(callKey, functionCall);
    }
  }, [config, flowPlan?.sessionId, instanceId, state?.steps, state?.stepData, updateStepData]);

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
        const isDeterministic =
          isStructuralStep(skipped) ||
          isBootstrapStepIdValue(stepId);
        const stepSource = isDeterministic ? 'frontend_deterministic' : (meta?.modelRequestId ? 'backend_ai' : 'unknown');
        const totalSteps = state?.steps?.length || 0;
        
        emitTelemetry({
          sessionId,
          instanceId,
          eventType: "step_skipped",
          stepId,
          batchId: normalizeBatchId(meta?.batchId) ?? batchIdFromIndex(formState?.batchIndex) ?? undefined,
          modelRequestId: meta?.modelRequestId ?? undefined,
          timestamp: Date.now(),
          payload: {
            step_number: i + 1,
            total_steps: totalSteps,
            step_type: getStepType(skipped),
            is_deterministic: isDeterministic,
            source: stepSource,
            step_json: skipped, // Full step object
            from_order: prevIndex + 1,
            to_order: nextIndex + 1,
          },
        });
      }
    }
    prevIndexRef.current = nextIndex;
  }, [formState?.batchIndex, instanceId, sessionId, state?.currentStepIndex, state?.steps]);

  const isInitialLoading = Boolean(engineLoading || !flowPlan);

  const fetchAndAppendBatch = useCallback(
    async (stepDataSoFar: Record<string, any>, showLoading: boolean = false, wasOnLastStep: boolean = false) => {
      if (!flowPlan?.sessionId) return;
      if (leadGateLocksQuestionAreaRef.current) {
        console.log("[StepEngine] Lead gate active; skipping batch fetch");
        return;
      }
      if (batchingRef.current) {
        console.log('[StepEngine] Batch fetch already in progress, skipping');
        return;
      }
      setBatchError(null);
      batchingRef.current = true;
      pendingBatchTraceRef.current = null;
      let requestedBatchIndex: number | null = null;
      // Only show loading if explicitly requested (user is on last step)
      // Otherwise, load silently in background
      if (showLoading) {
        setIsBatchLoading(true);
      }
      try {
        const params = new URLSearchParams(window.location.search);
        const isFresh = params.get("fresh") === "1" || params.get("fresh") === "true";
        const questionStepIds = (state?.steps || [])
          .filter((step) => isQuestionStepForAskedIds(step))
          .map((step) => step.id);
        
        // Merge latest state with the triggering payload, but let the triggering payload win.
        // This preserves explicit clears/skips (e.g. scene upload skipped => null) over stale cached values.
        const latestStepData = state?.stepData || {};
        const mergedStepData = { ...latestStepData, ...stepDataSoFar };
        const serviceCatalogSnapshot = loadServiceCatalog(flowPlan.sessionId);
        const inferredSingleServiceId = (() => {
          const byServiceId = serviceCatalogSnapshot?.byServiceId;
          if (!byServiceId || typeof byServiceId !== "object") return null;
          const ids = Object.keys(byServiceId).filter(Boolean);
          return ids.length === 1 ? ids[0] : null;
        })();
        if (!pickPrimaryServiceId(mergedStepData) && inferredSingleServiceId) {
          mergedStepData[DETERMINISTIC_SERVICE_ID] = inferredSingleServiceId;
          if (mergedStepData.service_primary === undefined) {
            mergedStepData.service_primary = inferredSingleServiceId;
          }
          updateStepData(DETERMINISTIC_SERVICE_ID, inferredSingleServiceId);
          updateStepData("service_primary", inferredSingleServiceId);
        }
        const answeredQA = buildAnsweredQA({ steps: state?.steps || [], stepData: mergedStepData, max: 40 });
        
        console.log('[StepEngine] Fetching batch with stepData', {
          stepDataSoFarKeys: Object.keys(stepDataSoFar),
          latestStepDataKeys: Object.keys(latestStepData),
          mergedStepDataKeys: Object.keys(mergedStepData),
          hasChanges: Object.keys(mergedStepData).length !== Object.keys(stepDataSoFar).length,
        });
        
	        const effectiveFormState = formState
	          ? { ...formState }
	          : normalizeFormState({ formId: flowPlan.sessionId }, flowPlan.sessionId);
	        requestedBatchIndex = effectiveFormState.batchIndex;
	        if (requestedBatchIndex !== null && completedBatchIndexesRef.current.has(requestedBatchIndex)) {
	          console.log("[StepEngine] Batch already completed; skipping generate-steps request", { batchIndex: requestedBatchIndex });
	          return;
	        }
        if (requestedBatchIndex !== null && inFlightBatchIndexesRef.current.has(requestedBatchIndex)) {
          console.log("[StepEngine] Batch already in-flight; skipping generate-steps request", { batchIndex: requestedBatchIndex });
          return;
        }
        if (requestedBatchIndex !== null) inFlightBatchIndexesRef.current.add(requestedBatchIndex);
        // Ensure we don't keep requesting `batchIndex=0` forever on first load.
        // `formState` can be null during the first request; still persist the normalized state.
        if (!formState) {
          setFormState(effectiveFormState);
          saveFormState(flowPlan.sessionId, effectiveFormState);
        }

	        const combinedAskedStepIds = mergeUniqueStrings(
	          ((formState ?? effectiveFormState)?.askedStepIds ?? []).map((v: any) => String(v || "")).filter(Boolean),
	          questionStepIds.map((v: any) => String(v || "")).filter(Boolean),
	        );

	          const selectedServiceId = pickPrimaryServiceId(mergedStepData);
	          const serviceCatalog = serviceCatalogSnapshot;
	          const serviceMeta = selectedServiceId ? (serviceCatalog?.byServiceId as any)?.[selectedServiceId] : null;
	          const cachedServiceSummary =
	            typeof (effectiveFormState as any)?.serviceSummary === "string" ? String((effectiveFormState as any).serviceSummary).trim() : null;
	          const perServiceSummary = typeof serviceMeta?.serviceSummary === "string" ? String(serviceMeta.serviceSummary).trim() : null;
	          const serviceSummary = joinSummaries(cachedServiceSummary, perServiceSummary);
	          const businessContext =
	            typeof (config as any)?.businessContext === "string"
	              ? String((config as any).businessContext).trim()
	              : typeof (effectiveFormState as any)?.businessContext === "string"
	                ? String((effectiveFormState as any).businessContext).trim()
	                : null;
	          const instanceContext = {
	            businessContext,
	            serviceSummary,
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

	        const resp = await fetch(`/api/ai-form/${instanceId}/generate-steps`, {
		          method: "POST",
		          headers: { "Content-Type": "application/json", Accept: "application/json" },
		          cache: "no-store",
		          body: JSON.stringify({
		            sessionId: flowPlan.sessionId,
		            stepDataSoFar: mergedStepData,
		            askedStepIds: combinedAskedStepIds,
                debug:
                  typeof window !== "undefined" &&
                  (() => {
                    try {
                      const sp = new URLSearchParams(window.location.search);
                      const v = (sp.get("debug") || sp.get("ai_form_debug") || sp.get("form_debug") || "").trim().toLowerCase();
                      return v === "1" || v === "true" || v === "yes" || v === "on";
                    } catch {
                      return false;
                    }
                  })(),
		            // IMPORTANT: Do not send `maxBatches` from the frontend.
		            // The backend owns call caps; the client only reports current progress + askedStepIds.
		            formState: {
		              formId: effectiveFormState.formId,
		              batchIndex: effectiveFormState.batchIndex,
		              tokenBudgetTotal: effectiveFormState.tokenBudgetTotal,
		              tokensUsedSoFar: effectiveFormState.tokensUsedSoFar,
		              askedStepIds: combinedAskedStepIds,
		              metricProgress: effectiveFormState.metricProgress,
		              metricProgressCountedStepIds: effectiveFormState.metricProgressCountedStepIds,
		              alreadyAskedKeys: combinedAskedStepIds,
		              totalQuestionSteps: effectiveFormState.totalQuestionSteps,
		              answeredQuestionCount: effectiveFormState.answeredQuestionCount,
		              schemaVersion: effectiveFormState.schemaVersion,
		            },
	              instanceContext,
		            answeredQA, // Plain-English "memory" for the model (question + answer pairs)
		            noCache: isFresh,
		            useCase: config?.useCase,
		          }),
		        });
        if (!resp.ok) {
          if (resp.status === 413) {
            throw new Error("Request too large (413). If you uploaded a photo, try a smaller image.");
          }
          throw new Error(`Failed to load next batch: ${resp.status}`);
        }
        if (resp.headers.get("X-Streaming-Disabled") === "1") {
          console.warn("[StepEngine] Streaming disabled for generate-steps response (X-Streaming-Disabled: 1)");
        }

	        const json = await resp.json().catch(() => ({}));
          try {
            const sp = new URLSearchParams(window.location.search);
            const v = (sp.get("debug") || sp.get("ai_form_debug") || sp.get("form_debug") || "").trim().toLowerCase();
            const debugEnabled = v === "1" || v === "true" || v === "yes" || v === "on";
            if (debugEnabled) {
              console.log("[StepEngine] generate-steps response summary", {
                status: resp.status,
                keys: json && typeof json === "object" ? Object.keys(json as any).slice(0, 40) : [],
                readyForImageGen: (json as any)?.readyForImageGen,
                callsUsed: (json as any)?.callsUsed,
                maxCalls: (json as any)?.maxCalls,
                miniStepsCount: Array.isArray((json as any)?.miniSteps) ? (json as any).miniSteps.length : 0,
                framesCount: Array.isArray((json as any)?.frames) ? (json as any).frames.length : 0,
                structuralStepsCount: Array.isArray((json as any)?.structuralSteps)
                  ? (json as any).structuralSteps.length
                  : Array.isArray((json as any)?.structural_steps)
                    ? (json as any).structural_steps.length
                    : 0,
              });
            }
          } catch {}
	        const frames: any[] = Array.isArray((json as any)?.frames) ? (json as any).frames : [];
	        const directMiniSteps: any[] = Array.isArray((json as any)?.miniSteps) ? (json as any).miniSteps : [];
          const directReadyForImageGen: any = (json as any)?.readyForImageGen;
        const directCapabilities: any = (json as any)?.capabilities;
          const directSatiety: any = (json as any)?.satiety;
          const directCallsUsed: any = (json as any)?.callsUsed;
          const directMaxCalls: any = (json as any)?.maxCalls;
          const directDidCall: any = (json as any)?.didCall;
          const responseRequestId = typeof (json as any)?.requestId === "string" ? String((json as any).requestId) : null;
          const responseFormPlan = (json as any)?.formPlan ?? null;

	        const newSteps: any[] = [];
          const directStructuralSteps: any[] = Array.isArray((json as any)?.structuralSteps)
            ? (json as any).structuralSteps
            : Array.isArray((json as any)?.structural_steps)
              ? (json as any).structural_steps
              : [];

	        let didCallDspy = false;
	        let sawComplete = false;
	        let sseError: string | null = null;
	        let backendCallsUsed: number | null = null;
	        let backendMaxCalls: number | null = null;
          let batchReachedPreviewStage = directReadyForImageGen === true;
          if (responseRequestId) {
            const batchId = batchIdFromIndex(effectiveFormState.batchIndex);
            lastBatchMetaRef.current = { batchId, modelRequestId: responseRequestId };
            lastModelRequestIdRef.current = responseRequestId;
          }
          if (responseFormPlan && typeof responseFormPlan === "object" && flowPlan?.sessionId) {
            saveFormPlan(flowPlan.sessionId, responseFormPlan);
            const maxBatches =
              (responseFormPlan as any)?.constraints?.maxBatches ??
              (responseFormPlan as any)?.form?.constraints?.maxBatches ??
              null;
            const n = Number(maxBatches);
            if (Number.isFinite(n)) backendMaxCalls = Math.max(1, Math.floor(n));
          }
	        const directDeterministicCopy =
	          (json && typeof json === "object" && (json as any).deterministicCopy && typeof (json as any).deterministicCopy === "object" && !Array.isArray((json as any).deterministicCopy))
	            ? (json as any).deterministicCopy
	            : null;
	        if (directMiniSteps.length > 0) {
	          newSteps.push(...directMiniSteps);
            didCallDspy = true;
	        }
          if (directStructuralSteps.length > 0) {
            newSteps.push(...directStructuralSteps);
          }
          if (directDeterministicCopy && Object.keys(directDeterministicCopy).length > 0) {
            didCallDspy = true;
            for (const [stepId, copyPatch] of Object.entries(directDeterministicCopy)) {
              if (!stepId || !copyPatch || typeof copyPatch !== "object") continue;
              const patch: Record<string, any> = {};
              if (typeof (copyPatch as any).question === "string") {
                patch.question = (copyPatch as any).question;
              }
              if (stepId === DETERMINISTIC_STYLE_ID) {
                if (typeof (copyPatch as any).min_selections === "number") patch.min_selections = (copyPatch as any).min_selections;
                if (typeof (copyPatch as any).max_selections === "number") patch.max_selections = (copyPatch as any).max_selections;
              }
              if (stepId === DETERMINISTIC_BUDGET_ID) {
                const headline = (copyPatch as any).headline ?? (copyPatch as any).question;
                const subtext = (copyPatch as any).subtext;
                if (typeof headline === "string" || typeof subtext === "string") {
                  patch.copy = {
                    ...((state?.steps || []).find((s: any) => String((s as any)?.id) === stepId) as any)?.copy,
                    ...(typeof headline === "string" ? { headline } : {}),
                    ...(typeof subtext === "string" ? { subtext } : {}),
                  };
                }
              }
              if (Object.keys(patch).length > 0) {
                patchStep(stepId, patch);
              }
            }
          }
          if (typeof directReadyForImageGen === "boolean") {
            updateStepData("__readyForImageGen", directReadyForImageGen);
          }
        if (directCapabilities && typeof directCapabilities === "object" && !Array.isArray(directCapabilities)) {
          updateStepData("__capabilities", directCapabilities);
        } else if (typeof directReadyForImageGen === "boolean" && directReadyForImageGen === true) {
          // Back-compat: only ever enable capabilities from readiness; don't overwrite existing true -> false.
          updateStepData("__capabilities", { image_preview: true });
        }
          if (typeof directSatiety === "number") {
            updateStepData("__satiety", directSatiety);
          }
	          if (typeof directCallsUsed === "number") {
	            backendCallsUsed = directCallsUsed;
	          }
	          if (typeof directMaxCalls === "number") {
	            backendMaxCalls = directMaxCalls;
              backendMaxCallsRef.current = directMaxCalls;
	          }
          if (directDidCall === true) {
            didCallDspy = true;
          }

        for (const obj of frames) {
          if (!obj || typeof obj !== "object") continue;
            if (directMiniSteps.length === 0 && obj.type === "step" && obj.step) {
              // Log to verify options are present when received
              if (obj.step.type === 'multiple_choice' || obj.step.type === 'choice') {
                console.log('[StepEngine] Step received (FULL OBJECT):', {
                  id: obj.step.id,
                  type: obj.step.type,
                  hasOptions: Array.isArray(obj.step.options),
                  optionsCount: Array.isArray(obj.step.options) ? obj.step.options.length : 0,
                  options: obj.step.options ? obj.step.options.slice(0, 3).map((opt: any) => ({ label: opt.label, value: opt.value })) : 'MISSING',
                  allStepKeys: Object.keys(obj.step), // Show all keys to verify nothing is stripped
                });
              }
              // CRITICAL: Push the FULL step object as-is - no transformation
              newSteps.push(obj.step);
            }
            if (obj.type === "meta") {
              const requestPayload =
                obj.payloadRequest ??
                obj.requestPayload ??
                obj.payload?.request ??
                obj.request ??
                null;
              const responsePayload =
                obj.payloadResponse ??
                obj.responsePayload ??
                obj.payload?.response ??
                obj.response ??
                null;
              const responseDspy = (responsePayload as any)?.dspyResponse ?? null;
              const extractDeterministicPlacements = (raw: any) => {
                if (raw && typeof raw === "object" && (raw as any).deterministicPlacements) {
                  return (raw as any).deterministicPlacements;
                }
                return null;
              };

              const maybeUIPlan =
                extractDeterministicPlacements(obj as any) ||
                extractDeterministicPlacements(responsePayload as any) ||
                extractDeterministicPlacements((responsePayload as any)?.meta) ||
                extractDeterministicPlacements((responsePayload as any)?.upstream) ||
                extractDeterministicPlacements(responseDspy as any) ||
                null;
              if (maybeUIPlan && flowPlan?.sessionId) {
                saveUIPlan(flowPlan.sessionId, maybeUIPlan);
              }

              if (devModeEnabled) {
                const requestState = requestPayload && typeof requestPayload === "object" ? (requestPayload as any).state : null;
                const requestDeterministicPlacements = extractDeterministicPlacements(requestState);
                const responseDeterministicPlacements =
                  extractDeterministicPlacements(responsePayload as any) ||
                  extractDeterministicPlacements((responsePayload as any)?.meta) ||
                  extractDeterministicPlacements((responsePayload as any)?.upstream) ||
                  extractDeterministicPlacements(responseDspy as any) ||
                  null;
                console.log("[StepEngine] Plan trace", {
                  request: { deterministicPlacements: requestDeterministicPlacements },
                  response: { deterministicPlacements: responseDeterministicPlacements },
                });
              }

              pendingBatchTraceRef.current = {
                requestPayload,
                responsePayload,
              };
              onMeta?.(obj);
            }
            if (obj.type === "complete") {
              onMeta?.(obj);
              const batchMeta: StepMeta = {
                batchId: obj?.batchId ?? batchIdFromIndex(formState?.batchIndex),
                modelRequestId: obj?.modelRequestId ?? null,
              };
              if (typeof (obj as any).callsUsed === "number") backendCallsUsed = (obj as any).callsUsed;
              if (typeof (obj as any).maxCalls === "number") backendMaxCalls = (obj as any).maxCalls;
              if (batchMeta.batchId || batchMeta.modelRequestId) {
                lastBatchMetaRef.current = batchMeta;
                if (batchMeta.modelRequestId) {
                  lastModelRequestIdRef.current = batchMeta.modelRequestId;
                }
                if (flowPlan?.sessionId) {
                  const now = Date.now();
                  const normalizedBatchId = normalizeBatchId(batchMeta.batchId) ?? undefined;
                  const batchTrace = pendingBatchTraceRef.current;
                  emitTelemetry({
                    sessionId: flowPlan.sessionId,
                    instanceId,
                    eventType: "batch_completed",
                    batchId: normalizedBatchId,
                    modelRequestId: batchMeta.modelRequestId ?? undefined,
                    timestamp: now,
                    payload: {
                      batch_id: normalizedBatchId ?? null,
                      model_request_id: batchMeta.modelRequestId ?? null,
                      calls_used: (obj as any)?.callsUsed ?? null,
                      max_calls: (obj as any)?.maxCalls ?? null,
                      total_steps: (obj as any)?.totalSteps ?? null,
                      answered_steps: (obj as any)?.answeredSteps ?? null,
                      satiety: (obj as any)?.satiety ?? null,
                      is_last_batch: (obj as any)?.isLastBatch ?? null,
                      request_payload: batchTrace?.requestPayload ?? null,
                      response_payload: batchTrace?.responsePayload ?? null,
                      timestamp: now,
                    },
                  });
                }
              }
              if (obj.didCall === true) {
                didCallDspy = true;
              }
              if (typeof obj.readyForImageGen === "boolean") {
                updateStepData("__readyForImageGen", obj.readyForImageGen);
                if (obj.readyForImageGen === true) {
                  batchReachedPreviewStage = true;
                }
                const frameCaps = (obj as any)?.capabilities;
                if (frameCaps && typeof frameCaps === "object" && !Array.isArray(frameCaps)) {
                  updateStepData("__capabilities", frameCaps);
                } else if (obj.readyForImageGen === true) {
                  // Back-compat: only enable (never disable) preview capability from readiness.
                  updateStepData("__capabilities", { image_preview: true });
                }
              }
              if (typeof obj.satiety === "number") {
                updateStepData("__satiety", obj.satiety);
              }

              // When DSPy is "done" it can return structural steps (uploads/designer/lead/pricing/confirmation)
              // in the complete frame. If we don't append them, the user gets stuck on the last question step.
              const structuralFromComplete: any[] = Array.isArray((obj as any)?.structuralSteps)
                ? ((obj as any).structuralSteps as any[])
                : Array.isArray((obj as any)?.structural_steps)
                  ? ((obj as any).structural_steps as any[])
                  : [];
              if (structuralFromComplete.length > 0) {
                newSteps.push(...structuralFromComplete);
              }

              // Log satiety info from backend if available
              if (typeof obj.satiety === 'number') {
                console.log('[StepEngine] Batch complete - satiety from backend:', {
                  satiety: obj.satiety,
                  answeredSteps: obj.answeredSteps,
                  totalSteps: obj.totalSteps,
                  isLastBatch: obj.isLastBatch,
                });
              }
              sawComplete = true;
            }
            // If server reports an error frame, stop parsing; we may still have received fallback steps.
            if (obj.type === "error") {
              console.warn("[StepEngine] generate-steps error", obj);
              const details = obj.details ? ` (${String(obj.details).slice(0, 300)})` : '';
              sseError = `${obj.error || "DSPy service error"}${details}`;
              sawComplete = true;
            }
          if (sawComplete) break;
        }
        if (sseError) {
          setBatchError(sseError);
          return;
        }
        // Guardrail: never allow legacy prompt/designer endcaps from backend/legacy state
        // into the planner question flow.
        for (let i = newSteps.length - 1; i >= 0; i -= 1) {
          const step = newSteps[i];
          const stepId = String((step as any)?.id || "").trim();
          const stepType = String((step as any)?.type || "").trim().toLowerCase();
          if (
            stepId === "step-promptInput" ||
            stepId === "step-designer" ||
            stepType === "prompt_input" ||
            stepType === "designer"
          ) {
            newSteps.splice(i, 1);
          }
        }
        // If backend signals preview stage readiness, do not append any remaining planner
        // question steps from this batch (e.g. "project type"). Refinements take over here.
        if (batchReachedPreviewStage) {
          for (let i = newSteps.length - 1; i >= 0; i -= 1) {
            const step = newSteps[i];
            if (!isStructuralStep(step)) {
              newSteps.splice(i, 1);
            }
          }
        }

        const batchMeta = lastBatchMetaRef.current;
        const batchTrace = pendingBatchTraceRef.current;
        if (batchMeta && newSteps.length > 0) {
          const attachMeta = (steps: any[]) => {
            for (const step of steps) {
              if (!step || typeof step !== "object") continue;
              const stepId = (step as any).id;
              if (!stepId) continue;
              stepMetaRef.current.set(stepId, {
                batchId: batchMeta.batchId ?? null,
                modelRequestId: batchMeta.modelRequestId ?? null,
                payloadRequest: batchTrace?.requestPayload ?? null,
                payloadResponse: batchTrace?.responsePayload ?? null,
              });
            }
          };
          attachMeta(newSteps);
        }
        pendingBatchTraceRef.current = null;

        // Append sanitized steps from backend/model only.
        // CRITICAL: If user was on last step waiting for next steps, auto-advance to the first newly generated step
        if (newSteps.length > 0) {
          setHasReceivedQuestionsFromGenerateSteps(true);
          if (initialQuestionCountSnapshot === null && requestedBatchIndex === 0) {
            const totalAfterInitialBatch = countPreviewGateQuestions([...(state?.steps || []), ...newSteps]);
            if (totalAfterInitialBatch > 0) {
              setInitialQuestionCountSnapshot(totalAfterInitialBatch);
            }
          }

          // Use the wasOnLastStep parameter passed from handleStepComplete
          // Only auto-advance if user was waiting (showLoading=true means they saw the loader)
          const shouldAutoAdvance = wasOnLastStep && showLoading;
          
          console.log('[StepEngine] 📝 Adding new question steps', {
            count: newSteps.length,
            stepIds: newSteps.map(s => s.id),
            currentTotalSteps: state?.steps.length || 0,
            currentStepIndex: state?.currentStepIndex,
            wasOnLastStep,
            showLoading,
            shouldAutoAdvance,
            behavior: shouldAutoAdvance 
              ? 'Auto-advancing to Q1 of next batch (user was waiting)' 
              : 'Silent append - user continues normally',
          });
          
          // Auto-advance if user was on last step waiting, otherwise append silently
          addSteps(newSteps, shouldAutoAdvance);
        }

	        if ((didCallDspy || typeof backendCallsUsed === "number" || typeof backendMaxCalls === "number") && flowPlan?.sessionId) {
	          const baseState = formState ?? effectiveFormState;
	          const effectiveMaxCalls =
	            (typeof backendMaxCalls === "number" ? backendMaxCalls : null) ??
	            (typeof backendMaxCallsRef.current === "number" ? backendMaxCallsRef.current : null);
	          const maxBatchIndex = typeof effectiveMaxCalls === "number" ? Math.max(0, effectiveMaxCalls - 1) : null;
	          // Backend reports `callsUsed` as 1-based; the next `batchIndex` is `callsUsed` (0-based).
	          const computedNextBatchIndex =
	            typeof backendCallsUsed === "number"
	              ? Math.max(0, Math.floor(backendCallsUsed))
	              : didCallDspy
	                ? baseState.batchIndex + 1
	                : baseState.batchIndex;
	          const nextBatchIndex =
	            typeof maxBatchIndex === "number" ? Math.min(computedNextBatchIndex, maxBatchIndex) : computedNextBatchIndex;
	          // Keep maxBatches purely informational (do not default); do not rely on it client-side.
	          const nextState: FormState = {
	            ...baseState,
	            ...(typeof effectiveMaxCalls === "number" ? { maxBatches: effectiveMaxCalls } : {}),
	            batchIndex: nextBatchIndex,
	          };
	          setFormState(nextState);
	          saveFormState(flowPlan.sessionId, nextState);
	        }
        if (typeof requestedBatchIndex === "number") {
          completedBatchIndexesRef.current.add(requestedBatchIndex);
        }
      } finally {
        setIsBatchLoading(false);
        batchingRef.current = false;
        sceneUploadJustCompletedRef.current = false;
        if (typeof requestedBatchIndex === "number") {
          inFlightBatchIndexesRef.current.delete(requestedBatchIndex);
        }
      }
    },
    [addSteps, patchStep, flowPlan, formState, initialQuestionCountSnapshot, instanceId, state?.steps, state?.stepData, updateStepData, config?.useCase, onMeta]
  );

  const requestNextBatch = useCallback(
    (
      stepDataSoFar: Record<string, any>,
      opts: { showLoading: boolean; wasOnLastStep: boolean; reason: string; onError?: (e: unknown) => void }
    ) => {
      if (leadGateLocksQuestionAreaRef.current) {
        console.log(`[StepEngine] Lead gate active; skipping generate-steps request (${opts.reason})`);
        return;
      }
      fetchAndAppendBatch(stepDataSoFar, opts.showLoading, opts.wasOnLastStep).catch((e) => {
        console.warn(`[StepEngine] generate-steps fetch failed (${opts.reason})`, e);
        opts.onError?.(e);
      });
    },
    [fetchAndAppendBatch]
  );

  useEffect(() => {
    if (!state || !selectedServiceId) return;
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

    if (!existingStyleStep) {
      const serviceIndex = (state.steps || []).findIndex((step: any) => String((step as any)?.id || "") === DETERMINISTIC_SERVICE_ID);
      addSteps([deterministicStyleStep as any], false, {
        insertAtIndex: serviceIndex >= 0 ? serviceIndex + 1 : 1,
        moveExisting: true,
      });
      return;
    }

    const existingSignature = JSON.stringify({
      question: existingStyleStep?.question ?? null,
      options: Array.isArray(existingStyleStep?.options) ? existingStyleStep.options : [],
    });
    const nextSignature = JSON.stringify({
      question: (deterministicStyleStep as any).question ?? null,
      options: Array.isArray((deterministicStyleStep as any)?.options) ? (deterministicStyleStep as any).options : [],
    });
    if (existingSignature !== nextSignature || existingStyleStep?.type !== "image_choice_grid") {
      patchStep(DETERMINISTIC_STYLE_ID, {
        type: "image_choice_grid",
        question: (deterministicStyleStep as any).question,
        options: (deterministicStyleStep as any).options,
        multi_select: true,
        min_selections: 3,
        max_selections: 5,
      } as any);
    }

    if (serviceChanged) {
      removeContextEntry(DETERMINISTIC_STYLE_ID);
    }
  }, [addSteps, deterministicStyleStep, patchStep, removeContextEntry, selectedServiceId, state]);

  // If the user refreshes after completing deterministic steps, there may be no AI steps yet.
  // In that case, automatically fetch the first batch once we have the deterministic answers.
  useEffect(() => {
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
  }, [state, flowPlan?.sessionId, formState, requestNextBatch]);

  const handleStepComplete = async (data: any) => {
    if (!currentStep) return;
    const isRefinementSceneUploadStep = currentStep.id === "step-refinement-upload-scene-image";
    const isSceneUploadStep =
      currentStep.id === DETERMINISTIC_SCENE_IMAGE_ID || currentStep.id === REFINEMENT_UPLOAD_STEP_ID;
    const isRefinementQuestionStep = Boolean((currentStep as any)?.__refinementStep);
    const wasRefinementQuestionAlreadyAnswered =
      isRefinementQuestionStep && isStepAnsweredForCounts(currentStep, state?.stepData);
    const nextAnsweredRefinementQuestionCount =
      answeredRefinementQuestionCount +
      (isRefinementQuestionStep && hasMeaningfulAnswer(data) && !wasRefinementQuestionAlreadyAnswered ? 1 : 0);
    const isSceneUploadSkipped =
      isSceneUploadStep &&
      (data === null || data === undefined || data === "__skip__" || data === "" || (Array.isArray(data) && data.length === 0));
    if (isSceneUploadSkipped) {
      setPendingPreviewSceneUploadUrl(null);
    }
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
    const persistStepAnswer = () => {
      updateStepData(currentStep.id, data);
      if (shouldMirrorRefinementSceneUpload) {
        updateStepData(DETERMINISTIC_SCENE_IMAGE_ID, data);
      }
    };

    if (uploadedSceneImageUrl && previewHasImage) {
      setPendingPreviewSceneUploadUrl(uploadedSceneImageUrl);
      setPreviewRefreshNonce((prev) => prev + 1);
    }
    if (shouldPauseForRefinementPreviewRefresh) {
      setPreviewAutoGenerationPending(true);
      setPreviewRefreshNonce((prev) => prev + 1);
    }
    
    console.log('[StepEngine] Step completed', {
      stepId: currentStep.id,
      stepType: 'type' in currentStep ? currentStep.type : 'componentType' in currentStep ? currentStep.componentType : 'unknown',
      currentStepIndex: state?.currentStepIndex,
      totalSteps: state?.steps.length,
      stepData: data,
      allStepDataKeys: Object.keys(state?.stepData || {}),
    });

    const stepTypeForMetrics = getStepType(currentStep);
    const gateContextForMetrics = normalizeOptionalString((currentStep as any)?.blueprint?.validation?.gate_context);
    const isLeadStepForMetrics = stepTypeForMetrics === "lead_capture" || currentStep.id.startsWith("step-lead");

    if (sessionId) {
      const stepId = currentStep.id;
      const meta = stepMetaRef.current.get(stepId);
      const start = stepStartRef.current[stepId];
      const now = Date.now();
      const latencyMs = typeof start === "number" ? now - start : null;
      const stepType = stepTypeForMetrics;
      if (meta?.modelRequestId) {
        lastModelRequestIdRef.current = meta.modelRequestId;
      }
      // Determine step source and characteristics
      const isDeterministic =
        isStructuralStep(currentStep) ||
        isBootstrapStepIdValue(stepId);
      const stepSource = isDeterministic ? 'frontend_deterministic' : (meta?.modelRequestId ? 'backend_ai' : 'unknown');
      const totalSteps = state?.steps?.length || 0;
      const stepNumber = (state?.currentStepIndex ?? 0) + 1;
      const requestPayload = meta?.payloadRequest ?? null;
      const responsePayload = meta?.payloadResponse ?? null;
      const gateContext = gateContextForMetrics;
      const isLeadStep = isLeadStepForMetrics;
      
      // Only emit step_answered once per step completion with full step data
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
          step_type: stepType,
          is_deterministic: isDeterministic,
          source: stepSource,
          latency_ms: latencyMs,
          value_type: getValueType(data),
          filled_other: detectFilledOther(data),
          step_json: currentStep, // Full step object
          answer_value: data, // The actual answer value
          has_options: Array.isArray((currentStep as any)?.options),
          options_count: Array.isArray((currentStep as any)?.options) ? (currentStep as any).options.length : 0,
          question: (currentStep as any)?.question || null,
          request_payload: requestPayload,
          response_payload: responsePayload,
          gate_context: gateContext,
        },
      });

      if (isLeadStep) {
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
            step_type: stepType,
            is_deterministic: isDeterministic,
            source: stepSource,
            step_json: currentStep, // Full step object
            conversion_type: "lead_submitted",
            gate_context: gateContext,
          },
        });
      }
    }
    
    trackStepComplete(currentStep.id, {
      droppedOff: false,
      backNavigation: false,
      leadInputCompleted: isLeadStepForMetrics,
      componentType: ('componentType' in currentStep ? currentStep.componentType : 'unknown') as any,
      metadata: gateContextForMetrics ? { gate_context: gateContextForMetrics } : undefined,
    });

    if (onStepComplete) {
      onStepComplete(currentStep.id, data);
    }

    // PREVIEW GATE: once the preview has produced a real image, block further question advancement
    // until the lead is captured. We still persist the answer, then show the unlock UI.
    const shouldGatePreviewAdvance =
      leadGateLocksQuestionAreaRef.current && isPreviewGateQuestionStep(currentStep) && !isLeadStepForMetrics;
    if (shouldGatePreviewAdvance) {
      pendingPreviewAdvanceRef.current = { stepId: currentStep.id, data };
      persistStepAnswer();
      setPreviewAdvanceGateOpen(true);
      return;
    }

    // If user is on the last currently-known step, trigger JIT batching to fetch more.
    // `generate-steps` expects stepDataSoFar + existingStepIds to generate the next question batch.
    const isLastKnownStep = Boolean(state && state.currentStepIndex >= (state.steps.length - 1));
    const updatedStepDataSoFar: Record<string, any> = {
      ...(state?.stepData || {}),
      [currentStep.id]: data,
      ...(shouldMirrorRefinementSceneUpload ? { [DETERMINISTIC_SCENE_IMAGE_ID]: data } : {}),
    };
    const nextSelectedServiceId =
      currentStep.id === DETERMINISTIC_SERVICE_ID && typeof data === "string" && data.trim()
        ? data.trim()
        : selectedServiceId;
    const nextSelectedServiceMeta =
      nextSelectedServiceId && serviceCatalogSnapshot?.byServiceId
        ? (serviceCatalogSnapshot.byServiceId as any)[nextSelectedServiceId]
        : null;
    const nextDeterministicStyleStep = buildDeterministicStyleStep(nextSelectedServiceMeta);
    const shouldRouteToDeterministicStyleStep =
      currentStep.id === DETERMINISTIC_SERVICE_ID &&
      Boolean(nextDeterministicStyleStep) &&
      !hasMeaningfulAnswer(updatedStepDataSoFar[DETERMINISTIC_STYLE_ID]);

    // Persist personalization + lead-gate state into session-scoped FormState.
    if (flowPlan?.sessionId && formState) {
      const now = Date.now();

      if (currentStep.id === DETERMINISTIC_FULL_NAME_ID) {
        const fullName = normalizeOptionalString(data);
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
        const email = normalizeOptionalString((data as any)?.email);
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

    // Persist monotonic flow progress to FormState (so it doesn't jump to 100% after Q1
    // and get stuck there when we append more questions later).
    if (flowPlan?.sessionId && formState && isQuestionStepForAskedIds(currentStep) && hasMeaningfulAnswer(data)) {
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

    // Back-compat: also store an underscore alias for planner triggers (e.g. bathroom_type).
    // Only do this for question steps (not structural/functionCall).
    if (isQuestionStepForAskedIds(currentStep)) {
      const alias = legacyAliasKeyForStepId(currentStep.id);
      if (alias && alias !== currentStep.id && (state?.stepData || {})[alias] === undefined) {
        updateStepData(alias, data);
      }
    }

    if (leadGateLocksQuestionAreaRef.current && !isLeadStepForMetrics) {
      // Keep answers/state, but never continue loading or advancing question flow until lead capture.
      persistStepAnswer();
      return;
    }

    if (shouldPauseForRefinementPreviewRefresh) {
      persistStepAnswer();
      pendingRefinementPreviewAdvanceRef.current = { stepId: currentStep.id, data };
      pendingRefinementPreviewAdvanceStageRef.current = "waiting_for_start";
      return;
    }

    if (shouldRouteToDeterministicStyleStep) {
      const existingStyleIndex = (state?.steps || []).findIndex((step: any) => String((step as any)?.id || "") === DETERMINISTIC_STYLE_ID);
      persistStepAnswer();
      markStepComplete(currentStep.id);
      if (existingStyleIndex >= 0) {
        goToStep(existingStyleIndex);
        return;
      }
      if (nextDeterministicStyleStep) {
        addSteps([nextDeterministicStyleStep as any], true, {
          insertAtIndex: (state?.currentStepIndex ?? 0) + 1,
          moveExisting: true,
        });
        // Fetch AI-generated style copy; when response arrives, patchStep will apply it
        requestNextBatch(updatedStepDataSoFar, {
          showLoading: false,
          wasOnLastStep: false,
          reason: "style-copy",
        });
        return;
      }
    }
    
    // Optional lookahead: allow fetching the next batch *after an input* a few steps before the end.
    // Default is `0` (disabled) so `/generate-steps` only happens when the user finishes the last step.
    const prefetchStepsBeforeEndRaw = Number((config as any)?.prefetchStepsBeforeEnd ?? 0);
    const prefetchStepsBeforeEnd = Number.isFinite(prefetchStepsBeforeEndRaw)
      ? Math.max(0, Math.floor(prefetchStepsBeforeEndRaw))
      : 0;

    const currentStepIndex = state?.currentStepIndex ?? -1;
    const totalStepsCount = state?.steps?.length ?? 0;
    const stepsRemaining = Math.max(0, totalStepsCount - 1 - currentStepIndex);
    const hasDeterministicAnswers = deterministicAnswersPresent({ steps: state?.steps, stepData: state?.stepData });
    
    // SIMPLE LOGIC (works for any batch n → batch n+1, up to call cap):
    // 1. If on last step AND batch is loading → show loader, wait, then auto-advance to the first newly generated step
    // 2. If on last step AND batch NOT loading → trigger next batch fetch with loader, wait, then auto-advance
    // 3. If prefetch trigger hit → fetch silently in background, continue normally
    // 4. Otherwise → continue normally (advance to next step)
    
    const isOnLastStep = isLastKnownStep;
    const batchCurrentlyLoading = batchingRef.current;
    const shouldPrefetchNextBatch =
      prefetchStepsBeforeEnd > 0 &&
      hasDeterministicAnswers &&
      !isOnLastStep &&
      !batchCurrentlyLoading &&
      stepsRemaining <= prefetchStepsBeforeEnd;
    
    console.log('[StepEngine] Step complete logic check', {
      isOnLastStep,
      batchCurrentlyLoading,
      shouldPrefetchNextBatch,
      currentStepIndex,
      totalSteps: totalStepsCount,
      stepsRemaining,
      prefetchStepsBeforeEnd,
      willAdvance: !isOnLastStep || !batchCurrentlyLoading,
    });
    
    if (isOnLastStep) {
      // Mark current step complete so upload skip = same as upload: preview can generate immediately.
      markStepComplete(currentStep.id);

      // If completing a scene upload step, prefer the preview "generating" loader over "Getting you accurate pricing..." to avoid overlapping loaders
      const hasValidSceneData =
        isSceneUploadStep &&
        !isSceneUploadSkipped &&
        (typeof data === "string" ? data.startsWith("http") || data.startsWith("data:image") : Array.isArray(data) && data.some((v) => typeof v === "string" && (v.startsWith("http") || v.startsWith("data:image"))));
      if (hasValidSceneData) {
        sceneUploadJustCompletedRef.current = true;
      }

      // User is on last step - need next batch (batch n+1, up to call cap)
      if (batchCurrentlyLoading) {
        // Next batch is already loading - just show loader, wait for it to arrive
        // When batch arrives, auto-advance will happen in addSteps
        console.log('[StepEngine] ⏳ On last step, next batch already loading - showing loader, will auto-advance when ready');
        persistStepAnswer();
        // Don't advance yet - wait for batch to arrive
        return;
      } else {
        // On last step, next batch not loading yet - trigger fetch with loader
        console.log('[StepEngine] 🚀 On last step - triggering next batch fetch with loader', {
          stepDataSoFarKeys: Object.keys(updatedStepDataSoFar),
          answeredSteps: Object.keys(updatedStepDataSoFar).length,
          currentStepIndex,
          totalStepsCount,
        });
        
        persistStepAnswer();
        
        // Fetch with loading indicator - when batch arrives, auto-advance will happen
        requestNextBatch(updatedStepDataSoFar, {
          showLoading: true,
          wasOnLastStep: true,
          reason: "last-step",
        });
        
        // Don't advance yet - wait for batch to arrive, then auto-advance
        return;
      }
    } else if (shouldPrefetchNextBatch && !batchingRef.current) {
      // Prefetch trigger hit - fetch silently in background, continue normally
      console.log('[StepEngine] 🎯 Prefetch trigger - fetching next batch silently in background', {
        stepDataSoFarKeys: Object.keys(updatedStepDataSoFar),
        currentStepIndex,
        stepsRemaining,
        prefetchStepsBeforeEnd,
      });
      
      persistStepAnswer();
      
      // Fetch silently (no loading indicator)
      requestNextBatch(updatedStepDataSoFar, {
        showLoading: false,
        wasOnLastStep: false,
        reason: "prefetch",
      });
      
      // Continue normally - advance to next step
      await goToNextStep(data);
    } else {
      // Normal flow - not on last step, not prefetch trigger - just advance
      console.log('[StepEngine] ✅ Normal flow - advancing to next step');
      await goToNextStep(data);
    }
  };

  // Track dropoff to prevent duplicates across effect re-runs
  const dropoffFiredRef = useRef<Set<string>>(new Set());
  const pageLoadTimeRef = useRef<number>(Date.now());
  const isInitialMountRef = useRef<boolean>(true);
  
  // Reset page load time on mount to prevent false dropoffs during hot reload
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
    
    // Skip if already fired for this session+step combo
    if (dropoffFiredRef.current.has(dropoffKey)) return;
    
    const handleDropoff = (e: Event) => {
      // Don't fire if form is completed
      if (flowCompletedRef.current) return;

      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const isFresh = params.get("fresh") === "1" || params.get("fresh") === "true";
        if (isFresh) {
          return;
        }
      }
      
      // Don't fire within 10 seconds of page load (prevents false dropoffs on initial load/hot reload)
      const timeSinceLoad = Date.now() - pageLoadTimeRef.current;
      if (timeSinceLoad < 10000) {
        return; // Too soon after page load - likely not a real dropoff
      }
      
      // Don't fire on refresh or back/forward cache
      if (e.type === 'pagehide' && (e as PageTransitionEvent).persisted) {
        return; // This is a back/forward cache, not a real navigation
      }
      
      // Don't fire during development hot reloads (check for HMR)
      if (process.env.NODE_ENV === 'development' && e.type === 'beforeunload') {
        // In dev, beforeunload can fire during hot reload - be more conservative
        if (timeSinceLoad < 30000) { // 30 seconds in dev
          return;
        }
      }
      
      // Check if already fired for this step
      if (dropoffFiredRef.current.has(dropoffKey)) return;
      dropoffFiredRef.current.add(dropoffKey);
      
      const meta = stepMetaRef.current.get(stepId);
      const isDeterministic =
        isStructuralStep(currentStep) ||
        isBootstrapStepIdValue(stepId);
      const stepSource = isDeterministic ? 'frontend_deterministic' : (meta?.modelRequestId ? 'backend_ai' : 'unknown');
      const totalSteps = state?.steps?.length || 0;
      const stepNumber = (state?.currentStepIndex ?? 0) + 1;
      
        emitTelemetry(
          {
            sessionId,
            instanceId,
            eventType: "dropoff",
            stepId,
            batchId: normalizeBatchId(meta?.batchId) ?? batchIdFromIndex(formState?.batchIndex) ?? undefined,
            modelRequestId: meta?.modelRequestId ?? undefined,
            timestamp: Date.now(),
            payload: {
              step_number: stepNumber,
              total_steps: totalSteps,
              step_type: getStepType(currentStep),
              is_deterministic: isDeterministic,
              source: stepSource,
              step_json: currentStep, // Full step object
              has_options: Array.isArray((currentStep as any)?.options),
              options_count: Array.isArray((currentStep as any)?.options) ? (currentStep as any).options.length : 0,
              question: (currentStep as any)?.question || null,
              order: stepNumber, // Keep for backward compatibility
              request_payload: meta?.payloadRequest ?? null,
              response_payload: meta?.payloadResponse ?? null,
            },
          },
          { beacon: true }
        );
    };

    // Dropoff should only fire when user actually exits/closes the form, not just when tab becomes hidden
    // Use beforeunload/pagehide for actual navigation away, not visibilitychange
    // Session stays active as long as the tab is open, even if hidden
    
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // User is actually leaving/closing the page
      if (!flowCompletedRef.current) {
        handleDropoff(e);
      }
    };

    const handlePageHide = (e: PageTransitionEvent) => {
      // Only fire if it's a real navigation away (not back/forward cache)
      if (!e.persisted && !flowCompletedRef.current) {
        handleDropoff(e);
      }
    };

    // Use beforeunload for most browsers, pagehide as fallback
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [currentStep, formState?.batchIndex, instanceId, sessionId, state?.currentStepIndex]);

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
        const isDeterministic =
          isStructuralStep(toStep) ||
          isBootstrapStepIdValue(toStepId);
        const stepSource = isDeterministic ? 'frontend_deterministic' : (meta?.modelRequestId ? 'backend_ai' : 'unknown');
        const totalSteps = state?.steps?.length || 0;
        const requestPayload = meta?.payloadRequest ?? null;
        const responsePayload = meta?.payloadResponse ?? null;
        
        emitTelemetry({
          sessionId,
          instanceId,
          eventType: "step_backtracked",
        stepId: toStepId,
        batchId: normalizeBatchId(meta?.batchId) ?? batchIdFromIndex(formState?.batchIndex) ?? undefined,
        modelRequestId: meta?.modelRequestId ?? undefined,
        timestamp: Date.now(),
          payload: {
            step_number: toIndex + 1,
            total_steps: totalSteps,
            step_type: getStepType(toStep),
            is_deterministic: isDeterministic,
            source: stepSource,
            step_json: toStep, // Full step object
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
  }, [currentStep, formState?.batchIndex, goToPreviousStep, instanceId, sessionId, setAdventureInputMode, state]);

  const handleNavigateToStep = useCallback(
    (stepIndex: number) => {
      if (!state) return;
      if (sessionId && stepIndex < state.currentStepIndex) {
        const fromStep = state.steps[state.currentStepIndex];
        const toStep = state.steps[stepIndex];
        if (fromStep && toStep) {
          const toStepId = (toStep as any).id;
          const meta = stepMetaRef.current.get(toStepId);
          const isDeterministic =
            isStructuralStep(toStep) ||
            isBootstrapStepIdValue(toStepId);
          const stepSource = isDeterministic ? 'frontend_deterministic' : (meta?.modelRequestId ? 'backend_ai' : 'unknown');
          const totalSteps = state?.steps?.length || 0;
          
          emitTelemetry({
            sessionId,
            instanceId,
            eventType: "step_backtracked",
            stepId: toStepId,
            batchId: normalizeBatchId(meta?.batchId) ?? batchIdFromIndex(formState?.batchIndex) ?? undefined,
            modelRequestId: meta?.modelRequestId ?? undefined,
            timestamp: Date.now(),
            payload: {
              step_number: stepIndex + 1,
              total_steps: totalSteps,
              step_type: getStepType(toStep),
              is_deterministic: isDeterministic,
              source: stepSource,
              step_json: toStep, // Full step object
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
    [formState?.batchIndex, goToStep, instanceId, sessionId, state]
  );

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

  const isBootstrapStepId = useCallback((stepId: string | null | undefined) => {
    return isBootstrapStepIdValue(stepId);
  }, []);

  // If the user resumes a session where steps are already present (e.g. from localStorage),
  // make sure the preview system is allowed to activate without requiring a fresh generate-steps request.
  useEffect(() => {
    if (hasReceivedQuestionsFromGenerateSteps) return;
    if (!state?.steps || state.steps.length === 0) return;
    const hasAnyNonBootstrapQuestion = state.steps.some((s) => {
      const id = String((s as any)?.id || "");
      if (!id) return false;
      if (isBootstrapStepId(id)) return false;
      return isQuestionStepForAskedIds(s);
    });
    if (hasAnyNonBootstrapQuestion) setHasReceivedQuestionsFromGenerateSteps(true);
  }, [hasReceivedQuestionsFromGenerateSteps, isBootstrapStepId, state?.steps]);

  // Show ease feedback after the first preview image exists (hero generated),
  // while still respecting lead capture and one-time submission.
  const showEasePrompt =
    effectiveLeadCompleteForPreviewFlow &&
    previewHasImage &&
    !flowCompleted &&
    !easeFeedbackSent;

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
    desiredDeterministicUploadSteps,
    desiredDeterministicStepsForInsert: [deterministicBudgetStep, ...desiredDeterministicUploadSteps],
    flowPlanSessionId: flowPlan?.sessionId,
    formStateMetricProgress: formState?.metricProgress ?? null,
    hasReceivedQuestionsFromGenerateSteps,
    initialQuestionCountSnapshot,
    isBootstrapStepId,
    previewEverEnabled,
    progressPercentage: progress?.percentage ?? null,
    setPreviewEverEnabled,
    suppressDeterministicStepInsert: Boolean(effectiveLeadCompleteForPreviewFlow && previewHasImage),
    state,
    updateStepData,
  });

  const isBacktrackingInForm = Boolean(state && (state.currentStepIndex ?? 0) < maxVisitedIndex);

  // Gate question pane + bottom bar until lead capture is completed (skipped when lead_capture_enabled is false).
  const leadGateLocksQuestionArea = Boolean(
    previewEnabled && previewHasImage && !isBacktrackingInForm && !effectiveLeadCompleteForPreviewFlow
  );
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
  const desktopQuestionMinHeight = "clamp(300px, 36dvh, 520px)";
  const previewSectionBasis = "47%";
  const questionSectionBasis = "53%";
  const mobilePreviewSectionBasis = "70%";
  const mobileQuestionSectionBasis = "30%";
  useEffect(() => {
    if (!showPreviewSection) setPreviewVisible(false);
    else if (showPreviewGeneratingEarly) setPreviewVisible(true);
  }, [showPreviewSection, showPreviewGeneratingEarly]);

  const isPreviewGenerationStage = Boolean(previewEnabled && !previewHasImage);
  const showAccuratePricingLoader =
    !showPreviewSection &&
    (!effectiveCurrentStep || isWaitingForNextBatch) &&
    !isPreviewGenerationStage &&
    !showPreviewGeneratingEarly;

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
    // When moving forward: hide on the captured step to prevent stale content flash.
    // When backtracking: always show—user explicitly navigated back to see the question.
    // When lead captured: always show—unlock to reveal the next guided question.
    if (!currentId || (currentId === capturedId && !isBacktrackingInForm && !effectiveLeadCompleteForPreviewFlow)) {
      setPreviewQuestionRevealReady(false);
      return;
    }
    setPreviewQuestionRevealReady(true);
  }, [currentStep?.id, previewEnabled, previewHasImage, isBacktrackingInForm, effectiveLeadCompleteForPreviewFlow]);
  const previewLayoutActive = Boolean(
    (usePreviewDominantLayout || useDesktopPreviewLayout) &&
      (previewHasImage || previewVisible || !previewQuestionRevealReady)
  );
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
  // Keep the question pane hidden while waiting for lead capture; skipped when lead capture is disabled in config.
  const shouldHideQuestionPaneForLeadGate = Boolean(
    previewEnabled && previewHasImage && !isBacktrackingInForm && !effectiveLeadCompleteForPreviewFlow
  );
  const showQuestionPaneUnderPreview =
    !isPreviewGenerationStage &&
    previewQuestionRevealReady &&
    !shouldHideQuestionPaneForLeadGate &&
    (!useMobilePreviewLayout || previewHasImage || isBacktrackingInForm);
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
    leadGateLocksQuestionArea ||
    !showQuestionPaneUnderPreview ||
    isAdvancingAfterLeadCapture
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
      showQuestionPane: Boolean(showQuestionPaneUnderPreview && !leadGateLocksQuestionArea),
      showEaseFeedback: Boolean(showEasePrompt),
      showReflectionFeedback: Boolean(flowCompleted && !reflectionFeedbackSent),
    }));
  }, [
    flowCompleted,
    isDesktopViewport,
    isMobileViewport,
    effectiveLeadCompleteForPreviewFlow,
    leadGateLocksQuestionArea,
    previewEnabled,
    previewHasImage,
    previewVisible,
    isPreviewGenerationStage,
    reflectionFeedbackSent,
    setFacts,
    showBrandingHeader,
    showEasePrompt,
    showProgressBar,
    showQuestionPaneUnderPreview,
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

  if (isInitialLoading && !engineError && !batchError) {
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
  const guidedThumbnailMode = Boolean(previewLayoutActive && showQuestionPaneUnderPreview);
  const compactQuestionHost = Boolean(previewLayoutActive && showQuestionPaneUnderPreview && previewHasImage);
  const compactStepType = String((stepForRenderer as any)?.type || (stepForRenderer as any)?.componentType || "").toLowerCase();
  const compactLargeQuestionHost = compactStepType === "image_choice_grid";
  const isRefinementUploadStep = String((stepForRenderer as any)?.id) === REFINEMENT_UPLOAD_STEP_ID;
  const hasPreviewSubsections = showEasePrompt;
  const parseBatchOrder = (batchId: string | null | undefined): number | null => {
    if (!batchId) return null;
    const normalized = normalizeBatchId(batchId);
    if (!normalized) return null;
    const match = normalized.match(/^batch-(\d+)$/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
  };
  const stepJoggerRevealBatchOrder = (() => {
    if (!state?.steps?.length) return null;
    const revealThroughIndex = Math.max(state.currentStepIndex ?? 0, maxVisitedIndex ?? 0);
    let maxOrder: number | null = null;
    for (let i = 0; i <= revealThroughIndex && i < state.steps.length; i += 1) {
      const stepId = String((state.steps[i] as any)?.id || "");
      if (!stepId) continue;
      const meta = stepMetaRef.current.get(stepId);
      const order = parseBatchOrder(meta?.batchId);
      if (order === null) continue;
      maxOrder = maxOrder === null ? order : Math.max(maxOrder, order);
    }
    return maxOrder;
  })();
  const stepJoggerSteps = (() => {
    if (!state?.steps?.length) return [];
    const indexed = state.steps.map((step, index) => ({ step, index }));
    const withoutRefinementUpload = indexed.filter(({ step }) => String((step as any)?.id || "") !== REFINEMENT_UPLOAD_STEP_ID);
    // After lead modal is completed, budget/upload are hidden visually — hide from jogger only then.
    const withoutBudgetUploadWhenLeadCaptured =
      effectiveLeadCompleteForPreviewFlow && previewHasImage
        ? withoutRefinementUpload.filter(({ step }) => !belowPreviewControlStepIds.has(String((step as any)?.id || "")))
        : withoutRefinementUpload;
    if (effectiveLeadCompleteForPreviewFlow && previewHasImage) return withoutBudgetUploadWhenLeadCaptured;
    // Before lead capture: only show batch-1 and earlier. Hide batch-2+ until lead form is filled.
    const effectiveRevealBatchOrder = Math.min(stepJoggerRevealBatchOrder ?? 1, 1);
    return withoutBudgetUploadWhenLeadCaptured.filter(({ step }) => {
      const stepId = String((step as any)?.id || "");
      if (!stepId) return true;
      const meta = stepMetaRef.current.get(stepId);
      const order = parseBatchOrder(meta?.batchId);
      if (order === null || effectiveRevealBatchOrder === null) return true;
      return order <= effectiveRevealBatchOrder;
    });
  })();
  const stepJoggerVisible = Boolean(showStepDescriptions && stepJoggerSteps.length > 1);
  const headerVisible = Boolean(showProgressBar || stepJoggerVisible);
  const getStepJoggerLabel = (step: any, index: number): string => {
    const stepId = String(step?.id || "");
    if (stepId.startsWith("step-service-primary")) return "Service";
    if (stepId === DETERMINISTIC_STYLE_ID) return "Style";
    if (stepId.includes("budget")) return "Budget";
    if (stepId.includes("upload-scene")) return "Upload Photo";
    if (stepId.includes("upload-user")) return "Person Photo";
    if (stepId.includes("upload-product")) return "Product Photo";
    if (stepId.includes("lead") || stepId.includes("email") || stepId.includes("phone") || stepId.includes("full-name")) return "Contact";
    if ((step as any)?.functionCall?.name) {
      const fn = String((step as any).functionCall.name).replace(/[_-]+/g, " ").trim();
      return fn ? fn.replace(/\b\w/g, (c) => c.toUpperCase()) : `Step ${index + 1}`;
    }

    const raw = String(step?.copy?.headline || step?.question || step?.content?.prompt || "").trim();
    if (!raw) return `Step ${index + 1}`;

    const firstClause = raw.split(/[?.!]/)[0]?.trim() || raw;
    const cleaned = firstClause
      .replace(/^(what|which|how|where|when|tell us|let us|please)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const words = cleaned.split(" ").filter(Boolean);
    return (words.slice(0, 4).join(" ") || `Step ${index + 1}`).replace(/\b\w/g, (c) => c.toUpperCase());
  };
  return (
	  <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-transparent text-foreground" style={{ color: theme.textColor }}>
	      {/* Header always owns its height budget so the body starts below it. */}
	      <div
          className={cn(
            "z-50 shrink-0 backdrop-blur"
          )}
          style={{ backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.85))" }}
        >
        {/* Progress Bar */}
        {showProgressBar ? (
          <div className="px-4 pt-2 pb-1">
            {/* Progress fill only (no grey track) */}
            <div className="h-1.5">
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{
                  width: `${
                    typeof formState?.metricProgress === "number" && Number.isFinite(formState.metricProgress)
                      ? Math.round(Math.max(0, Math.min(1, formState.metricProgress)) * 100)
                      : progress.percentage
                  }%`,
                }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                style={{ backgroundColor: theme.primaryColor || "var(--form-primary-color, #3b82f6)" }}
              />
            </div>
          </div>
        ) : null}
        {stepJoggerVisible ? (
          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1">
              {stepJoggerSteps.map(({ step, index }) => {
                const isCurrent = index === (state?.currentStepIndex || 0);
                const canNavigate = index <= maxVisitedIndex && !isCurrent;
                const label = getStepJoggerLabel(step, index);
                return (
                  <button
                    key={String(step?.id || `step-${index}`)}
                    type="button"
                    disabled={!canNavigate}
                    onClick={() => {
                      if (!canNavigate) return;
                      setAdventureInputMode("questions");
                      handleNavigateToStep(index);
                    }}
                    title={label}
                    className={cn(
                      "inline-flex max-w-[260px] items-center gap-2 rounded-full px-3 py-1.5 text-xs shadow-sm transition-colors",
                      isCurrent ? "font-semibold" : "font-medium",
                      canNavigate ? "cursor-pointer hover:bg-primary/10" : "cursor-default opacity-70"
                    )}
                    style={{
                      backgroundColor: isCurrent ? (theme.primaryColor || "#3b82f6") : "transparent",
                      color: isCurrent ? "#fff" : theme.textColor,
                      fontFamily: theme.fontFamily,
                    }}
                  >
                    <span
                      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                      style={{
                        backgroundColor: isCurrent ? "rgba(255,255,255,0.25)" : (hexToRgba(theme.primaryColor || "#3b82f6", 0.18) ?? "rgba(59,130,246,0.18)"),
                        color: isCurrent ? "#fff" : theme.textColor,
                      }}
                    >
                      {index + 1}
                    </span>
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

      </div>

	      {/* Main body inherits the post-header height budget. */}
	      <main className="relative flex flex-1 min-h-0 items-stretch justify-center overflow-hidden px-2 pb-0 pt-2 sm:px-3 sm:pb-3 sm:pt-3">
		        <div className="mx-auto h-full min-h-0 w-full max-w-[92rem] overflow-hidden">
          <motion.div
              ref={previewColumnRef}
              layout={false}
				              className={cn(
				                "relative flex h-full min-h-0 max-h-full flex-col overflow-hidden",
				                previewLayoutActive
                              ? (isMobileViewport ? "gap-0" : "gap-1.5")
                              : usePreviewDominantLayout
                                ? "gap-2"
                                : previewRailOpen
                                  ? "gap-2"
                                  : "gap-0"
				              )}
				            >
                  {showPreviewSection ? (
                    <div
                      ref={previewViewportRef}
                      className={cn(
                        "flex min-h-0 flex-col overflow-hidden",
                        previewLayoutActive ? "flex-1 min-h-0" : "shrink-0"
                      )}
                    >
                      <PreviewSection
                        adventureInputMode={adventureInputMode}
                        answeredQuestionCount={previewAutoAnsweredQuestionCount}
                        autoGenerationCounterScope={previewAutoGenerationCounterScope}
                        config={config}
                        hasPreviewSubsections={hasPreviewSubsections}
                        instanceId={instanceId}
                        isAdventureSurface={isAdventureSurface}
                        isRefinementUploadStep={isRefinementUploadStep}
                        previewMaxPx={previewMaxPx}
                        previewHasImage={previewHasImage}
                        previewRefreshNonce={previewRefreshNonce}
                        pendingPreviewSceneUploadUrl={pendingPreviewSceneUploadUrl}
                        promptDraft={promptDraft}
                        promptSubmitCount={promptSubmitCount}
                        sessionId={sessionId}
                        setAutoGenerationBusy={setPreviewAutoGenerationBusy}
                        setPreviewHasImage={setPreviewHasImage}
                        setPreviewVisible={setPreviewVisible}
                        showQuestionPaneUnderPreview={showQuestionPaneUnderPreview}
                        stateStepData={state?.stepData}
                        useDesktopPreviewLayout={useDesktopPreviewLayout}
                        useMobilePreviewLayout={useMobilePreviewLayout}
                        usePreviewDominantLayout={previewLayoutActive}
                      />
                    </div>
                  ) : null}
                  {!hideQuestionPane ? (
                  <div
                    className={cn(
                      compactQuestionHost
                        ? isMobileViewport
                          ? cn(
                              "flex min-h-0 shrink-0 flex-col pb-[max(env(safe-area-inset-bottom),8px)] overflow-hidden",
                              compactLargeQuestionHost ? "h-[22vh] max-h-[22vh]" : "h-[19vh] max-h-[19vh]"
                            )
                          : cn(
                              "flex min-h-0 shrink-0 flex-col pb-0.5 sm:pb-1 overflow-hidden",
                              compactLargeQuestionHost ? "h-[20vh] max-h-[20vh]" : "h-[17vh] max-h-[17vh]"
                            )
                        : "flex flex-col flex-1 min-h-0"
                    )}
                  >
                    <FormQuestionSection
                      config={config}
                      effectiveCurrentStep={effectiveCurrentStep}
                      flowCompleted={flowCompleted}
                      guidedThumbnailMode={guidedThumbnailMode}
                      handleBack={handleBack}
                      handleEaseFeedback={handleEaseFeedback}
                      handleReflectionFeedback={handleReflectionFeedback}
                      handleStepComplete={handleStepComplete}
                      hideQuestionPane={hideQuestionPane}
                      instanceId={instanceId}
                      isBatchLoading={isBatchLoading}
                      isFetchingNext={isFetchingNext || isAutoPreviewRefreshLocked}
                      isMobileViewport={isMobileViewport}
                      isRefinementUploadStep={isRefinementUploadStep}
                      leadCapturedForUI={effectiveLeadCompleteForPreviewFlow}
                      leadGateLocksQuestionArea={leadGateLocksQuestionArea}
	                      adventureInputMode={adventureInputMode}
	                      setAdventureInputMode={setAdventureInputMode}
	                      budgetSliderConfig={budgetSliderConfig}
	                      budgetValue={budgetValue}
	                      onBudgetChange={handleBudgetChange}
	                      promptDraft={promptDraft}
	                      setPromptDraft={setPromptDraft}
	                      handlePromptSubmit={(uploadedUrl?: string) => {
                          if (uploadedUrl && typeof uploadedUrl === "string") {
                            setPendingPreviewSceneUploadUrl(uploadedUrl);
                          }
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
                      previewEnabled={previewEnabled}
                      previewHasImage={previewHasImage}
                      questionContentRef={questionContentRef}
                      questionScale={questionScale}
                      questionViewportRef={questionViewportRef}
                      refinementUploadInputRef={refinementUploadInputRef}
                      refinementUploading={refinementUploading}
                      reflectionFeedbackSent={reflectionFeedbackSent}
                      sessionId={sessionId}
                      setRefinementUploading={setRefinementUploading}
                      showStepTransitionSkeleton={
                        ((isFetchingNext && !showAccuratePricingLoader) || awaitingRefinementAdvance) &&
                        !isPreviewGenerationStage &&
                        !showPreviewGeneratingEarly
                      }
                      previewGeneratingFocused={isPreviewGenerationStage || showPreviewGeneratingEarly}
                      showAccuratePricingLoader={showAccuratePricingLoader}
                      showEasePrompt={showEasePrompt}
                      showQuestionPaneUnderPreview={showQuestionPaneUnderPreview}
                      state={state}
                      stepForRenderer={stepForRenderer}
                      theme={{
                        borderRadius: theme.borderRadius,
                        fontFamily: theme.fontFamily,
                        primaryColor: theme.primaryColor,
                        secondaryColor: theme.secondaryColor,
                        textColor: theme.textColor,
                      }}
                      layoutDebugEnabled={layoutDebugEnabled}
                      usePreviewDominantLayout={previewLayoutActive}
                    />
                  </div>
                  ) : null}
          </motion.div>
        </div>
      </main>
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
