"use client";

import { cn } from "@/lib/utils";
import React from "react";

type LayoutDebugTone =
  | "amber"
  | "answerGreen"
  | "darkYellow"
  | "emerald"
  | "paneAnswer"
  | "paneParent"
  | "paneQuestion"
  | "rose"
  | "sky"
  | "violet";

export function layoutDebugClassName(_enabled: boolean, className?: string): string {
  return cn(className);
}

export function withLayoutDebugStyle(
  baseStyle: React.CSSProperties | undefined,
  _enabled: boolean,
  _tone: LayoutDebugTone,
): React.CSSProperties | undefined {
  if (!_enabled) return baseStyle;

  const tones: Record<LayoutDebugTone, { border: string; background: string }> = {
    amber: {
      border: "rgba(245, 158, 11, 0.95)",
      background: "rgba(245, 158, 11, 0.14)",
    },
    answerGreen: {
      border: "rgba(34, 197, 94, 0.95)",
      background: "rgba(34, 197, 94, 0.14)",
    },
    darkYellow: {
      border: "rgba(202, 138, 4, 0.95)",
      background: "rgba(202, 138, 4, 0.14)",
    },
    emerald: {
      border: "rgba(16, 185, 129, 0.95)",
      background: "rgba(16, 185, 129, 0.14)",
    },
    paneAnswer: {
      border: "rgba(59, 130, 246, 0.95)",
      background: "rgba(59, 130, 246, 0.12)",
    },
    paneParent: {
      border: "rgba(168, 85, 247, 0.95)",
      background: "rgba(168, 85, 247, 0.10)",
    },
    paneQuestion: {
      border: "rgba(236, 72, 153, 0.95)",
      background: "rgba(236, 72, 153, 0.10)",
    },
    rose: {
      border: "rgba(244, 63, 94, 0.95)",
      background: "rgba(244, 63, 94, 0.12)",
    },
    sky: {
      border: "rgba(14, 165, 233, 0.95)",
      background: "rgba(14, 165, 233, 0.12)",
    },
    violet: {
      border: "rgba(139, 92, 246, 0.95)",
      background: "rgba(139, 92, 246, 0.12)",
    },
  };

  const tone = tones[_tone];

  return {
    ...baseStyle,
    boxShadow: `inset 0 0 0 2px ${tone.border}`,
    backgroundColor: tone.background,
  };
}
