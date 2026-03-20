"use client";

import React from "react";
import type { StepDefinition } from "@/types/ai-form";
import type { MultipleChoiceUI } from "@/types/ai-form-ui-contract";
import { StepLayout } from "../ui-layout/StepLayout";
import { Choice } from "../input-controls/ChoiceControl";

interface MultipleChoiceStepProps {
  step: StepDefinition | MultipleChoiceUI;
  stepData?: any;
  onComplete: (data: any) => void;
  onBack?: () => void;
  canGoBack: boolean;
  isLoading: boolean;
  feedbackPrompt?: React.ReactNode;
  headerInlineControl?: React.ReactNode;
  actionsVariant?: "default" | "sticky_mobile" | "icon_only";
  compactInPreview?: boolean;
  layoutDebugEnabled?: boolean;
}

export function MultipleChoiceStep({
  step,
  stepData,
  onComplete,
  onBack,
  canGoBack,
  isLoading,
  feedbackPrompt,
  headerInlineControl,
  actionsVariant,
  compactInPreview,
  layoutDebugEnabled,
}: MultipleChoiceStepProps) {
  const continueLabel = (step as any)?.blueprint?.presentation?.continue_label ?? "Continue";
  const autoAdvanceOverride = (step as any)?.blueprint?.presentation?.auto_advance;
  const isUIStep = "type" in (step as any) && !(step as any).componentType;
  const multiple = isUIStep
    ? Boolean((step as MultipleChoiceUI).multi_select)
    : Boolean((step as StepDefinition).data?.multiple || (step as StepDefinition).data?.multiSelect);
  const minSelections =
    isUIStep && multiple && Number.isFinite(Number((step as any)?.min_selections))
      ? Math.max(1, Math.floor(Number((step as any).min_selections)))
      : multiple
        ? 1
        : 1;
  const otherRequiresText = Boolean(
    isUIStep && ((step as any)?.other_requires_text || (step as any)?.blueprint?.validation?.other_requires_text)
  );

  const [value, setValue] = React.useState<any>(stepData ?? (multiple ? [] : null));

  React.useEffect(() => {
    if (stepData !== undefined) setValue(stepData);
  }, [stepData]);

  const canContinue = (() => {
    if (multiple) {
      if (!Array.isArray(value)) return false;
      if (otherRequiresText && value.includes("other")) return false;
      return value.length >= minSelections;
    }
    if (otherRequiresText && value === "other") return false;
    return value !== null && value !== undefined && value !== "";
  })();

  return (
    <StepLayout
      step={step as any}
      onComplete={() => onComplete(value)}
      onBack={onBack}
      canGoBack={canGoBack}
      isLoading={isLoading}
      canContinue={canContinue}
      continueLabel={continueLabel}
      feedbackPrompt={feedbackPrompt}
      headerInlineControl={headerInlineControl}
      actionsVariant={actionsVariant}
      compactInPreview={compactInPreview}
      layoutDebugEnabled={layoutDebugEnabled}
    >
      <div
        className={
          compactInPreview
            ? "flex h-full min-h-0 min-w-0 w-full flex-col justify-start overflow-hidden py-0 text-center [&>div]:w-full [&>div]:min-w-0 [&>div>div]:mx-auto"
            : "w-full min-w-0 [&>div]:w-full [&>div]:text-left [&>div>div]:mx-0 [&>div>div:first-child]:w-full [&>div>div:first-child]:justify-start"
        }
      >
        <Choice
          step={step as any}
          stepData={value}
          onChange={setValue}
          forceCompact={compactInPreview}
          onAutoSubmit={(v) => {
            // For single-select, auto-advance.
            const shouldAuto = typeof autoAdvanceOverride === "boolean" ? autoAdvanceOverride : !multiple;
            if (shouldAuto) onComplete(v);
          }}
        />
      </div>
    </StepLayout>
  );
}
