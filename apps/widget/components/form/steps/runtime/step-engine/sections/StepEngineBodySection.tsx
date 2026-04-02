import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { PreviewSection } from "./PreviewSection";
import { FormQuestionSection } from "./FormQuestionPaneSection";
import type { DesignAdventureInputMode } from "./DesignModeToolbar";

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
  } = props;

  /** Single hero (not concept grid): give the preview more vertical space; keep questions in a shorter bottom strip. */
  const compactSingleHeroLayout = Boolean(
    compactQuestionHost && previewSurfaceMode === "single"
  );

  return (
    <main className="relative flex flex-1 min-h-0 items-stretch justify-center overflow-hidden px-2 pb-0 pt-2 sm:px-3 sm:pb-3 sm:pt-3">
      <div className="mx-auto h-full min-h-0 w-full max-w-[92rem] overflow-hidden">
        <motion.div
          ref={previewColumnRef}
          layout={false}
          className={cn(
            "relative flex h-full min-h-0 max-h-full flex-col overflow-hidden",
            previewLayoutActive ? (isMobileViewport ? "gap-0" : "gap-1.5") : usePreviewDominantLayout ? "gap-2" : previewRailOpen ? "gap-2" : "gap-0"
          )}
        >
          {showPreviewSection ? (
            <div
              ref={previewViewportRef}
              className={cn(
                ((!flowCompleted && styleStepActive) || (pricedGridStepActive && showQuestionPaneUnderPreview))
                  ? "pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
                  : leadPricingPresentationActive
                    ? "flex min-h-0 flex-col overflow-hidden"
                    : "flex min-h-0 flex-col overflow-y-auto overflow-x-hidden overscroll-contain",
                previewLayoutActive ? "flex-1 min-h-0" : "shrink-0"
              )}
            >
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
                showQuestionPaneUnderPreview={showQuestionPaneUnderPreview}
                stateStepData={state?.stepData}
                toolingEnabled={!pricedGridStepActive}
                disableConceptPicker={!pricedGridStepActive && !allowConceptGallery}
                useDesktopPreviewLayout={useDesktopPreviewLayout}
                useMobilePreviewLayout={useMobilePreviewLayout}
                usePreviewDominantLayout={previewLayoutActive}
                onKeepDesigning={onKeepDesigning}
                onPreviewSurfaceModeChange={onPreviewSurfaceModeChange}
              />
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
              <FormQuestionSection
                config={config}
                effectiveCurrentStep={effectiveCurrentStep}
                flowCompleted={flowCompleted}
                forceExpandedStepLayout={pricedGridStepActive}
                guidedThumbnailMode={guidedThumbnailMode}
                handleBack={handleBack}
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
                previewGeneratingFocused={previewGeneratingFocused}
                showAccuratePricingLoader={showAccuratePricingLoader}
                showEasePrompt={showEasePrompt}
                showQuestionPaneUnderPreview={showQuestionPaneUnderPreview}
                state={state}
                stepForRenderer={stepForRenderer}
                theme={theme}
                layoutDebugEnabled={layoutDebugEnabled}
                usePreviewDominantLayout={previewLayoutActive}
              />
            </div>
          ) : null}
        </motion.div>
      </div>
    </main>
  );
}
