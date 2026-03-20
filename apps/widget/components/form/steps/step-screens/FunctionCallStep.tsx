"use client";

import React, { useMemo } from "react";
import type { StepDefinition, UIStep } from "@/types/ai-form";
import { useFormTheme } from "../../demo/FormThemeProvider";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { layoutDebugClassName, withLayoutDebugStyle } from "../runtime/step-engine/debug-layout";

type FunctionCallOutput =
  | {
      status: "idle" | "running" | "complete" | "error";
      startedAt?: number | null;
      completedAt?: number | null;
      error?: string | null;
      result?: unknown;
    }
  | null
  | undefined;

function getOutputForStep(allStepData: Record<string, any>, stepId: string): FunctionCallOutput {
  const outputs = allStepData?.__functionCallOutputs;
  if (!outputs || typeof outputs !== "object") return null;
  return (outputs as any)?.[stepId] ?? null;
}

function extractImages(result: unknown): string[] {
  if (!result) return [];
  const r = result as any;
  if (typeof r?.image === "string" && r.image) return [r.image];
  if (Array.isArray(r?.images)) return r.images.filter((x: any) => typeof x === "string" && x);
  if (typeof r === "string") return r ? [r] : [];
  return [];
}

interface FunctionCallStepProps {
  step: StepDefinition | UIStep;
  stepData?: any;
  onComplete: (data: any) => void;
  onBack?: () => void;
  canGoBack: boolean;
  isLoading: boolean;
  allStepData?: Record<string, any>;
  actionsVariant?: "default" | "sticky_mobile" | "icon_only";
  headerInlineControl?: React.ReactNode;
  compactInPreview?: boolean;
  layoutDebugEnabled?: boolean;
}

export function FunctionCallStep({
  step,
  onComplete,
  onBack,
  canGoBack,
  isLoading,
  allStepData = {},
  actionsVariant,
  headerInlineControl,
  compactInPreview = false,
  layoutDebugEnabled = false,
}: FunctionCallStepProps) {
  const { theme } = useFormTheme();
  const stepId = (step as any)?.id as string;
  const question = (step as any)?.question ?? (step as any)?.content?.prompt ?? "Generating…";

  const output = useMemo(() => getOutputForStep(allStepData, stepId), [allStepData, stepId]);
  const status = output?.status ?? "idle";
  const images = useMemo(() => extractImages(output?.result), [output?.result]);
  const actionButtonClass = "h-9 min-w-[88px] px-3 text-xs font-semibold shrink-0";

  const iconButtonClass = "h-8 w-10 rounded-full p-0 shrink-0";

  return (
    <div
      className={layoutDebugClassName(
        layoutDebugEnabled,
        cn("w-full max-w-5xl mx-auto h-full min-h-0", compactInPreview ? "px-2 py-2" : "px-3 sm:px-4 py-3 sm:py-4")
      )}
      style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneParent")}
    >
      {actionsVariant === "icon_only" ? (
        <div className="flex h-full min-h-0 items-start gap-3 min-w-0">
          {canGoBack && onBack ? (
            <Button
              onClick={onBack}
              variant="outline"
              className={iconButtonClass}
              style={{
                borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.14))",
                color: theme.textColor,
                fontFamily: theme.fontFamily,
              }}
              aria-label="Go back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <div className="h-8 w-10 shrink-0" aria-hidden="true" />
          )}
          <div
            className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden pr-1 space-y-2 sm:space-y-3"
            style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneAnswer")}
          >
            <div
              className={cn("min-w-0", compactInPreview ? "space-y-1.5" : undefined)}
              style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneQuestion")}
            >
              {headerInlineControl ? <div className="flex justify-center">{headerInlineControl}</div> : null}
              <div className={cn("min-w-0 flex-1", compactInPreview ? "text-center" : undefined)}>
                <h2
                  className={cn(
                    "font-semibold min-w-0 break-words mb-1",
                    compactInPreview ? "text-sm sm:text-base leading-tight" : "text-base sm:text-lg"
                  )}
                  style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                >
                  {question}
                </h2>
                <p
                  className={cn(
                    "opacity-75",
                    compactInPreview ? "text-[11px] leading-tight line-clamp-2" : "text-xs sm:text-sm"
                  )}
                  style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                >
                  {status === "running"
                    ? "Working in the background — you can continue anytime."
                    : status === "complete"
                      ? "Preview ready."
                    : status === "error"
                        ? "We couldn't generate this preview yet."
                        : "Preparing…"}
                </p>
              </div>
            </div>
            <div
              className="rounded-lg border bg-white/60 p-3"
              style={{
                ...withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber"),
                borderRadius: `${theme.borderRadius}px`,
                borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.10))",
              }}
            >
              {status === "running" || status === "idle" ? (
                <div className="flex items-center gap-3">
                  <div
                    className="h-7 w-7 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: theme.primaryColor || "#3b82f6" }}
                  />
                  <div className="text-sm" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                    Generating preview…
                  </div>
                </div>
              ) : null}
              {status === "error" ? (
                <div className="text-sm" style={{ color: "#ef4444", fontFamily: theme.fontFamily }}>
                  {output?.error || "Unknown error"}
                </div>
              ) : null}
              {status === "complete" ? (
                images.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {images.slice(0, 6).map((url, idx) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={`${url}-${idx}`}
                        src={url}
                        alt={`Generated preview ${idx + 1}`}
                        className="w-full aspect-square object-cover rounded"
                        style={{ borderRadius: `${theme.borderRadius}px` }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm opacity-75" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                    Preview generated, but no images were returned.
                  </div>
                )
              ) : null}
            </div>
          </div>
          <Button
            onClick={() => onComplete(undefined)}
            disabled={isLoading}
            className={iconButtonClass}
            style={{
              backgroundColor: theme.buttonStyle?.backgroundColor || theme.primaryColor,
              color: theme.buttonStyle?.textColor || "#ffffff",
              fontFamily: theme.fontFamily,
            }}
            aria-label="Continue"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div
          className="flex h-full min-h-0 flex-col space-y-3 sm:space-y-4"
          style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneAnswer")}
        >
          <div
            className={cn("min-w-0", compactInPreview ? "space-y-1.5" : undefined)}
            style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneQuestion")}
          >
            {headerInlineControl ? <div className="flex justify-center">{headerInlineControl}</div> : null}
            <div className={cn("min-w-0 flex-1", compactInPreview ? "text-center" : undefined)}>
              <h2
            className="text-base sm:text-lg font-semibold min-w-0 flex-1 break-words mb-1"
            style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
          >
            {question}
          </h2>
          <p className="text-xs sm:text-sm opacity-75" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
            {status === "running"
              ? "Working in the background — you can continue anytime."
              : status === "complete"
                ? "Preview ready."
              : status === "error"
                  ? "We couldn’t generate this preview yet."
                  : "Preparing…"}
          </p>
            </div>
          </div>

          <div
            className="rounded-lg border bg-white/60 p-3 shrink-0"
            style={{
              ...withLayoutDebugStyle(undefined, layoutDebugEnabled, "amber"),
              borderRadius: `${theme.borderRadius}px`,
              borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.10))",
            }}
          >
          {status === "running" || status === "idle" ? (
            <div className="flex items-center gap-3">
              <div
                className="h-7 w-7 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: theme.primaryColor || "#3b82f6" }}
              />
              <div className="text-sm" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                Generating preview…
              </div>
            </div>
          ) : null}

          {status === "error" ? (
            <div className="text-sm" style={{ color: "#ef4444", fontFamily: theme.fontFamily }}>
              {output?.error || "Unknown error"}
            </div>
          ) : null}

          {status === "complete" ? (
            images.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {images.slice(0, 6).map((url, idx) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${url}-${idx}`}
                    src={url}
                    alt={`Generated preview ${idx + 1}`}
                    className="w-full aspect-square object-cover rounded"
                    style={{ borderRadius: `${theme.borderRadius}px` }}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm opacity-75" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                Preview generated, but no images were returned.
              </div>
            )
          ) : null}
        </div>

        <div className="flex min-w-0 justify-center gap-2 pt-2 shrink-0">
            {canGoBack && onBack && (
              <Button
                onClick={onBack}
                variant="outline"
                className={actionButtonClass}
                style={{
                  borderColor: theme.primaryColor,
                  color: theme.primaryColor,
                  fontFamily: theme.fontFamily,
                  borderRadius: `${theme.borderRadius}px`,
                }}
              >
                Back
              </Button>
            )}
            <Button
              onClick={() => onComplete(undefined)}
              disabled={isLoading}
              className={actionButtonClass}
              style={{
                backgroundColor: theme.buttonStyle?.backgroundColor || theme.primaryColor,
                color: theme.buttonStyle?.textColor || "#ffffff",
                fontFamily: theme.fontFamily,
                borderRadius: `${theme.borderRadius}px`,
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
