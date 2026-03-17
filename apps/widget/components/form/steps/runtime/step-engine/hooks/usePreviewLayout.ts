import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const DOMINANT_PREVIEW_SHARE = 0.8;

interface UsePreviewLayoutParams {
  previewEnabled: boolean;
  showBrandingHeader: boolean;
  currentStepId?: string | null;
}

export function usePreviewLayout({
  previewEnabled,
  showBrandingHeader,
  currentStepId,
}: UsePreviewLayoutParams) {
  const [previewMaxPx, setPreviewMaxPx] = useState<number | null>(null);
  const [questionScale, setQuestionScale] = useState(1);
  const hasPreview = previewEnabled;
  const previewRailOpen = previewEnabled;

  const previewColumnRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const questionViewportRef = useRef<HTMLDivElement>(null);
  const questionContentRef = useRef<HTMLDivElement>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const isDesktopViewport = !isMobileViewport;

  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobileViewport(Boolean(mq.matches));
    update();
    try {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    } catch {
      // @ts-ignore Safari < 14
      mq.addListener?.(update);
      // @ts-ignore Safari < 14
      return () => mq.removeListener?.(update);
    }
  }, []);

  const isAdventureSurface = showBrandingHeader;
  const usePreviewDominantLayout = previewEnabled && isMobileViewport;
  const useDesktopPreviewLayout = previewEnabled && isDesktopViewport;
  const useMobilePreviewLayout = previewEnabled && isMobileViewport;

  const computePreviewMaxPx = useCallback(() => {
    if (!previewEnabled) {
      setPreviewMaxPx(null);
      setQuestionScale(1);
      return;
    }

    if (usePreviewDominantLayout || useDesktopPreviewLayout) {
      const columnEl = previewColumnRef.current;
      const previewViewportEl = previewViewportRef.current;
      const columnHeight = columnEl?.clientHeight ?? 0;
      const previewViewportHeight = previewViewportEl?.clientHeight ?? 0;
      let measuredPreviewHeight =
        previewViewportHeight > 0
          ? previewViewportHeight
          : columnHeight > 0
            ? Math.max(0, Math.floor(columnHeight * DOMINANT_PREVIEW_SHARE))
            : 0;
      // Avoid two-phase resize stutter: when no measurement yet, use viewport-based initial estimate
      // so the first paint is close to final and we don't get expand->pause->expand.
      if (measuredPreviewHeight <= 0 && typeof window !== "undefined" && window.innerHeight > 0) {
        measuredPreviewHeight = Math.max(0, Math.floor(window.innerHeight * DOMINANT_PREVIEW_SHARE));
      }
      if (measuredPreviewHeight <= 0) return;

      const safetyPx = 12;
      const nextPreviewMaxPx = Math.max(0, Math.floor(measuredPreviewHeight - safetyPx));
      setPreviewMaxPx((prev) => {
        if (prev === null) return nextPreviewMaxPx;
        // Skip micro-updates; prevents expand→pause→expand stutter during layout settle
        return Math.abs(prev - nextPreviewMaxPx) < 8 ? prev : nextPreviewMaxPx;
      });
      setQuestionScale(1);
      return;
    }

    const columnEl = previewColumnRef.current;
    const contentEl = questionContentRef.current;
    if (!columnEl) return;

    const columnHeight = columnEl.clientHeight;
    if (columnHeight <= 0) return;
    if (!contentEl) {
      const fallbackPreview = Math.max(0, Math.floor(columnHeight * 0.65) - 24);
      setPreviewMaxPx((prev) =>
        prev === null ? fallbackPreview : Math.abs(prev - fallbackPreview) < 8 ? prev : fallbackPreview
      );
      return;
    }

    const contentHeight = Math.max(contentEl.scrollHeight, contentEl.clientHeight);
    const gapPx = 8;
    const safetyPx = 20;
    const totalAvailable = Math.max(0, Math.floor(columnHeight - gapPx - safetyPx));

    if (contentHeight <= 0) {
      const fallbackPreview = Math.min(totalAvailable, 520);
      setPreviewMaxPx((prev) => {
        if (prev === null) return fallbackPreview;
        return Math.abs(prev - fallbackPreview) < 8 ? prev : fallbackPreview;
      });
      setQuestionScale(1);
      return;
    }

    const nextPreviewMax = Math.min(totalAvailable, Math.max(0, Math.floor(totalAvailable - contentHeight)));
    const roundedPreview = Math.round(nextPreviewMax);

    setPreviewMaxPx((prev) => {
      if (prev === null) return roundedPreview;
      return Math.abs(prev - roundedPreview) < 8 ? prev : roundedPreview;
    });
    setQuestionScale(1);
  }, [previewEnabled, useDesktopPreviewLayout, usePreviewDominantLayout]);

  useLayoutEffect(() => {
    computePreviewMaxPx();
  }, [computePreviewMaxPx, currentStepId]);

  // When preview first enables in dominant layout, set initial estimate BEFORE paint to avoid
  // null -> measured two-phase resize (expand, pause, expand) during "Generating..." state.
  useLayoutEffect(() => {
    if (!previewEnabled || !(usePreviewDominantLayout || useDesktopPreviewLayout)) return;
    setPreviewMaxPx((prev) => {
      if (prev !== null) return prev;
      if (typeof window === "undefined" || window.innerHeight <= 0) return prev;
      const est = Math.max(0, Math.floor(window.innerHeight * DOMINANT_PREVIEW_SHARE) - 12);
      return est;
    });
  }, [previewEnabled, usePreviewDominantLayout, useDesktopPreviewLayout]);

  useEffect(() => {
    if (!previewEnabled) return;
    if (typeof ResizeObserver === "undefined") return;

    const targets: Element[] = [];
    const columnEl = previewColumnRef.current;
    const previewViewportEl = previewViewportRef.current;
    const contentEl = questionContentRef.current;

    if (columnEl) targets.push(columnEl);
    if (previewViewportEl) targets.push(previewViewportEl);
    if (contentEl) targets.push(contentEl);

    if (targets.length === 0) return;

    let raf = 0;
    let debounceTimer = 0;
    const RESIZE_DEBOUNCE_MS = 100;
    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = 0;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          raf = 0;
          computePreviewMaxPx();
        });
      }, RESIZE_DEBOUNCE_MS);
    };

    const ro = new ResizeObserver(schedule);
    for (const el of targets) ro.observe(el);
    schedule();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [computePreviewMaxPx, previewEnabled, useDesktopPreviewLayout, usePreviewDominantLayout]);

  return {
    hasPreview,
    isAdventureSurface,
    isDesktopViewport,
    isMobileViewport,
    previewColumnRef,
    previewMaxPx,
    previewRailOpen,
    previewViewportRef,
    questionContentRef,
    questionScale,
    questionViewportRef,
    useMobilePreviewLayout,
    useDesktopPreviewLayout,
    usePreviewDominantLayout,
  };
}
