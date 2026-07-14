import { budgetBandMidpoint } from "./budget-bands";
import type { BudgetBand } from "./types";

export function mirrorBudgetBandAnswer(
  answers: Record<string, any>,
  band: BudgetBand,
): Record<string, any> {
  const next: Record<string, any> = { ...answers, "step-budget-band": band };
  const midpoint = budgetBandMidpoint(band);
  if (midpoint === null) delete next["step-budget-range"];
  else next["step-budget-range"] = midpoint;
  return next;
}

export type LatestRequestSequence = {
  next: () => number;
  isCurrent: (requestId: number) => boolean;
  invalidate: () => void;
};

/** Small request guard used with AbortController to reject responses that win a stale race. */
export function createLatestRequestSequence(): LatestRequestSequence {
  let current = 0;
  return {
    next() {
      current += 1;
      return current;
    },
    isCurrent(requestId) {
      return requestId === current;
    },
    invalidate() {
      current += 1;
    },
  };
}
