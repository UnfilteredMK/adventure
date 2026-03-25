import { useMemo } from "react";
import {
  DETERMINISTIC_BUDGET_ID,
  DETERMINISTIC_PRODUCT_IMAGE_ID,
  DETERMINISTIC_SCENE_IMAGE_ID,
  DETERMINISTIC_USER_IMAGE_ID,
} from "../constants";

function normalizeBool(value: any): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
    if (v === "false" || v === "0" || v === "no" || v === "off") return false;
    return null;
  }
  return null;
}

export function useStepEngineUiConfig(args: {
  instanceId: string;
  sessionScopeKey?: string;
  disableLegacyBudgetUploadSteps?: boolean;
  flowLayout?: { showProgressBar?: boolean; showStepNumbers?: boolean } | null;
  formUI?: { showProgressBar?: boolean; showStepDescriptions?: boolean } | null;
}) {
  const { instanceId, sessionScopeKey, disableLegacyBudgetUploadSteps = false, flowLayout, formUI } = args;
  const legacyBudgetUploadEnabled = !disableLegacyBudgetUploadSteps;
  const excludedAdventureStepIds = useMemo(
    () =>
      legacyBudgetUploadEnabled
        ? []
        : [DETERMINISTIC_BUDGET_ID, DETERMINISTIC_SCENE_IMAGE_ID, DETERMINISTIC_USER_IMAGE_ID, DETERMINISTIC_PRODUCT_IMAGE_ID],
    [legacyBudgetUploadEnabled]
  );
  const uiShowProgressBar = normalizeBool(formUI?.showProgressBar);
  const uiShowStepDescriptions = normalizeBool(formUI?.showStepDescriptions);
  const showProgressBar = uiShowProgressBar !== null ? uiShowProgressBar : flowLayout?.showProgressBar !== false;
  const showStepDescriptions =
    uiShowStepDescriptions !== null ? uiShowStepDescriptions : flowLayout?.showStepNumbers !== false;
  const effectiveSessionScopeKey = sessionScopeKey || instanceId;

  return {
    legacyBudgetUploadEnabled,
    excludedAdventureStepIds,
    showProgressBar,
    showStepDescriptions,
    effectiveSessionScopeKey,
  };
}
