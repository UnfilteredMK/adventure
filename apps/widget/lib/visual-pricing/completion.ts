import type { BudgetBand } from "./types";

export function isProjectPhaseComplete(input: {
  serviceId: string | null | undefined;
  scope: string | null | undefined;
  componentKeys: string[];
  componentsAvailable: boolean;
  budgetBand: BudgetBand | null | undefined;
}): boolean {
  if (!String(input.serviceId || "").trim()) return false;
  if (!String(input.scope || "").trim()) return false;
  if (input.componentsAvailable && (!Array.isArray(input.componentKeys) || input.componentKeys.length < 1)) return false;
  if (!input.budgetBand) return false;
  return true;
}

export function isLookPhaseComplete(styleValues: string[]): boolean {
  return Array.isArray(styleValues) && styleValues.length >= 1 && styleValues.length <= 2;
}

