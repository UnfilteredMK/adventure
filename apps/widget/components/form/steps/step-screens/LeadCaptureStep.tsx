"use client";

import React from "react";
import { StepLayout } from "../ui-layout/StepLayout";
import { LeadCapture } from "../input-controls/LeadCaptureControl";

interface LeadCaptureStepProps {
  step: any;
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

function normalizeRequiredInputs(step: any): string[] {
  const raw = Array.isArray(step?.required_inputs) ? step.required_inputs : ["email"];
  const normalized = raw
    .map((entry: any) => String(entry || "").trim().toLowerCase())
    .filter((entry: string) => entry === "email" || entry === "phone" || entry === "name");
  return normalized.length > 0 ? normalized : ["email"];
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7;
}

export function LeadCaptureStep({
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
}: LeadCaptureStepProps) {
  const requiredInputs = React.useMemo(() => normalizeRequiredInputs(step), [step]);
  const [value, setValue] = React.useState<any>(stepData ?? {});

  React.useEffect(() => {
    if (stepData !== undefined) setValue(stepData ?? {});
  }, [stepData]);

  const canContinue = React.useMemo(() => {
    const next = value && typeof value === "object" ? value : {};
    if (requiredInputs.includes("name") && !String(next?.name || "").trim()) return false;
    if (requiredInputs.includes("email") && !isValidEmail(String(next?.email || ""))) return false;
    if (requiredInputs.includes("phone") && !isValidPhone(String(next?.phone || ""))) return false;
    return true;
  }, [requiredInputs, value]);

  return (
    <StepLayout
      step={step}
      onComplete={() => onComplete(value)}
      onBack={onBack}
      canGoBack={canGoBack}
      isLoading={isLoading}
      canContinue={canContinue}
      continueLabel={(step as any)?.blueprint?.presentation?.continue_label || "Continue"}
      feedbackPrompt={feedbackPrompt}
      headerInlineControl={headerInlineControl}
      actionsVariant={actionsVariant}
      compactInPreview={compactInPreview}
      layoutDebugEnabled={layoutDebugEnabled}
    >
      <div className="w-full min-w-0">
        <LeadCapture
          value={value}
          onChange={setValue}
          requiredInputs={requiredInputs}
        />
      </div>
    </StepLayout>
  );
}
