import { useEffect, useRef, useState } from "react";
import { DETERMINISTIC_SCENE_IMAGE_ID } from "../constants";
import { isQuestionStepForAskedIds } from "../utils/step-classification";

type PendingAdvance = { stepId: string; data: any } | null;

export function useRefinementOrchestration(args: {
  enabled?: boolean;
  previewHasImage: boolean;
  flowPlanSessionId?: string;
  instanceId: string;
  effectiveLeadCompleteForPreviewFlow: boolean;
  addSteps: (steps: any[], autoAdvance?: boolean, options?: { insertAtIndex?: number; moveExisting?: boolean }) => void;
  currentStep: any;
  patchStep: (stepId: string, patch: any) => void;
  stateCurrentStepIndex: number;
  stateStepData: any;
  stateSteps: any[];
  isStructuralStep: (step: any) => boolean;
  goToStep: (index: number) => void;
  goToNextStep: (data?: any) => Promise<void> | void;
  refinementUploadStepId: string;
  pendingRefinementPreviewAdvanceRef: React.MutableRefObject<PendingAdvance>;
  pendingRefinementPreviewAdvanceStageRef: React.MutableRefObject<"idle" | "waiting_for_start" | "waiting_for_finish">;
  previewAutoGenerationBusy: boolean;
}) {
  // Deprecated for fixed local skeleton form mode.
  // This hook remains for legacy / future refinement flows and is gated off in the simplified runtime.
  const {
    enabled = true,
    previewHasImage,
    flowPlanSessionId,
    instanceId,
    effectiveLeadCompleteForPreviewFlow,
    addSteps,
    currentStep,
    patchStep,
    stateCurrentStepIndex,
    stateStepData,
    stateSteps,
    isStructuralStep,
    goToStep,
    goToNextStep,
    refinementUploadStepId,
    pendingRefinementPreviewAdvanceRef,
    pendingRefinementPreviewAdvanceStageRef,
    previewAutoGenerationBusy,
  } = args;
  const refinementsFetchedRef = useRef(false);
  const refinementAdvanceFromStepIdRef = useRef<string | null>(null);
  const pendingRefinementFocusStepIdRef = useRef<string | null>(null);
  const [awaitingRefinementAdvance, setAwaitingRefinementAdvance] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (!previewHasImage || !flowPlanSessionId || !instanceId) return;
    if (!effectiveLeadCompleteForPreviewFlow) return;
    if (refinementsFetchedRef.current) return;
    refinementsFetchedRef.current = true;

    const steps = stateSteps || [];
    const stepData = stateStepData || {};
    const questionStepIds = steps
      .filter((s: any) => isQuestionStepForAskedIds(s))
      .map((s: any) => String((s as any)?.id || ""))
      .filter(Boolean);

    fetch(`/api/ai-form/${instanceId}/refinements`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        sessionId: flowPlanSessionId,
        stepDataSoFar: stepData,
        askedStepIds: questionStepIds,
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Refinements ${r.status}`))))
      .then((json: any) => {
        const miniSteps = Array.isArray(json?.miniSteps) ? json.miniSteps : [];
        const alreadyHasSceneUpload = steps.some((s: any) => String((s as any)?.id || "") === DETERMINISTIC_SCENE_IMAGE_ID);
        const deterministicUploadStep = {
          id: refinementUploadStepId,
          type: "file_upload",
          question: "",
          humanism: "Start from your real space for better refinements.",
          required: false,
          allow_skip: true,
          upload_role: "scene",
          blueprint: { presentation: { continue_label: "Continue", allow_skip: true } },
        } as any;
        const incoming = alreadyHasSceneUpload ? miniSteps : [deterministicUploadStep, ...miniSteps];
        const existingIds = new Set(steps.map((s: any) => String((s as any)?.id || "")).filter(Boolean));
        incoming.forEach((step: any) => {
          const stepId = String((step as any)?.id || "");
          if (!stepId || !existingIds.has(stepId)) return;
          patchStep(stepId, {
            __refinementStep: stepId !== refinementUploadStepId,
            __refinementUploadStep: stepId === refinementUploadStepId,
          });
        });
        const deduped = incoming.filter((s: any) => {
          const id = String((s as any)?.id || "");
          return id && !existingIds.has(id);
        });
        if (deduped.length === 0) return;

        const markedDeduped = deduped.map((step: any) => {
          const stepId = String((step as any)?.id || "");
          if (!stepId) return step;
          return {
            ...step,
            __refinementStep: stepId !== refinementUploadStepId,
            __refinementUploadStep: stepId === refinementUploadStepId,
          };
        });

        const firstRefinementQuestionId =
          markedDeduped.find((s: any) => String((s as any)?.id || "") !== refinementUploadStepId)?.id || null;

        const currentIdx = stateCurrentStepIndex ?? 0;
        const designerIdx = steps.findIndex((s: any) => String((s as any)?.id || "") === "step-designer");
        const minPreviewInsertIndex = designerIdx >= 0 ? designerIdx + 1 : 0;
        const insertAtIndex = Math.min(steps.length, Math.max(minPreviewInsertIndex, currentIdx + 1));
        const userIsWaiting = currentIdx >= steps.length - 1;
        if (userIsWaiting && currentStep?.id) {
          refinementAdvanceFromStepIdRef.current = String(currentStep.id);
          setAwaitingRefinementAdvance(true);
        }
        if (!userIsWaiting && currentStep && isStructuralStep(currentStep) && firstRefinementQuestionId) {
          pendingRefinementFocusStepIdRef.current = String(firstRefinementQuestionId);
        }
        addSteps(markedDeduped, userIsWaiting, { insertAtIndex });
        if (!userIsWaiting) {
          refinementAdvanceFromStepIdRef.current = null;
          setAwaitingRefinementAdvance(false);
        }
      })
      .catch((e) => {
        refinementsFetchedRef.current = false;
        refinementAdvanceFromStepIdRef.current = null;
        setAwaitingRefinementAdvance(false);
        if (typeof console !== "undefined" && console.warn) console.warn("[StepEngine] Refinements fetch failed", e);
      });
  }, [
    addSteps,
    currentStep,
    effectiveLeadCompleteForPreviewFlow,
    flowPlanSessionId,
    instanceId,
    isStructuralStep,
    patchStep,
    previewHasImage,
    refinementUploadStepId,
    stateCurrentStepIndex,
    stateStepData,
    stateSteps,
    enabled,
  ]);

  useEffect(() => {
    if (!awaitingRefinementAdvance) return;
    const fromStepId = refinementAdvanceFromStepIdRef.current;
    const currentId = String(currentStep?.id || "");
    if (!fromStepId || !currentId) return;
    if (currentId !== fromStepId) {
      refinementAdvanceFromStepIdRef.current = null;
      setAwaitingRefinementAdvance(false);
    }
  }, [awaitingRefinementAdvance, currentStep?.id]);

  useEffect(() => {
    const targetStepId = pendingRefinementFocusStepIdRef.current;
    if (!targetStepId) return;
    const steps = stateSteps || [];
    const targetIndex = steps.findIndex((step: any) => String((step as any)?.id || "") === targetStepId);
    if (targetIndex < 0) return;
    if (String(currentStep?.id || "") === targetStepId) {
      pendingRefinementFocusStepIdRef.current = null;
      return;
    }
    pendingRefinementFocusStepIdRef.current = null;
    goToStep(targetIndex);
  }, [currentStep?.id, goToStep, stateSteps]);

  useEffect(() => {
    if (previewHasImage) return;
    refinementAdvanceFromStepIdRef.current = null;
    pendingRefinementFocusStepIdRef.current = null;
    pendingRefinementPreviewAdvanceRef.current = null;
    pendingRefinementPreviewAdvanceStageRef.current = "idle";
    setAwaitingRefinementAdvance(false);
  }, [pendingRefinementPreviewAdvanceRef, pendingRefinementPreviewAdvanceStageRef, previewHasImage]);

  useEffect(() => {
    const stage = pendingRefinementPreviewAdvanceStageRef.current;
    const pending = pendingRefinementPreviewAdvanceRef.current;
    if (!pending) {
      pendingRefinementPreviewAdvanceStageRef.current = "idle";
      return;
    }
    if (stage === "waiting_for_start") {
      if (!previewAutoGenerationBusy) return;
      pendingRefinementPreviewAdvanceStageRef.current = "waiting_for_finish";
      return;
    }
    if (stage !== "waiting_for_finish" || previewAutoGenerationBusy) return;
    if (!currentStep || currentStep.id !== pending.stepId) {
      pendingRefinementPreviewAdvanceRef.current = null;
      pendingRefinementPreviewAdvanceStageRef.current = "idle";
      return;
    }
    pendingRefinementPreviewAdvanceRef.current = null;
    pendingRefinementPreviewAdvanceStageRef.current = "idle";
    void goToNextStep(pending.data);
  }, [currentStep, goToNextStep, pendingRefinementPreviewAdvanceRef, pendingRefinementPreviewAdvanceStageRef, previewAutoGenerationBusy]);

  return { awaitingRefinementAdvance };
}
