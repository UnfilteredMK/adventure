"use client";

import React from "react";
import type { StepDefinition } from "@/types/ai-form";
import type { FileUploadUI } from "@/types/ai-form-ui-contract";
import { StepLayout } from "../ui-layout/StepLayout";
import { FilePicker } from "../input-controls/FilePickerControl";

interface FileUploadStepProps {
  step: StepDefinition | FileUploadUI;
  stepData?: any;
  onComplete: (data: any) => void;
  onBack?: () => void;
  canGoBack: boolean;
  isLoading: boolean;
  instanceId?: string;
  headerInlineControl?: React.ReactNode;
  actionsVariant?: "default" | "sticky_mobile" | "icon_only";
  compactInPreview?: boolean;
}

export function FileUploadStep({
  step,
  stepData,
  onComplete,
  onBack,
  canGoBack,
  isLoading,
  instanceId,
  headerInlineControl,
  actionsVariant,
  compactInPreview,
}: FileUploadStepProps) {
  const continueLabel = (step as any)?.blueprint?.presentation?.continue_label;
  const isUIStep = "type" in (step as any) && !(step as any).componentType;

  const maxFiles = isUIStep ? 1 : (step as StepDefinition).data?.maxFiles ?? 1;
  const accept = isUIStep ? "image/*" : (step as StepDefinition).data?.accept || "image/*";
  const required = isUIStep ? (step as FileUploadUI).required !== false : (step as StepDefinition).data?.required !== false;
  const allowSkip = isUIStep
    ? Boolean((step as any).allow_skip ?? (step as any).allowSkip ?? (step as any)?.blueprint?.presentation?.allow_skip)
    : !required;
  const uploadRole = isUIStep ? (step as FileUploadUI).upload_role : (step as StepDefinition).data?.uploadRole;
  const cameraEnabled = Boolean(
    isUIStep
      ? (step as any)?.camera ?? (step as any)?.allow_camera ?? (step as any)?.blueprint?.presentation?.camera
      : (step as StepDefinition).data?.camera
  );

  const [value, setValue] = React.useState<any>(stepData);
  const [isUploading, setIsUploading] = React.useState(false);

  React.useEffect(() => {
    if (stepData !== undefined) {
      setValue(stepData);
    }
  }, [stepData]);

  const normalized = Array.isArray(value) ? value : value ? [value] : [];
  const hasUpload = normalized.length > 0;
  const canContinue = !isUploading && hasUpload;

  const resolvedContinueLabel = (() => {
    if (isUploading) return "Uploading...";
    return hasUpload ? continueLabel ?? "Continue" : "Upload required";
  })();
  const completionValue = value;
  const showUploader = true;

  return (
    <StepLayout
      step={step as any}
      onComplete={() => onComplete(completionValue)}
      onBack={onBack}
      canGoBack={canGoBack}
      isLoading={isLoading}
      canContinue={canContinue}
      actionsVariant={actionsVariant ?? "sticky_mobile"}
      headerInlineControl={headerInlineControl}
      continueLabel={resolvedContinueLabel}
      compactInPreview={compactInPreview}
    >
      <div
        className={
          compactInPreview && !required && allowSkip && !hasUpload
            ? "flex items-stretch gap-3 min-h-0"
            : compactInPreview
              ? "h-full min-h-0 overflow-y-auto overflow-x-hidden pr-1 space-y-2"
              : "space-y-3"
        }
      >
        {showUploader ? (
          <FilePicker
            value={value}
            onChange={(nextValue) => {
              setValue(nextValue);
            }}
            onUploadingChange={setIsUploading}
            maxFiles={maxFiles}
            accept={accept}
            uploadRole={uploadRole}
            cameraEnabled={cameraEnabled}
            instanceId={instanceId}
            compactDock={compactInPreview && !required && allowSkip && !hasUpload}
          />
        ) : null}

        {!required && allowSkip && !hasUpload ? (
          compactInPreview ? (
            <button
              type="button"
              onClick={() => onComplete(null)}
              disabled={isLoading || isUploading}
              className="shrink-0 h-12 px-4 rounded-xl text-sm font-semibold border-2 transition-colors border-[color:var(--form-surface-border-color)] hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: "inherit", color: "var(--form-text-color, inherit)" }}
            >
              Skip and generate
            </button>
          ) : (
            <div className="pt-1 text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Or</div>
              <button
                type="button"
                onClick={() => onComplete(null)}
                disabled={isLoading || isUploading}
                className="mt-1 text-sm underline underline-offset-4 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Skip and generate concepts
              </button>
            </div>
          )
        ) : null}
      </div>
    </StepLayout>
  );
}
