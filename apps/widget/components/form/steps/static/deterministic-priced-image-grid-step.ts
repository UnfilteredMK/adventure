import type { UIStep } from "@/types/ai-form";
import type { PreviewCacheSnapshot, PreviewPriceSnapshot, PreviewRunSnapshot } from "../image-preview-experience/gallery/preview-cache-bridge";
import { roundCurrencyBucket } from "@/lib/visual-pricing/rounding";

export const DETERMINISTIC_PRICED_IMAGE_GRID_ID = "step-priced-image-grid";

type PriceRange = {
  low: number;
  high: number;
  currency: string;
};

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function normalizeExplicitPrice(price: PreviewPriceSnapshot | undefined | null): PriceRange | null {
  const low = Number(price?.totalMin);
  const high = Number(price?.totalMax);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const currency = typeof price?.currency === "string" && price.currency.trim() ? price.currency.trim().toUpperCase() : "USD";
  return {
    low: Math.max(0, Math.min(low, high)),
    high: Math.max(0, Math.max(low, high)),
    currency,
  };
}

function deriveVariantPriceRange(baseRange: PriceRange, imageUrl: string, index: number): PriceRange {
  const orderedOffsets = [0, 0.08, -0.04, 0.05, -0.02, 0.1, -0.01, 0.06, 0.14];
  const width = Math.max(1000, baseRange.high - baseRange.low);
  const hashOffset = ((stableHash(`${imageUrl}:${index}`) % 7) - 3) * 0.01;
  const offset = (orderedOffsets[index % orderedOffsets.length] ?? 0) + hashOffset;
  const nextLow = roundCurrencyBucket(baseRange.low * (1 + offset));
  const nextHigh = roundCurrencyBucket(baseRange.high * (1 + offset));
  const low = Math.max(1000, Math.min(nextLow, nextHigh - 500));
  const high = Math.max(low + Math.max(500, Math.round(width * 0.32)), Math.max(nextLow, nextHigh));
  return {
    low,
    high,
    currency: baseRange.currency,
  };
}

function buildFallbackBaseRange(run: PreviewRunSnapshot): PriceRange {
  const explicit = (Array.isArray(run.imagePricing) ? run.imagePricing : [])
    .map((entry) => normalizeExplicitPrice(entry))
    .find(Boolean);
  if (explicit) return explicit;
  return { low: 12000, high: 18000, currency: "USD" };
}

function resolveTargetCount(run: PreviewRunSnapshot): number {
  const expected =
    typeof run.expectedImageCount === "number" && Number.isFinite(run.expectedImageCount)
      ? Math.floor(run.expectedImageCount)
      : run.images.length;
  return Math.max(6, Math.min(9, Math.max(expected, run.images.length, 6)));
}

export function buildDeterministicPricedImageGridStep(params: {
  cache: PreviewCacheSnapshot | null;
  run: PreviewRunSnapshot | null;
}): UIStep | null {
  const { cache, run } = params;
  if (!cache || !run) return null;
  const expectedCount =
    typeof run.expectedImageCount === "number" && Number.isFinite(run.expectedImageCount)
      ? Math.floor(run.expectedImageCount)
      : run.images.length;
  if (Math.max(expectedCount, run.images.length) <= 1) return null;
  const targetCount = resolveTargetCount(run);
  const baseRange = buildFallbackBaseRange(run);
  const options = Array.from({ length: targetCount }).map((_, index) => {
    const imageUrl = typeof run.images[index] === "string" ? run.images[index] : "";
    const explicitPrice = normalizeExplicitPrice(run.imagePricing?.[index]);
    const priceRange = explicitPrice ?? deriveVariantPriceRange(baseRange, imageUrl || `placeholder:${index}`, index);
    return {
      label: `Concept ${index + 1}`,
      value: imageUrl || `preview-placeholder-${index + 1}`,
      imageUrl: imageUrl || undefined,
      disabled: !imageUrl,
      priceRange,
      previewIndex: index,
      previewRunId: run.id,
    };
  });

  return {
    id: DETERMINISTIC_PRICED_IMAGE_GRID_ID,
    type: "image_choice_grid",
    question: "Choose the concept that feels most like your project",
    humanism: "Browse the deck, compare the estimated ranges, then tap your favorite to continue.",
    options: options as any,
    multi_select: false,
    columns: 3,
    metricGain: 0.04,
    blueprint: {
      presentation: {
        auto_advance: true,
      },
      validation: {
        grid_mode: "generated_concepts",
        trust_line: "Generated from your answers and inspiration picks",
      },
    },
  } as UIStep;
}
