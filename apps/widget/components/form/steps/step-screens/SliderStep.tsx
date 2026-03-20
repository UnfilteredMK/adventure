"use client";

import React from "react";
import type { StepDefinition } from "@/types/ai-form";
import type { SliderUI } from "@/types/ai-form-ui-contract";
import { StepLayout } from "../ui-layout/StepLayout";
import { Slider as SliderPrimitive } from "@/components/ui/slider";
import { useFormTheme } from "../../demo/FormThemeProvider";
import { useLayoutDensity } from "../ui-layout/layout-density";
import { formatCurrency } from "@/lib/ai-form/utils/currency";
import { cn } from "@/lib/utils";

interface SliderStepProps {
  step: StepDefinition | SliderUI;
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

export function SliderStep({
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
}: SliderStepProps) {
  const { theme } = useFormTheme();
  const density = useLayoutDensity();
  const isCompact = density === "compact";
  const isUIStep = "type" in (step as any) && !(step as any).componentType;

  const min = isUIStep ? Number((step as any).min ?? 0) : Number((step as StepDefinition).data?.min ?? 0);
  const max = isUIStep ? Number((step as any).max ?? 100) : Number((step as StepDefinition).data?.max ?? 100);
  const stepSize = isUIStep ? Number((step as any).step ?? 1) : Number((step as StepDefinition).data?.step ?? 1);

  const unit = isUIStep ? ((step as any).unit ?? null) : ((step as any).data?.unit ?? null);
  const currency = isUIStep ? ((step as any).currency ?? null) : ((step as any).data?.currency ?? null);
  const prefix = isUIStep ? String((step as any).prefix ?? "") : String((step as any).data?.prefix ?? "");
  const suffix = isUIStep ? String((step as any).suffix ?? "") : String((step as any).data?.suffix ?? "");
  const format = isUIStep ? ((step as any).format ?? null) : ((step as any).data?.format ?? null);

  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 100;
  const safeStep = Number.isFinite(stepSize) && stepSize > 0 ? stepSize : 1;

  const defaultValue = Math.round((safeMin + safeMax) / 2);
  const [value, setValue] = React.useState<number>(typeof stepData === "number" ? stepData : defaultValue);

  React.useEffect(() => {
    if (typeof stepData === "number") setValue(stepData);
  }, [stepData]);

  const formatValue = React.useCallback(
    (n: number) => {
      const raw = Number.isFinite(Number(n)) ? Number(n) : 0;
      const rounded = safeStep >= 1 ? Math.round(raw) : raw;

      const pref = typeof prefix === "string" ? prefix : "";
      const suf = typeof suffix === "string" ? suffix : "";

      // Prefer currency formatting if requested or currency is provided.
      const c = typeof currency === "string" ? currency.trim() : "";
      if (format === "currency" || c) {
        if (c && /^[A-Za-z]{3}$/.test(c)) return `${pref}${formatCurrency(raw, { currency: c.toUpperCase() })}${suf}`;
        if (c) return `${pref}${c}${rounded.toLocaleString()}${suf}`;
      }

      const u = typeof unit === "string" ? unit.trim() : "";
      if (u) return `${pref}${rounded.toLocaleString()} ${u}${suf}`;
      return `${pref}${rounded.toLocaleString()}${suf}`;
    },
    [currency, format, prefix, safeStep, suffix, unit]
  );

  return (
    <StepLayout
      step={step as any}
      onComplete={() => onComplete(value)}
      onBack={onBack}
      canGoBack={canGoBack}
      isLoading={isLoading}
      feedbackPrompt={feedbackPrompt}
      headerInlineControl={headerInlineControl}
      actionsVariant={actionsVariant}
      compactInPreview={compactInPreview}
      layoutDebugEnabled={layoutDebugEnabled}
    >
      <div
        className={cn(
          compactInPreview ? "mx-auto flex h-full min-h-0 w-full min-w-0 max-w-[68%] flex-col justify-start overflow-visible px-0 pt-0 pb-0 gap-0.5" : null,
          !compactInPreview && (isCompact ? "py-3 space-y-3" : "py-5 sm:py-8 space-y-4 sm:space-y-6")
        )}
      >
        <div
          className={cn(
            "font-black text-center",
            compactInPreview ? "w-full min-w-0 text-[clamp(0.92rem,1.8vh,1.18rem)] leading-tight py-0.5" : isCompact ? "text-3xl sm:text-4xl" : "text-4xl sm:text-6xl"
          )}
          style={{ color: theme.primaryColor, fontFamily: theme.fontFamily }}
        >
          {formatValue(value)}
        </div>
        <SliderPrimitive
          value={[value]}
          onValueChange={(v) => setValue(v[0])}
          min={safeMin}
          max={safeMax}
          step={safeStep}
          compact={Boolean(compactInPreview)}
          className="w-full"
        />
        {compactInPreview ? (
          <div className="flex items-center justify-between px-0 text-[clamp(8px,0.95vh,10px)] font-medium leading-none opacity-70">
            <span style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>{formatValue(safeMin)}</span>
            <span style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>{formatValue(safeMax)}</span>
          </div>
        ) : null}
      </div>
    </StepLayout>
  );
}
