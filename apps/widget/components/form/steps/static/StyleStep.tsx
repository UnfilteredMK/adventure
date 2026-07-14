"use client";

import React from "react";
import { DETERMINISTIC_STYLE_ID } from "../runtime/step-engine/constants";
import { ImageChoiceGridStep } from "../step-screens/ImageChoiceGridStep";

interface StyleStepProps {
  step: any;
  stepData?: any;
  onComplete: (data: any) => void;
  onBack?: () => void;
  canGoBack: boolean;
  isLoading: boolean;
  headerInlineControl?: React.ReactNode;
  guidedThumbnailMode?: boolean;
  actionsVariant?: "default" | "sticky_mobile" | "icon_only";
  compactInPreview?: boolean;
  instanceId?: string;
  onProjectPhotoSelected?: (url: string) => void | Promise<void>;
}

export function isDeterministicStyleStep(step: any): boolean {
  const rawId = String(step?.id || step?.key || "").trim().toLowerCase();
  return rawId === DETERMINISTIC_STYLE_ID;
}

export function StyleStep(props: StyleStepProps) {
  return <ImageChoiceGridStep {...props} />;
}
