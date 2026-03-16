"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFormTheme } from "../../demo/FormThemeProvider";
import { useLayoutDensity } from "./layout-density";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface StepLayoutProps {
  step: any;
  children: React.ReactNode;
  onComplete: () => void;
  onBack?: () => void;
  canGoBack?: boolean;
  isLoading?: boolean;
  canContinue?: boolean;
  continueLabel?: string;
  className?: string;
  actionsVariant?: "default" | "sticky_mobile" | "icon_only";
  feedbackPrompt?: React.ReactNode;
  headerInlineControl?: React.ReactNode;
  compactInPreview?: boolean;
  /** When true and preview is not showing, use a wider max-width for more real estate (e.g. image grids) */
  preferWideLayout?: boolean;
}

function getQuestion(step: any): string {
  return (
    String(step?.question || "").trim() ||
    String(step?.copy?.headline || "").trim() ||
    String(step?.content?.prompt || "").trim() ||
    "Tell us a bit more"
  );
}

function getSubtext(step: any): string {
  return (
    String(step?.humanism || "").trim() ||
    String(step?.copy?.subtext || "").trim() ||
    String(step?.subtext || "").trim() ||
    String(step?.content?.subtext || "").trim()
  );
}

export function StepLayout({
  step,
  children,
  onComplete,
  onBack,
  canGoBack = false,
  isLoading = false,
  canContinue = true,
  continueLabel,
  className,
  actionsVariant = "default",
  feedbackPrompt,
  headerInlineControl,
  compactInPreview = false,
  preferWideLayout = false,
}: StepLayoutProps) {
  const { theme } = useFormTheme();
  const density = useLayoutDensity();
  const isCompact = density === "compact";
  const useCompactPane = compactInPreview;
  const question = getQuestion(step);
  const subtext = getSubtext(step);
  const resolvedContinueLabel = continueLabel || step?.blueprint?.presentation?.continue_label || "Continue";
  const disableContinue = Boolean(isLoading || !canContinue);
  const actionButtonClass = "h-9 min-w-[88px] px-3 text-xs font-medium shrink-0";
  const iconButtonClass = "h-8 w-10 p-0 rounded-full";
  const sideNavButtonClass = useCompactPane
    ? "h-[52%] min-h-[68px] max-h-[120px] w-12 sm:w-14 rounded-xl p-0"
    : "h-[50%] min-h-[56px] max-h-[100px] w-11 sm:w-12 rounded-lg p-0";
  const compactActionButtonClass = "h-8 min-w-[80px] px-2.5 text-[11px]";
  const compactHeaderLayoutClass = useCompactPane
    ? "flex flex-col items-center gap-1.5 text-center"
    : headerInlineControl
      ? "flex items-start justify-between gap-2"
      : undefined;
  const contentViewportClassName = cn(
    "flex-1 min-h-0 w-full",
    actionsVariant !== "icon_only"
      ? "overflow-y-auto overflow-x-hidden"
      : "overflow-hidden",
    useCompactPane ? "rounded-lg [scrollbar-gutter:stable]" : "pr-0.5 sm:pr-1",
    useCompactPane ? "flex flex-col items-center" : null
  );

  return (
    <div
      className={cn(
        "w-full mx-auto h-full min-h-0 overflow-hidden",
        useCompactPane ? "max-w-[70rem]" : preferWideLayout ? "max-w-6xl" : "max-w-3xl",
        useCompactPane ? "px-1.5 py-1.5 sm:px-2.5 sm:py-2" : isCompact ? "px-4 py-4" : "px-4 py-6",
        className
      )}
    >
      {actionsVariant === "icon_only" ? (
        <div
          className={cn(
            "grid h-full min-h-0",
            useCompactPane ? "grid-cols-[auto,minmax(0,1fr),auto] items-stretch gap-2.5" : "grid-cols-[auto,minmax(0,1fr),auto] items-stretch gap-3"
          )}
        >
          {canGoBack && onBack ? (
            <Button
              type="button"
              onClick={onBack}
              variant="outline"
              className={cn(iconButtonClass, sideNavButtonClass, "shrink-0 self-center")}
              style={{
                borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.14))",
                color: theme.textColor,
                fontFamily: theme.fontFamily,
              }}
              aria-label="Go back"
            >
              <ArrowLeft className={cn(useCompactPane ? "h-4 w-4" : "h-3.5 w-3.5")} />
            </Button>
          ) : (
            <div className={cn(sideNavButtonClass, "shrink-0 self-center")} aria-hidden="true" />
          )}
          <div
            className={cn(
              "min-w-0 min-h-0 flex flex-col overflow-hidden",
              useCompactPane ? "justify-end gap-1.5" : isCompact ? "gap-4" : "gap-6"
            )}
          >
            <div className={cn("shrink-0", compactHeaderLayoutClass)}>
              {headerInlineControl ? <div className="shrink-0">{headerInlineControl}</div> : null}
              <div
                className={cn(
                  "min-w-0 flex-1",
                  useCompactPane ? "w-full max-w-5xl mx-auto text-center" : null
                )}
              >
                <h2
                  className={cn(
                    useCompactPane ? "text-[13px] sm:text-sm leading-tight" : isCompact ? "text-xl" : "text-2xl",
                    "font-semibold min-w-0 break-words",
                    useCompactPane ? "text-center" : null
                  )}
                  style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                >
                  {question}
                </h2>
                {subtext ? (
                  <p
                    className={cn(
                      "mt-1 opacity-80",
                      useCompactPane ? "text-[10px] leading-tight line-clamp-2 text-center" : "text-sm"
                    )}
                    style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                  >
                    {subtext}
                  </p>
                ) : null}
              </div>
            </div>
            {feedbackPrompt ? <div className={cn("shrink-0", useCompactPane ? "mt-1" : "mt-3")}>{feedbackPrompt}</div> : null}
            <div className={contentViewportClassName}>
              <div
                className={cn(
                  "flex min-h-full min-w-0 flex-col overflow-hidden",
                  useCompactPane ? "w-full max-w-5xl mx-auto justify-end" : "justify-start"
                )}
              >
                {children}
              </div>
            </div>
          </div>
          <Button
            type="button"
            onClick={onComplete}
            disabled={disableContinue}
            variant="outline"
            className={cn(iconButtonClass, sideNavButtonClass, "shrink-0 self-center")}
            style={{
              borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.14))",
              color: theme.textColor,
              fontFamily: theme.fontFamily,
            }}
            aria-label={isLoading ? "Loading" : resolvedContinueLabel}
          >
            <ArrowRight className={cn(useCompactPane ? "h-4 w-4" : "h-3.5 w-3.5")} />
          </Button>
        </div>
      ) : (
          <div className={cn("flex h-full min-h-0 flex-col", useCompactPane ? "gap-2 justify-end" : isCompact ? "gap-4" : "gap-6")}>
            <div className={cn("shrink-0", compactHeaderLayoutClass, useCompactPane ? "w-full max-w-5xl mx-auto" : null)}>
              {headerInlineControl ? <div className="shrink-0">{headerInlineControl}</div> : null}
              <div className={cn("min-w-0 flex-1", useCompactPane ? "w-full text-center" : null)}>
              <h2
                className={cn(
                  useCompactPane ? "text-sm sm:text-base leading-tight" : isCompact ? "text-xl" : "text-2xl",
                  "font-semibold min-w-0 break-words",
                  useCompactPane ? "text-center" : null
                )}
                style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
              >
                {question}
              </h2>
              {subtext ? (
                <p
                  className={cn(
                    "mt-1 opacity-80",
                    useCompactPane ? "text-[11px] sm:text-xs leading-tight text-center" : "text-sm"
                  )}
                  style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                >
                  {subtext}
                </p>
              ) : null}
            </div>
          </div>
          {feedbackPrompt ? <div className="shrink-0">{feedbackPrompt}</div> : null}

          <div className={contentViewportClassName}>
            <div
              className={cn(
                "flex min-h-full min-w-0 flex-col overflow-hidden",
                useCompactPane ? "w-full max-w-5xl mx-auto justify-end" : "justify-start"
              )}
            >
              {children}
            </div>
          </div>

          <div
            className={cn(
              "flex min-w-0 justify-center gap-2.5 shrink-0",
              useCompactPane ? "mt-auto pt-1" : null,
              actionsVariant === "sticky_mobile"
                ? "sticky bottom-2 z-10 rounded-xl border p-2 bg-[var(--form-surface-color)] border-[color:var(--form-surface-border-color)]"
                : null
            )}
          >
            {canGoBack && onBack ? (
              <Button
                type="button"
                onClick={onBack}
                variant="outline"
                className={cn(actionButtonClass, useCompactPane ? compactActionButtonClass : null)}
                style={{
                  borderColor: theme.primaryColor,
                  color: theme.primaryColor,
                  fontFamily: theme.fontFamily,
                  borderRadius: `${theme.borderRadius}px`,
                }}
              >
                Back
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={onComplete}
              disabled={disableContinue}
                className={cn(actionButtonClass, useCompactPane ? compactActionButtonClass : null)}
              style={{
                backgroundColor: theme.buttonStyle?.backgroundColor || theme.primaryColor,
                color: theme.buttonStyle?.textColor || "#ffffff",
                fontFamily: theme.fontFamily,
                borderRadius: `${theme.borderRadius}px`,
              }}
            >
              {isLoading ? "Loading..." : resolvedContinueLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
