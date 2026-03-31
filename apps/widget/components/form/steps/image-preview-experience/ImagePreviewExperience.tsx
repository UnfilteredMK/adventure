"use client";

import React, { useCallback } from "react";
import { ImagePreviewExperience as ImagePreviewCanvas } from "./gallery/ImagePreviewExperience";

export interface ImagePreviewExperienceProps {
  instanceId: string;
  sessionId: string;
  useCase?: string;
  contextState?: any;
  /** If false, never gate preview actions behind lead capture. Defaults to true. */
  leadGateEnabled?: boolean;
  /** When true, removes the card/surface background behind the preview. */
  transparentChrome?: boolean;
  /** Fires when a real preview image becomes available (hero exists). */
  onHasImageChange?: (hasImage: boolean) => void;
  config?: {
    businessContext?: string;
    industry?: string;
    useCase?: string;
    previewPricing?: { totalMin: number; totalMax: number; currency?: string; randomizePct?: number };
  };
  stepDataSoFar: Record<string, any>;
  answeredQuestionCount?: number;
  autoRegenerateEveryNAnsweredQuestions?: number;
  autoGenerationCounterScope?: string;
  onAutoGenerationBusyChange?: (busy: boolean) => void;
  enabled: boolean;
  onPreviewVisibleChange?: (visible: boolean) => void;
  variant?: "hero" | "rail" | "tiny";
  previewMaxVh?: number;
  previewMaxPx?: number;
  previewMaxVw?: number;
  previewChromePx?: number;
  suppressUploadOverlay?: boolean;
  toolingEnabled?: boolean;
  /** When true, disable concept gallery picker and keep single-image hero mode. */
  disableConceptPicker?: boolean;
  highConversionBuyerUI?: boolean;
  onKeepDesigning?: () => void;
  /** Fires when the canvas switches between concept grid, single hero, or no image (matches `data-preview-mode`). */
  onPreviewSurfaceModeChange?: (mode: "gallery" | "single" | "empty") => void;
  /** Incremented by the form Back control on step 0 to mirror in-canvas "Back to gallery". */
  stepNavReturnToGalleryNonce?: number;
}

export function ImagePreviewExperience({
  onPreviewVisibleChange,
  enabled,
  ...canvasProps
}: ImagePreviewExperienceProps) {
  const handlePreviewVisibleChange = useCallback(
    (visible: boolean) => {
      onPreviewVisibleChange?.(visible);
    },
    [onPreviewVisibleChange]
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain">
      <ImagePreviewCanvas
        {...canvasProps}
        enabled={enabled}
        onPreviewVisibleChange={handlePreviewVisibleChange}
      />
    </div>
  );
}
