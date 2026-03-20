"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { IntroUI } from "@/types/ai-form-ui-contract";
import { useFormTheme } from "../../demo/FormThemeProvider";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Sparkles, Clock3, ShieldCheck } from "lucide-react";
import { layoutDebugClassName, withLayoutDebugStyle } from "../runtime/step-engine/debug-layout";

interface InitialStepProps {
  step: IntroUI;
  stepData?: any;
  onComplete: (data: any) => void;
  onBack?: () => void;
  canGoBack: boolean;
  isLoading: boolean;
  actionsVariant?: "default" | "sticky_mobile" | "icon_only";
  compactInPreview?: boolean;
  layoutDebugEnabled?: boolean;
}

export function InitialStep({
  step,
  onComplete,
  onBack,
  canGoBack,
  isLoading,
  actionsVariant,
  compactInPreview,
  layoutDebugEnabled = false,
}: InitialStepProps) {
  const { theme } = useFormTheme();
  const brand = step.brand || null;
  const continueLabel = step.blueprint?.presentation?.continue_label || "Start";
  const actionButtonClass = "flex-1 min-w-0 h-11 px-3 text-sm font-semibold overflow-hidden";

  const handleStart = () => {
    onComplete({
      started: true,
      brand: brand || null,
      timestamp: new Date().toISOString(),
    });
  };

  const compact = Boolean(compactInPreview);
  return (
    <div
      className={layoutDebugClassName(
        layoutDebugEnabled,
        cn(
        "w-full mx-auto",
        compact ? "max-w-2xl px-3 py-2 space-y-2" : "max-w-3xl px-4 py-6 space-y-6"
        )
      )}
      style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneParent")}
    >
      <div style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneQuestion")}>
        <h2 className={cn("font-semibold min-w-0 flex-1 break-words", compact ? "text-base" : "text-lg sm:text-xl")} style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
          {step.question || "Let’s get started"}
        </h2>
        {step.humanism ? (
          <p className={cn("opacity-80", compact ? "mt-0.5 text-xs" : "mt-1 text-sm")} style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
            {step.humanism}
          </p>
        ) : null}
      </div>

      <div className={cn(compact ? "space-y-2" : "space-y-6")} style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "paneAnswer")}>
        <div
          className={cn("border", compact ? "rounded-xl p-2.5" : "rounded-2xl p-4")}
          style={{
            backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.70))",
            borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.10))",
            borderRadius: `${theme.borderRadius}px`,
          }}
        >
          <div className={cn("flex items-start", compact ? "gap-2" : "gap-3")}>
            <div
              className={cn("flex items-center justify-center rounded-xl", compact ? "h-8 w-8" : "h-10 w-10")}
              style={{ backgroundColor: `${theme.primaryColor}18` }}
            >
              <Sparkles className={compact ? "h-4 w-4" : "h-5 w-5"} style={{ color: theme.primaryColor }} />
            </div>
            <div className="min-w-0">
              <div className={cn("font-semibold", compact ? "text-[13px]" : "text-[15px]")}>
                {brand ? `Personalized to ${brand}` : "Personalized to your answers"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground/80 leading-relaxed">
                We’ll ask only what we need. If the AI can infer it safely, we won’t bother you.
              </div>
            </div>
          </div>
        </div>

        <div className={cn("grid sm:grid-cols-3", compact ? "gap-2" : "gap-3")}>
          <div
            className={cn("border", compact ? "rounded-xl p-2" : "rounded-2xl p-4")}
            style={{
              backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.70))",
              borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.10))",
              borderRadius: `${theme.borderRadius}px`,
            }}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              ~2 minutes
            </div>
            <div className={cn("font-medium", compact ? "mt-1 text-xs" : "mt-2 text-sm")}>Quick, focused questions</div>
          </div>
          <div
            className={cn("border", compact ? "rounded-xl p-2" : "rounded-2xl p-4")}
            style={{
              backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.70))",
              borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.10))",
              borderRadius: `${theme.borderRadius}px`,
            }}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              No spam
            </div>
            <div className={cn("font-medium", compact ? "mt-1 text-xs" : "mt-2 text-sm")}>You control what you share</div>
          </div>
          <div
            className={cn("border", compact ? "rounded-xl p-2" : "rounded-2xl p-4")}
            style={{
              backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.70))",
              borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.10))",
              borderRadius: `${theme.borderRadius}px`,
            }}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Sparkles className="h-4 w-4" />
              Better results
            </div>
            <div className={cn("font-medium", compact ? "mt-1 text-xs" : "mt-2 text-sm")}>Cleaner inputs → cleaner outputs</div>
          </div>
        </div>
      </div>

      {actionsVariant === "icon_only" ? (
        <div className="flex items-center justify-between pt-1">
          {canGoBack && onBack ? (
            <Button
              type="button"
              onClick={onBack}
              variant="outline"
              className="h-10 w-10 rounded-full p-0"
              style={{
                borderColor: "var(--form-surface-border-color, rgba(0,0,0,0.14))",
                color: theme.textColor,
                fontFamily: theme.fontFamily,
              }}
              aria-label="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <div className="h-10 w-10" aria-hidden="true" />
          )}
          <Button
            type="button"
            onClick={handleStart}
            disabled={isLoading}
            className="h-10 w-10 rounded-full p-0"
            style={{
              backgroundColor: theme.buttonStyle?.backgroundColor || theme.primaryColor,
              color: theme.buttonStyle?.textColor || "#ffffff",
              fontFamily: theme.fontFamily,
            }}
            aria-label={isLoading ? "Loading" : continueLabel}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 gap-3 pt-2">
          {canGoBack && onBack ? (
            <Button
              type="button"
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
              <span className="truncate">Back</span>
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={handleStart}
            disabled={isLoading}
            className={actionButtonClass}
            style={{
              backgroundColor: theme.buttonStyle?.backgroundColor || theme.primaryColor,
              color: theme.buttonStyle?.textColor || "#ffffff",
              fontFamily: theme.fontFamily,
              borderRadius: `${theme.borderRadius}px`,
            }}
          >
            <span className="truncate">{isLoading ? "Loading..." : continueLabel}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
