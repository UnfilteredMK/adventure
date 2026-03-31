"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { buildAnsweredQAFromSteps, shouldExcludeStepFromAnsweredQA } from "@/lib/ai-form/answered-qa";
import { loadFormStateContext } from "@/lib/ai-form/state/form-state-context";
import { loadServiceCatalog } from "@/lib/ai-form/state/service-catalog-storage";
import { loadStepState } from "@/lib/ai-form/state/step-state";
import { loadCache, loadUploadedImages, newRunId, saveCache, saveUploadedImages } from "../cache";
import { GALLERY_LOADING_TITLE } from "../constants";
import type { CachedPricing, PreviewCacheV3, PreviewRun, PricingRequestInputs } from "../types";
import { safeJsonStringify } from "../utils/context";
import {
  absolutizeImageUrl,
  isPlaceholderPreviewImage,
  isValidUrlLikeImage,
  mergeUniqueImageUrls,
} from "../utils/images";
import {
  extractBudgetValue,
  normalizeNumericRange,
} from "../utils/pricing";

type PricingContextForPreview = {
  pricingScenario: "initial" | "comparison" | "refinement";
  baselinePriceRange: { low: number; high: number } | null;
  baselineImageUrl: string | null;
  changedRefinementKeys: Array<{ key: string; label: string }>;
  stepDataSnapshot: Record<string, any>;
};

type UsePreviewGenerationOptions = {
  instanceId: string;
  sessionId: string;
  enabled: boolean;
  config?: any;
  cacheStatus?: PreviewCacheV3["status"];
  cacheGeneratedForContextSignature?: string | null;
  cacheLastGeneratedAnsweredCount?: number | null;
  effectiveStepDataSoFar: Record<string, any>;
  answeredQuestionCount: number;
  autoRegenerateEveryNAnsweredQuestions: number;
  autoGenerationCounterScope: string;
  leadGateActive: boolean;
  conceptGalleryTargetCount: number;
  hero: string | null;
  runs: PreviewRun[];
  uploadedImages: string[];
  setUploadedImages: React.Dispatch<React.SetStateAction<string[]>>;
  setCache: React.Dispatch<React.SetStateAction<PreviewCacheV3 | null>>;
  derivePricingContextForPreview: (params: {
    stepsForQA: any[];
    previewImageUrl: string | null;
    mode: "current" | "next-run";
  }) => PricingContextForPreview;
  requestAccuratePricing: (inputs: PricingRequestInputs) => Promise<CachedPricing>;
  refreshRegenAllowance: () => Promise<void>;
  currentHeroRef: React.MutableRefObject<string | null>;
  heroForPricingRef: React.MutableRefObject<string | null>;
  setAccuratePricing: React.Dispatch<React.SetStateAction<CachedPricing | null>>;
  setAccuratePricingStatus: React.Dispatch<React.SetStateAction<"idle" | "running" | "complete" | "error">>;
  pendingBudgetRefineRef: React.MutableRefObject<boolean>;
  pendingBudgetTierShiftRef: React.MutableRefObject<boolean>;
};

function readFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target?.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

export function usePreviewGeneration({
  instanceId,
  sessionId,
  enabled,
  config,
  cacheStatus,
  cacheGeneratedForContextSignature,
  cacheLastGeneratedAnsweredCount,
  effectiveStepDataSoFar,
  answeredQuestionCount,
  autoRegenerateEveryNAnsweredQuestions,
  autoGenerationCounterScope,
  leadGateActive,
  conceptGalleryTargetCount,
  hero,
  runs,
  uploadedImages,
  setUploadedImages,
  setCache,
  derivePricingContextForPreview,
  requestAccuratePricing,
  refreshRegenAllowance,
  currentHeroRef,
  heroForPricingRef,
  setAccuratePricing,
  setAccuratePricingStatus,
  pendingBudgetRefineRef,
  pendingBudgetTierShiftRef,
}: UsePreviewGenerationOptions) {
  const [activeGenerationReason, setActiveGenerationReason] = useState<"auto" | "manual" | null>(null);
  const [isUploadingOwnImages, setIsUploadingOwnImages] = useState(false);

  const inFlightRef = useRef(false);
  const pendingManualGenerateRef = useRef(false);
  const promptSubmitNonceRef = useRef<number>(0);
  const promptSubmitNonceInitializedRef = useRef(false);
  const autoGenerationCounterScopeRef = useRef<string>(autoGenerationCounterScope);
  const previewRefreshNonceRef = useRef<number>(0);
  const lastAutoRegenAtRef = useRef<number>(0);

  const runGenerate = useCallback(
    async (reason: "auto" | "manual") => {
      if (!enabled) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      let responseErrorDetails: string | null = null;

      const normalizeUseCase = (raw?: unknown): "tryon" | "scene-placement" | "scene-refinement" | "scene" => {
        const v = String(raw || "")
          .trim()
          .toLowerCase()
          .replace(/_/g, "-")
          .replace(/\s+/g, "-");
        if (v === "tryon" || v === "try-on") return "tryon";
        if (v === "scene-placement") return "scene-placement";
        if (v === "scene-refinement") return "scene-refinement";
        if (v === "scene") return "scene";
        return "scene";
      };

      const signatureAtStart = safeJsonStringify(effectiveStepDataSoFar || {});
      const latestRun = runs.length ? runs.at(-1) ?? null : null;
      const baseReferenceImage = hero || latestRun?.images?.[0] || null;
      const normalizeUploadToStrings = (raw: any): string[] => {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
        if (typeof raw === "string") return [raw];
        return [];
      };
      const stepSceneUpload =
        (["step-upload-scene-image", "step-refinement-upload-scene-image"] as const)
          .map((stepId) => normalizeUploadToStrings((effectiveStepDataSoFar as any)?.[stepId]).filter(isValidUrlLikeImage)[0] ?? null)
          .find(Boolean) ?? null;
      const stepUserUpload =
        normalizeUploadToStrings((effectiveStepDataSoFar as any)?.["step-upload-user-image"]).filter(isValidUrlLikeImage)[0] ?? null;
      const stepProductUpload =
        normalizeUploadToStrings((effectiveStepDataSoFar as any)?.["step-upload-product-image"]).filter(isValidUrlLikeImage)[0] ?? null;
      const storedUploads = Array.from(
        new Set([
          ...(stepSceneUpload ? [stepSceneUpload] : []),
          ...(stepUserUpload ? [stepUserUpload] : []),
          ...(stepProductUpload ? [stepProductUpload] : []),
          ...uploadedImages,
        ])
      )
        .filter(isValidUrlLikeImage)
        .slice(0, 6);

      const selectedOptionReferenceImages = (() => {
        try {
          const stepsForRefs = typeof window !== "undefined" ? loadStepState(instanceId)?.steps ?? [] : [];
          const urls: string[] = [];
          for (const step of stepsForRefs) {
            if (!step || typeof step !== "object") continue;
            const id = String((step as any)?.id || "");
            if (!id) continue;
            const answer = (effectiveStepDataSoFar as any)?.[id];
            if (answer === null || answer === undefined) continue;
            const options = Array.isArray((step as any)?.options) ? ((step as any).options as any[]) : [];
            if (options.length === 0) continue;
            const wanted = Array.isArray(answer) ? answer.map(String) : [String(answer)];
            for (const w of wanted) {
              const opt = options.find((o: any) => {
                if (!o || typeof o !== "object") return false;
                const v = typeof o.value === "string" ? o.value : null;
                const l = typeof o.label === "string" ? o.label : null;
                return (v && v === w) || (l && l === w);
              });
              const img = opt && typeof opt.imageUrl === "string" ? opt.imageUrl : null;
              if (img && isValidUrlLikeImage(img)) urls.push(img);
            }
          }
          return Array.from(new Set(urls)).slice(0, 3);
        } catch {
          return [] as string[];
        }
      })();

      const hasExistingPreview = Boolean(baseReferenceImage);
      const useCase = normalizeUseCase((config as any)?.useCase);
      const isBudgetDrivenRegeneration = Boolean(pendingBudgetRefineRef.current);
      const isBudgetTierShift = Boolean(pendingBudgetTierShiftRef.current);
      const generationSignatureAtStart = safeJsonStringify({
        contextSignature: signatureAtStart,
        uploads: storedUploads,
        selectionRefs: selectedOptionReferenceImages,
      });
      const activeAnchorImage = (baseReferenceImage || stepSceneUpload || storedUploads?.[0] || null) as string | null;
      const originalUploadedAnchorImage = (stepSceneUpload || stepUserUpload || storedUploads?.[0] || null) as string | null;
      const runAnchorImage = isBudgetDrivenRegeneration ? (originalUploadedAnchorImage || activeAnchorImage) : activeAnchorImage;
      const shouldUseOptionCardImagesAsGenerationRefs =
        hasExistingPreview || useCase !== "scene" || Boolean(runAnchorImage);
      const primaryReferenceImage = runAnchorImage;
      const referenceImagesForRequest = (
        hasExistingPreview
          ? [
              ...(runAnchorImage ? [runAnchorImage] : []),
              ...storedUploads.filter((u) => u && u !== runAnchorImage),
              ...selectedOptionReferenceImages.filter((u) => u && u !== runAnchorImage),
            ]
          : [
              ...(primaryReferenceImage ? [primaryReferenceImage] : []),
              ...storedUploads.filter((u) => u && u !== primaryReferenceImage),
              ...(
                shouldUseOptionCardImagesAsGenerationRefs
                  ? selectedOptionReferenceImages.filter((u) => u && u !== primaryReferenceImage)
                  : []
              ),
            ]
      )
        .filter(isValidUrlLikeImage)
        .slice(0, 6);
      const canUseScenePlacementForRefinement =
        hasExistingPreview &&
        (useCase === "scene" || useCase === "scene-placement") &&
        (stepProductUpload || false) &&
        (runAnchorImage || stepSceneUpload || primaryReferenceImage);
      const canUseSceneRefinement =
        hasExistingPreview &&
        (useCase === "scene" || useCase === "scene-placement") &&
        !stepProductUpload &&
        !!(runAnchorImage || stepSceneUpload || primaryReferenceImage);
      const effectiveUseCase = canUseScenePlacementForRefinement
        ? "scene-placement"
        : canUseSceneRefinement
          ? "scene-refinement"
          : useCase;

      const originalReferenceImage = (stepSceneUpload || stepUserUpload || storedUploads?.[0] || null) as string | null;
      const generationIndex = runs.length;
      const generationIntent: "initial" | "small_improvement" | "regenerate" | "budget_tier_shift" = isBudgetDrivenRegeneration
        ? isBudgetTierShift
          ? "budget_tier_shift"
          : "regenerate"
        : hasExistingPreview
          ? "small_improvement"
          : "initial";
      const guideOnlyInitialSceneRun =
        useCase === "scene" && generationIntent === "initial" && !hasExistingPreview && referenceImagesForRequest.length > 0;
      const sceneImageForRequest =
        (effectiveUseCase === "scene" || effectiveUseCase === "scene-refinement") && runAnchorImage
          ? runAnchorImage
          : (effectiveUseCase === "scene" || effectiveUseCase === "scene-refinement") && stepSceneUpload
            ? stepSceneUpload
            : (effectiveUseCase === "scene" || effectiveUseCase === "scene-refinement") && primaryReferenceImage
              ? primaryReferenceImage
              : effectiveUseCase === "scene-placement" && runAnchorImage
                ? runAnchorImage
                : effectiveUseCase === "scene-placement" && stepSceneUpload
                  ? stepSceneUpload
                  : effectiveUseCase === "scene-placement" && primaryReferenceImage
                    ? primaryReferenceImage
                    : undefined;
      const lastGeneratedSignature = latestRun?.contextSignature ?? cacheGeneratedForContextSignature ?? null;
      if (reason === "auto" && generationSignatureAtStart && lastGeneratedSignature && generationSignatureAtStart === lastGeneratedSignature && runs.length > 0) {
        inFlightRef.current = false;
        return;
      }

      const runId = newRunId();
      try {
        const stepsForQA = typeof window !== "undefined" ? loadStepState(instanceId)?.steps ?? [] : [];
        const answeredQA = buildAnsweredQAFromSteps(stepsForQA, effectiveStepDataSoFar || {}, 60);
        const askedStepIds = stepsForQA
          .map((s: any) => String(s?.id ?? s?.stepId ?? s?.key ?? ""))
          .filter((v: string) => Boolean(v && v.trim().length && !shouldExcludeStepFromAnsweredQA(v)));
        const pricingContextForNextRun = derivePricingContextForPreview({ stepsForQA, previewImageUrl: hero, mode: "next-run" });
        const formCtx = loadFormStateContext(sessionId);
        const serviceIdRaw =
          (effectiveStepDataSoFar as any)?.["step-service-primary"] ??
          (effectiveStepDataSoFar as any)?.["step-service"] ??
          (effectiveStepDataSoFar as any)?.["step_service_primary"] ??
          (effectiveStepDataSoFar as any)?.["step_service"];
        const selectedServiceId = Array.isArray(serviceIdRaw) ? String(serviceIdRaw[0] || "") : String(serviceIdRaw || "");
        const catalogMeta = selectedServiceId
          ? (() => {
              const cat = loadServiceCatalog(sessionId);
              return (cat?.byServiceId?.[selectedServiceId] ?? null) as {
                serviceName?: string | null;
                serviceSummary?: string | null;
                industryId?: string | null;
                industryName?: string | null;
              } | null;
            })()
          : null;
        const perServiceSummary =
          catalogMeta && typeof catalogMeta.serviceSummary === "string" ? catalogMeta.serviceSummary : null;
        const perServiceName =
          catalogMeta && typeof catalogMeta.serviceName === "string" && catalogMeta.serviceName.trim()
            ? catalogMeta.serviceName.trim()
            : null;
        const combinedServiceSummary =
          [formCtx.serviceSummary, perServiceSummary].filter((s) => typeof s === "string" && String(s).trim()).join("\n\n") || null;
        const instanceContext: Record<string, unknown> = {
          businessContext: (config as any)?.businessContext ?? formCtx.businessContext,
          serviceSummary: combinedServiceSummary,
        };
        if (selectedServiceId || perServiceName) {
          instanceContext.service = {
            ...(selectedServiceId ? { id: selectedServiceId } : {}),
            ...(perServiceName ? { name: perServiceName } : {}),
          };
        }
        if (catalogMeta?.industryName || catalogMeta?.industryId) {
          instanceContext.industry = {
            ...(catalogMeta.industryId ? { id: catalogMeta.industryId } : {}),
            ...(catalogMeta.industryName ? { name: catalogMeta.industryName } : {}),
          };
        }

        const ensureUrlLikeImage = async (src: string): Promise<string> => {
          if (!src || typeof src !== "string") return src;
          if (!src.startsWith("data:")) return absolutizeImageUrl(src);
          try {
            const uploadRes = await fetch("/api/upload-reference-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ instanceId, image: src }),
            });
            if (uploadRes.ok) {
              const data = await uploadRes.json().catch(() => ({}));
              if (data?.url && typeof data.url === "string" && isValidUrlLikeImage(data.url)) {
                return absolutizeImageUrl(data.url);
              }
            }
          } catch {}
          return src;
        };

        const normalizedUseCase = effectiveUseCase;
        const userImage = stepUserUpload ? await ensureUrlLikeImage(stepUserUpload) : null;
        const productImageRaw = stepProductUpload || null;
        const productImage = productImageRaw ? await ensureUrlLikeImage(productImageRaw) : null;
        const sceneImage =
          sceneImageForRequest && typeof sceneImageForRequest === "string" ? await ensureUrlLikeImage(sceneImageForRequest) : null;

        const scenePlacementInpaintMode =
          normalizedUseCase === "scene-refinement" || (normalizedUseCase === "scene-placement" && !productImage);
        const refsForGeneration = guideOnlyInitialSceneRun
          ? referenceImagesForRequest
          : normalizedUseCase === "scene" || scenePlacementInpaintMode
            ? [sceneImage || sceneImageForRequest].filter(isValidUrlLikeImage)
            : referenceImagesForRequest;
        const ensuredRefs = await Promise.all(refsForGeneration.map((u) => ensureUrlLikeImage(u)));
        const uniqueRefs = Array.from(new Set(ensuredRefs.filter(isValidUrlLikeImage))).slice(0, 6);

        const endpoint = "/api/generate";
        const budgetForRequest = extractBudgetValue(effectiveStepDataSoFar || {});
        const refinementNotesRaw = (effectiveStepDataSoFar as any)?.["step-promptInput"];
        const refinementNotes =
          typeof refinementNotesRaw === "string" && refinementNotesRaw.trim() ? refinementNotesRaw.trim() : undefined;
        const hasDirectImageInput = Boolean(userImage || productImage || sceneImage);
        const shouldGenerateConceptGallery =
          generationIntent === "initial" && !hasDirectImageInput;
        const numOutputs = shouldGenerateConceptGallery ? conceptGalleryTargetCount : 1;
        const initialBatchSize = shouldGenerateConceptGallery ? Math.min(2, numOutputs) : numOutputs;
        const generationMessage =
          !hasExistingPreview || shouldGenerateConceptGallery
            ? GALLERY_LOADING_TITLE
            : isBudgetTierShift
              ? "Reworking your design for the new budget tier…"
              : "Refreshing your design…";
        const requestBodyBase: any = {
          instanceId,
          sessionId,
          useCase: normalizedUseCase,
          generationIntent,
          stepDataSoFar: effectiveStepDataSoFar ?? {},
          answeredQA,
          askedStepIds,
          instanceContext: { ...instanceContext },
        };
        if (guideOnlyInitialSceneRun && !sceneImage) requestBodyBase.referenceMode = "guide_only";
        if (refinementNotes) requestBodyBase.refinementNotes = refinementNotes;
        if (originalReferenceImage) requestBodyBase.originalReferenceImage = originalReferenceImage;
        if (budgetForRequest !== null) requestBodyBase.budgetRange = budgetForRequest;

        if (normalizedUseCase === "tryon") {
          if (!userImage || !productImage) {
            throw new Error("Please upload both a person photo and a product photo to generate a try-on preview.");
          }
          requestBodyBase.userImage = userImage;
          requestBodyBase.productImage = productImage;
          requestBodyBase.referenceImages = Array.from(new Set([userImage, productImage, ...uniqueRefs])).slice(0, 6);
        } else if (normalizedUseCase === "scene-placement" || normalizedUseCase === "scene-refinement") {
          if (!sceneImage) {
            throw new Error("Please upload a scene photo to generate a refinement preview.");
          }
          requestBodyBase.sceneImage = sceneImage;
          if (normalizedUseCase === "scene-placement" && productImage) requestBodyBase.productImage = productImage;
          requestBodyBase.referenceImages = Array.from(new Set([sceneImage, ...(productImage ? [productImage] : []), ...uniqueRefs])).slice(0, 6);
        } else {
          if (sceneImage) requestBodyBase.sceneImage = sceneImage;
          const refsMinusAnchor = sceneImage
            ? uniqueRefs.filter((u: string) => u && u !== sceneImage)
            : uniqueRefs;
          if (refsMinusAnchor.length > 0) requestBodyBase.referenceImages = refsMinusAnchor.slice(0, 6);
        }

        const buildBaseCache = (base?: PreviewCacheV3 | null): PreviewCacheV3 =>
          base ??
          ({
            schemaVersion: 3,
            status: "idle",
            runs: [],
            activeRunId: null,
            selectedConceptIndex: null,
            viewMode: null,
            message: null,
            error: null,
            errorDetails: null,
            refinementNote: null,
            runStartedAt: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastContextSignature: signatureAtStart,
            generatedForContextSignature: null,
            lastGeneratedAnsweredCount: null,
          } satisfies PreviewCacheV3);

        const writeRunState = (params: {
          status: PreviewCacheV3["status"];
          images?: string[];
          appendImages?: boolean;
          message?: string | null;
          imagePricing?: (CachedPricing | undefined)[];
          imagePricingOffset?: number;
          generated?: boolean;
        }) => {
          setCache((prev) => {
            const base = buildBaseCache(prev ?? loadCache(instanceId, sessionId));
            const nextRuns = Array.isArray(base.runs) ? [...base.runs] : [];
            const existingIndex = nextRuns.findIndex((r) => r.id === runId);
            const existingRun: PreviewRun =
              existingIndex >= 0
                ? nextRuns[existingIndex]
                : ({
                    id: runId,
                    createdAt: Date.now(),
                    contextSignature: generationSignatureAtStart,
                    answeredQuestionCount: Number.isFinite(answeredQuestionCount) ? answeredQuestionCount : null,
                    images: [],
                    expectedImageCount: numOutputs,
                    message: generationMessage,
                    stepDataSnapshot: pricingContextForNextRun.stepDataSnapshot,
                  } satisfies PreviewRun);
            const mergedImages =
              params.images && params.images.length > 0
                ? params.appendImages
                  ? mergeUniqueImageUrls(existingRun.images, params.images)
                  : params.images
                : existingRun.images;
            const mergedPricing = Array.isArray(existingRun.imagePricing) ? [...existingRun.imagePricing] : [];
            if (Array.isArray(params.imagePricing)) {
              const pricingOffset = Math.max(
                0,
                Number.isFinite(Number(params.imagePricingOffset)) ? Math.floor(Number(params.imagePricingOffset)) : 0
              );
              params.imagePricing.forEach((value, index) => {
                if (value) mergedPricing[pricingOffset + index] = value;
              });
            }
            const nextRun: PreviewRun = {
              ...existingRun,
              images: mergedImages,
              expectedImageCount: numOutputs,
              message: params.message ?? existingRun.message ?? generationMessage,
              stepDataSnapshot: existingRun.stepDataSnapshot ?? pricingContextForNextRun.stepDataSnapshot,
              ...(mergedPricing.some(Boolean) ? { imagePricing: mergedPricing } : {}),
            };
            if (existingIndex >= 0) nextRuns[existingIndex] = nextRun;
            else nextRuns.push(nextRun);

            const preserveViewMode = base.viewMode === "single" || base.viewMode === "gallery";
            const next: PreviewCacheV3 = {
              ...base,
              status: params.status,
              runs: nextRuns,
              activeRunId: runId,
              selectedConceptIndex: preserveViewMode && base.viewMode === "single" && numOutputs === 1 ? 0 : null,
              viewMode: numOutputs > 1 ? "gallery" : preserveViewMode ? base.viewMode : "single",
              message: params.message ?? nextRun.message ?? generationMessage,
              error: null,
              errorDetails: null,
              runStartedAt: params.status === "running" ? base.runStartedAt ?? Date.now() : null,
              updatedAt: Date.now(),
              lastContextSignature: signatureAtStart,
              generatedForContextSignature: params.generated ? generationSignatureAtStart : null,
              lastGeneratedAnsweredCount:
                params.generated && Number.isFinite(answeredQuestionCount) ? answeredQuestionCount : base.lastGeneratedAnsweredCount ?? null,
            };
            saveCache(instanceId, sessionId, next);
            return next;
          });
        };

        const fetchImageBatch = async (requestedOutputs: number, variantStartIndex: number, attemptIndex = 0) => {
          if (requestedOutputs <= 0) {
            return { images: [] as string[], message: generationMessage, imagePricing: [] as (CachedPricing | undefined)[] };
          }
          const requestBody: any = {
            ...requestBodyBase,
            numOutputs: requestedOutputs,
          };
          if (shouldGenerateConceptGallery) {
            requestBody.variationMode = "price_ladder_9";
            requestBody.variantStartIndex = variantStartIndex;
          }
          if (generationIndex !== undefined) requestBody.generationIndex = generationIndex + attemptIndex;
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            cache: "no-store",
            body: JSON.stringify(requestBody),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            const errorMessage =
              res.status === 413
                ? "That photo is too large to process. Try a smaller image (or retake the photo)."
                : typeof (json as any)?.error === "string"
                  ? (json as any).error
                  : `Failed (${res.status})`;
            const detailsRaw = (json as any)?.details;
            const normalizedDetails =
              typeof detailsRaw === "string" ? detailsRaw : detailsRaw && typeof detailsRaw === "object" ? safeJsonStringify(detailsRaw) : null;
            responseErrorDetails = normalizedDetails ? normalizedDetails.slice(0, 800) : null;
            const err = new Error(errorMessage) as Error & { details?: string | null };
            err.details = responseErrorDetails;
            throw err;
          }

          const imgs = Array.isArray((json as any)?.images) ? (json as any).images.filter((x: any) => typeof x === "string" && x) : [];
          if (imgs.length === 0) throw new Error("Preview generated, but no images were returned.");
          const normalizedImages = imgs.filter(isValidUrlLikeImage).filter((src: string) => !isPlaceholderPreviewImage(src));
          if (normalizedImages.length === 0) throw new Error("Preview generated, but only a placeholder image was returned.");
          const rawVariants = Array.isArray((json as any)?.variants) ? ((json as any).variants as any[]) : [];
          const pricingByImage = new Map<string, CachedPricing>();
          rawVariants.forEach((variant: any) => {
            const imageUrl = typeof variant?.imageUrl === "string" ? variant.imageUrl : null;
            const priceRange = normalizeNumericRange((variant as any)?.priceRange ?? (variant as any)?.price_range);
            if (!imageUrl || !priceRange || !isValidUrlLikeImage(imageUrl)) return;
            const currency =
              typeof variant?.priceRange?.currency === "string"
                ? String(variant.priceRange.currency).trim().toUpperCase()
                : typeof variant?.price_range?.currency === "string"
                  ? String(variant.price_range.currency).trim().toUpperCase()
                  : "USD";
            const budgetTier =
              typeof variant?.budgetTier === "string" ? String(variant.budgetTier).trim().toLowerCase() : undefined;
            const budgetTierRangesRaw = variant?.budgetTierRanges ?? variant?.budget_tier_ranges;
            const budgetTierRanges =
              budgetTierRangesRaw && typeof budgetTierRangesRaw === "object"
                ? Object.fromEntries(
                    Object.entries(budgetTierRangesRaw)
                      .map(([key, value]) => [key, normalizeNumericRange(value)])
                      .filter((entry): entry is [string, { low: number; high: number }] => Boolean(entry[1]))
                  )
                : undefined;
            pricingByImage.set(imageUrl, {
              totalMin: priceRange.low,
              totalMax: priceRange.high,
              currency,
              imagePriceRange: { low: priceRange.low, high: priceRange.high },
              ...(budgetTier ? { budgetTier } : {}),
              ...(budgetTierRanges && Object.keys(budgetTierRanges).length > 0 ? { budgetTierRanges } : {}),
              ...(typeof variant?.calibrationKey === "string" ? { calibrationKey: String(variant.calibrationKey) } : {}),
            });
          });
          return {
            images: normalizedImages,
            message:
              shouldGenerateConceptGallery || !hasExistingPreview
                ? generationMessage
                : typeof (json as any)?.message === "string"
                  ? String((json as any).message)
                  : generationMessage,
            imagePricing: normalizedImages.map((src: string) => pricingByImage.get(src)),
          };
        };

        const fetchImageBatchUntilFilled = async (requestedOutputs: number, variantStartIndex: number) => {
          if (requestedOutputs <= 0) {
            return { images: [] as string[], message: generationMessage, imagePricing: [] as (CachedPricing | undefined)[] };
          }
          let collected: string[] = [];
          let message = generationMessage;
          let attempts = 0;
          let nextVariantStartIndex = variantStartIndex;
          const pricingByImage = new Map<string, CachedPricing>();

          while (collected.length < requestedOutputs && attempts < 4) {
            const remaining = requestedOutputs - collected.length;
            const batch = await fetchImageBatch(remaining, nextVariantStartIndex, attempts);
            message = batch.message;
            batch.images.forEach((src: string, index: number) => {
              const pricing = batch.imagePricing?.[index];
              if (pricing && !pricingByImage.has(src)) pricingByImage.set(src, pricing);
            });
            const merged = mergeUniqueImageUrls(collected, batch.images);
            const gained = merged.length - collected.length;
            collected = merged;
            attempts += 1;
            nextVariantStartIndex = variantStartIndex + collected.length;
            if (gained <= 0) break;
          }

          return {
            images: collected,
            message,
            imagePricing: collected.map((src: string) => pricingByImage.get(src)),
          };
        };

        setActiveGenerationReason(reason);
        writeRunState({ status: "running", message: generationMessage });

        const firstBatch = await fetchImageBatchUntilFilled(initialBatchSize, 0);
        const remainingAfterFirstBatch = Math.max(0, numOutputs - firstBatch.images.length);
        writeRunState({
          status: remainingAfterFirstBatch > 0 ? "running" : "complete",
          images: firstBatch.images,
          appendImages: false,
          message: firstBatch.message,
          imagePricing: firstBatch.imagePricing,
          imagePricingOffset: 0,
          generated: remainingAfterFirstBatch === 0,
        });

        let initialImagePricing: (CachedPricing | undefined)[] | undefined;
        try {
          const pricedHero = firstBatch.images[0] ?? null;
          // Lead-gated flows fetch pricing once after capture; skip here to avoid duplicate slow upstream calls.
          if (pricedHero && !leadGateActive) {
            const priced = await requestAccuratePricing({
              answeredQA,
              askedStepIds,
              instanceContext,
              previewImageUrl: pricedHero,
              pricingScenario: pricingContextForNextRun.pricingScenario,
              baselineImageUrl: pricingContextForNextRun.baselineImageUrl,
              baselinePriceRange: pricingContextForNextRun.baselinePriceRange,
              changedRefinementKeys: pricingContextForNextRun.changedRefinementKeys,
              budgetRange: budgetForRequest,
            });
            initialImagePricing = firstBatch.images.map((_: string, index: number) => (index === 0 ? priced : undefined));
            if (currentHeroRef.current === null || currentHeroRef.current === hero) {
              heroForPricingRef.current = pricedHero;
              setAccuratePricing(priced);
              setAccuratePricingStatus("complete");
            }
          }
        } catch {
          if (currentHeroRef.current === hero) setAccuratePricingStatus("error");
        }

        if (initialImagePricing) {
          writeRunState({
            status: remainingAfterFirstBatch > 0 ? "running" : "complete",
            message: firstBatch.message,
            imagePricing: initialImagePricing,
            imagePricingOffset: 0,
            generated: remainingAfterFirstBatch === 0,
          });
        }

        if (remainingAfterFirstBatch > 0) {
          try {
            const deferredBatch = await fetchImageBatchUntilFilled(remainingAfterFirstBatch, firstBatch.images.length);
            writeRunState({
              status: "complete",
              images: deferredBatch.images,
              appendImages: true,
              message: deferredBatch.message,
              imagePricing: deferredBatch.imagePricing,
              imagePricingOffset: firstBatch.images.length,
              generated: true,
            });
          } catch {
            writeRunState({
              status: "complete",
              message: firstBatch.message,
              generated: true,
            });
          }
        }

        void refreshRegenAllowance();
      } catch (e) {
        pendingBudgetRefineRef.current = false;
        pendingBudgetTierShiftRef.current = false;
        const message = e instanceof Error ? e.message : "Failed to generate preview.";
        const details =
          e && typeof e === "object" && "details" in e && typeof (e as any).details === "string"
            ? String((e as any).details)
            : responseErrorDetails;
        setCache((prev) => {
          const base: PreviewCacheV3 =
            prev ??
            ({
              schemaVersion: 3,
              status: "idle",
              runs: [],
              activeRunId: null,
              selectedConceptIndex: null,
              message: null,
              error: null,
              errorDetails: null,
              refinementNote: null,
              runStartedAt: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              lastContextSignature: signatureAtStart,
              generatedForContextSignature: null,
              lastGeneratedAnsweredCount: null,
            } satisfies PreviewCacheV3);
          const nextRuns = (Array.isArray(base.runs) ? base.runs : []).filter((run) => run.id !== runId || run.images.length > 0);
          const nextActiveRunId = base.activeRunId === runId ? nextRuns.at(-1)?.id ?? null : base.activeRunId ?? nextRuns.at(-1)?.id ?? null;
          const next: PreviewCacheV3 = {
            ...base,
            status: "error",
            runs: nextRuns,
            activeRunId: nextActiveRunId,
            error: message,
            errorDetails: details || null,
            runStartedAt: null,
            updatedAt: Date.now(),
            lastContextSignature: signatureAtStart,
            generatedForContextSignature: null,
          };
          saveCache(instanceId, sessionId, next);
          return next;
        });
      } finally {
        setActiveGenerationReason(null);
        pendingBudgetTierShiftRef.current = false;
        inFlightRef.current = false;
      }
    },
    [
      answeredQuestionCount,
      cacheGeneratedForContextSignature,
      conceptGalleryTargetCount,
      config,
      currentHeroRef,
      derivePricingContextForPreview,
      effectiveStepDataSoFar,
      enabled,
      hero,
      heroForPricingRef,
      instanceId,
      leadGateActive,
      pendingBudgetRefineRef,
      pendingBudgetTierShiftRef,
      refreshRegenAllowance,
      requestAccuratePricing,
      runs,
      sessionId,
      setAccuratePricing,
      setAccuratePricingStatus,
      setCache,
      uploadedImages,
    ]
  );

  const requestManualGenerate = useCallback(() => {
    if (!enabled) return;
    if (inFlightRef.current || cacheStatus === "running") {
      pendingManualGenerateRef.current = true;
      return;
    }
    void runGenerate("manual");
  }, [cacheStatus, enabled, runGenerate]);

  const uploadReferenceImage = useCallback(
    async (dataUrl: string): Promise<string> => {
      if (!dataUrl) return dataUrl;
      try {
        const res = await fetch("/api/upload-reference-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, image: dataUrl }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data?.url) return absolutizeImageUrl(String(data.url));
        }
      } catch {}
      return dataUrl;
    },
    [instanceId]
  );

  const handleOwnImageUpload = useCallback(
    async (files: File[]) => {
      const existing = loadUploadedImages(instanceId, sessionId);
      const remaining = Math.max(0, 6 - existing.length);
      const toProcess = files
        .filter((f) => f && typeof f.type === "string" && f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024)
        .slice(0, remaining);
      if (toProcess.length === 0) return;

      setIsUploadingOwnImages(true);
      try {
        const added: string[] = [];
        for (const file of toProcess) {
          const dataUrl = await readFileAsDataURL(file);
          const url = await uploadReferenceImage(dataUrl);
          if (isValidUrlLikeImage(url)) added.push(url);
        }
        if (added.length) {
          const next = Array.from(new Set([...added, ...existing])).slice(0, 6);
          saveUploadedImages(instanceId, sessionId, next);
          setUploadedImages(next);
        }
      } finally {
        setIsUploadingOwnImages(false);
      }

      requestManualGenerate();
    },
    [instanceId, requestManualGenerate, sessionId, setUploadedImages, uploadReferenceImage]
  );

  useEffect(() => {
    if (!enabled) return;
    if ((runs.length || 0) > 0) return;
    if (cacheStatus === "running") return;
    if (cacheStatus === "error") return;
    void runGenerate("auto");
  }, [cacheStatus, enabled, runGenerate, runs.length]);

  useEffect(() => {
    if (autoGenerationCounterScopeRef.current === autoGenerationCounterScope) return;
    autoGenerationCounterScopeRef.current = autoGenerationCounterScope;
    lastAutoRegenAtRef.current = 0;
    setCache((prev) => {
      if (!prev) return prev;
      const next: PreviewCacheV3 = {
        ...prev,
        lastGeneratedAnsweredCount: null,
        updatedAt: Date.now(),
      };
      saveCache(instanceId, sessionId, next);
      return next;
    });
  }, [autoGenerationCounterScope, instanceId, sessionId, setCache]);

  useEffect(() => {
    if (autoGenerationCounterScope !== "refinement") return;
    const last = cacheLastGeneratedAnsweredCount;
    if (typeof last !== "number" || !Number.isFinite(last)) return;
    if (!Number.isFinite(answeredQuestionCount) || answeredQuestionCount > last) return;
    if (answeredQuestionCount === last) return;
    setCache((prev) => {
      if (!prev) return prev;
      const next: PreviewCacheV3 = {
        ...prev,
        lastGeneratedAnsweredCount: null,
        updatedAt: Date.now(),
      };
      saveCache(instanceId, sessionId, next);
      return next;
    });
  }, [answeredQuestionCount, autoGenerationCounterScope, cacheLastGeneratedAnsweredCount, instanceId, sessionId, setCache]);

  useEffect(() => {
    const AUTO_REGEN_COOLDOWN_MS = 1_000;
    if (!enabled) return;
    if (!Number.isFinite(autoRegenerateEveryNAnsweredQuestions) || autoRegenerateEveryNAnsweredQuestions <= 0) return;
    if (cacheStatus === "running") return;
    if (cacheStatus === "error") return;
    if (!Number.isFinite(answeredQuestionCount) || answeredQuestionCount <= 0) return;

    const now = Date.now();
    if (lastAutoRegenAtRef.current > 0 && now - lastAutoRegenAtRef.current < AUTO_REGEN_COOLDOWN_MS) return;

    const last = cacheLastGeneratedAnsweredCount ?? runs.at(-1)?.answeredQuestionCount ?? null;
    if (typeof last !== "number" || !Number.isFinite(last)) {
      if (answeredQuestionCount >= autoRegenerateEveryNAnsweredQuestions) {
        lastAutoRegenAtRef.current = now;
        void runGenerate("auto");
      }
      return;
    }
    if (answeredQuestionCount >= last + autoRegenerateEveryNAnsweredQuestions) {
      if (leadGateActive) return;
      lastAutoRegenAtRef.current = now;
      void runGenerate("auto");
    }
  }, [
    answeredQuestionCount,
    autoRegenerateEveryNAnsweredQuestions,
    cacheLastGeneratedAnsweredCount,
    cacheStatus,
    enabled,
    leadGateActive,
    runGenerate,
    runs,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!hero) return;
    const rawNonce = (effectiveStepDataSoFar as any)?.__promptSubmitNonce;
    const nonce = typeof rawNonce === "number" ? rawNonce : Number(rawNonce);
    if (!Number.isFinite(nonce) || nonce <= 0) return;
    if (!promptSubmitNonceInitializedRef.current) {
      promptSubmitNonceInitializedRef.current = true;
      promptSubmitNonceRef.current = nonce;
      return;
    }
    if (nonce <= promptSubmitNonceRef.current) return;
    promptSubmitNonceRef.current = nonce;
    if (cacheStatus === "error") return;
    requestManualGenerate();
  }, [cacheStatus, effectiveStepDataSoFar, enabled, hero, requestManualGenerate]);

  useEffect(() => {
    if (!enabled) return;
    const rawNonce = (effectiveStepDataSoFar as any)?.__previewRefreshNonce;
    const nonce = typeof rawNonce === "number" ? rawNonce : Number(rawNonce);
    if (!Number.isFinite(nonce) || nonce <= 0) return;
    if (nonce <= previewRefreshNonceRef.current) return;
    previewRefreshNonceRef.current = nonce;
    if ((runs.length || 0) === 0 && !hero) return;
    requestManualGenerate();
  }, [effectiveStepDataSoFar, enabled, hero, requestManualGenerate, runs.length]);

  useEffect(() => {
    if (!enabled) return;
    if (!pendingManualGenerateRef.current) return;
    if (inFlightRef.current) return;
    if (cacheStatus === "running") return;
    pendingManualGenerateRef.current = false;
    void runGenerate("manual");
  }, [cacheStatus, enabled, runGenerate]);

  return {
    activeGenerationReason,
    handleOwnImageUpload,
    isUploadingOwnImages,
    requestManualGenerate,
    runGenerate,
  };
}
