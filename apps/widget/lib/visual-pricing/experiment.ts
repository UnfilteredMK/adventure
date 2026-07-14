import type { PricingGateStrategy, PricingGateVariant } from "./types";

export type SessionStorageLike = Pick<Storage, "getItem" | "setItem">;

export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalizePercent(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, value));
}

export function assignPricingGateVariant(params: {
  strategy?: PricingGateStrategy | null;
  experimentPercent?: number | null;
  experimentKey?: string | null;
  instanceId: string;
  sessionId: string;
  storage?: SessionStorageLike | null;
}): PricingGateVariant {
  const strategy = params.strategy === "coarse_visible" || params.strategy === "experiment" ? params.strategy : "blurred";
  const experimentKey = String(params.experimentKey || "visual-pricing-v1-gate-1").trim() || "visual-pricing-v1-gate-1";
  const storageKey = `adventure:pricing-gate:${params.instanceId}:${params.sessionId}:${experimentKey}`;

  try {
    const stored = params.storage?.getItem(storageKey);
    if (stored === "blurred" || stored === "coarse_visible") return stored;
  } catch {}

  const variant: PricingGateVariant = (() => {
    if (strategy === "coarse_visible") return "coarse_visible";
    if (strategy === "blurred") return "blurred";
    const bucket = fnv1a32(`${params.instanceId}:${params.sessionId}:${experimentKey}`) % 10_000;
    return bucket < normalizePercent(params.experimentPercent) * 100 ? "coarse_visible" : "blurred";
  })();

  try {
    params.storage?.setItem(storageKey, variant);
  } catch {}
  return variant;
}

