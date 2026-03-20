"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFormTheme } from "../../demo/FormThemeProvider";
import { useLayoutDensity } from "./layout-density";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { layoutDebugClassName, withLayoutDebugStyle } from "../runtime/step-engine/debug-layout";

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
  layoutDebugEnabled?: boolean;
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
  layoutDebugEnabled = false,
}: StepLayoutProps) {
  const { theme } = useFormTheme();
  const density = useLayoutDensity();
  const isCompact = density === "compact";
  const useCompactPane = compactInPreview;
  const useCompactHeaderControlRow = Boolean(useCompactPane && headerInlineControl);
  const stepType = String(step?.type || step?.componentType || "").toLowerCase();
  const isVisualAnswerStep = stepType === "image_choice_grid" || stepType === "gallery";
  const isSliderStep = stepType === "slider";
  const isUploadStep = stepType === "file_upload" || stepType === "upload" || stepType === "file_picker";
  const isChoiceStep =
    stepType === "multiple_choice" ||
    stepType === "choice" ||
    stepType === "yes_no" ||
    stepType === "segmented_choice" ||
    stepType === "chips_multi";
  const compactRowsClass = useCompactHeaderControlRow
    ? "grid-rows-[auto_auto_minmax(0,1fr)]"
    : useCompactPane
      ? "grid-rows-[auto_minmax(0,1fr)]"
      : null;
  const compactQuestionFontSize = isVisualAnswerStep ? "clamp(1rem, 2vh, 1.28rem)" : "clamp(1rem, 2.1vh, 1.35rem)";
  const compactSubtextFontSize = isVisualAnswerStep ? "clamp(0.74rem, 1.2vh, 0.9rem)" : "clamp(0.82rem, 1.45vh, 0.98rem)";
  const compactQuestionRowClass = useCompactPane ? "min-h-0 h-full min-w-0 overflow-visible px-2 py-1" : "shrink-0 min-w-0";
  const compactHeaderControlRowClass =
    "row-start-1 min-h-0 h-full min-w-0 overflow-visible grid grid-cols-[1fr_auto_1fr] items-center gap-1 px-1";
  const compactAnswerViewportClass = useCompactPane
    ? isVisualAnswerStep
      ? "h-full min-h-0 px-1 py-0"
      : isChoiceStep
        ? "h-full min-h-0 px-0 py-0"
        : "h-full min-h-0 px-2 py-1"
    : null;
  const question = getQuestion(step);
  const subtext = getSubtext(step);
  const showCompactSubtext = !(useCompactPane && (isSliderStep || isUploadStep));
  const resolvedContinueLabel = continueLabel || step?.blueprint?.presentation?.continue_label || "Continue";
  const disableContinue = Boolean(isLoading || !canContinue);
  const actionButtonClass = "h-9 min-w-[88px] px-3 text-xs font-medium shrink-0";
  const iconButtonClass = "h-8 w-10 p-0 rounded-full";
  const sideNavButtonClass = useCompactPane
    ? "h-[48%] min-h-[52px] max-h-[100px] w-10 sm:w-12 rounded-xl p-0"
    : "h-[50%] min-h-[56px] max-h-[100px] w-11 sm:w-12 rounded-lg p-0";
  const compactActionButtonClass = "h-8 min-w-[80px] px-2.5 text-[11px]";
  const compactHeaderLayoutClass = useCompactPane
    ? "flex h-full min-h-0 flex-col items-center justify-center gap-0 text-center"
    : headerInlineControl
      ? "flex items-start justify-between gap-0"
      : undefined;
  const compactInnerStackClass = "gap-0";
  const standardInnerStackClass = "gap-0";
  const contentViewportClassName = cn(
    "flex-1 min-h-0 w-full min-w-0",
    useCompactPane && (isVisualAnswerStep || isChoiceStep)
      ? "overflow-hidden"
      : useCompactPane && isSliderStep
        ? "overflow-visible"
        : "overflow-y-auto overflow-x-hidden",
    useCompactPane ? "rounded-lg [scrollbar-gutter:stable]" : "pr-0.5 sm:pr-1",
    useCompactPane
      ? isVisualAnswerStep || isChoiceStep
        ? "flex flex-col items-stretch"
        : "flex flex-col items-center"
      : null
  );
  const compactAnswerInnerClass = cn(
    "flex h-full min-h-0 min-w-0 flex-col",
    useCompactPane
      ? isVisualAnswerStep
        ? "mx-auto w-full max-w-none justify-start overflow-hidden"
        : isSliderStep
          ? "mx-auto w-full max-w-none justify-start overflow-visible"
        : isChoiceStep
          ? "w-full max-w-none justify-start overflow-hidden"
          : "mx-auto w-full max-w-none justify-center overflow-hidden"
      : "justify-start overflow-hidden"
  );

  return (
    <div
      className={layoutDebugClassName(
        layoutDebugEnabled,
        cn(
          "relative mx-auto h-full min-h-0 w-full overflow-hidden",
          useCompactPane ? "max-w-none" : preferWideLayout ? "max-w-6xl" : "max-w-3xl",
          "p-0",
          className
        )
      )}
    >
      {feedbackPrompt && !useCompactHeaderControlRow ? (
        <div className="pointer-events-auto absolute right-2 top-2 z-10">{feedbackPrompt}</div>
      ) : null}

      {actionsVariant === "icon_only" ? (
        <div
          className={layoutDebugClassName(
            layoutDebugEnabled,
            cn(
              "grid h-full min-h-0",
              useCompactPane ? "grid-cols-[auto,minmax(0,1fr),auto] items-stretch gap-0" : "grid-cols-[auto,minmax(0,1fr),auto] items-stretch gap-3"
            )
          )}
        >
          {canGoBack && onBack ? (
            <Button
              type="button"
              onClick={onBack}
              variant="outline"
              className={cn(iconButtonClass, sideNavButtonClass, "shrink-0 self-center")}
              style={{
                ...withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet"),
                borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.14))",
                color: theme.textColor,
                fontFamily: theme.fontFamily,
              }}
              aria-label="Go back"
            >
              <ArrowLeft className={cn(useCompactPane ? "h-4 w-4" : "h-3.5 w-3.5")} />
            </Button>
          ) : (
            <div
              className={cn(sideNavButtonClass, "shrink-0 self-center")}
              style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
              aria-hidden="true"
            />
          )}

          <div
            className={layoutDebugClassName(
              layoutDebugEnabled,
              cn(
                "min-w-0 min-h-0 overflow-hidden",
                compactRowsClass ? `grid ${compactRowsClass}` : "flex flex-col",
                compactInnerStackClass
              )
            )}
            style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneParent")}
          >
            <div
              className={layoutDebugClassName(
                layoutDebugEnabled,
                cn(
                  compactQuestionRowClass,
                  useCompactHeaderControlRow ? "row-start-2" : null,
                  feedbackPrompt && !useCompactHeaderControlRow ? "pr-14" : null
                )
              )}
              style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "sky")}
            >
              <div
                className={layoutDebugClassName(
                  layoutDebugEnabled,
                  cn(
                    "min-w-0 w-full",
                    useCompactPane ? "h-full min-h-0" : null,
                    compactHeaderLayoutClass,
                    useCompactPane ? (isChoiceStep ? "mx-auto max-w-4xl" : "max-w-none mx-auto") : null
                  )
                )}
                style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneQuestion")}
              >
                {headerInlineControl && !useCompactHeaderControlRow ? (
                  <div
                    className={layoutDebugClassName(layoutDebugEnabled, "shrink-0")}
                    style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber")}
                  >
                    {headerInlineControl}
                  </div>
                ) : null}
                <h2
                  className={cn(
                    useCompactPane ? (isVisualAnswerStep ? "leading-tight line-clamp-1 text-center" : "leading-tight text-center") : isCompact ? "text-xl" : "text-2xl",
                    "font-semibold min-w-0 break-words"
                  )}
                  style={{
                    color: theme.textColor,
                    fontFamily: theme.fontFamily,
                    ...(useCompactPane ? { fontSize: compactQuestionFontSize } : null),
                  }}
                >
                  {question}
                </h2>
                {subtext && showCompactSubtext ? (
                  <p
                    className={cn(
                      "opacity-80",
                      useCompactPane
                        ? isVisualAnswerStep ? "mt-0 leading-tight line-clamp-1 text-center" : "mt-0 leading-tight line-clamp-2 text-center"
                        : "mt-0 text-sm"
                    )}
                    style={{
                      ...withLayoutDebugStyle(undefined, layoutDebugEnabled, "sky"),
                      color: theme.textColor,
                      fontFamily: theme.fontFamily,
                      ...(useCompactPane ? { fontSize: compactSubtextFontSize } : null),
                    }}
                  >
                    {subtext}
                  </p>
                ) : null}
              </div>
            </div>

            {useCompactHeaderControlRow ? (
              <div
                className={layoutDebugClassName(layoutDebugEnabled, compactHeaderControlRowClass)}
                style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber")}
              >
                <div aria-hidden="true" />
                <div className="col-start-2 flex h-full min-w-0 items-center justify-center">{headerInlineControl}</div>
                {feedbackPrompt ? <div className="col-start-3 flex min-w-0 items-center justify-end">{feedbackPrompt}</div> : null}
              </div>
            ) : null}

            <div
              className={layoutDebugClassName(
                layoutDebugEnabled,
                cn(contentViewportClassName, compactAnswerViewportClass, useCompactHeaderControlRow ? "row-start-3" : null)
              )}
              style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneAnswer")}
            >
              <div className={layoutDebugClassName(layoutDebugEnabled, compactAnswerInnerClass)}>{children}</div>
            </div>
          </div>

          <Button
            type="button"
            onClick={onComplete}
            disabled={disableContinue}
            variant="outline"
            className={cn(iconButtonClass, sideNavButtonClass, "shrink-0 self-center")}
            style={{
              ...withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet"),
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
        <div
          className={layoutDebugClassName(
            layoutDebugEnabled,
            cn(
              compactRowsClass ? `grid h-full min-h-0 ${compactRowsClass} overflow-hidden` : "flex h-full min-h-0 flex-col",
              standardInnerStackClass
            )
          )}
          style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneParent")}
        >
          <div
            className={layoutDebugClassName(
              layoutDebugEnabled,
              cn(
                compactQuestionRowClass,
                useCompactHeaderControlRow ? "row-start-2" : null,
                feedbackPrompt && !useCompactHeaderControlRow ? "pr-14" : null
              )
            )}
            style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "sky")}
          >
            <div
              className={layoutDebugClassName(
                layoutDebugEnabled,
                cn(
                  "min-w-0 w-full",
                  useCompactPane ? "h-full min-h-0" : null,
                  compactHeaderLayoutClass,
                  useCompactPane ? (isChoiceStep ? "mx-auto max-w-4xl" : "max-w-none mx-auto") : null
                )
              )}
              style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneQuestion")}
            >
              {headerInlineControl && !useCompactHeaderControlRow ? (
                <div
                  className={layoutDebugClassName(layoutDebugEnabled, "shrink-0")}
                  style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber")}
                >
                  {headerInlineControl}
                </div>
              ) : null}
              <h2
                className={cn(
                  useCompactPane ? (isVisualAnswerStep ? "leading-tight line-clamp-1 text-center" : "leading-tight text-center") : isCompact ? "text-xl" : "text-2xl",
                  "font-semibold min-w-0 break-words"
                )}
                style={{
                  color: theme.textColor,
                  fontFamily: theme.fontFamily,
                  ...(useCompactPane ? { fontSize: compactQuestionFontSize } : null),
                }}
              >
                {question}
              </h2>
                {subtext && showCompactSubtext ? (
                  <p
                  className={cn(
                    "opacity-80",
                    useCompactPane
                      ? isVisualAnswerStep ? "mt-0 leading-tight line-clamp-1 text-center" : "mt-0 leading-tight text-center"
                      : "mt-0 text-sm"
                  )}
                  style={{
                    ...withLayoutDebugStyle(undefined, layoutDebugEnabled, "sky"),
                    color: theme.textColor,
                    fontFamily: theme.fontFamily,
                    ...(useCompactPane ? { fontSize: compactSubtextFontSize } : null),
                  }}
                >
                  {subtext}
                </p>
              ) : null}
            </div>
          </div>

          {useCompactHeaderControlRow ? (
            <div
              className={layoutDebugClassName(layoutDebugEnabled, compactHeaderControlRowClass)}
              style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber")}
            >
              <div aria-hidden="true" />
              <div className="col-start-2 flex h-full min-w-0 items-center justify-center">{headerInlineControl}</div>
              {feedbackPrompt ? <div className="col-start-3 flex min-w-0 items-center justify-end">{feedbackPrompt}</div> : null}
            </div>
          ) : null}

          <div
            className={layoutDebugClassName(
              layoutDebugEnabled,
              cn(contentViewportClassName, compactAnswerViewportClass, useCompactHeaderControlRow ? "row-start-3" : null)
            )}
            style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneAnswer")}
          >
            <div className={layoutDebugClassName(layoutDebugEnabled, compactAnswerInnerClass)}>{children}</div>
          </div>

          <div
            className={layoutDebugClassName(
              layoutDebugEnabled,
              cn(
                "flex min-w-0 shrink-0 justify-center gap-2.5",
                useCompactPane ? "mt-auto pt-1" : null,
                actionsVariant === "sticky_mobile"
                  ? "sticky bottom-2 z-10 rounded-xl border border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)] p-2"
                  : null
              )
            )}
            style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
          >
            {canGoBack && onBack ? (
              <Button
                type="button"
                onClick={onBack}
                variant="outline"
                className={cn(actionButtonClass, useCompactPane ? compactActionButtonClass : null)}
                style={{
                  ...withLayoutDebugStyle(undefined, layoutDebugEnabled, "rose"),
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
                ...withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet"),
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
