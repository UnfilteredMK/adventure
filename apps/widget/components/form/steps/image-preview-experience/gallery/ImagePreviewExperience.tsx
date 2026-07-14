"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
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
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, Mail, Maximize2, Phone, Send, Sparkles } from "lucide-react";
import { AdventureLoader } from "@/components/form/AdventureLoader";
import { usePreviewSuggestions } from "@/components/form/state/PreviewSuggestionsContext";
import { PRICING_LEAD_COPY } from "@/components/form/steps/image-preview-experience/lead-gen/pricingLeadCopy";
import type { Suggestion } from "@/types";
import { isDevModeEnabled } from "@/lib/ai-form/dev-mode";
import { PricingExperience } from "../pricing/PricingExperience";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { safeStableJsonForPricingContext } from "../../runtime/step-engine/utils/pricing-context";
import { PRICING_ESTIMATE_KEY } from "../../runtime/step-engine/constants";
import { normalizePricingEstimate } from "../../runtime/step-engine/utils/pricing-estimate";
import {
  OPEN_DESIGN_ESTIMATE_GATE_EVENT,
  PREVIEW_CACHE_UPDATED_EVENT,
  notifyPreviewCacheUpdated,
} from "./preview-cache-bridge";

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

const SUGGESTION_CONTEXT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "of",
  "or",
  "the",
  "to",
  "with",
  "style",
  "type",
  "option",
  "design",
  "project",
]);

function suggestionTokens(value: unknown): Set<string> {
  const parts = Array.isArray(value) ? value : [value];
  const tokens = parts
    .flatMap((part) =>
      String(part || "")
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/),
    )
    .filter((token) => token.length > 2 && !SUGGESTION_CONTEXT_STOP_WORDS.has(token));
  return new Set(tokens);
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

type ConceptPresentation = {
  id?: string;
  title: string;
  summary?: string;
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
  /** Visitor-facing direction names returned with each generated image. */
  conceptPresentations?: (ConceptPresentation | undefined)[];
};

const CONCEPT_GALLERY_COUNT = 4;
const INITIAL_PROGRESSIVE_GRID_PLACEHOLDERS = 4;
const GALLERY_LOADING_TITLE = "Creating your personalized concepts…";
const GALLERY_LOADING_SUBTITLE = "Building from your starter, project, and budget…";
const GALLERY_LOADING_MESSAGES = [
  GALLERY_LOADING_TITLE,
  "Exploring distinct directions for your project…",
  GALLERY_LOADING_SUBTITLE,
  "Matching your scope, priorities, and selected starter…",
  "Trying personalized looks for you…",
  "Refining the strongest concepts…",
  "Pulling together the best options…",
  "Almost there…",
] as const;
const CONCEPT_SLOT_LOADING_MESSAGES = [
  "Exploring layout, tone, and materials…",
  "Trying a distinct layout and atmosphere…",
  "Balancing your project choices…",
  "Refining the finishing details…",
] as const;
const CONCEPT_PRESENTATION_FALLBACKS: readonly ConceptPresentation[] = [
  {
    id: "signature_direction",
    title: "Signature Direction",
    summary: "A balanced interpretation that stays closest to your chosen starting point.",
  },
  {
    id: "bright_open",
    title: "Bright & Open",
    summary: "A lighter, more open interpretation with a clean and spacious feel.",
  },
  {
    id: "warm_inviting",
    title: "Warm & Inviting",
    summary: "A softer direction with warmer details and a more welcoming atmosphere.",
  },
  {
    id: "simplified_direction",
    title: "Simplified Direction",
    summary: "A restrained interpretation focused on the most important changes.",
  },
] as const;

function normalizeConceptPresentation(raw: any): ConceptPresentation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const titleRaw =
    typeof raw.title === "string"
      ? raw.title
      : typeof raw.label === "string"
        ? raw.label
        : "";
  const title = titleRaw.trim();
  if (!title) return undefined;
  const idRaw =
    typeof raw.id === "string"
      ? raw.id
      : typeof raw.slotId === "string"
        ? raw.slotId
        : typeof raw.slot_id === "string"
          ? raw.slot_id
          : "";
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  return {
    ...(idRaw.trim() ? { id: idRaw.trim() } : {}),
    title,
    ...(summary ? { summary } : {}),
  };
}

function conceptPresentationFor(run: PreviewRun | null | undefined, index: number): ConceptPresentation {
  return (
    run?.conceptPresentations?.[index] ??
    CONCEPT_PRESENTATION_FALLBACKS[index % CONCEPT_PRESENTATION_FALLBACKS.length] ??
    CONCEPT_PRESENTATION_FALLBACKS[0]
  );
}

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
  // User preference for expanded pricing panel in single-image revealed mode.
  overlayPricingCollapsed?: boolean;
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

export type PreviewPricingGateVariant = "blurred" | "coarse_visible";

export type PreviewConceptSelection = {
  index: number;
  imageUrl: string;
  runId: string | null;
  pricing: {
    totalMin: number;
    totalMax: number;
    currency: string;
  } | null;
};

export type StudioStarterConcept = {
  value: string;
  label: string;
  imageUrl: string;
  isProjectPhoto?: boolean;
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

function formatCompactCurrency(amount: number, locale?: string, currency?: string): string {
  const normalizedCurrency = String(currency || "USD").trim().toUpperCase() || "USD";
  return new Intl.NumberFormat(locale || undefined, {
    style: "currency",
    currency: normalizedCurrency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

function formatCompactPricingRangeText(params: {
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
  return `${formatCompactCurrency(Math.min(low, high), params.locale, currency)}-${formatCompactCurrency(
    Math.max(low, high),
    params.locale,
    currency
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
          const rawConceptPresentations = Array.isArray((r as any).conceptPresentations)
            ? (r as any).conceptPresentations
            : [];
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
          const conceptPresentations = imgs.map((_: string, i: number) =>
            normalizeConceptPresentation(rawConceptPresentations[i]),
          );
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
        overlayPricingCollapsed: false,
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
  /** Run generation/cache effects without mounting the legacy preview chrome. */
  headless?: boolean;
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
  /** Overrides the configured concept count (V1 uses exactly four). */
  conceptCount?: number;
  /** Progressively fill the initial gallery and preserve multi-concept generation with an uploaded photo. */
  progressiveConcepts?: boolean;
  /** The visual foundation chosen before generation; shown in the continuous studio status. */
  studioStarterConcept?: StudioStarterConcept | null;
  /** Replaces legacy single-preview overlays with the final studio estimate composition. */
  studioEstimateMode?: boolean;
  /** Fires when the user explicitly chooses a concept tile. */
  onConceptSelected?: (detail: PreviewConceptSelection) => void;
  /** Suppress all built-in lead overlays/popovers so an adjacent parent panel can own conversion. */
  suppressInlineLeadGate?: boolean;
  /** Card-level pricing treatment. Detailed pricing remains lead-gated. */
  pricingGateVariant?: PreviewPricingGateVariant;
  /** Optional hook to bring Guided controls into focus. */
  onKeepDesigning?: () => void;
  /** Matches visible preview chrome: concept grid vs single hero vs no image yet. */
  onPreviewSurfaceModeChange?: (mode: "gallery" | "single" | "empty") => void;
  /** Form question-pane Back on step 0 bumps this so we return to the concept grid. */
  stepNavReturnToGalleryNonce?: number;
}) {
  const { theme, config: designConfig } = useFormTheme();
  const reduceMotion = useReducedMotion();
  const {
    instanceId,
    sessionId,
    enabled,
    leadGateEnabled = true,
    transparentChrome = false,
    headless = false,
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
    conceptCount,
    progressiveConcepts = false,
    studioStarterConcept = null,
    studioEstimateMode = false,
    onConceptSelected,
    suppressInlineLeadGate = false,
    pricingGateVariant = "blurred",
    onKeepDesigning,
    onPreviewSurfaceModeChange,
    stepNavReturnToGalleryNonce = 0,
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
    () => {
      const requested = Number(conceptCount);
      if (Number.isFinite(requested)) return Math.max(1, Math.min(12, Math.floor(requested)));
      return Math.max(
        CONCEPT_GALLERY_COUNT,
        Math.min(12, Math.max(galleryMaxImages || CONCEPT_GALLERY_COUNT, CONCEPT_GALLERY_COUNT))
      );
    },
    [conceptCount, galleryMaxImages]
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
    if (progressiveConcepts && (cache?.runs?.length || 0) === 0) {
      return conceptGalleryTargetCount;
    }
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
  }, [
    cache?.runs?.length,
    conceptGalleryTargetCount,
    config,
    progressiveConcepts,
    sceneUploadUrl,
    uploadedImages.length,
    userUploadUrl,
  ]);
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
  /** Lead capture for locked preview actions (Try again, Download, Upload) — centered on the image, same styling as SHOW PRICING. */
  const [showCenteredPreviewActionLeadModal, setShowCenteredPreviewActionLeadModal] = useState(false);
  /** Ideas / question-pane gate — same centered modal + design_and_estimate completion as SHOW PRICING. */
  const [showCenteredIdeasToolbarLeadModal, setShowCenteredIdeasToolbarLeadModal] = useState(false);
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
  const [pendingExactPricingReveal, setPendingExactPricingReveal] = useState(false);
  const { submitForm: submitCenteredPricingLead, isSubmitting: isSubmittingCenteredPricingLead } = useFormSubmission({
    instanceId,
    sessionId,
  });
  const devMode = useMemo(() => isDevModeEnabled(), []);
  const debugSessionRef = useRef<string | null>(null);
  const debugLeadCapturedRef = useRef<boolean | null>(null);
  const [galleryLoadingMessageIndex, setGalleryLoadingMessageIndex] = useState(0);
  const [studioRefinementDraft, setStudioRefinementDraft] = useState("");
  const [studioSuggestionOffset, setStudioSuggestionOffset] = useState(0);
  const { suggestions: studioSuggestions, loading: studioSuggestionsLoading } = usePreviewSuggestions();
  const rankedStudioSuggestions = useMemo(() => {
    const contextTokens = new Set<string>();
    Object.entries(stepDataSoFar || {}).forEach(([stepId, answer]) => {
      if (!/^step-(style-direction|project-|service)/.test(stepId)) return;
      suggestionTokens(answer).forEach((token) => contextTokens.add(token));
    });
    return studioSuggestions
      .map((suggestion, index) => {
        const tokens = suggestionTokens([
          suggestion.suggestionLabel,
          suggestion.text,
          suggestion.category,
          suggestion.subcategory,
          suggestion.prompt,
        ]);
        let score = 0;
        tokens.forEach((token) => {
          if (contextTokens.has(token)) score += 1;
        });
        return { suggestion, index, score };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ suggestion }) => suggestion);
  }, [stepDataSoFar, studioSuggestions]);
  const visibleStudioSuggestions = useMemo(() => {
    if (rankedStudioSuggestions.length <= 3) return rankedStudioSuggestions;
    return Array.from(
      { length: 3 },
      (_, index) => rankedStudioSuggestions[(studioSuggestionOffset + index) % rankedStudioSuggestions.length],
    );
  }, [rankedStudioSuggestions, studioSuggestionOffset]);
  const pendingActionRef = useRef<null | "refresh" | "upload" | "download">(null);
  const pendingGenerateModeRef = useRef<"manual" | "auto">("manual");
  const gateContextRef = useRef<string>("design_and_estimate");
  /** Set after `runGenerate` / `downloadActiveImage` exist — used by lead submit without TDZ. */
  const postLeadUnlockActionRef = useRef<{
    runGenerate: (reason: "auto" | "manual") => void;
    downloadActiveImage: () => Promise<void>;
  }>({
    runGenerate: () => {},
    downloadActiveImage: async () => {},
  });

  const promptSubmitNonceRef = useRef<number>(0);
  const promptSubmitNonceInitializedRef = useRef(false);
  const autoGenerationCounterScopeRef = useRef<string>(autoGenerationCounterScope);
  const previewRefreshNonceRef = useRef<number>(0);
  const pendingManualGenerateRef = useRef(false);
  /** One-shot refinement from preview suggestion chips (not persisted to step-promptInput). */
  const pendingRefinementNotesRef = useRef<string | null>(null);
  const pendingBudgetRefineRef = useRef(false);
  const pendingBudgetTierShiftRef = useRef(false);
  const prevBudgetForPricingRef = useRef<number | null>(null);
  const prevRunsLengthRef = useRef(0);
  const lastAutoRegenAtRef = useRef<number>(0);
  const heroForPricingRef = useRef<string | null>(null);
  const skipNextFetchRef = useRef(false);
  const currentHeroRef = useRef<string | null>(null);
  const fetchAccuratePricingRef = useRef<(() => Promise<void>) | null>(null);
  /** Synchronous guard: React Strict Mode and overlapping effects can fire twice before `running` state commits. */
  const accuratePricingFetchLockRef = useRef(false);
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
    setShowCenteredPreviewActionLeadModal(false);
    setShowCenteredIdeasToolbarLeadModal(false);
    setPendingExactPricingReveal(false);
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
    if (!leadCaptured) setPendingExactPricingReveal(false);
  }, [leadCaptured]);

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

    const isPreviewActionLead = showCenteredPreviewActionLeadModal;
    const isIdeasToolbarLead = showCenteredIdeasToolbarLeadModal;
    const actionPending = pendingActionRef.current;
    const gateCtx = isPreviewActionLead
      ? gateContextRef.current || "regenerate_manual"
      : "design_and_estimate";
    const actionSurface =
      actionPending === "download"
        ? "preview_download"
        : actionPending === "upload"
          ? formStepUploadThumbnail
            ? "preview_change_reference"
            : "preview_upload_reference"
          : "preview_generate";

    const result = await submitCenteredPricingLead({
      email,
      name,
      phone: formattedPhone,
      isPartial: false,
      submissionData: isPreviewActionLead
        ? { gateContext: gateCtx, surface: actionSurface, step: "phone" }
        : {
            gateContext: "design_and_estimate",
            surface: isIdeasToolbarLead ? "ideas_toolbar" : "inline_pricing",
            step: "phone",
          },
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
    upsertLeadGate(sessionId, gateCtx, { completedAt: Date.now() });
    setLeadCaptured(true);
    setShowCenteredPricingForm(false);
    setShowCenteredPreviewActionLeadModal(false);
    setShowCenteredIdeasToolbarLeadModal(false);
    setCenteredPricingStep("email");

    if (isPreviewActionLead) {
      const action = pendingActionRef.current;
      const mode = pendingGenerateModeRef.current;
      pendingActionRef.current = null;
      pendingGenerateModeRef.current = "manual";
      const { runGenerate: runGen, downloadActiveImage: dl } = postLeadUnlockActionRef.current;
      if (action === "refresh") void runGen(mode);
      else if (action === "download") void dl();
      else if (action === "upload") uploadInputRef.current?.click();
      return;
    }

    if (pendingRefinementNotesRef.current) {
      setStudioRefinementDraft("");
      void postLeadUnlockActionRef.current.runGenerate("manual");
    } else {
      setPendingExactPricingReveal(true);
      setAccuratePricingStatus("running");
      void fetchAccuratePricingRef.current?.();
    }
  }, [
    centeredPricingEmail,
    centeredPricingName,
    centeredPricingPhone,
    formStepUploadThumbnail,
    sessionId,
    showCenteredIdeasToolbarLeadModal,
    showCenteredPreviewActionLeadModal,
    submitCenteredPricingLead,
  ]);

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

  const [stagedConceptIndex, setStagedConceptIndex] = useState(0);
  const [conceptSlideDirection, setConceptSlideDirection] = useState<1 | -1>(1);

  useEffect(() => {
    const images = activeRun?.images ?? [];
    if (images.length === 0) {
      setStagedConceptIndex(0);
      return;
    }
    setStagedConceptIndex((current) => {
      if (images[current]) return current;
      const firstReadyIndex = images.findIndex(Boolean);
      return firstReadyIndex >= 0 ? firstReadyIndex : 0;
    });
  }, [activeRun?.id, activeRun?.images]);

  const selectedConceptIndex = cache?.selectedConceptIndex ?? null;
  const viewMode = (cache?.viewMode === "gallery" || cache?.viewMode === "single" ? cache.viewMode : null) as PreviewViewMode | null;
  const pendingInitialConceptGrid = Boolean(
    progressiveConcepts &&
      !disableConceptPicker &&
      cache?.status === "running" &&
      !activeRun &&
      selectedConceptIndex === null,
  );
  const activeRunExpectedImageCount =
    typeof activeRun?.expectedImageCount === "number" && Number.isFinite(activeRun.expectedImageCount)
      ? Math.max(activeRun.expectedImageCount, activeRun?.images?.length ?? 0)
      : pendingInitialConceptGrid
        ? conceptGalleryTargetCount
        : activeRun?.images?.length ?? 0;
  const showGalleryGrid =
    !disableConceptPicker &&
    (viewMode === "gallery" || (viewMode === null && selectedConceptIndex === null)) &&
    (Boolean(activeRun) || pendingInitialConceptGrid) &&
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
  // A concept click is itself the commit into Estimate. Also derive this from the
  // local cache so we never render the legacy single-preview screen while the
  // parent is catching up with the cache event.
  const conceptSelectionCommitted = Boolean(
    progressiveConcepts &&
      selectedConceptIndex !== null &&
      Number.isFinite(selectedConceptIndex) &&
      hero &&
      !showConceptPicker,
  );
  const studioEstimateActive = Boolean(
    (studioEstimateMode || conceptSelectionCommitted) && hero && !showConceptPicker,
  );
  const selectedConceptApiPresentation =
    activeRun?.conceptPresentations?.[
      selectedConceptIndex !== null && Number.isFinite(selectedConceptIndex) ? selectedConceptIndex : 0
    ];
  const selectedConceptDisplayTitle =
    selectedConceptApiPresentation?.title?.trim() || "Your selected concept";
  const selectedConceptDisplaySummary = selectedConceptApiPresentation?.summary?.trim() || "";

  const previewSurfaceMode = useMemo((): "gallery" | "single" | "empty" => {
    // Gallery first (including progressive load with placeholders) so the shell can hide the question pane until the user picks a tile.
    if (showConceptPicker) return "gallery";
    if (!hero) return "empty";
    return "single";
  }, [hero, showConceptPicker]);

  useEffect(() => {
    onPreviewSurfaceModeChange?.(previewSurfaceMode);
  }, [previewSurfaceMode, onPreviewSurfaceModeChange]);

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
      // Estimate must open on the concept the visitor deliberately selected. Only an
      // explicit refinement may replace it with another generated image.
      if (studioEstimateActive && reason === "auto") return;
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
      const useCase = normalizeUseCase((config as any)?.useCase);
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
      // The selected starter is the visual foundation for the first concept run.
      // Initial scene generations treat option-card images as guide-only references,
      // so they influence the direction without being mistaken for the user's property.
      const shouldUseOptionCardImagesAsGenerationRefs =
        selectedOptionReferenceImages.length > 0;
      const generationIntent: "initial" | "small_improvement" | "regenerate" | "budget_tier_shift" = isBudgetDrivenRegeneration
        ? isBudgetTierShift
          ? "budget_tier_shift"
          : "regenerate"
        : hasExistingPreview
          ? "small_improvement"
          : "initial";
      // First preview uses uploaded anchors. After the first generated preview exists,
      // treat prompt/guided edits as refinements anchored to the active anchor image.
      const primaryReferenceImage = runAnchorImage;
      const isInitialConceptGalleryRun = generationIntent === "initial" && !hasExistingPreview;
      const initialReferenceCap = stepSceneUpload || stepUserUpload ? 2 : 3;
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
        .slice(0, isInitialConceptGalleryRun ? initialReferenceCap : 6);
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
      const guideOnlyInitialSceneRun =
        useCase === "scene" &&
        generationIntent === "initial" &&
        !hasExistingPreview &&
        referenceImagesForRequest.length > 0;
      // For refinements: use latest image as base. scene-placement + hasExistingPreview = drilldown edit.
      // Do not clear this for guide_only: that mode only marks style refs as non-anchors; the user's room
      // upload must still be the edit target when present.
      const sceneImageForRequest =
        (effectiveUseCase === "scene" || effectiveUseCase === "scene-refinement") && runAnchorImage
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

		        const specializedEndpoint =
              normalizedUseCase === "tryon"
                ? "/api/generate/try-on"
                : normalizedUseCase === "scene-placement"
                  ? "/api/generate/scene-placement"
                  : normalizedUseCase === "scene-refinement"
                    ? "/api/generate/scene-refinement"
                    : "/api/generate/scene";
		        const budgetForRequest = extractBudgetValue(effectiveStepDataSoFar || {});
		        const pendingRefinement = pendingRefinementNotesRef.current;
		        pendingRefinementNotesRef.current = null;
		        const refinementNotesRaw =
		          pendingRefinement !== null ? pendingRefinement : (effectiveStepDataSoFar as any)?.["step-promptInput"];
		        const refinementNotes =
		          typeof refinementNotesRaw === "string" && refinementNotesRaw.trim() ? refinementNotesRaw.trim() : undefined;
		        const hasDirectImageInput = Boolean(userImage || productImage || sceneImage);
		        // Legacy only creates a concept grid without direct image input. V1 progressive mode intentionally
            // keeps the four-concept gallery when a project photo is present.
            const shouldGenerateConceptGallery =
		          generationIntent === "initial" && (!hasDirectImageInput || progressiveConcepts);
		        const numOutputs = shouldGenerateConceptGallery ? conceptGalleryTargetCount : 1;
            const initialConceptBatchSize =
              progressiveConcepts && shouldGenerateConceptGallery ? 1 : numOutputs;
            // The generic route's structured price-ladder program supports deterministic slot offsets and
            // uploaded scene anchors. Specialized edit routes clamp several models to a single output.
            const useStructuredConceptGeneration = Boolean(progressiveConcepts && shouldGenerateConceptGallery);
            const endpoint = useStructuredConceptGeneration ? "/api/generate" : specializedEndpoint;
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
              ...(useStructuredConceptGeneration ? { aspectRatio: "4:3" } : {}),
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
              error?: string | null;
              errorDetails?: string | null;
              imagePricing?: (CachedPricing | undefined)[];
              imagePricingOffset?: number;
              conceptPresentations?: (ConceptPresentation | undefined)[];
              conceptPresentationOffset?: number;
              imageSlot?: number;
              generated?: boolean;
            }) => {
              setCache((prev) => {
                const base = buildBaseCache(prev ?? loadCache(instanceId, sessionId));
                const nextRuns = Array.isArray(base.runs) ? [...base.runs] : [];
                const existingIndex = nextRuns.findIndex((r) => r.id === runId);
                const priorActiveRun =
                  existingIndex < 0 &&
                  params.status === "running" &&
                  (!params.images || params.images.length === 0) &&
                  base.activeRunId &&
                  base.activeRunId !== runId
                    ? nextRuns.find((r) => r.id === base.activeRunId)
                    : null;
                const carryoverImages =
                  priorActiveRun && Array.isArray(priorActiveRun.images) && priorActiveRun.images.length > 0
                    ? [...priorActiveRun.images]
                    : [];
                const carryoverPricing =
                  carryoverImages.length > 0 && Array.isArray(priorActiveRun?.imagePricing) && priorActiveRun.imagePricing.length > 0
                    ? [...priorActiveRun.imagePricing]
                    : ([] as (CachedPricing | undefined)[]);
                const carryoverConceptPresentations =
                  carryoverImages.length > 0 &&
                  Array.isArray(priorActiveRun?.conceptPresentations) &&
                  priorActiveRun.conceptPresentations.length > 0
                    ? [...priorActiveRun.conceptPresentations]
                    : ([] as (ConceptPresentation | undefined)[]);
                const existingRun =
                  existingIndex >= 0
                    ? nextRuns[existingIndex]
                    : ({
                        id: runId,
                        createdAt: Date.now(),
                        contextSignature: generationSignatureAtStart,
                        answeredQuestionCount: Number.isFinite(answeredQuestionCount) ? answeredQuestionCount : null,
                        images: carryoverImages,
                        expectedImageCount: numOutputs,
                        message: generationMessage,
                        stepDataSnapshot: pricingContextForNextRun.stepDataSnapshot,
                        ...(carryoverPricing.length > 0 ? { imagePricing: carryoverPricing } : {}),
                        ...(carryoverConceptPresentations.length > 0
                          ? { conceptPresentations: carryoverConceptPresentations }
                          : {}),
                      } satisfies PreviewRun);
                const imageSlot = Number.isFinite(Number(params.imageSlot))
                  ? Math.max(0, Math.floor(Number(params.imageSlot)))
                  : null;
                const mergedImages = (() => {
                  if (imageSlot !== null && params.images?.[0]) {
                    const slotted = Array.from(
                      { length: Math.max(numOutputs, existingRun.images.length, imageSlot + 1) },
                      (_, index) => existingRun.images[index] ?? "",
                    );
                    slotted[imageSlot] = params.images[0];
                    return slotted;
                  }
                  if (params.images && params.images.length > 0) {
                    return params.appendImages
                      ? mergeUniqueImageUrls(existingRun.images, params.images)
                      : params.images;
                  }
                  return existingRun.images;
                })();
                const mergedPricing = Array.isArray(existingRun.imagePricing) ? [...existingRun.imagePricing] : [];
                if (Array.isArray(params.imagePricing)) {
                  const pricingOffset = Math.max(
                    0,
                    imageSlot !== null
                      ? imageSlot
                      : Number.isFinite(Number(params.imagePricingOffset))
                        ? Math.floor(Number(params.imagePricingOffset))
                        : 0
                  );
                  params.imagePricing.forEach((value, index) => {
                    if (value) mergedPricing[pricingOffset + index] = value;
                  });
                }
                const mergedConceptPresentations = Array.isArray(existingRun.conceptPresentations)
                  ? [...existingRun.conceptPresentations]
                  : [];
                if (Array.isArray(params.conceptPresentations)) {
                  const presentationOffset = Math.max(
                    0,
                    imageSlot !== null
                      ? imageSlot
                      : Number.isFinite(Number(params.conceptPresentationOffset))
                        ? Math.floor(Number(params.conceptPresentationOffset))
                        : 0,
                  );
                  params.conceptPresentations.forEach((value, index) => {
                    if (value) mergedConceptPresentations[presentationOffset + index] = value;
                  });
                }
                const nextRun: PreviewRun = {
                  ...existingRun,
                  images: mergedImages,
                  expectedImageCount: numOutputs,
                  message: params.message ?? existingRun.message ?? generationMessage,
                  stepDataSnapshot: existingRun.stepDataSnapshot ?? pricingContextForNextRun.stepDataSnapshot,
                  ...(mergedPricing.some(Boolean) ? { imagePricing: mergedPricing } : {}),
                  ...(mergedConceptPresentations.some(Boolean)
                    ? { conceptPresentations: mergedConceptPresentations }
                    : {}),
                };
                if (existingIndex >= 0) nextRuns[existingIndex] = nextRun;
                else nextRuns.push(nextRun);

                const preserveViewMode = base.viewMode === "single" || base.viewMode === "gallery";
                // Remaining progressive slots can finish after the visitor chooses a
                // concept. Preserve that explicit selection while this same run fills
                // in, rather than throwing them back into the gallery.
                const committedConceptIndex =
                  base.activeRunId === runId &&
                  base.viewMode === "single" &&
                  typeof base.selectedConceptIndex === "number" &&
                  Number.isFinite(base.selectedConceptIndex)
                    ? Math.max(0, Math.min(numOutputs - 1, Math.floor(base.selectedConceptIndex)))
                    : null;
                const next: PreviewCacheV3 = {
                  ...base,
                  status: params.status,
                  runs: nextRuns,
                  activeRunId: runId,
                  selectedConceptIndex:
                    committedConceptIndex !== null
                      ? committedConceptIndex
                      : preserveViewMode && base.viewMode === "single" && numOutputs === 1
                        ? 0
                        : null,
                  viewMode:
                    committedConceptIndex !== null
                      ? "single"
                      : numOutputs > 1
                        ? "gallery"
                        : preserveViewMode
                          ? base.viewMode
                          : "single",
                  message: params.message ?? nextRun.message ?? generationMessage,
                  error: params.status === "error" ? params.error ?? "Some concepts could not be generated." : null,
                  errorDetails: params.status === "error" ? params.errorDetails ?? null : null,
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

            setActiveGenerationReason(reason);
            writeRunState({ status: "running", message: generationMessage });

            const fetchGenerationBatch = async (
              requestedOutputs: number,
              variantStartIndex: number,
              attemptIndex: number
            ): Promise<{
              images: string[];
              imagePricing: (CachedPricing | undefined)[];
              conceptPresentations: (ConceptPresentation | undefined)[];
              message: string;
            }> => {
              const requestBody: any = {
                ...requestBodyBase,
                numOutputs: requestedOutputs,
                ...(useStructuredConceptGeneration
                  ? { variationMode: "price_ladder_9", variantStartIndex }
                  : {}),
              };
              if (generationIndex !== undefined) requestBody.generationIndex = generationIndex + attemptIndex;
              if (process.env.NODE_ENV !== "production") {
                console.debug("[preview] generate request", {
                  endpoint,
                  useCase: normalizedUseCase,
                  generationIntent,
                  hasExistingPreview,
                  isInitialConceptGalleryRun,
                  guideOnlyInitialSceneRun,
                  numOutputs: requestedOutputs,
                  variantStartIndex,
                  progressiveConcepts,
                  stepDataKeys:
                    requestBody.stepDataSoFar && typeof requestBody.stepDataSoFar === "object"
                      ? Object.keys(requestBody.stepDataSoFar).slice(0, 20)
                      : [],
                  askedStepIdsCount: Array.isArray(requestBody.askedStepIds) ? requestBody.askedStepIds.length : 0,
                  answeredQACount: Array.isArray(requestBody.answeredQA) ? requestBody.answeredQA.length : 0,
                  hasSceneImage: Boolean(requestBody.sceneImage),
                  hasUserImage: Boolean(requestBody.userImage),
                  hasProductImage: Boolean(requestBody.productImage),
                  referenceImagesCount: Array.isArray(requestBody.referenceImages) ? requestBody.referenceImages.length : 0,
                  budgetRange: requestBody.budgetRange ?? null,
                });
              }
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

              const imgs = Array.isArray((json as any)?.images)
                ? (json as any).images.filter((x: any) => typeof x === "string" && x)
                : [];
              const normalizedImages = mergeUniqueImageUrls(
                [],
                imgs.filter(isValidUrlLikeImage).filter((src: string) => !isPlaceholderPreviewImage(src))
              ).slice(0, requestedOutputs);
              if (normalizedImages.length === 0) {
                throw new Error(
                  imgs.length === 0
                    ? "Preview generated, but no images were returned."
                    : "Preview generated, but only a placeholder image was returned."
                );
              }

              const pricingByImage = new Map<string, CachedPricing>();
              const presentationByImage = new Map<string, ConceptPresentation>();
              const variants = Array.isArray((json as any)?.variants) ? (json as any).variants : [];
              for (const variant of variants) {
                const imageUrl = typeof variant?.imageUrl === "string" ? variant.imageUrl : "";
                const presentation = normalizeConceptPresentation(variant);
                if (imageUrl && presentation) presentationByImage.set(imageUrl, presentation);
                const priceRange = normalizeNumericRange(variant?.priceRange ?? variant?.price_range);
                if (!imageUrl || !priceRange) continue;
                const currency =
                  typeof variant?.priceRange?.currency === "string"
                    ? String(variant.priceRange.currency).trim().toUpperCase()
                    : typeof variant?.price_range?.currency === "string"
                      ? String(variant.price_range.currency).trim().toUpperCase()
                      : "USD";
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
                  currency: currency || "USD",
                  imagePriceRange: priceRange,
                  ...(typeof variant?.budgetTier === "string"
                    ? { budgetTier: String(variant.budgetTier).trim().toLowerCase() }
                    : {}),
                  ...(budgetTierRanges && Object.keys(budgetTierRanges).length > 0 ? { budgetTierRanges } : {}),
                  ...(typeof variant?.calibrationKey === "string"
                    ? { calibrationKey: String(variant.calibrationKey) }
                    : {}),
                });
              }

              return {
                images: normalizedImages,
                imagePricing: normalizedImages.map((src: string) => pricingByImage.get(src)),
                conceptPresentations: normalizedImages.map((src: string) => presentationByImage.get(src)),
                message:
                  shouldGenerateConceptGallery || !hasExistingPreview
                    ? generationMessage
                    : typeof (json as any)?.message === "string"
                      ? String((json as any).message)
                      : generationMessage,
              };
            };

            const fetchUntilFilled = async (requestedOutputs: number, variantStartIndex: number) => {
              let collected: string[] = [];
              let message = generationMessage;
              let attempt = 0;
              const pricingByImage = new Map<string, CachedPricing>();
              const presentationByImage = new Map<string, ConceptPresentation>();
              const maxAttempts = useStructuredConceptGeneration ? 2 : 1;
              while (collected.length < requestedOutputs && attempt < maxAttempts) {
                const remaining = requestedOutputs - collected.length;
                const batch = await fetchGenerationBatch(remaining, variantStartIndex + collected.length, attempt);
                message = batch.message;
                batch.images.forEach((src, index) => {
                  const pricing = batch.imagePricing[index];
                  if (pricing && !pricingByImage.has(src)) pricingByImage.set(src, pricing);
                  const presentation = batch.conceptPresentations[index];
                  if (presentation && !presentationByImage.has(src)) presentationByImage.set(src, presentation);
                });
                const merged = mergeUniqueImageUrls(collected, batch.images);
                const gained = merged.length - collected.length;
                collected = merged;
                attempt += 1;
                if (gained <= 0) break;
              }
              return {
                images: collected,
                imagePricing: collected.map((src) => pricingByImage.get(src)),
                conceptPresentations: collected.map((src) => presentationByImage.get(src)),
                message,
              };
            };

            if (useStructuredConceptGeneration && numOutputs > 1) {
              const resolvedImages = Array<string>(numOutputs).fill("");
              const resolvedPricing = Array<CachedPricing | undefined>(numOutputs).fill(undefined);
              const resolvedConceptPresentations = Array<ConceptPresentation | undefined>(numOutputs).fill(undefined);
              const slotErrors: string[] = [];
              let nextSlot = 0;

              writeRunState({
                status: "running",
                images: resolvedImages,
                appendImages: false,
                message: generationMessage,
                generated: false,
              });

              const runSlotWorker = async () => {
                while (nextSlot < numOutputs) {
                  const slot = nextSlot;
                  nextSlot += 1;
                  try {
                    const result = await fetchUntilFilled(1, slot);
                    const image = result.images[0];
                    if (!image) throw new Error(`Concept ${slot + 1} returned no image.`);
                    resolvedImages[slot] = image;
                    resolvedPricing[slot] = result.imagePricing[0];
                    resolvedConceptPresentations[slot] = result.conceptPresentations[0];
                    writeRunState({
                      status: "running",
                      images: [image],
                      imagePricing: [result.imagePricing[0]],
                      conceptPresentations: [result.conceptPresentations[0]],
                      imageSlot: slot,
                      message: result.message,
                      generated: false,
                    });
                  } catch (slotError) {
                    slotErrors.push(
                      slotError instanceof Error
                        ? `Concept ${slot + 1}: ${slotError.message}`
                        : `Concept ${slot + 1} could not be generated.`,
                    );
                  }
                }
              };

              await Promise.all(
                Array.from({ length: Math.min(3, numOutputs) }, () => runSlotWorker()),
              );
              const completedConceptCount = resolvedImages.filter(Boolean).length;
              const completedConceptSet = completedConceptCount === numOutputs;
              writeRunState({
                status: completedConceptSet ? "complete" : "error",
                images: resolvedImages,
                appendImages: false,
                imagePricing: resolvedPricing,
                conceptPresentations: resolvedConceptPresentations,
                message: completedConceptSet ? "Your concepts are ready." : generationMessage,
                error: completedConceptSet
                  ? null
                  : `${completedConceptCount} of ${numOutputs} concepts are ready. Try again to finish the set.`,
                errorDetails: slotErrors.length > 0 ? slotErrors.join(" | ").slice(0, 800) : responseErrorDetails,
                generated: completedConceptSet,
              });
            } else {
              const firstBatch = await fetchUntilFilled(initialConceptBatchSize, 0);
              const remainingAfterFirstBatch = Math.max(0, numOutputs - firstBatch.images.length);
              writeRunState({
                status: remainingAfterFirstBatch > 0 ? "running" : "complete",
                images: firstBatch.images,
                appendImages: false,
                message: firstBatch.message,
                imagePricing: firstBatch.imagePricing,
                conceptPresentations: firstBatch.conceptPresentations,
                generated: remainingAfterFirstBatch === 0,
              });

              if (remainingAfterFirstBatch > 0) {
                try {
                  const deferredBatch = await fetchUntilFilled(remainingAfterFirstBatch, firstBatch.images.length);
                  const firstBatchImageSet = new Set(firstBatch.images);
                  const deferredImages: string[] = [];
                  const deferredImagePricing: (CachedPricing | undefined)[] = [];
                  const deferredConceptPresentations: (ConceptPresentation | undefined)[] = [];
                  deferredBatch.images.forEach((src, index) => {
                    if (firstBatchImageSet.has(src)) return;
                    deferredImages.push(src);
                    deferredImagePricing.push(deferredBatch.imagePricing[index]);
                    deferredConceptPresentations.push(deferredBatch.conceptPresentations[index]);
                  });
                  const mergedConcepts = mergeUniqueImageUrls(firstBatch.images, deferredImages);
                  const completedConceptSet = mergedConcepts.length === numOutputs;
                  writeRunState({
                    status: completedConceptSet ? "complete" : "error",
                    images: deferredImages,
                    appendImages: true,
                    message: deferredBatch.message,
                    error: completedConceptSet
                      ? null
                      : `Generated ${mergedConcepts.length} of ${numOutputs} concepts. Try again to complete the set.`,
                    imagePricing: deferredImagePricing,
                    imagePricingOffset: firstBatch.images.length,
                    conceptPresentations: deferredConceptPresentations,
                    conceptPresentationOffset: firstBatch.images.length,
                    generated: completedConceptSet,
                  });
                } catch (deferredError) {
                  const deferredMessage =
                    deferredError instanceof Error ? deferredError.message : "The remaining concepts could not be generated.";
                  const deferredDetails =
                    deferredError &&
                    typeof deferredError === "object" &&
                    "details" in deferredError &&
                    typeof (deferredError as any).details === "string"
                      ? String((deferredError as any).details)
                      : responseErrorDetails;
                  writeRunState({
                    status: "error",
                    message: firstBatch.message,
                    error: deferredMessage,
                    errorDetails: deferredDetails,
                    generated: false,
                  });
                }
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
          const currentRuns = Array.isArray(base.runs) ? base.runs : [];
          const keepFailedConceptRun = Boolean(
            progressiveConcepts && currentRuns.some((run) => run.id === runId && Number(run.expectedImageCount) > 1),
          );
          const nextRuns = keepFailedConceptRun ? currentRuns : currentRuns.filter((run) => run.id !== runId);
          const nextActiveRunId =
            keepFailedConceptRun
              ? runId
              : base.activeRunId === runId
                ? nextRuns.at(-1)?.id ?? null
                : base.activeRunId ?? nextRuns.at(-1)?.id ?? null;
          const next: PreviewCacheV3 = {
            ...base,
            status: "error",
            runs: nextRuns,
            activeRunId: nextActiveRunId,
            viewMode: keepFailedConceptRun ? "gallery" : base.viewMode,
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
      progressiveConcepts,
      refreshRegenAllowance,
      runs,
      sessionId,
      studioEstimateActive,
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
    if (studioEstimateActive) return;
    if ((cache?.runs?.length || 0) > 0) return;
    if (cache?.status === "running") return;
    if (cache?.status === "error") return;
    void runGenerate("auto");
  }, [cache?.runs?.length, cache?.status, enabled, runGenerate, studioEstimateActive]);

  const isPlaceholderHero = useMemo(() => (hero ? isPlaceholderPreviewImage(hero) : false), [hero]);
  const lightboxLayoutId = `image-preview:${instanceId}:${sessionId}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxContain, setLightboxContain] = useState(true);
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
  /** Cell count for the concept picker grid (placeholders while loading, then real tiles). */
  const conceptGalleryCellCount = Math.max(
    1,
    showProgressiveGalleryLoader
      ? progressiveGalleryCellCount
      : Math.min(activeRunExpectedImageCount, conceptGalleryTargetCount)
  );
  /** Near-square grid: 4→2×2, 6→3×2, 9→3×3, capped at 4 columns. */
  const conceptGalleryGridCols =
    conceptGalleryCellCount <= 1 ? 1 : Math.min(4, Math.ceil(Math.sqrt(conceptGalleryCellCount)));
  const showRefreshMask = Boolean(hero && busy && !showConceptPicker);
  const showOverlayLoader = Boolean((showLoader || busy) && !showProgressiveGalleryLoader && !studioEstimateActive);
  const autoRefreshBusy = Boolean(hero && busy && activeGenerationReason === "auto");
  // The initial concept workers may still be filling unseen gallery slots after
  // the visitor chooses one. That background work is not a refinement of the
  // selected image and must not block or mask the Estimate screen.
  const studioRefinementBusy = Boolean(
    studioEstimateActive && busy && activeGenerationReason === "manual",
  );
  const leadGateActive = leadGateEnabled && Boolean(hero) && !leadCaptured;
  const canUseLiveBudgetSlider = !leadGateEnabled || leadCaptured;
  /** Single-image mode with pricing unlocked (no gate, or lead captured). */
  const revenuePanelActive = Boolean(hero && !showConceptPicker && (!leadGateEnabled || leadCaptured));

  const openDesignEstimateLeadFlow = useCallback(() => {
    if (suppressInlineLeadGate) return;
    if (!leadGateEnabled) return;
    if (leadCaptured) return;
    setShowCenteredPreviewActionLeadModal(false);
    setShowCenteredIdeasToolbarLeadModal(false);
    setCenteredPricingError(null);
    setCenteredPricingStep("email");
    setShowCenteredPricingForm(true);
    upsertLeadGate(sessionId, "design_and_estimate", { shownAt: Date.now() });
  }, [leadCaptured, leadGateEnabled, sessionId, suppressInlineLeadGate]);

  /** Question-pane Ideas gate: same lead steps as SHOW PRICING, but centered on the preview image. */
  const openCenteredIdeasToolbarLeadFlow = useCallback(() => {
    if (suppressInlineLeadGate) return;
    if (!leadGateEnabled) return;
    if (leadCaptured) return;
    setShowCenteredPreviewActionLeadModal(false);
    setShowCenteredPricingForm(false);
    setCenteredPricingError(null);
    setCenteredPricingStep("email");
    setShowCenteredIdeasToolbarLeadModal(true);
    upsertLeadGate(sessionId, "design_and_estimate", { shownAt: Date.now() });
  }, [leadCaptured, leadGateEnabled, sessionId, suppressInlineLeadGate]);

  const applyStudioRefinement = useCallback(
    (value: string | Suggestion) => {
      const note =
        typeof value === "string"
          ? value.trim()
          : String(value.prompt || value.text || "").trim();
      if (!note || studioRefinementBusy) return;
      pendingRefinementNotesRef.current = note;
      if (leadGateEnabled && !leadCaptured) {
        openDesignEstimateLeadFlow();
        return;
      }
      setStudioRefinementDraft("");
      requestManualGenerate();
    },
    [leadCaptured, leadGateEnabled, openDesignEstimateLeadFlow, requestManualGenerate, studioRefinementBusy],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpenGate = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId?: string; centered?: boolean }>).detail;
      if (!detail || detail.sessionId !== sessionId) return;
      if (detail.centered) openCenteredIdeasToolbarLeadFlow();
      else openDesignEstimateLeadFlow();
    };
    window.addEventListener(OPEN_DESIGN_ESTIMATE_GATE_EVENT, onOpenGate);
    return () => window.removeEventListener(OPEN_DESIGN_ESTIMATE_GATE_EVENT, onOpenGate);
  }, [openCenteredIdeasToolbarLeadFlow, openDesignEstimateLeadFlow, sessionId]);
  const galleryLoadingMessage =
    GALLERY_LOADING_MESSAGES[galleryLoadingMessageIndex % GALLERY_LOADING_MESSAGES.length] ?? GALLERY_LOADING_TITLE;
  const readyConceptCount = Math.min(
    conceptGalleryTargetCount,
    (activeRun?.images || []).filter((image) => typeof image === "string" && Boolean(image)).length,
  );
  const stagedConceptImage = activeRun?.images?.[stagedConceptIndex] ?? null;
  const stagedConceptPresentation = conceptPresentationFor(activeRun, stagedConceptIndex);
  const conceptGenerationComplete = readyConceptCount >= conceptGalleryTargetCount && !busy;
  const conceptGenerationFailed = cache?.status === "error";

  const [overlayPricingExpanded, setOverlayPricingExpanded] = useState(false);
  const [overlayPricingCollapsedLocal, setOverlayPricingCollapsedLocal] = useState<boolean>(
    Boolean(initialCache?.overlayPricingCollapsed)
  );
  const overlayPricingCollapsedByUser = overlayPricingCollapsedLocal;
  useEffect(() => {
    if (!cache) return;
    const fromCache = Boolean(cache.overlayPricingCollapsed);
    setOverlayPricingCollapsedLocal((prev) => (prev === fromCache ? prev : fromCache));
  }, [cache?.overlayPricingCollapsed]);
  const setOverlayPricingCollapsedPreference = useCallback(
    (collapsed: boolean) => {
      setOverlayPricingCollapsedLocal(collapsed);
      setCache((prev) => {
        const base = prev ?? loadCache(instanceId, sessionId);
        if (!base) return prev;
        if (Boolean(base.overlayPricingCollapsed) === collapsed) return prev;
        const next: PreviewCacheV3 = {
          ...base,
          overlayPricingCollapsed: collapsed,
          updatedAt: Date.now(),
        };
        saveCache(instanceId, sessionId, next);
        return next;
      });
    },
    [instanceId, sessionId]
  );
  useEffect(() => {
    // Default expanded once pricing is revealed, unless user explicitly collapsed it.
    // Always collapse when leaving single-image revealed mode.
    if (revenuePanelActive) {
      setOverlayPricingExpanded(!overlayPricingCollapsedByUser);
      return;
    }
    setOverlayPricingExpanded(false);
  }, [overlayPricingCollapsedByUser, revenuePanelActive]);

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
    if (studioEstimateActive) return;
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
    studioEstimateActive,
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

  /** When a tile has no per-image pricing yet, reuse explicit config preview range (never default 200–400 unless configured). */
  const previewPricingForTileFallback = useMemo((): CachedPricing | undefined => {
    if (!hasExplicitPricingConfig || !previewPricing) return undefined;
    const lo = previewPricing.totalMin;
    const hi = previewPricing.totalMax;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    return {
      totalMin: Math.min(lo, hi),
      totalMax: Math.max(lo, hi),
      currency: String(previewPricing.currency || pricingCurrency || "USD")
        .trim()
        .toUpperCase() || "USD",
    };
  }, [hasExplicitPricingConfig, previewPricing, pricingCurrency]);

  const handleUseConcept = useCallback(
    (index = stagedConceptIndex) => {
      const imageUrl = activeRun?.images?.[index];
      if (!imageUrl) return;
      const selectedPricing = activeRun?.imagePricing?.[index] ?? previewPricingForTileFallback ?? null;
      setCache((prev) => {
        const base = prev ?? loadCache(instanceId, sessionId);
        if (!base) return prev;
        const next: PreviewCacheV3 = {
          ...base,
          selectedConceptIndex: index,
          viewMode: "single",
          updatedAt: Date.now(),
        };
        saveCache(instanceId, sessionId, next);
        return next;
      });
      onConceptSelected?.({
        index,
        imageUrl,
        runId: activeRun?.id ?? null,
        pricing: selectedPricing
          ? {
              totalMin: selectedPricing.totalMin,
              totalMax: selectedPricing.totalMax,
              currency: selectedPricing.currency || "USD",
            }
          : null,
      });
    },
    [
      activeRun?.id,
      activeRun?.imagePricing,
      activeRun?.images,
      instanceId,
      onConceptSelected,
      previewPricingForTileFallback,
      sessionId,
      stagedConceptIndex,
    ],
  );

  const showConcept = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(conceptGalleryCellCount - 1, index));
      if (nextIndex === stagedConceptIndex) return;
      setConceptSlideDirection(nextIndex > stagedConceptIndex ? 1 : -1);
      setStagedConceptIndex(nextIndex);
    },
    [conceptGalleryCellCount, stagedConceptIndex],
  );

  // Exact pricing is only fetched for the currently selected hero image.
  // The rest of the gallery keeps its original seeded ranges from the first pass.
  const fetchAccuratePricing = useCallback(async () => {
    if (!instanceId || !sessionId) return;
    if (accuratePricingFetchLockRef.current) return;
    if (accuratePricingStatus === "running") return;
    accuratePricingFetchLockRef.current = true;
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
    } finally {
      accuratePricingFetchLockRef.current = false;
      setPendingExactPricingReveal(false);
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

  postLeadUnlockActionRef.current = { runGenerate, downloadActiveImage };

  const handleRefreshClick = useCallback(() => {
    if (leadGateActive) {
      if (suppressInlineLeadGate) return;
      pendingActionRef.current = "refresh";
      pendingGenerateModeRef.current = "manual";
      gateContextRef.current = "regenerate_manual";
      setShowCenteredPricingForm(false);
      setShowCenteredIdeasToolbarLeadModal(false);
      setCenteredPricingError(null);
      setCenteredPricingStep("email");
      setShowCenteredPreviewActionLeadModal(true);
      upsertLeadGate(sessionId, "regenerate_manual", { shownAt: Date.now() });
      return;
    }
    requestManualGenerate();
  }, [leadGateActive, requestManualGenerate, sessionId, suppressInlineLeadGate]);

  const handleUploadClick = useCallback(() => {
    if (leadGateActive) {
      if (suppressInlineLeadGate) return;
      gateContextRef.current = "upload_reference";
      pendingActionRef.current = "upload";
      setShowCenteredPricingForm(false);
      setShowCenteredIdeasToolbarLeadModal(false);
      setCenteredPricingError(null);
      setCenteredPricingStep("email");
      setShowCenteredPreviewActionLeadModal(true);
      upsertLeadGate(sessionId, "upload_reference", { shownAt: Date.now() });
      return;
    }
    uploadInputRef.current?.click();
  }, [leadGateActive, sessionId, suppressInlineLeadGate]);

  const handleDownloadClick = useCallback(() => {
    if (!hero) return;
    if (leadGateActive) {
      if (suppressInlineLeadGate) return;
      gateContextRef.current = "download";
      pendingActionRef.current = "download";
      setShowCenteredPricingForm(false);
      setShowCenteredIdeasToolbarLeadModal(false);
      setCenteredPricingError(null);
      setCenteredPricingStep("email");
      setShowCenteredPreviewActionLeadModal(true);
      upsertLeadGate(sessionId, "download", { shownAt: Date.now() });
      return;
    }
    void downloadActiveImage();
  }, [downloadActiveImage, hero, leadGateActive, sessionId, suppressInlineLeadGate]);

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
  const lastStepNavGalleryNonceRef = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const n = stepNavReturnToGalleryNonce;
    if (n <= 0 || n === lastStepNavGalleryNonceRef.current) return;
    lastStepNavGalleryNonceRef.current = n;
    if (!hero) return;
    if (showConceptPicker) return;
    if (!(selectedConceptIndex !== null || hasMultiImageRun)) return;

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
  }, [
    activeRunHasMultiple,
    enabled,
    hasMultiImageRun,
    hero,
    instanceId,
    runs,
    selectedConceptIndex,
    sessionId,
    showConceptPicker,
    stepNavReturnToGalleryNonce,
  ]);

  const activeNavigationTransition =
    navigationTransition && navigationTransition.toRunId === activeRun?.id && navigationTransition.toImage === hero
      ? navigationTransition
      : null;
  const stackedPreviewLayers = useMemo(() => {
    // Only show stack for isolated runs (separate generations) — never for gallery concepts from the same run.
    // Stack = previous/next run images only (chronological history of regenerations).
    if (!hero || runs.length < 1 || showConceptPicker || studioEstimateActive || isPlaceholderHero) return [] as PreviewStackLayer[];

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
  }, [activeIndex, activeNavigationTransition, activeRun, hero, isPlaceholderHero, runs, showConceptPicker, studioEstimateActive]);
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
  const pricingDisplayFont = "'DM Mono', 'JetBrains Mono', 'IBM Plex Mono', monospace";
  /** Stable identities for overlay controls; new objects each render can thrash nested focus scopes. */
  const {
    overlayVars,
    singleModeOverlayVars,
    pricingPillVars,
    singleModePricingPillBg,
  } = useMemo(() => {
      const overlayBg = "rgba(51, 65, 85, 0.52)";
      const overlayHoverBg = "rgba(51, 65, 85, 0.64)";
      const overlayBorderLocal = "rgba(255,255,255,0.24)";
      const galleryPlaceholderPillBgLocal = "rgba(0, 0, 0, 0.60)";
      const galleryPlaceholderPillHoverBg = "rgba(0, 0, 0, 0.72)";
      const leadGenOverlayBg = overlayBg;
      const leadGenFg = "rgba(255,255,255,0.95)";
      const leadGenMuted = "rgba(255,255,255,0.72)";
      const leadGenInputBg = "rgba(255,255,255,0.12)";
      const leadGenInputBorder = "rgba(255,255,255,0.20)";
      const leadGenPlaceholder = "rgba(255,255,255,0.58)";
      const leadGenActionBg = galleryPlaceholderPillBgLocal;
      const leadGenActionFg = "#ffffff";
      const leadGenActionBorder = "rgba(255,255,255,0.22)";
      const leadGenRing = "rgba(255,255,255,0.38)";
      const overlayVarsInner = {
        ["--sif-overlay-bg" as any]: overlayBg,
        ["--sif-overlay-hover-bg" as any]: overlayHoverBg,
        ["--sif-overlay-border" as any]: overlayBorderLocal,
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
      const singleModeOverlayVarsInner = {
        ...overlayVarsInner,
        ["--sif-overlay-bg" as any]: galleryPlaceholderPillBgLocal,
        ["--sif-overlay-hover-bg" as any]: galleryPlaceholderPillHoverBg,
      } as React.CSSProperties;
      const pricingPillVarsInner = {
        ["--sif-overlay-bg" as any]: galleryPlaceholderPillBgLocal,
        ["--sif-overlay-hover-bg" as any]: galleryPlaceholderPillHoverBg,
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
      return {
        overlayVars: overlayVarsInner,
        singleModeOverlayVars: singleModeOverlayVarsInner,
        pricingPillVars: pricingPillVarsInner,
        galleryPlaceholderPillBg: galleryPlaceholderPillBgLocal,
        singleModePricingPillBg: galleryPlaceholderPillBgLocal,
      };
    }, []);

  const studioLeadFormVars = useMemo(
    () =>
      ({
        ["--sif-lead-gen-overlay-bg" as any]: "var(--form-surface-color)",
        ["--sif-lead-gen-fg" as any]: theme.textColor || "#0f172a",
        ["--sif-lead-gen-muted" as any]: hexToRgba(theme.textColor || "#0f172a", 0.64) || "rgba(15,23,42,0.64)",
        ["--sif-lead-gen-input-bg" as any]: "var(--background)",
        ["--sif-lead-gen-input-border" as any]: hexToRgba(theme.textColor || "#0f172a", 0.14) || "rgba(15,23,42,0.14)",
        ["--sif-lead-gen-placeholder" as any]: hexToRgba(theme.textColor || "#0f172a", 0.45) || "rgba(15,23,42,0.45)",
        ["--sif-lead-gen-action-bg" as any]: primary,
        ["--sif-lead-gen-action-fg" as any]: "#ffffff",
        ["--sif-lead-gen-action-border" as any]: primary,
        ["--sif-lead-gen-ring" as any]: hexToRgba(primary, 0.32) || primary,
      }) as React.CSSProperties,
    [primary, theme.textColor],
  );

  const overlayButtonClass =
    "h-8 sm:h-7 inline-flex items-center gap-1.5 rounded-xl px-3 text-[0.6875rem] font-medium leading-none text-white/95 shadow-sm backdrop-blur-md bg-[var(--sif-overlay-bg)] hover:bg-[var(--sif-overlay-hover-bg)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60 disabled:cursor-not-allowed";
  const overlayIconButtonClass =
    "h-8 w-8 sm:h-7 sm:w-7 inline-flex items-center justify-center rounded-full text-white/90 shadow-sm backdrop-blur-md bg-[var(--sif-overlay-bg)] hover:bg-[var(--sif-overlay-hover-bg)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors";

  const centeredPricingOverlayInset = "clamp(0.7rem, 3cqi, 1rem)";
  const centeredPricingPanelWidth = "min(calc(100% - 0.05rem), clamp(19rem, 62cqi, 32rem))";
  const centeredPricingPanelRadius = "clamp(1rem, 4cqi, 1.5rem)";
  const centeredPricingPanelPadding = "clamp(0.78rem, 2.9cqi, 1.08rem)";
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

  // Pricing pill: show only in legacy single mode. Studio estimate owns its pricing presentation.
  const shouldShowPricingPill = Boolean(hero && !showConceptPicker && !studioEstimateActive);
  /** Single-image preview with tooling: bottom dock (suggestions, estimate, upload) — not concept grid. */
  const singleModePreviewChrome = Boolean(hero && !showConceptPicker && toolingEnabled && !studioEstimateActive);
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
        primaryLabel: "Schedule an appointment",
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
    const primaryLabel = heroText && heroText.length > 0 ? heroText : "Schedule an appointment";
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
    if (leadGateEnabled && !leadCaptured) {
      const largestValue = Math.max(Math.abs(overlayPricingRange.low), Math.abs(overlayPricingRange.high));
      const roundingStep = largestValue >= 100_000 ? 10_000 : largestValue >= 10_000 ? 1_000 : largestValue >= 1_000 ? 500 : 100;
      const coarseLow = Math.floor(overlayPricingRange.low / roundingStep) * roundingStep;
      const coarseHigh = Math.ceil(overlayPricingRange.high / roundingStep) * roundingStep;
      return `${formatCompactCurrency(coarseLow, pricingLocale, overlayPricingRange.currency)}–${formatCompactCurrency(
        coarseHigh,
        pricingLocale,
        overlayPricingRange.currency,
      )}`;
    }
    return `${formatCurrency(overlayPricingRange.low, {
      locale: pricingLocale,
      currency: overlayPricingRange.currency,
    })}–${formatCurrency(overlayPricingRange.high, {
      locale: pricingLocale,
      currency: overlayPricingRange.currency,
    })}`;
  }, [leadCaptured, leadGateEnabled, overlayPricingRange, pricingLocale]);
  // The Estimate screen only presents image-specific pricing returned by the pricing API.
  // Config seeds and broad service ranges are useful internally, but are not credible project estimates.
  const studioEstimateRangeLabel = formattedAccuratePricingRange || formattedCachedHeroPricingRange;
  const studioEstimateReady = Boolean(studioEstimateRangeLabel && studioEstimateRangeLabel !== "$0-$0");

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

  const waitingForExactPricing = Boolean(
    leadGateEnabled &&
    leadCaptured &&
    pendingExactPricingReveal &&
    accuratePricingStatus !== "error"
  );
  const pillLabel = waitingForExactPricing
    ? "CALCULATING COST"
    : leadGateEnabled
      ? (leadCaptured ? "EST PRICING" : "PRICING")
      : "EST PRICING";
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
  const pillLoading = waitingForExactPricing;
  const shouldShowBottomPricingPill = Boolean(shouldShowPricingPill && lockedPillPrice);
  const shouldShowCenteredLeadFormOverlay = Boolean(
    !suppressInlineLeadGate &&
      leadGateEnabled &&
      !leadCaptured &&
      (showCenteredPricingForm || showCenteredPreviewActionLeadModal || showCenteredIdeasToolbarLeadModal)
  );
  /** Centered dimmed backdrop (preview actions or Ideas toolbar gate — not the bottom-anchored SHOW PRICING sheet). */
  const centeredLeadFormIsImageAction = Boolean(
    studioEstimateActive || showCenteredPreviewActionLeadModal || showCenteredIdeasToolbarLeadModal
  );
  const showBottomPreviewDock = Boolean(
    singleModePreviewChrome && !lightboxOpen && !shouldShowCenteredLeadFormOverlay
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
            ? suppressInlineLeadGate
              ? undefined
              : openDesignEstimateLeadFlow
            : () => {
                setOverlayPricingCollapsedPreference(false);
                setOverlayPricingExpanded(true);
              }
        }
        instanceId={!suppressInlineLeadGate && leadGateEnabled && leadCaptured ? instanceId : undefined}
        sessionId={!suppressInlineLeadGate && leadGateEnabled && leadCaptured ? sessionId : undefined}
        gateContext="design_and_estimate"
        submissionData={{ surface: "preview_pricing" }}
        requirePhone
        helperText={pricingDetailSummary.driversTooltipText || undefined}
        onRevealed={() => {
          setLeadCaptured(true);
          setPendingExactPricingReveal(true);
          setAccuratePricingStatus("running");
          void fetchAccuratePricingRef.current?.();
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

  /** Show "Back to gallery" when a single hero is active and a multi-image run exists. */
  const showGalleryBackControl =
    !showConceptPicker && Boolean(hero) && (selectedConceptIndex !== null || hasMultiImageRun);
  const handleBackToGallery = () => {
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
  };

  const useResponsiveConceptGalleryShell = showConceptPicker || studioEstimateActive;
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
        aspectRatio: progressiveConcepts ? "4 / 3" : "1 / 1",
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
              {toolingEnabled && !showConceptPicker && !studioEstimateActive && hero ? (
                <div className="absolute inset-x-2 top-2 z-[60] flex items-start justify-between pointer-events-none">
                  <div className="pointer-events-auto flex items-center gap-1.5">
                    {showGalleryBackControl ? (
                      <button
                        type="button"
                        onClick={handleBackToGallery}
                        aria-label="Back to gallery"
                        title="Back to gallery"
                        className={cn(overlayButtonClass, "h-7 rounded-full px-2.5 text-[11px] font-medium gap-1.5")}
                        style={{ fontFamily: theme.fontFamily, ...singleModeOverlayVars }}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        <span>Back</span>
                      </button>
                    ) : null}
                  </div>

                  <div
                    className="pointer-events-auto flex items-center gap-1.5 text-white"
                    style={{ fontFamily: theme.fontFamily, ...singleModeOverlayVars }}
                  >
                    {hero && !busy ? (
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
                    ) : null}
                    {/* Download and expand only in single view — not meaningful in gallery picker mode */}
                    {!showConceptPicker ? (
                      <>
                        {/* Only mount Popover while the gate can apply — same as regenerate. If we mount after
                            capture with `open` stuck false, Radix keeps syncing open state and can loop in focus-scope. */}
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
                  showConceptPicker ? "overflow-hidden items-stretch" : null
                )}
                data-preview-mode={showConceptPicker ? "gallery" : hero ? "single" : "empty"}
              >
	              {showConceptPicker ? (
                  progressiveConcepts ? (
                    <div className="flex h-full min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden px-0 pb-2 sm:px-3 sm:pb-3">
                      <div className="shrink-0 px-1 pb-2 pt-1 sm:px-0 sm:pb-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <div className="min-w-0">
                            <p
                              className="text-balance text-lg font-semibold leading-tight text-foreground sm:text-xl"
                              style={{ fontFamily: theme.fontFamily }}
                            >
                              {conceptGenerationComplete
                                ? "Choose the concept closest to your vision."
                                : conceptGenerationFailed
                                  ? readyConceptCount > 0
                                    ? `${readyConceptCount} of ${conceptGalleryTargetCount} concepts are ready`
                                    : "Concept generation paused"
                                  : "Creating your concepts…"}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                              {conceptGenerationComplete
                                ? "Preview each concept, then choose one."
                                : conceptGenerationFailed
                                  ? readyConceptCount > 0
                                    ? "Explore what’s ready or try generating the rest again."
                                    : "We couldn’t finish these concepts. Try again in a moment."
                                  : readyConceptCount > 0
                                    ? "Explore each concept as it arrives."
                                    : studioStarterConcept
                                      ? `Building around ${studioStarterConcept.label}.`
                                      : "Your first concept will appear here."}
                            </p>
                          </div>
                          <div className="flex items-center justify-between gap-2 sm:shrink-0 sm:justify-start">
                            <p className="text-xs font-semibold tabular-nums text-foreground/65 sm:text-sm">
                              {readyConceptCount} of {conceptGalleryTargetCount} ready
                            </p>
                            {conceptGenerationFailed ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={handleRefreshClick}
                                className="h-8 rounded-full px-3 text-xs font-semibold"
                                style={{ fontFamily: theme.fontFamily }}
                              >
                                Try again
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {busy ? (
                          <div className="mt-3 flex max-w-[18rem] items-center gap-1.5" aria-label={`${readyConceptCount} of ${conceptGalleryTargetCount} concepts ready`}>
                            {Array.from({ length: conceptGalleryTargetCount }).map((_, index) => {
                              const conceptReady = Boolean(activeRun?.images?.[index]);
                              return (
                                <motion.span
                                  key={`concept-progress-${index}`}
                                  className={cn("h-1 flex-1 rounded-full", conceptReady ? "bg-primary" : "bg-primary/15")}
                                  animate={
                                    !conceptReady && !reduceMotion
                                      ? { opacity: [0.35, 0.85, 0.35] }
                                      : { opacity: 1 }
                                  }
                                  transition={{ duration: 1.5, delay: index * 0.14, repeat: conceptReady ? 0 : Infinity, ease: "easeInOut" }}
                                />
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex min-h-0 flex-1 flex-col">
                        <div
                          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-7 pb-5 sm:px-16 sm:pb-6"
                          onKeyDown={(event) => {
                            if (event.key === "ArrowLeft") {
                              event.preventDefault();
                              showConcept(stagedConceptIndex - 1);
                            }
                            if (event.key === "ArrowRight") {
                              event.preventDefault();
                              showConcept(stagedConceptIndex + 1);
                            }
                          }}
                        >
                          <div
                          className="relative h-full min-h-[15rem] w-full max-w-[72rem]"
                            tabIndex={0}
                            aria-label="Personalized concept slideshow"
                          >
                            <AnimatePresence initial={false} custom={conceptSlideDirection} mode="popLayout">
                              <motion.div
                                key={`active-concept-${stagedConceptIndex}`}
                                custom={conceptSlideDirection}
                                layoutId={stagedConceptImage && activeRun?.id ? `generated-concept:${activeRun.id}:${stagedConceptIndex}` : undefined}
                                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: conceptSlideDirection * 54, scale: 0.975 }}
                                animate={{ opacity: 1, x: 0, rotate: 0, scale: 1 }}
                                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: conceptSlideDirection * -90, rotate: conceptSlideDirection * -2.5, scale: 0.97 }}
                                transition={{ duration: reduceMotion ? 0.1 : 0.32, ease: [0.16, 1, 0.3, 1] }}
                                drag="x"
                                dragConstraints={{ left: 0, right: 0 }}
                                dragDirectionLock
                                dragElastic={0.18}
                                onDragEnd={(_, info) => {
                                  const swipeLeft = info.offset.x < -55 || info.velocity.x < -360;
                                  const swipeRight = info.offset.x > 55 || info.velocity.x > 360;
                                  if (swipeLeft) showConcept(stagedConceptIndex + 1);
                                  else if (swipeRight) showConcept(stagedConceptIndex - 1);
                                }}
                                className="absolute inset-0 z-10 cursor-grab overflow-hidden rounded-2xl border border-foreground/10 bg-muted shadow-[0_18px_50px_rgba(15,23,42,0.14)] active:cursor-grabbing"
                                aria-label={stagedConceptPresentation.title}
                              >
                                {stagedConceptImage ? (
                                  <>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={stagedConceptImage}
                                      alt={stagedConceptPresentation.title}
                                      className="absolute inset-0 h-full w-full select-none object-cover"
                                      draggable={false}
                                    />
                                  </>
                                ) : (
                                  <div className="absolute inset-0 overflow-hidden bg-muted">
                                    {studioStarterConcept?.imageUrl ? (
                                      <>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={studioStarterConcept.imageUrl}
                                          alt=""
                                          className="absolute inset-0 h-full w-full scale-[1.04] object-cover opacity-55 blur-[5px]"
                                          aria-hidden
                                        />
                                        <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px]" />
                                      </>
                                    ) : (
                                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_32%_24%,rgba(255,255,255,0.85),transparent_42%),linear-gradient(135deg,rgba(15,23,42,0.03),rgba(15,23,42,0.1))]" />
                                    )}
                                    {!conceptGenerationFailed ? (
                                      <motion.div
                                        className="absolute -inset-x-1/2 inset-y-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                                        animate={reduceMotion ? undefined : { x: ["-35%", "35%"] }}
                                        transition={{ duration: 2.8, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" }}
                                      />
                                    ) : null}
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                                      <div className="inline-flex items-center gap-2.5 rounded-full border border-foreground/10 bg-background/85 px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm backdrop-blur-md">
                                        {conceptGenerationFailed ? (
                                          <Sparkles className="h-4 w-4 text-foreground/45" />
                                        ) : (
                                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                        )}
                                        <span>
                                          {conceptGenerationFailed
                                            ? "This concept needs another try"
                                            : `Creating ${stagedConceptPresentation.title}`}
                                        </span>
                                      </div>
                                      {!conceptGenerationFailed ? (
                                        <p className="max-w-sm text-xs font-medium text-foreground/60 sm:text-sm">
                                          {CONCEPT_SLOT_LOADING_MESSAGES[stagedConceptIndex % CONCEPT_SLOT_LOADING_MESSAGES.length] ?? "Exploring a personalized direction…"}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                )}
                                {stagedConceptImage ? (
                                  <Button
                                    type="button"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleUseConcept();
                                    }}
                                    className="absolute bottom-3 right-3 z-20 h-10 rounded-full px-5 text-sm font-semibold shadow-lg sm:bottom-4 sm:right-4"
                                    style={{ backgroundColor: theme.primaryColor, color: "#fff", fontFamily: theme.fontFamily }}
                                  >
                                    Use this concept <ChevronRight className="ml-1 h-4 w-4" />
                                  </Button>
                                ) : null}
                              </motion.div>
                            </AnimatePresence>
                            {readyConceptCount > 0 ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => showConcept(stagedConceptIndex - 1)}
                                  disabled={stagedConceptIndex <= 0}
                                  className="absolute left-3 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-background/90 text-foreground shadow-md backdrop-blur-md transition hover:scale-105 disabled:pointer-events-none disabled:opacity-25 sm:flex"
                                  aria-label="Previous concept"
                                >
                                  <ChevronLeft className="h-5 w-5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => showConcept(stagedConceptIndex + 1)}
                                  disabled={stagedConceptIndex >= conceptGalleryCellCount - 1}
                                  className="absolute right-3 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-background/90 text-foreground shadow-md backdrop-blur-md transition hover:scale-105 disabled:pointer-events-none disabled:opacity-25 sm:flex"
                                  aria-label="Next concept"
                                >
                                  <ChevronRight className="h-5 w-5" />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>

                        <div
                          className={cn(
                            "mx-auto flex w-full max-w-5xl shrink-0 flex-col items-center gap-2 px-2 pt-1 sm:flex-row",
                            "sm:justify-center",
                          )}
                        >
                          <div className="flex items-center gap-3">
                            {readyConceptCount > 0 ? (
                              <span className="max-w-[18rem] truncate text-xs font-semibold text-foreground/65 sm:text-sm">
                                {stagedConceptPresentation.title}
                              </span>
                            ) : null}
                            <div className="flex items-center gap-1.5" aria-label={`${stagedConceptPresentation.title} selected`}>
                              {Array.from({ length: conceptGalleryCellCount }).map((_, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => showConcept(idx)}
                                  className={cn(
                                    "h-2 rounded-full transition-all",
                                    stagedConceptIndex === idx ? "w-5 bg-primary" : activeRun?.images?.[idx] ? "w-2 bg-foreground/35" : "w-2 bg-foreground/15",
                                  )}
                                  aria-label={`Show ${conceptPresentationFor(activeRun, idx).title}`}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
	                <div className="flex h-full min-h-0 w-full max-w-full flex-1 flex-col px-0 pb-1.5 pt-0 sm:px-2 sm:pb-2">
	                  <div className="relative isolate flex h-full min-h-0 w-full flex-1 flex-col gap-0.5 overflow-hidden">
                  {studioStarterConcept ? (
                    <div className="mb-1.5 flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-foreground/10 bg-background/75 px-3 py-2.5 shadow-sm backdrop-blur-md sm:flex-nowrap sm:gap-3 sm:px-4">
                      <div className="flex min-w-0 items-center gap-2.5 sm:mr-auto">
                        <div className="h-10 w-14 shrink-0 overflow-hidden rounded-lg border border-foreground/10 bg-black/5 shadow-sm">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={studioStarterConcept.imageUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Foundation</p>
                          <p className="truncate text-xs font-semibold text-foreground sm:text-sm">{studioStarterConcept.label}</p>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[10px] font-semibold text-foreground/65 sm:text-[11px]">
                        <span className="inline-flex items-center gap-1 text-foreground/80"><Check className="h-3 w-3 text-primary" /> Starter selected</span>
                        <span aria-hidden className="text-foreground/25">·</span>
                        <span className="inline-flex items-center gap-1 text-foreground/80"><Check className="h-3 w-3 text-primary" /> Project personalized</span>
                        <span aria-hidden className="text-foreground/25">·</span>
                        <span className="inline-flex items-center gap-1 text-primary">
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          {busy ? `Creating concepts ${readyConceptCount}/${conceptGalleryTargetCount}` : "Your concepts are ready"}
                        </span>
                        <span aria-hidden className="text-foreground/25">·</span>
                        <span>Estimate next</span>
                      </div>
                    </div>
                  ) : null}
                  {showProgressiveGalleryLoader && !studioStarterConcept ? (
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
                    <div className="shrink-0 px-0 pb-1 text-center sm:px-1 sm:pb-1.5">
                      <p
                        className="text-base font-semibold leading-tight text-balance sm:text-lg md:text-xl"
                        style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                      >
                        Choose the personalized concept closest to your vision.
                      </p>
                    </div>
                  ) : null}
                  <div
                    className={cn(
                      "min-h-0 w-full min-w-0 flex-1 px-0 pb-0.5 sm:px-1 sm:pb-1",
                      // Bounded height so this region actually scrolls (unbounded flex = no overflow). Taller than the old 62dvh cap so row 1 isn’t clipped on common phones.
                      "max-sm:max-h-[min(calc(100dvh-10rem),78dvh,720px)] max-sm:min-h-0",
                      "overflow-y-auto overflow-x-hidden overscroll-y-contain [touch-action:pan-y] scroll-pt-1",
                      "max-sm:[scrollbar-width:thin] sm:[scrollbar-width:none] sm:[-ms-overflow-style:none] sm:[&::-webkit-scrollbar]:hidden"
                    )}
                    style={
                      {
                        WebkitOverflowScrolling: "touch",
                        touchAction: "pan-y",
                      } as React.CSSProperties
                    }
                  >
                    <div
                      className={cn(
                        "min-w-0 grid w-full content-start gap-1 sm:gap-1.5",
                        // Mobile: single column stack; sm+: multi-column grid (cols via --concept-cols).
                        "max-sm:grid-cols-1 max-sm:pt-0.5 sm:[grid-template-columns:repeat(var(--concept-cols),minmax(0,1fr))]"
                      )}
                      style={
                        {
                          ["--concept-cols" as string]: conceptGalleryGridCols,
                        } as React.CSSProperties
                      }
                    >
	                    {Array.from({
                        length: conceptGalleryCellCount,
                      }).map((_, idx) => {
                        const src = activeRun?.images?.[idx] ?? null;
                        const tilePricing = activeRun?.imagePricing?.[idx];
                        const effectiveTilePricing = tilePricing ?? previewPricingForTileFallback;
                        const tilePriceText = formatPricingRangeText({
                          pricing: effectiveTilePricing,
                          locale: pricingLocale,
                          currency: pricingCurrency,
                        });
                        const tilePriceCompactText = formatCompactPricingRangeText({
                          pricing: effectiveTilePricing,
                          locale: pricingLocale,
                          currency: pricingCurrency,
                        });
                        const shouldBlurTilePrice = Boolean(
                          pricingGateVariant !== "coarse_visible" && leadGateEnabled && !leadCaptured
                        );
                        const tilePriceDisplay =
                          tilePriceCompactText || tilePriceText || "$•••–$•••";
                        if (!src) {
                          return (
                            <div
                              key={idx}
                              className="relative aspect-square w-full min-w-0 overflow-hidden rounded-lg border border-white/8 bg-white/[0.03]"
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
	                      <motion.button
	                        key={idx}
	                        layoutId={activeRun?.id ? `generated-concept:${activeRun.id}:${idx}` : undefined}
	                        transition={{ layout: { duration: reduceMotion ? 0.1 : 0.34, ease: [0.16, 1, 0.3, 1] } }}
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
                            const selectedPricing = effectiveTilePricing ?? null;
                            onConceptSelected?.({
                              index: idx,
                              imageUrl: src,
                              runId: activeRun?.id ?? null,
                              pricing: selectedPricing
                                ? {
                                    totalMin: selectedPricing.totalMin,
                                    totalMax: selectedPricing.totalMax,
                                    currency: selectedPricing.currency || "USD",
                                  }
                                : null,
                            });
	                        }}
	                        className={cn(
                            "group relative aspect-square w-full min-w-0 overflow-hidden rounded-lg border bg-black/10 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 transition-all duration-200 md:hover:shadow-xl md:hover:scale-[1.02]",
                            selectedConceptIndex === idx ? "border-white/80 ring-2 ring-white/50" : "border-white/20 md:hover:border-white/50"
                          )}
	                        style={{
	                          borderRadius: (designConfig as any)?.gallery_image_border_radius ?? 8,
	                        }}
		                        aria-label={`Select ${conceptPresentationFor(activeRun, idx).title}`}
                          aria-pressed={selectedConceptIndex === idx}
	                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
	                          alt={conceptPresentationFor(activeRun, idx).title}
                          className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-200 md:group-hover:scale-[1.02]"
                        />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end p-2.5">
                          <div
                            className="flex h-7 min-w-[6rem] max-w-[calc(100%-0.75rem)] items-center justify-center rounded-full bg-black/60 px-2.5"
                            aria-hidden="true"
                          >
                            {shouldBlurTilePrice ? (
                              <span className="select-none truncate text-[11px] font-semibold text-white/90">
                                {suppressInlineLeadGate ? "Pricing after email" : "Tap to show pricing"}
                              </span>
                            ) : (
                              <span className="select-none truncate text-[11px] font-semibold tabular-nums text-white/95">
                                {tilePriceDisplay}
                              </span>
                            )}
                          </div>
                        </div>
	                      </motion.button>
                        );
                      })}
	                    </div>
	                  </div>
	                </div>
	                </div>
	              )
	              ) : hero ? (
	                studioEstimateActive ? (
                    <div className="h-full min-h-0 w-full overflow-hidden bg-background px-2 py-2 sm:px-4 sm:py-3 lg:px-6 lg:py-4">
                      <motion.div
                        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: reduceMotion ? 0.1 : 0.3, ease: "easeOut" }}
                        className="mx-auto flex h-full min-h-0 w-full max-w-[80rem] flex-col gap-2"
                        style={{ fontFamily: theme.fontFamily }}
                      >
                        <motion.figure
                          layoutId={
                            selectedConceptIndex !== null && activeRun?.id
                              ? `generated-concept:${activeRun.id}:${selectedConceptIndex}`
                              : undefined
                          }
                          transition={{ layout: { duration: reduceMotion ? 0.1 : 0.34, ease: [0.16, 1, 0.3, 1] } }}
                          className="flex min-h-0 min-w-0 flex-1 flex-col"
                        >
                          <div className="group relative min-h-0 flex-1 overflow-hidden rounded-[1.35rem] border border-foreground/10 bg-muted shadow-[0_18px_50px_rgba(15,23,42,0.13)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={hero}
                              alt="Selected design direction"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                            {studioRefinementBusy ? (
                              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/15 p-5">
                                <div className="inline-flex items-center gap-2.5 rounded-full border border-white/25 bg-background/95 px-4 py-2.5 text-sm font-semibold text-foreground shadow-lg backdrop-blur-md">
                                  <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden /> Applying your change…
                                </div>
                              </div>
                            ) : null}
                            {showGalleryBackControl ? (
                              <button
                                type="button"
                                onClick={handleBackToGallery}
                                className="absolute left-3 top-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/25 bg-background/90 px-3 text-xs font-semibold text-foreground shadow-sm backdrop-blur-md transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 sm:left-4 sm:top-4"
                              >
                                <ArrowLeft className="h-3.5 w-3.5 text-primary" /> Back to concepts
                              </button>
                            ) : null}
                            <div className="absolute right-3 top-3 flex items-center gap-1.5 sm:right-4 sm:top-4">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  void downloadActiveImage();
                                }}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-background/90 text-foreground shadow-sm backdrop-blur-md transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                                aria-label="Download selected concept"
                                title="Download"
                              >
                                <Download className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={openLightbox}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-background/90 text-foreground shadow-sm backdrop-blur-md transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                                aria-label="View selected concept larger"
                                title="View larger"
                              >
                                <Maximize2 className="h-4 w-4" />
                              </button>
                            </div>
                            {!studioRefinementBusy ? (
                              <div className="absolute bottom-3 right-3 z-20 max-w-[calc(100%-1.5rem)] sm:bottom-4 sm:right-4">
                                {waitingForExactPricing ? (
                                  <div className="inline-flex h-11 items-center gap-2 rounded-full border border-white/25 bg-background/95 px-4 text-sm font-semibold text-foreground shadow-lg backdrop-blur-md">
                                    <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden /> Preparing estimate…
                                  </div>
                                ) : !leadGateEnabled || leadCaptured ? (
                                  studioEstimateReady ? (
                                    <div className="rounded-2xl border border-white/20 bg-background/95 px-4 py-2.5 text-right text-foreground shadow-lg backdrop-blur-md">
                                      <span className="block text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Project estimate</span>
                                      <span className="block text-sm font-semibold tracking-tight sm:text-base" style={{ fontFamily: theme.fontFamily }}>
                                        {studioEstimateRangeLabel}
                                      </span>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPendingExactPricingReveal(true);
                                        setAccuratePricingStatus("running");
                                        void fetchAccuratePricingRef.current?.();
                                      }}
                                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                                    >
                                      Calculate project estimate <ChevronRight className="h-4 w-4" />
                                    </button>
                                  )
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      pendingRefinementNotesRef.current = null;
                                      openDesignEstimateLeadFlow();
                                    }}
                                    className="group inline-flex min-h-12 items-center gap-3 rounded-full border border-white/20 bg-primary px-5 py-2.5 text-left text-primary-foreground shadow-[0_12px_30px_rgba(0,0,0,0.22)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                                  >
                                    <span className="min-w-0">
                                      <span className="block text-[9px] font-semibold uppercase tracking-[0.15em] text-primary-foreground/70">Project pricing</span>
                                      <span className="block truncate text-sm font-semibold sm:text-base" style={{ fontFamily: theme.fontFamily }}>
                                        Get project estimate
                                      </span>
                                    </span>
                                    <ChevronRight className="h-4 w-4 shrink-0 text-primary-foreground/85 transition-transform group-hover:translate-x-0.5" />
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </div>
                          <figcaption className="shrink-0 px-1 pt-2 text-center">
                            <p className="text-sm font-semibold text-foreground/85 sm:text-base">
                              {studioStarterConcept?.isProjectPhoto ? "Designed around your space" : selectedConceptDisplayTitle}
                            </p>
                            {selectedConceptDisplaySummary ? (
                              <p className="mx-auto mt-0.5 max-w-2xl text-xs text-muted-foreground">{selectedConceptDisplaySummary}</p>
                            ) : null}
                          </figcaption>
                        </motion.figure>

                        <section className="mx-auto w-full shrink-0 px-1" aria-label="Refine this concept">
                          <div className="px-1 py-1.5">
                            <div className="flex w-full items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:justify-center sm:overflow-visible [&::-webkit-scrollbar]:hidden">
                              {studioSuggestionsLoading ? (
                                <span className="inline-flex h-10 shrink-0 items-center gap-2 px-2 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden /> Preparing ideas…
                                </span>
                              ) : (
                                visibleStudioSuggestions.map((suggestion, index) => {
                                  const label = suggestion.suggestionLabel?.trim() || suggestion.text;
                                  return (
                                    <button
                                      key={suggestion.promptId ? `${suggestion.promptId}-${index}` : `${label}-${index}`}
                                      type="button"
                                      disabled={studioRefinementBusy}
                                      onClick={() => applyStudioRefinement(suggestion)}
                                      className="group inline-flex h-9 max-w-[17rem] shrink-0 items-center gap-2 rounded-full border border-foreground/10 bg-background/80 px-3.5 text-sm font-medium text-foreground/75 shadow-sm transition hover:border-primary/40 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-wait disabled:opacity-45"
                                      title={leadGateEnabled && !leadCaptured ? `Save your concept to apply: ${label}` : `Apply: ${label}`}
                                    >
                                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                                      <span className="truncate">{label}</span>
                                    </button>
                                  );
                                })
                              )}
                              {rankedStudioSuggestions.length > 3 && !studioSuggestionsLoading ? (
                                <button
                                  type="button"
                                  disabled={studioRefinementBusy}
                                  onClick={() => setStudioSuggestionOffset((offset) => (offset + 3) % rankedStudioSuggestions.length)}
                                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-foreground/10 bg-background/80 px-3.5 text-sm font-medium text-foreground/70 shadow-sm transition hover:border-primary/40 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-45"
                                >
                                  More ideas <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                                </button>
                              ) : null}
                              <div className="flex h-9 min-w-[15rem] max-w-[22rem] flex-1 items-center gap-2 rounded-full border border-foreground/10 bg-background/80 pl-4 pr-1.5 shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
                                <Input
                                  value={studioRefinementDraft}
                                  onChange={(event) => setStudioRefinementDraft(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" && !event.shiftKey) {
                                      event.preventDefault();
                                      applyStudioRefinement(studioRefinementDraft);
                                    }
                                  }}
                                  disabled={studioRefinementBusy}
                                  placeholder="Describe a change…"
                                  aria-label="Describe a design change"
                                  className="h-8 min-w-0 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                />
                                <button
                                  type="button"
                                  disabled={studioRefinementBusy || !studioRefinementDraft.trim()}
                                  onClick={() => applyStudioRefinement(studioRefinementDraft)}
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35"
                                  aria-label="Apply design change"
                                  title="Apply change"
                                >
                                  {studioRefinementBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
                                </button>
                              </div>
                            </div>
                          </div>

                        </section>
                      </motion.div>
                    </div>
                  ) : (
	                <div className="relative h-full w-full isolate">
	                  <motion.div
	                    layoutId={
	                      selectedConceptIndex !== null && activeRun?.id
	                        ? `generated-concept:${activeRun.id}:${selectedConceptIndex}`
	                        : undefined
	                    }
	                    transition={{ layout: { duration: reduceMotion ? 0.1 : 0.34, ease: [0.16, 1, 0.3, 1] } }}
	                    className="h-full w-full cursor-zoom-in"
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
	                      alt=""
	                      aria-hidden
	                      className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl"
	                    />
	                    <div className="absolute inset-0 bg-background/10" aria-hidden />
	                    {/* eslint-disable-next-line @next/next/no-img-element */}
	                    <img
	                      src={hero}
	                      alt="Preview"
	                      className="absolute inset-0 h-full w-full object-contain"
	                    />
	                  </motion.div>
	                  {!suppressInlineLeadGate &&
	                  leadGateActive &&
	                  !shouldShowCenteredLeadFormOverlay &&
	                  !lightboxOpen ? (
	                    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4">
	                      <button
	                        type="button"
	                        className={cn(
	                          overlayButtonClass,
	                          "pointer-events-auto !h-auto min-h-0 max-w-[min(100%,18rem)] items-center gap-2.5 rounded-2xl border-0 px-4 py-3 text-left",
	                          "text-[clamp(0.8125rem,2.4cqi,0.9375rem)] font-semibold leading-none text-white/95",
	                          "shadow-sm backdrop-blur-md transition-colors active:scale-[0.98]"
	                        )}
	                        style={{ fontFamily: theme.fontFamily, ...singleModeOverlayVars }}
	                        aria-label="Show pricing to unlock your estimate"
	                        onClick={(e) => {
	                          e.preventDefault();
	                          e.stopPropagation();
	                          openDesignEstimateLeadFlow();
	                        }}
	                      >
	                        <span className="min-w-0 flex-1">Show pricing</span>
	                        <ChevronRight
	                          className="size-[1.125rem] shrink-0 text-white/75 sm:size-5"
	                          aria-hidden
	                          strokeWidth={2.25}
	                        />
	                      </button>
	                    </div>
	                  ) : null}
	                </div>
	                )
	              ) : (
	                <div className="h-full w-full bg-muted/40 isolate" />
	              )}
	            </div>

            {/* Top-left upload: only before a hero exists. In single-image mode, upload lives in the bottom dock. */}
            {toolingEnabled && !hero ? (
            <div
              className={cn(
                "absolute left-3 z-20 flex items-center gap-2",
                uploadControlPositionClass,
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
                </>
              ) : (
                /* No form-step upload yet — offer the preview-level "Upload your own image" button */
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
              )}

            </div>
            ) : null}


            {/* Uploaded images count is shown inline on the upload button */}

            {showOverlayLoader ? (
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 flex items-center justify-center",
                  showRefreshMask ? "z-20" : null
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
                  className="pointer-events-auto bg-slate-900/75"
                  style={{ ...overlayVars }}
                />
              </div>
            ) : null}

	              {!showConceptPicker && !studioEstimateActive && cache?.status === "error" && cache?.error ? (
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

              {!lightboxOpen && shouldShowCenteredLeadFormOverlay ? (
                <div
                  className={cn(
                    "absolute inset-0 pointer-events-none",
                    centeredLeadFormIsImageAction
                      ? studioEstimateActive
                        ? "z-[38] flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm sm:p-6"
                        : "z-[38] flex items-center justify-center bg-black/35 p-4 sm:p-6"
                      : "z-30 flex items-end justify-end"
                  )}
                  style={centeredLeadFormIsImageAction ? undefined : { padding: centeredPricingOverlayInset }}
                >
                  <div
                    className={cn(
                      "pointer-events-auto overflow-visible transition-[width,transform] duration-200",
                      studioEstimateActive
                        ? "border border-foreground/10 shadow-[0_24px_70px_rgba(15,23,42,0.16)]"
                        : "shadow-[0_10px_28px_rgba(15,23,42,0.24)]",
                      showCenteredPricingForm ||
                      showCenteredPreviewActionLeadModal ||
                      showCenteredIdeasToolbarLeadModal
                        ? "min-h-0"
                        : "h-auto"
                    )}
                    style={{
                      width: centeredPricingPanelWidth,
                      maxWidth: "100%",
                      borderRadius: centeredPricingPanelRadius,
                      backgroundColor: studioEstimateActive ? "var(--form-surface-color)" : singleModePricingPillBg,
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
                          style={{
                            fontFamily: theme.fontFamily,
                            gap: centeredPricingPanelGap,
                            ...(studioEstimateActive ? studioLeadFormVars : pricingPillVars),
                          }}
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
                                setShowCenteredPreviewActionLeadModal(false);
                                setShowCenteredIdeasToolbarLeadModal(false);
                              }}
                              className={cn(
                                "flex shrink-0 items-center justify-center rounded-full transition-colors",
                                studioEstimateActive
                                  ? "text-foreground/60 hover:bg-foreground/5 hover:text-foreground"
                                  : "text-white/70 hover:bg-white/10 hover:text-white"
                              )}
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
                                  ? PRICING_LEAD_COPY.nameTitle
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
                              {PRICING_LEAD_COPY.nameDescription}
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
                                  className={cn(
                                    "rounded-xl bg-[var(--sif-lead-gen-input-bg)] text-[var(--sif-lead-gen-fg)] placeholder:text-[color:var(--sif-lead-gen-placeholder)] focus-visible:ring-2 focus-visible:ring-offset-0",
                                    studioEstimateActive ? "border border-[color:var(--sif-lead-gen-input-border)]" : "border-0"
                                  )}
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
                                  placeholder={PRICING_LEAD_COPY.namePlaceholder}
                                  autoComplete="name"
                                  className={cn(
                                    "rounded-xl bg-[var(--sif-lead-gen-input-bg)] px-4 text-[var(--sif-lead-gen-fg)] placeholder:text-[color:var(--sif-lead-gen-placeholder)] focus-visible:ring-2 focus-visible:ring-offset-0",
                                    studioEstimateActive ? "border border-[color:var(--sif-lead-gen-input-border)]" : "border-0"
                                  )}
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
                                {PRICING_LEAD_COPY.nameCtaLabel}
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
                                  className={cn(
                                    "rounded-xl bg-[var(--sif-lead-gen-input-bg)] text-[var(--sif-lead-gen-fg)] placeholder:text-[color:var(--sif-lead-gen-placeholder)] focus-visible:ring-2 focus-visible:ring-offset-0",
                                    studioEstimateActive ? "border border-[color:var(--sif-lead-gen-input-border)]" : "border-0"
                                  )}
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
                            <div
                              className={cn("leading-relaxed", studioEstimateActive ? "text-red-600" : "text-red-200")}
                              style={{ fontSize: centeredPricingMetaSize }}
                            >
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
                                    ? PRICING_LEAD_COPY.nameFinePrint
                                    : PRICING_LEAD_COPY.phoneFinePrint}
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

              {/* Bottom overlay: upload + estimate only (AI ideas live in the question pane Ideas tab). */}
              {showBottomPreviewDock ? (
                <div className="absolute bottom-2 left-2 right-2 z-30 flex flex-col gap-1.5 pointer-events-auto pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:bottom-4 sm:left-4 sm:right-4 sm:gap-2">
                  {overlayPricingExpanded && (!leadGateEnabled || leadCaptured) && hero ? (
                    <div
                      className="ml-auto w-full rounded-2xl border border-white/10 shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-md sm:w-[min(32rem,calc(100%-0.5rem))]"
                      style={{
                        backgroundColor: singleModePricingPillBg,
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                        fontFamily: theme.fontFamily,
                      }}
                      data-overlay-estimate-expanded
                    >
                      <div
                        className={cn(
                          "relative",
                          waitingForExactPricing ? "p-2 sm:p-2.5" : "p-2 sm:p-2.5"
                        )}
                      >
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-0 rounded-2xl"
                          style={{
                            background:
                              "linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 22%, rgba(0,0,0,0.00) 55%), radial-gradient(120% 140% at 0% 0%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.00) 55%), radial-gradient(120% 140% at 100% 100%, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.00) 55%)",
                          }}
                        />

                        {waitingForExactPricing ? (
                          <div className="relative space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <Loader2
                                  className="h-4 w-4 shrink-0 animate-spin text-white/85"
                                  aria-hidden
                                />
                                <span
                                  className="min-w-0 truncate text-sm font-semibold text-white sm:text-[15px]"
                                  style={{ fontFamily: theme.fontFamily }}
                                >
                                  Updating your estimate
                                </span>
                              </div>
                              <button
                                type="button"
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/85 hover:bg-white/10 hover:text-white"
                                onClick={() => {
                                  setOverlayPricingCollapsedPreference(true);
                                  setOverlayPricingExpanded(false);
                                }}
                                aria-label="Collapse pricing"
                                title="Collapse pricing"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {onKeepDesigning ? (
                              <div className="flex justify-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onKeepDesigning();
                                  }}
                                  className="text-[10px] font-medium text-white/75 underline-offset-2 transition-colors hover:text-white/95 hover:underline"
                                  style={{ fontFamily: theme.fontFamily }}
                                >
                                  Keep designing
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <div className="relative flex items-start justify-between gap-2">
                              <div className="flex min-w-0 flex-1 flex-col items-center text-center">
                                <div
                                  className="inline-flex items-center justify-center gap-2"
                                  style={{ fontFamily: pricingDisplayFont }}
                                >
                                  <div className="text-[10px] font-semibold tracking-[0.12em] text-white/70 sm:text-[10.5px]">
                                    YOUR ESTIMATED PRICE
                                  </div>
                                </div>

                                <div className="mt-0.5 flex flex-col items-center gap-1">
                                  <div
                                    className="text-[26px] font-semibold tabular-nums leading-none tracking-[0.01em] text-white/95 sm:text-[30px]"
                                    style={{ fontFamily: pricingDisplayFont }}
                                  >
                                    {overlayPricingMidpointLabel}
                                  </div>
                                  <div
                                    className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/80"
                                    style={{ fontFamily: theme.fontFamily }}
                                  >
                                    {overlayPricingRangeLabel}
                                  </div>
                                </div>
                                {previewBookingCta.primaryUrl ? (
                                  <Button
                                    asChild
                                    className="mt-2 h-11 w-full max-w-[18rem] rounded-full px-4 text-sm font-semibold shadow-sm sm:h-12 sm:text-[15px]"
                                    style={{ backgroundColor: primary, color: "#fff", fontFamily: theme.fontFamily }}
                                  >
                                    <a href={previewBookingCta.primaryUrl} target="_blank" rel="noopener noreferrer">
                                      {previewBookingCta.primaryLabel}
                                    </a>
                                  </Button>
                                ) : onKeepDesigning ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onKeepDesigning();
                                    }}
                                    className="mt-1.5 text-[10px] font-medium text-white/75 underline-offset-2 transition-colors hover:text-white/95 hover:underline"
                                    style={{ fontFamily: theme.fontFamily }}
                                  >
                                    Keep designing
                                  </button>
                                ) : null}
                              </div>

                              <button
                                type="button"
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/85 hover:bg-white/10 hover:text-white"
                                onClick={() => {
                                  setOverlayPricingCollapsedPreference(true);
                                  setOverlayPricingExpanded(false);
                                }}
                                aria-label="Collapse pricing"
                                title="Collapse pricing"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                  <div className="flex w-full max-w-[min(32rem,calc(100%-0.5rem))] flex-wrap items-center justify-end gap-2 self-end">
                    <div className="flex min-w-0 flex-1 justify-end gap-2 sm:gap-3">{previewPricingPill}</div>
                  </div>
                  )}
                </div>
              ) : null}

	              {/* Side navigation arrows — outside the clipped inner container */}
	              {hero && canPrev && !leadGateActive && (
	                <button
	                  type="button"
	                  onClick={goPrev}
	                  className="absolute left-0 top-1/2 -translate-y-1/2 z-30 flex h-16 w-8 sm:h-20 sm:w-9 items-center justify-center rounded-r-lg border-y border-r border-white/20 bg-black/25 text-3xl sm:text-4xl font-thin leading-none text-white/90 transition-colors hover:bg-black/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
	                  aria-label="Previous preview"
	                >
	                  ‹
	                </button>
	              )}
	              {hero && canNext && !leadGateActive && (
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
  if (headless) return null;
  return renderPreview();
}
