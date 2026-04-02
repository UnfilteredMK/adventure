"use client";

/**
 * Compact idea chips — visual parity with MultipleChoiceStep + ChoiceControl `forceCompact` / preview mode:
 * horizontal pill row, theme-matched borders, small type.
 */
import React from "react";
import type { Suggestion } from "@/types";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormTheme } from "../../demo/FormThemeProvider";

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

export interface PreviewIdeasChipsProps {
  suggestions: Suggestion[];
  loading: boolean;
  onApply: (suggestion: Suggestion) => void;
  /**
   * When set, chip taps call this instead of `onApply` (e.g. open the preview lead gate, then user can pick an idea again).
   */
  onRequestLeadGate?: () => void;
  /** Same idea as MultipleChoiceStep `compactInPreview` / Choice `forceCompact`. */
  compact?: boolean;
  /** When false (preview lead modal not done), chips use neutral grey instead of theme primary. */
  leadComplete?: boolean;
  className?: string;
}

export function PreviewIdeasChips({
  suggestions,
  loading,
  onApply,
  onRequestLeadGate,
  compact = true,
  leadComplete = true,
  className,
}: PreviewIdeasChipsProps) {
  const { theme } = useFormTheme();
  const primary = theme.primaryColor || "var(--form-primary-color)";
  /** Hollow pills: primary for border + label when lead done; neutral grey until then. */
  const unpickedBg = "transparent";
  const unpickedBorder = leadComplete ? withAlpha(primary, 0.52) : "rgba(100, 116, 139, 0.48)";
  const unpickedHoverBg = leadComplete ? withAlpha(primary, 0.1) : "rgba(100, 116, 139, 0.12)";
  const focusRing = leadComplete ? withAlpha(primary, 0.32) : "rgba(100, 116, 139, 0.35)";
  const labelColor = leadComplete ? primary : "rgb(100, 116, 139)";

  // Compact layout mirrors `Choice` + MultipleChoiceStep `compactInPreview`: same scroll strip + pill row classes.
  return (
    <div className={cn("flex min-h-0 w-full min-w-0 flex-col overflow-hidden", className)}>
      {loading ? (
        <div className="flex shrink-0 items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          Loading ideas…
        </div>
      ) : suggestions.length === 0 ? (
        <div className="shrink-0 py-4 text-center text-[11px] text-muted-foreground">
          No ideas yet. Connect prompts to your catalog.
        </div>
      ) : (
        <div
          className={cn(
            compact
              ? "w-full max-w-none overflow-x-auto overflow-y-hidden py-1 text-center [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              : "w-full space-y-2.5"
          )}
          style={
            compact
              ? ({
                  WebkitOverflowScrolling: "touch",
                  touchAction: "pan-x",
                } as React.CSSProperties)
              : undefined
          }
        >
          <div
            className={cn(
              compact
                ? "inline-flex min-w-max flex-nowrap items-center justify-center gap-1.5 px-1"
                : "flex flex-wrap items-center justify-center gap-2 sm:gap-2.5"
            )}
          >
            {suggestions.map((sug, idx) => {
              const gateHint = onRequestLeadGate ? "Tap to unlock pricing and design tools" : undefined;
              return (
                <button
                  key={sug.promptId ? `${sug.promptId}-${idx}` : `${sug.text}-${idx}`}
                  type="button"
                  title={gateHint}
                  onClick={() => {
                    if (onRequestLeadGate) {
                      onRequestLeadGate();
                      return;
                    }
                    onApply(sug);
                  }}
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full border font-medium leading-none tracking-tight transition-[background-color,border-color] duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                    "overflow-hidden border-[0.5px]",
                    compact ? "max-w-[min(100%,17rem)]" : "max-w-[min(100%,21rem)]",
                    compact
                      ? "h-8 gap-1.5 px-3 shadow-none hover:shadow-none sm:h-9 sm:px-3.5"
                      : "min-h-10 px-3.5 py-2 text-[13px] shadow-none hover:shadow-none sm:min-h-11 sm:px-4 sm:py-2 sm:text-[14px]"
                  )}
                  style={{
                    fontFamily: theme.fontFamily,
                    borderRadius: `${Math.max(theme.borderRadius || 10, 9999)}px`,
                    backgroundColor: unpickedBg,
                    borderColor: unpickedBorder,
                    color: labelColor,
                    ...(compact
                      ? { fontSize: "clamp(0.75rem, 1.12vh, 0.9rem)", lineHeight: 1.15 }
                      : { lineHeight: 1.25 }),
                    ...( {
                      ["--tw-ring-color" as any]: focusRing,
                    } as any),
                  }}
                  onMouseEnter={(e) => {
                    try {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = unpickedHoverBg;
                    } catch {}
                  }}
                  onMouseLeave={(e) => {
                    try {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor = unpickedBg;
                    } catch {}
                  }}
                >
                  <span
                    className={cn(
                      "min-h-0 min-w-0 max-w-full truncate",
                      compact ? "text-center" : "text-left"
                    )}
                  >
                    {sug.suggestionLabel?.trim() || sug.text}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
