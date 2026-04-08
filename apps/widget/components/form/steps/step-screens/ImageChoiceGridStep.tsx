"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { StepDefinition } from "@/types/ai-form";
import type { MultipleChoiceUI } from "@/types/ai-form-ui-contract";
import { StepLayout } from "../ui-layout/StepLayout";
import { ImageChoiceGrid } from "../input-controls/ImageChoiceGridControl";
import { layoutDebugClassName, withLayoutDebugStyle } from "../runtime/step-engine/debug-layout";

interface ImageChoiceGridStepProps {
  step: StepDefinition | MultipleChoiceUI;
  stepData?: any;
  onComplete: (data: any) => void;
  onBack?: () => void;
  canGoBack: boolean;
  isLoading: boolean;
  headerInlineControl?: React.ReactNode;
  guidedThumbnailMode?: boolean;
  actionsVariant?: "default" | "sticky_mobile" | "icon_only";
  compactInPreview?: boolean;
  layoutDebugEnabled?: boolean;
}

type PriceTier = "$" | "$$" | "$$$" | "$$$$";
type Opt = {
  label: string;
  value?: string;
  description?: string;
  imageUrl?: string;
  priceTier?: PriceTier;
  priceRange?: { low: number; high: number; currency?: string };
  disabled?: boolean;
};

type ImageChoiceVariant = "swipe" | "selectors";

function normalizeOptions(raw: any[]): Opt[] {
  const normalizePriceTier = (v: unknown): PriceTier | undefined => {
    const t = typeof v === "string" ? v.trim() : "";
    if (t === "$" || t === "$$" || t === "$$$" || t === "$$$$") return t;
    return undefined;
  };
  return (Array.isArray(raw) ? raw : []).map((o) => {
    if (typeof o === "string") return { label: o, value: o };
    const imageUrl =
      typeof o?.imageUrl === "string"
        ? o.imageUrl
        : typeof o?.image_url === "string"
          ? o.image_url
          : typeof o?.image === "string"
            ? o.image
            : undefined;
    return {
      label: String(o?.label || o?.value || ""),
      value: String(o?.value || o?.label || ""),
      description: typeof o?.description === "string" ? o.description : undefined,
      imageUrl,
      priceTier: normalizePriceTier(o?.price_tier ?? o?.priceTier),
      priceRange:
        o?.priceRange && typeof o.priceRange === "object"
          ? {
              low: Number((o as any).priceRange.low),
              high: Number((o as any).priceRange.high),
              currency: typeof (o as any).priceRange.currency === "string" ? (o as any).priceRange.currency : undefined,
            }
          : undefined,
      disabled: Boolean(o?.disabled),
    };
  });
}

function isOtherOption(option: Opt): boolean {
  const label = String(option.label || "").trim().toLowerCase();
  const value = String(option.value || "").trim().toLowerCase();
  return label === "other" || value === "other";
}

function useIsNarrowViewport(maxWidthPx: number): boolean {
  const [isNarrow, setIsNarrow] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(`(max-width: ${Math.max(0, Math.floor(maxWidthPx))}px)`);
    const onChange = () => setIsNarrow(Boolean(mql.matches));
    onChange();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Safari < 14
    // eslint-disable-next-line deprecation/deprecation
    mql.addListener(onChange);
    // eslint-disable-next-line deprecation/deprecation
    return () => mql.removeListener(onChange);
  }, [maxWidthPx]);

  return isNarrow;
}

function isStyleDirectionStep(step: StepDefinition | MultipleChoiceUI): boolean {
  const rawId = String((step as any)?.id || (step as any)?.key || "").trim().toLowerCase();
  return rawId === "style_direction" || rawId === "step-style-direction";
}

function isPricedImageGridStep(step: StepDefinition | MultipleChoiceUI): boolean {
  const rawId = String((step as any)?.id || (step as any)?.key || "").trim().toLowerCase();
  return rawId === "step-priced-image-grid";
}

export function ImageChoiceGridStep({
  step,
  stepData,
  onComplete,
  onBack,
  canGoBack,
  isLoading,
  headerInlineControl,
  guidedThumbnailMode,
  actionsVariant,
  compactInPreview,
  layoutDebugEnabled = false,
}: ImageChoiceGridStepProps) {
  const isUIStep = "type" in (step as any) && !("componentType" in (step as any));
  const optionsRaw = isUIStep
    ? (step as MultipleChoiceUI).options
    : (step as StepDefinition).content?.options || (step as StepDefinition).data?.options || [];
  const options = normalizeOptions(optionsRaw as any[]).filter((option) => !isOtherOption(option));
  const multiple = isUIStep ? Boolean((step as MultipleChoiceUI).multi_select) : Boolean((step as StepDefinition).data?.multiple);
  const isStyleStep = isStyleDirectionStep(step);
  const isPricedGridStep = isPricedImageGridStep(step);
  const minSelections =
    isUIStep && multiple && Number.isFinite(Number((step as any)?.min_selections))
      ? Math.max(1, Math.floor(Number((step as any).min_selections)))
      : isStyleStep && multiple
        ? 3
      : multiple
        ? 1
        : 1;
  const maxSelections =
    isUIStep && multiple && Number.isFinite(Number((step as any)?.max_selections))
      ? Math.max(1, Math.floor(Number((step as any).max_selections)))
      : isStyleStep && multiple
        ? 5
      : undefined;
  const [value, setValue] = React.useState<any>(stepData ?? (multiple ? [] : ""));
  React.useEffect(() => {
    if (stepData !== undefined) setValue(stepData);
  }, [stepData]);

  const isNarrowViewport = useIsNarrowViewport(768);
  const effectiveVariant: ImageChoiceVariant = guidedThumbnailMode
    ? "selectors"
    : compactInPreview
      ? "selectors"
      : isNarrowViewport
        ? "selectors"
        : "selectors";

  const columns = isUIStep ? (step as any)?.columns : (step as any)?.data?.columns;
  const normalizedColumns = Number.isFinite(Number(columns)) ? Math.max(1, Math.min(6, Math.floor(Number(columns)))) : undefined;
  const effectiveColumns =
    !isPricedGridStep && !guidedThumbnailMode && !compactInPreview && isNarrowViewport
      ? 1
      : normalizedColumns;

  const selectedArray = Array.isArray(value) ? value : value ? [value] : [];
  const canContinue = multiple ? selectedArray.length >= minSelections : Boolean(value);
  const maxReached = Boolean(multiple && Number.isFinite(Number(maxSelections)) && selectedArray.length >= Number(maxSelections));
  const autoContinueOnSelect = isPricedGridStep
    ? !multiple
    : isStyleStep && !multiple;
  const handleValueChange = React.useCallback(
    (nextValue: string | string[]) => {
      setValue(nextValue);
      if (!autoContinueOnSelect || isLoading) return;
      const resolvedValue = Array.isArray(nextValue) ? nextValue[0] : nextValue;
      if (!resolvedValue) return;
      onComplete(resolvedValue);
    },
    [autoContinueOnSelect, isLoading, onComplete]
  );
  const selectionCounter = multiple && Number.isFinite(Number(maxSelections))
    ? (
        <span
          className={cn(
            "shrink-0 tabular-nums text-sm sm:text-base",
            maxReached ? "font-semibold text-primary" : "font-medium text-muted-foreground"
          )}
        >
          {selectedArray.length}/{Number(maxSelections)}
        </span>
      )
    : null;
  /** In preview-under compact layout, hide "Pick n–m" + n/m counter — it used a full-height grid row and overlapped the title/images. */
  const styleSelectionHeader =
    compactInPreview
      ? null
      : isStyleStep && multiple && selectionCounter
        ? (
            <div
              className={cn(
                "flex max-w-full flex-col items-end gap-0.5 sm:flex-row sm:items-baseline sm:gap-2.5",
                headerInlineControl ? "sm:items-center" : null
              )}
            >
              <span className="text-right text-[11px] leading-snug text-muted-foreground max-w-[14rem] sm:max-w-[min(100%,20rem)] sm:text-sm">
                <span className="sm:hidden">
                  Pick {minSelections}–{Number(maxSelections)} styles
                </span>
                <span className="hidden sm:inline">
                  Select at least {minSelections} examples (up to {Number(maxSelections)})
                </span>
              </span>
              {selectionCounter}
            </div>
          )
        : (
            selectionCounter
          );
  const resolvedHeaderInlineControl = styleSelectionHeader || headerInlineControl
    ? (
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:justify-start">
          {headerInlineControl}
          {styleSelectionHeader}
        </div>
      )
    : undefined;
  const trustLine =
    isPricedGridStep
      ? String((step as any)?.blueprint?.validation?.trust_line || "").trim() || "Based on real examples similar to yours"
      : "";

  return (
    <StepLayout
      step={step}
      onComplete={() => onComplete(value)}
      onBack={onBack}
      canGoBack={canGoBack}
      isLoading={isLoading}
      canContinue={canContinue}
      headerInlineControl={resolvedHeaderInlineControl}
      actionsVariant={actionsVariant ?? (isNarrowViewport ? "sticky_mobile" : "default")}
      stickyActionsTransparent={isStyleStep}
      hideContinueAction={isPricedGridStep}
      compactInPreview={isPricedGridStep ? false : compactInPreview}
      preferWideLayout={isPricedGridStep || !compactInPreview}
      layoutDebugEnabled={layoutDebugEnabled}
    >
      <div
        className={layoutDebugClassName(
          layoutDebugEnabled,
          isPricedGridStep
            ? "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
            : !isPricedGridStep && compactInPreview
              ? "mx-auto flex w-full max-w-none min-w-0 shrink-0 flex-col min-h-0"
              : "flex min-h-0 w-full min-w-0 flex-col"
        )}
        style={isPricedGridStep ? undefined : withLayoutDebugStyle(undefined, layoutDebugEnabled, "emerald")}
      >
        <div
          className={layoutDebugClassName(
            layoutDebugEnabled,
            isPricedGridStep
              ? "w-full min-w-0 flex min-h-0 flex-1 flex-col"
              : "w-full min-h-0 flex-1 flex flex-col"
          )}
          style={
            isPricedGridStep
              ? undefined
              : withLayoutDebugStyle(undefined, layoutDebugEnabled, "answerGreen")
          }
        >
          {isPricedGridStep ? (
            <div className="shrink-0 pb-2 text-center text-xs text-muted-foreground">{trustLine}</div>
          ) : null}
          <div
            className={cn(
              isPricedGridStep ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y" : null
            )}
            style={isPricedGridStep ? ({ WebkitOverflowScrolling: "touch" } as React.CSSProperties) : undefined}
          >
            <ImageChoiceGrid
              value={value}
              onChange={handleValueChange}
              onSwipeComplete={(finalValue) => {
                if (isLoading) return;
                onComplete(finalValue);
              }}
              options={options}
              multiple={multiple}
              maxSelections={maxSelections}
              variant={effectiveVariant}
              columns={effectiveColumns}
              thumbnailMode={isPricedGridStep ? false : Boolean(guidedThumbnailMode || compactInPreview)}
              compactScroller={isPricedGridStep ? false : Boolean(compactInPreview)}
              hideOptionText={isStyleStep || isPricedGridStep}
              displayMode={isPricedGridStep ? "priced_examples" : "default"}
              className={!isPricedGridStep && compactInPreview ? "w-full min-h-0 shrink-0" : undefined}
            />
          </div>
        </div>
      </div>
    </StepLayout>
  );
}
