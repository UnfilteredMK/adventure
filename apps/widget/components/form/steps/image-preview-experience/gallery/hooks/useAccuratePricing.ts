"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { buildAnsweredQAFromSteps, shouldExcludeStepFromAnsweredQA } from "@/lib/ai-form/answered-qa";
import { loadFormStateContext } from "@/lib/ai-form/state/form-state-context";
import { loadServiceCatalog } from "@/lib/ai-form/state/service-catalog-storage";
import { loadStepState } from "@/lib/ai-form/state/step-state";
import { buildPreviewPricingFromConfig } from "@/lib/ai-form/components/structural-steps";
import { detectCurrencyFromLocale } from "@/lib/ai-form/utils/currency";
import { loadCache, saveCache } from "../cache";
import type { CachedPricing, PreviewCacheV3, PreviewRun, PricingRequestInputs } from "../types";
import { resolveBudgetTierFromRanges } from "../utils/pricing";

type PricingContextForPreview = {
  pricingScenario: "initial" | "comparison" | "refinement";
  baselinePriceRange: { low: number; high: number } | null;
  baselineImageUrl: string | null;
  changedRefinementKeys: Array<{ key: string; label: string }>;
  stepDataSnapshot: Record<string, any>;
};

type UseAccuratePricingOptions = {
  instanceId: string;
  sessionId: string;
  enabled: boolean;
  leadCaptured: boolean;
  leadGateEnabled: boolean;
  hero: string | null;
  activeRun: PreviewRun | null;
  runsLength: number;
  config?: any;
  effectiveStepDataSoFar: Record<string, any>;
  pricingSeed: any;
  setCache: React.Dispatch<React.SetStateAction<PreviewCacheV3 | null>>;
  accuratePricing: CachedPricing | null;
  setAccuratePricing: React.Dispatch<React.SetStateAction<CachedPricing | null>>;
  accuratePricingStatus: "idle" | "running" | "complete" | "error";
  setAccuratePricingStatus: React.Dispatch<React.SetStateAction<"idle" | "running" | "complete" | "error">>;
  liveBudget: number | null;
  setLiveBudget: React.Dispatch<React.SetStateAction<number | null>>;
  liveBudgetDirty: boolean;
  setLiveBudgetDirty: React.Dispatch<React.SetStateAction<boolean>>;
  currentHeroRef: React.MutableRefObject<string | null>;
  heroForPricingRef: React.MutableRefObject<string | null>;
  pendingBudgetRefineRef: React.MutableRefObject<boolean>;
  pendingBudgetTierShiftRef: React.MutableRefObject<boolean>;
  prevRunsLengthRef: React.MutableRefObject<number>;
  fetchAccuratePricingRef: React.MutableRefObject<(() => Promise<void>) | null>;
  requestAccuratePricing: (inputs: PricingRequestInputs) => Promise<CachedPricing>;
  derivePricingContextForPreview: (params: {
    stepsForQA: any[];
    previewImageUrl: string | null;
    mode: "current" | "next-run";
  }) => PricingContextForPreview;
  onBudgetRegenerate?: () => void;
};

export function useAccuratePricing({
  instanceId,
  sessionId,
  enabled,
  leadCaptured,
  leadGateEnabled,
  hero,
  activeRun,
  runsLength,
  config,
  effectiveStepDataSoFar,
  pricingSeed,
  setCache,
  accuratePricing,
  setAccuratePricing,
  accuratePricingStatus,
  setAccuratePricingStatus,
  liveBudget,
  setLiveBudget,
  liveBudgetDirty,
  setLiveBudgetDirty,
  currentHeroRef,
  heroForPricingRef,
  pendingBudgetRefineRef,
  pendingBudgetTierShiftRef,
  prevRunsLengthRef,
  fetchAccuratePricingRef,
  requestAccuratePricing,
  derivePricingContextForPreview,
  onBudgetRegenerate,
}: UseAccuratePricingOptions) {
  const prevBudgetForPricingRef = useRef<number | null>(null);
  const skipNextFetchRef = useRef(false);

  const previewPricing = useMemo(() => {
    return buildPreviewPricingFromConfig((config as any)?.previewPricing, sessionId);
  }, [(config as any)?.previewPricing, sessionId]);

  const pricingLocale =
    typeof navigator !== "undefined"
      ? ((navigator.languages && navigator.languages[0]) || navigator.language || undefined)
      : undefined;
  const pricingCurrency = (previewPricing?.currency || detectCurrencyFromLocale(pricingLocale) || "USD").toUpperCase();

  const budgetSliderBounds = useMemo(() => {
    const configPreviewPricingSeed = buildPreviewPricingFromConfig((config as any)?.previewPricing, sessionId);
    const seededRange =
      pricingSeed?.servicePriceRange ??
      pricingSeed?.imagePriceRange ??
      (typeof pricingSeed?.totalMin === "number" && typeof pricingSeed?.totalMax === "number"
        ? { low: pricingSeed.totalMin, high: pricingSeed.totalMax }
        : null);
    const sourceMin =
      accuratePricing?.servicePriceRange?.low ?? seededRange?.low ?? configPreviewPricingSeed?.totalMin ?? 2000;
    const sourceMax =
      accuratePricing?.servicePriceRange?.high ?? seededRange?.high ?? configPreviewPricingSeed?.totalMax ?? 50000;
    const min = Math.max(500, Math.min(sourceMin, sourceMax));
    const max = Math.max(min + 500, Math.max(sourceMin, sourceMax));
    const span = Math.max(0, max - min);
    const step =
      span <= 10000 ? 1000 : span <= 20000 ? 1500 : span <= 40000 ? 2000 : span <= 60000 ? 2500 : Math.max(1000, Math.round(span / 24));
    return { min, max, step };
  }, [accuratePricing, config, pricingSeed, sessionId]);

  const fetchAccuratePricing = useCallback(async () => {
    if (!instanceId || !sessionId) return;
    if (accuratePricingStatus === "running") return;
    const heroAtFetchStart = hero;
    setAccuratePricingStatus("running");

    try {
      const stepsForQA = typeof window !== "undefined" ? loadStepState(instanceId)?.steps ?? [] : [];
      const answeredQA = buildAnsweredQAFromSteps(stepsForQA, effectiveStepDataSoFar || {}, 60);
      const askedStepIds = stepsForQA
        .map((s: any) => String(s?.id ?? s?.stepId ?? s?.key ?? ""))
        .filter((v: string) => Boolean(v && v.trim().length && !shouldExcludeStepFromAnsweredQA(v)));
      const pricingContext = derivePricingContextForPreview({ stepsForQA, previewImageUrl: heroAtFetchStart, mode: "current" });

      const formCtx = loadFormStateContext(sessionId);
      const serviceIdRaw =
        (effectiveStepDataSoFar as any)?.["step-service-primary"] ??
        (effectiveStepDataSoFar as any)?.["step-service"] ??
        (effectiveStepDataSoFar as any)?.["step_service_primary"] ??
        (effectiveStepDataSoFar as any)?.["step_service"];
      const selectedServiceId = Array.isArray(serviceIdRaw) ? String(serviceIdRaw[0] || "") : String(serviceIdRaw || "");
      const perServiceSummary =
        selectedServiceId
          ? (() => {
              const cat = loadServiceCatalog(sessionId);
              const meta: any = cat?.byServiceId?.[selectedServiceId];
              return typeof meta?.serviceSummary === "string" ? meta.serviceSummary : null;
            })()
          : null;
      const combinedServiceSummary =
        [formCtx.serviceSummary, perServiceSummary].filter((s) => typeof s === "string" && String(s).trim()).join("\n\n") || null;
      const instanceContext = {
        businessContext: (config as any)?.businessContext ?? formCtx.businessContext,
        serviceSummary: combinedServiceSummary,
      };

      const cached = await requestAccuratePricing({
        answeredQA,
        askedStepIds,
        instanceContext,
        previewImageUrl: heroAtFetchStart,
        pricingScenario: pricingContext.pricingScenario,
        baselineImageUrl: pricingContext.baselineImageUrl,
        baselinePriceRange: pricingContext.baselinePriceRange,
        changedRefinementKeys: pricingContext.changedRefinementKeys,
        budgetRange: liveBudget,
      });

      const stillViewingHero = currentHeroRef.current === heroAtFetchStart;
      if (stillViewingHero) {
        setAccuratePricing((prev) => {
          const keepServiceRange =
            prev?.servicePriceRange &&
            typeof prev.servicePriceRange.low === "number" &&
            typeof prev.servicePriceRange.high === "number";
          const finalServiceRange = keepServiceRange && prev?.servicePriceRange ? prev.servicePriceRange : cached.servicePriceRange;
          return {
            ...cached,
            ...(finalServiceRange ? { servicePriceRange: finalServiceRange } : {}),
          };
        });
        heroForPricingRef.current = heroAtFetchStart;
        setAccuratePricingStatus("complete");
      }

      const heroIdx = heroAtFetchStart ? (activeRun?.images?.indexOf(heroAtFetchStart) ?? -1) : -1;
      if (heroIdx >= 0 && activeRun?.id && instanceId && sessionId) {
        const cachedValue = cached;
        setCache((prev) => {
          const base = prev ?? loadCache(instanceId, sessionId);
          if (!base) return prev;
          const nextRuns = (base.runs ?? []).map((r) => {
            if (r.id !== activeRun.id) return r;
            const existing = r.imagePricing ?? [];
            const nextPricing: (CachedPricing | undefined)[] = [...existing];
            while (nextPricing.length <= heroIdx) nextPricing.push(undefined);
            nextPricing[heroIdx] = cachedValue;
            return { ...r, imagePricing: nextPricing };
          });
          const next: PreviewCacheV3 = { ...base, runs: nextRuns, updatedAt: Date.now() };
          saveCache(instanceId, sessionId, next);
          return next;
        });
      }
    } catch {
      if (currentHeroRef.current === heroAtFetchStart) setAccuratePricingStatus("error");
    }
  }, [
    accuratePricingStatus,
    activeRun,
    config,
    derivePricingContextForPreview,
    effectiveStepDataSoFar,
    hero,
    instanceId,
    liveBudget,
    requestAccuratePricing,
    sessionId,
  ]);

  fetchAccuratePricingRef.current = fetchAccuratePricing;

  useEffect(() => {
    currentHeroRef.current = hero;
  }, [hero]);

  useEffect(() => {
    if (liveBudget !== null) return;
    const { min, max, step } = budgetSliderBounds;
    const preferred =
      typeof pricingSeed?.medianPrice === "number" && Number.isFinite((pricingSeed as any).medianPrice)
        ? (pricingSeed as any).medianPrice
        : min + (max - min) * 0.2;
    const stepped = Math.round(preferred / step) * step;
    const clamped = Math.max(min, Math.min(max, stepped));
    setLiveBudget(clamped);
  }, [budgetSliderBounds, liveBudget, (pricingSeed as any)?.medianPrice]);

  useEffect(() => {
    if (liveBudget === null || !Number.isFinite(liveBudget)) return;
    if (prevBudgetForPricingRef.current === null) {
      prevBudgetForPricingRef.current = liveBudget;
      return;
    }
    if (prevBudgetForPricingRef.current === liveBudget) return;
    prevBudgetForPricingRef.current = liveBudget;
    if (!enabled || !hero) return;
    if (!leadCaptured) return;
    const heroIdx = hero ? (activeRun?.images?.indexOf(hero) ?? -1) : -1;
    const cachedHeroPricing = heroIdx >= 0 ? activeRun?.imagePricing?.[heroIdx] : undefined;
    const tierRanges = accuratePricing?.budgetTierRanges ?? cachedHeroPricing?.budgetTierRanges;
    const sourceTier = accuratePricing?.budgetTier ?? cachedHeroPricing?.budgetTier ?? null;
    const targetTier = resolveBudgetTierFromRanges(tierRanges, liveBudget);
    pendingBudgetTierShiftRef.current = Boolean(sourceTier && targetTier && sourceTier !== targetTier);
    pendingBudgetRefineRef.current = true;
    prevRunsLengthRef.current = runsLength;
  }, [accuratePricing?.budgetTier, accuratePricing?.budgetTierRanges, activeRun, enabled, hero, leadCaptured, liveBudget, runsLength]);

  useEffect(() => {
    if (!enabled || !leadCaptured) return;
    if (!pendingBudgetRefineRef.current) {
      prevRunsLengthRef.current = runsLength;
      return;
    }
    if (runsLength <= prevRunsLengthRef.current) return;
    prevRunsLengthRef.current = runsLength;
    pendingBudgetRefineRef.current = false;
    void fetchAccuratePricingRef.current?.();
  }, [enabled, leadCaptured, runsLength]);

  useEffect(() => {
    if (!hero || !leadCaptured) return;
    if (hero === heroForPricingRef.current) return;
    const heroIdx = activeRun?.images?.indexOf(hero) ?? -1;
    const cached = heroIdx >= 0 ? activeRun?.imagePricing?.[heroIdx] : undefined;
    if (cached && typeof cached.totalMin === "number" && typeof cached.totalMax === "number") {
      heroForPricingRef.current = hero;
      skipNextFetchRef.current = true;
      setAccuratePricing({
        totalMin: cached.totalMin,
        totalMax: cached.totalMax,
        currency: cached.currency || "USD",
        imagePriceRange: cached.imagePriceRange,
        servicePriceRange: cached.servicePriceRange,
        baselinePriceRange: cached.baselinePriceRange,
        deltaPriceRange: cached.deltaPriceRange,
        deltaDirection: cached.deltaDirection,
        budgetTier: cached.budgetTier,
        budgetTierRanges: cached.budgetTierRanges,
        priceDrivers: cached.priceDrivers,
        calibrationKey: cached.calibrationKey,
      });
      setAccuratePricingStatus("complete");
      return;
    }
    heroForPricingRef.current = null;
    setAccuratePricing(null);
    setAccuratePricingStatus("idle");
  }, [activeRun, hero, leadCaptured]);

  useEffect(() => {
    if (!leadGateEnabled) return;
    if (!leadCaptured) return;
    const hasRange =
      accuratePricing &&
      (typeof accuratePricing.imagePriceRange?.low === "number" || typeof accuratePricing.totalMin === "number");
    if (hasRange) return;
    if (accuratePricingStatus !== "idle") return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    void fetchAccuratePricingRef.current?.();
  }, [accuratePricing, accuratePricingStatus, leadCaptured, leadGateEnabled]);

  useEffect(() => {
    if (!enabled) return;
    if (!hero) return;
    if (!liveBudgetDirty) return;
    const timer = window.setTimeout(() => {
      setLiveBudgetDirty(false);
      pendingBudgetRefineRef.current = true;
      onBudgetRegenerate?.();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [enabled, hero, liveBudgetDirty, onBudgetRegenerate]);

  return {
    budgetSliderBounds,
    fetchAccuratePricing,
    pricingLocale,
    pricingCurrency,
    previewPricing,
  };
}
