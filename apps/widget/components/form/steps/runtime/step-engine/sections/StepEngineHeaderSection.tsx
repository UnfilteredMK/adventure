import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { hexToRgba } from "@/types/design";
import { getStepJoggerLabel } from "../utils/step-jogger";

export function StepEngineHeaderSection(args: {
  showProgressBar: boolean;
  metricProgress: number | null | undefined;
  progressPercentage: number | null | undefined;
  stepJoggerVisible: boolean;
  stepJoggerSteps: Array<{ step: { id?: string | null } & Record<string, unknown>; index: number }>;
  currentStepIndex: number;
  maxVisitedIndex: number;
  onNavigateToStep: (index: number) => void;
  onSetAdventureInputModeQuestions: () => void;
  studioPhases?: Array<{
    key: string;
    label: string;
    active: boolean;
    complete: boolean;
    enabled: boolean;
  }>;
  onNavigateStudioPhase?: (key: string) => void;
  theme: {
    primaryColor?: string;
    textColor?: string;
    fontFamily?: string;
  };
}) {
  const {
    showProgressBar,
    metricProgress,
    progressPercentage,
    stepJoggerVisible,
    stepJoggerSteps,
    currentStepIndex,
    maxVisitedIndex,
    onNavigateToStep,
    onSetAdventureInputModeQuestions,
    studioPhases = [],
    onNavigateStudioPhase,
    theme,
  } = args;

  const activeStudioPhaseRef = React.useRef<HTMLButtonElement | null>(null);
  const activeStudioPhaseKey = studioPhases.find((phase) => phase.active)?.key ?? null;

  React.useEffect(() => {
    if (studioPhases.length === 0) return;
    activeStudioPhaseRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeStudioPhaseKey, studioPhases.length]);

  const currentVisiblePosition = stepJoggerSteps.findIndex(({ index }) => index === currentStepIndex);

  return (
    <div
      className={cn(
        "z-50 shrink-0 backdrop-blur",
        /** Sticky below brand inside the adventure mobile scroll region so progress + step jogger stay visible while the body scrolls. */
        "max-sm:sticky max-sm:top-0"
      )}
      style={{ backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.85))" }}
    >
      {showProgressBar ? (
        <div className="pb-1 pt-1.5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-4 sm:pt-2">
          <div className="h-1.5">
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{
                width: `${
                  typeof metricProgress === "number" && Number.isFinite(metricProgress)
                    ? Math.round(Math.max(0, Math.min(1, metricProgress)) * 100)
                    : progressPercentage ?? 0
                }%`,
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{ backgroundColor: theme.primaryColor || "var(--form-primary-color, #3b82f6)" }}
            />
          </div>
        </div>
      ) : null}
      {studioPhases.length > 0 ? (
        <nav aria-label="Design progress" className="overflow-x-auto px-3 py-2 [scrollbar-width:none] sm:px-5 sm:py-2.5 [&::-webkit-scrollbar]:hidden">
          <ol className="mx-auto flex w-max min-w-max items-center justify-center whitespace-nowrap">
            {studioPhases.map((phase, index) => (
              <React.Fragment key={phase.key}>
                {index > 0 ? (
                  <li aria-hidden className="h-px w-5 shrink-0 bg-foreground/12 sm:w-9" />
                ) : null}
                <li className="shrink-0">
                  <button
                    ref={phase.active ? activeStudioPhaseRef : undefined}
                    type="button"
                    disabled={!phase.enabled || phase.active}
                    onClick={() => onNavigateStudioPhase?.(phase.key)}
                    aria-current={phase.active ? "step" : undefined}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-all sm:text-xs",
                      phase.active
                        ? "border-primary/25 text-foreground shadow-sm"
                        : phase.enabled
                          ? "border-transparent text-foreground/65 hover:border-primary/20 hover:bg-primary/5 hover:text-foreground"
                          : "border-transparent text-foreground/32",
                    )}
                    style={phase.active ? { backgroundColor: hexToRgba(theme.primaryColor || "#3b82f6", 0.09) || undefined } : undefined}
                  >
                    <span
                      className={cn(
                        "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px]",
                        phase.complete || phase.active
                          ? "border-primary/40 text-primary"
                          : "border-foreground/15 text-foreground/35",
                      )}
                    >
                      {phase.complete ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : <span className="h-1 w-1 rounded-full bg-current" />}
                    </span>
                    {phase.label}
                  </button>
                </li>
              </React.Fragment>
            ))}
          </ol>
        </nav>
      ) : null}
      {stepJoggerVisible ? (
        <div className="pb-1.5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-4 sm:pb-2">
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1">
            {stepJoggerSteps.map(({ step, index }, visiblePosition) => {
              const isCurrent = index === currentStepIndex;
              const isEarlierVisibleStep =
                currentVisiblePosition >= 0 ? visiblePosition < currentVisiblePosition : index < currentStepIndex;
              const canNavigate = !isCurrent && (index <= maxVisitedIndex || isEarlierVisibleStep);
              const label = getStepJoggerLabel(step, index);
              return (
                <button
                  key={String(step?.id || `step-${index}`)}
                  type="button"
                  disabled={!canNavigate}
                  onClick={() => {
                    if (!canNavigate) return;
                    onSetAdventureInputModeQuestions();
                    onNavigateToStep(index);
                  }}
                  title={label}
                  className={cn(
                    "inline-flex max-w-[260px] items-center gap-2 rounded-full px-3 py-1.5 text-xs shadow-sm transition-colors",
                    isCurrent ? "font-semibold" : "font-medium",
                    canNavigate ? "cursor-pointer hover:bg-primary/10" : "cursor-default opacity-70"
                  )}
                  style={{
                    backgroundColor: isCurrent ? theme.primaryColor || "#3b82f6" : "transparent",
                    color: isCurrent ? "#fff" : theme.textColor,
                    fontFamily: theme.fontFamily,
                  }}
                >
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                    style={{
                      backgroundColor: isCurrent
                        ? "rgba(255,255,255,0.25)"
                        : hexToRgba(theme.primaryColor || "#3b82f6", 0.18) ?? "rgba(59,130,246,0.18)",
                      color: isCurrent ? "#fff" : theme.textColor,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
