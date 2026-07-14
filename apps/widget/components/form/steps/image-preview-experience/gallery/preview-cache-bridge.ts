"use client";

export const PREVIEW_CACHE_UPDATED_EVENT = "sif_preview_cache_updated";

/** Dispatched from the question toolbar (e.g. idea chips) to open the preview lead flow. */
export const OPEN_DESIGN_ESTIMATE_GATE_EVENT = "sif_open_design_estimate_gate";

export type OpenDesignEstimateGateDetail = {
  sessionId: string;
  /** When true, open the full-screen centered modal on the preview (same as Try again / Download). */
  centered?: boolean;
};

export type PreviewPriceSnapshot = {
  totalMin: number;
  totalMax: number;
  currency?: string;
};

export type PreviewRunSnapshot = {
  id: string;
  createdAt?: number | null;
  images: string[];
  expectedImageCount?: number | null;
  imagePricing?: Array<PreviewPriceSnapshot | undefined>;
};

export type PreviewCacheSnapshot = {
  status?: "idle" | "running" | "complete" | "error";
  runs: PreviewRunSnapshot[];
  activeRunId?: string | null;
  selectedConceptIndex?: number | null;
  viewMode?: "gallery" | "single" | null;
  message?: string | null;
  error?: string | null;
  updatedAt?: number | null;
};

function storageKeyV3(instanceId: string, sessionId: string) {
  return `ai_form_image_preview:v3:${instanceId}:${sessionId}`;
}

export function readPreviewCacheSnapshot(instanceId: string, sessionId: string): PreviewCacheSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKeyV3(instanceId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).runs)) return null;
    return parsed as PreviewCacheSnapshot;
  } catch {
    return null;
  }
}

export function getActivePreviewRunSnapshot(cache: PreviewCacheSnapshot | null | undefined): PreviewRunSnapshot | null {
  if (!cache || !Array.isArray(cache.runs) || cache.runs.length === 0) return null;
  const activeRunId = typeof cache.activeRunId === "string" ? cache.activeRunId : null;
  if (activeRunId) {
    const found = cache.runs.find((run) => run && run.id === activeRunId);
    if (found) return found;
  }
  return cache.runs[cache.runs.length - 1] ?? null;
}

export function notifyPreviewCacheUpdated(
  instanceId: string,
  sessionId: string,
  cache: PreviewCacheSnapshot | null | undefined
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PREVIEW_CACHE_UPDATED_EVENT, {
      detail: { instanceId, sessionId, cache: cache ?? null },
    })
  );
}

export function updatePreviewCacheSnapshot(
  instanceId: string,
  sessionId: string,
  updater: (cache: PreviewCacheSnapshot | null) => PreviewCacheSnapshot | null
) {
  if (typeof window === "undefined") return null;
  const next = updater(readPreviewCacheSnapshot(instanceId, sessionId));
  if (!next) return null;
  try {
    window.localStorage.setItem(storageKeyV3(instanceId, sessionId), JSON.stringify(next));
  } catch {}
  notifyPreviewCacheUpdated(instanceId, sessionId, next);
  return next;
}

/**
 * Remove a generation run without changing the form session. Studio V1 uses
 * this when an answer that shaped the concepts is edited, so an old concept
 * can never be mistaken for a result of the new direction.
 */
export function clearPreviewCacheSnapshot(instanceId: string, sessionId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKeyV3(instanceId, sessionId));
  } catch {}
  notifyPreviewCacheUpdated(instanceId, sessionId, null);
}
