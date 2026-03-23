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
  /** When true, hides the budget slider overlay (e.g. when preview is in dominant/large mode). */
  hideBudgetInOverlay?: boolean;
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
    <div className="w-full">
      <ImagePreviewCanvas
        {...canvasProps}
        enabled={enabled}
        onPreviewVisibleChange={handlePreviewVisibleChange}
      />
    </div>
  );
}
