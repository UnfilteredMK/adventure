import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { PreviewSection } from "./PreviewSection";
import { FormQuestionSection } from "./FormQuestionPaneSection";

export function StepEngineBodySection(props: any) {
  const {
    previewColumnRef,
    previewLayoutActive,
    isMobileViewport,
    usePreviewDominantLayout,
    previewRailOpen,
    showPreviewSection,
    previewEnabled,
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
    previewRefreshNonce,
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
  } = props;

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
                  : "flex min-h-0 flex-col overflow-hidden",
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
                pendingPreviewSceneUploadUrl={pendingPreviewSceneUploadUrl}
                promptDraft={promptDraft}
                promptSubmitCount={promptSubmitCount}
                sessionId={sessionId}
                setAutoGenerationBusy={setPreviewAutoGenerationBusy}
                setPreviewHasImage={setPreviewHasImage}
                setPreviewVisible={setPreviewVisible}
                showQuestionPaneUnderPreview={showQuestionPaneUnderPreview}
                stateStepData={state?.stepData}
                toolingEnabled={!pricedGridStepActive}
                disableConceptPicker={!pricedGridStepActive && !allowConceptGallery}
                useDesktopPreviewLayout={useDesktopPreviewLayout}
                useMobilePreviewLayout={useMobilePreviewLayout}
                usePreviewDominantLayout={previewLayoutActive}
              />
            </div>
          ) : null}
          {!hideQuestionPane ? (
            <div
              className={cn(
                compactQuestionHost
                  ? isMobileViewport
                    ? cn(
                        "flex min-h-0 shrink-0 flex-col pb-[max(env(safe-area-inset-bottom),8px)] overflow-hidden",
                        compactLargeQuestionHost ? "h-[22vh] max-h-[22vh]" : "h-[19vh] max-h-[19vh]"
                      )
                    : cn(
                        "flex min-h-0 shrink-0 flex-col pb-0.5 sm:pb-1 overflow-hidden",
                        compactLargeQuestionHost ? "h-[20vh] max-h-[20vh]" : "h-[17vh] max-h-[17vh]"
                      )
                  : "flex flex-col flex-1 min-h-0"
              )}
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
                budgetSliderConfig={budgetSliderConfig}
                budgetValue={budgetValue}
                onBudgetChange={handleBudgetChange}
                promptDraft={promptDraft}
                setPromptDraft={setPromptDraft}
                handlePromptSubmit={onPromptSubmit}
                onRegeneratePreview={onRegeneratePreview}
                previewEnabled={previewEnabled}
                previewHasImage={previewHasImage}
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
