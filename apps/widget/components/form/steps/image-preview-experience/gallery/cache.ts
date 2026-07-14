"use client";

import { notifyPreviewCacheUpdated } from "./preview-cache-bridge";
import type { CachedPricing, ConceptPresentation, PreviewCacheV2, PreviewCacheV3, PreviewRun } from "./types";
import { isPlaceholderPreviewImage, isValidUrlLikeImage } from "./utils/images";
import { normalizeNumericRange } from "./utils/pricing";

function storageKeyV1(instanceId: string, sessionId: string) {
  return `ai_form_image_preview:v1:${instanceId}:${sessionId}`;
}

function storageKeyV2(instanceId: string, sessionId: string) {
  return `ai_form_image_preview:v2:${instanceId}:${sessionId}`;
}

function storageKeyV3(instanceId: string, sessionId: string) {
  return `ai_form_image_preview:v3:${instanceId}:${sessionId}`;
}

function storageKeyUploads(instanceId: string, sessionId: string) {
  return `ai_form_image_preview:uploads:v1:${instanceId}:${sessionId}`;
}

export function newRunId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadCache(instanceId: string, sessionId: string): PreviewCacheV3 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(storageKeyV3(instanceId, sessionId)) ??
      window.localStorage.getItem(storageKeyV2(instanceId, sessionId)) ??
      window.localStorage.getItem(storageKeyV1(instanceId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    if ((parsed as any).schemaVersion === 3) {
      const base = parsed as PreviewCacheV3;
      const runs = Array.isArray(base.runs) ? base.runs : [];
      const normalizedRuns = runs
        .filter((r) => r && typeof r === "object")
        .map((r) => {
          const imgs = Array.isArray((r as any).images)
            ? (r as any).images.filter(isValidUrlLikeImage).filter((src: string) => !isPlaceholderPreviewImage(src))
            : [];
          const rawPricing = Array.isArray((r as any).imagePricing) ? (r as any).imagePricing : [];
          const rawConceptPresentations = Array.isArray((r as any).conceptPresentations)
            ? (r as any).conceptPresentations
            : [];
          const imagePricing: (CachedPricing | undefined)[] = imgs.map((_: string, i: number) => {
            const p = rawPricing[i];
            if (!p || typeof p !== "object" || !Number.isFinite(p.totalMin) || !Number.isFinite(p.totalMax)) {
              return undefined;
            }
            return {
              totalMin: Number(p.totalMin),
              totalMax: Number(p.totalMax),
              currency: typeof p.currency === "string" ? p.currency : "USD",
              imagePriceRange:
                typeof p.imagePriceRange === "object" &&
                p.imagePriceRange !== null &&
                Number.isFinite(p.imagePriceRange.low) &&
                Number.isFinite(p.imagePriceRange.high)
                  ? { low: p.imagePriceRange.low, high: p.imagePriceRange.high }
                  : undefined,
              servicePriceRange:
                typeof p.servicePriceRange === "object" &&
                p.servicePriceRange !== null &&
                Number.isFinite(p.servicePriceRange.low) &&
                Number.isFinite(p.servicePriceRange.high)
                  ? { low: p.servicePriceRange.low, high: p.servicePriceRange.high }
                  : undefined,
              baselinePriceRange:
                typeof p.baselinePriceRange === "object" &&
                p.baselinePriceRange !== null &&
                Number.isFinite(p.baselinePriceRange.low) &&
                Number.isFinite(p.baselinePriceRange.high)
                  ? { low: p.baselinePriceRange.low, high: p.baselinePriceRange.high }
                  : undefined,
              deltaPriceRange:
                typeof p.deltaPriceRange === "object" &&
                p.deltaPriceRange !== null &&
                Number.isFinite(p.deltaPriceRange.low) &&
                Number.isFinite(p.deltaPriceRange.high)
                  ? { low: p.deltaPriceRange.low, high: p.deltaPriceRange.high }
                  : undefined,
              deltaDirection:
                p.deltaDirection === "up" || p.deltaDirection === "down" || p.deltaDirection === "flat"
                  ? p.deltaDirection
                  : undefined,
              budgetTier: typeof p.budgetTier === "string" ? p.budgetTier : undefined,
              budgetTierRanges:
                typeof p.budgetTierRanges === "object" && p.budgetTierRanges !== null
                  ? Object.fromEntries(
                      Object.entries(p.budgetTierRanges)
                        .map(([key, value]) => [key, normalizeNumericRange(value)])
                        .filter((entry): entry is [string, { low: number; high: number }] => Boolean(entry[1]))
                    )
                  : undefined,
              priceDrivers: Array.isArray(p.priceDrivers)
                ? p.priceDrivers
                    .map((driver: any) => ({
                      key: typeof driver?.key === "string" ? driver.key : "",
                      label: typeof driver?.label === "string" ? driver.label : typeof driver?.key === "string" ? driver.key : "",
                    }))
                    .filter((driver: { key: string; label: string }) => Boolean(driver.key))
                : undefined,
              calibrationKey: typeof p.calibrationKey === "string" ? p.calibrationKey : undefined,
            };
          });
          const conceptPresentations: (ConceptPresentation | undefined)[] = imgs.map((_: string, i: number) => {
            const rawPresentation = rawConceptPresentations[i];
            if (!rawPresentation || typeof rawPresentation !== "object") return undefined;
            const title =
              typeof rawPresentation.title === "string"
                ? rawPresentation.title.trim()
                : typeof rawPresentation.label === "string"
                  ? rawPresentation.label.trim()
                  : "";
            if (!title) return undefined;
            const id =
              typeof rawPresentation.id === "string"
                ? rawPresentation.id.trim()
                : typeof rawPresentation.slotId === "string"
                  ? rawPresentation.slotId.trim()
                  : "";
            const summary = typeof rawPresentation.summary === "string" ? rawPresentation.summary.trim() : "";
            return {
              ...(id ? { id } : {}),
              title,
              ...(summary ? { summary } : {}),
            };
          });
          return {
            id: typeof (r as any).id === "string" ? (r as any).id : newRunId(),
            createdAt: Number((r as any).createdAt) || Date.now(),
            contextSignature: typeof (r as any).contextSignature === "string" ? (r as any).contextSignature : "",
            answeredQuestionCount:
              typeof (r as any).answeredQuestionCount === "number" && Number.isFinite((r as any).answeredQuestionCount)
                ? (r as any).answeredQuestionCount
                : null,
            images: imgs,
            expectedImageCount:
              typeof (r as any).expectedImageCount === "number" && Number.isFinite((r as any).expectedImageCount)
                ? Math.max(1, Math.floor((r as any).expectedImageCount))
                : null,
            message: typeof (r as any).message === "string" ? (r as any).message : null,
            stepDataSnapshot:
              typeof (r as any).stepDataSnapshot === "object" && (r as any).stepDataSnapshot !== null
                ? ((r as any).stepDataSnapshot as Record<string, any>)
                : undefined,
            ...(imagePricing.some(Boolean) ? { imagePricing } : {}),
            ...(conceptPresentations.some(Boolean) ? { conceptPresentations } : {}),
          };
        })
        .filter((r) => Boolean(r.images?.length));

      const activeRunId = typeof base.activeRunId === "string" ? base.activeRunId : null;
      const hasActive = activeRunId && normalizedRuns.some((r) => r.id === activeRunId);
      const nextActiveRunId = hasActive ? activeRunId : normalizedRuns.at(-1)?.id ?? null;
      const next: PreviewCacheV3 = {
        schemaVersion: 3,
        status: base.status === "running" ? "idle" : base.status,
        runs: normalizedRuns,
        activeRunId: nextActiveRunId,
        selectedConceptIndex:
          typeof (base as any).selectedConceptIndex === "number" && Number.isFinite((base as any).selectedConceptIndex)
            ? Math.max(0, Math.floor((base as any).selectedConceptIndex))
            : null,
        viewMode:
          (base as any).viewMode === "gallery" || (base as any).viewMode === "single"
            ? (base as any).viewMode
            : null,
        message: typeof base.message === "string" ? base.message : null,
        error: typeof base.error === "string" ? base.error : null,
        errorDetails: typeof (base as any).errorDetails === "string" ? (base as any).errorDetails : null,
        refinementNote: typeof base.refinementNote === "string" ? base.refinementNote : null,
        runStartedAt: null,
        createdAt: Number(base.createdAt) || Date.now(),
        updatedAt: Number(base.updatedAt) || Date.now(),
        lastContextSignature: typeof base.lastContextSignature === "string" ? base.lastContextSignature : null,
        generatedForContextSignature:
          typeof base.generatedForContextSignature === "string" ? base.generatedForContextSignature : null,
        lastGeneratedAnsweredCount:
          typeof base.lastGeneratedAnsweredCount === "number" && Number.isFinite(base.lastGeneratedAnsweredCount)
            ? base.lastGeneratedAnsweredCount
            : normalizedRuns.at(-1)?.answeredQuestionCount ?? null,
        overlayPricingCollapsed: Boolean((base as any).overlayPricingCollapsed),
      };
      return next;
    }

    if ((parsed as any).schemaVersion === 2) {
      const v2 = parsed as PreviewCacheV2;
      const imgs = Array.isArray(v2.images)
        ? v2.images.filter(isValidUrlLikeImage).filter((src: string) => !isPlaceholderPreviewImage(src))
        : [];
      const run: PreviewRun | null =
        imgs.length > 0 && typeof v2.generatedForContextSignature === "string" && v2.generatedForContextSignature
          ? {
              id: newRunId(),
              createdAt: Number(v2.createdAt) || Date.now(),
              contextSignature: v2.generatedForContextSignature,
              answeredQuestionCount: null,
              images: imgs,
              message: typeof v2.message === "string" ? v2.message : null,
            }
          : null;
      return {
        schemaVersion: 3,
        status: v2.status === "running" ? "idle" : v2.status,
        runs: run ? [run] : [],
        activeRunId: run ? run.id : null,
        selectedConceptIndex: null,
        viewMode: null,
        message: typeof v2.message === "string" ? v2.message : null,
        error: typeof v2.error === "string" ? v2.error : null,
        errorDetails: null,
        refinementNote: typeof v2.refinementNote === "string" ? v2.refinementNote : null,
        runStartedAt: null,
        createdAt: Number(v2.createdAt) || Date.now(),
        updatedAt: Date.now(),
        lastContextSignature: typeof v2.lastContextSignature === "string" ? v2.lastContextSignature : null,
        generatedForContextSignature:
          typeof v2.generatedForContextSignature === "string" ? v2.generatedForContextSignature : null,
        lastGeneratedAnsweredCount: null,
        overlayPricingCollapsed: false,
      };
    }

    if ((parsed as any).schemaVersion === 1) {
      return {
        schemaVersion: 3,
        status: "idle",
        runs: [],
        activeRunId: null,
        selectedConceptIndex: null,
        viewMode: null,
        message: null,
        error: null,
        errorDetails: null,
        refinementNote: (parsed as any)?.refinementNote ?? null,
        runStartedAt: null,
        createdAt: Number((parsed as any)?.createdAt) || Date.now(),
        updatedAt: Date.now(),
        lastContextSignature: null,
        generatedForContextSignature: null,
        lastGeneratedAnsweredCount: null,
        overlayPricingCollapsed: false,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function saveCache(instanceId: string, sessionId: string, cache: PreviewCacheV3) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyV3(instanceId, sessionId), JSON.stringify(cache));
    notifyPreviewCacheUpdated(instanceId, sessionId, cache as any);
  } catch {}
}

export function loadUploadedImages(instanceId: string, sessionId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKeyUploads(instanceId, sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidUrlLikeImage).slice(0, 6);
  } catch {
    return [];
  }
}

export function saveUploadedImages(instanceId: string, sessionId: string, images: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyUploads(instanceId, sessionId), JSON.stringify(images.filter(isValidUrlLikeImage).slice(0, 6)));
  } catch {}
}
