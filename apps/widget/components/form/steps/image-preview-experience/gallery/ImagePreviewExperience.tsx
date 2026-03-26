"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormTheme } from "../../../demo/FormThemeProvider";
import { cn } from "@/lib/utils";
import { buildAnsweredQAFromSteps, shouldExcludeStepFromAnsweredQA } from "@/lib/ai-form/answered-qa";
import { loadStepState } from "@/lib/ai-form/state/step-state";
import { loadFormStateContext } from "@/lib/ai-form/state/form-state-context";
import { loadServiceCatalog } from "@/lib/ai-form/state/service-catalog-storage";
import {
  formStateStorageKey,
  loadFormStateSnapshot,
  loadLeadState,
  upsertLeadGate,
  upsertLeadState,
  upsertFormStateSnapshot,
} from "@/lib/ai-form/state/form-state-storage";
import { buildPreviewPricingFromConfig } from "@/lib/ai-form/components/structural-steps";
import { detectCurrencyFromLocale, formatCurrency } from "@/lib/ai-form/utils/currency";
import { ArrowLeft, Download, Loader2, Mail, Maximize2, Phone } from "lucide-react";
import { AdventureLoader } from "@/components/form/AdventureLoader";
import { LeadGenPopover } from "@/components/form/steps/image-preview-experience/lead-gen/LeadGenPopover";
import { PRICING_LEAD_COPY, PRICING_LEAD_MODAL } from "@/components/form/steps/image-preview-experience/lead-gen/pricingLeadCopy";
import { isDevModeEnabled } from "@/lib/ai-form/dev-mode";
import { PricingExperience } from "../pricing/PricingExperience";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { safeStableJsonForPricingContext } from "../../runtime/step-engine/utils/pricing-context";
import { PRICING_ESTIMATE_KEY } from "../../runtime/step-engine/constants";
import { normalizePricingEstimate } from "../../runtime/step-engine/utils/pricing-estimate";
import { PREVIEW_CACHE_UPDATED_EVENT, notifyPreviewCacheUpdated } from "./preview-cache-bridge";

function hexToRgba(hex: string, alpha: number): string | null {
  const h = String(hex || "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Darken a hex color by mixing with black. mixBlack 0.5 = 50% black. */
function darkenHex(hex: string, mixBlack: number): string {
  const h = String(hex || "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return hex;
  const f = Math.max(0, Math.min(1, 1 - mixBlack));
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
}

function isValidEmail(value: string): boolean {
  const s = value.trim();
  if (!s || s.length < 5) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isValidFullName(value: string): boolean {
  return value.trim().length >= 2;
}

function formatPhoneInput(value: string): { display: string; digits: string } {
  const digits = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 10);
  if (digits.length <= 3) return { display: digits ? `(${digits}` : "", digits };
  if (digits.length <= 6) return { display: `(${digits.slice(0, 3)}) ${digits.slice(3)}`, digits };
  return { display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`, digits };
}

type PreviewCacheV2 = {
  schemaVersion: 2;
  status: "idle" | "running" | "complete" | "error";
  images: string[];
  message?: string | null;
  error?: string | null;
  refinementNote?: string | null;
  runStartedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  // Tracks the latest context signature we've seen (helps detect changes across reloads).
  lastContextSignature?: string | null;
  // Tracks the specific context signature the current `images` were generated for.
  generatedForContextSignature?: string | null;
};

/** Per-image pricing stored in cache so we don't refetch when toggling between images. */
type CachedPricing = {
  totalMin: number;
  totalMax: number;
  currency: string;
  imagePriceRange?: { low: number; high: number };
  servicePriceRange?: { low: number; high: number };
  baselinePriceRange?: { low: number; high: number };
  deltaPriceRange?: { low: number; high: number };
  deltaDirection?: "up" | "down" | "flat";
  budgetTier?: string;
  budgetTierRanges?: Record<string, { low: number; high: number }>;
  priceDrivers?: Array<{ key: string; label: string }>;
  calibrationKey?: string;
};

type PricingRequestInputs = {
  answeredQA: Array<{ stepId: string; question: string; answer: any }>;
  askedStepIds: string[];
  instanceContext: {
    businessContext?: any;
    serviceSummary?: string | null;
  };
  previewImageUrl?: string | null;
  pricingScenario?: "initial" | "comparison" | "refinement";
  baselineImageUrl?: string | null;
  baselinePriceRange?: { low: number; high: number } | null;
  changedRefinementKeys?: Array<{ key: string; label: string }>;
  budgetRange?: number | null;
};

type PreviewRun = {
  id: string;
  createdAt: number;
  contextSignature: string;
  answeredQuestionCount?: number | null;
  images: string[];
  expectedImageCount?: number | null;
  message?: string | null;
  stepDataSnapshot?: Record<string, any>;
  /** Per-image pricing: imagePricing[i] corresponds to images[i]. Fetched once, fixed to the image. */
  imagePricing?: (CachedPricing | undefined)[];
};

const CONCEPT_GALLERY_COUNT = 9;
const INITIAL_PROGRESSIVE_GRID_PLACEHOLDERS = 9;
const GALLERY_LOADING_TITLE = "Finding similar designs…";
const GALLERY_LOADING_SUBTITLE = "Pulling together examples and price ranges…";
const GALLERY_LOADING_MESSAGES = [
  GALLERY_LOADING_TITLE,
  "Checking pricing from similar examples…",
  GALLERY_LOADING_SUBTITLE,
  "Matching your request to similar past work…",
  "Looking for examples with a similar scope…",
  "Reviewing comparable work and price ranges…",
  "Pulling similar looks and pricing history…",
  "Almost there…",
] as const;

/** "gallery" = show concept grid; "single" = show chosen hero with option to go back */
type PreviewViewMode = "gallery" | "single";

type PreviewCacheV3 = {
  schemaVersion: 3;
  status: "idle" | "running" | "complete" | "error";
  runs: PreviewRun[];
  activeRunId?: string | null;
  /** When null and active run has multiple images, show concept picker. When set, hero = activeRun.images[selectedConceptIndex]. */
  selectedConceptIndex?: number | null;
  /** "gallery" = grid of 4 concepts; "single" = hero view with back-to-gallery toggle */
  viewMode?: PreviewViewMode | null;
  message?: string | null;
  error?: string | null;
  errorDetails?: string | null;
  refinementNote?: string | null;
  runStartedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  // Tracks the latest context signature we've seen (helps detect changes across reloads).
  lastContextSignature?: string | null;
  // Tracks the specific context signature the current run was generated for.
  generatedForContextSignature?: string | null;
  // Answer-count gating for auto-regeneration.
  lastGeneratedAnsweredCount?: number | null;
};

type NavigationTransition = {
  key: string;
  fromRunId: string;
  toRunId: string;
  fromImage: string;
  toImage: string;
  direction: -1 | 1;
};

type PreviewStackLayer = {
  key: string;
  src: string;
  kind: "transition" | "history";
};

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

function safeJsonStringify(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function computeContextSignature(stepDataSoFar: Record<string, any>) {
  const keys = Object.keys(stepDataSoFar || {})
    .filter((k) => typeof k === "string" && !k.startsWith("__"))
    .sort();
  const snapshot: Record<string, any> = {};
  for (const k of keys) snapshot[k] = stepDataSoFar[k];
  return safeJsonStringify(snapshot);
}

function mergeUniqueImageUrls(existing: string[], incoming: string[]) {
  return Array.from(
    new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].filter(Boolean))
  );
}

function buildPricingStepSnapshot(stepDataSoFar: Record<string, any>): Record<string, any> {
  try {
    const stable = safeStableJsonForPricingContext(stepDataSoFar || {});
    if (!stable) return {};
    const parsed = JSON.parse(stable);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractBudgetValue(stepData: Record<string, any>): number | null {
  const raw =
    (stepData as any)?.["step-budget-range"] ??
    (stepData as any)?.["budget_range"] ??
    (stepData as any)?.["budgetRange"] ??
    (stepData as any)?.["step-budget"];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeNumericRange(
  raw: any,
  opts?: { allowNegative?: boolean }
): { low: number; high: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const low = Number((raw as any).low ?? (raw as any).min);
  const high = Number((raw as any).high ?? (raw as any).max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
  if (!opts?.allowNegative && (low <= 0 || high <= 0)) return undefined;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function resolveBudgetTierFromRanges(
  ranges: Record<string, { low: number; high: number }> | undefined,
  budgetValue: number | null
): string | null {
  if (!ranges || !budgetValue || !Number.isFinite(budgetValue)) return null;
  for (const key of ["starter", "standard", "premium", "luxury"]) {
    const range = normalizeNumericRange(ranges[key]);
    if (!range) continue;
    if (budgetValue <= range.high) return key;
  }
  return "luxury";
}

function formatPricingRangeText(params: {
  pricing?: CachedPricing | null;
  locale?: string;
  currency?: string;
}): string | null {
  const pricing = params.pricing;
  if (!pricing) return null;
  const low = pricing.imagePriceRange?.low ?? pricing.totalMin;
  const high = pricing.imagePriceRange?.high ?? pricing.totalMax;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const currency = String(params.currency || pricing.currency || "USD").trim().toUpperCase() || "USD";
  return `${formatCurrency(Math.min(low, high), { locale: params.locale, currency })}-${formatCurrency(
    Math.max(low, high),
    { locale: params.locale, currency }
  )}`;
}

function pickHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return t;
  return null;
}

function readConfirmationScheduleUrlFromSteps(steps: any[] | undefined): string | null {
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    const id = String((step as any)?.id ?? (step as any)?.stepId ?? "").trim();
    if (id !== "step-confirmation") continue;
    const url = pickHttpUrl((step as any)?.data?.scheduleUrl);
    if (url) return url;
  }
  return null;
}

function splitPricingMaskSegments(rangeText: string | null): {
  prefix: string;
  blur: string;
} | null {
  if (!rangeText) return null;
  const raw = String(rangeText).trim();
  const m = raw.match(/^(\D*\d)(.*)$/);
  if (!m) return { prefix: raw, blur: "" };
  return { prefix: m[1], blur: m[2] || "" };
}

function isPricingComparableUseCase(raw?: string | null): boolean {
  const v = String(raw || "").trim().toLowerCase();
  return v === "scene" || v === "scene-placement" || v === "scene-refinement";
}

function valueForDiff(raw: any): string {
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function shouldTrackRefinementChange(key: string): boolean {
  const normalized = String(key || "").trim().toLowerCase();
  if (!normalized) return false;
  if (
    normalized.includes("budget") ||
    normalized.includes("service") ||
    normalized.includes("upload") ||
    normalized.includes("lead") ||
    normalized.includes("pricing") ||
    normalized.includes("location")
  ) {
    return false;
  }
  return true;
}

function buildChangedRefinementKeys(params: {
  currentSnapshot: Record<string, any>;
  previousSnapshot?: Record<string, any> | null;
  steps: any[];
}): Array<{ key: string; label: string }> {
  const { currentSnapshot, previousSnapshot, steps } = params;
  const labelByStepId = new Map<string, string>();
  for (const step of steps || []) {
    const stepId = String((step as any)?.id || "");
    if (!stepId) continue;
    const label =
      typeof (step as any)?.question === "string" && (step as any).question.trim()
        ? String((step as any).question).trim()
        : stepId;
    labelByStepId.set(stepId, label);
  }

  const out: Array<{ key: string; label: string }> = [];
  const prev = previousSnapshot && typeof previousSnapshot === "object" ? previousSnapshot : {};
  const keys = Array.from(new Set([...Object.keys(currentSnapshot || {}), ...Object.keys(prev || {})])).sort();
  for (const key of keys) {
    if (!shouldTrackRefinementChange(key)) continue;
    const currentValue = (currentSnapshot as any)?.[key];
    const previousValue = (prev as any)?.[key];
    if (currentValue === null || currentValue === undefined || valueForDiff(currentValue) === valueForDiff(previousValue)) continue;
    const label = labelByStepId.get(key) || key.replace(/^step-/, "").replace(/[-_]+/g, " ").trim();
    out.push({ key, label });
    if (out.length >= 8) break;
  }
  return out;
}

function isValidUrlLikeImage(src: any): src is string {
  if (typeof src !== "string") return false;
  if (!src) return false;
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:") || src.startsWith("/");
}

function absolutizeImageUrl(src: string): string {
  if (!src || typeof src !== "string") return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) return src;
  if (src.startsWith("/") && typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${src}`;
  }
  return src;
}

function decodeDataUrlText(dataUrl: string): string | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      if (typeof atob !== "function") return null;
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
      // Fallback: best-effort latin1 -> utf8-ish
      return binary;
    }
  } catch {}
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

function isPlaceholderPreviewImage(src: string): boolean {
  if (!src) return false;
  if (!src.startsWith("data:image/svg+xml")) return false;
  const decoded = decodeDataUrlText(src);
  if (!decoded) return true;
  return /placeholder|demo/i.test(decoded);
}

function newRunId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadCache(instanceId: string, sessionId: string): PreviewCacheV3 | null {
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
          const imagePricing: (CachedPricing | undefined)[] = imgs.map((_: string, i: number) => {
            const p = rawPricing[i];
            if (!p || typeof p !== "object" || !Number.isFinite(p.totalMin) || !Number.isFinite(p.totalMax))
              return undefined;
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
      };
    }

    if ((parsed as any).schemaVersion === 1) {
      // Migrate v1 → v3, but keep no images (v1 may contain placeholders).
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
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveCache(instanceId: string, sessionId: string, cache: PreviewCacheV3) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyV3(instanceId, sessionId), JSON.stringify(cache));
    notifyPreviewCacheUpdated(instanceId, sessionId, cache as any);
  } catch {}
}

function loadUploadedImages(instanceId: string, sessionId: string): string[] {
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

function saveUploadedImages(instanceId: string, sessionId: string, images: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyUploads(instanceId, sessionId), JSON.stringify(images.filter(isValidUrlLikeImage).slice(0, 6)));
  } catch {}
}

export function ImagePreviewExperience(props: {
  instanceId: string;
  sessionId: string;
  useCase?: string;
  contextState?: any;
  /** If false, never gate preview actions behind lead capture. Defaults to true. */
  leadGateEnabled?: boolean;
  /** When true, removes the card/surface background behind the preview. */
  transparentChrome?: boolean;
  /** Fires when a real preview image becomes available (hero exists). */
  onHasImageChange?: (hasImage: boolean) => void;
  config?: {
    businessContext?: string;
    industry?: string;
    useCase?: string;
    previewPricing?: { totalMin: number; totalMax: number; currency?: string; randomizePct?: number };
  };
  stepDataSoFar: Record<string, any>;
  answeredQuestionCount?: number;
  autoRegenerateEveryNAnsweredQuestions?: number;
  autoGenerationCounterScope?: string;
  onAutoGenerationBusyChange?: (busy: boolean) => void;
  enabled: boolean;
  onPreviewVisibleChange?: (visible: boolean) => void;
  variant?: "hero" | "rail" | "tiny";
  previewMaxVh?: number;
  previewMaxPx?: number;
  previewMaxVw?: number;
  previewChromePx?: number;
  /** When true, hides the "Upload your own image" overlay button on the preview image. */
  suppressUploadOverlay?: boolean;
  /** When false, suppress preview tool controls for priced-grid mode. */
  toolingEnabled?: boolean;
  /** When true, disable concept gallery picker and keep hero in single-image mode. */
  disableConceptPicker?: boolean;
  /** Optional hook to bring Guided controls into focus. */
  onKeepDesigning?: () => void;
}) {
  const { theme, config: designConfig } = useFormTheme();
  const {
    instanceId,
    sessionId,
    enabled,
    leadGateEnabled = true,
    transparentChrome = false,
    onHasImageChange,
    stepDataSoFar,
    answeredQuestionCount = 0,
    autoRegenerateEveryNAnsweredQuestions = 2,
    autoGenerationCounterScope = "base",
    onAutoGenerationBusyChange,
    config,
    onPreviewVisibleChange,
    variant = "hero",
    previewMaxVh,
    previewMaxPx,
    previewMaxVw,
    previewChromePx,
    suppressUploadOverlay = false,
    toolingEnabled = true,
    disableConceptPicker = false,
    onKeepDesigning,
  } = props;

  const initialCache = useMemo(() => loadCache(instanceId, sessionId), [instanceId, sessionId]);
  const [cache, setCache] = useState<PreviewCacheV3 | null>(initialCache);
  const [activeGenerationReason, setActiveGenerationReason] = useState<"auto" | "manual" | null>(null);
  const inFlightRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingOwnImages, setIsUploadingOwnImages] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>(() => loadUploadedImages(instanceId, sessionId));
  const [regenerationsRemaining, setRegenerationsRemaining] = useState<number>(0);

  const galleryMaxImages = useMemo(
    () =>
      Number.isFinite(Number((designConfig as any)?.gallery_max_images))
        ? Math.max(1, Math.min(12, Math.floor(Number((designConfig as any).gallery_max_images))))
        : CONCEPT_GALLERY_COUNT,
    [designConfig]
  );
  const conceptGalleryTargetCount = useMemo(
    // Initial scene gallery should always target eight concepts, even if an older
    // theme config still carries the previous 4-image default.
    () => Math.max(CONCEPT_GALLERY_COUNT, Math.min(12, Math.max(galleryMaxImages || CONCEPT_GALLERY_COUNT, CONCEPT_GALLERY_COUNT))),
    [galleryMaxImages]
  );

  const sceneUploadUrl = useMemo(() => {
    const sceneUploadStepIds = ["step-upload-scene-image", "step-refinement-upload-scene-image"] as const;
    for (const stepId of sceneUploadStepIds) {
      const raw = (stepDataSoFar as any)?.[stepId];
      const arr = Array.isArray(raw) ? raw : (typeof raw === "string" && raw ? [raw] : []);
      const hit = arr.find(isValidUrlLikeImage);
      if (hit) return hit;
    }
    return null;
  }, [stepDataSoFar]);
  const userUploadUrl = useMemo(() => {
    const raw = (stepDataSoFar as any)?.["step-upload-user-image"];
    const arr = Array.isArray(raw) ? raw : (typeof raw === "string" && raw ? [raw] : []);
    return arr.find(isValidUrlLikeImage) ?? null;
  }, [stepDataSoFar]);
  const nextGenerationOutputCount = useMemo(() => {
    const normalizedUseCase = String((config as any)?.useCase || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    if (
      normalizedUseCase === "tryon" ||
      normalizedUseCase === "scene-placement" ||
      normalizedUseCase === "scene-refinement"
    ) {
      return 1;
    }
    if (normalizedUseCase === "scene" && (cache?.runs?.length || 0) === 0) {
      return conceptGalleryTargetCount;
    }
    const hasDirectEditAnchor =
      Boolean(sceneUploadUrl || userUploadUrl) ||
      uploadedImages.length > 0 ||
      Boolean(cache?.runs?.length);
    if (hasDirectEditAnchor) {
      return 1;
    }
    return conceptGalleryTargetCount;
  }, [cache?.runs?.length, conceptGalleryTargetCount, config, sceneUploadUrl, uploadedImages.length, userUploadUrl]);
  const refreshRegenAllowance = useCallback(async () => {
    if (!instanceId) return;
    try {
      const required = Math.max(1, nextGenerationOutputCount);
      const res = await fetch(`/api/leads/availability/${encodeURIComponent(instanceId)}?required=${required}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const bal = typeof data?.currentBalance === "number" ? Number(data.currentBalance) : 0;
      setRegenerationsRemaining(Math.max(0, Math.floor(bal / required)));
    } catch {}
  }, [instanceId, nextGenerationOutputCount]);

  useEffect(() => {
    void refreshRegenAllowance();
  }, [refreshRegenAllowance]);
  // Image uploaded through the form's dedicated upload step — shown as a static thumbnail.
  const formStepUploadThumbnail = sceneUploadUrl ?? userUploadUrl ?? null;
  const [leadCaptured, setLeadCaptured] = useState<boolean>(() => loadLeadState(sessionId).leadCaptured);
  const [showCenteredPricingForm, setShowCenteredPricingForm] = useState(false);
  const [centeredPricingStep, setCenteredPricingStep] = useState<"email" | "name" | "phone">("email");
  const [centeredPricingEmail, setCenteredPricingEmail] = useState<string>(() => loadLeadState(sessionId).leadEmail || "");
  const [centeredPricingName, setCenteredPricingName] = useState<string>(() => {
    const snap = loadFormStateSnapshot(sessionId);
    return typeof (snap as any)?.userFullName === "string" ? String((snap as any).userFullName).trim() : "";
  });
  const [centeredPricingPhone, setCenteredPricingPhone] = useState<string>(() => {
    const prefillPhone = loadLeadState(sessionId).leadPhone || "";
    return formatPhoneInput(prefillPhone).display;
  });
  const [centeredPricingError, setCenteredPricingError] = useState<string | null>(null);
  const { submitForm: submitCenteredPricingLead, isSubmitting: isSubmittingCenteredPricingLead } = useFormSubmission({
    instanceId,
    sessionId,
  });
  const devMode = useMemo(() => isDevModeEnabled(), []);
  const debugSessionRef = useRef<string | null>(null);
  const debugLeadCapturedRef = useRef<boolean | null>(null);
  const [showUploadGate, setShowUploadGate] = useState(false);
  const [showDownloadGate, setShowDownloadGate] = useState(false);
  const [showGenerateGate, setShowGenerateGate] = useState(false);
  const [galleryLoadingMessageIndex, setGalleryLoadingMessageIndex] = useState(0);
  const pendingActionRef = useRef<null | "refresh" | "upload" | "download">(null);
  const pendingGenerateModeRef = useRef<"manual" | "auto">("manual");
  const gateContextRef = useRef<string>("design_and_estimate");
  const promptSubmitNonceRef = useRef<number>(0);
  const promptSubmitNonceInitializedRef = useRef(false);
  const autoGenerationCounterScopeRef = useRef<string>(autoGenerationCounterScope);
  const previewRefreshNonceRef = useRef<number>(0);
  const pendingManualGenerateRef = useRef(false);
  const pendingBudgetRefineRef = useRef(false);
  const pendingBudgetTierShiftRef = useRef(false);
  const prevBudgetForPricingRef = useRef<number | null>(null);
  const prevRunsLengthRef = useRef(0);
  const lastAutoRegenAtRef = useRef<number>(0);
  const heroForPricingRef = useRef<string | null>(null);
  const skipNextFetchRef = useRef(false);
  const currentHeroRef = useRef<string | null>(null);
  const fetchAccuratePricingRef = useRef<(() => Promise<void>) | null>(null);
  const [accuratePricing, setAccuratePricing] = useState<null | CachedPricing>(null);
  const [accuratePricingStatus, setAccuratePricingStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [liveBudget, setLiveBudget] = useState<number | null>(() => extractBudgetValue(stepDataSoFar || {}));
  const [liveBudgetDirty, setLiveBudgetDirty] = useState(false);

  useEffect(() => {
    const handleCacheUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId?: string; sessionId?: string; cache?: PreviewCacheV3 | null }>).detail;
      if (!detail) return;
      if (detail.instanceId !== instanceId || detail.sessionId !== sessionId) return;
      setCache(detail.cache ?? loadCache(instanceId, sessionId));
    };
    window.addEventListener(PREVIEW_CACHE_UPDATED_EVENT, handleCacheUpdate as EventListener);
    return () => window.removeEventListener(PREVIEW_CACHE_UPDATED_EVENT, handleCacheUpdate as EventListener);
  }, [instanceId, sessionId]);

  useEffect(() => {
    setUploadedImages(loadUploadedImages(instanceId, sessionId));
  }, [instanceId, sessionId]);

  useEffect(() => {
    const lead = loadLeadState(sessionId);
    const snap = loadFormStateSnapshot(sessionId);
    setLeadCaptured(lead.leadCaptured);
    setCenteredPricingEmail(lead.leadEmail || "");
    setCenteredPricingName(typeof (snap as any)?.userFullName === "string" ? String((snap as any).userFullName).trim() : "");
    setCenteredPricingPhone(formatPhoneInput(lead.leadPhone || "").display);
    setCenteredPricingStep("email");
    setCenteredPricingError(null);
    setShowCenteredPricingForm(false);
  }, [sessionId]);

  useEffect(() => {
    if (!devMode) return;
    if (!sessionId || debugSessionRef.current === sessionId) return;
    debugSessionRef.current = sessionId;
    try {
      const parsed = loadFormStateSnapshot(sessionId);
      console.log("[ImagePreviewExperience] lead state (session)", {
        instanceId,
        sessionId,
        leadGateEnabled,
        leadCaptured: loadLeadState(sessionId).leadCaptured,
        formState: parsed
          ? {
              leadCaptured: (parsed as any)?.leadCaptured,
              leadEmail: (parsed as any)?.leadEmail,
              leadCapturedAt: (parsed as any)?.leadCapturedAt,
              leadGates: (parsed as any)?.leadGates ? Object.keys((parsed as any).leadGates) : null,
              storageKey: formStateStorageKey(sessionId),
            }
          : null,
      });
    } catch {}
  }, [devMode, instanceId, leadGateEnabled, sessionId]);

  useEffect(() => {
    if (!devMode) return;
    if (debugLeadCapturedRef.current === leadCaptured) return;
    debugLeadCapturedRef.current = leadCaptured;
    try {
      console.log("[ImagePreviewExperience] leadCaptured changed", { instanceId, sessionId, leadCaptured });
    } catch {}
  }, [devMode, instanceId, leadCaptured, sessionId]);

  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const detail = (e as any)?.detail;
        if (!detail || detail.sessionId !== sessionId) return;
        setLeadCaptured(loadLeadState(sessionId).leadCaptured);
      } catch {}
    };
    window.addEventListener("sif_form_state_updated", handler as any);
    return () => window.removeEventListener("sif_form_state_updated", handler as any);
  }, [sessionId]);

  useEffect(() => {
    const next = extractBudgetValue(stepDataSoFar || {});
    if (next !== null) setLiveBudget(next);
  }, [stepDataSoFar]);

  const handleCenteredPricingEmailSubmit = useCallback(async () => {
    setCenteredPricingError(null);
    const email = centeredPricingEmail.trim();
    if (!isValidEmail(email)) {
      setCenteredPricingError("Please enter a valid email address.");
      return;
    }
    setCenteredPricingStep("name");
  }, [centeredPricingEmail]);

  const handleCenteredPricingNameSubmit = useCallback(async () => {
    setCenteredPricingError(null);
    const name = centeredPricingName.trim();
    if (!isValidFullName(name)) {
      setCenteredPricingError("Please enter your name.");
      return;
    }
    if (sessionId) upsertFormStateSnapshot(sessionId, { userFullName: name });
    setCenteredPricingStep("phone");
  }, [centeredPricingName, sessionId]);

  const handleCenteredPricingPhoneSubmit = useCallback(async () => {
    setCenteredPricingError(null);
    const email = centeredPricingEmail.trim();
    const name = centeredPricingName.trim();
    const { display: formattedPhone, digits } = formatPhoneInput(centeredPricingPhone);

    if (!isValidEmail(email)) {
      setCenteredPricingStep("email");
      setCenteredPricingError("Please enter a valid email address.");
      return;
    }
    if (!isValidFullName(name)) {
      setCenteredPricingStep("name");
      setCenteredPricingError("Please enter your name.");
      return;
    }
    if (digits.length < 10) {
      setCenteredPricingError("Enter a valid phone number.");
      return;
    }

    const result = await submitCenteredPricingLead({
      email,
      name,
      phone: formattedPhone,
      isPartial: false,
      submissionData: { gateContext: "design_and_estimate", surface: "inline_pricing", step: "phone" },
    });

    if (!result.success) {
      setCenteredPricingError(result.message || "Couldn’t submit. Try again.");
      return;
    }

    if (sessionId) upsertFormStateSnapshot(sessionId, { userFullName: name });
    upsertLeadState(sessionId, {
      leadCaptured: true,
      leadEmail: email,
      leadPhone: formattedPhone,
      leadCapturedAt: Date.now(),
    });
    upsertLeadGate(sessionId, "design_and_estimate", { completedAt: Date.now() });
    setAccuratePricingStatus("running");
    setLeadCaptured(true);
    setShowCenteredPricingForm(false);
    setCenteredPricingStep("email");
    void fetchAccuratePricingRef.current?.();
  }, [centeredPricingEmail, centeredPricingName, centeredPricingPhone, sessionId, submitCenteredPricingLead]);

  const effectiveStepDataSoFar = useMemo(() => {
    const base = { ...(stepDataSoFar || {}) };
    if (liveBudget !== null && Number.isFinite(liveBudget) && liveBudget > 0) {
      base["step-budget-range"] = Math.round(liveBudget);
      base["budget_range"] = Math.round(liveBudget);
      base["budgetRange"] = Math.round(liveBudget);
    }
    return base;
  }, [liveBudget, stepDataSoFar]);
  // Shared service+scope pricing seed. This shapes the gallery/budget defaults before
  // we ever run the exact hero-image pricing pass.
  const pricingSeed = useMemo(
    () => normalizePricingEstimate((stepDataSoFar as any)?.[PRICING_ESTIMATE_KEY]),
    [stepDataSoFar]
  );

  const requestAccuratePricing = useCallback(
    async ({
      answeredQA,
      askedStepIds,
      instanceContext,
      previewImageUrl,
      pricingScenario,
      baselineImageUrl,
      baselinePriceRange,
      changedRefinementKeys,
      budgetRange,
    }: PricingRequestInputs): Promise<CachedPricing> => {
      const res = await fetch(`/api/ai-form/${encodeURIComponent(instanceId)}/pricing`, {
        method: "POST",
        headers: { "content-type": "application/json", Accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          sessionId,
          useCase: (config as any)?.useCase,
          stepDataSoFar: effectiveStepDataSoFar,
          answeredQA,
          askedStepIds,
          instanceContext,
          noCache: true,
          ...(pricingScenario ? { pricingScenario } : {}),
          ...(previewImageUrl && (previewImageUrl.startsWith("http://") || previewImageUrl.startsWith("https://"))
            ? { previewImageUrl }
            : {}),
          ...(baselineImageUrl && (baselineImageUrl.startsWith("http://") || baselineImageUrl.startsWith("https://"))
            ? { baselineImageUrl }
            : {}),
          ...(baselinePriceRange ? { baselinePriceRange } : {}),
          ...(Array.isArray(changedRefinementKeys) && changedRefinementKeys.length > 0 ? { changedRefinementKeys } : {}),
          ...(budgetRange !== null && budgetRange !== undefined && Number.isFinite(Number(budgetRange))
            ? { budgetRange: Number(budgetRange) }
            : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message = typeof (json as any)?.error === "string" ? String((json as any).error) : `Pricing failed (${res.status})`;
        throw new Error(message);
      }
      const est = (json as any)?.estimate ?? json;
      const totalMin = Number((est as any)?.totalMin);
      const totalMax = Number((est as any)?.totalMax);
      const currencyRaw = typeof (est as any)?.currency === "string" ? String((est as any).currency).trim().toUpperCase() : "USD";
      if (!Number.isFinite(totalMin) || !Number.isFinite(totalMax)) {
        throw new Error("Pricing returned invalid numbers");
      }
      const svcRange = (est as any)?.servicePriceRange ?? (est as any)?.service_price_range;
      const servicePriceRange =
        typeof svcRange === "object" &&
        svcRange !== null &&
        typeof svcRange.low === "number" &&
        typeof svcRange.high === "number"
          ? { low: Math.min(svcRange.low, svcRange.high), high: Math.max(svcRange.low, svcRange.high) }
          : undefined;
      const imgRange = (est as any)?.imagePriceRange ?? (est as any)?.image_price_range;
      const imagePriceRange =
        typeof imgRange === "object" &&
        imgRange !== null &&
        typeof imgRange.low === "number" &&
        typeof imgRange.high === "number"
          ? { low: Math.min(imgRange.low, imgRange.high), high: Math.max(imgRange.low, imgRange.high) }
          : { low: Math.min(totalMin, totalMax), high: Math.max(totalMin, totalMax) };
      const baselineRange = normalizeNumericRange((est as any)?.baselinePriceRange ?? (est as any)?.baseline_price_range);
      const deltaRange = normalizeNumericRange((est as any)?.deltaPriceRange ?? (est as any)?.delta_price_range, {
        allowNegative: true,
      });
      const budgetTier =
        typeof (est as any)?.budgetTier === "string" ? String((est as any).budgetTier).trim().toLowerCase() : undefined;
      const budgetTierRangesRaw = (est as any)?.budgetTierRanges ?? (est as any)?.budget_tier_ranges;
      const budgetTierRanges =
        budgetTierRangesRaw && typeof budgetTierRangesRaw === "object"
          ? Object.fromEntries(
              Object.entries(budgetTierRangesRaw)
                .map(([key, value]) => [key, normalizeNumericRange(value)])
                .filter((entry): entry is [string, { low: number; high: number }] => Boolean(entry[1]))
            )
          : undefined;
      const rawDrivers = Array.isArray((est as any)?.priceDrivers ?? (est as any)?.price_drivers)
        ? ((est as any)?.priceDrivers ?? (est as any)?.price_drivers)
        : [];
      const priceDrivers = rawDrivers
        .map((driver: any) => ({
          key: typeof driver?.key === "string" ? driver.key.trim() : "",
          label:
            typeof driver?.label === "string" ? driver.label.trim() : typeof driver?.key === "string" ? driver.key.trim() : "",
        }))
        .filter((driver: { key: string; label: string }) => Boolean(driver.key));
      return {
        totalMin: Math.min(totalMin, totalMax),
        totalMax: Math.max(totalMin, totalMax),
        currency: currencyRaw || "USD",
        imagePriceRange,
        ...(servicePriceRange ? { servicePriceRange } : {}),
        ...(baselineRange ? { baselinePriceRange: baselineRange } : {}),
        ...(deltaRange ? { deltaPriceRange: deltaRange } : {}),
        ...((est as any)?.deltaDirection === "up" || (est as any)?.deltaDirection === "down" || (est as any)?.deltaDirection === "flat"
          ? { deltaDirection: (est as any).deltaDirection }
          : {}),
        ...(budgetTier ? { budgetTier } : {}),
        ...(budgetTierRanges && Object.keys(budgetTierRanges).length > 0 ? { budgetTierRanges } : {}),
        ...(priceDrivers.length > 0 ? { priceDrivers } : {}),
        ...(typeof (est as any)?.calibrationKey === "string" ? { calibrationKey: String((est as any).calibrationKey) } : {}),
      };
    },
    [config, effectiveStepDataSoFar, instanceId, sessionId]
  );

  const contextSignature = useMemo(() => computeContextSignature(effectiveStepDataSoFar), [effectiveStepDataSoFar]);
  const runs = cache?.runs ?? [];
  const activeRunId = cache?.activeRunId ?? null;
  const activeRun = useMemo(() => {
    if (!runs.length) return null;
    if (activeRunId) {
      const found = runs.find((r) => r.id === activeRunId);
      if (found) return found;
    }
    return runs.at(-1) ?? null;
  }, [activeRunId, runs]);
  const activeIndex = useMemo(() => {
    if (!runs.length) return 0;
    const idx = activeRunId ? runs.findIndex((r) => r.id === activeRunId) : -1;
    return idx >= 0 ? idx : Math.max(0, runs.length - 1);
  }, [activeRunId, runs]);

  const selectedConceptIndex = cache?.selectedConceptIndex ?? null;
  const viewMode = (cache?.viewMode === "gallery" || cache?.viewMode === "single" ? cache.viewMode : null) as PreviewViewMode | null;
  const activeRunExpectedImageCount =
    typeof activeRun?.expectedImageCount === "number" && Number.isFinite(activeRun.expectedImageCount)
      ? Math.max(activeRun.expectedImageCount, activeRun?.images?.length ?? 0)
      : activeRun?.images?.length ?? 0;
  const showGalleryGrid =
    !disableConceptPicker &&
    (viewMode === "gallery" || (viewMode === null && selectedConceptIndex === null)) &&
    Boolean(activeRun) &&
    activeRunExpectedImageCount > 1;
  const showConceptPicker = showGalleryGrid;

  const canRegenerateInGallery =
    !showConceptPicker ||
    runs.length === 0 ||
    typeof regenerationsRemaining !== "number" ||
    regenerationsRemaining > 0;

  const hero = useMemo(() => {
    if (!activeRun?.images?.length) return null;
    const idx =
      selectedConceptIndex != null && Number.isFinite(selectedConceptIndex)
        ? Math.max(0, Math.min(selectedConceptIndex, activeRun.images.length - 1))
        : 0;
    return activeRun.images[idx] ?? activeRun.images[0] ?? null;
  }, [activeRun, selectedConceptIndex]);

  // Persist "context updated" info, but do NOT auto-regenerate.
  useEffect(() => {
    if (!enabled) return;
    setCache((prev) => {
      const next: PreviewCacheV3 = prev
        ? { ...prev }
        : {
            schemaVersion: 3,
            status: "idle",
            runs: [],
            activeRunId: null,
            selectedConceptIndex: null,
            message: null,
            error: null,
            errorDetails: null,
            refinementNote: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastContextSignature: null,
            generatedForContextSignature: null,
            lastGeneratedAnsweredCount: null,
          };
      if (next.lastContextSignature !== contextSignature) {
        next.lastContextSignature = contextSignature;
        next.updatedAt = Date.now();
        saveCache(instanceId, sessionId, next);
      }
      return next;
    });
  }, [contextSignature, enabled, instanceId, sessionId]);

  const derivePricingContextForPreview = useCallback(
    (params: { stepsForQA: any[]; previewImageUrl?: string | null; mode?: "current" | "next-run" }) => {
      const previewImageUrl = params.previewImageUrl || null;
      const mode = params.mode === "next-run" ? "next-run" : "current";
      const currentSnapshot = buildPricingStepSnapshot(effectiveStepDataSoFar || {});
      const normalizedUseCase = String((config as any)?.useCase || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, "-");
      const previewIndex = previewImageUrl ? activeRun?.images?.indexOf(previewImageUrl) ?? -1 : -1;
      const cachedActivePricing = previewIndex >= 0 ? activeRun?.imagePricing?.[previewIndex] : undefined;
      const currentVisiblePricing =
        previewImageUrl && previewImageUrl === hero && accuratePricing ? accuratePricing : cachedActivePricing;
      const previousRun = activeIndex > 0 ? runs[activeIndex - 1] ?? null : null;
      const previousRunPricing = previousRun?.imagePricing?.[0];
      const previousSnapshot = activeRun?.stepDataSnapshot ?? previousRun?.stepDataSnapshot ?? null;

      const normalizeUploadToStrings = (raw: any): string[] => {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
        if (typeof raw === "string") return [raw];
        return [];
      };
      const stepSceneUpload = (
        ["step-upload-scene-image", "step-refinement-upload-scene-image"] as const
      )
        .map((stepId) => normalizeUploadToStrings((effectiveStepDataSoFar as any)?.[stepId]).filter(isValidUrlLikeImage)[0] ?? null)
        .find(Boolean) ?? null;
      const stepUserUpload =
        normalizeUploadToStrings((effectiveStepDataSoFar as any)?.["step-upload-user-image"]).filter(isValidUrlLikeImage)[0] ?? null;
      const uploadedBeforeImage =
        isPricingComparableUseCase(normalizedUseCase) && (stepSceneUpload || stepUserUpload)
          ? (stepSceneUpload || stepUserUpload)
          : null;
      const changedRefinementKeys = buildChangedRefinementKeys({
        currentSnapshot,
        previousSnapshot,
        steps: params.stepsForQA,
      });

      const currentVisibleRange =
        currentVisiblePricing && Number.isFinite(currentVisiblePricing.totalMin) && Number.isFinite(currentVisiblePricing.totalMax)
          ? {
              low: Math.min(currentVisiblePricing.totalMin, currentVisiblePricing.totalMax),
              high: Math.max(currentVisiblePricing.totalMin, currentVisiblePricing.totalMax),
            }
          : null;
      const previousRunRange =
        previousRunPricing &&
        Number.isFinite(previousRunPricing.totalMin) &&
        Number.isFinite(previousRunPricing.totalMax)
          ? {
              low: Math.min(previousRunPricing.totalMin, previousRunPricing.totalMax),
              high: Math.max(previousRunPricing.totalMin, previousRunPricing.totalMax),
            }
          : null;
      const preservedBaselineRange =
        currentVisiblePricing?.baselinePriceRange &&
        Number.isFinite(currentVisiblePricing.baselinePriceRange.low) &&
        Number.isFinite(currentVisiblePricing.baselinePriceRange.high)
          ? {
              low: Math.min(currentVisiblePricing.baselinePriceRange.low, currentVisiblePricing.baselinePriceRange.high),
              high: Math.max(currentVisiblePricing.baselinePriceRange.low, currentVisiblePricing.baselinePriceRange.high),
            }
          : null;

      const baselineRange =
        mode === "next-run"
          ? currentVisibleRange ?? previousRunRange
          : preservedBaselineRange ?? previousRunRange;

      if (baselineRange) {
        return {
          pricingScenario: "refinement" as const,
          baselinePriceRange: baselineRange,
          baselineImageUrl: null,
          changedRefinementKeys,
          stepDataSnapshot: currentSnapshot,
        };
      }

      if (uploadedBeforeImage) {
        return {
          pricingScenario: "comparison" as const,
          baselinePriceRange: null,
          baselineImageUrl: uploadedBeforeImage,
          changedRefinementKeys: [] as Array<{ key: string; label: string }>,
          stepDataSnapshot: currentSnapshot,
        };
      }

      return {
        pricingScenario: "initial" as const,
        baselinePriceRange: null,
        baselineImageUrl: null,
        changedRefinementKeys: [] as Array<{ key: string; label: string }>,
        stepDataSnapshot: currentSnapshot,
      };
    },
    [accuratePricing, activeIndex, activeRun, config, effectiveStepDataSoFar, hero, runs]
  );

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

      const signatureAtStart = computeContextSignature(effectiveStepDataSoFar || {});
      const latestRun = runs.length ? runs.at(-1) ?? null : null;
      const baseReferenceImage = hero || latestRun?.images?.[0] || null;
      const normalizeUploadToStrings = (raw: any): string[] => {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
        if (typeof raw === "string") return [raw];
        return [];
      };
      const stepSceneUpload = (
        ["step-upload-scene-image", "step-refinement-upload-scene-image"] as const
      )
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
      const isBudgetDrivenRegeneration = Boolean(pendingBudgetRefineRef.current);
      const isBudgetTierShift = Boolean(pendingBudgetTierShiftRef.current);
      const generationSignatureAtStart = safeJsonStringify({
        contextSignature: signatureAtStart,
        uploads: storedUploads,
        selectionRefs: selectedOptionReferenceImages,
      });
      // After concepts exist, use the currently selected/generated hero as the anchor.
      const activeAnchorImage = (baseReferenceImage || stepSceneUpload || storedUploads?.[0] || null) as string | null;
      // For budget-driven regeneration, prefer the user's originally uploaded scene anchor
      // instead of the latest generated preview image.
      const originalUploadedAnchorImage = (stepSceneUpload || stepUserUpload || storedUploads?.[0] || null) as string | null;
      const runAnchorImage =
        isBudgetDrivenRegeneration
          ? (originalUploadedAnchorImage || activeAnchorImage)
          : activeAnchorImage;
      // First preview uses uploaded anchors. After the first generated preview exists,
      // treat prompt/guided edits as refinements anchored to the active anchor image.
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
              ...selectedOptionReferenceImages.filter((u) => u && u !== primaryReferenceImage),
            ]
      )
        .filter(isValidUrlLikeImage)
        .slice(0, 6);
      const useCase = normalizeUseCase((config as any)?.useCase);
      // Only use scene-placement when there's a product to place. For pure scene redesign (no product),
      // keep scene use case with generationIntent-driven prompts (flux-kontext + scene module).
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
      const effectiveUseCase =
        canUseScenePlacementForRefinement
          ? "scene-placement"
          : canUseSceneRefinement
            ? "scene-refinement"
            : useCase;

      // Style drift: original reference = user's first upload; generationIndex = runs so far.
      const originalReferenceImage =
        (stepSceneUpload || stepUserUpload || storedUploads?.[0] || null) as string | null;
      const generationIndex = runs.length;
      const generationIntent: "initial" | "small_improvement" | "regenerate" | "budget_tier_shift" = isBudgetDrivenRegeneration
        ? isBudgetTierShift
          ? "budget_tier_shift"
          : "regenerate"
        : hasExistingPreview
          ? "small_improvement"
          : "initial";
      const guideOnlyInitialSceneRun =
        useCase === "scene" &&
        generationIntent === "initial" &&
        !hasExistingPreview &&
        referenceImagesForRequest.length > 0;
      // For refinements: use latest image as base. scene-placement + hasExistingPreview = drilldown edit.
      const sceneImageForRequest =
        guideOnlyInitialSceneRun
          ? undefined
          : (effectiveUseCase === "scene" || effectiveUseCase === "scene-refinement") && runAnchorImage
          ? runAnchorImage
          : (effectiveUseCase === "scene" || effectiveUseCase === "scene-refinement") && stepSceneUpload
            ? stepSceneUpload
            : (effectiveUseCase === "scene" || effectiveUseCase === "scene-refinement") && primaryReferenceImage
              ? primaryReferenceImage
              : (effectiveUseCase === "scene-placement" && runAnchorImage)
                ? runAnchorImage
                : effectiveUseCase === "scene-placement" && stepSceneUpload
                  ? stepSceneUpload
                  : effectiveUseCase === "scene-placement" && primaryReferenceImage
                    ? primaryReferenceImage
                    : undefined;
      const lastGeneratedSignature = latestRun?.contextSignature ?? cache?.generatedForContextSignature ?? null;
      if (
        reason === "auto" &&
        generationSignatureAtStart &&
        lastGeneratedSignature &&
        generationSignatureAtStart === lastGeneratedSignature &&
        runs.length > 0
      ) {
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

	            // For scene edits, avoid injecting option-card style references into generation.
	            // Keep the edit tightly anchored to the user's scene image.
	            const scenePlacementInpaintMode =
                normalizedUseCase === "scene-refinement" || (normalizedUseCase === "scene-placement" && !productImage);
	            const refsForGeneration =
	              guideOnlyInitialSceneRun
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
		          generationIntent === "initial" &&
		          (
		            !hasDirectImageInput ||
		            ((normalizedUseCase === "scene" || normalizedUseCase === "scene-refinement") && Boolean(sceneImage))
		          );
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
		        if (guideOnlyInitialSceneRun) requestBodyBase.referenceMode = "guide_only";
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
		          if (!guideOnlyInitialSceneRun && sceneImage) requestBodyBase.sceneImage = sceneImage;
		          if (uniqueRefs.length > 0) requestBodyBase.referenceImages = uniqueRefs.slice(0, 6);
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
                const existingRun =
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
                    params.generated && Number.isFinite(answeredQuestionCount)
                      ? answeredQuestionCount
                      : base.lastGeneratedAnsweredCount ?? null,
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
                  typeof detailsRaw === "string"
                    ? detailsRaw
                    : detailsRaw && typeof detailsRaw === "object"
                      ? safeJsonStringify(detailsRaw)
                      : null;
                responseErrorDetails = normalizedDetails ? normalizedDetails.slice(0, 800) : null;
                const err = new Error(errorMessage) as Error & { details?: string | null };
                err.details = responseErrorDetails;
                throw err;
              }

              const imgs = Array.isArray((json as any)?.images) ? (json as any).images.filter((x: any) => typeof x === "string" && x) : [];
              if (process.env.NODE_ENV !== "production") {
                console.debug("[preview] images received", imgs.length, imgs.length === 1 ? "(single-image mode; hero will display)" : "(gallery mode)");
              }
              if (imgs.length === 0) {
                throw new Error("Preview generated, but no images were returned.");
              }
              const normalizedImages = imgs.filter(isValidUrlLikeImage).filter((src: string) => !isPlaceholderPreviewImage(src));
              if (normalizedImages.length === 0) {
                throw new Error("Preview generated, but only a placeholder image was returned.");
              }
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

              if (collected.length < requestedOutputs) {
                console.warn("[preview] batch returned fewer images than requested", {
                  requestedOutputs,
                  actualImages: collected.length,
                });
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
          if (pricedHero) {
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
          } catch (deferredError) {
            console.error("[preview] deferred gallery batch failed", deferredError);
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
          const nextActiveRunId =
            base.activeRunId === runId ? nextRuns.at(-1)?.id ?? null : base.activeRunId ?? nextRuns.at(-1)?.id ?? null;
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
      cache?.generatedForContextSignature,
      cache?.refinementNote,
      config,
      derivePricingContextForPreview,
      enabled,
      conceptGalleryTargetCount,
      hero,
      instanceId,
      refreshRegenAllowance,
      runs,
      sessionId,
      effectiveStepDataSoFar,
    ]
  );

  const requestManualGenerate = useCallback(() => {
    if (!enabled) return;
    if (inFlightRef.current || cache?.status === "running") {
      pendingManualGenerateRef.current = true;
      return;
    }
    void runGenerate("manual");
  }, [cache?.status, enabled, runGenerate]);

  const readFileAsDataURL = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(String(e.target?.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image"));
      reader.readAsDataURL(file);
    });

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
    [instanceId, requestManualGenerate, sessionId, uploadReferenceImage]
  );

  // Auto-generate the first preview once enabled (if no runs yet).
  useEffect(() => {
    if (!enabled) return;
    if ((cache?.runs?.length || 0) > 0) return;
    if (cache?.status === "running") return;
    if (cache?.status === "error") return;
    void runGenerate("auto");
  }, [cache?.runs?.length, cache?.status, enabled, runGenerate]);

  const isPlaceholderHero = useMemo(() => (hero ? isPlaceholderPreviewImage(hero) : false), [hero]);
  const lightboxLayoutId = `image-preview:${instanceId}:${sessionId}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxContain, setLightboxContain] = useState(false);
  const previousActiveRunRef = useRef<{ runId: string | null; index: number; runsLength: number; hero: string | null }>({
    runId: null,
    index: 0,
    runsLength: 0,
    hero: null,
  });
  const [navigationTransition, setNavigationTransition] = useState<NavigationTransition | null>(null);

  const openLightbox = useCallback(() => {
    if (!hero) return;
    setLightboxContain(false);
    setLightboxOpen(true);
  }, [hero]);

  const closeLightbox = useCallback(() => {
    setLightboxContain(false);
    setLightboxOpen(false);
  }, []);

  useEffect(() => {
    const previous = previousActiveRunRef.current;
    const currentRunId = activeRun?.id ?? null;

    if (previous.runId && currentRunId && previous.runId !== currentRunId) {
      const navigatedBetweenExistingRuns = runs.length === previous.runsLength && previous.runsLength > 1;

      if (navigatedBetweenExistingRuns && previous.hero && hero) {
        const direction: -1 | 1 = activeIndex > previous.index ? 1 : -1;
        setNavigationTransition({
          key: `${previous.runId}:${currentRunId}:${Date.now()}`,
          fromRunId: previous.runId,
          toRunId: currentRunId,
          fromImage: previous.hero,
          toImage: hero,
          direction,
        });
      } else {
        setNavigationTransition(null);
      }
    } else if (!hero) {
      setNavigationTransition(null);
    }

    previousActiveRunRef.current = {
      runId: currentRunId,
      index: activeIndex,
      runsLength: runs.length,
      hero,
    };
  }, [activeIndex, activeRun?.id, hero, runs.length]);

  useEffect(() => {
    if (!navigationTransition) return;
    const timeoutId = window.setTimeout(() => {
      setNavigationTransition((current) => (current?.key === navigationTransition.key ? null : current));
    }, 460);
    return () => window.clearTimeout(timeoutId);
  }, [navigationTransition]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeLightbox, lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    if (hero) return;
    setLightboxOpen(false);
  }, [hero, lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [lightboxOpen]);

  const busy = cache?.status === "running";
  const isPreviewVisible = Boolean(enabled && (hero || busy || (cache?.status === "error" && cache?.error)));
  const showLoader = !hero && (busy || !cache || cache.status === "idle");
  const showProgressiveGalleryLoader = Boolean(showConceptPicker && busy && activeRunExpectedImageCount > 1);
  const progressiveGalleryCellCount = showProgressiveGalleryLoader
    ? Math.max(INITIAL_PROGRESSIVE_GRID_PLACEHOLDERS, activeRunExpectedImageCount, activeRun?.images?.length ?? 0)
    : Math.max(activeRun?.images?.length ?? 0, activeRunExpectedImageCount);
  const showRefreshMask = Boolean(hero && busy && !showConceptPicker);
  const showOverlayLoader = Boolean((showLoader || busy) && !showProgressiveGalleryLoader);
  const autoRefreshBusy = Boolean(hero && busy && activeGenerationReason === "auto");
  const leadGateActive = leadGateEnabled && Boolean(hero) && !leadCaptured;
  const canUseLiveBudgetSlider = !leadGateEnabled || leadCaptured;
  /** Single-image mode with pricing unlocked (no gate, or lead captured). */
  const revenuePanelActive = Boolean(hero && !showConceptPicker && (!leadGateEnabled || leadCaptured));
  const galleryLoadingMessage =
    GALLERY_LOADING_MESSAGES[galleryLoadingMessageIndex % GALLERY_LOADING_MESSAGES.length] ?? GALLERY_LOADING_TITLE;

  const [overlayPricingExpanded, setOverlayPricingExpanded] = useState(false);
  useEffect(() => {
    // Default expanded once pricing is revealed; collapse when leaving single-image revealed mode.
    if (revenuePanelActive) {
      setOverlayPricingExpanded(true);
      return;
    }
    setOverlayPricingExpanded(false);
  }, [revenuePanelActive]);

  useEffect(() => {
    if (!showProgressiveGalleryLoader) {
      setGalleryLoadingMessageIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setGalleryLoadingMessageIndex((prev) => (prev + 1) % GALLERY_LOADING_MESSAGES.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [showProgressiveGalleryLoader]);

  useEffect(() => {
    onAutoGenerationBusyChange?.(autoRefreshBusy);
  }, [autoRefreshBusy, onAutoGenerationBusyChange]);

  useEffect(() => {
    return () => {
      onAutoGenerationBusyChange?.(false);
    };
  }, [onAutoGenerationBusyChange]);

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
  }, [autoGenerationCounterScope, instanceId, sessionId]);

  useEffect(() => {
    if (autoGenerationCounterScope !== "refinement") return;
    const last = cache?.lastGeneratedAnsweredCount;
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
  }, [answeredQuestionCount, autoGenerationCounterScope, cache?.lastGeneratedAnsweredCount, instanceId, sessionId]);

  const AUTO_REGEN_COOLDOWN_MS = 1_000;

  // Auto-regenerate every N answered questions, starting after the first successful run.
  useEffect(() => {
    if (!enabled) return;
    if (!Number.isFinite(autoRegenerateEveryNAnsweredQuestions) || autoRegenerateEveryNAnsweredQuestions <= 0) return;
    if (cache?.status === "running") return;
    if (cache?.status === "error") return;
    if (!Number.isFinite(answeredQuestionCount) || answeredQuestionCount <= 0) return;

    // Throttle auto-regen to avoid storms when user answers many questions quickly
    const now = Date.now();
    if (lastAutoRegenAtRef.current > 0 && now - lastAutoRegenAtRef.current < AUTO_REGEN_COOLDOWN_MS) return;

    const last = cache?.lastGeneratedAnsweredCount ?? runs.at(-1)?.answeredQuestionCount ?? null;
    // If we have never generated a run yet, kick off the first preview once the user has answered enough.
    if (typeof last !== "number" || !Number.isFinite(last)) {
      if (answeredQuestionCount >= autoRegenerateEveryNAnsweredQuestions) {
        lastAutoRegenAtRef.current = now;
        void runGenerate("auto");
      }
      return;
    }
    if (answeredQuestionCount >= last + autoRegenerateEveryNAnsweredQuestions) {
      // Never interrupt the user with a lead-capture popover due to an *auto* regeneration.
      // If lead capture is required, simply skip auto-regeneration until the user explicitly
      // takes an action (e.g. refresh/download/show pricing) that can open the gate.
      if (leadGateActive) return;
      lastAutoRegenAtRef.current = now;
      void runGenerate("auto");
    }
  }, [
    answeredQuestionCount,
    autoRegenerateEveryNAnsweredQuestions,
    cache?.lastGeneratedAnsweredCount,
    cache?.status,
    enabled,
    leadGateActive,
    runGenerate,
    runs,
  ]);

  // Prompt "Send" is an explicit action: always regenerate on each submit nonce bump.
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
    if (cache?.status === "error") return;
    requestManualGenerate();
  }, [cache?.status, effectiveStepDataSoFar, enabled, hero, requestManualGenerate]);

  // Upload-driven refresh nonce: explicit regeneration trigger even when hero is absent/stale.
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
    if (cache?.status === "running") return;
    pendingManualGenerateRef.current = false;
    void runGenerate("manual");
  }, [cache?.status, enabled, runGenerate]);

  const budgetSliderBounds = useMemo(() => {
    const configPreviewPricingSeed = buildPreviewPricingFromConfig((config as any)?.previewPricing, sessionId);
    const seededRange =
      pricingSeed?.servicePriceRange ??
      pricingSeed?.imagePriceRange ??
      (typeof pricingSeed?.totalMin === "number" && typeof pricingSeed?.totalMax === "number"
        ? { low: pricingSeed.totalMin, high: pricingSeed.totalMax }
        : null);
    // Slider uses service price range (wider) only; never image range (totalMin/totalMax)
    const sourceMin =
      accuratePricing?.servicePriceRange?.low ?? seededRange?.low ?? configPreviewPricingSeed?.totalMin ?? 2000;
    const sourceMax =
      accuratePricing?.servicePriceRange?.high ?? seededRange?.high ?? configPreviewPricingSeed?.totalMax ?? 50000;
    const min = Math.max(500, Math.min(sourceMin, sourceMax));
    const max = Math.max(min + 500, Math.max(sourceMin, sourceMax));
    const span = Math.max(0, max - min);
    // Prefer fewer, more meaningful slider positions for visible image changes.
    // More intervals for finer budget selection
    const step =
      span <= 10000 ? 1000 : span <= 20000 ? 1500 : span <= 40000 ? 2000 : span <= 60000 ? 2500 : Math.max(1000, Math.round(span / 24));
    return { min, max, step };
  }, [accuratePricing, config, pricingSeed, sessionId]);

  const previewPricing = useMemo(() => {
    return buildPreviewPricingFromConfig((config as any)?.previewPricing, sessionId);
  }, [(config as any)?.previewPricing, sessionId]);

  // Only use config-based pricing for display when explicitly provided; never show $200-$400 placeholder
  const hasExplicitPricingConfig = Boolean(
    (config as any)?.previewPricing &&
      (typeof (config as any).previewPricing?.totalMin === "number" ||
        typeof (config as any).previewPricing?.totalMax === "number" ||
        typeof (config as any).previewPricing?.min === "number" ||
        typeof (config as any).previewPricing?.max === "number")
  );
  const pricingLocale =
    typeof navigator !== "undefined"
      ? ((navigator.languages && navigator.languages[0]) || navigator.language || undefined)
      : undefined;
  const pricingCurrency = (previewPricing?.currency || detectCurrencyFromLocale(pricingLocale) || "USD").toUpperCase();

  // Exact pricing is only fetched for the currently selected hero image.
  // The rest of the gallery keeps its original seeded ranges from the first pass.
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

      // Only update displayed pricing if user is still viewing this hero (avoid overwriting after stack nav)
      const stillViewingHero = currentHeroRef.current === heroAtFetchStart;
      if (stillViewingHero) {
        setAccuratePricing((prev) => {
          const keepServiceRange =
            prev?.servicePriceRange &&
            typeof prev.servicePriceRange.low === "number" &&
            typeof prev.servicePriceRange.high === "number";
          const finalServiceRange =
            keepServiceRange && prev?.servicePriceRange ? prev.servicePriceRange : cached.servicePriceRange;
          return {
            ...cached,
            ...(finalServiceRange ? { servicePriceRange: finalServiceRange } : {}),
          };
        });
        heroForPricingRef.current = heroAtFetchStart;
        setAccuratePricingStatus("complete");
      }

      // Always store in cache for when user navigates back (even if they've nav'd away during fetch)
      const heroIdx = heroAtFetchStart ? (activeRun?.images?.indexOf(heroAtFetchStart) ?? -1) : -1;
      if (heroIdx >= 0 && activeRun?.id && instanceId && sessionId) {
        setCache((prev) => {
          const base = prev ?? loadCache(instanceId, sessionId);
          if (!base) return prev;
          const nextRuns = (base.runs ?? []).map((r) => {
            if (r.id !== activeRun.id) return r;
            const existing = r.imagePricing ?? [];
            const nextPricing: (CachedPricing | undefined)[] = [...existing];
            while (nextPricing.length <= heroIdx) nextPricing.push(undefined);
            nextPricing[heroIdx] = cached;
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
    derivePricingContextForPreview,
    effectiveStepDataSoFar,
    hero,
    instanceId,
    liveBudget,
    requestAccuratePricing,
    selectedConceptIndex,
    sessionId,
  ]);
  fetchAccuratePricingRef.current = fetchAccuratePricing;

  // Default budget to 20% into the range when no value from step data
  useEffect(() => {
    if (liveBudget !== null) return;
    const { min, max, step } = budgetSliderBounds;
    const preferred =
      typeof pricingSeed?.medianPrice === "number" && Number.isFinite(pricingSeed.medianPrice)
        ? pricingSeed.medianPrice
        : min + (max - min) * 0.2;
    const stepped = Math.round(preferred / step) * step;
    const clamped = Math.max(min, Math.min(max, stepped));
    setLiveBudget(clamped);
  }, [budgetSliderBounds, liveBudget, pricingSeed?.medianPrice]);

  // If budget changes while pricing is revealed, refetch accurate pricing after the next regeneration.
  // This covers both the in-overlay slider and external budget changes (e.g. question-pane Budget mode).
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
    prevRunsLengthRef.current = runs.length;
  }, [accuratePricing?.budgetTier, accuratePricing?.budgetTierRanges, activeRun, enabled, hero, leadCaptured, liveBudget, runs.length]);

  useEffect(() => {
    if (!enabled) return;
    if (!hero) return;
    if (!liveBudgetDirty) return;
    if (!canUseLiveBudgetSlider) return;
    const timer = window.setTimeout(() => {
      setLiveBudgetDirty(false);
      pendingBudgetRefineRef.current = true;
      void runGenerate("manual");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [canUseLiveBudgetSlider, enabled, hero, liveBudgetDirty, runGenerate]);

  // Defer pricing until after regeneration completes (when triggered by budget slider).
  useEffect(() => {
    if (!enabled || !leadCaptured) return;
    if (!pendingBudgetRefineRef.current) {
      prevRunsLengthRef.current = runs.length;
      return;
    }
    if (runs.length <= prevRunsLengthRef.current) return;
    prevRunsLengthRef.current = runs.length;
    pendingBudgetRefineRef.current = false;
    void fetchAccuratePricingRef.current?.();
  }, [enabled, leadCaptured, runs.length]);

  const downloadActiveImage = useCallback(async () => {
    if (!hero) return;
    const filename = `preview-${Date.now()}.png`;
    try {
      if (hero.startsWith("data:")) {
        const a = document.createElement("a");
        a.href = hero;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }

      const res = await fetch(hero);
      if (!res.ok) throw new Error("fetch_failed");
      const blob = await res.blob();
      if (!blob || (blob.type && !blob.type.startsWith("image/"))) throw new Error("not_image");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 750);
    } catch {
      try {
        window.open(hero, "_blank", "noopener,noreferrer");
      } catch {}
    }
  }, [hero]);

  const handleRefreshClick = useCallback(() => {
    if (leadGateActive) {
      pendingActionRef.current = "refresh";
      pendingGenerateModeRef.current = "manual";
      gateContextRef.current = "regenerate_manual";
      setShowGenerateGate(true);
      return;
    }
    requestManualGenerate();
  }, [leadGateActive, requestManualGenerate]);

  const handleUploadClick = useCallback(() => {
    if (leadGateActive) {
      gateContextRef.current = "upload_reference";
      pendingActionRef.current = "upload";
      setShowUploadGate(true);
      return;
    }
    uploadInputRef.current?.click();
  }, [leadGateActive]);

  const handleDownloadClick = useCallback(() => {
    if (!hero) return;
    if (leadGateActive) {
      gateContextRef.current = "download";
      pendingActionRef.current = "download";
      setShowDownloadGate(true);
      return;
    }
    void downloadActiveImage();
  }, [downloadActiveImage, hero, leadGateActive]);

  const handleSkipContinue = useCallback(() => {
    pendingActionRef.current = null;
    setShowUploadGate(false);
    setShowDownloadGate(false);
    setShowGenerateGate(false);
    // Explicit skip should allow continuing without forcing lead capture UX.
    setLeadCaptured(true);
  }, []);

  // Let the parent know whether a real preview image is currently visible.
  useEffect(() => {
    onPreviewVisibleChange?.(isPreviewVisible);
  }, [isPreviewVisible, onPreviewVisibleChange]);

  // Let the parent know whether we have an actual preview image yet.
  useEffect(() => {
    onHasImageChange?.(Boolean(hero));
  }, [hero, onHasImageChange]);

  // UX: generate in the background while the user completes the form.
  // Show the preview shell immediately while generating, then swap in the real image when ready.

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < runs.length - 1;
  const hasMultiImageRun = runs.some((r) => r.images && r.images.length > 1);
  const activeRunHasMultiple = Boolean(activeRun?.images && activeRun.images.length > 1);
  const activeNavigationTransition =
    navigationTransition && navigationTransition.toRunId === activeRun?.id && navigationTransition.toImage === hero
      ? navigationTransition
      : null;
  const stackedPreviewLayers = useMemo(() => {
    // Only show stack for isolated runs (separate generations) — never for gallery concepts from the same run.
    // Stack = previous/next run images only (chronological history of regenerations).
    if (!hero || runs.length < 1 || showConceptPicker || isPlaceholderHero) return [] as PreviewStackLayer[];

    const layers: PreviewStackLayer[] = [];
    const seen = new Set<string>([hero]);
    const addLayer = (src: string | null | undefined, key: string, kind: PreviewStackLayer["kind"]) => {
      if (!isValidUrlLikeImage(src) || seen.has(src) || layers.length >= 4) return;
      seen.add(src);
      layers.push({ key, src, kind });
    };

    if (activeNavigationTransition?.fromImage) {
      addLayer(activeNavigationTransition.fromImage, `transition-${activeNavigationTransition.key}`, "transition");
    }

    // Stack only previous/next runs (each run = one generation). Gallery concepts from the same run stay out.
    if (runs.length > 1) {
      const previousRuns = runs.slice(0, activeIndex).reverse();
      const nextRuns = runs.slice(activeIndex + 1);
      previousRuns.forEach((run) => addLayer(run.images?.[0], `history-${run.id}`, "history"));
      nextRuns.forEach((run) => addLayer(run.images?.[0], `next-${run.id}`, "history"));
    }

    return layers;
  }, [activeIndex, activeNavigationTransition, activeRun, hero, isPlaceholderHero, runs, showConceptPicker]);
  const goPrev = () => {
    if (!canPrev) return;
    const nextId = runs[activeIndex - 1]?.id;
    if (!nextId) return;
    setCache((prev) => {
      const base = prev ?? loadCache(instanceId, sessionId);
      if (!base) return prev;
      // Stay in single view when navigating between runs; never switch to gallery
      const next: PreviewCacheV3 = {
        ...base,
        activeRunId: nextId,
        viewMode: "single",
        selectedConceptIndex: 0,
        updatedAt: Date.now(),
      };
      saveCache(instanceId, sessionId, next);
      return next;
    });
  };
  const goNext = () => {
    if (!canNext) return;
    const nextId = runs[activeIndex + 1]?.id;
    if (!nextId) return;
    setCache((prev) => {
      const base = prev ?? loadCache(instanceId, sessionId);
      if (!base) return prev;
      // Stay in single view when navigating between runs; never switch to gallery
      const next: PreviewCacheV3 = {
        ...base,
        activeRunId: nextId,
        viewMode: "single",
        selectedConceptIndex: 0,
        updatedAt: Date.now(),
      };
      saveCache(instanceId, sessionId, next);
      return next;
    });
  };
  // previewMaxVh >= 95 means full-screen dominant layout (mobile/adventure) — no space below the image.
  const isDominantLayout = typeof previewMaxVh === "number" && previewMaxVh >= 95;

	  const base =
	    variant === "tiny"
	      ? { vw: 92, px: 320, vh: 18 }
	      : variant === "rail"
	        ? { vw: 92, px: 520, vh: 28 }
	        : { vw: 98, px: 1200, vh: 82 };

  const maxVw =
    typeof previewMaxVw === "number" && Number.isFinite(previewMaxVw) ? Math.min(base.vw, previewMaxVw) : base.vw;
  const chromePx =
    typeof previewChromePx === "number" && Number.isFinite(previewChromePx) ? Math.max(0, Math.floor(previewChromePx)) : 0;
  // Guard: parent measurement can briefly produce 0/negative values on first reveal;
  // treating that as a real constraint collapses the preview.
  const hasValidPreviewMaxPx = typeof previewMaxPx === "number" && Number.isFinite(previewMaxPx) && previewMaxPx > 0;
  const maxPxRaw = hasValidPreviewMaxPx ? Math.min(base.px, previewMaxPx) : base.px;
  const maxPx = Math.max(0, maxPxRaw - (hasValidPreviewMaxPx ? chromePx : 0));
  const maxVh = typeof previewMaxVh === "number" && Number.isFinite(previewMaxVh) ? Math.min(base.vh, previewMaxVh) : base.vh;

  // Keep the sizing expression stable across the entire lifecycle (generating -> revealed),
  // so we don't "snap" between different min() constraints as measurements settle.
  const previewSize = `min(100%, ${maxVw}vw, ${maxPx}px, ${maxVh}dvh)`;

  // Let the preview size respond to parent layout changes (e.g. toggling between prompt/questions)
  // without using framer-motion layout animations (they can jitter while measurements settle).
  const effectivePreviewSize = previewSize;
  // Neutral glass palette for all overlay controls (pills + lead popover).
  const primary = theme.primaryColor || "#3b82f6";
  const overlayBg = "rgba(51, 65, 85, 0.52)";
  const overlayHoverBg = "rgba(51, 65, 85, 0.64)";
  const overlayBorder = "rgba(255,255,255,0.24)";
  const galleryPlaceholderPillBg = "rgba(0, 0, 0, 0.60)";
  const galleryPlaceholderPillHoverBg = "rgba(0, 0, 0, 0.72)";
  const singleModePricingPillBg = galleryPlaceholderPillBg;
  const singleModePricingPillHoverBg = galleryPlaceholderPillHoverBg;
  // Keep lead popover on the exact same glass color token as overlay pills.
  const leadGenOverlayBg = overlayBg;
  const leadGenFg = "rgba(255,255,255,0.95)";
  const leadGenMuted = "rgba(255,255,255,0.72)";
  const leadGenInputBg = "rgba(255,255,255,0.12)";
  const leadGenInputBorder = "rgba(255,255,255,0.20)";
  const leadGenPlaceholder = "rgba(255,255,255,0.58)";
  const leadGenActionBg = singleModePricingPillBg;
  const leadGenActionFg = "#ffffff";
  const leadGenActionBorder = "rgba(255,255,255,0.22)";
  const leadGenRing = "rgba(255,255,255,0.38)";
  const overlayVars = {
    ["--sif-overlay-bg" as any]: overlayBg,
    ["--sif-overlay-hover-bg" as any]: overlayHoverBg,
    ["--sif-overlay-border" as any]: overlayBorder,
    ["--sif-lead-gen-overlay-bg" as any]: leadGenOverlayBg,
    ["--sif-lead-gen-fg" as any]: leadGenFg,
    ["--sif-lead-gen-muted" as any]: leadGenMuted,
    ["--sif-lead-gen-input-bg" as any]: leadGenInputBg,
    ["--sif-lead-gen-input-border" as any]: leadGenInputBorder,
    ["--sif-lead-gen-placeholder" as any]: leadGenPlaceholder,
    ["--sif-lead-gen-action-bg" as any]: leadGenActionBg,
    ["--sif-lead-gen-action-fg" as any]: leadGenActionFg,
    ["--sif-lead-gen-action-border" as any]: leadGenActionBorder,
    ["--sif-lead-gen-ring" as any]: leadGenRing,
  } as React.CSSProperties;
  const singleModeOverlayVars = {
    ...overlayVars,
    ["--sif-overlay-bg" as any]: galleryPlaceholderPillBg,
    ["--sif-overlay-hover-bg" as any]: galleryPlaceholderPillHoverBg,
  } as React.CSSProperties;
  const overlayButtonClass =
    "h-8 sm:h-7 inline-flex items-center gap-1.5 rounded-xl px-3 text-[0.6875rem] font-medium leading-none text-white/95 shadow-sm backdrop-blur-md bg-[var(--sif-overlay-bg)] hover:bg-[var(--sif-overlay-hover-bg)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60 disabled:cursor-not-allowed";
  const overlayIconButtonClass =
    "h-8 w-8 sm:h-7 sm:w-7 inline-flex items-center justify-center rounded-full text-white/90 shadow-sm backdrop-blur-md bg-[var(--sif-overlay-bg)] hover:bg-[var(--sif-overlay-hover-bg)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors";

  const pricingPillVars = {
    ["--sif-overlay-bg" as any]: singleModePricingPillBg,
    ["--sif-overlay-hover-bg" as any]: singleModePricingPillHoverBg,
    ["--sif-pill-fg" as any]: "#ffffff",
    ["--sif-lead-gen-overlay-bg" as any]: leadGenOverlayBg,
    ["--sif-lead-gen-fg" as any]: leadGenFg,
    ["--sif-lead-gen-muted" as any]: leadGenMuted,
    ["--sif-lead-gen-input-bg" as any]: leadGenInputBg,
    ["--sif-lead-gen-input-border" as any]: leadGenInputBorder,
    ["--sif-lead-gen-placeholder" as any]: leadGenPlaceholder,
    ["--sif-lead-gen-action-bg" as any]: leadGenActionBg,
    ["--sif-lead-gen-action-fg" as any]: leadGenActionFg,
    ["--sif-lead-gen-action-border" as any]: leadGenActionBorder,
    ["--sif-lead-gen-ring" as any]: leadGenRing,
  } as React.CSSProperties;
  const centeredPricingOverlayInset = "clamp(0.7rem, 3cqi, 1rem)";
  const centeredPricingPanelWidth = "min(calc(100% - 0.05rem), clamp(17rem, 54cqi, 27rem))";
  const centeredPricingPanelRadius = "clamp(1rem, 4cqi, 1.5rem)";
  const centeredPricingPanelPadding = "clamp(0.65rem, 2.5cqi, 0.95rem)";
  const centeredPricingPanelGap = "clamp(0.4rem, 1.45cqi, 0.62rem)";
  const centeredPricingHeaderGap = "clamp(0.38rem, 1.2cqi, 0.58rem)";
  const centeredPricingIconButtonSize = "clamp(1.8rem, 6cqi, 2.1rem)";
  const centeredPricingIconSize = "clamp(0.9rem, 3.1cqi, 1rem)";
  const centeredPricingTitleSize = "clamp(0.88rem, 2.5cqi, 1rem)";
  const centeredPricingInputHeight = "clamp(2.25rem, 7.4cqi, 2.7rem)";
  const centeredPricingInputTextSize = "clamp(0.84rem, 2.55cqi, 0.95rem)";
  const centeredPricingActionHeight = "clamp(1.85rem, 6.1cqi, 2.15rem)";
  const centeredPricingActionPadX = "clamp(0.7rem, 2.35cqi, 0.88rem)";
  const centeredPricingMetaSize = "clamp(0.72rem, 1.95cqi, 0.8rem)";
  const centeredPricingIconInset = "clamp(0.8rem, 2.9cqi, 0.95rem)";
  const centeredPricingInputPadLeft = "clamp(2.3rem, 8.2cqi, 2.7rem)";

  // Pricing pill: show only in single mode (user has chosen one image), not while picking from the 4-tile gallery.
  const shouldShowPricingPill = Boolean(hero && variant === "hero" && previewPricing && !showConceptPicker);
  const formattedPricingRange = previewPricing
    ? `${formatCurrency(previewPricing.totalMin, { locale: pricingLocale, currency: pricingCurrency })}-${formatCurrency(
        previewPricing.totalMax,
        { locale: pricingLocale, currency: pricingCurrency }
      )}`
    : null;
  const formattedSeedPricing = previewPricing
    ? formatCurrency(Math.round((previewPricing.totalMin + previewPricing.totalMax) / 2), {
        locale: pricingLocale,
        currency: pricingCurrency,
      })
    : null;
  const formattedSeedPricingRange = useMemo(() => {
    const low = pricingSeed?.servicePriceRange?.low ?? pricingSeed?.imagePriceRange?.low ?? pricingSeed?.totalMin;
    const high = pricingSeed?.servicePriceRange?.high ?? pricingSeed?.imagePriceRange?.high ?? pricingSeed?.totalMax;
    const currency = (pricingSeed?.currency || pricingCurrency || "USD").toUpperCase();
    if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high)) {
      return null;
    }
    return `${formatCurrency(Math.min(low, high), { locale: pricingLocale, currency })}-${formatCurrency(
      Math.max(low, high),
      { locale: pricingLocale, currency }
    )}`;
  }, [pricingCurrency, pricingLocale, pricingSeed]);

  const formattedAccuratePricingRange = useMemo(() => {
    if (!accuratePricing) return null;
    const c = (accuratePricing.currency || pricingCurrency || "USD").toUpperCase();
    // Prefer imagePriceRange (raw AI estimate) for the pill so we always show the actual range
    const low = accuratePricing.imagePriceRange?.low ?? accuratePricing.totalMin;
    const high = accuratePricing.imagePriceRange?.high ?? accuratePricing.totalMax;
    return `${formatCurrency(low, { locale: pricingLocale, currency: c })}-${formatCurrency(high, {
      locale: pricingLocale,
      currency: c,
    })}`;
  }, [accuratePricing, pricingCurrency, pricingLocale]);
  const formattedCachedHeroPricingRange = useMemo(() => {
    const heroIdx = hero ? activeRun?.images?.indexOf(hero) ?? -1 : -1;
    const cachedHeroPricing = heroIdx >= 0 ? activeRun?.imagePricing?.[heroIdx] : undefined;
    return formatPricingRangeText({
      pricing: cachedHeroPricing,
      locale: pricingLocale,
      currency: pricingCurrency,
    });
  }, [activeRun, hero, pricingCurrency, pricingLocale]);

  const selectedServiceIdForCta = useMemo(() => {
    const raw =
      (effectiveStepDataSoFar as any)?.["step-service-primary"] ??
      (effectiveStepDataSoFar as any)?.["step-service"] ??
      (effectiveStepDataSoFar as any)?.["step_service_primary"] ??
      (effectiveStepDataSoFar as any)?.["step_service"];
    const id = Array.isArray(raw) ? String(raw[0] || "").trim() : String(raw || "").trim();
    return id;
  }, [effectiveStepDataSoFar]);

  const previewBookingCta = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        primaryUrl: null as string | null,
        primaryLabel: "Get exact quote & timeline",
        missingUrl: true,
      };
    }
    const cat = loadServiceCatalog(sessionId);
    const meta = selectedServiceIdForCta ? cat?.byServiceId?.[selectedServiceIdForCta] : null;
    const heroUrl = meta && typeof (meta as any).heroCtaUrl === "string" ? pickHttpUrl((meta as any).heroCtaUrl) : null;
    const heroText =
      meta && typeof (meta as any).heroCtaText === "string" && String((meta as any).heroCtaText).trim()
        ? String((meta as any).heroCtaText).trim()
        : null;
    const steps = loadStepState(instanceId)?.steps ?? [];
    const scheduleUrl = readConfirmationScheduleUrlFromSteps(steps);
    const primaryUrl = heroUrl || scheduleUrl;
    const primaryLabel = heroText && heroText.length > 0 ? heroText : "Get exact quote & timeline";
    return { primaryUrl, primaryLabel, missingUrl: !primaryUrl };
  }, [instanceId, sessionId, selectedServiceIdForCta]);

  const overlayPricingRange = useMemo(() => {
    const currency = (accuratePricing?.currency || pricingSeed?.currency || pricingCurrency || "USD").toUpperCase();
    const heroIdx = hero ? activeRun?.images?.indexOf(hero) ?? -1 : -1;
    const cachedHero = heroIdx >= 0 ? activeRun?.imagePricing?.[heroIdx] : undefined;

    if (accuratePricing) {
      const low = accuratePricing.imagePriceRange?.low ?? accuratePricing.totalMin;
      const high = accuratePricing.imagePriceRange?.high ?? accuratePricing.totalMax;
      if (typeof low === "number" && typeof high === "number" && Number.isFinite(low) && Number.isFinite(high)) {
        return { low: Math.min(low, high), high: Math.max(low, high), currency };
      }
    }
    if (cachedHero) {
      const low = cachedHero.imagePriceRange?.low ?? cachedHero.totalMin;
      const high = cachedHero.imagePriceRange?.high ?? cachedHero.totalMax;
      if (typeof low === "number" && typeof high === "number" && Number.isFinite(low) && Number.isFinite(high)) {
        return {
          low: Math.min(low, high),
          high: Math.max(low, high),
          currency: String(cachedHero.currency || currency).trim().toUpperCase() || currency,
        };
      }
    }
    const seedLow = pricingSeed?.servicePriceRange?.low ?? pricingSeed?.imagePriceRange?.low ?? pricingSeed?.totalMin;
    const seedHigh = pricingSeed?.servicePriceRange?.high ?? pricingSeed?.imagePriceRange?.high ?? pricingSeed?.totalMax;
    if (typeof seedLow === "number" && typeof seedHigh === "number" && Number.isFinite(seedLow) && Number.isFinite(seedHigh)) {
      return { low: Math.min(seedLow, seedHigh), high: Math.max(seedLow, seedHigh), currency };
    }
    if (previewPricing && Number.isFinite(previewPricing.totalMin) && Number.isFinite(previewPricing.totalMax)) {
      return {
        low: Math.min(previewPricing.totalMin, previewPricing.totalMax),
        high: Math.max(previewPricing.totalMin, previewPricing.totalMax),
        currency,
      };
    }
    return null;
  }, [accuratePricing, activeRun, hero, previewPricing, pricingCurrency, pricingSeed]);

  const overlayPricingMidpointLabel = useMemo(() => {
    if (!overlayPricingRange) return "—";
    return formatCurrency(Math.round((overlayPricingRange.low + overlayPricingRange.high) / 2), {
      locale: pricingLocale,
      currency: overlayPricingRange.currency,
    });
  }, [overlayPricingRange, pricingLocale]);

  const overlayPricingRangeLabel = useMemo(() => {
    if (!overlayPricingRange) return "—";
    return `${formatCurrency(overlayPricingRange.low, {
      locale: pricingLocale,
      currency: overlayPricingRange.currency,
    })}–${formatCurrency(overlayPricingRange.high, {
      locale: pricingLocale,
      currency: overlayPricingRange.currency,
    })}`;
  }, [overlayPricingRange, pricingLocale]);

  const pricingDetailSummary = useMemo(() => {
    if (!accuratePricing) {
      return { driverLabels: [] as string[], driversTooltipText: null as string | null };
    }
    if (leadGateEnabled && !leadCaptured) {
      return { driverLabels: [] as string[], driversTooltipText: null as string | null };
    }
    const driverLabels = Array.from(
      new Set(
        (accuratePricing.priceDrivers ?? [])
          .map((driver) => (typeof driver?.label === "string" ? driver.label.trim() : ""))
          .filter(Boolean)
      )
    ).slice(0, 3);
    const driverSummary =
      driverLabels.length > 0 ? ` Generated on: ${driverLabels.join(", ")}.` : "";
    const driversTooltipText =
      "Based on the current image and your selections." +
      driverSummary;
    return { driverLabels, driversTooltipText };
  }, [accuratePricing, leadCaptured, leadGateEnabled]);

  const pillLabel = leadGateEnabled ? (leadCaptured ? "EST. PRICING" : "Show pricing") : "EST. PRICING";
  const lockedPillPrice =
    formattedAccuratePricingRange ||
    formattedCachedHeroPricingRange ||
    formattedSeedPricingRange ||
    formattedPricingRange ||
    formattedSeedPricing ||
    "$•••-$•••";
  // Locked state shows the selected hero image's own range first, then falls back to the broader seeded/service range.
  const pillPrice =
    formattedAccuratePricingRange ||
    (accuratePricingStatus === "error" ? lockedPillPrice : leadGateEnabled && leadCaptured ? lockedPillPrice : lockedPillPrice);
  const pillLoading = Boolean(leadGateEnabled && leadCaptured && accuratePricingStatus === "running");
  const shouldShowBottomPricingPill = Boolean(shouldShowPricingPill && lockedPillPrice);
  const shouldShowCenteredPricingFormOverlay = Boolean(
    toolingEnabled && leadGateEnabled && !leadCaptured && showCenteredPricingForm
  );
  const shouldShowBottomControlsRow = Boolean(
    toolingEnabled && !shouldShowCenteredPricingFormOverlay && shouldShowBottomPricingPill
  );
  const previewPricingPillMaxWidth =
    leadGateEnabled && !leadCaptured
      ? 'clamp(37%, 52% - 2vw, 46%)'
      : 'clamp(48%, 64% - 3vw, 58%)';
  const previewPricingPill = shouldShowBottomPricingPill ? (
    <div
      data-pricing-pill
      className="@container ml-auto min-w-0 flex-1 flex flex-col rounded-xl overflow-hidden shadow-lg shadow-black/25 backdrop-blur-md min-w-[9rem] transition-[max-width,padding] duration-300 ease-out"
      style={{
        maxWidth: previewPricingPillMaxWidth,
        minWidth: leadGateEnabled && !leadCaptured ? '14rem' : '16.5rem',
        paddingTop: 'clamp(0.44rem, 1.8vw, 0.64rem)',
        paddingBottom: 'clamp(0.44rem, 1.8vw, 0.64rem)',
        paddingLeft: 'clamp(0.56rem, 2.1vw, 0.78rem)',
        paddingRight: 'clamp(0.56rem, 2.1vw, 0.78rem)',
        backgroundColor: singleModePricingPillBg,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <PricingExperience
        variant="pill"
        className="w-full border-0"
        containerClassName="w-full min-w-0 px-0 py-0"
        transparentBackground
        label={pillLabel}
        termsHref="/terms"
        price={pillPrice || lockedPillPrice}
        loading={pillLoading}
        lockedPrice={lockedPillPrice}
        revealed={leadGateEnabled ? leadCaptured : true}
        allowToggle
        autoReveal
        onClick={
          leadGateEnabled && !leadCaptured
            ? () => {
                setCenteredPricingError(null);
                setCenteredPricingStep("email");
                setShowCenteredPricingForm(true);
                upsertLeadGate(sessionId, "design_and_estimate", { shownAt: Date.now() });
              }
            : () => setOverlayPricingExpanded((prev) => !prev)
        }
        instanceId={leadGateEnabled && leadCaptured ? instanceId : undefined}
        sessionId={leadGateEnabled && leadCaptured ? sessionId : undefined}
        gateContext="design_and_estimate"
        submissionData={{ surface: "preview_pricing" }}
        requirePhone
        helperText={pricingDetailSummary.driversTooltipText || undefined}
        onRevealed={() => {
          setLeadCaptured(true);
          // Pricing fetch triggered by useEffect when leadCaptured becomes true — avoids duplicate requests.
        }}
        accentColor={singleModePricingPillBg}
        style={{ fontFamily: theme.fontFamily, backgroundColor: singleModePricingPillBg, ...pricingPillVars }}
      />
    </div>
  ) : null;
  const uploadControlPositionClass =
    hero && !busy
      ? "top-[calc(env(safe-area-inset-top)+52px)] sm:top-11"
      : "top-[calc(env(safe-area-inset-top)+12px)] sm:top-3";

  useEffect(() => {
    currentHeroRef.current = hero;
  }, [hero]);

  // When image changes (e.g. stack prev/next), use cached pricing if we have it for this image; otherwise invalidate to refetch.
  useEffect(() => {
    if (!hero || !leadCaptured) return;
    if (hero === heroForPricingRef.current) return;
    // Look up by hero URL so we match the actual image (stack always shows images[0] per run)
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
    if (formattedAccuratePricingRange) return;
    if (accuratePricingStatus !== "idle") return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    void fetchAccuratePricingRef.current?.();
  }, [accuratePricingStatus, formattedAccuratePricingRange, leadCaptured, leadGateEnabled]);

  useEffect(() => {
    if (!hero || !leadCaptured || !previewBookingCta.missingUrl) return;
    if (!devMode) return;
    console.warn("[ImagePreviewExperience] Missing booking CTA URL (configure hero_cta_url or step-confirmation scheduleUrl)", {
      instanceId,
      selectedServiceId: selectedServiceIdForCta || null,
    });
  }, [devMode, hero, instanceId, leadCaptured, previewBookingCta.missingUrl, selectedServiceIdForCta]);

  if (!enabled) return null;

  /** Left-rail control sits outside the image frame; ancestors must not clip it. */
  const showGalleryBackControl =
    toolingEnabled && !showConceptPicker && Boolean(hero) && hasMultiImageRun;

  const useResponsiveConceptGalleryShell = showConceptPicker;
  const previewFrameStyle = useResponsiveConceptGalleryShell
    ? {
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        minHeight: 0,
        containerType: "inline-size",
      }
    : {
        width: effectivePreviewSize,
        maxWidth: "100%",
        aspectRatio: "1 / 1",
        maxHeight: effectivePreviewSize,
        containerType: "inline-size",
        // Prevent "starts small then grows" when parent layout hasn't settled yet
        ...((showLoader || busy) && { minWidth: 180, minHeight: 180 }),
      };

  function renderPreview() {
    return (
      <LayoutGroup id={lightboxLayoutId}>
        <>
          {/* min-h-0 + overflow-hidden ensure the card never bleeds outside the flex layout; overflow-visible when stack or left-rail control needs to paint outside */}
          <div
            className={cn(
              "w-full min-h-0",
              useResponsiveConceptGalleryShell ? "flex h-full min-h-0 flex-1 flex-col" : null,
              stackedPreviewLayers.length > 0 || showGalleryBackControl ? "overflow-visible" : "overflow-hidden"
            )}
          >
        <Card
	          className={
	            transparentChrome
	              ? cn(
                    "bg-transparent border-0 shadow-none",
                    stackedPreviewLayers.length > 0 || showGalleryBackControl ? "overflow-visible" : "overflow-hidden",
                    useResponsiveConceptGalleryShell ? "flex h-full min-h-0 flex-1 flex-col" : null
                  )
              : cn(
                  "bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60 border-border",
                  stackedPreviewLayers.length > 0 || showGalleryBackControl ? "overflow-visible" : "overflow-hidden",
                  useResponsiveConceptGalleryShell ? "flex h-full min-h-0 flex-1 flex-col" : null
                )
          }
	        >
	          <CardContent
              className={cn(
                previewMaxPx ? "p-0" : transparentChrome ? "p-0" : "p-3",
                useResponsiveConceptGalleryShell ? "flex h-full min-h-0 flex-col" : null,
                stackedPreviewLayers.length > 0 || showGalleryBackControl ? "overflow-visible" : "overflow-hidden"
              )}
            >
	            {previewMaxPx && chromePx > 0 ? <div style={{ height: chromePx }} /> : null}
            <div
              className={cn(
                "flex",
                useResponsiveConceptGalleryShell ? "h-full min-h-0 justify-stretch" : "justify-center",
              )}
            >
              <div
                className={cn(
                  useResponsiveConceptGalleryShell ? "contents" : "flex w-full flex-col items-center gap-3",
                  !useResponsiveConceptGalleryShell && stackedPreviewLayers.length > 0 && "pl-14",
                )}
              >
	            <div
				              className={cn(
                        "relative mx-auto",
                        useResponsiveConceptGalleryShell ? "flex h-full min-h-0 w-full max-w-none flex-col overflow-hidden" : "overflow-visible"
                      )}
				              style={previewFrameStyle}
			            >
			              {/* Keep prior previews visually present, but only use the deck animation when browsing history. */}
				              <AnimatePresence initial={false}>
				                {stackedPreviewLayers.map((layerConfig, idx) => {
				                  const layer = idx + 1;
				                  const isTransitionLayer = layerConfig.kind === "transition";
				                  const x = -(14 + idx * 10);
				                  const y = 2 + idx * 2;
				                  const rotate = -0.45 - idx * 0.18;
				                  const scale = 0.986 - idx * 0.022;
				                  const blurPx = isTransitionLayer ? 1.2 + idx * 1.2 : 2.4 + idx * 1.5;
				                  const layerOpacity = isTransitionLayer ? Math.max(0.5, 0.7 - idx * 0.08) : Math.max(0.18, 0.34 - idx * 0.09);
				                  const layerOverlay = isTransitionLayer ? Math.min(0.72, 0.54 + idx * 0.08) : Math.min(0.86, 0.64 + idx * 0.1);
				                  return (
				                    <motion.div
				                      key={layerConfig.key}
				                      className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none"
				                      style={{
				                        zIndex: layer,
				                        border: "1px solid rgba(255,255,255,0.2)",
				                        boxShadow: isTransitionLayer
				                          ? "0 18px 34px rgba(0,0,0,0.28)"
				                          : "0 8px 20px rgba(0,0,0,0.22)",
				                        backgroundColor: "#0f172a",
				                      }}
				                      initial={
				                        isTransitionLayer
				                          ? { x: 0, y: 0, rotate: 0, scale: 1.01, opacity: 0.84 }
				                          : { x: x + 6, y, rotate: rotate - 0.08, scale, opacity: 0 }
				                      }
				                      animate={{ x, y, rotate, scale, opacity: layerOpacity }}
				                      exit={
				                        isTransitionLayer
				                          ? { x, y: y + 2, rotate, scale, opacity: 0 }
				                          : { x: x - 4, y, rotate, scale, opacity: 0 }
				                      }
				                      transition={{ duration: isTransitionLayer ? 0.26 : 0.18, ease: [0.22, 1, 0.36, 1] }}
				                    >
				                      {/* eslint-disable-next-line @next/next/no-img-element */}
				                      <img
                                src={layerConfig.src}
                                alt=""
                                aria-hidden
                                className="h-full w-full object-cover"
                                style={{
                                  filter: `blur(${blurPx}px) saturate(0.85) brightness(${isTransitionLayer ? 0.84 : 0.72})`,
                                  transform: "scale(1.02)",
                                }}
                              />
				                      <div
				                        className="absolute inset-0 pointer-events-none"
				                        style={{
				                          background: `radial-gradient(120% 100% at 50% 50%, rgba(15,23,42,${Math.max(0.4, layerOverlay - 0.18)}) 0%, rgba(15,23,42,${layerOverlay}) 72%, rgba(15,23,42,${Math.min(0.92, layerOverlay + 0.14)}) 100%)`,
				                        }}
				                      />
				                    </motion.div>
				                  );
				                })}
				              </AnimatePresence>

              {/* Left rail: sibling of the clipped image shell so negative translate is not cut off. */}
              {showGalleryBackControl ? (
                <div className="absolute left-0 top-1/2 z-30 -translate-x-[calc(100%+0.75rem)] -translate-y-1/2 pointer-events-none flex">
                  <div className="pointer-events-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setCache((prev) => {
                          const base = prev ?? loadCache(instanceId, sessionId);
                          if (!base) return prev;
                          const runWithGrid = runs.find((r) => r.images && r.images.length > 1);
                          const next: PreviewCacheV3 = {
                            ...base,
                            viewMode: "gallery",
                            activeRunId: activeRunHasMultiple ? base.activeRunId : runWithGrid?.id ?? base.activeRunId,
                            selectedConceptIndex: null,
                            updatedAt: Date.now(),
                          };
                          saveCache(instanceId, sessionId, next);
                          return next;
                        });
                      }}
                      aria-label="Back to gallery"
                      title="Back to gallery"
                      className={overlayButtonClass}
                      style={{ fontFamily: theme.fontFamily, ...singleModeOverlayVars }}
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span className="font-medium">Back to gallery</span>
                    </button>
                  </div>
                </div>
              ) : null}

				              <div
				                className={cn(
				                  useResponsiveConceptGalleryShell
                            ? "relative z-20 flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl bg-muted/30"
                            : "absolute inset-0 z-20 overflow-hidden rounded-xl",
				                  // Gallery mode: always solid so it never overlays/bleeds into single view.
				                  // Single mode: transparent ok when chrome is transparent (stack shows to the left).
				                  !useResponsiveConceptGalleryShell && (transparentChrome && !showConceptPicker ? "bg-transparent" : "bg-muted/30")
				                )}
				              >
	            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (uploadInputRef.current) uploadInputRef.current.value = "";
                void handleOwnImageUpload(files);
              }}
	            />

              {hero && isPlaceholderHero ? (
                <div className="absolute left-2 top-2 z-10">
                  <div
                    className="rounded-xl px-3 py-2 text-[0.6875rem] font-medium text-white/95 shadow-sm backdrop-blur-md bg-[var(--sif-overlay-bg)]"
                    style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                  >
                    Demo preview (not generated)
                  </div>
                </div>
              ) : null}

              {/* Top controls: compact layout so actions stay available but less visually busy */}
              {toolingEnabled && !showConceptPicker && hero ? (
                <div className="absolute inset-x-2 top-2 z-10 flex items-start justify-between pointer-events-none">
                  <div className="pointer-events-auto flex items-center gap-1.5">
                    {hero && !busy ? (
                      leadGateEnabled && !leadCaptured ? (
                        <LeadGenPopover
                          open={showGenerateGate}
                          onOpenChange={(open) => {
                            if (!open) {
                              pendingActionRef.current = null;
                              pendingGenerateModeRef.current = "manual";
                              gateContextRef.current = "design_and_estimate";
                            }
                            setShowGenerateGate(open);
                          }}
                          instanceId={instanceId}
                          sessionId={sessionId}
                          gateContext={gateContextRef.current || "regenerate_manual"}
                          surface="overlay"
                          contentStyle={singleModeOverlayVars}
                          {...PRICING_LEAD_COPY}
                          requirePhone
                          submitOnEmail={false}
                          submissionData={{ surface: "preview_generate" }}
                          side="bottom"
                          align="start"
                          sideOffset={6}
                          onSubmitted={() => {
                            setLeadCaptured(true);
                            const action = pendingActionRef.current;
                            const mode = pendingGenerateModeRef.current;
                            pendingActionRef.current = null;
                            pendingGenerateModeRef.current = "manual";
                            if (action === "refresh") void runGenerate(mode);
                          }}
                        >
                          <button
                            type="button"
                            disabled={busy || !canRegenerateInGallery}
                            onClick={handleRefreshClick}
                            className={overlayButtonClass}
                            aria-label={showConceptPicker ? "Regenerate ideas" : "Not what you want? Try again"}
                            style={{ fontFamily: theme.fontFamily, ...singleModeOverlayVars }}
                          >
                            {showConceptPicker ? (
                              <span className="font-medium">Regenerate</span>
                            ) : (
                              <>
                                <span className="opacity-65">Not what you want?</span>
                                <span className="font-medium">Try again</span>
                              </>
                            )}
                          </button>
                        </LeadGenPopover>
                      ) : (
                        <button
                          type="button"
                          disabled={busy || !canRegenerateInGallery}
                          onClick={handleRefreshClick}
                          className={overlayButtonClass}
                          aria-label={showConceptPicker ? "Regenerate ideas" : "Not what you want? Try again"}
                          style={{ fontFamily: theme.fontFamily, ...singleModeOverlayVars }}
                        >
                          {showConceptPicker ? (
                            <span className="font-medium">Regenerate</span>
                          ) : (
                            <>
                              <span className="opacity-65">Not what you want?</span>
                              <span className="font-medium">Try again</span>
                            </>
                          )}
                        </button>
                      )
                    ) : null}
                  </div>

                  <div
                    className="pointer-events-auto flex items-center gap-1.5 text-white"
                    style={{ fontFamily: theme.fontFamily, ...singleModeOverlayVars }}
                  >
                    {/* Download and expand only in single view — not meaningful in gallery picker mode */}
                    {!showConceptPicker ? (
                      <>
                        {leadGateEnabled ? (
                          <LeadGenPopover
                        open={showDownloadGate}
                        onOpenChange={(v) => {
                          if (!v) {
                            pendingActionRef.current = null;
                            setShowDownloadGate(false);
                          }
                        }}
                        instanceId={instanceId}
                        sessionId={sessionId}
                        gateContext="download"
                        surface="overlay"
                        contentStyle={singleModeOverlayVars}
                        {...PRICING_LEAD_COPY}
                        side="top"
                        align="end"
                        sideOffset={4}
                        requirePhone
                        submitOnEmail={false}
                        submissionData={{ surface: "preview_download" }}
                        onSubmitted={async () => {
                          setLeadCaptured(true);
                          const action = pendingActionRef.current;
                          pendingActionRef.current = null;
                          if (action === "download") await downloadActiveImage();
                        }}
                      >
                        <button
                          type="button"
                          disabled={busy || !hero}
                          onClick={handleDownloadClick}
                          className={overlayIconButtonClass}
                          aria-label="Download preview"
                          title="Download preview"
                        >
                          <Download className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </button>
                      </LeadGenPopover>
                        ) : (
                          <button
                            type="button"
                            disabled={busy || !hero}
                            onClick={handleDownloadClick}
                            className={overlayIconButtonClass}
                            aria-label="Download preview"
                            title="Download preview"
                          >
                            <Download className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={openLightbox}
                          disabled={!hero}
                          aria-label="View larger"
                          title="View larger"
                          className={overlayIconButtonClass}
                        >
                          <Maximize2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </button>
                      </>
                    ) : null}

                  </div>
                </div>
              ) : null}

	            {/* Two distinct modes: gallery picker vs single hero image. Only one renders. */}
	            <div
                className={cn(
                  "flex h-full w-full min-h-0 flex-col",
                  showConceptPicker ? "overflow-hidden" : null
                )}
                data-preview-mode={showConceptPicker ? "gallery" : hero ? "single" : "empty"}
              >
	              {showConceptPicker ? (
	                <div
	                  className="relative flex h-full min-h-0 w-full flex-col gap-1.5 p-1.5 pr-1 isolate sm:p-2 sm:pr-1.5"
	                >
                  {showProgressiveGalleryLoader ? (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
                      <div
                        className="inline-flex max-w-full items-center justify-center gap-2 rounded-full bg-black/60 px-4 py-2 text-[13px] font-semibold text-white shadow-sm backdrop-blur-md"
                        style={{ fontFamily: theme.fontFamily }}
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white/80" />
                        <span className="truncate">{galleryLoadingMessage}</span>
                      </div>
                    </div>
                  ) : null}
                  {!showProgressiveGalleryLoader ? (
                    <div className="space-y-0.5 text-center">
                      <p
                        className="text-[13px] sm:text-sm font-semibold leading-tight whitespace-nowrap overflow-hidden text-ellipsis"
                        style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                      >
                        Here are similar examples and price ranges. Tap one to see your exact pricing.
                      </p>
                      <p
                        className="text-[10px] sm:text-[11px] leading-tight whitespace-nowrap overflow-hidden text-ellipsis"
                        style={{ color: theme.textColor, fontFamily: theme.fontFamily, opacity: 0.75 }}
                      >
                        Based on real examples similar to yours
                      </p>
                    </div>
                  ) : null}
                  <div
                    className="w-full min-w-0 flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y"
                    style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" } as React.CSSProperties}
                  >
                    <div className="grid w-full min-w-0 min-h-[360px] content-start grid-cols-1 gap-1.5 py-0 min-[420px]:grid-cols-2 md:grid-cols-3">
	                    {Array.from({
                        length: Math.max(
                          1,
                          showProgressiveGalleryLoader
                            ? progressiveGalleryCellCount
                            : Math.min(activeRunExpectedImageCount, conceptGalleryTargetCount)
                        ),
                      }).map((_, idx) => {
                        const src = activeRun?.images?.[idx] ?? null;
                        const tilePricing = activeRun?.imagePricing?.[idx];
                        const tilePriceText = formatPricingRangeText({
                          pricing: tilePricing,
                          locale: pricingLocale,
                          currency: pricingCurrency,
                        });
                        const tilePriceMask = splitPricingMaskSegments(tilePriceText);
                        const shouldBlurTilePrice = Boolean(leadGateEnabled && !leadCaptured);
                        if (!src) {
                          return (
                            <div
                              key={idx}
                              className="relative aspect-square w-full min-h-0 overflow-hidden rounded-lg border border-white/8 bg-white/[0.03]"
                              style={{
                                borderRadius: (designConfig as any)?.gallery_image_border_radius ?? 8,
                              }}
                              aria-hidden="true"
                            >
                              <div className="absolute inset-0 bg-black/10" />
                              <Skeleton className="absolute inset-0 h-full w-full rounded-none bg-white/[0.09]" />
                            </div>
                          );
                        }
                        return (
	                      <button
	                        key={idx}
	                        type="button"
	                        onClick={() => {
	                          setCache((prev) => {
	                            const base = prev ?? loadCache(instanceId, sessionId);
	                            if (!base) return prev;
	                            const next: PreviewCacheV3 = {
	                              ...base,
	                              selectedConceptIndex: idx,
	                              viewMode: "single",
	                              updatedAt: Date.now(),
	                            };
	                            saveCache(instanceId, sessionId, next);
	                            return next;
	                          });
	                        }}
	                        className={cn(
                            "group relative aspect-square w-full min-h-0 overflow-hidden rounded-lg border bg-black/10 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 transition-all duration-200 md:hover:shadow-xl md:hover:scale-[1.02]",
                            selectedConceptIndex === idx ? "border-white/80 ring-2 ring-white/50" : "border-white/20 md:hover:border-white/50"
                          )}
	                        style={{
	                          borderRadius: (designConfig as any)?.gallery_image_border_radius ?? 8,
	                        }}
	                        aria-label={`Select option ${idx + 1}`}
                          aria-pressed={selectedConceptIndex === idx}
	                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`Concept ${idx + 1}`}
                          className="h-full w-full object-cover transition-transform duration-200 md:group-hover:scale-[1.02]"
                        />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end p-2.5">
                          <div
                            className="flex h-9 min-w-[7rem] max-w-[calc(100%-0.5rem)] items-center justify-center rounded-full bg-black/60 px-3"
                            aria-hidden="true"
                          >
                            {shouldBlurTilePrice && tilePriceMask ? (
                              <span className="select-none truncate text-[12px] font-semibold text-white/95">
                                <span>{tilePriceMask.prefix}</span>
                                <span className={cn("opacity-95", tilePriceMask.blur ? "blur-[0.28em]" : null)}>
                                  {tilePriceMask.blur}
                                </span>
                              </span>
                            ) : (
                              <span className="select-none truncate text-[12px] font-semibold text-white/95">
                                {tilePriceText || "$•••-$•••"}
                              </span>
                            )}
                          </div>
                        </div>
	                      </button>
                        );
                      })}
	                    </div>
	                  </div>
	                </div>
	              ) : hero ? (
	                <div
	                  className="h-full w-full cursor-zoom-in isolate"
	                  role="button"
	                  tabIndex={0}
	                  aria-label="Open larger preview"
	                  onClick={openLightbox}
	                  onKeyDown={(e) => {
	                    if (e.key === "Enter" || e.key === " ") {
	                      e.preventDefault();
	                      openLightbox();
	                    }
	                  }}
	                >
	                  {/* eslint-disable-next-line @next/next/no-img-element */}
	                  <img
	                    src={hero}
	                    alt="Preview"
	                    className="h-full w-full object-cover"
	                  />
	                </div>
	              ) : (
	                <div className="h-full w-full bg-muted/40 isolate" />
	              )}
	            </div>

            {/* Top-left: form-step upload thumbnail OR "upload your own image" button.
                Hidden when: (a) dedicated upload CTA step is showing below, or (b) image is generating and no thumbnail yet. */}
            {toolingEnabled ? (
            <div
              className={cn(
                "absolute left-3 z-20 flex items-center gap-2",
                uploadControlPositionClass,
                "!hidden",
                hero ? "hidden" : null,
                !formStepUploadThumbnail && (suppressUploadOverlay || showLoader || busy) ? "hidden" : null
              )}
            >

              {formStepUploadThumbnail ? (
                <>
                  {/* User already uploaded via the form's upload step — show thumbnail + change action */}
                  <div
                    className="h-10 w-10 sm:h-9 sm:w-9 flex-shrink-0 rounded-xl overflow-hidden border border-white/20 shadow-sm"
                    title="Your uploaded photo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={formStepUploadThumbnail} alt="Your uploaded photo" className="h-full w-full object-cover" />
                  </div>
                  {leadGateEnabled ? (
                    <LeadGenPopover
                      open={showUploadGate}
                      onOpenChange={(v) => {
                        if (!v) {
                          pendingActionRef.current = null;
                          setShowUploadGate(false);
                        }
                      }}
                      instanceId={instanceId}
                      sessionId={sessionId}
                      gateContext="upload_reference"
                      surface="overlay"
                      contentStyle={overlayVars}
                      {...PRICING_LEAD_COPY}
                      side="top"
                      align="start"
                      sideOffset={8}
                      requirePhone
                      submitOnEmail={false}
                      submissionData={{ surface: "preview_change_reference" }}
                      onSubmitted={() => {
                        setLeadCaptured(true);
                        const action = pendingActionRef.current;
                        pendingActionRef.current = null;
                        if (action === "upload") uploadInputRef.current?.click();
                      }}
                    >
                      <button
                        type="button"
                        disabled={isUploadingOwnImages || busy}
                        onClick={handleUploadClick}
                        className={overlayButtonClass}
                        aria-label="Change uploaded image"
                        style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                      >
                        {isUploadingOwnImages ? "Uploading…" : "Change image"}
                      </button>
                    </LeadGenPopover>
                  ) : (
                    <button
                      type="button"
                      disabled={isUploadingOwnImages || busy}
                      onClick={handleUploadClick}
                      className={overlayButtonClass}
                      aria-label="Change uploaded image"
                      style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                    >
                      {isUploadingOwnImages ? "Uploading…" : "Change image"}
                    </button>
                  )}
                </>
              ) : (
                /* No form-step upload yet — offer the preview-level "Upload your own image" button */
                leadGateEnabled ? (
                  <LeadGenPopover
                    open={showUploadGate}
                    onOpenChange={(v) => {
                      if (!v) {
                        pendingActionRef.current = null;
                        setShowUploadGate(false);
                      }
                    }}
                    instanceId={instanceId}
                    sessionId={sessionId}
                    gateContext="upload_reference"
                    surface="overlay"
                    contentStyle={overlayVars}
                    {...PRICING_LEAD_COPY}
                    side="top"
                    align="start"
                    sideOffset={8}
                    requirePhone
                    submitOnEmail={false}
                    submissionData={{ surface: "preview_upload_reference" }}
                    onSubmitted={() => {
                      setLeadCaptured(true);
                      const action = pendingActionRef.current;
                      pendingActionRef.current = null;
                      if (action === "upload") uploadInputRef.current?.click();
                    }}
                  >
                    <button
                      type="button"
                      disabled={isUploadingOwnImages || busy}
                      onClick={handleUploadClick}
                      className={overlayButtonClass}
                      aria-label="Upload your own image"
                      style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                    >
                      {isUploadingOwnImages ? "Uploading…" : "Upload your own image"}
                    </button>
                  </LeadGenPopover>
                ) : (
                  <button
                    type="button"
                    disabled={isUploadingOwnImages || busy}
                    onClick={handleUploadClick}
                    className={overlayButtonClass}
                    aria-label="Upload your own image"
                    style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                  >
                    {isUploadingOwnImages ? "Uploading…" : "Upload your own image"}
                  </button>
                )
              )}

            </div>
            ) : null}


            {/* Uploaded images count is shown inline on the upload button */}

            {showOverlayLoader ? (
              <div
                className={cn(
                  "absolute inset-0 flex items-center justify-center",
                  showRefreshMask ? "z-20 bg-black/15" : null
                )}
              >
                <AdventureLoader
                  phase={
                    (cache?.message?.toLowerCase().includes("refreshing") || hero)
                      ? "preview_refreshing"
                      : cache?.message?.toLowerCase().includes("fine-tuning")
                        ? "preview_refining"
                        : "preview_generating"
                  }
                  variant="pill"
                  size="sm"
                  tone="overlay"
                  active={busy}
                  messageOverride={cache?.message || (hero ? "Refreshing your design…" : GALLERY_LOADING_TITLE)}
                  className="bg-slate-900/75"
                  style={{ ...overlayVars }}
                />
              </div>
            ) : null}

	              {cache?.status === "error" && cache?.error ? (
	                <div className="absolute inset-0 flex items-end">
                  <div className="w-full p-3 bg-gradient-to-t from-black/70 via-black/25 to-transparent">
                    <div className="text-xs font-medium text-white">Having trouble updating the preview image.</div>
                    <div className="mt-1 text-xs text-white/90">{cache.error}</div>
                    {cache.errorDetails ? (
                      <div className="mt-1 text-[0.6875rem] text-white/70 break-words">{cache.errorDetails}</div>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void runGenerate("manual")}
                        style={{ fontFamily: theme.fontFamily }}
                      >
                        Try again
                      </Button>
                    </div>
                  </div>
	                </div>
	              ) : null}

              {!lightboxOpen && shouldShowCenteredPricingFormOverlay ? (
                <div
                  className="absolute inset-0 z-30 flex items-end justify-end pointer-events-none"
                  style={{ padding: centeredPricingOverlayInset }}
                >
                  <div
                    className={cn(
                      "pointer-events-auto overflow-visible shadow-[0_10px_28px_rgba(15,23,42,0.24)] transition-[width,transform] duration-200",
                      showCenteredPricingForm ? "min-h-0" : "h-auto"
                    )}
                    style={{
                      width: centeredPricingPanelWidth,
                      maxWidth: "100%",
                      borderRadius: centeredPricingPanelRadius,
                      backgroundColor: singleModePricingPillBg,
                      border: `1px solid ${overlayBorder}`,
                      WebkitBackdropFilter: "blur(12px)",
                      backdropFilter: "blur(12px)",
                      containerType: "inline-size",
                    }}
                  >
                    <div
                      className="relative flex w-full flex-col"
                      style={{
                        padding: centeredPricingPanelPadding,
                        gap: centeredPricingPanelGap,
                      }}
                    >
                        <div
                          className="box-border flex w-full flex-col"
                          style={{ fontFamily: theme.fontFamily, gap: centeredPricingPanelGap, ...pricingPillVars }}
                        >
                          <div className="flex items-center" style={{ gap: centeredPricingHeaderGap }}>
                            <button
                              type="button"
                              onClick={() => {
                                setCenteredPricingError(null);
                                if (centeredPricingStep === "phone") {
                                  setCenteredPricingStep("name");
                                  return;
                                }
                                if (centeredPricingStep === "name") {
                                  setCenteredPricingStep("email");
                                  return;
                                }
                                setShowCenteredPricingForm(false);
                              }}
                              className="flex shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                              style={{
                                width: centeredPricingIconButtonSize,
                                height: centeredPricingIconButtonSize,
                              }}
                              aria-label={centeredPricingStep === "email" ? "Close pricing form" : "Back"}
                            >
                              <ArrowLeft style={{ width: centeredPricingIconSize, height: centeredPricingIconSize }} strokeWidth={2.5} />
                            </button>
                            <div
                              className="min-w-0 flex-1 font-semibold leading-tight text-[var(--sif-lead-gen-fg)]"
                              style={{ fontSize: centeredPricingTitleSize }}
                            >
                              {centeredPricingStep === "email"
                                ? PRICING_LEAD_COPY.title
                                : centeredPricingStep === "name"
                                  ? PRICING_LEAD_MODAL.nameTitle
                                  : PRICING_LEAD_COPY.phoneTitle}
                            </div>
                          </div>

                          {centeredPricingStep === "email" ? (
                            <div
                              className="text-[var(--sif-lead-gen-muted)]"
                              style={{ fontSize: centeredPricingMetaSize, fontFamily: theme.fontFamily }}
                            >
                              {PRICING_LEAD_COPY.description}
                            </div>
                          ) : centeredPricingStep === "name" ? (
                            <div
                              className="text-[var(--sif-lead-gen-muted)]"
                              style={{ fontSize: centeredPricingMetaSize, fontFamily: theme.fontFamily }}
                            >
                              {PRICING_LEAD_MODAL.nameDescription}
                            </div>
                          ) : (
                            <div
                              className="text-[var(--sif-lead-gen-muted)]"
                              style={{ fontSize: centeredPricingMetaSize, fontFamily: theme.fontFamily }}
                            >
                              {PRICING_LEAD_COPY.phoneDescription}
                            </div>
                          )}

                          {centeredPricingStep === "email" ? (
                            <div className="flex items-center" style={{ gap: centeredPricingHeaderGap }}>
                              <div className="relative min-w-0 flex-1">
                                <Mail
                                  className="absolute top-1/2 -translate-y-1/2 text-[var(--sif-lead-gen-muted)]"
                                  style={{ left: centeredPricingIconInset, width: centeredPricingIconSize, height: centeredPricingIconSize }}
                                />
                                <Input
                                  autoFocus
                                  value={centeredPricingEmail}
                                  onChange={(e) => setCenteredPricingEmail(e.target.value)}
                                  placeholder={PRICING_LEAD_COPY.emailPlaceholder}
                                  inputMode="email"
                                  className="rounded-xl border-0 bg-[var(--sif-lead-gen-input-bg)] text-[var(--sif-lead-gen-fg)] placeholder:text-[color:var(--sif-lead-gen-placeholder)] focus-visible:ring-2 focus-visible:ring-offset-0"
                                  style={{
                                    height: centeredPricingInputHeight,
                                    paddingLeft: centeredPricingInputPadLeft,
                                    paddingRight: "clamp(0.95rem, 3cqi, 1rem)",
                                    fontSize: centeredPricingInputTextSize,
                                    fontFamily: theme.fontFamily,
                                    ["--tw-ring-color" as const]: "var(--sif-lead-gen-ring)",
                                  } as React.CSSProperties}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void handleCenteredPricingEmailSubmit();
                                  }}
                                />
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                disabled={isSubmittingCenteredPricingLead || !isValidEmail(centeredPricingEmail)}
                                onClick={() => void handleCenteredPricingEmailSubmit()}
                                className="flex shrink-0 whitespace-nowrap items-center rounded-full border-0 bg-[var(--sif-lead-gen-action-bg)] font-medium leading-none text-[var(--sif-lead-gen-action-fg)] shadow-sm hover:brightness-[0.96]"
                                style={{
                                  height: centeredPricingActionHeight,
                                  paddingLeft: centeredPricingActionPadX,
                                  paddingRight: centeredPricingActionPadX,
                                  fontSize: centeredPricingMetaSize,
                                  fontFamily: theme.fontFamily,
                                }}
                              >
                                {PRICING_LEAD_COPY.ctaLabel}
                              </Button>
                            </div>
                          ) : centeredPricingStep === "name" ? (
                            <div className="flex items-center" style={{ gap: centeredPricingHeaderGap }}>
                              <div className="min-w-0 flex-1">
                                <Input
                                  autoFocus
                                  value={centeredPricingName}
                                  onChange={(e) => setCenteredPricingName(e.target.value)}
                                  placeholder={PRICING_LEAD_MODAL.namePlaceholder}
                                  autoComplete="name"
                                  className="rounded-xl border-0 bg-[var(--sif-lead-gen-input-bg)] px-4 text-[var(--sif-lead-gen-fg)] placeholder:text-[color:var(--sif-lead-gen-placeholder)] focus-visible:ring-2 focus-visible:ring-offset-0"
                                  style={{
                                    height: centeredPricingInputHeight,
                                    fontSize: centeredPricingInputTextSize,
                                    fontFamily: theme.fontFamily,
                                    ["--tw-ring-color" as const]: "var(--sif-lead-gen-ring)",
                                  } as React.CSSProperties}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void handleCenteredPricingNameSubmit();
                                  }}
                                />
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                disabled={isSubmittingCenteredPricingLead || !isValidFullName(centeredPricingName)}
                                onClick={() => void handleCenteredPricingNameSubmit()}
                                className="flex shrink-0 whitespace-nowrap items-center rounded-full border-0 bg-[var(--sif-lead-gen-action-bg)] font-medium leading-none text-[var(--sif-lead-gen-action-fg)] shadow-sm hover:brightness-[0.96]"
                                style={{
                                  height: centeredPricingActionHeight,
                                  paddingLeft: centeredPricingActionPadX,
                                  paddingRight: centeredPricingActionPadX,
                                  fontSize: centeredPricingMetaSize,
                                  fontFamily: theme.fontFamily,
                                }}
                              >
                                {PRICING_LEAD_MODAL.nameCtaLabel}
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center" style={{ gap: centeredPricingHeaderGap }}>
                              <div className="relative min-w-0 flex-1">
                                <Phone
                                  className="absolute top-1/2 -translate-y-1/2 text-[var(--sif-lead-gen-muted)]"
                                  style={{ left: centeredPricingIconInset, width: centeredPricingIconSize, height: centeredPricingIconSize }}
                                />
                                <Input
                                  autoFocus
                                  value={centeredPricingPhone}
                                  onChange={(e) => setCenteredPricingPhone(formatPhoneInput(e.target.value).display)}
                                  placeholder="(555) 123-4567"
                                  inputMode="tel"
                                  className="rounded-xl border-0 bg-[var(--sif-lead-gen-input-bg)] text-[var(--sif-lead-gen-fg)] placeholder:text-[color:var(--sif-lead-gen-placeholder)] focus-visible:ring-2 focus-visible:ring-offset-0"
                                  style={{
                                    height: centeredPricingInputHeight,
                                    paddingLeft: centeredPricingInputPadLeft,
                                    paddingRight: "clamp(0.95rem, 3cqi, 1rem)",
                                    fontSize: centeredPricingInputTextSize,
                                    fontFamily: theme.fontFamily,
                                    ["--tw-ring-color" as const]: "var(--sif-lead-gen-ring)",
                                  } as React.CSSProperties}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void handleCenteredPricingPhoneSubmit();
                                  }}
                                />
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                disabled={isSubmittingCenteredPricingLead}
                                onClick={() => void handleCenteredPricingPhoneSubmit()}
                                className="flex shrink-0 whitespace-nowrap items-center rounded-full border-0 bg-[var(--sif-lead-gen-action-bg)] font-medium leading-none text-[var(--sif-lead-gen-action-fg)] shadow-sm hover:brightness-[0.96]"
                                style={{
                                  height: centeredPricingActionHeight,
                                  paddingLeft: centeredPricingActionPadX,
                                  paddingRight: centeredPricingActionPadX,
                                  fontSize: centeredPricingMetaSize,
                                  fontFamily: theme.fontFamily,
                                }}
                              >
                                {isSubmittingCenteredPricingLead ? (
                                  <Loader2 className="animate-spin" style={{ width: centeredPricingIconSize, height: centeredPricingIconSize }} />
                                ) : (
                                  PRICING_LEAD_COPY.phoneCtaLabel
                                )}
                              </Button>
                            </div>
                          )}

                          {centeredPricingError ? (
                            <div className="leading-relaxed text-red-200" style={{ fontSize: centeredPricingMetaSize }}>
                              {centeredPricingError}
                            </div>
                          ) : (
                            <div
                              className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 leading-relaxed text-[var(--sif-lead-gen-muted)]"
                              style={{ fontSize: centeredPricingMetaSize }}
                            >
                              <span>
                                {centeredPricingStep === "email"
                                  ? PRICING_LEAD_COPY.finePrint
                                  : centeredPricingStep === "name"
                                    ? PRICING_LEAD_MODAL.nameFinePrint
                                    : PRICING_LEAD_MODAL.phoneFinePrint}
                              </span>
                              {centeredPricingStep === "phone" ? (
                                <a
                                  href="/terms"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="shrink-0 underline underline-offset-2 hover:text-[var(--sif-lead-gen-fg)]"
                                  style={{ fontFamily: theme.fontFamily }}
                                >
                                  Terms
                                </a>
                              ) : null}
                            </div>
                          )}
                        </div>
                    </div>
                  </div>
                </div>
              ) : null}
	              </div>{/* end inner overflow-hidden container */}

              {/* Bottom overlay: collapsible estimate bar (no budget slider). */}
              {!lightboxOpen && shouldShowBottomControlsRow ? (
                <div className="absolute bottom-3 left-3 right-3 z-30 pointer-events-auto sm:left-4 sm:right-4 sm:bottom-4">
                  {overlayPricingExpanded && (!leadGateEnabled || leadCaptured) && hero ? (
                    <div
                      className="w-full rounded-2xl border border-white/10 shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-md"
                      style={{
                        // Keep glass color consistent with the pill.
                        backgroundColor: singleModePricingPillBg,
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                        fontFamily: theme.fontFamily,
                      }}
                      data-overlay-estimate-expanded
                    >
                      <div className="relative p-3 sm:p-4">
                        {/* subtle inner sheen + vignette (keeps same base glass color) */}
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-0 rounded-2xl"
                          style={{
                            background:
                              "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 22%, rgba(0,0,0,0.00) 55%), radial-gradient(120% 140% at 0% 0%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.00) 55%), radial-gradient(120% 140% at 100% 100%, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.00) 55%)",
                          }}
                        />

                        <div className="relative flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="inline-flex items-center gap-2">
                              <div className="text-[10px] font-semibold tracking-[0.18em] text-white/65">ESTIMATE</div>
                              <div className="h-[1px] w-10 bg-white/15" aria-hidden />
                              <div className="text-[10px] font-medium text-white/55">Based on similar projects</div>
                            </div>

                            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                              <div className="text-[32px] font-semibold tabular-nums leading-none tracking-tight text-white sm:text-[40px]">
                                {overlayPricingMidpointLabel}
                              </div>
                              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/80">
                                {overlayPricingRangeLabel}
                              </div>
                            </div>

                            <div className="mt-1.5 text-[10px] leading-snug text-white/55 sm:text-[11px]">
                              Final quotes can change with measurements, materials, and local availability.
                            </div>
                          </div>

                          <button
                            type="button"
                            className="shrink-0 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/85 hover:bg-white/10"
                            onClick={() => setOverlayPricingExpanded(false)}
                            aria-label="Collapse pricing"
                            title="Collapse"
                          >
                            Collapse
                          </button>
                        </div>

                        <div className="relative mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center sm:gap-4">
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              "Based on real projects",
                              "Materials + labor",
                              "No obligation quote",
                            ].map((label) => (
                              <span
                                key={label}
                                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/75"
                              >
                                {label}
                              </span>
                            ))}
                          </div>

                          <div className="flex flex-col gap-2">
                            {previewBookingCta.primaryUrl ? (
                              <Button
                                asChild
                                className="h-10 w-full rounded-full text-xs font-semibold shadow-sm"
                                style={{ backgroundColor: primary, color: "#fff" }}
                              >
                                <a href={previewBookingCta.primaryUrl} target="_blank" rel="noopener noreferrer">
                                  {previewBookingCta.primaryLabel}
                                </a>
                              </Button>
                            ) : null}
                            {onKeepDesigning ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onKeepDesigning();
                                  setOverlayPricingExpanded(false);
                                }}
                                className="h-9 w-full rounded-full border border-white/15 bg-white/5 px-3 text-[11px] font-semibold text-white/90 hover:bg-white/10"
                              >
                                Keep designing
                              </button>
                            ) : null}
                            <div className="text-center text-[10px] text-white/60">Talk to a specialist • No obligation</div>
                            <button
                              type="button"
                              disabled={isUploadingOwnImages || busy}
                              onClick={handleUploadClick}
                              className="text-center text-[11px] font-medium underline-offset-2 hover:underline"
                              style={{ color: theme.primaryColor || "#3b82f6" }}
                            >
                              {isUploadingOwnImages ? "Uploading…" : "Want this on your actual space?"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-stretch justify-end gap-2 sm:gap-3">{previewPricingPill}</div>
                  )}
                </div>
              ) : null}

	              {/* Side navigation arrows — outside the clipped inner container */}
	              {hero && canPrev && (
	                <button
	                  type="button"
	                  onClick={goPrev}
	                  className="absolute left-0 top-1/2 -translate-y-1/2 z-30 flex h-16 w-8 sm:h-20 sm:w-9 items-center justify-center rounded-r-lg border-y border-r border-white/20 bg-black/25 text-3xl sm:text-4xl font-thin leading-none text-white/90 transition-colors hover:bg-black/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
	                  aria-label="Previous preview"
	                >
	                  ‹
	                </button>
	              )}
	              {hero && canNext && (
	                <button
	                  type="button"
	                  onClick={goNext}
	                  className="absolute right-0 top-1/2 -translate-y-1/2 z-30 flex h-16 w-8 sm:h-20 sm:w-9 items-center justify-center rounded-l-lg border-y border-l border-white/20 bg-black/25 text-3xl sm:text-4xl font-thin leading-none text-white/90 transition-colors hover:bg-black/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
	                  aria-label="Next preview"
	                >
	                  ›
	                </button>
	              )}

	              {/* Pagination dots — only in dominant/full-screen layout where there's no room for a strip below */}
	              {runs.length > 1 && hero && isDominantLayout && (
	                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 pointer-events-none">
	                  {runs.map((_, idx) => (
	                    <div
	                      key={idx}
	                      className={cn(
	                        "h-1.5 rounded-full transition-all duration-200",
	                        idx === activeIndex ? "w-4 bg-white shadow" : "w-1.5 bg-white/45"
	                      )}
	                    />
	                  ))}
	                </div>
	              )}
	            </div>{/* end outer stack wrapper */}

              {/* Upload section below image — folds in smoothly once image is ready (no jarring layout push) */}
              <AnimatePresence initial={false}>
                {hero && !busy && isDominantLayout && (!leadGateEnabled || leadCaptured) && !revenuePanelActive ? (
                  <motion.div
                    key="upload-section"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                  >
                      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <button
                      type="button"
                      disabled={isUploadingOwnImages}
                      onClick={handleUploadClick}
                      className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium transition-colors hover:bg-primary/10"
                      style={{
                        fontFamily: theme.fontFamily,
                        color: theme.primaryColor || "#3b82f6",
                      }}
                    >
                      {isUploadingOwnImages ? "Uploading…" : "Upload your own image!"}
                    </button>
                    <button
                      type="button"
                      onClick={handleSkipContinue}
                      className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                      style={{ fontFamily: theme.fontFamily }}
                    >
                      Skip and keep playing around
                    </button>
                  </div>
                        </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              </div>
            </div>
	          </CardContent>
	        </Card>
	      </div>

      <AnimatePresence initial={false}>
        {lightboxOpen && hero ? (
          <motion.div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 overscroll-contain touch-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={closeLightbox}
          >
            <motion.div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            />

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              onAnimationComplete={() => setLightboxContain(true)}
              className="relative w-full aspect-square overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10"
              style={{
                // Keep the expanded square fully inside the viewport, even on very wide screens.
                maxWidth: "min(80rem, calc(100dvh - clamp(2rem, 8vw, 4rem)))",
                maxHeight: "calc(100dvh - clamp(2rem, 8vw, 4rem))",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/70 via-black/35 to-transparent px-3 py-3 sm:px-4">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white/95">Expanded preview</div>
                  <div className="text-[0.6875rem] text-white/75">Press Esc or click outside to close</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 rounded-full px-3 text-[0.6875rem] font-medium text-white hover:opacity-90"
                    style={{
                      backgroundColor: darkenHex(primary, 0.5),
                      borderColor: hexToRgba(primary, 0.4) || "rgba(255,255,255,0.2)",
                    }}
                    onClick={() => setLightboxContain((prev) => !prev)}
                    aria-label={lightboxContain ? "Switch to fill mode" : "Switch to fit mode"}
                  >
                    {lightboxContain ? "Fill" : "Fit"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-9 w-9 rounded-full text-white hover:opacity-90"
                    style={{
                      backgroundColor: darkenHex(primary, 0.5),
                      borderColor: hexToRgba(primary, 0.4) || "rgba(255,255,255,0.2)",
                    }}
                    onClick={closeLightbox}
                    aria-label="Close expanded preview"
                  >
                    <span className="text-xl leading-none">&times;</span>
                  </Button>
                </div>
              </div>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hero}
                alt="Preview"
                className={cn(
                  "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
                  lightboxContain ? "opacity-0" : "opacity-100"
                )}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hero}
                alt="Preview (full)"
                className={cn(
                  "absolute inset-0 h-full w-full object-contain transition-opacity duration-300",
                  lightboxContain ? "opacity-100" : "opacity-0"
                )}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 py-3 text-[0.6875rem] text-white/80 sm:px-4">
                {lightboxContain ? "Fit mode: shows the full image." : "Fill mode: crops edges to fill the frame."}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

        </>
      </LayoutGroup>
  );
  }
  return renderPreview();
}
