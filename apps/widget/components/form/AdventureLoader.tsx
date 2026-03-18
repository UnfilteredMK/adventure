"use client";

import React, { useEffect, useState } from "react";
import { FormLoader } from "./FormLoader";

export type AdventureLoaderPhase =
  | "initial"
  | "batch_pricing"
  | "preview_generating"
  | "preview_refining"
  | "preview_refreshing";

interface PhaseConfig {
  /** Primary message(s). If array, rotates through them. */
  primary: string | string[];
  /** Optional rotating sub-messages. */
  subMessages?: string[];
  /** Append to subMessage after N seconds (e.g. "This can take about 10s on first load.") */
  subMessageSuffixAfterSec?: { after: number; suffix: string };
  /** Rotation interval in ms */
  rotateIntervalMs?: number;
}

const PHASE_CONFIGS: Record<AdventureLoaderPhase, PhaseConfig> = {
  initial: {
    primary: [
      "Preparing your quote…",
      "Calculating pricing for you…",
      "Generating your initial design…",
      "Building your first questions…",
    ],
    subMessages: [
      "Loading your service setup…",
      "Fetching project context…",
      "Tailoring questions to your project…",
    ],
    subMessageSuffixAfterSec: { after: 8, suffix: " This can take about 10s on first load." },
    rotateIntervalMs: 2200,
  },
  batch_pricing: {
    primary: "Getting you accurate pricing…",
    subMessages: [
      "Pulling a clearer price range…",
      "Tightening the estimate…",
      "Building your quote questions…",
      "Almost there — just enough to price accurately…",
      "Dialing in the details…",
      "One moment — refining your estimate…",
    ],
    rotateIntervalMs: 2000,
  },
  preview_generating: {
    primary: "Generating your design + pricing for you…",
    subMessages: [], // Pill overlay stays compact
    rotateIntervalMs: 2400,
  },
  preview_refining: {
    primary: "Fine-tuning your design + pricing…",
    subMessages: [], // Pill overlay stays compact
    rotateIntervalMs: 2600,
  },
  preview_refreshing: {
    primary: "Refreshing your design + pricing…",
    subMessages: [], // Pill overlay stays compact
    rotateIntervalMs: 2600,
  },
};

export interface AdventureLoaderProps {
  /** Which phase/context. Determines messages and behavior. */
  phase: AdventureLoaderPhase;
  /** Whether the loader is active. When false, rotation pauses. */
  active?: boolean;
  /** Layout: centered (full) or pill (compact overlay) */
  variant?: "centered" | "pill";
  /** Optional countdown (e.g. "2:45 left") shown as children. For pill, wraps in badge. */
  countdown?: React.ReactNode;
  /** Override primary message (skips phase config) */
  messageOverride?: string;
  /** Override sub-message (skips rotation) */
  subMessageOverride?: string;
  /** Custom className passed to FormLoader */
  className?: string;
  /** Visual tone for pill overlays */
  tone?: "default" | "overlay";
  /** Spinner size */
  size?: "sm" | "md";
  /** Inline style for FormLoader */
  style?: React.CSSProperties;
}

export function AdventureLoader({
  phase,
  active = true,
  variant = "centered",
  countdown,
  messageOverride,
  subMessageOverride,
  className,
  tone = "default",
  size = "md",
  style,
}: AdventureLoaderProps) {
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [subIndex, setSubIndex] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  const config = PHASE_CONFIGS[phase];
  const primaryArr = Array.isArray(config.primary) ? config.primary : [config.primary];
  const subMessages = config.subMessages ?? [];
  const intervalMs = config.rotateIntervalMs ?? 2000;
  const suffixConfig = config.subMessageSuffixAfterSec;

  // Primary message rotation (for phases with multiple primary messages)
  useEffect(() => {
    if (!active || primaryArr.length <= 1) return;
    const id = setInterval(() => {
      setPrimaryIndex((p) => (p + 1) % primaryArr.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, primaryArr.length, intervalMs]);

  // Sub-message rotation
  useEffect(() => {
    if (!active || subMessages.length === 0) return;
    const id = setInterval(() => {
      setSubIndex((s) => (s + 1) % subMessages.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, subMessages.length, intervalMs]);

  // Elapsed seconds (for suffix like "This can take about 10s...")
  useEffect(() => {
    if (!active || !suffixConfig) return;
    const id = setInterval(() => setElapsedSec((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [active, suffixConfig]);

  // Reset indices when phase or active changes
  useEffect(() => {
    setPrimaryIndex(0);
    setSubIndex(0);
    setElapsedSec(0);
  }, [phase, active]);

  const primary = messageOverride ?? primaryArr[primaryIndex % primaryArr.length];
  let subMessage = subMessageOverride;
  if (subMessage == null && subMessages.length > 0) {
    subMessage = subMessages[subIndex % subMessages.length];
    if (suffixConfig && elapsedSec >= suffixConfig.after) {
      subMessage = subMessage + suffixConfig.suffix;
    }
  }

  return (
    <FormLoader
      message={primary}
      subMessage={subMessage}
      variant={variant}
      size={size}
      className={className}
      tone={tone}
      style={style}
    >
      {countdown}
    </FormLoader>
  );
}
