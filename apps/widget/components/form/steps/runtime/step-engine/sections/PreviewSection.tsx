"use client";

import React from "react";
import { ImagePreviewExperience } from "../../../image-preview-experience/ImagePreviewExperience";
import { FormLoader } from "@/components/form/FormLoader";
import { useFormTheme } from "@/components/form/demo/FormThemeProvider";
import { cn } from "@/lib/utils";

interface PreviewSectionProps {
  adventureInputMode: "questions" | "prompt" | "budget" | "uploads";
  completedQuestionCount: number;
  config?: any;
  hasPreviewSubsections: boolean;
  instanceId: string;
  isAdventureSurface: boolean;
  isInitialLoading?: boolean;
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
  isInitialLoading = false,
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
  const { theme } = useFormTheme();
  const overlayVars = {
    fontFamily: theme.fontFamily,
  } as React.CSSProperties;

  if (isInitialLoading) {
    return (
      <div
        className={cn(
          "flex min-h-0 flex-col overflow-hidden",
          usePreviewDominantLayout ? "flex-1 min-h-0" : "flex-1 shrink-0"
        )}
      >
        <div
          className={cn(
            "flex h-full min-h-0 w-full flex-col items-center justify-center",
            useDesktopPreviewLayout ? "max-w-5xl px-4" : "max-w-4xl px-4",
            usePreviewDominantLayout ? "py-2" : "py-1 sm:py-2"
          )}
        >
          <FormLoader
            variant="pill"
            size="sm"
            tone="overlay"
            message="Preparing your form…"
            className="bg-slate-900/75 px-4 py-3 shadow-lg"
            style={overlayVars}
          />
        </div>
      </div>
    );
  }

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
          usePreviewDominantLayout ? "py-2" : useDesktopPreviewLayout ? "py-1 sm:py-2" : null
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
            stepDataSoFar={{
              ...(stateStepData || {}),
              ...(previewRefreshNonce > 0 ? { "__previewRefreshNonce": previewRefreshNonce } : {}),
              ...(pendingPreviewSceneUploadUrl
                ? { "step-refinement-upload-scene-image": pendingPreviewSceneUploadUrl }
                : {}),
              ...(adventureInputMode === "prompt" && promptDraft.trim()
                ? {
                    "step-promptInput": promptDraft.trim(),
                    "__promptSubmitNonce": promptSubmitCount,
                  }
                : {}),
            }}
            answeredQuestionCount={
              completedQuestionCount + previewRefreshNonce + (adventureInputMode === "prompt" ? promptSubmitCount : 0)
            }
            autoRegenerateEveryNAnsweredQuestions={2}
            onPreviewVisibleChange={setPreviewVisible}
            onHasImageChange={setPreviewHasImage}
            variant="hero"
            previewMaxPx={previewMaxPx ?? undefined}
            previewChromePx={8}
            suppressUploadOverlay={isRefinementUploadStep}
            hideBudgetInOverlay={true}
          />
        </div>
      </div>
    </div>
  );
}
