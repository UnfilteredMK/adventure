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
  className?: string;
}

export function PreviewIdeasChips({
  suggestions,
  loading,
  onApply,
  onRequestLeadGate,
  compact = true,
  className,
}: PreviewIdeasChipsProps) {
  const { theme } = useFormTheme();
  const primary = theme.primaryColor || "var(--form-primary-color)";
  const secondary = theme.secondaryColor || theme.primaryColor || "var(--form-secondary-color)";
  const unpickedBg = withAlpha(secondary, 0.14);
  const unpickedBorder = withAlpha(primary, 0.28);
  const unpickedHoverBg = withAlpha(secondary, 0.22);
  const focusRing = withAlpha(primary, 0.35);

  return (
    <div className={cn("flex min-h-0 w-full min-w-0 flex-col overflow-hidden", className)}>
      <p
        className={cn(
          "mb-2 text-center font-semibold leading-tight",
          compact ? "text-xs sm:text-sm" : "text-sm sm:text-base"
        )}
        style={{ fontFamily: theme.fontFamily, color: theme.textColor || "var(--form-text-color)" }}
      >
        ✨ AI ideas for this design
      </p>

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          Loading ideas…
        </div>
      ) : suggestions.length === 0 ? (
        <div className="py-5 text-center text-[11px] text-muted-foreground">No ideas yet. Connect prompts to your catalog.</div>
      ) : (
        <div
          className={cn(
            compact
              ? "w-full max-w-none py-1 text-center"
              : "w-full py-1"
          )}
        >
          <div
            className={cn(
              compact
                ? "flex w-full flex-wrap items-center justify-center gap-2 px-0.5 sm:gap-2.5"
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
                    "inline-flex items-center justify-center rounded-full border font-semibold transition-all",
                    "text-center text-[color:var(--form-text-color)] shadow-sm hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                    compact
                      ? "min-h-9 max-w-[min(100%,18rem)] gap-1.5 px-3.5 py-2.5 shadow-none hover:shadow-none sm:min-h-10 sm:px-4 sm:py-3"
                      : "min-h-10 max-w-[min(100%,20rem)] px-4 py-2.5 text-[13px] sm:min-h-11 sm:px-5 sm:py-3 sm:text-sm"
                  )}
                  style={{
                    fontFamily: theme.fontFamily,
                    borderRadius: `${Math.max(theme.borderRadius || 10, 9999)}px`,
                    backgroundColor: unpickedBg,
                    borderColor: unpickedBorder,
                    color: theme.textColor || "var(--form-text-color)",
                    ...(compact
                      ? { fontSize: "clamp(0.78rem, 1.15vh, 0.9rem)", lineHeight: 1.35 }
                      : null),
                    ...( {
                      ["--choice-hover-bg" as any]: unpickedHoverBg,
                      ["--choice-focus" as any]: focusRing,
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
                  <span className="block min-w-0 whitespace-normal break-words text-center leading-snug">
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
