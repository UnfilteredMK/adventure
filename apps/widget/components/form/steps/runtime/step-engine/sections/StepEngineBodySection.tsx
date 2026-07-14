import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { ArrowLeft, Camera, Check, Loader2 } from "lucide-react";
import { PreviewSection } from "./PreviewSection";
import { FormQuestionSection } from "./FormQuestionPaneSection";
import type { DesignAdventureInputMode } from "./DesignModeToolbar";
import { LOCAL_PARTS_STEP_ID, LOCAL_SCOPE_STEP_ID } from "../utils/build-local-skeleton";

/**
 * Fixed vh strips for Ideas + design-tool modes. Guided (`questions`) does not use this — that host is
 * `h-auto` capped with max-height so the pane snaps to step content (see compact question host JSX).
 */
function getCompactQuestionHostHeightClass(opts: {
  isMobileViewport: boolean;
  compactLargeQuestionHost: boolean;
  compactSingleHeroLayout: boolean;
  adventureInputMode: DesignAdventureInputMode;
}): string {
  const { isMobileViewport, compactLargeQuestionHost, compactSingleHeroLayout, adventureInputMode } = opts;
  const toolHeavyStrip =
    adventureInputMode === "prompt" ||
    adventureInputMode === "budget" ||
    adventureInputMode === "uploads";

  if (isMobileViewport) {
    if (compactLargeQuestionHost) {
      if (compactSingleHeroLayout) {
        return toolHeavyStrip ? "h-[24vh] max-h-[24vh]" : "h-[18vh] max-h-[18vh]";
      }
      return toolHeavyStrip ? "h-[28vh] max-h-[28vh]" : "h-[22vh] max-h-[22vh]";
    }
    if (compactSingleHeroLayout) {
      return toolHeavyStrip ? "h-[20vh] max-h-[20vh]" : "h-[14vh] max-h-[14vh]";
    }
    return toolHeavyStrip ? "h-[25vh] max-h-[25vh]" : "h-[19vh] max-h-[19vh]";
  }
  if (compactLargeQuestionHost) {
    if (compactSingleHeroLayout) {
      return toolHeavyStrip ? "h-[21vh] max-h-[21vh]" : "h-[15vh] max-h-[15vh]";
    }
    return toolHeavyStrip ? "h-[26vh] max-h-[26vh]" : "h-[20vh] max-h-[20vh]";
  }
  if (compactSingleHeroLayout) {
    return toolHeavyStrip ? "h-[18vh] max-h-[18vh]" : "h-[12vh] max-h-[12vh]";
  }
  return toolHeavyStrip ? "h-[23vh] max-h-[23vh]" : "h-[17vh] max-h-[17vh]";
}

function compactQuestionHostClassNames(opts: {
  isMobileViewport: boolean;
  compactLargeQuestionHost: boolean;
  compactSingleHeroLayout: boolean;
  adventureInputMode: DesignAdventureInputMode;
}): string {
  const { adventureInputMode } = opts;
  /** Guided: height follows the questionnaire / image rail; scroll inside host if taller than cap. */
  if (adventureInputMode === "questions") {
    return cn(
      "h-auto min-h-0 shrink-0 overflow-y-auto overflow-x-hidden overscroll-contain",
      "max-h-[min(62dvh,560px)]"
    );
  }
  return cn("overflow-hidden", getCompactQuestionHostHeightClass(opts));
}

export function StepEngineBodySection(props: any) {
  const {
    previewColumnRef,
    previewLayoutActive,
    isMobileViewport,
    usePreviewDominantLayout,
    previewRailOpen,
    showPreviewSection,
    previewEnabled,
    leadPricingPresentationActive,
    studioEstimateMode,
    previewViewportRef,
    pricedGridStepActive,
    allowConceptGallery,
    styleStepActive,
    showQuestionPaneUnderPreview,
    adventureInputMode,
    previewAutoAnsweredQuestionCount,
    previewAutoGenerationCounterScope,
    config,
    hasPreviewSubsections,
    instanceId,
    isAdventureSurface,
    isRefinementUploadStep,
    previewMaxPx,
    previewHasImage,
    previewSurfaceMode,
    previewRefreshNonce,
    stepNavReturnToGalleryNonce,
    pendingPreviewSceneUploadUrl,
    promptDraft,
    promptSubmitCount,
    sessionId,
    setPreviewAutoGenerationBusy,
    setPreviewHasImage,
    setPreviewVisible,
    state,
    useDesktopPreviewLayout,
    useMobilePreviewLayout,
    hideQuestionPane,
    compactQuestionHost,
    compactLargeQuestionHost,
    flowCompleted,
    handleBack,
    handleEaseFeedback,
    handleReflectionFeedback,
    handleStepComplete,
    isBatchLoading,
    isFetchingNext,
    effectiveLeadCompleteForPreviewFlow,
    leadGateLocksQuestionArea,
    setAdventureInputMode,
    onApplyIdeaSuggestion,
    budgetSliderConfig,
    budgetValue,
    handleBudgetChange,
    setPromptDraft,
    onPromptSubmit,
    onRegeneratePreview,
    questionContentRef,
    questionScale,
    questionViewportRef,
    refinementUploadInputRef,
    refinementUploading,
    reflectionFeedbackSent,
    setRefinementUploading,
    showStepTransitionSkeleton,
    previewGeneratingFocused,
    showAccuratePricingLoader,
    showEasePrompt,
    stepForRenderer,
    theme,
    layoutDebugEnabled,
    effectiveCurrentStep,
    guidedThumbnailMode,
    onKeepDesigning,
    onPreviewSurfaceModeChange,
    onProjectPhotoSelected,
    starterConcept,
    onBackToStartingIdeas,
  } = props;
  const reduceMotion = useReducedMotion();
  const currentStepId = String(effectiveCurrentStep?.id || "");
  const hasSecondProjectQuestion = Boolean(
    state?.steps?.some((step: any) => String(step?.id || "") === LOCAL_PARTS_STEP_ID),
  );
  const projectSequenceLabel =
    currentStepId === LOCAL_PARTS_STEP_ID
      ? "Project 2 of 2"
      : currentStepId === LOCAL_SCOPE_STEP_ID && hasSecondProjectQuestion
        ? "Project 1 of 2"
        : null;
  const projectPhotoInputRef = React.useRef<HTMLInputElement>(null);
  const [projectPhotoUploading, setProjectPhotoUploading] = React.useState(false);
  const [projectPhotoError, setProjectPhotoError] = React.useState<string | null>(null);

  const handleProjectPhoto = React.useCallback(
    async (file?: File | null) => {
      if (!file || !onProjectPhotoSelected || projectPhotoUploading) return;
      if (!file.type.startsWith("image/")) {
        setProjectPhotoError("Choose an image file.");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        setProjectPhotoError("Choose an image smaller than 8 MB.");
        return;
      }
      setProjectPhotoUploading(true);
      setProjectPhotoError(null);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("Could not read that photo."));
          reader.readAsDataURL(file);
        });
        const response = await fetch("/api/upload-reference-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, image: dataUrl }),
        });
        const payload = response.ok ? await response.json().catch(() => ({})) : null;
        const url = typeof payload?.url === "string" && payload.url ? payload.url : dataUrl;
        await onProjectPhotoSelected(url);
      } catch (error) {
        setProjectPhotoError(error instanceof Error ? error.message : "Could not add that photo.");
      } finally {
        setProjectPhotoUploading(false);
      }
    },
    [instanceId, onProjectPhotoSelected, projectPhotoUploading],
  );

  /** Single hero (not concept grid): give the preview more vertical space; keep questions in a shorter bottom strip. */
  const compactSingleHeroLayout = Boolean(
    compactQuestionHost && previewSurfaceMode === "single"
  );

  /** One vertical scroller for preview + step content (mobile image generation — matches style-step scroll feel). */
  const mobileGenerationScrollStack = Boolean(
    isMobileViewport &&
      previewGeneratingFocused &&
      showPreviewSection &&
      !hideQuestionPane
  );
  /** Concept grid needs its own vertical pan; outer column scroll yields to inner; question pane scrolls separately. */
  const mobileGalleryStackSplit = Boolean(
    mobileGenerationScrollStack && isMobileViewport && previewSurfaceMode === "gallery"
  );
  const starterStudioActive = Boolean(starterConcept && !styleStepActive && !showPreviewSection);

  const previewSectionEl = (
    <PreviewSection
      adventureInputMode={adventureInputMode}
      answeredQuestionCount={previewAutoAnsweredQuestionCount}
      autoGenerationCounterScope={previewAutoGenerationCounterScope}
      config={config}
      hasPreviewSubsections={hasPreviewSubsections}
      instanceId={instanceId}
      isAdventureSurface={isAdventureSurface}
      isRefinementUploadStep={isRefinementUploadStep}
      previewMaxPx={previewMaxPx}
      previewHasImage={previewHasImage}
      previewRefreshNonce={previewRefreshNonce}
      stepNavReturnToGalleryNonce={stepNavReturnToGalleryNonce}
      pendingPreviewSceneUploadUrl={pendingPreviewSceneUploadUrl}
      promptDraft={promptDraft}
      promptSubmitCount={promptSubmitCount}
      sessionId={sessionId}
      setAutoGenerationBusy={setPreviewAutoGenerationBusy}
      setPreviewHasImage={setPreviewHasImage}
      setPreviewVisible={setPreviewVisible}
      leadPricingPresentationActive={leadPricingPresentationActive}
      studioEstimateMode={studioEstimateMode}
      showQuestionPaneUnderPreview={showQuestionPaneUnderPreview}
      stateStepData={state?.stepData}
      toolingEnabled={!pricedGridStepActive}
      disableConceptPicker={!pricedGridStepActive && !allowConceptGallery}
      useDesktopPreviewLayout={useDesktopPreviewLayout}
      useMobilePreviewLayout={useMobilePreviewLayout}
      usePreviewDominantLayout={previewLayoutActive}
      generationScrollStack={mobileGenerationScrollStack}
      previewSurfaceMode={previewSurfaceMode}
      onKeepDesigning={onKeepDesigning}
      onPreviewSurfaceModeChange={onPreviewSurfaceModeChange}
      studioStarterConcept={starterConcept}
    />
  );

  const formQuestionSectionEl = (
    <FormQuestionSection
      config={config}
      effectiveCurrentStep={effectiveCurrentStep}
      flowCompleted={flowCompleted}
      forceExpandedStepLayout={pricedGridStepActive}
      guidedThumbnailMode={guidedThumbnailMode}
      handleBack={currentStepId === LOCAL_SCOPE_STEP_ID ? undefined : handleBack}
      handleEaseFeedback={handleEaseFeedback}
      handleReflectionFeedback={handleReflectionFeedback}
      handleStepComplete={handleStepComplete}
      hideQuestionPane={hideQuestionPane}
      instanceId={instanceId}
      isBatchLoading={isBatchLoading}
      isFetchingNext={isFetchingNext}
      isMobileViewport={isMobileViewport}
      isRefinementUploadStep={isRefinementUploadStep}
      leadCapturedForUI={effectiveLeadCompleteForPreviewFlow}
      leadGateLocksQuestionArea={leadGateLocksQuestionArea}
      adventureInputMode={adventureInputMode}
      setAdventureInputMode={setAdventureInputMode}
      onApplyIdeaSuggestion={onApplyIdeaSuggestion}
      budgetSliderConfig={budgetSliderConfig}
      budgetValue={budgetValue}
      onBudgetChange={handleBudgetChange}
      promptDraft={promptDraft}
      setPromptDraft={setPromptDraft}
      handlePromptSubmit={onPromptSubmit}
      onRegeneratePreview={onRegeneratePreview}
      previewEnabled={previewEnabled}
      previewHasImage={previewHasImage}
      previewSurfaceMode={previewSurfaceMode}
      questionContentRef={questionContentRef}
      questionScale={questionScale}
      questionViewportRef={questionViewportRef}
      refinementUploadInputRef={refinementUploadInputRef}
      refinementUploading={refinementUploading}
      reflectionFeedbackSent={reflectionFeedbackSent}
      sessionId={sessionId}
      setRefinementUploading={setRefinementUploading}
      showStepTransitionSkeleton={showStepTransitionSkeleton}
      showAccuratePricingLoader={showAccuratePricingLoader}
      showEasePrompt={showEasePrompt}
      showQuestionPaneUnderPreview={showQuestionPaneUnderPreview}
      state={state}
      stepForRenderer={stepForRenderer}
      theme={theme}
      layoutDebugEnabled={layoutDebugEnabled}
      usePreviewDominantLayout={previewLayoutActive}
      scrollStackWithPreview={mobileGenerationScrollStack}
      onProjectPhotoSelected={onProjectPhotoSelected}
    />
  );

  return (
    <main
      className={cn(
        "relative flex flex-1 items-stretch justify-center pb-0 pt-1.5 sm:px-3 sm:pb-3 sm:pt-3",
        "min-h-0 overflow-hidden sm:min-h-0",
        "max-sm:flex-none max-sm:min-h-0 max-sm:overflow-visible max-sm:px-0 max-sm:pt-0"
      )}
    >
      <div
        className={cn(
          "mx-auto w-full max-w-[88rem]",
          "h-full min-h-0 overflow-hidden sm:h-full",
          "max-sm:h-auto max-sm:min-h-0 max-sm:overflow-visible"
        )}
      >
        <motion.div
          ref={previewColumnRef}
          layout={false}
          className={cn(
            "relative flex min-h-0 flex-col overflow-hidden sm:h-full sm:max-h-full",
            "max-sm:overflow-visible",
            showPreviewSection && isMobileViewport ? "max-sm:min-h-[min(65dvh,560px)]" : "max-sm:min-h-0",
            previewLayoutActive ? (isMobileViewport ? "gap-0" : "gap-1.5") : usePreviewDominantLayout ? "gap-2" : previewRailOpen ? "gap-2" : "gap-0"
          )}
        >
          {starterStudioActive ? (
            <div className="flex h-full min-h-0 items-start justify-center overflow-y-auto px-2 pb-6 pt-2 sm:px-3 sm:pb-0 sm:pt-1 md:overflow-hidden">
              <div className="mx-auto grid w-full max-w-[88rem] items-stretch overflow-hidden rounded-[1.35rem] border border-black/10 bg-[var(--form-surface-color)] shadow-[0_20px_60px_rgba(15,23,42,0.12)] md:h-full md:min-h-0 md:max-h-full md:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
                <section className="min-h-[22rem] min-w-0 md:min-h-0">
                  <motion.figure
                    layoutId={starterConcept?.isProjectPhoto ? undefined : `starting-idea-${starterConcept?.value}`}
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0.94, scale: 0.985 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={reduceMotion ? { duration: 0.12 } : { duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                    className="group relative h-full overflow-hidden bg-black/[0.03]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={starterConcept?.imageUrl}
                      alt={starterConcept?.label || "Selected starter concept"}
                      className="h-full min-h-[22rem] w-full object-cover md:min-h-0"
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                    <button
                      type="button"
                      onClick={onBackToStartingIdeas}
                      className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-black/35 px-3 py-2 text-xs font-semibold text-white shadow-sm backdrop-blur-md transition hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-4 sm:top-4"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" /> Back to ideas
                    </button>
                    <figcaption className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-7">
                      <div className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] backdrop-blur-md">
                        <Check className="h-3.5 w-3.5" /> {starterConcept?.isProjectPhoto ? "Project photo" : "Starter concept"}
                      </div>
                      <h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">{starterConcept?.label}</h2>
                    </figcaption>
                  </motion.figure>
                </section>
                <motion.aside
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 22 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduceMotion ? 0.12 : 0.3, delay: reduceMotion ? 0 : 0.08, ease: "easeOut" }}
                  className="flex min-h-[26rem] min-w-0 flex-col overflow-hidden border-t border-black/10 bg-[var(--form-surface-color)] p-4 sm:p-5 md:min-h-0 md:border-l md:border-t-0"
                >
                  <div className="mb-2 flex shrink-0 items-center justify-between gap-3 px-1 text-xs font-semibold text-foreground/60">
                    <span className="flex min-w-0 items-center gap-2">
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate">{starterConcept?.label} selected</span>
                    </span>
                    {projectSequenceLabel ? (
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-foreground/45">
                        {projectSequenceLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{formQuestionSectionEl}</div>
                  {!starterConcept?.isProjectPhoto && onProjectPhotoSelected ? (
                    <div className="mt-1 shrink-0 px-1 pb-1 pt-4 text-center">
                      <input
                        ref={projectPhotoInputRef}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          void handleProjectPhoto(file);
                          event.currentTarget.value = "";
                        }}
                      />
                      <button
                        type="button"
                        disabled={projectPhotoUploading}
                        onClick={() => projectPhotoInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-foreground/65 transition hover:bg-foreground/[0.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {projectPhotoUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                        {projectPhotoUploading ? "Adding your photo…" : "Want to see this in your space? Add a photo"}
                      </button>
                      {projectPhotoError ? <p className="mt-1 text-xs font-medium text-red-600" role="alert">{projectPhotoError}</p> : null}
                    </div>
                  ) : null}
                </motion.aside>
              </div>
            </div>
          ) : mobileGenerationScrollStack ? (
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-x-hidden overscroll-contain [touch-action:pan-y]",
                mobileGalleryStackSplit
                  ? "overflow-y-visible"
                  : "overflow-y-auto"
              )}
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {showPreviewSection ? (
                <div ref={previewViewportRef} className="flex shrink-0 flex-col">
                  {previewSectionEl}
                </div>
              ) : null}
              {!hideQuestionPane ? (
                <div
                  className={cn(
                    "flex w-full flex-col border-t border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)]",
                    mobileGalleryStackSplit ? "min-h-0 min-w-0 flex-1 shrink overflow-y-auto overflow-x-hidden overscroll-contain" : "shrink-0",
                    pricedGridStepActive
                      ? "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain"
                      : compactQuestionHost
                        ? isMobileViewport
                          ? cn(
                              "flex flex-col pb-[max(env(safe-area-inset-bottom),8px)]",
                              compactQuestionHostClassNames({
                                isMobileViewport,
                                compactLargeQuestionHost,
                                compactSingleHeroLayout,
                                adventureInputMode,
                              })
                            )
                          : cn(
                              "flex flex-col pb-0.5 sm:pb-1",
                              compactQuestionHostClassNames({
                                isMobileViewport,
                                compactLargeQuestionHost,
                                compactSingleHeroLayout,
                                adventureInputMode,
                              })
                            )
                        : "flex flex-col min-h-0"
                  )}
                  style={
                    pricedGridStepActive || mobileGalleryStackSplit
                      ? ({ WebkitOverflowScrolling: "touch", touchAction: "pan-y" } as React.CSSProperties)
                      : undefined
                  }
                >
                  {formQuestionSectionEl}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {showPreviewSection ? (
                <div
                  ref={previewViewportRef}
                  className={cn(
                    ((!flowCompleted && styleStepActive) || (pricedGridStepActive && showQuestionPaneUnderPreview))
                      ? "pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
                      : leadPricingPresentationActive
                        ? "flex min-h-0 flex-col overflow-hidden"
                        : studioEstimateMode
                          ? "flex min-h-0 flex-col overflow-hidden"
                        : isMobileViewport && previewSurfaceMode === "gallery"
                          ? "flex min-h-0 flex-col overflow-y-visible overflow-x-hidden"
                          : "flex min-h-0 flex-col overflow-y-auto overflow-x-hidden overscroll-contain",
                    previewLayoutActive ? "flex-1 min-h-0" : "shrink-0"
                  )}
                >
                  {previewSectionEl}
                </div>
              ) : null}
              {!hideQuestionPane ? (
                <div
                  className={cn(
                    pricedGridStepActive
                      ? "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain"
                      : compactQuestionHost
                        ? isMobileViewport
                          ? cn(
                              "flex min-h-0 shrink-0 flex-col pb-[max(env(safe-area-inset-bottom),8px)]",
                              compactQuestionHostClassNames({
                                isMobileViewport,
                                compactLargeQuestionHost,
                                compactSingleHeroLayout,
                                adventureInputMode,
                              })
                            )
                          : cn(
                              "flex min-h-0 shrink-0 flex-col pb-0.5 sm:pb-1",
                              compactQuestionHostClassNames({
                                isMobileViewport,
                                compactLargeQuestionHost,
                                compactSingleHeroLayout,
                                adventureInputMode,
                              })
                            )
                        : "flex flex-col flex-1 min-h-0"
                  )}
                  style={pricedGridStepActive ? ({ WebkitOverflowScrolling: "touch", touchAction: "pan-y" } as React.CSSProperties) : undefined}
                >
                  {formQuestionSectionEl}
                </div>
              ) : null}
            </>
          )}
        </motion.div>
      </div>
    </main>
  );
}
