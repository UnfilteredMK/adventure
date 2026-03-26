"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCache, saveCache } from "../cache";
import type { NavigationTransition, PreviewCacheV3, PreviewRun, PreviewStackLayer } from "../types";
import { isValidUrlLikeImage } from "../utils/images";

type UsePreviewLightboxOptions = {
  instanceId: string;
  sessionId: string;
  activeIndex: number;
  activeRun: PreviewRun | null;
  hero: string | null;
  runs: PreviewRun[];
  showConceptPicker: boolean;
  isPlaceholderHero: boolean;
  setCache: React.Dispatch<React.SetStateAction<PreviewCacheV3 | null>>;
};

export function usePreviewLightbox({
  instanceId,
  sessionId,
  activeIndex,
  activeRun,
  hero,
  runs,
  showConceptPicker,
  isPlaceholderHero,
  setCache,
}: UsePreviewLightboxOptions) {
  const lightboxLayoutId = `image-preview:${instanceId}:${sessionId}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxContain, setLightboxContain] = useState(false);
  const previousActiveRunRef = useRef<{ runId: string | null; index: number; runsLength: number; hero: string | null }>({
    runId: null,
    index: 0,
    runsLength: 0,
    hero: null,
  });
  const [navigationTransition, setNavigationTransition] = useState<NavigationTransition | null>(null);

  const openLightbox = useCallback(() => {
    if (!hero) return;
    setLightboxContain(false);
    setLightboxOpen(true);
  }, [hero]);

  const closeLightbox = useCallback(() => {
    setLightboxContain(false);
    setLightboxOpen(false);
  }, []);

  useEffect(() => {
    const previous = previousActiveRunRef.current;
    const currentRunId = activeRun?.id ?? null;

    if (previous.runId && currentRunId && previous.runId !== currentRunId) {
      const navigatedBetweenExistingRuns = runs.length === previous.runsLength && previous.runsLength > 1;
      if (navigatedBetweenExistingRuns && previous.hero && hero) {
        const direction: -1 | 1 = activeIndex > previous.index ? 1 : -1;
        setNavigationTransition({
          key: `${previous.runId}:${currentRunId}:${Date.now()}`,
          fromRunId: previous.runId,
          toRunId: currentRunId,
          fromImage: previous.hero,
          toImage: hero,
          direction,
        });
      } else {
        setNavigationTransition(null);
      }
    } else if (!hero) {
      setNavigationTransition(null);
    }

    previousActiveRunRef.current = {
      runId: currentRunId,
      index: activeIndex,
      runsLength: runs.length,
      hero,
    };
  }, [activeIndex, activeRun?.id, hero, runs.length]);

  useEffect(() => {
    if (!navigationTransition) return;
    const timeoutId = window.setTimeout(() => {
      setNavigationTransition((current) => (current?.key === navigationTransition.key ? null : current));
    }, 460);
    return () => window.clearTimeout(timeoutId);
  }, [navigationTransition]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeLightbox, lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    if (hero) return;
    setLightboxOpen(false);
  }, [hero, lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [lightboxOpen]);

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < runs.length - 1;
  const hasMultiImageRun = runs.some((r) => r.images && r.images.length > 1);
  const activeRunHasMultiple = Boolean(activeRun?.images && activeRun.images.length > 1);
  const activeNavigationTransition =
    navigationTransition && navigationTransition.toRunId === activeRun?.id && navigationTransition.toImage === hero
      ? navigationTransition
      : null;

  const stackedPreviewLayers = useMemo(() => {
    if (!hero || runs.length < 1 || showConceptPicker || isPlaceholderHero) return [] as PreviewStackLayer[];

    const layers: PreviewStackLayer[] = [];
    const seen = new Set<string>([hero]);
    const addLayer = (src: string | null | undefined, key: string, kind: PreviewStackLayer["kind"]) => {
      if (!isValidUrlLikeImage(src) || seen.has(src) || layers.length >= 4) return;
      seen.add(src);
      layers.push({ key, src, kind });
    };

    if (activeNavigationTransition?.fromImage) {
      addLayer(activeNavigationTransition.fromImage, `transition-${activeNavigationTransition.key}`, "transition");
    }

    if (runs.length > 1) {
      const previousRuns = runs.slice(0, activeIndex).reverse();
      const nextRuns = runs.slice(activeIndex + 1);
      previousRuns.forEach((run) => addLayer(run.images?.[0], `history-${run.id}`, "history"));
      nextRuns.forEach((run) => addLayer(run.images?.[0], `next-${run.id}`, "history"));
    }

    return layers;
  }, [activeIndex, activeNavigationTransition, hero, isPlaceholderHero, runs, showConceptPicker]);

  const goPrev = useCallback(() => {
    if (!canPrev) return;
    const nextId = runs[activeIndex - 1]?.id;
    if (!nextId) return;
    setCache((prev) => {
      const base = prev ?? loadCache(instanceId, sessionId);
      if (!base) return prev;
      const next: PreviewCacheV3 = {
        ...base,
        activeRunId: nextId,
        viewMode: "single",
        selectedConceptIndex: 0,
        updatedAt: Date.now(),
      };
      saveCache(instanceId, sessionId, next);
      return next;
    });
  }, [activeIndex, canPrev, instanceId, runs, sessionId, setCache]);

  const goNext = useCallback(() => {
    if (!canNext) return;
    const nextId = runs[activeIndex + 1]?.id;
    if (!nextId) return;
    setCache((prev) => {
      const base = prev ?? loadCache(instanceId, sessionId);
      if (!base) return prev;
      const next: PreviewCacheV3 = {
        ...base,
        activeRunId: nextId,
        viewMode: "single",
        selectedConceptIndex: 0,
        updatedAt: Date.now(),
      };
      saveCache(instanceId, sessionId, next);
      return next;
    });
  }, [activeIndex, canNext, instanceId, runs, sessionId, setCache]);

  return {
    activeRunHasMultiple,
    canNext,
    canPrev,
    closeLightbox,
    goNext,
    goPrev,
    hasMultiImageRun,
    lightboxContain,
    lightboxLayoutId,
    lightboxOpen,
    openLightbox,
    setLightboxContain,
    stackedPreviewLayers,
  };
}
