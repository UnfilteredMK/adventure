"use client";

import React from "react";
import type { StepDefinition } from "@/types/ai-form";
import type { MultipleChoiceUI } from "@/types/ai-form-ui-contract";
import { StepLayout } from "../ui-layout/StepLayout";
import { ImageChoiceGrid } from "../input-controls/ImageChoiceGridControl";

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
}

type PriceTier = "$" | "$$" | "$$$" | "$$$$";
type Opt = { label: string; value?: string; description?: string; imageUrl?: string; priceTier?: PriceTier };

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

function buildSelectionHint(minSelections: number, maxSelections?: number): string | null {
  if (!Number.isFinite(minSelections) || minSelections <= 0) return null;
  if (Number.isFinite(Number(maxSelections)) && Number(maxSelections) > minSelections) {
    return `Pick ${minSelections} to ${Number(maxSelections)} styles to continue.`;
  }
  return `Pick at least ${minSelections} style${minSelections === 1 ? "" : "s"} to continue.`;
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
}: ImageChoiceGridStepProps) {
  const isUIStep = "type" in (step as any) && !("componentType" in (step as any));
  const optionsRaw = isUIStep
    ? (step as MultipleChoiceUI).options
    : (step as StepDefinition).content?.options || (step as StepDefinition).data?.options || [];
  const options = normalizeOptions(optionsRaw as any[]).filter((option) => !isOtherOption(option));
  const multiple = isUIStep ? Boolean((step as MultipleChoiceUI).multi_select) : Boolean((step as StepDefinition).data?.multiple);
  const isStyleStep = isStyleDirectionStep(step);
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
    !guidedThumbnailMode && !compactInPreview && isNarrowViewport
      ? 1
      : normalizedColumns;

  const selectedArray = Array.isArray(value) ? value : value ? [value] : [];
  const canContinue = multiple ? selectedArray.length >= minSelections : Boolean(value);
  const selectionHint = multiple ? buildSelectionHint(minSelections, maxSelections) : null;
  const maxReached = Boolean(multiple && Number.isFinite(Number(maxSelections)) && selectedArray.length >= Number(maxSelections));

  return (
    <StepLayout
      step={step}
      onComplete={() => onComplete(value)}
      onBack={onBack}
      canGoBack={canGoBack}
      isLoading={isLoading}
      canContinue={canContinue}
      headerInlineControl={headerInlineControl}
      actionsVariant={actionsVariant ?? (isNarrowViewport ? "sticky_mobile" : "default")}
      compactInPreview={compactInPreview}
      preferWideLayout={!compactInPreview}
    >
      <div className={compactInPreview ? "mx-auto flex h-full min-h-0 w-full max-w-5xl min-w-0 flex-col overflow-hidden" : "flex min-h-0 w-full min-w-0 flex-col"}>
        {selectionHint ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)]/70 px-3 py-2 text-xs sm:text-sm">
            <span className="text-muted-foreground">{selectionHint}</span>
            <span className={maxReached ? "font-semibold text-primary" : "font-medium text-muted-foreground"}>
              {selectedArray.length}
              {Number.isFinite(Number(maxSelections)) ? ` / ${Number(maxSelections)}` : ""}
            </span>
          </div>
        ) : null}
        <ImageChoiceGrid
          value={value}
          onChange={setValue}
          onSwipeComplete={(finalValue) => {
            if (isLoading) return;
            onComplete(finalValue);
          }}
          options={options}
          multiple={multiple}
          maxSelections={maxSelections}
          variant={effectiveVariant}
          columns={effectiveColumns}
          thumbnailMode={Boolean(guidedThumbnailMode || compactInPreview)}
        />
      </div>
    </StepLayout>
  );
}
