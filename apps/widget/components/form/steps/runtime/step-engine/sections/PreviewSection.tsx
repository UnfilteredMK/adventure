"use client";

import React, { useMemo } from "react";
import { ImagePreviewExperience } from "../../../image-preview-experience/ImagePreviewExperience";
import { cn } from "@/lib/utils";
interface PreviewSectionProps {
  adventureInputMode: "questions" | "prompt" | "budget" | "uploads";
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
  pendingPreviewSceneUploadUrl?: string | null;
  promptDraft: string;
  promptSubmitCount: number;
  sessionId: string;
  setAutoGenerationBusy: (busy: boolean) => void;
  setPreviewHasImage: (hasImage: boolean) => void;
  setPreviewVisible: (visible: boolean) => void;
  leadPricingPresentationActive?: boolean;
  showQuestionPaneUnderPreview: boolean;
  stateStepData?: Record<string, any>;
  toolingEnabled?: boolean;
  disableConceptPicker?: boolean;
  useDesktopPreviewLayout: boolean;
  useMobilePreviewLayout: boolean;
  usePreviewDominantLayout: boolean;
  onKeepDesigning?: () => void;
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
  pendingPreviewSceneUploadUrl,
  promptDraft,
  promptSubmitCount,
  sessionId,
  setAutoGenerationBusy,
  setPreviewHasImage,
  setPreviewVisible,
  leadPricingPresentationActive = false,
  showQuestionPaneUnderPreview: _showQuestionPaneUnderPreview,
  stateStepData,
  toolingEnabled = true,
  disableConceptPicker = false,
  useDesktopPreviewLayout,
  useMobilePreviewLayout,
  usePreviewDominantLayout,
  onKeepDesigning,
}: PreviewSectionProps) {
  const stepDataSoFar = useMemo(() => {
    const base = { ...(stateStepData || {}) };
    if (previewRefreshNonce > 0) base["__previewRefreshNonce"] = previewRefreshNonce;
    if (pendingPreviewSceneUploadUrl) base["step-refinement-upload-scene-image"] = pendingPreviewSceneUploadUrl;
    if (adventureInputMode === "prompt" && promptDraft.trim()) {
      base["step-promptInput"] = promptDraft.trim();
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
        leadPricingPresentationActive ? "overflow-hidden" : "overflow-y-auto overscroll-contain",
        usePreviewDominantLayout
          ? hasPreviewSubsections
            ? "flex-1"
            : leadPricingPresentationActive
              ? "flex-1"
              : "flex-1 flex items-start justify-center"
          : "flex-1 shrink-0"
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full min-h-0 flex-col",
          leadPricingPresentationActive ? "h-full flex-1" : null,
          useMobilePreviewLayout
            ? "px-2 max-w-none"
            : useDesktopPreviewLayout
              ? "max-w-5xl px-4"
              : isAdventureSurface
                ? "max-w-6xl px-4"
                : "max-w-4xl px-4",
          usePreviewDominantLayout ? "py-1" : useDesktopPreviewLayout ? "py-1 sm:py-2" : null
        )}
      >
        <div className={cn("flex w-full min-h-0 flex-col", leadPricingPresentationActive ? "h-full flex-1" : null)}>
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
            autoRegenerateEveryNAnsweredQuestions={2}
            autoGenerationCounterScope={autoGenerationCounterScope}
            onAutoGenerationBusyChange={setAutoGenerationBusy}
            onPreviewVisibleChange={setPreviewVisible}
            onHasImageChange={setPreviewHasImage}
            variant="hero"
            previewMaxPx={previewMaxPx ?? undefined}
            previewChromePx={8}
            suppressUploadOverlay={isRefinementUploadStep}
            toolingEnabled={toolingEnabled}
            disableConceptPicker={disableConceptPicker}
            onKeepDesigning={onKeepDesigning}
          />
        </div>
      </div>
    </div>
  );
}
