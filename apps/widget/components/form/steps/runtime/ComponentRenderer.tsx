"use client";

// ComponentRenderer
// - Router only: chooses the correct Step module based on the schema (`step.type` or legacy `componentType`)
// - Per-step composition lives in `components/form/steps/*`

import React from "react";
import type { StepDefinition, UIStep } from "@/types/ai-form";
import { getVariation } from "@/lib/ai-form/variations/resolver";

import { MultipleChoiceStep } from "../step-screens/MultipleChoiceStep";
import { SliderStep } from "../step-screens/SliderStep";
import { FileUploadStep } from "../step-screens/FileUploadStep";
import { GalleryStep } from "../image-preview-experience/gallery/GalleryStep";
import { LeadCaptureStep } from "../step-screens/LeadCaptureStep";

// Choice-like UISteps are rendered via `MultipleChoiceStep`/`ChoiceControl` for
// better UX (multi-select, “Other + text”, rounded cards/chips).
import { ImageChoiceGridStep } from "../step-screens/ImageChoiceGridStep";
import { FunctionCallStep } from "../step-screens/FunctionCallStep";
import { InitialStep } from "../static/InitialStep";
import { isDeterministicStyleStep, StyleStep } from "../static/StyleStep";

interface ComponentRendererProps {
  step: StepDefinition | UIStep;
  stepData?: any;
  onComplete: (data: any) => void;
  onBack?: () => void;
  canGoBack?: boolean;
  isLoading?: boolean;
  allStepData?: Record<string, any>;
  allSteps?: (StepDefinition | UIStep)[];
  instanceId?: string;
  sessionId?: string;
  config?: { businessContext?: string; industry?: string; useCase?: string };
  feedbackPrompt?: React.ReactNode;
  leadCaptured?: boolean;
  headerInlineControl?: React.ReactNode;
  actionsVariant?: "default" | "sticky_mobile" | "icon_only";
  guidedThumbnailMode?: boolean;
  compactInPreview?: boolean;
  layoutDebugEnabled?: boolean;
  onProjectPhotoSelected?: (url: string) => void | Promise<void>;
}

export function ComponentRenderer(props: ComponentRendererProps) {
  const {
    step,
    stepData,
    onComplete,
    onBack,
    canGoBack,
    isLoading,
    allStepData = {},
    allSteps = [],
    feedbackPrompt,
    headerInlineControl,
    actionsVariant,
    guidedThumbnailMode,
    compactInPreview,
    layoutDebugEnabled,
    onProjectPhotoSelected,
  } = props;
  const resolvedLeadCaptured =
    typeof props.leadCaptured === "boolean"
      ? props.leadCaptured
      : Boolean(allStepData["step-lead-phone"] || allStepData["step-lead-capture"]);

  // NEW: shared contract (UIStep) — switch on `step.type`
  if ("type" in (step as any) && !(step as any).componentType) {
    const s = step as UIStep;
    const common = {
      step: s as any,
      stepData,
      onComplete,
      onBack,
      canGoBack: Boolean(canGoBack),
      isLoading: Boolean(isLoading),
      feedbackPrompt,
      headerInlineControl,
      actionsVariant,
      guidedThumbnailMode: Boolean(guidedThumbnailMode || compactInPreview),
      compactInPreview,
      layoutDebugEnabled,
      instanceId: props.instanceId,
      onProjectPhotoSelected,
    };
    // If a UIStep carries a backend function call hint, render a dedicated UI.
    // This preserves backend ordering while allowing mid-flow dynamic actions.
    if ((s as any)?.functionCall) {
      return <FunctionCallStep {...common} allStepData={allStepData} />;
    }

    if (isDeterministicStyleStep(s)) {
      return <StyleStep {...common} />;
    }

    switch ((s as any).type) {
      case "intro":
        return <InitialStep {...common} />;
      case "multiple_choice":
      case "choice":
      case "yes_no":
      case "segmented_choice":
      case "chips_multi":
        return <MultipleChoiceStep {...common} />;
      case "slider":
        return <SliderStep {...common} />;
      case "file_upload":
      case "upload":
      case "file_picker":
        return <FileUploadStep {...common} />;
      case "gallery":
        return (
          <GalleryStep
            {...common}
            allStepData={allStepData}
            allSteps={allSteps}
            instanceId={props.instanceId}
            sessionId={props.sessionId}
            config={props.config}
          />
        );
      case "lead_capture":
        return <LeadCaptureStep {...common} />;
      case "image_choice_grid":
        return <ImageChoiceGridStep {...common} />;
      default:
        return (
          <div className="p-6 text-sm opacity-70">
            Unsupported UIStep type: {(s as any).type}
          </div>
        );
    }
  }

  // LEGACY: StepDefinition — switch on `componentType` (with variations)
  const legacyStep = step as StepDefinition;
  let effectiveComponentType = legacyStep.componentType;
  if (legacyStep.variation) {
    const variation = getVariation(legacyStep.variation.stepIntent, legacyStep.variation.variationId);
    if (variation) effectiveComponentType = variation.componentType;
  }

  const common = {
    step: legacyStep,
    stepData,
    onComplete,
    onBack,
    canGoBack: Boolean(canGoBack),
    isLoading: Boolean(isLoading),
    allStepData,
    allSteps: allSteps as StepDefinition[],
    instanceId: props.instanceId,
    sessionId: props.sessionId,
    config: props.config,
    leadCaptured: resolvedLeadCaptured,
    feedbackPrompt,
    headerInlineControl,
    actionsVariant,
    guidedThumbnailMode: Boolean(guidedThumbnailMode || compactInPreview),
    compactInPreview,
    layoutDebugEnabled,
  };

  switch (effectiveComponentType) {
    case "choice":
    case "yes_no":
    case "segmented_choice":
    case "chips_multi":
      return <MultipleChoiceStep {...common} />;
    case "slider":
      return <SliderStep {...common} />;
    case "upload":
    case "file_picker":
      return <FileUploadStep {...common} />;
    case "image_choice_grid":
      return <ImageChoiceGridStep {...common} />;
    case "lead_capture":
      return <LeadCaptureStep {...common} />;
    default:
      return (
        <div className="p-6 text-sm opacity-70">
          Unknown component type: {String(effectiveComponentType)}
        </div>
      );
  }
}
