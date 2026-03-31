import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StepDefinition } from "@/types/ai-form";
import { DETERMINISTIC_BUDGET_ID, PRICING_ESTIMATE_KEY } from "../constants";
import { isQuestionStepForAskedIds } from "../utils/step-classification";
import { normalizePricingEstimate } from "../utils/pricing-estimate";
import {
  buildDeterministicBudgetStep,
  buildDeterministicUploadSteps,
  normalizeDeterministicUseCase,
} from "../utils/deterministic-adventure-steps";

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
  const pricingSeed = useMemo(
    () => normalizePricingEstimate((stateStepData as any)?.[PRICING_ESTIMATE_KEY]),
    [stateStepData]
  );

  const normalizedUseCase = useMemo((): "tryon" | "scene-placement" | "scene" => {
    return normalizeDeterministicUseCase(config?.useCase);
  }, [config?.useCase]);

  const desiredDeterministicUploadSteps = useMemo(() => {
    return buildDeterministicUploadSteps(normalizedUseCase);
  }, [normalizedUseCase]);

  const deterministicBudgetStep: StepDefinition = useMemo(() => {
    return buildDeterministicBudgetStep({
      budgetApiRange,
      config,
      pricingSeed,
      useCase: normalizedUseCase,
    });
  }, [budgetApiRange, config, normalizedUseCase, pricingSeed]);

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
    if (
      pricingSeed?.status === "running" ||
      pricingSeed?.servicePriceRange ||
      pricingSeed?.imagePriceRange ||
      (typeof pricingSeed?.totalMin === "number" && typeof pricingSeed?.totalMax === "number")
    ) {
      return;
    }
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
  }, [
    config?.useCase,
    hasReceivedQuestionsFromGenerateSteps,
    instanceId,
    legacyBudgetUploadEnabled,
    pricingSeed,
    sessionId,
    stateStepData,
    stateSteps,
  ]);

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
