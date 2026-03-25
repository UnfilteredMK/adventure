import { FormState } from "@/types/ai-form";
import { emitTelemetry } from "@/lib/ai-form/telemetry";
import { saveUIPlan } from "@/lib/ai-form/state/ui-plan-storage";
import { saveFormPlan } from "@/lib/ai-form/state/form-plan-storage";
import { loadServiceCatalog, saveServiceCatalog } from "@/lib/ai-form/state/service-catalog-storage";
import {
  DETERMINISTIC_BUDGET_ID,
  DETERMINISTIC_SCENE_IMAGE_ID,
  DETERMINISTIC_STYLE_ID,
  DETERMINISTIC_USER_IMAGE_ID,
  DETERMINISTIC_PRODUCT_IMAGE_ID,
  DETERMINISTIC_SERVICE_ID,
} from "../constants";
import { joinSummaries, mergeUniqueStrings } from "./core";
import { normalizeFormState, saveFormState } from "./form-state";
import { buildAnsweredQA } from "./pricing-context";
import { countPreviewGateQuestions, isQuestionStepForAskedIds, isStructuralStep } from "./step-classification";
import { batchIdFromIndex, hasMeaningfulAnswer, normalizeBatchId, pickPrimaryServiceId } from "./step-answers";
import { LOCAL_SKELETON_FLOW_MODE } from "./build-local-skeleton";

type Ref<T> = { current: T };

type StepMeta = {
  batchId?: string | null;
  modelRequestId?: string | null;
  payloadRequest?: any | null;
  payloadResponse?: any | null;
};

type FetchAndAppendBatchArgs = {
  instanceId: string;
  flowPlanSessionId: string;
  flowPlan: any;
  state: any;
  formState: FormState | null;
  config: any;
  onMeta?: (meta: { [key: string]: any }) => void;
  deterministicStyleStep: any;
  disableLegacyBudgetUploadSteps: boolean;
  legacyBudgetUploadEnabled: boolean;
  initialQuestionCountSnapshot: number | null;

  setBatchError: (value: string | null) => void;
  setIsBatchLoading: (value: boolean) => void;
  setFormState: (value: FormState) => void;
  setHasReceivedQuestionsFromGenerateSteps: (value: boolean) => void;
  setInitialQuestionCountSnapshot: (value: number) => void;
  setPreviewEverEnabled: (value: boolean) => void;

  updateStepData: (key: string, value: any) => void;
  addSteps: (steps: any[], autoAdvance?: boolean, options?: { insertAtIndex?: number; moveExisting?: boolean }) => void;
  patchStep: (stepId: string, patch: any) => void;

  batchingRef: Ref<boolean>;
  pendingBatchTraceRef: Ref<{ requestPayload?: any; responsePayload?: any } | null>;
  completedBatchIndexesRef: Ref<Set<number>>;
  inFlightBatchIndexesRef: Ref<Set<number>>;
  lastBatchMetaRef: Ref<StepMeta | null>;
  lastModelRequestIdRef: Ref<string | null>;
  backendMaxCallsRef: Ref<number | null>;
  stepMetaRef: Ref<Map<string, StepMeta>>;
  sceneUploadJustCompletedRef: Ref<boolean>;
};

export async function fetchAndAppendGenerateStepsBatch(
  stepDataSoFar: Record<string, any>,
  showLoading: boolean,
  wasOnLastStep: boolean,
  args: FetchAndAppendBatchArgs
): Promise<void> {
  if (String(args.flowPlan?.mode || "") === LOCAL_SKELETON_FLOW_MODE) {
    return;
  }
  // Deprecated for fixed local skeleton form mode.
  // The adventure form now bypasses this path and keeps AI limited to image-generation workflows.
  const {
    instanceId,
    flowPlanSessionId,
    flowPlan,
    state,
    formState,
    config,
    onMeta,
    deterministicStyleStep,
    disableLegacyBudgetUploadSteps,
    legacyBudgetUploadEnabled,
    initialQuestionCountSnapshot,
    setBatchError,
    setIsBatchLoading,
    setFormState,
    setHasReceivedQuestionsFromGenerateSteps,
    setInitialQuestionCountSnapshot,
    setPreviewEverEnabled,
    updateStepData,
    addSteps,
    patchStep,
    batchingRef,
    pendingBatchTraceRef,
    completedBatchIndexesRef,
    inFlightBatchIndexesRef,
    lastBatchMetaRef,
    lastModelRequestIdRef,
    backendMaxCallsRef,
    stepMetaRef,
    sceneUploadJustCompletedRef,
  } = args;

  if (!flowPlanSessionId) return;
  if (batchingRef.current) {
    console.log("[StepEngine] Batch fetch already in progress, skipping");
    return;
  }

  setBatchError(null);
  batchingRef.current = true;
  pendingBatchTraceRef.current = null;
  let requestedBatchIndex: number | null = null;
  if (showLoading) setIsBatchLoading(true);

  try {
    const params = new URLSearchParams(window.location.search);
    const isFresh = params.get("fresh") === "1" || params.get("fresh") === "true";
    const questionStepIds = (state?.steps || []).filter((step: any) => isQuestionStepForAskedIds(step)).map((step: any) => step.id);

    const latestStepData = state?.stepData || {};
    const mergedStepData = { ...latestStepData, ...stepDataSoFar };
    const serviceCatalogSnapshot = loadServiceCatalog(flowPlanSessionId);
    const inferredSingleServiceId = (() => {
      const byServiceId = serviceCatalogSnapshot?.byServiceId;
      if (!byServiceId || typeof byServiceId !== "object") return null;
      const ids = Object.keys(byServiceId).filter(Boolean);
      return ids.length === 1 ? ids[0] : null;
    })();
    if (!pickPrimaryServiceId(mergedStepData) && inferredSingleServiceId) {
      mergedStepData[DETERMINISTIC_SERVICE_ID] = inferredSingleServiceId;
      if (mergedStepData.service_primary === undefined) mergedStepData.service_primary = inferredSingleServiceId;
      updateStepData(DETERMINISTIC_SERVICE_ID, inferredSingleServiceId);
      updateStepData("service_primary", inferredSingleServiceId);
    }
    const answeredQA = buildAnsweredQA({ steps: state?.steps || [], stepData: mergedStepData, max: 40 });

    const effectiveFormState = formState
      ? { ...formState }
      : normalizeFormState({ formId: flowPlanSessionId }, flowPlanSessionId);
    requestedBatchIndex = effectiveFormState.batchIndex;
    if (requestedBatchIndex !== null && completedBatchIndexesRef.current.has(requestedBatchIndex)) {
      console.log("[StepEngine] Batch already completed; skipping generate-steps request", { batchIndex: requestedBatchIndex });
      return;
    }
    if (requestedBatchIndex !== null && inFlightBatchIndexesRef.current.has(requestedBatchIndex)) {
      console.log("[StepEngine] Batch already in-flight; skipping generate-steps request", { batchIndex: requestedBatchIndex });
      return;
    }
    if (requestedBatchIndex !== null) inFlightBatchIndexesRef.current.add(requestedBatchIndex);
    if (!formState) {
      setFormState(effectiveFormState);
      saveFormState(flowPlanSessionId, effectiveFormState);
    }

    const combinedAskedStepIds = mergeUniqueStrings(
      ((formState ?? effectiveFormState)?.askedStepIds ?? []).map((v: any) => String(v || "")).filter(Boolean),
      questionStepIds.map((v: any) => String(v || "")).filter(Boolean)
    );

    const selectedServiceId = pickPrimaryServiceId(mergedStepData);
    const serviceCatalog = serviceCatalogSnapshot;
    const serviceMeta = selectedServiceId ? (serviceCatalog?.byServiceId as any)?.[selectedServiceId] : null;
    const cachedServiceSummary =
      typeof (effectiveFormState as any)?.serviceSummary === "string"
        ? String((effectiveFormState as any).serviceSummary).trim()
        : null;
    const perServiceSummary = typeof serviceMeta?.serviceSummary === "string" ? String(serviceMeta.serviceSummary).trim() : null;
    const serviceSummary = joinSummaries(cachedServiceSummary, perServiceSummary);
    const businessContext =
      typeof (config as any)?.businessContext === "string"
        ? String((config as any).businessContext).trim()
        : typeof (effectiveFormState as any)?.businessContext === "string"
          ? String((effectiveFormState as any).businessContext).trim()
          : null;
    const instanceContext = {
      businessContext,
      serviceSummary,
      industry: {
        id: typeof serviceMeta?.industryId === "string" ? serviceMeta.industryId : null,
        name:
          typeof serviceMeta?.industryName === "string"
            ? serviceMeta.industryName
            : typeof (config as any)?.industry === "string"
              ? String((config as any).industry)
              : null,
      },
      service: {
        id: selectedServiceId,
        name: typeof serviceMeta?.serviceName === "string" ? serviceMeta.serviceName : null,
      },
    };

    const resp = await fetch(`/api/ai-form/${instanceId}/generate-steps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        sessionId: flowPlanSessionId,
        stepDataSoFar: mergedStepData,
        askedStepIds: combinedAskedStepIds,
        debug:
          typeof window !== "undefined" &&
          (() => {
            try {
              const sp = new URLSearchParams(window.location.search);
              const v = (sp.get("debug") || sp.get("ai_form_debug") || sp.get("form_debug") || "").trim().toLowerCase();
              return v === "1" || v === "true" || v === "yes" || v === "on";
            } catch {
              return false;
            }
          })(),
        formState: {
          formId: effectiveFormState.formId,
          batchIndex: effectiveFormState.batchIndex,
          tokenBudgetTotal: effectiveFormState.tokenBudgetTotal,
          tokensUsedSoFar: effectiveFormState.tokensUsedSoFar,
          askedStepIds: combinedAskedStepIds,
          metricProgress: effectiveFormState.metricProgress,
          metricProgressCountedStepIds: effectiveFormState.metricProgressCountedStepIds,
          alreadyAskedKeys: combinedAskedStepIds,
          totalQuestionSteps: effectiveFormState.totalQuestionSteps,
          answeredQuestionCount: effectiveFormState.answeredQuestionCount,
          schemaVersion: effectiveFormState.schemaVersion,
        },
        instanceContext,
        answeredQA,
        noCache: isFresh,
        useCase: config?.useCase,
      }),
    });
    if (!resp.ok) {
      if (resp.status === 413) {
        throw new Error("Request too large (413). If you uploaded a photo, try a smaller image.");
      }
      throw new Error(`Failed to load next batch: ${resp.status}`);
    }

    const json = await resp.json().catch(() => ({}));
    const frames: any[] = Array.isArray((json as any)?.frames) ? (json as any).frames : [];
    const directMiniSteps: any[] = Array.isArray((json as any)?.miniSteps) ? (json as any).miniSteps : [];
    const directReadyForImageGen: any = (json as any)?.readyForImageGen;
    const directCapabilities: any = (json as any)?.capabilities;
    const directSatiety: any = (json as any)?.satiety;
    const directCallsUsed: any = (json as any)?.callsUsed;
    const directMaxCalls: any = (json as any)?.maxCalls;
    const directDidCall: any = (json as any)?.didCall;
    const responseRequestId = typeof (json as any)?.requestId === "string" ? String((json as any).requestId) : null;
    const responseFormPlan = (json as any)?.formPlan ?? null;

    const newSteps: any[] = [];
    const directStructuralSteps: any[] = Array.isArray((json as any)?.structuralSteps)
      ? (json as any).structuralSteps
      : Array.isArray((json as any)?.structural_steps)
        ? (json as any).structural_steps
        : [];

    let didCallDspy = false;
    let sawComplete = false;
    let sseError: string | null = null;
    let backendCallsUsed: number | null = null;
    let backendMaxCalls: number | null = null;
    let batchReachedPreviewStage = directReadyForImageGen === true;
    if (responseRequestId) {
      const batchId = batchIdFromIndex(effectiveFormState.batchIndex);
      lastBatchMetaRef.current = { batchId, modelRequestId: responseRequestId };
      lastModelRequestIdRef.current = responseRequestId;
    }
    if (responseFormPlan && typeof responseFormPlan === "object" && flowPlan?.sessionId) {
      saveFormPlan(flowPlan.sessionId, responseFormPlan);
      const maxBatches =
        (responseFormPlan as any)?.constraints?.maxBatches ??
        (responseFormPlan as any)?.form?.constraints?.maxBatches ??
        null;
      const n = Number(maxBatches);
      if (Number.isFinite(n)) backendMaxCalls = Math.max(1, Math.floor(n));
    }

    const directDeterministicCopy =
      json &&
      typeof json === "object" &&
      (json as any).deterministicCopy &&
      typeof (json as any).deterministicCopy === "object" &&
      !Array.isArray((json as any).deterministicCopy)
        ? (json as any).deterministicCopy
        : null;
    if (directMiniSteps.length > 0) {
      newSteps.push(...directMiniSteps);
      didCallDspy = true;
    }
    if (directStructuralSteps.length > 0) newSteps.push(...directStructuralSteps);
    if (directDeterministicCopy && Object.keys(directDeterministicCopy).length > 0) {
      didCallDspy = true;
      for (const [stepId, copyPatch] of Object.entries(directDeterministicCopy)) {
        if (!stepId || !copyPatch || typeof copyPatch !== "object") continue;
        if (!legacyBudgetUploadEnabled && stepId === DETERMINISTIC_BUDGET_ID) continue;
        const patch: Record<string, any> = {};
        if (typeof (copyPatch as any).question === "string") patch.question = (copyPatch as any).question;
        if (stepId === DETERMINISTIC_STYLE_ID) {
          if (typeof (copyPatch as any).min_selections === "number") patch.min_selections = (copyPatch as any).min_selections;
          if (typeof (copyPatch as any).max_selections === "number") patch.max_selections = (copyPatch as any).max_selections;
        }
        if (stepId === DETERMINISTIC_BUDGET_ID) {
          const headline = (copyPatch as any).headline ?? (copyPatch as any).question;
          const subtext = (copyPatch as any).subtext;
          if (typeof headline === "string" || typeof subtext === "string") {
            patch.copy = {
              ...((state?.steps || []).find((s: any) => String((s as any)?.id) === stepId) as any)?.copy,
              ...(typeof headline === "string" ? { headline } : {}),
              ...(typeof subtext === "string" ? { subtext } : {}),
            };
          }
        }
        if (Object.keys(patch).length > 0) patchStep(stepId, patch);
      }
    }
    if (typeof directReadyForImageGen === "boolean") updateStepData("__readyForImageGen", directReadyForImageGen);
    if (directCapabilities && typeof directCapabilities === "object" && !Array.isArray(directCapabilities)) {
      updateStepData("__capabilities", directCapabilities);
    } else if (typeof directReadyForImageGen === "boolean" && directReadyForImageGen === true) {
      updateStepData("__capabilities", { image_preview: true });
    }
    if (typeof directSatiety === "number") updateStepData("__satiety", directSatiety);
    if (typeof directCallsUsed === "number") backendCallsUsed = directCallsUsed;
    if (typeof directMaxCalls === "number") {
      backendMaxCalls = directMaxCalls;
      backendMaxCallsRef.current = directMaxCalls;
    }
    if (directDidCall === true) didCallDspy = true;

    for (const obj of frames) {
      if (!obj || typeof obj !== "object") continue;
      if (directMiniSteps.length === 0 && obj.type === "step" && obj.step) newSteps.push(obj.step);
      if (obj.type === "meta") {
        const requestPayload = obj.payloadRequest ?? obj.requestPayload ?? obj.payload?.request ?? obj.request ?? null;
        const responsePayload = obj.payloadResponse ?? obj.responsePayload ?? obj.payload?.response ?? obj.response ?? null;
        const responseDspy = (responsePayload as any)?.dspyResponse ?? null;
        const extractDeterministicPlacements = (raw: any) => {
          if (raw && typeof raw === "object" && (raw as any).deterministicPlacements) return (raw as any).deterministicPlacements;
          return null;
        };

        const maybeUIPlan =
          extractDeterministicPlacements(obj as any) ||
          extractDeterministicPlacements(responsePayload as any) ||
          extractDeterministicPlacements((responsePayload as any)?.meta) ||
          extractDeterministicPlacements((responsePayload as any)?.upstream) ||
          extractDeterministicPlacements(responseDspy as any) ||
          null;
        if (maybeUIPlan && flowPlan?.sessionId) saveUIPlan(flowPlan.sessionId, maybeUIPlan);

        pendingBatchTraceRef.current = { requestPayload, responsePayload };
        onMeta?.(obj);
      }
      if (obj.type === "complete") {
        onMeta?.(obj);
        const batchMeta: StepMeta = { batchId: obj?.batchId ?? batchIdFromIndex(formState?.batchIndex), modelRequestId: obj?.modelRequestId ?? null };
        if (typeof (obj as any).callsUsed === "number") backendCallsUsed = (obj as any).callsUsed;
        if (typeof (obj as any).maxCalls === "number") backendMaxCalls = (obj as any).maxCalls;
        if (batchMeta.batchId || batchMeta.modelRequestId) {
          lastBatchMetaRef.current = batchMeta;
          if (batchMeta.modelRequestId) lastModelRequestIdRef.current = batchMeta.modelRequestId;
          if (flowPlan?.sessionId) {
            const now = Date.now();
            const normalizedBatchId = normalizeBatchId(batchMeta.batchId) ?? undefined;
            const batchTrace = pendingBatchTraceRef.current;
            emitTelemetry({
              sessionId: flowPlan.sessionId,
              instanceId,
              eventType: "batch_completed",
              batchId: normalizedBatchId,
              modelRequestId: batchMeta.modelRequestId ?? undefined,
              timestamp: now,
              payload: {
                batch_id: normalizedBatchId ?? null,
                model_request_id: batchMeta.modelRequestId ?? null,
                calls_used: (obj as any)?.callsUsed ?? null,
                max_calls: (obj as any)?.maxCalls ?? null,
                total_steps: (obj as any)?.totalSteps ?? null,
                answered_steps: (obj as any)?.answeredSteps ?? null,
                satiety: (obj as any)?.satiety ?? null,
                is_last_batch: (obj as any)?.isLastBatch ?? null,
                request_payload: batchTrace?.requestPayload ?? null,
                response_payload: batchTrace?.responsePayload ?? null,
                timestamp: now,
              },
            });
          }
        }
        if (obj.didCall === true) didCallDspy = true;
        if (typeof obj.readyForImageGen === "boolean") {
          updateStepData("__readyForImageGen", obj.readyForImageGen);
          if (obj.readyForImageGen === true) batchReachedPreviewStage = true;
          const frameCaps = (obj as any)?.capabilities;
          if (frameCaps && typeof frameCaps === "object" && !Array.isArray(frameCaps)) {
            updateStepData("__capabilities", frameCaps);
          } else if (obj.readyForImageGen === true) {
            updateStepData("__capabilities", { image_preview: true });
          }
        }
        if (typeof obj.satiety === "number") updateStepData("__satiety", obj.satiety);
        const structuralFromComplete: any[] = Array.isArray((obj as any)?.structuralSteps)
          ? ((obj as any).structuralSteps as any[])
          : Array.isArray((obj as any)?.structural_steps)
            ? ((obj as any).structural_steps as any[])
            : [];
        if (structuralFromComplete.length > 0) newSteps.push(...structuralFromComplete);
        sawComplete = true;
      }
      if (obj.type === "error") {
        const details = obj.details ? ` (${String(obj.details).slice(0, 300)})` : "";
        sseError = `${obj.error || "DSPy service error"}${details}`;
        sawComplete = true;
      }
      if (sawComplete) break;
    }
    if (sseError) {
      setBatchError(sseError);
      return;
    }

    for (let i = newSteps.length - 1; i >= 0; i -= 1) {
      const step = newSteps[i];
      const stepId = String((step as any)?.id || "").trim();
      const stepType = String((step as any)?.type || "").trim().toLowerCase();
      if (stepId === "step-promptInput" || stepId === "step-designer" || stepType === "prompt_input" || stepType === "designer") {
        newSteps.splice(i, 1);
      }
    }
    if (!legacyBudgetUploadEnabled) {
      for (let i = newSteps.length - 1; i >= 0; i -= 1) {
        const stepId = String((newSteps[i] as any)?.id || "").trim();
        if (
          stepId === DETERMINISTIC_BUDGET_ID ||
          stepId === DETERMINISTIC_SCENE_IMAGE_ID ||
          stepId === DETERMINISTIC_USER_IMAGE_ID ||
          stepId === DETERMINISTIC_PRODUCT_IMAGE_ID
        ) {
          newSteps.splice(i, 1);
        }
      }
    }
    const hasStructuralStepInBatch = newSteps.some((step) => isStructuralStep(step));
    // Some backends can set `readyForImageGen=true` while still returning normal question steps.
    // Only prune non-structural steps when structural preview-stage steps are actually present.
    if (batchReachedPreviewStage && hasStructuralStepInBatch) {
      for (let i = newSteps.length - 1; i >= 0; i -= 1) {
        if (!isStructuralStep(newSteps[i])) newSteps.splice(i, 1);
      }
    }

    const batchMeta = lastBatchMetaRef.current;
    const batchTrace = pendingBatchTraceRef.current;
    if (batchMeta && newSteps.length > 0) {
      for (const step of newSteps) {
        if (!step || typeof step !== "object") continue;
        const stepId = (step as any).id;
        if (!stepId) continue;
        stepMetaRef.current.set(stepId, {
          batchId: batchMeta.batchId ?? null,
          modelRequestId: batchMeta.modelRequestId ?? null,
          payloadRequest: batchTrace?.requestPayload ?? null,
          payloadResponse: batchTrace?.responsePayload ?? null,
        });
      }
    }
    pendingBatchTraceRef.current = null;

    if (newSteps.length > 0) {
      setHasReceivedQuestionsFromGenerateSteps(true);
      if (initialQuestionCountSnapshot === null && requestedBatchIndex === 0) {
        const totalAfterInitialBatch = countPreviewGateQuestions([...(state?.steps || []), ...newSteps]);
        if (totalAfterInitialBatch > 0) setInitialQuestionCountSnapshot(totalAfterInitialBatch);
      }
      const shouldAutoAdvance = wasOnLastStep && showLoading;
      addSteps(newSteps, shouldAutoAdvance);
    } else if (
      disableLegacyBudgetUploadSteps &&
      batchReachedPreviewStage &&
      !hasMeaningfulAnswer((mergedStepData as any)?.[DETERMINISTIC_STYLE_ID]) &&
      deterministicStyleStep
    ) {
      setHasReceivedQuestionsFromGenerateSteps(true);
      addSteps([deterministicStyleStep as any], true, {
        insertAtIndex: (state?.currentStepIndex ?? 0) + 1,
        moveExisting: true,
      });
    } else if (
      disableLegacyBudgetUploadSteps &&
      batchReachedPreviewStage &&
      hasMeaningfulAnswer((mergedStepData as any)?.[DETERMINISTIC_STYLE_ID])
    ) {
      setHasReceivedQuestionsFromGenerateSteps(true);
      setPreviewEverEnabled(true);
    }

    if ((didCallDspy || typeof backendCallsUsed === "number" || typeof backendMaxCalls === "number") && flowPlan?.sessionId) {
      const baseState = formState ?? effectiveFormState;
      const effectiveMaxCalls =
        (typeof backendMaxCalls === "number" ? backendMaxCalls : null) ??
        (typeof backendMaxCallsRef.current === "number" ? backendMaxCallsRef.current : null);
      const maxBatchIndex = typeof effectiveMaxCalls === "number" ? Math.max(0, effectiveMaxCalls - 1) : null;
      const computedNextBatchIndex =
        typeof backendCallsUsed === "number"
          ? Math.max(0, Math.floor(backendCallsUsed))
          : didCallDspy
            ? baseState.batchIndex + 1
            : baseState.batchIndex;
      const nextBatchIndex =
        typeof maxBatchIndex === "number" ? Math.min(computedNextBatchIndex, maxBatchIndex) : computedNextBatchIndex;
      const nextState: FormState = {
        ...baseState,
        ...(typeof effectiveMaxCalls === "number" ? { maxBatches: effectiveMaxCalls } : {}),
        batchIndex: nextBatchIndex,
      };
      setFormState(nextState);
      saveFormState(flowPlan.sessionId, nextState);
    }
    if (typeof requestedBatchIndex === "number") completedBatchIndexesRef.current.add(requestedBatchIndex);
  } finally {
    setIsBatchLoading(false);
    batchingRef.current = false;
    sceneUploadJustCompletedRef.current = false;
    if (typeof requestedBatchIndex === "number") inFlightBatchIndexesRef.current.delete(requestedBatchIndex);
  }
}

export async function hydrateServiceCatalogFromWidget(args: {
  instanceId: string;
  sessionId: string;
  nextSelectedServiceId: string | null;
}): Promise<any | null> {
  const { instanceId, sessionId, nextSelectedServiceId } = args;
  try {
    const widgetRes = await fetch(`/api/widget/${instanceId}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const widgetJson = widgetRes.ok ? await widgetRes.json().catch(() => null) : null;
    const widgetServiceOptions = Array.isArray(widgetJson?.serviceOptions) ? widgetJson.serviceOptions : [];
    if (widgetServiceOptions.length > 0 && sessionId) {
      saveServiceCatalog(
        sessionId,
        widgetServiceOptions
          .map((o: any) => ({
            serviceId: String(o?.value || ""),
            serviceName:
              typeof o?.serviceName === "string" ? o.serviceName : typeof o?.label === "string" ? o.label : null,
            industryId: typeof o?.industryId === "string" ? o.industryId : null,
            industryName: typeof o?.industryName === "string" ? o.industryName : null,
            serviceSummary:
              typeof o?.serviceSummary === "string"
                ? o.serviceSummary
                : typeof o?.service_summary === "string"
                  ? o.service_summary
                  : null,
            styleQuestion: typeof o?.styleQuestion === "string" ? o.styleQuestion : null,
            styleOptions: Array.isArray(o?.styleOptions) ? o.styleOptions : undefined,
          }))
          .filter((item: any) => item.serviceId)
      );
    }
    const fallbackServiceOption =
      (nextSelectedServiceId ? widgetServiceOptions.find((o: any) => String(o?.value || "") === nextSelectedServiceId) : null) ||
      widgetServiceOptions[0];
    return fallbackServiceOption ?? null;
  } catch {
    return null;
  }
}
