/** Shared display-price rounding used by concept cards and V1 budget-band boundaries. */
export function roundCurrencyBucket(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 2500) return Math.round(value / 250) * 250;
  if (value < 10000) return Math.round(value / 500) * 500;
  return Math.round(value / 1000) * 1000;
}

