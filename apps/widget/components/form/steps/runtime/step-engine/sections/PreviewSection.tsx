"use client";

import React, { useMemo } from "react";
import { ImagePreviewExperience } from "../../../image-preview-experience/ImagePreviewExperience";
import { cn } from "@/lib/utils";

interface PreviewSectionProps {
  adventureInputMode: "questions" | "prompt" | "budget" | "uploads";
  completedQuestionCount: number;
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
  setPreviewHasImage: (hasImage: boolean) => void;
  setPreviewVisible: (visible: boolean) => void;
  showQuestionPaneUnderPreview: boolean;
  stateStepData?: Record<string, any>;
  useDesktopPreviewLayout: boolean;
  useMobilePreviewLayout: boolean;
  usePreviewDominantLayout: boolean;
}

export function PreviewSection({
  adventureInputMode,
  completedQuestionCount,
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
  setPreviewHasImage,
  setPreviewVisible,
  showQuestionPaneUnderPreview: _showQuestionPaneUnderPreview,
  stateStepData,
  useDesktopPreviewLayout,
  useMobilePreviewLayout,
  usePreviewDominantLayout,
}: PreviewSectionProps) {
  void _showQuestionPaneUnderPreview;
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
  const answeredQuestionCount = useMemo(
    () =>
      completedQuestionCount + previewRefreshNonce + (adventureInputMode === "prompt" ? promptSubmitCount : 0),
    [completedQuestionCount, previewRefreshNonce, adventureInputMode, promptSubmitCount]
  );
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        usePreviewDominantLayout
          ? hasPreviewSubsections
            ? "flex-1"
            : "flex-1 flex items-center justify-center"
          : "flex-1 shrink-0"
      )}
    >
      <div
        className={cn(
          "w-full mx-auto h-full",
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
        <div className="h-full min-h-0">
          <ImagePreviewExperience
            key="image-preview"
            enabled={true}
            instanceId={instanceId}
            sessionId={sessionId}
            leadGateEnabled={true}
            transparentChrome={true}
            config={config}
            stepDataSoFar={stepDataSoFar}
            answeredQuestionCount={answeredQuestionCount}
            autoRegenerateEveryNAnsweredQuestions={3}
            onPreviewVisibleChange={setPreviewVisible}
            onHasImageChange={setPreviewHasImage}
            variant="hero"
            previewMaxPx={previewMaxPx ?? undefined}
            previewChromePx={8}
            suppressUploadOverlay={isRefinementUploadStep}
            hideBudgetInOverlay={usePreviewDominantLayout}
          />
        </div>
      </div>
    </div>
  );
}
