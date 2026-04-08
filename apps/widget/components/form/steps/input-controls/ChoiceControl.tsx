"use client";

// Choice Control - Single or multi-select using shared contract
import React, { useEffect, useMemo, useState } from 'react';
import type { MultipleChoiceUI, UIOption } from '@/types/ai-form-ui-contract';
import { useFormTheme } from '../../demo/FormThemeProvider';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StepDefinition } from '@/types/ai-form';
import { useLayoutDensity } from "../ui-layout/layout-density";

function hexToRgba(hex: string, alpha: number): string | null {
  const h = String(hex || "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function withAlpha(color: string | undefined, alpha: number): string {
  const c = String(color || "").trim();
  const a = Math.max(0, Math.min(1, alpha));
  if (!c) return `rgba(15, 23, 42, ${a})`;
  const rgba = c.startsWith("#") ? hexToRgba(c, a) : null;
  if (rgba) return rgba;
  const pct = Math.round(a * 100);
  return `color-mix(in srgb, ${c} ${pct}%, transparent)`;
}

interface ChoiceProps {
  step: MultipleChoiceUI | StepDefinition;
  stepData?: any;
  onChange: (data: any) => void;
  onAutoSubmit?: (data: any) => void;
  forceCompact?: boolean;
}

export function Choice({
  step,
  stepData,
  onChange,
  onAutoSubmit,
  forceCompact = false,
}: ChoiceProps) {
  const { theme } = useFormTheme();
  const density = useLayoutDensity();
  const isCompact = density === "compact" || forceCompact;

  // Handle both UIStep and StepDefinition
  const isUIStep = 'type' in step && !('componentType' in step);
  
  const rawOptions = isUIStep 
    ? (step as MultipleChoiceUI).options || []
    : ((step as StepDefinition).content?.options || (step as StepDefinition).data?.options || []);

  const allowOtherFlag = isUIStep
    ? Boolean(
        (step as any)?.allow_other ||
        (step as any)?.blueprint?.validation?.allow_other ||
        (step as any)?.blueprint?.validation?.show_other ||
        (step as any)?.show_other
      )
    : Boolean(
        (step as StepDefinition).data?.allowOther ||
        (step as StepDefinition).data?.showOther ||
        (step as any)?.blueprint?.validation?.allow_other ||
        (step as any)?.blueprint?.validation?.show_other
      );

  const hasOtherOption = useMemo(() => {
    const base = Array.isArray(rawOptions) ? rawOptions : [];
    return base.some((opt: any) => {
      const v = typeof opt === 'string' ? opt : String(opt.value || '').toLowerCase();
      const l = typeof opt === 'string' ? opt : String(opt.label || '').toLowerCase();
      return v === 'other' || l === 'other';
    });
  }, [rawOptions]);

  // If "Other" is present in options, always support a free-text field for it.
  const allowOther = allowOtherFlag || hasOtherOption;

  const otherLabel =
    (isUIStep ? (step as any)?.other_label : null) ||
    (isUIStep ? (step as any)?.blueprint?.validation?.other_label : null) ||
    (isUIStep ? (step as any)?.blueprint?.validation?.otherLabel : null) ||
    "Other";

  const otherPlaceholder =
    (isUIStep ? (step as any)?.other_placeholder : null) ||
    (isUIStep ? (step as any)?.blueprint?.validation?.other_placeholder : null) ||
    (isUIStep ? (step as any)?.blueprint?.validation?.otherPlaceholder : null) ||
    "Type your answer…";

  const otherRequiresText = Boolean(
    (isUIStep ? (step as any)?.other_requires_text : null) ||
      (isUIStep ? (step as any)?.blueprint?.validation?.other_requires_text : null) ||
      (isUIStep ? (step as any)?.blueprint?.validation?.otherRequiresText : null)
  );

  const options = useMemo(() => {
    const base = Array.isArray(rawOptions) ? rawOptions.slice() : [];
    if (!allowOther) return base;
    const hasOther = base.some((opt: any) => {
      const v = typeof opt === 'string' ? opt : String(opt.value || '').toLowerCase();
      const l = typeof opt === 'string' ? opt : String(opt.label || '').toLowerCase();
      return v === 'other' || l === 'other';
    });
    if (!hasOther) {
      base.push({ label: otherLabel, value: 'other' });
    }
    return base;
  }, [rawOptions, allowOther, otherLabel]);
    
  const multiple = isUIStep
    ? Boolean((step as any).multi_select ?? ((step as any).type === "chips_multi"))
    : Boolean((step as StepDefinition).data?.multiple || (step as StepDefinition).data?.multiSelect);

  const [selected, setSelected] = useState<any>(stepData ?? (multiple ? [] : null));
  const [otherText, setOtherText] = useState<string>("");

  useEffect(() => {
    if (stepData === undefined) return;
    const allOptionKeys = options.map((opt) => keyOf(opt));
    if (multiple) {
      const incoming = Array.isArray(stepData) ? stepData : [];
      const known = incoming.filter((v) => allOptionKeys.includes(String(v)));
      const unknown = incoming.find((v) => !allOptionKeys.includes(String(v)));
      if (allowOther && unknown && String(unknown).toLowerCase() !== "other") {
        setSelected([...known, "other"]);
        setOtherText(String(unknown));
      } else {
        setSelected(incoming);
        // If "other" is selected but no free-text value is present, treat it as AI-completable.
        setOtherText("");
      }
    } else {
      if (allowOther && stepData && !allOptionKeys.includes(String(stepData))) {
        setSelected("other");
        setOtherText(String(stepData));
      } else {
        setSelected(stepData);
        if (stepData === "other" || stepData === null || stepData === undefined) setOtherText("");
        else if (stepData !== "other") setOtherText("");
      }
    }
  }, [stepData, options, allowOther, multiple]);

  const keyOf = (opt: any): string => {
    if (typeof opt === 'string') return opt;
    return String(opt.value || opt.label || opt);
  };

  const labelOf = (opt: any): string => {
    if (typeof opt === 'string') return opt;
    return String(opt.label || opt.value || '');
  };

  const isSelected = (opt: any): boolean => {
    const key = keyOf(opt);
    if (multiple) {
      const current = Array.isArray(selected) ? selected : [];
      return current.includes(key);
    }
    return selected === key;
  };

  const handleSelect = (option: any) => {
    const key = keyOf(option);
    
    if (multiple) {
      const current = Array.isArray(selected) ? selected : [];
      const maxSel =
        isUIStep && Number.isFinite(Number((step as any)?.max_selections))
          ? Math.max(1, Math.floor(Number((step as any).max_selections)))
          : null;
      const next = current.includes(key)
        ? current.filter((o: any) => o !== key)
        : maxSel && current.length >= maxSel
          ? current // ignore additional picks past max
          : [...current, key];
      setSelected(next);
      const normalized = next.map((v: any) => v === "other" && allowOther && otherText ? otherText : v);
      onChange(normalized);
    } else {
      setSelected(key);
      // If user picks "Other" but leaves it blank, keep "other" so the AI/backend can follow up or infer.
      const normalized =
        key === "other" && allowOther
          ? otherRequiresText
            ? (otherText ? otherText : "other")
            : (otherText ? otherText : "other")
          : key;
      onChange(normalized);
      // Auto-submit for single-select if provided.
      // IMPORTANT: never auto-submit on "Other" click, otherwise the UI advances before the user can type.
      if (onAutoSubmit && key !== "other" && normalized !== null && normalized !== undefined && normalized !== '') {
        onAutoSubmit(normalized);
      }
    }
  };

  // Render pills (“rounded bubbles”) for ALL multiple-choice UIs.
  // The user prefers the rounded multi-select buttons, so keep it consistent across
  // single-select + multi-select (avoid mixing grids/cards vs pills).
  const prefersPills = true;

  if (prefersPills) {
    const primary = theme.primaryColor || "var(--form-primary-color)";
    const secondary = theme.secondaryColor || theme.primaryColor || "var(--form-secondary-color)";
    const unpickedBg = withAlpha(secondary, 0.14);
    const unpickedBorder = withAlpha(primary, 0.28);
    const unpickedHoverBg = withAlpha(secondary, 0.22);
    const focusRing = withAlpha(primary, 0.35);

    return (
      <div
        className={cn(
          isCompact
            ? "w-full max-w-none overflow-x-hidden overflow-y-visible py-0.5 text-center"
            : "space-y-2.5"
        )}
      >
        <div
          className={cn(
            isCompact
              ? "flex w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-2 px-1"
              : "flex flex-wrap items-center justify-center gap-1.5 sm:gap-2"
          )}
        >
          {options.map((option: string | UIOption, index: number) => {
            const picked = isSelected(option);
            const label = labelOf(option);
            const key = keyOf(option);
            const isOther = key === "other";

            // When "Other" is selected, render inline input instead of pill + pop-out
            if (isOther && picked && allowOther) {
              return (
                <input
                  key={`other-input-${index}`}
                  type="text"
                  value={otherText}
                  onChange={(e) => {
                    const next = e.target.value;
                    setOtherText(next);
                    if (multiple) {
                      const current = Array.isArray(selected) ? selected : [];
                      const normalized = current.map((v: any) => v === "other" && allowOther && next ? next : v);
                      onChange(normalized);
                    } else {
                      const normalized = selected === "other" && allowOther ? (next ? next : "other") : selected;
                      onChange(normalized);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      handleSelect({ value: "other" }); // Toggle off
                      return;
                    }
                    if (!onAutoSubmit) return;
                    if (multiple) return;
                    if (e.key !== "Enter") return;
                    if (otherRequiresText && !otherText.trim()) return;
                    const normalized = otherText ? otherText : "other";
                    onAutoSubmit(normalized);
                  }}
                  onBlur={() => {
                    // Optional: deselect other if empty and user clicks away
                  }}
                  placeholder={otherPlaceholder}
                  autoFocus
                  className={cn(
                    "inline-flex shrink-0 min-w-[120px] max-w-[200px] overflow-hidden whitespace-nowrap rounded-full border-2 px-3 text-sm font-semibold leading-none transition-all",
                    "focus:outline-none focus:ring-2 focus:ring-offset-1",
                    isCompact
                      ? "h-7 px-2 text-[11px] sm:h-8 sm:px-2.5"
                      : "min-h-9 text-[12px] sm:min-h-10 sm:text-[13px]"
                  )}
                  style={{
                    fontFamily: theme.fontFamily,
                    borderRadius: `${Math.max(theme.borderRadius || 10, 9999)}px`,
                    backgroundColor: "var(--form-surface-color, #fff)",
                    borderColor: primary,
                    color: theme.textColor || "var(--form-text-color)",
                    ...(isCompact ? { fontSize: "clamp(0.68rem, 1.02vh, 0.8rem)", lineHeight: 1 } : null),
                  }}
                />
              );
            }

            return (
              <button
                key={`${key}-${index}`}
                onClick={() => handleSelect(option)}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full border font-semibold leading-none transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                  "shadow-sm hover:shadow",
                  isCompact
                    ? "h-7 gap-1 overflow-hidden px-2 shadow-none hover:shadow-none sm:h-8 sm:px-2.5"
                    : "px-3 py-1.5 text-[12px] min-h-9 sm:px-4 sm:py-2 sm:text-[13px] sm:min-h-10",
                  picked
                    ? "bg-primary text-white border-primary shadow-sm"
                    : "text-[color:var(--form-text-color)]"
                )}
                style={{
                  fontFamily: theme.fontFamily,
                  borderRadius: `${Math.max(theme.borderRadius || 10, 9999)}px`,
                  backgroundColor: picked ? primary : unpickedBg,
                  borderColor: picked ? primary : unpickedBorder,
                  color: picked ? "#ffffff" : (theme.textColor || "var(--form-text-color)"),
                  ...(picked
                    ? {}
                    : ({
                        ["--choice-hover-bg" as any]: unpickedHoverBg,
                        ["--choice-focus" as any]: focusRing,
                      } as any)),
                  ...(isCompact ? { fontSize: "clamp(0.68rem, 1.02vh, 0.8rem)", lineHeight: 1 } : null),
                }}
                onMouseEnter={(e) => {
                  if (picked) return;
                  try {
                    (e.currentTarget as any).style.backgroundColor = unpickedHoverBg;
                  } catch {}
                }}
                onMouseLeave={(e) => {
                  if (picked) return;
                  try {
                    (e.currentTarget as any).style.backgroundColor = unpickedBg;
                  } catch {}
                }}
              >
                {picked && !isOther && <Check className={cn(isCompact ? "h-2 w-2 shrink-0" : "h-3.5 w-3.5")} strokeWidth={2.5} />}
                <span className={cn(isCompact ? "block truncate leading-none" : undefined)}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Unreachable (kept as a safeguard / future toggle).
  return null;
}
