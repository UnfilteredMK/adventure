"use client";

import React, { useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  ImagePreviewExperience as ImagePreviewCanvas,
  type PreviewConceptSelection,
  type PreviewPricingGateVariant,
  type StudioStarterConcept,
} from "./gallery/ImagePreviewExperience";

export type { PreviewConceptSelection, PreviewPricingGateVariant, StudioStarterConcept };

export interface ImagePreviewExperienceProps {
  instanceId: string;
  sessionId: string;
  useCase?: string;
  contextState?: any;
  /** If false, never gate preview actions behind lead capture. Defaults to true. */
  leadGateEnabled?: boolean;
  /** When true, removes the card/surface background behind the preview. */
  transparentChrome?: boolean;
  /** Run generation/cache effects without mounting the legacy preview chrome. */
  headless?: boolean;
  /** Fires when a real preview image becomes available (hero exists). */
  onHasImageChange?: (hasImage: boolean) => void;
  config?: {
    businessContext?: string;
    industry?: string;
    useCase?: string;
    previewPricing?: { totalMin: number; totalMax: number; currency?: string; randomizePct?: number };
    pricingGateStrategy?: "blurred" | "coarse_visible" | "experiment";
    pricingGateExperimentPercent?: number;
    pricingGateExperimentKey?: string;
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
  /** Overrides the configured gallery size. V1 passes `4` to keep a stable four-slot gallery. */
  conceptCount?: number;
  /**
   * Fill the initial concept run in two stages (two concepts, then the remainder).
   * This also keeps the initial gallery multi-concept when a project photo is present.
   */
  progressiveConcepts?: boolean;
  studioStarterConcept?: StudioStarterConcept | null;
  /** Uses the cohesive studio estimate composition instead of legacy single-preview chrome. */
  studioEstimateMode?: boolean;
  /** Fires only for an explicit user selection from the concept gallery. */
  onConceptSelected?: (detail: PreviewConceptSelection) => void;
  /** Keep pricing locked, but leave lead collection to an adjacent parent-owned surface. */
  suppressInlineLeadGate?: boolean;
  /** Controls concept-card pricing only; detailed pricing remains governed by `leadGateEnabled`. */
  pricingGateVariant?: PreviewPricingGateVariant;
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
  studioEstimateMode = false,
  ...canvasProps
}: ImagePreviewExperienceProps) {
  const handlePreviewVisibleChange = useCallback(
    (visible: boolean) => {
      onPreviewVisibleChange?.(visible);
    },
    [onPreviewVisibleChange]
  );

  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-1 flex-col overflow-x-hidden",
        studioEstimateMode ? "overflow-hidden" : "overflow-y-auto overscroll-contain",
      )}
    >
      <ImagePreviewCanvas
        {...canvasProps}
        enabled={enabled}
        studioEstimateMode={studioEstimateMode}
        onPreviewVisibleChange={handlePreviewVisibleChange}
      />
    </div>
  );
}
