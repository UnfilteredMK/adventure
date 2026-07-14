import { normalizeBatchId } from "./step-answers";
import { DETERMINISTIC_STYLE_ID } from "../constants";

export function parseBatchOrder(batchId: string | null | undefined): number | null {
  if (!batchId) return null;
  const normalized = normalizeBatchId(batchId);
  if (!normalized) return null;
  const match = normalized.match(/^batch-(\d+)$/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function getStepJoggerLabel(step: any, index: number): string {
  const stepId = String(step?.id || "");
  if (stepId.startsWith("step-service-primary")) return "Service";
  if (stepId === DETERMINISTIC_STYLE_ID) return "Starting Ideas";
  if (stepId.includes("budget")) return "Budget";
  if (stepId.includes("upload-scene")) return "Upload Photo";
  if (stepId.includes("upload-user")) return "Person Photo";
  if (stepId.includes("upload-product")) return "Product Photo";
  if (stepId.includes("lead") || stepId.includes("email") || stepId.includes("phone") || stepId.includes("full-name")) {
    return "Contact";
  }
  if ((step as any)?.functionCall?.name) {
    const fn = String((step as any).functionCall.name).replace(/[_-]+/g, " ").trim();
    return fn ? fn.replace(/\b\w/g, (c) => c.toUpperCase()) : `Step ${index + 1}`;
  }

  const raw = String(step?.copy?.headline || step?.question || step?.content?.prompt || "").trim();
  if (!raw) return `Step ${index + 1}`;

  const firstClause = raw.split(/[?.!]/)[0]?.trim() || raw;
  const cleaned = firstClause
    .replace(/^(what|which|how|where|when|tell us|let us|please)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean);
  return (words.slice(0, 4).join(" ") || `Step ${index + 1}`).replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildStepJoggerSteps(args: {
  steps: any[];
  currentStepIndex: number;
  maxVisitedIndex: number;
  effectiveLeadCompleteForPreviewFlow: boolean;
  previewHasImage: boolean;
  belowPreviewControlStepIds: Set<string>;
  refinementUploadStepId: string;
  getStepMetaById: (stepId: string) => { batchId?: string | null } | null;
}): Array<{ step: any; index: number }> {
  const {
    steps,
    currentStepIndex,
    maxVisitedIndex,
    effectiveLeadCompleteForPreviewFlow,
    previewHasImage,
    belowPreviewControlStepIds,
    refinementUploadStepId,
    getStepMetaById,
  } = args;

  if (!steps?.length) return [];
  const indexed = steps.map((step, index) => ({ step, index }));
  const withoutLeadCapture = indexed.filter(({ step }) => {
    const stepId = String((step as any)?.id || "").toLowerCase();
    const stepType = String((step as any)?.type || "").toLowerCase();
    const componentType = String((step as any)?.componentType || "").toLowerCase();
    if (stepType === "lead_capture" || componentType === "lead_capture") return false;
    if (
      stepId === "step-lead-capture" ||
      stepId === "step-lead-name" ||
      stepId === "step-lead-phone"
    ) {
      return false;
    }
    return true;
  });
  const withoutRefinementUpload = withoutLeadCapture.filter(
    ({ step }) => String((step as any)?.id || "") !== refinementUploadStepId
  );
  const withoutBudgetUploadWhenLeadCaptured =
    effectiveLeadCompleteForPreviewFlow && previewHasImage
      ? withoutRefinementUpload.filter(
          ({ step }) => !belowPreviewControlStepIds.has(String((step as any)?.id || ""))
        )
      : withoutRefinementUpload;
  if (effectiveLeadCompleteForPreviewFlow && previewHasImage) return withoutBudgetUploadWhenLeadCaptured;

  const revealThroughIndex = Math.max(currentStepIndex ?? 0, maxVisitedIndex ?? 0);
  let maxOrder: number | null = null;
  for (let i = 0; i <= revealThroughIndex && i < steps.length; i += 1) {
    const stepId = String((steps[i] as any)?.id || "");
    if (!stepId) continue;
    const meta = getStepMetaById(stepId);
    const order = parseBatchOrder(meta?.batchId);
    if (order === null) continue;
    maxOrder = maxOrder === null ? order : Math.max(maxOrder, order);
  }
  // Reveal jogger entries through the highest batch the user has reached.
  // Capping at batch-1 hides legitimately visited steps (e.g. style) and
  // makes the top timeline look like steps were removed.
  const effectiveRevealBatchOrder = maxOrder ?? 1;

  return withoutBudgetUploadWhenLeadCaptured.filter(({ step }) => {
    const stepId = String((step as any)?.id || "");
    if (!stepId) return true;
    const meta = getStepMetaById(stepId);
    const order = parseBatchOrder(meta?.batchId);
    if (order === null || effectiveRevealBatchOrder === null) return true;
    return order <= effectiveRevealBatchOrder;
  });
}
