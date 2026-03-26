"use client";

import { formatCurrency } from "@/lib/ai-form/utils/currency";
import { safeStableJsonForPricingContext } from "../../../runtime/step-engine/utils/pricing-context";
import type { CachedPricing } from "../types";
import { pickHttpUrl } from "./images";

export function buildPricingStepSnapshot(stepDataSoFar: Record<string, any>): Record<string, any> {
  try {
    const stable = safeStableJsonForPricingContext(stepDataSoFar || {});
    if (!stable) return {};
    const parsed = JSON.parse(stable);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function extractBudgetValue(stepData: Record<string, any>): number | null {
  const raw =
    (stepData as any)?.["step-budget-range"] ??
    (stepData as any)?.["budget_range"] ??
    (stepData as any)?.["budgetRange"] ??
    (stepData as any)?.["step-budget"];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeNumericRange(
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

export function resolveBudgetTierFromRanges(
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

export function formatPricingRangeText(params: {
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

export function formatCompactCurrency(amount: number, locale?: string, currency?: string): string {
  const normalizedCurrency = String(currency || "USD").trim().toUpperCase() || "USD";
  return new Intl.NumberFormat(locale || undefined, {
    style: "currency",
    currency: normalizedCurrency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

export function formatCompactPricingRangeText(params: {
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

export function readConfirmationScheduleUrlFromSteps(steps: any[] | undefined): string | null {
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    const id = String((step as any)?.id ?? (step as any)?.stepId ?? "").trim();
    if (id !== "step-confirmation") continue;
    const url = pickHttpUrl((step as any)?.data?.scheduleUrl);
    if (url) return url;
  }
  return null;
}

export function splitPricingMaskSegments(rangeText: string | null): {
  prefix: string;
  blur: string;
} | null {
  if (!rangeText) return null;
  const raw = String(rangeText).trim();
  const m = raw.match(/^(\D*\d)(.*)$/);
  if (!m) return { prefix: raw, blur: "" };
  return { prefix: m[1], blur: m[2] || "" };
}

export function isPricingComparableUseCase(raw?: string | null): boolean {
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

export function shouldTrackRefinementChange(key: string): boolean {
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

export function buildChangedRefinementKeys(params: {
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
    if (currentValue === null || currentValue === undefined || valueForDiff(currentValue) === valueForDiff(previousValue)) {
      continue;
    }
    const label = labelByStepId.get(key) || key.replace(/^step-/, "").replace(/[-_]+/g, " ").trim();
    out.push({ key, label });
    if (out.length >= 8) break;
  }
  return out;
}
