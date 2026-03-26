export type NumericRange = { low: number; high: number };

export type PricingPriceDriver = { key: string; label: string };

export type PricingEstimateSnapshot = {
  status?: "idle" | "running" | "complete" | "error";
  contextHash?: string;
  scopeHash?: string;
  sourcePhase?: "scope_seed" | "runtime";
  totalMin?: number;
  totalMax?: number;
  currency?: string;
  source?: string;
  confidence?: string;
  requestId?: string;
  imagePriceRange?: NumericRange;
  servicePriceRange?: NumericRange;
  visibleBandClamp?: NumericRange;
  starterBaseline?: NumericRange;
  baselinePriceRange?: NumericRange;
  deltaPriceRange?: NumericRange;
  deltaDirection?: "up" | "down" | "flat";
  budgetTier?: string;
  budgetTierRanges?: Record<string, NumericRange>;
  priceDrivers?: PricingPriceDriver[];
  calibrationKey?: string;
  medianPrice?: number;
  startedAt?: number;
  updatedAt?: number;
  error?: string;
  errorDetails?: any;
};

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function normalizeNumericRange(
  raw: unknown,
  opts?: { allowNegative?: boolean }
): NumericRange | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const low = toFiniteNumber(value.low ?? value.min ?? value.rangeLow ?? value.range_low);
  const high = toFiniteNumber(value.high ?? value.max ?? value.rangeHigh ?? value.range_high);
  if (low === null || high === null) return undefined;
  if (!opts?.allowNegative && (low <= 0 || high <= 0)) return undefined;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

export function normalizeBudgetTierRanges(raw: unknown): Record<string, NumericRange> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const normalized = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => [String(key || "").trim().toLowerCase(), normalizeNumericRange(value)])
      .filter((entry): entry is [string, NumericRange] => Boolean(entry[0] && entry[1]))
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizePriceDrivers(raw: unknown): PricingPriceDriver[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const drivers = raw
    .map((item) => {
      const key = typeof (item as any)?.key === "string" ? String((item as any).key).trim() : "";
      const label =
        typeof (item as any)?.label === "string"
          ? String((item as any).label).trim()
          : key;
      return key ? { key, label: label || key } : null;
    })
    .filter((item): item is PricingPriceDriver => Boolean(item));
  return drivers.length > 0 ? drivers : undefined;
}

function midpoint(range: NumericRange | undefined): number | undefined {
  if (!range) return undefined;
  return Math.round((range.low + range.high) / 2);
}

export function normalizePricingEstimate(raw: unknown): PricingEstimateSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const imagePriceRange = normalizeNumericRange(value.imagePriceRange ?? value.image_price_range);
  const servicePriceRange = normalizeNumericRange(value.servicePriceRange ?? value.service_price_range);
  const visibleBandClamp = normalizeNumericRange(value.visibleBandClamp ?? value.visible_band_clamp);
  const starterBaseline = normalizeNumericRange(value.starterBaseline ?? value.starter_baseline);
  const baselinePriceRange = normalizeNumericRange(value.baselinePriceRange ?? value.baseline_price_range);
  const deltaPriceRange = normalizeNumericRange(value.deltaPriceRange ?? value.delta_price_range, { allowNegative: true });
  const totalMinRaw = toFiniteNumber(value.totalMin ?? value.total_min ?? value.rangeLow ?? value.range_low ?? imagePriceRange?.low);
  const totalMaxRaw = toFiniteNumber(value.totalMax ?? value.total_max ?? value.rangeHigh ?? value.range_high ?? imagePriceRange?.high);
  const totalMin =
    totalMinRaw !== null && totalMaxRaw !== null ? Math.min(totalMinRaw, totalMaxRaw) : imagePriceRange?.low;
  const totalMax =
    totalMinRaw !== null && totalMaxRaw !== null ? Math.max(totalMinRaw, totalMaxRaw) : imagePriceRange?.high;
  const budgetTierRanges = normalizeBudgetTierRanges(value.budgetTierRanges ?? value.budget_tier_ranges);
  const priceDrivers = normalizePriceDrivers(value.priceDrivers ?? value.price_drivers);
  const medianPriceRaw = toFiniteNumber(value.medianPrice ?? value.median_price);
  const estimatedMedian = midpoint(servicePriceRange) ?? midpoint(imagePriceRange);

  const estimate: PricingEstimateSnapshot = {
    ...(typeof value.status === "string" ? { status: value.status as PricingEstimateSnapshot["status"] } : {}),
    ...(typeof value.contextHash === "string" ? { contextHash: String(value.contextHash) } : {}),
    ...(typeof value.scopeHash === "string" ? { scopeHash: String(value.scopeHash) } : {}),
    ...(typeof value.sourcePhase === "string" ? { sourcePhase: value.sourcePhase as PricingEstimateSnapshot["sourcePhase"] } : {}),
    ...(typeof totalMin === "number" ? { totalMin } : {}),
    ...(typeof totalMax === "number" ? { totalMax } : {}),
    ...(typeof value.currency === "string" && String(value.currency).trim()
      ? { currency: String(value.currency).trim().toUpperCase() }
      : {}),
    ...(typeof value.source === "string" ? { source: String(value.source) } : {}),
    ...(typeof value.confidence === "string" ? { confidence: String(value.confidence).trim().toLowerCase() } : {}),
    ...(typeof value.requestId === "string" ? { requestId: String(value.requestId) } : {}),
    ...(imagePriceRange ? { imagePriceRange } : {}),
    ...(servicePriceRange ? { servicePriceRange } : {}),
    ...(visibleBandClamp ? { visibleBandClamp } : {}),
    ...(starterBaseline ? { starterBaseline } : {}),
    ...(baselinePriceRange ? { baselinePriceRange } : {}),
    ...(deltaPriceRange ? { deltaPriceRange } : {}),
    ...(typeof value.deltaDirection === "string"
      ? { deltaDirection: String(value.deltaDirection).trim().toLowerCase() as PricingEstimateSnapshot["deltaDirection"] }
      : {}),
    ...(typeof value.budgetTier === "string" ? { budgetTier: String(value.budgetTier).trim().toLowerCase() } : {}),
    ...(budgetTierRanges ? { budgetTierRanges } : {}),
    ...(priceDrivers ? { priceDrivers } : {}),
    ...(typeof value.calibrationKey === "string" ? { calibrationKey: String(value.calibrationKey).trim() } : {}),
    ...(typeof medianPriceRaw === "number"
      ? { medianPrice: Math.round(medianPriceRaw) }
      : typeof estimatedMedian === "number"
        ? { medianPrice: estimatedMedian }
        : {}),
    ...(typeof value.startedAt === "number" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.updatedAt === "number" ? { updatedAt: value.updatedAt } : {}),
    ...(typeof value.error === "string" ? { error: String(value.error) } : {}),
    ...("errorDetails" in value ? { errorDetails: value.errorDetails } : {}),
  };

  return Object.keys(estimate).length > 0 ? estimate : null;
}
