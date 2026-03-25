import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StepDefinition } from "@/types/ai-form";
import { deriveBudgetSliderRange, roundBudgetStep } from "../utils/budget";
import { DETERMINISTIC_BUDGET_ID, DETERMINISTIC_PRODUCT_IMAGE_ID, DETERMINISTIC_SCENE_IMAGE_ID, DETERMINISTIC_USER_IMAGE_ID } from "../constants";
import { isQuestionStepForAskedIds } from "../utils/step-classification";

export function useStepEngineBudget(args: {
  config: any;
  stateStepData: any;
  stateSteps: any[];
  instanceId: string;
  sessionId: string;
  hasReceivedQuestionsFromGenerateSteps: boolean;
  legacyBudgetUploadEnabled: boolean;
  updateStepData: (key: string, value: any) => void;
}) {
  const {
    config,
    stateStepData,
    stateSteps,
    instanceId,
    sessionId,
    hasReceivedQuestionsFromGenerateSteps,
    legacyBudgetUploadEnabled,
    updateStepData,
  } = args;
  const [budgetApiRange, setBudgetApiRange] = useState<{ min: number; max: number; currency: string } | null>(null);
  const budgetApiLoadedSessionRef = useRef<string | null>(null);

  const optionalSceneImageStep: StepDefinition = useMemo(
    () => ({
      id: DETERMINISTIC_SCENE_IMAGE_ID,
      componentType: "upload",
      intent: "collect_context",
      data: { required: false, maxFiles: 1, accept: "image/*", uploadRole: "sceneImage", camera: true },
      copy: {
        headline: "Have a photo handy?",
        subtext: "Optional - upload one for tailored results, or skip and we'll generate concept ideas.",
      },
    }),
    []
  );
  const requiredSceneImageStep: StepDefinition = useMemo(
    () => ({
      id: DETERMINISTIC_SCENE_IMAGE_ID,
      componentType: "upload",
      intent: "collect_context",
      data: { required: true, maxFiles: 1, accept: "image/*", uploadRole: "sceneImage", camera: true },
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
      data: { required: true, maxFiles: 1, accept: "image/*", uploadRole: "userImage", camera: true },
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
      data: { required: true, maxFiles: 1, accept: "image/*", uploadRole: "productImage", camera: false },
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
    if (normalizedUseCase === "tryon") return [requiredUserImageStep, requiredProductImageStep];
    if (normalizedUseCase === "scene-placement") return [requiredSceneImageStep, requiredProductImageStep];
    return [optionalSceneImageStep];
  }, [normalizedUseCase, optionalSceneImageStep, requiredProductImageStep, requiredSceneImageStep, requiredUserImageStep]);

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
      data: { required: true, min, max, step: Math.max(100, step), currency, unit: "$", unitType: "currency", format: "currency" },
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

  const budgetValue = useMemo((): number | null => {
    const raw = (stateStepData as any)?.[DETERMINISTIC_BUDGET_ID];
    const v = Array.isArray(raw) ? raw[0] : raw;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }, [stateStepData]);

  useEffect(() => {
    if (!legacyBudgetUploadEnabled) return;
    if (!sessionId || !instanceId) return;
    if (!hasReceivedQuestionsFromGenerateSteps) return;
    if (budgetApiLoadedSessionRef.current === sessionId) return;
    budgetApiLoadedSessionRef.current = sessionId;

    const stepData = stateStepData || {};
    const questionStepIds = (stateSteps || [])
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
        const range = estimate?.servicePriceRange && typeof estimate.servicePriceRange === "object" ? estimate.servicePriceRange : null;
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
  }, [config?.useCase, hasReceivedQuestionsFromGenerateSteps, instanceId, legacyBudgetUploadEnabled, sessionId, stateStepData, stateSteps]);

  const handleBudgetChange = useCallback(
    (value: number) => {
      updateStepData(DETERMINISTIC_BUDGET_ID, value);
    },
    [updateStepData]
  );

  return {
    budgetApiRange,
    budgetSliderConfig,
    budgetValue,
    deterministicBudgetStep,
    desiredDeterministicUploadSteps,
    handleBudgetChange,
    normalizedUseCase,
  };
}
