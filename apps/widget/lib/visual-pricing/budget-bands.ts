import type { BudgetBand, BudgetBandKey } from "./types";
import { roundCurrencyBucket } from "./rounding";

export type NumericRange = { low: number; high: number };

export type BudgetPricingSeed = {
  currency?: string | null;
  source?: string | null;
  confidence?: string | null;
  budgetTierRanges?: Record<string, unknown> | null;
  budget_tier_ranges?: Record<string, unknown> | null;
  servicePriceRange?: unknown;
  service_price_range?: unknown;
};

const BAND_LABELS: Record<BudgetBandKey, string> = {
  essential: "Essential",
  mid_range: "Mid-range",
  premium: "Premium",
  not_sure: "Not sure",
};

function finiteNumber(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

export function normalizeReliableRange(raw: unknown): NumericRange | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const lowRaw = finiteNumber(value.low ?? value.min ?? value.rangeLow ?? value.range_low);
  const highRaw = finiteNumber(value.high ?? value.max ?? value.rangeHigh ?? value.range_high);
  if (lowRaw === null || highRaw === null) return null;
  const low = Math.min(lowRaw, highRaw);
  const high = Math.max(lowRaw, highRaw);
  if (low <= 0 || high <= 0 || high <= low || high / low > 10) return null;
  return { low, high };
}

function isPricingSeedReliable(seed: BudgetPricingSeed | null | undefined): boolean {
  if (!seed) return false;
  const source = String(seed.source || "").trim().toLowerCase();
  const confidence = String(seed.confidence || "").trim().toLowerCase();
  if (source.includes("fallback")) return false;
  if (["low", "very_low", "unreliable", "unknown"].includes(confidence)) return false;
  return true;
}

function normalizeTierKey(raw: string): BudgetBandKey | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["essential", "essentials", "basic", "budget", "value", "low", "entry", "starter"].includes(key)) return "essential";
  if (["mid", "middle", "medium", "mid_range", "standard", "balanced"].includes(key)) return "mid_range";
  if (["premium", "high", "luxury", "lux", "top"].includes(key)) return "premium";
  return null;
}

function qualitativeBands(currency: string): BudgetBand[] {
  return (["essential", "mid_range", "premium", "not_sure"] as BudgetBandKey[]).map((key) => ({
    key,
    label: BAND_LABELS[key],
    currency,
    source: "qualitative" as const,
  }));
}

function bandsFromTierRanges(seed: BudgetPricingSeed, currency: string): BudgetBand[] | null {
  const raw = seed.budgetTierRanges ?? seed.budget_tier_ranges;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw)
    .map(([key, value]) => ({ rawKey: key, key: normalizeTierKey(key), range: normalizeReliableRange(value) }))
    .filter((entry): entry is { rawKey: string; key: BudgetBandKey | null; range: NumericRange } => Boolean(entry.range));

  const byKey = new Map<BudgetBandKey, NumericRange>();
  for (const entry of entries) {
    if (!entry.key || entry.key === "not_sure") continue;
    const existing = byKey.get(entry.key);
    if (!existing) byKey.set(entry.key, entry.range);
    else if (entry.key === "premium") {
      const merged = normalizeReliableRange({
        low: Math.min(existing.low, entry.range.low),
        high: Math.max(existing.high, entry.range.high),
      });
      if (merged) byKey.set(entry.key, merged);
    }
  }

  if (!["essential", "mid_range", "premium"].every((key) => byKey.has(key as BudgetBandKey))) {
    const sorted = entries.map((entry) => entry.range).sort((a, b) => a.low - b.low || a.high - b.high);
    if (sorted.length < 3) return null;
    byKey.set("essential", sorted[0]);
    byKey.set("mid_range", sorted[1]);
    byKey.set("premium", sorted[2]);
  }

  const essential = byKey.get("essential")!;
  const mid = byKey.get("mid_range")!;
  const premium = byKey.get("premium")!;
  if (!(essential.low <= mid.low && mid.low <= premium.low)) return null;

  const bands: BudgetBand[] = (["essential", "mid_range", "premium"] as BudgetBandKey[])
    .map((key): BudgetBand => {
      const range = byKey.get(key)!;
      return { key, label: BAND_LABELS[key], ...range, currency, source: "budget_tier_ranges" as const };
    });
  bands.push({ key: "not_sure", label: BAND_LABELS.not_sure, currency, source: "qualitative" });
  return bands;
}

function bandsFromServiceRange(seed: BudgetPricingSeed, currency: string): BudgetBand[] | null {
  const range = normalizeReliableRange(seed.servicePriceRange ?? seed.service_price_range);
  if (!range) return null;
  const span = range.high - range.low;
  const firstBoundary = roundCurrencyBucket(range.low + span / 3);
  const secondBoundary = roundCurrencyBucket(range.low + (span * 2) / 3);
  if (!(range.low < firstBoundary && firstBoundary < secondBoundary && secondBoundary < range.high)) return null;

  return [
    { key: "essential", label: BAND_LABELS.essential, low: range.low, high: firstBoundary, currency, source: "service_price_range" },
    { key: "mid_range", label: BAND_LABELS.mid_range, low: firstBoundary, high: secondBoundary, currency, source: "service_price_range" },
    { key: "premium", label: BAND_LABELS.premium, low: secondBoundary, high: range.high, currency, source: "service_price_range" },
    { key: "not_sure", label: BAND_LABELS.not_sure, currency, source: "qualitative" },
  ];
}

export function deriveBudgetBands(seed?: BudgetPricingSeed | null): BudgetBand[] {
  const currency = typeof seed?.currency === "string" && seed.currency.trim() ? seed.currency.trim().toUpperCase() : "USD";
  if (!isPricingSeedReliable(seed)) return qualitativeBands(currency);
  return bandsFromTierRanges(seed!, currency) ?? bandsFromServiceRange(seed!, currency) ?? qualitativeBands(currency);
}

export function budgetBandMidpoint(band: BudgetBand | null | undefined): number | null {
  if (!band || band.key === "not_sure") return null;
  if (!Number.isFinite(band.low) || !Number.isFinite(band.high)) return null;
  return Math.round((Number(band.low) + Number(band.high)) / 2);
}
