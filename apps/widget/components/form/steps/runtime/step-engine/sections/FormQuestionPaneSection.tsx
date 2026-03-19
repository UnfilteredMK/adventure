"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { hexToRgba } from "@/types/design";
import { Button } from "@/components/ui/button";
import { Slider as SliderPrimitive } from "@/components/ui/slider";
import { AdventureLoader } from "@/components/form/AdventureLoader";
import { ComponentRenderer } from "../../ComponentRenderer";
import { EaseFeedbackPrompt, ReflectionFeedbackPrompt } from "../../../../dev-helpers/UserFeedbackPrompt";
import { ArrowLeft, ArrowUp, ImagePlus } from "lucide-react";
import { detectCurrencyFromLocale, formatCurrency } from "@/lib/ai-form/utils/currency";

interface FormQuestionSectionProps {
  config?: any;
  effectiveCurrentStep: any;
  flowCompleted: boolean;
  handleBack: () => void;
  handleEaseFeedback: (vote: "up" | "down") => void;
  handleReflectionFeedback: (rating: number, comment: string) => void;
  handleStepComplete: (data: any) => void;
  hideQuestionPane: boolean;
  instanceId: string;
  isBatchLoading: boolean;
  isFetchingNext: boolean;
  isMobileViewport: boolean;
  isRefinementUploadStep: boolean;
  leadCapturedForUI: boolean;
  leadGateLocksQuestionArea: boolean;
  adventureInputMode: "questions" | "prompt" | "budget" | "uploads";
  setAdventureInputMode: (mode: "questions" | "prompt" | "budget" | "uploads") => void;
  budgetSliderConfig: { min: number; max: number; step: number; currency: string };
  budgetValue: number | null;
  onBudgetChange: (value: number) => void;
  promptDraft: string;
  setPromptDraft: (value: string) => void;
  handlePromptSubmit: (uploadedUrl?: string) => void;
  onRegeneratePreview: (uploadedUrl?: string) => void;
  previewEnabled: boolean;
  previewHasImage: boolean;
  questionContentRef: React.RefObject<HTMLDivElement>;
  questionScale: number;
  questionViewportRef: React.RefObject<HTMLDivElement>;
  refinementUploadInputRef: React.RefObject<HTMLInputElement>;
  refinementUploading: boolean;
  reflectionFeedbackSent: boolean;
  sessionId: string;
  setRefinementUploading: React.Dispatch<React.SetStateAction<boolean>>;
  showStepTransitionSkeleton: boolean;
  previewGeneratingFocused?: boolean;
  showAccuratePricingLoader: boolean;
  showEasePrompt: boolean;
  showQuestionPaneUnderPreview: boolean;
  state: any;
  stepForRenderer: any;
  theme: {
    borderRadius?: number;
    fontFamily?: string;
    textColor?: string;
    primaryColor?: string;
    secondaryColor?: string;
    buttonStyle?: { backgroundColor?: string; textColor?: string };
  };
  usePreviewDominantLayout: boolean;
  guidedThumbnailMode: boolean;
}

export function FormQuestionSection({
  config,
  effectiveCurrentStep,
  flowCompleted,
  handleBack,
  handleEaseFeedback,
  handleReflectionFeedback,
  handleStepComplete,
  hideQuestionPane,
  instanceId,
  isBatchLoading,
  isFetchingNext,
  isMobileViewport,
  isRefinementUploadStep,
  leadCapturedForUI,
  leadGateLocksQuestionArea,
  adventureInputMode,
  setAdventureInputMode,
  budgetSliderConfig,
  budgetValue,
  onBudgetChange,
  promptDraft,
  setPromptDraft,
  handlePromptSubmit,
  onRegeneratePreview,
  previewEnabled,
  previewHasImage,
  questionContentRef,
  questionScale,
  questionViewportRef,
  refinementUploadInputRef,
  refinementUploading,
  reflectionFeedbackSent,
  sessionId,
  setRefinementUploading,
  showStepTransitionSkeleton,
  previewGeneratingFocused = false,
  showAccuratePricingLoader,
  showEasePrompt,
  showQuestionPaneUnderPreview,
  state,
  stepForRenderer,
  theme,
  usePreviewDominantLayout,
  guidedThumbnailMode,
}: FormQuestionSectionProps) {
  const uploadsInputRef = useRef<HTMLInputElement>(null);
  // Only show prompt/budget/uploads bar AFTER lead capture (pricing opt-in) is completed.
  const showPromptControls = Boolean(
    previewEnabled && previewHasImage && !isRefinementUploadStep && leadCapturedForUI
  );
  const usePreviewPaneLayout = Boolean(usePreviewDominantLayout && showQuestionPaneUnderPreview);
  const useBottomDockLayout = Boolean(usePreviewPaneLayout && showQuestionPaneUnderPreview && isMobileViewport);
  const useCompactNav = useBottomDockLayout;
  const promptText = promptDraft.trim();
  const canGoBack = (state?.currentStepIndex || 0) > 0;
  const primary = theme.primaryColor || "#3b82f6";
  const textMuted = theme.textColor ? hexToRgba(theme.textColor, 0.65) : undefined;
  const canUseBudgetMode = Boolean(showPromptControls && leadCapturedForUI);
  const pricingLocale =
    typeof navigator !== "undefined"
      ? ((navigator.languages && navigator.languages[0]) || navigator.language || undefined)
      : undefined;
  const budgetCurrency =
    typeof budgetSliderConfig.currency === "string" && budgetSliderConfig.currency.trim()
      ? budgetSliderConfig.currency.trim().toUpperCase()
      : detectCurrencyFromLocale(pricingLocale);
  const budgetMinLabel = useMemo(
    () => formatCurrency(budgetSliderConfig.min, { locale: pricingLocale, currency: budgetCurrency, compact: true }),
    [budgetCurrency, budgetSliderConfig.min, pricingLocale]
  );
  const budgetMaxLabel = useMemo(
    () => formatCurrency(budgetSliderConfig.max, { locale: pricingLocale, currency: budgetCurrency, compact: true }),
    [budgetCurrency, budgetSliderConfig.max, pricingLocale]
  );
  const defaultBudget = useMemo(() => {
    const { min, max, step } = budgetSliderConfig;
    const at20Pct = min + (max - min) * 0.2;
    const stepped = Math.round(at20Pct / step) * step;
    return Math.max(min, Math.min(max, stepped));
  }, [budgetSliderConfig]);
  const [localBudget, setLocalBudget] = useState<number>(() => {
    if (typeof budgetValue === "number" && Number.isFinite(budgetValue)) return budgetValue;
    return defaultBudget;
  });
  const [budgetDirty, setBudgetDirty] = useState(false);

  useEffect(() => {
    const next = typeof budgetValue === "number" && Number.isFinite(budgetValue) ? budgetValue : defaultBudget;
    setLocalBudget((prev) => (prev === next ? prev : next));
  }, [budgetValue, defaultBudget]);

  useEffect(() => {
    if (!budgetDirty) return;
    if (!canUseBudgetMode) return;
    const timer = window.setTimeout(() => {
      setBudgetDirty(false);
      onRegeneratePreview();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [budgetDirty, canUseBudgetMode, onRegeneratePreview]);

  const handleBudgetInputChange = useCallback(
    (nextRaw: number) => {
      if (!canUseBudgetMode) return;
      const n = Number(nextRaw);
      if (!Number.isFinite(n)) return;
      const { min, max, step } = budgetSliderConfig;
      const snapped = Math.round((n - min) / step) * step + min;
      const clamped = Math.max(min, Math.min(max, snapped));
      setLocalBudget(clamped);
      onBudgetChange(clamped);
      setBudgetDirty(true);
    },
    [budgetSliderConfig, canUseBudgetMode, onBudgetChange]
  );

  const handleUploadAndRegenerate = useCallback(
    async (file?: File | null) => {
      if (!file) return;
      setRefinementUploading(true);
      try {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((res, rej) => {
          reader.onload = () => res(reader.result as string);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        const uploadRes = await fetch("/api/upload-reference-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, image: dataUrl }),
        });
        const uploadedRaw = uploadRes.ok
          ? ((await uploadRes.json().catch(() => ({}))) as any)?.url ?? dataUrl
          : dataUrl;
        const uploadedUrl =
          typeof uploadedRaw === "string" && uploadedRaw.startsWith("/") && typeof window !== "undefined"
            ? `${window.location.origin}${uploadedRaw}`
            : uploadedRaw;
        onRegeneratePreview(uploadedUrl);
      } finally {
        setRefinementUploading(false);
      }
    },
    [instanceId, onRegeneratePreview, setRefinementUploading]
  );
  const currentUploadedReferenceUrl = useMemo(() => {
    const stepData = (state?.stepData || {}) as Record<string, unknown>;
    const sources = [
      stepData["step-refinement-upload-scene-image"],
      stepData["step-upload-scene-image"],
      stepData["step-upload-user-image"],
      stepData["step-upload-product-image"],
    ];
    for (const source of sources) {
      if (typeof source === "string" && source.trim()) return source;
      if (Array.isArray(source)) {
        const first = source.find((item) => typeof item === "string" && item.trim()) as string | undefined;
        if (first) return first;
      }
    }
    return null;
  }, [state?.stepData]);
  const submitPrompt = useCallback(() => {
    if (promptText.length < 4) return;
    handlePromptSubmit(currentUploadedReferenceUrl || undefined);
  }, [currentUploadedReferenceUrl, handlePromptSubmit, promptText]);

  const inputModeToggle = showPromptControls ? (
      <div className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)] p-0.5 shrink-0 max-w-full",
        useCompactNav && "h-7"
      )}>
	        <button
	          type="button"
	          onClick={() => setAdventureInputMode("questions")}
	          className={cn(
	            "inline-flex items-center rounded-full text-xs font-medium transition-colors shrink-0 min-w-0",
	            useCompactNav ? "h-6 px-2 text-[11px]" : "h-6 px-2.5",
	            adventureInputMode === "questions" ? "bg-primary/10 text-foreground" : ""
	          )}
          style={
            adventureInputMode !== "questions"
              ? { color: textMuted || "var(--form-text-color)" }
              : undefined
          }
        >
          Guided
	        </button>
	        <button
	          type="button"
	          onClick={() => setAdventureInputMode("prompt")}
	          className={cn(
	            "inline-flex items-center rounded-full text-xs font-medium transition-colors shrink-0 min-w-0",
	            useCompactNav ? "h-6 px-2 text-[11px]" : "h-6 px-2.5",
	            adventureInputMode === "prompt" ? "bg-primary/10 text-foreground" : ""
	          )}
          style={
            adventureInputMode !== "prompt"
              ? { color: textMuted || "var(--form-text-color)" }
              : undefined
          }
	        >
	          Prompt
	        </button>
	        <button
	          type="button"
	          disabled={!canUseBudgetMode}
	          onClick={() => setAdventureInputMode("budget")}
	          className={cn(
	            "inline-flex items-center rounded-full text-xs font-medium transition-colors shrink-0 min-w-0",
	            useCompactNav ? "h-6 px-2 text-[11px]" : "h-6 px-2.5",
	            adventureInputMode === "budget" ? "bg-primary/10 text-foreground" : "",
	            !canUseBudgetMode ? "opacity-50 cursor-not-allowed" : ""
	          )}
	          style={
	            adventureInputMode !== "budget"
	              ? { color: textMuted || "var(--form-text-color)" }
	              : undefined
	          }
	        >
	          Budget
	        </button>
	        <button
	          type="button"
	          onClick={() => setAdventureInputMode("uploads")}
	          className={cn(
	            "inline-flex items-center rounded-full text-xs font-medium transition-colors shrink-0 min-w-0",
	            useCompactNav ? "h-6 px-2 text-[11px]" : "h-6 px-2.5",
	            adventureInputMode === "uploads" ? "bg-primary/10 text-foreground" : ""
	          )}
	          style={
	            adventureInputMode !== "uploads"
	              ? { color: textMuted || "var(--form-text-color)" }
	              : undefined
	          }
	        >
	          Uploads
	        </button>
	      </div>
	  ) : undefined;

  return (
    <AnimatePresence initial={false}>
      {!hideQuestionPane ? (
        <motion.div
          ref={questionViewportRef}
          key="question-pane"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.08, ease: "easeOut" }}
          className={cn(
            "relative flex w-full min-h-0 flex-col overflow-hidden",
            usePreviewPaneLayout
              ? (
                  useBottomDockLayout
                    ? "min-h-0 flex-1 border-t border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)]"
                    : "min-h-0 flex-1"
                )
              : "flex-1"
          )}
          style={undefined}
        >
          <div
            className={cn(
              useBottomDockLayout ? "flex h-full min-h-0 flex-col overflow-hidden" : "flex h-full min-h-0 flex-col overflow-hidden",
              useBottomDockLayout ? "justify-end" : useCompactNav ? "justify-center" : null,
              usePreviewPaneLayout && !showQuestionPaneUnderPreview ? "max-h-0" : null
            )}
          >
            <div
              ref={questionContentRef}
              className={cn(
                useBottomDockLayout
                  ? "mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden"
                  : "mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden",
                usePreviewPaneLayout ? "max-w-5xl" : "max-w-6xl"
              )}
            >
              <div
                className={cn(
                  "flex min-h-0 flex-1 flex-col",
                  usePreviewPaneLayout ? "overflow-y-auto overflow-x-hidden" : "overflow-auto",
                  useBottomDockLayout ? "justify-end" : useCompactNav ? "justify-center" : null,
                  usePreviewPaneLayout ? "px-4" : null
                )}
                style={
                  !usePreviewPaneLayout && questionScale < 0.999
                    ? {
                        transform: `scale(${questionScale})`,
                        transformOrigin: "top center",
                        width: `${100 / questionScale}%`,
                      }
                    : undefined
                }
	              >
	                <AnimatePresence mode="wait">
	                  {!showAccuratePricingLoader ? (
	                    leadGateLocksQuestionArea ? null : previewGeneratingFocused ? null : isRefinementUploadStep ? (
	                      <motion.div
	                        key="refinement-upload"
	                        initial={{ opacity: 0, y: 8 }}
	                        animate={{ opacity: 1, y: 0 }}
	                        exit={{ opacity: 0, y: 8 }}
	                        transition={{ duration: 0.2, ease: "easeOut" }}
	                        className="w-full min-h-0 flex flex-1 flex-col items-center justify-center gap-4 px-4 py-4 sm:py-5"
	                      >
	                        <p
	                          className="max-w-3xl text-center text-base sm:text-lg font-semibold leading-tight"
	                          style={{ color: theme.textColor || primary, fontFamily: theme.fontFamily }}
	                        >
	                          Upload your own photo to see a more personalized result.
	                        </p>
	                        <input
	                          ref={refinementUploadInputRef}
	                          type="file"
	                          accept="image/*"
	                          className="hidden"
	                          onChange={async (e) => {
	                            const file = e.target.files?.[0];
	                            if (!e.target) return;
	                            (e.target as HTMLInputElement).value = "";
	                            if (!file) return;
	                            try {
                                await handleUploadAndRegenerate(file);
                                handleStepComplete("__skip__");
                              } catch {
                                handleStepComplete(null);
                              }
	                          }}
	                        />
	                        <div className="flex w-full max-w-md flex-row flex-wrap items-center justify-center gap-2.5">
                            {canGoBack ? (
                              <Button
                                type="button"
                                variant="outline"
                                disabled={refinementUploading}
                                onClick={handleBack}
                                className="h-9 min-w-[96px] px-3 text-xs font-medium"
                                style={{
                                  borderColor: theme.primaryColor || primary,
                                  color: theme.primaryColor || primary,
                                  fontFamily: theme.fontFamily,
                                  borderRadius: `${theme.borderRadius ?? 12}px`,
                                }}
                              >
                                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                                <span>Back</span>
                              </Button>
                            ) : null}
	                          <Button
	                            type="button"
	                            disabled={refinementUploading}
	                            onClick={() => refinementUploadInputRef.current?.click()}
	                            aria-busy={refinementUploading}
	                            className="h-9 min-w-[120px] px-4 text-xs font-medium"
	                            style={{
	                              backgroundColor: theme.buttonStyle?.backgroundColor || theme.primaryColor || primary,
	                              color: theme.buttonStyle?.textColor || "#ffffff",
	                              fontFamily: theme.fontFamily,
	                              borderRadius: `${theme.borderRadius ?? 12}px`,
	                            }}
	                          >
	                            <ImagePlus className="h-4 w-4 shrink-0" aria-hidden />
	                            <span>{refinementUploading ? "Uploading..." : "Upload photo"}</span>
	                          </Button>
	                          <Button
	                            type="button"
	                            variant="outline"
	                            disabled={refinementUploading}
	                            onClick={() => handleStepComplete("__skip__")}
	                            className="h-9 min-w-[96px] px-3 text-xs font-medium"
	                            style={{
	                              borderColor: theme.primaryColor || primary,
	                              color: theme.primaryColor || primary,
	                              fontFamily: theme.fontFamily,
	                              borderRadius: `${theme.borderRadius ?? 12}px`,
	                            }}
	                          >
	                            Skip for now
	                          </Button>
	                        </div>
	                      </motion.div>
	                    ) : showStepTransitionSkeleton ? (
	                      <motion.div
	                        key="step-transition-skeleton"
	                        initial={{ opacity: 0 }}
	                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14, ease: "easeOut" }}
                        className="flex min-h-0 flex-1 w-full flex-col justify-center px-4 py-4 sm:px-6"
                      >
                        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
                          <div
                            className="h-4 w-32 animate-pulse rounded-full"
                            style={{ backgroundColor: hexToRgba(primary, 0.18) }}
                          />
                          <div
                            className="h-12 w-full animate-pulse rounded-2xl"
                            style={{ backgroundColor: hexToRgba(primary, 0.14) }}
                          />
                          <div className="flex justify-end gap-2">
                            <div
                              className="h-9 w-24 animate-pulse rounded-full"
                              style={{ backgroundColor: hexToRgba(primary, 0.14) }}
                            />
                          </div>
                        </div>
                      </motion.div>
	                    ) : adventureInputMode === "prompt" && showPromptControls ? (
	                      <motion.div
	                        key="prompt-input-mode"
	                        initial={{ opacity: 0, x: 16 }}
	                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -16 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="w-full min-h-0 flex flex-1 flex-col"
                      >
                        <div className="w-full max-w-[68rem] mx-auto px-2.5 py-2 sm:px-3 sm:py-2.5 flex min-h-0 flex-1 flex-col">
                          {inputModeToggle ? <div className="mb-1.5 flex shrink-0 justify-center min-w-0 overflow-hidden">{inputModeToggle}</div> : null}
                          {useCompactNav ? (
                            <div className="min-w-0 min-h-0 flex flex-1 flex-col">
                              <div
                                className="rounded-xl border p-2 min-h-0 flex-1 flex flex-col min-w-0"
                                style={{
                                  backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.70))",
                                  borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.10))",
                                  borderRadius: `${theme.borderRadius ?? 12}px`,
                                }}
                              >
                                <div className="flex items-end gap-2 min-w-0 min-h-0 flex-1">
                                  <textarea
                                    value={promptDraft}
                                    onChange={(e) => setPromptDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        submitPrompt();
                                      }
                                    }}
                                    placeholder="Add a prompt to refine this image..."
                                    className="min-h-[2.5rem] max-h-[6rem] flex-1 resize-none overflow-auto rounded border-0 bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                                  />
                                  <Button
                                    type="button"
                                    onClick={submitPrompt}
                                    disabled={promptText.length < 4}
                                    className="h-8 w-8 shrink-0 rounded-full p-0"
                                    style={{
                                      backgroundColor: theme.primaryColor || "var(--form-primary-color, #3b82f6)",
                                      color: "#fff",
                                      fontFamily: theme.fontFamily,
                                    }}
                                    aria-label="Generate preview"
                                    title="Generate"
                                  >
                                    <ArrowUp className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="min-w-0 min-h-0 flex flex-1 flex-col">
                              <div
                                className="rounded-xl border p-2 min-h-0 flex-1 flex flex-col min-w-0"
                                style={{
                                  backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.70))",
                                  borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.10))",
                                  borderRadius: `${theme.borderRadius ?? 12}px`,
                                }}
                              >
                                <div className="flex items-end gap-2 min-w-0 min-h-0 flex-1">
                                  <textarea
                                    value={promptDraft}
                                    onChange={(e) => setPromptDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        submitPrompt();
                                      }
                                    }}
                                    placeholder="Add a prompt to refine this image..."
                                    className="min-h-[4rem] max-h-[8rem] flex-1 resize-none overflow-auto rounded border-0 bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                                  />
                                  <Button
                                    type="button"
                                    onClick={submitPrompt}
                                    disabled={promptText.length < 4}
                                    className="h-9 w-9 shrink-0 rounded-full p-0"
                                    style={{
                                      backgroundColor: theme.primaryColor || "var(--form-primary-color, #3b82f6)",
                                      color: "#fff",
                                      fontFamily: theme.fontFamily,
                                    }}
                                    aria-label="Generate preview"
                                    title="Generate"
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
	                        </div>
	                      </motion.div>
	                    ) : adventureInputMode === "budget" && showPromptControls ? (
	                      <motion.div
	                        key="budget-input-mode"
	                        initial={{ opacity: 0, x: 16 }}
	                        animate={{ opacity: 1, x: 0 }}
	                        exit={{ opacity: 0, x: -16 }}
	                        transition={{ duration: 0.18, ease: "easeOut" }}
	                        className="w-full min-h-0 flex flex-1 flex-col"
	                      >
	                        <div className="w-full max-w-[68rem] mx-auto px-2.5 py-2 sm:px-3 sm:py-2.5 flex min-h-0 flex-1 flex-col">
	                          {inputModeToggle ? <div className="mb-1.5 flex shrink-0 justify-center min-w-0 overflow-hidden">{inputModeToggle}</div> : null}
	                          {useCompactNav ? (
	                            <div className="flex items-center min-w-0 min-h-0 flex-1">
	                              <div className="flex-1 min-w-0">
	                                <div className="px-1 min-w-0 py-0.5">
                                  <div
                                    className={cn(
                                      "pb-0.5 text-center font-black leading-tight tabular-nums",
                                      usePreviewPaneLayout ? "text-base sm:text-lg" : "text-lg sm:text-xl"
                                    )}
                                    style={{ color: primary, fontFamily: theme.fontFamily }}
                                  >
                                    {formatCurrency(localBudget, { locale: pricingLocale, currency: budgetCurrency, compact: true })}
                                  </div>
                                  <SliderPrimitive
                                    min={budgetSliderConfig.min}
                                    max={budgetSliderConfig.max}
                                    step={budgetSliderConfig.step}
                                    value={[localBudget]}
                                    onValueChange={(v) => handleBudgetInputChange(v[0] ?? localBudget)}
                                    compact={usePreviewPaneLayout}
                                    className="w-full min-w-0"
                                    aria-label="Adjust budget and regenerate preview"
                                    disabled={!canUseBudgetMode}
                                  />
                                  <div className={cn("flex items-center justify-between px-1 font-medium", usePreviewPaneLayout ? "mt-0.5 text-[10px]" : "mt-1 text-[11px]")}>
                                    <span style={{ color: textMuted || theme.textColor, fontFamily: theme.fontFamily }}>
                                      {budgetMinLabel}
                                    </span>
                                    <span style={{ color: textMuted || theme.textColor, fontFamily: theme.fontFamily }}>
                                      {budgetMaxLabel}
                                    </span>
                                  </div>
                                </div>
                              </div>
	                            </div>
	                          ) : (
	                            <div className="flex min-h-0 flex-1 flex-col min-w-0">
	                              <div className="px-1 py-1 min-h-0 flex-1 flex flex-col justify-center min-w-0">
                                <div
                                  className={cn(
                                    "pb-0.5 pt-0.5 text-center font-black leading-tight tabular-nums",
                                    usePreviewPaneLayout ? "text-base sm:text-lg" : "text-2xl"
                                  )}
                                  style={{ color: primary, fontFamily: theme.fontFamily }}
                                >
                                  {formatCurrency(localBudget, { locale: pricingLocale, currency: budgetCurrency, compact: true })}
                                </div>
                                <div className="w-full min-w-0">
                                  <SliderPrimitive
                                    min={budgetSliderConfig.min}
                                    max={budgetSliderConfig.max}
                                    step={budgetSliderConfig.step}
                                    value={[localBudget]}
                                    onValueChange={(v) => handleBudgetInputChange(v[0] ?? localBudget)}
                                    compact={usePreviewPaneLayout}
                                    className="w-full min-w-0"
                                    aria-label="Adjust budget and regenerate preview"
                                    disabled={!canUseBudgetMode}
                                  />
                                </div>
                                <div className={cn("flex shrink-0 items-center justify-between px-1 font-medium", usePreviewPaneLayout ? "mt-0.5 text-[10px]" : "mt-1 text-[11px]")}>
                                  <span style={{ color: textMuted || theme.textColor, fontFamily: theme.fontFamily }}>
                                    {budgetMinLabel}
                                  </span>
                                  <span style={{ color: textMuted || theme.textColor, fontFamily: theme.fontFamily }}>
                                    {budgetMaxLabel}
                                  </span>
                                </div>
	                              </div>
	                            </div>
	                          )}
	                        </div>
	                      </motion.div>
	                    ) : adventureInputMode === "uploads" && showPromptControls ? (
                        <motion.div
                          key="uploads-input-mode"
                          initial={{ opacity: 0, x: 16 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -16 }}
                          transition={{ duration: 0.18, ease: "easeOut" }}
                          className="w-full min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden"
                        >
                          <input
                            ref={uploadsInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!e.target) return;
                              (e.target as HTMLInputElement).value = "";
                              await handleUploadAndRegenerate(file);
                            }}
                          />
                          <div className={cn(
                            "flex w-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden",
                            useCompactNav ? "px-2 py-1" : "px-2 py-1.5 sm:px-3 sm:py-2 md:px-4 md:py-2.5"
                          )}>
                            {inputModeToggle ? <div className="mb-1 flex shrink-0 justify-center min-w-0 overflow-hidden">{inputModeToggle}</div> : null}
                            <div className="flex min-w-0 min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto overflow-x-hidden">
                              <div className={cn(
                                "flex w-full min-w-0 max-w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)]",
                                usePreviewPaneLayout ? "p-2 max-w-full" : "p-2 sm:p-3 md:p-4 max-w-[280px] sm:max-w-sm md:max-w-md"
                              )}>
                                <div className="w-full min-w-0 shrink-0 text-center">
                                  <div
                                    className={cn(
                                      "font-semibold leading-tight",
                                      usePreviewPaneLayout ? "text-[11px]" : "text-[11px] sm:text-xs md:text-sm"
                                    )}
                                    style={{ fontFamily: theme.fontFamily, color: theme.textColor }}
                                  >
                                    Update your reference image
                                  </div>
                                  <div
                                    className={cn(
                                      "leading-tight",
                                      usePreviewPaneLayout ? "mt-0.5 text-[10px]" : "mt-0.5 text-[10px] sm:text-[11px] md:text-xs"
                                    )}
                                    style={{ fontFamily: theme.fontFamily, color: textMuted || theme.textColor }}
                                  >
                                    Upload a new photo and we will regenerate the preview.
                                  </div>
                                </div>
                                <div className="flex w-full min-w-0 flex-shrink-0 flex-wrap items-center justify-center gap-2">
                                  {currentUploadedReferenceUrl ? (
                                    <div
                                      className={cn(
                                        "shrink-0 overflow-hidden rounded border border-[color:var(--form-surface-border-color)] bg-black/5",
                                        usePreviewPaneLayout ? "h-7 w-7" : "h-7 w-7 sm:h-8 sm:w-8 md:h-9 md:w-9"
                                      )}
                                      role="img"
                                      aria-label="Current uploaded reference image"
                                      title="Current image"
                                    >
                                      <div
                                        className="h-full w-full bg-cover bg-center bg-no-repeat"
                                        style={{ backgroundImage: `url("${currentUploadedReferenceUrl}")` }}
                                      />
                                    </div>
                                  ) : null}
                                  <Button
                                    type="button"
                                    disabled={refinementUploading}
                                    onClick={() => uploadsInputRef.current?.click()}
                                    className={cn(
                                      "shrink-0 font-medium",
                                      usePreviewPaneLayout ? "h-7 px-2.5 text-[10px]" : "h-7 px-2.5 text-[10px] sm:h-8 sm:px-3 sm:text-[11px] md:h-9 md:px-4 md:text-xs"
                                    )}
                                    style={{
                                      backgroundColor: theme.buttonStyle?.backgroundColor || theme.primaryColor || primary,
                                      color: theme.buttonStyle?.textColor || "#ffffff",
                                      fontFamily: theme.fontFamily,
                                      borderRadius: `${theme.borderRadius ?? 12}px`,
                                    }}
                                    title={refinementUploading ? "Uploading…" : currentUploadedReferenceUrl ? "Replace image" : "Choose image"}
                                  >
                                    <ImagePlus className={cn("shrink-0", usePreviewPaneLayout ? "h-3.5 w-3.5" : "h-3.5 w-3.5 sm:mr-1.5 sm:h-4 sm:w-4")} aria-hidden />
                                    <span className="min-w-0 truncate">{refinementUploading ? "Uploading…" : currentUploadedReferenceUrl ? "Replace image" : "Choose image"}</span>
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ) : (
	                      <motion.div
	                        key={(effectiveCurrentStep as any).id}
	                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="w-full min-h-0 flex flex-1 flex-col"
                      >
                        <div className={cn("flex-1 min-h-0", usePreviewPaneLayout ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden")}>
                          <ComponentRenderer
                            step={stepForRenderer}
                            stepData={state?.stepData ? state.stepData[(stepForRenderer as any).id] : undefined}
                            onComplete={handleStepComplete}
                            onBack={handleBack}
                            canGoBack={canGoBack}
                            isLoading={isFetchingNext || isBatchLoading}
                            allStepData={state?.stepData || {}}
                            allSteps={state?.steps || []}
                            instanceId={instanceId}
                            sessionId={sessionId}
                            config={config}
                            leadCaptured={leadCapturedForUI}
                            feedbackPrompt={showEasePrompt ? <EaseFeedbackPrompt visible={true} onSelect={handleEaseFeedback} /> : undefined}
                            headerInlineControl={inputModeToggle}
                            actionsVariant={useCompactNav || usePreviewPaneLayout ? "icon_only" : "default"}
                            guidedThumbnailMode={guidedThumbnailMode}
                            compactInPreview={usePreviewPaneLayout}
                          />
                        </div>
                      </motion.div>
                    )
                  ) : (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                      <AdventureLoader
                        phase="batch_pricing"
                        active={isBatchLoading}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="shrink-0">
                <ReflectionFeedbackPrompt visible={flowCompleted && !reflectionFeedbackSent} onSubmit={handleReflectionFeedback} />
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
