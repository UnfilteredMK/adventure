"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { hexToRgba } from "@/types/design";
import { Button } from "@/components/ui/button";
import { Slider as SliderPrimitive } from "@/components/ui/slider";
import { AdventureLoader } from "@/components/form/AdventureLoader";
import { ComponentRenderer } from "../../ComponentRenderer";
import { EaseFeedbackPrompt } from "../../../../dev-helpers/UserFeedbackPrompt";
import { ArrowLeft, ArrowUp, ImagePlus } from "lucide-react";
import { usePreviewSuggestions } from "@/components/form/state/PreviewSuggestionsContext";
import type { Suggestion } from "@/types";
import { PreviewIdeasChips } from "../../../preview-ideas/PreviewIdeasChips";
import { OPEN_DESIGN_ESTIMATE_GATE_EVENT } from "../../../image-preview-experience/gallery/preview-cache-bridge";
import { detectCurrencyFromLocale, formatCurrency } from "@/lib/ai-form/utils/currency";
import { layoutDebugClassName, withLayoutDebugStyle } from "../debug-layout";
import { DesignModeToolbar } from "./DesignModeToolbar";

interface FormQuestionSectionProps {
  config?: any;
  effectiveCurrentStep: any;
  flowCompleted: boolean;
  forceExpandedStepLayout?: boolean;
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
  adventureInputMode: "questions" | "ideas" | "prompt" | "budget" | "uploads";
  setAdventureInputMode: (mode: "questions" | "ideas" | "prompt" | "budget" | "uploads") => void;
  onApplyIdeaSuggestion: (suggestion: Suggestion) => void;
  budgetSliderConfig: { min: number; max: number; step: number; currency: string };
  budgetValue: number | null;
  onBudgetChange: (value: number) => void;
  promptDraft: string;
  setPromptDraft: (value: string) => void;
  handlePromptSubmit: (uploadedUrl?: string) => void;
  onRegeneratePreview: (uploadedUrl?: string) => void;
  previewEnabled: boolean;
  previewHasImage: boolean;
  /** From preview canvas: Ideas chrome only when `single` (hero), not concept grid. */
  previewSurfaceMode?: "gallery" | "single" | "empty";
  questionContentRef: React.RefObject<HTMLDivElement>;
  questionScale: number;
  questionViewportRef: React.RefObject<HTMLDivElement>;
  refinementUploadInputRef: React.RefObject<HTMLInputElement>;
  refinementUploading: boolean;
  reflectionFeedbackSent: boolean;
  sessionId: string;
  setRefinementUploading: React.Dispatch<React.SetStateAction<boolean>>;
  showStepTransitionSkeleton: boolean;
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
  layoutDebugEnabled?: boolean;
  /** Parent (e.g. body) owns vertical scroll — avoid nested scroll traps under the preview. */
  scrollStackWithPreview?: boolean;
  onProjectPhotoSelected?: (url: string) => void | Promise<void>;
}

export function FormQuestionSection({
  config,
  effectiveCurrentStep,
  flowCompleted,
  forceExpandedStepLayout = false,
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
  onApplyIdeaSuggestion,
  budgetSliderConfig,
  budgetValue,
  onBudgetChange,
  promptDraft,
  setPromptDraft,
  handlePromptSubmit,
  onRegeneratePreview,
  previewEnabled,
  previewHasImage,
  previewSurfaceMode = "empty",
  questionContentRef,
  questionScale,
  questionViewportRef,
  refinementUploadInputRef,
  refinementUploading,
  reflectionFeedbackSent,
  sessionId,
  setRefinementUploading,
  showStepTransitionSkeleton,
  showAccuratePricingLoader,
  showEasePrompt,
  showQuestionPaneUnderPreview,
  state,
  stepForRenderer,
  theme,
  usePreviewDominantLayout,
  guidedThumbnailMode,
  layoutDebugEnabled = false,
  scrollStackWithPreview = false,
  onProjectPhotoSelected,
}: FormQuestionSectionProps) {
  const uploadsInputRef = useRef<HTMLInputElement>(null);
  const { suggestions: ideasSuggestions, loading: ideasLoading } = usePreviewSuggestions();
  /** Hide toolbar only in concept-gallery mode; allow `empty` until preview reports surface (avoids missing toolbar). */
  const showPromptControls = Boolean(
    previewEnabled &&
      previewHasImage &&
      previewSurfaceMode !== "gallery" &&
      !isRefinementUploadStep &&
      !hideQuestionPane
  );
  /** Mode strip (Ideas / Guided / Prompt / …) — hidden until lead capture so the preview lead modal is the focus. */
  const showModeToolbar = Boolean(showPromptControls && leadCapturedForUI);
  const usePreviewPaneLayout = Boolean(
    usePreviewDominantLayout && showQuestionPaneUnderPreview && previewHasImage && !forceExpandedStepLayout
  );
  const useBottomDockLayout = Boolean(usePreviewPaneLayout && isMobileViewport);
  const useCompactNav = useBottomDockLayout;
  /** Compact Prompt/Budget/Uploads chrome whenever the pane is squashed under the preview (desktop or mobile). */
  const useCompactToolingChrome = Boolean(useBottomDockLayout || usePreviewPaneLayout);
  const compactPreviewActive = Boolean(usePreviewPaneLayout);
  const useIconOnlyActions = Boolean(useCompactNav || usePreviewPaneLayout);
  const useWideQuestionContent = Boolean(usePreviewDominantLayout && showQuestionPaneUnderPreview && previewHasImage);
  const rendererStepType = String((stepForRenderer as any)?.type || (stepForRenderer as any)?.componentType || "").toLowerCase();
  /** Steps that own scrolling / tall visual content must not use bottom-anchoring (would clip the top of grids). */
  const rendererAllowsInternalScroll =
    rendererStepType === "image_choice_grid" || rendererStepType === "gallery";
  /** Single-hero preview: anchor guided questionnaire (e.g. text choices) to the bottom of the strip — not image grids. */
  const singleHeroGuidedBottom = Boolean(
    previewSurfaceMode === "single" &&
      usePreviewPaneLayout &&
      adventureInputMode === "questions" &&
      !rendererAllowsInternalScroll
  );
  /** Top-align scroll-owned guided steps so image grids are not vertically centered/clipped in the strip. */
  const compactGuidedVisualScroll =
    Boolean(
      usePreviewPaneLayout &&
        adventureInputMode === "questions" &&
        rendererAllowsInternalScroll
    );
  /** Guided strip height follows step content (parent host is `h-auto` + max-height in StepEngineBodySection). */
  const guidedPaneContentSized = Boolean(usePreviewPaneLayout && adventureInputMode === "questions");
  const promptText = promptDraft.trim();
  /** Always offer Back when `handleBack` is wired; behavior for step 0 is handled in StepEngine (e.g. return to concept grid). */
  const canGoBack = true;
  const primary = theme.primaryColor || "#3b82f6";
  const textMuted = theme.textColor ? hexToRgba(theme.textColor, 0.65) : undefined;
  /** Pricing/lead modal not finished — lock Prompt/Budget/Uploads, idea chips, and Guided (unless still on questionnaire). */
  const designToolsNeedLead = Boolean(showPromptControls && !leadCapturedForUI);
  const canUseBudgetMode = Boolean(showPromptControls && leadCapturedForUI);
  const guidedTabDisabled = Boolean(designToolsNeedLead && adventureInputMode !== "questions");
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

  const requestPreviewLeadGate = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(OPEN_DESIGN_ESTIMATE_GATE_EVENT, {
        detail: { sessionId, centered: true },
      })
    );
  }, [sessionId]);

  useEffect(() => {
    if (!designToolsNeedLead) return;
    if (adventureInputMode === "prompt" || adventureInputMode === "budget" || adventureInputMode === "uploads") {
      setAdventureInputMode("ideas");
    }
  }, [designToolsNeedLead, adventureInputMode, setAdventureInputMode]);

  const sharedQuestionControls =
    showModeToolbar || (showEasePrompt && adventureInputMode === "questions") ? (
    <div
      className={layoutDebugClassName(
        layoutDebugEnabled,
        cn(
          "shrink-0 pb-1 pt-1 sm:px-2.5",
          usePreviewPaneLayout && isMobileViewport ? "px-0" : "px-2",
          usePreviewPaneLayout ? "pt-1" : "pt-0.5"
        )
      )}
      style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber")}
    >
      <div
        className={layoutDebugClassName(
          layoutDebugEnabled,
          cn(
            "flex w-full min-w-0 flex-col gap-0",
          )
        )}
        style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneParent")}
      >
        {showModeToolbar || (showEasePrompt && adventureInputMode === "questions") ? (
          <div
            className={layoutDebugClassName(
              layoutDebugEnabled,
              cn(
                "min-h-8 w-full min-w-0 items-center gap-2",
                useCompactNav || usePreviewPaneLayout
                  ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
                  : "flex justify-center"
              )
            )}
          >
            {useCompactNav || usePreviewPaneLayout ? <div aria-hidden="true" className="min-w-0" /> : null}
            <div className="relative z-10 flex min-w-0 items-center justify-center overflow-visible self-center">
              {showModeToolbar ? (
                <DesignModeToolbar
                  adventureInputMode={adventureInputMode}
                  setAdventureInputMode={setAdventureInputMode}
                  designToolsNeedLead={designToolsNeedLead}
                  guidedTabDisabled={guidedTabDisabled}
                  textMuted={textMuted}
                  layoutDebugEnabled={layoutDebugEnabled}
                  compactTabs={useCompactToolingChrome}
                />
              ) : null}
            </div>
            <div
              className={cn(
                "relative z-0 flex min-w-0 items-center",
                useCompactNav || usePreviewPaneLayout ? "justify-end" : "justify-center"
              )}
            >
              {showEasePrompt && adventureInputMode === "questions" ? (
                <EaseFeedbackPrompt visible={true} onSelect={handleEaseFeedback} layoutDebugEnabled={layoutDebugEnabled} />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

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
          className={layoutDebugClassName(
            layoutDebugEnabled,
            cn(
              "relative flex w-full min-h-0 flex-col",
              guidedPaneContentSized
                ? "h-auto shrink-0 overflow-x-hidden overflow-y-visible"
                : scrollStackWithPreview
                  ? "overflow-visible"
                  : "overflow-hidden",
              usePreviewPaneLayout
                ? (
                    guidedPaneContentSized
                      ? "border-t border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)]"
                      : useBottomDockLayout
                        ? "min-h-0 flex-1 border-t border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)]"
                        : "min-h-0 flex-1"
                  )
                : scrollStackWithPreview
                  ? "h-auto w-full shrink-0"
                  : "flex-1"
            )
          )}
          style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneParent")}
        >
          <div
            ref={questionContentRef}
                className={layoutDebugClassName(
                  layoutDebugEnabled,
                  cn(
                    guidedPaneContentSized
                      ? "mx-auto flex h-auto min-h-0 w-full flex-col overflow-x-hidden"
                      : scrollStackWithPreview
                        ? "mx-auto flex h-auto min-h-0 w-full flex-col overflow-x-hidden overflow-y-visible"
                        : "mx-auto flex h-full min-h-0 flex-1 w-full flex-col overflow-hidden",
                    useWideQuestionContent ? "max-w-none" : "max-w-6xl"
                  )
                )}
            style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneQuestion")}
          >
              {sharedQuestionControls}
              <div
                className={layoutDebugClassName(
                  layoutDebugEnabled,
                  cn(
                    "flex min-h-0 w-full flex-col",
                    guidedPaneContentSized ? "flex-none" : scrollStackWithPreview ? "flex-none" : "flex-1",
                    adventureInputMode === "ideas"
                      ? usePreviewPaneLayout
                        ? "overflow-x-hidden overflow-y-auto justify-start"
                        : "overflow-x-hidden overflow-y-hidden justify-start"
                      : usePreviewPaneLayout
                        ? "overflow-x-hidden overflow-y-auto"
                        : scrollStackWithPreview
                          ? "overflow-x-hidden overflow-y-visible"
                          : "overflow-auto",
                    singleHeroGuidedBottom || (adventureInputMode !== "ideas" && useBottomDockLayout)
                      ? "justify-end"
                      : adventureInputMode !== "ideas" && useCompactToolingChrome
                        ? compactGuidedVisualScroll
                          ? "justify-start"
                          : "justify-center"
                        : null
                  )
                )}
                style={
                  withLayoutDebugStyle(
                    !usePreviewPaneLayout && questionScale < 0.999
                      ? {
                          transform: `scale(${questionScale})`,
                          transformOrigin: "top center",
                          width: `${100 / questionScale}%`,
                        }
                      : undefined,
                    layoutDebugEnabled,
                    "darkYellow"
                  )
                }
	              >
	                <AnimatePresence mode="wait">
	                  {!showAccuratePricingLoader ? (
	                    leadGateLocksQuestionArea ? null : isRefinementUploadStep ? (
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
	                    ) : adventureInputMode === "ideas" && showPromptControls ? (
	                      <motion.div
	                        key="ideas-input-mode"
	                        initial={{ opacity: 0, x: 16 }}
	                        animate={{ opacity: 1, x: 0 }}
	                        exit={{ opacity: 0, x: -16 }}
	                        transition={{ duration: 0.18, ease: "easeOut" }}
	                        className={layoutDebugClassName(
	                          layoutDebugEnabled,
	                          "flex w-full shrink-0 flex-col overflow-hidden"
	                        )}
	                        style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
	                      >
	                        <div
	                          className={layoutDebugClassName(
	                            layoutDebugEnabled,
	                            cn(
	                              "flex w-full shrink-0 flex-col overflow-hidden",
	                              usePreviewPaneLayout ? "px-2 pb-2 pt-3" : "px-2.5 pb-2 pt-3 sm:px-3 sm:pt-3.5"
	                            )
	                          )}
	                          style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber")}
	                        >
	                          {/* Same outer shell as `MultipleChoiceStep` so idea pills match choice bubbles */}
	                          <div
	                            className={
	                              compactPreviewActive
	                                ? "flex h-full min-h-0 min-w-0 w-full flex-col justify-start overflow-hidden py-0 text-center [&>div]:w-full [&>div]:min-w-0 [&>div>div]:mx-auto"
	                                : "w-full min-w-0 [&>div]:w-full [&>div]:text-left [&>div>div]:mx-0 [&>div>div:first-child]:w-full [&>div>div:first-child]:justify-start"
	                            }
	                          >
	                            <PreviewIdeasChips
	                              suggestions={ideasSuggestions}
	                              loading={ideasLoading}
	                              onApply={onApplyIdeaSuggestion}
	                              onRequestLeadGate={designToolsNeedLead ? requestPreviewLeadGate : undefined}
	                              compact={compactPreviewActive}
	                              leadComplete={leadCapturedForUI}
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
                        className={layoutDebugClassName(layoutDebugEnabled, "w-full min-h-0 flex flex-1 flex-col")}
                        style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
                      >
                        <div
                          className={layoutDebugClassName(
                            layoutDebugEnabled,
                            cn(
                              "w-full py-2 flex min-h-0 flex-1 flex-col sm:py-2.5",
                              usePreviewPaneLayout ? "px-2" : "px-2.5 sm:px-3"
                            )
                          )}
                          style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber")}
                        >
                          {useCompactToolingChrome ? (
                            <div className="min-w-0 min-h-0 flex flex-1 flex-col">
                              <div
                                className="rounded-xl border p-2 min-h-0 flex-1 flex flex-col min-w-0 overflow-hidden"
                                style={{
                                  backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.70))",
                                  borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.10))",
                                  borderRadius: `${theme.borderRadius ?? 12}px`,
                                }}
                              >
                                <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-2">
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
                                    className="min-h-[2.5rem] max-h-[6rem] flex-1 resize-none overflow-auto rounded border-0 bg-transparent px-2 py-1.5 text-left align-top text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                                  />
                                  <Button
                                    type="button"
                                    onClick={submitPrompt}
                                    disabled={promptText.length < 4}
                                    className="h-8 w-8 shrink-0 self-end rounded-full p-0"
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
                                <div className="flex min-h-0 min-w-0 flex-1 items-stretch gap-2">
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
                                    className="min-h-[4rem] max-h-[8rem] flex-1 resize-none overflow-auto rounded border-0 bg-transparent px-2 py-1.5 text-left align-top text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                                  />
                                  <Button
                                    type="button"
                                    onClick={submitPrompt}
                                    disabled={promptText.length < 4}
                                    className="h-9 w-9 shrink-0 self-end rounded-full p-0"
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
	                        className={layoutDebugClassName(layoutDebugEnabled, "w-full min-h-0 flex flex-1 flex-col")}
                          style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
	                      >
	                        <div
                            className={layoutDebugClassName(
                              layoutDebugEnabled,
                              cn(
                                "w-full py-2 flex min-h-0 flex-1 flex-col sm:py-2.5",
                                usePreviewPaneLayout ? "px-2" : "px-2.5 sm:px-3"
                              )
                            )}
                            style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber")}
                          >
	                          {useCompactToolingChrome ? (
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
                          className={layoutDebugClassName(layoutDebugEnabled, "w-full min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden")}
                          style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
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
                          <div
                            className={layoutDebugClassName(
                              layoutDebugEnabled,
                              cn(
                                "flex w-full min-w-0 min-h-0 flex-1 flex-col overflow-hidden",
                                usePreviewPaneLayout
                                  ? "px-2 py-1.5 sm:py-2"
                                  : "px-2 py-1.5 sm:px-3 sm:py-2 md:px-4 md:py-2.5"
                              )
                            )}
                            style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber")}
                          >
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
                        className={layoutDebugClassName(
                          layoutDebugEnabled,
                          cn("w-full min-h-0 flex flex-1 flex-col", singleHeroGuidedBottom && "justify-end")
                        )}
                        style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
                      >
                        <div
                          className={layoutDebugClassName(
                            layoutDebugEnabled,
                            cn(
                              "min-h-0 flex-1",
                              singleHeroGuidedBottom && "flex flex-col justify-end",
                              rendererAllowsInternalScroll ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden"
                            )
                          )}
                          style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "answerGreen")}
                        >
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
                            actionsVariant={
                              isMobileViewport
                                ? "sticky_mobile"
                                : useIconOnlyActions
                                  ? "icon_only"
                                  : "default"
                            }
                            guidedThumbnailMode={guidedThumbnailMode}
                            compactInPreview={compactPreviewActive}
                            layoutDebugEnabled={layoutDebugEnabled}
                            onProjectPhotoSelected={onProjectPhotoSelected}
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
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
