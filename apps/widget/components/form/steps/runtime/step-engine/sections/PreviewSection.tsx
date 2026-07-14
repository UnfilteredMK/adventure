"use client";

import React, { useMemo } from "react";
import { ImagePreviewExperience } from "../../../image-preview-experience/ImagePreviewExperience";
import type { StudioStarterConcept } from "../../../image-preview-experience/ImagePreviewExperience";
import { cn } from "@/lib/utils";
import { assignPricingGateVariant } from "@/lib/visual-pricing/experiment";
interface PreviewSectionProps {
  adventureInputMode: "questions" | "ideas" | "prompt" | "budget" | "uploads";
  answeredQuestionCount: number;
  autoGenerationCounterScope: string;
  config?: any;
  hasPreviewSubsections: boolean;
  instanceId: string;
  isAdventureSurface: boolean;
  isRefinementUploadStep: boolean;
  previewMaxPx: number | null;
  previewHasImage: boolean;
  previewRefreshNonce: number;
  /** Bumps when the question pane Back control should return the preview from single-hero to concept grid (step 0). */
  stepNavReturnToGalleryNonce?: number;
  pendingPreviewSceneUploadUrl?: string | null;
  promptDraft: string;
  promptSubmitCount: number;
  sessionId: string;
  setAutoGenerationBusy: (busy: boolean) => void;
  setPreviewHasImage: (hasImage: boolean) => void;
  setPreviewVisible: (visible: boolean) => void;
  leadPricingPresentationActive?: boolean;
  studioEstimateMode?: boolean;
  showQuestionPaneUnderPreview: boolean;
  stateStepData?: Record<string, any>;
  toolingEnabled?: boolean;
  disableConceptPicker?: boolean;
  useDesktopPreviewLayout: boolean;
  useMobilePreviewLayout: boolean;
  usePreviewDominantLayout: boolean;
  /** Mobile: preview + question pane share one vertical scroll (image generation phase). */
  generationScrollStack?: boolean;
  /** When gallery picker is open on mobile, outer wrappers must not scroll so the concept grid can pan. */
  previewSurfaceMode?: "gallery" | "single" | "empty";
  onKeepDesigning?: () => void;
  onPreviewSurfaceModeChange?: (mode: "gallery" | "single" | "empty") => void;
  studioStarterConcept?: StudioStarterConcept | null;
}

export function PreviewSection({
  adventureInputMode,
  answeredQuestionCount,
  autoGenerationCounterScope,
  config,
  hasPreviewSubsections,
  instanceId,
  isAdventureSurface,
  isRefinementUploadStep,
  previewMaxPx,
  previewRefreshNonce,
  stepNavReturnToGalleryNonce = 0,
  pendingPreviewSceneUploadUrl,
  promptDraft,
  promptSubmitCount,
  sessionId,
  setAutoGenerationBusy,
  setPreviewHasImage,
  setPreviewVisible,
  leadPricingPresentationActive = false,
  studioEstimateMode = false,
  stateStepData,
  toolingEnabled = true,
  disableConceptPicker = false,
  useDesktopPreviewLayout,
  useMobilePreviewLayout,
  usePreviewDominantLayout,
  generationScrollStack = false,
  previewSurfaceMode = "empty",
  onKeepDesigning,
  onPreviewSurfaceModeChange,
  studioStarterConcept = null,
}: PreviewSectionProps) {
  const galleryPickerOwnsVerticalPan = Boolean(
    useMobilePreviewLayout && previewSurfaceMode === "gallery"
  );
  const studioGalleryActive = previewSurfaceMode === "gallery" && !disableConceptPicker;
  const studioEstimateActive = Boolean(studioEstimateMode);
  const pricingGateVariant = useMemo(
    () =>
      assignPricingGateVariant({
        strategy: config?.pricingGateStrategy,
        experimentPercent: config?.pricingGateExperimentPercent,
        experimentKey: config?.pricingGateExperimentKey,
        instanceId,
        sessionId,
        storage: typeof window !== "undefined" ? window.sessionStorage : null,
      }),
    [
      config?.pricingGateExperimentKey,
      config?.pricingGateExperimentPercent,
      config?.pricingGateStrategy,
      instanceId,
      sessionId,
    ],
  );
  const stepDataSoFar = useMemo(() => {
    const base = { ...(stateStepData || {}) };
    if (previewRefreshNonce > 0) base["__previewRefreshNonce"] = previewRefreshNonce;
    if (pendingPreviewSceneUploadUrl) base["step-refinement-upload-scene-image"] = pendingPreviewSceneUploadUrl;
    const trimmedPrompt = promptDraft.trim();
    const includePromptForPreview =
      Boolean(trimmedPrompt) &&
      (adventureInputMode === "prompt" ||
        (adventureInputMode === "ideas" && promptSubmitCount > 0));
    if (includePromptForPreview) {
      base["step-promptInput"] = trimmedPrompt;
      base["__promptSubmitNonce"] = promptSubmitCount;
    }
    return base;
  }, [
    stateStepData,
    previewRefreshNonce,
    pendingPreviewSceneUploadUrl,
    adventureInputMode,
    promptDraft,
    promptSubmitCount,
  ]);
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-x-hidden",
        leadPricingPresentationActive || studioEstimateActive
          ? "overflow-hidden"
          : generationScrollStack || galleryPickerOwnsVerticalPan
            ? "overflow-y-visible"
            : "overflow-y-auto overscroll-contain",
        usePreviewDominantLayout
          ? hasPreviewSubsections
            ? "flex-1"
            : leadPricingPresentationActive
              ? "flex-1"
              : generationScrollStack
                ? "w-full shrink-0"
                : studioGalleryActive || studioEstimateActive
                  ? "flex-1 items-stretch justify-start"
                  : "flex-1 items-start justify-center"
          : "flex-1 shrink-0"
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full min-h-0 flex-col",
          leadPricingPresentationActive || studioGalleryActive || studioEstimateActive ? "h-full flex-1" : null,
          studioGalleryActive || studioEstimateActive
            ? "max-w-[88rem] px-2 sm:px-4"
            : useMobilePreviewLayout
            ? "max-w-none px-0"
            : useDesktopPreviewLayout
              ? "max-w-5xl px-4"
              : isAdventureSurface
                ? "max-w-6xl px-4"
                : "max-w-4xl px-4",
          usePreviewDominantLayout ? "py-0.5 max-sm:py-0 sm:py-1" : useDesktopPreviewLayout ? "py-1 sm:py-2" : null
        )}
      >
        <div className={cn("flex w-full min-h-0 flex-col", leadPricingPresentationActive || studioGalleryActive || studioEstimateActive ? "h-full flex-1" : null)}>
          <ImagePreviewExperience
            key="image-preview"
            enabled={true}
            instanceId={instanceId}
            sessionId={sessionId}
            leadGateEnabled={config?.leadCaptureRequired !== false}
            transparentChrome={true}
            config={config}
            stepDataSoFar={stepDataSoFar}
            answeredQuestionCount={answeredQuestionCount}
            autoRegenerateEveryNAnsweredQuestions={studioEstimateMode ? 0 : 2}
            autoGenerationCounterScope={autoGenerationCounterScope}
            onAutoGenerationBusyChange={setAutoGenerationBusy}
            onPreviewVisibleChange={setPreviewVisible}
            onHasImageChange={setPreviewHasImage}
            variant="hero"
            previewMaxPx={previewMaxPx ?? undefined}
            previewMaxVh={generationScrollStack ? 52 : undefined}
            previewChromePx={8}
            suppressUploadOverlay={isRefinementUploadStep}
            toolingEnabled={toolingEnabled}
            disableConceptPicker={disableConceptPicker}
            conceptCount={4}
            progressiveConcepts
            studioStarterConcept={studioStarterConcept}
            studioEstimateMode={studioEstimateMode}
            pricingGateVariant={pricingGateVariant}
            onKeepDesigning={onKeepDesigning}
            onPreviewSurfaceModeChange={onPreviewSurfaceModeChange}
            stepNavReturnToGalleryNonce={stepNavReturnToGalleryNonce}
          />
        </div>
      </div>
    </div>
  );
}
