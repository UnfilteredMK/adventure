"use client";

// Image Choice Grid Control
import React from "react";
import { createPortal } from "react-dom";
import { useFormTheme } from "../../demo/FormThemeProvider";
import { cn } from "@/lib/utils";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useLayoutDensity } from "../ui-layout/layout-density";
import { formatCurrency } from "@/lib/ai-form/utils/currency";

type ImageChoiceVariant = "swipe" | "selectors";
type PriceTier = "$" | "$$" | "$$$" | "$$$$";

interface ImageChoiceGridProps {
  value?: string | string[];
  onChange: (value: string | string[]) => void;
  onSwipeComplete?: (value: string | string[]) => void;
  options: Array<{
    label: string;
    value?: string;
    imageUrl?: string;
    description?: string;
    priceTier?: PriceTier;
    priceRange?: { low: number; high: number; currency?: string };
    disabled?: boolean;
  }>;
  multiple?: boolean;
  maxSelections?: number;
  variant?: ImageChoiceVariant;
  columns?: number;
  className?: string;
  thumbnailMode?: boolean;
  compactScroller?: boolean;
  hideOptionText?: boolean;
  displayMode?: "default" | "priced_examples";
}

function formatPriceRangeLabel(
  range: { low: number; high: number; currency?: string } | undefined,
  locale?: string
): string | null {
  if (!range) return null;
  const low = Number(range.low);
  const high = Number(range.high);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const currency = typeof range.currency === "string" && range.currency.trim() ? range.currency.trim().toUpperCase() : "USD";
  return `${formatCurrency(Math.min(low, high), { locale, currency })} - ${formatCurrency(Math.max(low, high), { locale, currency })}`;
}

function clampColumns(raw: unknown): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.floor(n));
}

function useIsNarrowViewport(maxWidthPx: number): boolean {
  const [isNarrow, setIsNarrow] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(`(max-width: ${Math.max(0, Math.floor(maxWidthPx))}px)`);
    const onChange = () => setIsNarrow(Boolean(mql.matches));
    onChange();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Safari < 14
    // eslint-disable-next-line deprecation/deprecation
    mql.addListener(onChange);
    // eslint-disable-next-line deprecation/deprecation
    return () => mql.removeListener(onChange);
  }, [maxWidthPx]);

  return isNarrow;
}

function normalizePriceTier(v: unknown): PriceTier | undefined {
  const t = typeof v === "string" ? v.trim() : "";
  if (t === "$" || t === "$$" || t === "$$$" || t === "$$$$") return t;
  return undefined;
}

export function ImageChoiceGrid({
  value,
  onChange,
  onSwipeComplete,
  options,
  multiple,
  maxSelections,
  variant = "selectors",
  columns,
  className,
  thumbnailMode = false,
  compactScroller = false,
  hideOptionText = false,
  displayMode = "default",
}: ImageChoiceGridProps) {
  const { theme } = useFormTheme();
  const density = useLayoutDensity();
  const isCompact = density === "compact";
  const selectedArray = Array.isArray(value) ? value : (value ? [value] : []);
  const maxSelectionLimit = Number.isFinite(Number(maxSelections)) ? Math.max(1, Math.floor(Number(maxSelections))) : null;
  const isAtSelectionCap = Boolean(multiple && maxSelectionLimit !== null && selectedArray.length >= maxSelectionLimit);
  const isNarrowViewport = useIsNarrowViewport(768);
  const desktopThumbnailMode = thumbnailMode && !isNarrowViewport;
  const useCompactScroller = Boolean(compactScroller && variant !== "swipe");
  const scrollViewportRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);
  const [hoveredCompactOption, setHoveredCompactOption] = React.useState<null | {
    label: string;
    imageUrl?: string;
    rect: DOMRect;
  }>(null);
  const [canPortalPreview, setCanPortalPreview] = React.useState(false);

  React.useEffect(() => {
    setCanPortalPreview(typeof document !== "undefined");
  }, []);

  const updateScrollAffordances = React.useCallback(() => {
    const el = scrollViewportRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < maxLeft - 4);
  }, []);

  React.useEffect(() => {
    if (!useCompactScroller) return;
    updateScrollAffordances();
    const el = scrollViewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updateScrollAffordances());
    ro.observe(el);
    return () => ro.disconnect();
  }, [options.length, updateScrollAffordances, useCompactScroller]);

  const scrollCompactRail = React.useCallback((direction: "left" | "right") => {
    const el = scrollViewportRef.current;
    if (!el) return;
    const delta = Math.max(160, Math.floor(el.clientWidth * 0.72)) * (direction === "right" ? 1 : -1);
    el.scrollBy({ left: delta, behavior: "smooth" });
    window.setTimeout(updateScrollAffordances, 220);
  }, [updateScrollAffordances]);

  const toggle = (val: string) => {
    const matched = options.find((opt) => (opt.value || opt.label) === val);
    if (matched?.disabled) return;
    if (multiple) {
      if (selectedArray.includes(val)) {
        onChange(selectedArray.filter((v) => v !== val));
      } else if (isAtSelectionCap) {
        return;
      } else {
        onChange([...selectedArray, val]);
      }
    } else {
      onChange(val);
    }
  };

  const [activeIndex, setActiveIndex] = React.useState(0);
  const [showSwipeHint, setShowSwipeHint] = React.useState(false);
  const [isSwipeAnimating, setIsSwipeAnimating] = React.useState(false);
  const maxIndex = Math.max(0, options.length - 1);
  const SWIPE_HINT_STORAGE_KEY = "sif:image-choice-swipe-hint-seen:v1";
  const dragIntentRef = React.useRef(false);
  const swipeX = useMotionValue(0);
  const swipeOpacity = useMotionValue(1);
  const cardRotate = useTransform(swipeX, [-220, 0, 220], [-10, 0, 10]);
  const likeOverlayOpacity = useTransform(swipeX, [0, 45, 130], [0, 0.35, 1]);
  const nopeOverlayOpacity = useTransform(swipeX, [-130, -45, 0], [1, 0.35, 0]);
  const active = options[activeIndex];
  const activeKey = active ? active.value || active.label : "";
  const pricingLocale =
    typeof navigator !== "undefined"
      ? ((navigator.languages && navigator.languages[0]) || navigator.language || undefined)
      : undefined;

  const cardRadius = `${theme.borderRadius * 1.5}px`;

  React.useEffect(() => {
    setActiveIndex((idx) => Math.min(Math.max(0, idx), maxIndex));
  }, [maxIndex]);

  React.useEffect(() => {
    if (variant !== "swipe" || options.length <= 1) return;
    if (typeof window === "undefined") return;
    try {
      const hasSeen = window.localStorage.getItem(SWIPE_HINT_STORAGE_KEY) === "1";
      if (!hasSeen) setShowSwipeHint(true);
    } catch {
      setShowSwipeHint(true);
    }
  }, [options.length, variant]);

  const dismissSwipeHint = React.useCallback(() => {
    setShowSwipeHint(false);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SWIPE_HINT_STORAGE_KEY, "1");
    } catch {}
  }, []);

  React.useEffect(() => {
    if (variant !== "swipe") return;
    swipeX.set(0);
    swipeOpacity.set(1);
    dragIntentRef.current = false;
    setIsSwipeAnimating(false);
  }, [activeKey, swipeOpacity, swipeX, variant]);

  if (variant === "swipe") {
    const activePicked = activeKey ? selectedArray.includes(activeKey) : false;
    const goPrev = () => {
      if (isSwipeAnimating) return;
      dismissSwipeHint();
      setActiveIndex((idx) => Math.max(0, idx - 1));
    };
    const goNext = () => {
      if (isSwipeAnimating) return;
      dismissSwipeHint();
      setActiveIndex((idx) => Math.min(maxIndex, idx + 1));
    };

    const computeNextPickedState = (val: string, shouldSelect: boolean): string | string[] => {
      if (!val) return multiple ? selectedArray : (typeof value === "string" ? value : "");
      if (multiple) {
        if (shouldSelect) {
          if (selectedArray.includes(val)) return selectedArray;
          if (isAtSelectionCap) return selectedArray;
          return [...selectedArray, val];
        }
        if (!selectedArray.includes(val)) return selectedArray;
        return selectedArray.filter((v) => v !== val);
      }
      if (shouldSelect) {
        return val;
      }
      if (value === val) return "";
      return typeof value === "string" ? value : "";
    };

    const handleSwipeDecision = async (direction: "left" | "right") => {
      if (isSwipeAnimating) return;
      if (!activeKey) return;
      const nextValue = direction === "right" ? computeNextPickedState(activeKey, true) : computeNextPickedState(activeKey, false);
      if (nextValue !== undefined) onChange(nextValue);
      dismissSwipeHint();
      setIsSwipeAnimating(true);
      const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 420;
      const exitDistance = Math.max(400, viewportWidth * 1.2);
      const exitX = direction === "right" ? exitDistance : -exitDistance;
      const animDuration = 0.28;
      animate(swipeX, exitX, { duration: animDuration, ease: "easeIn" });
      animate(swipeOpacity, 0.08, { duration: animDuration, ease: "easeIn" });
      await new Promise((resolve) => window.setTimeout(resolve, animDuration * 1000 + 20));
      // Single-select + swipe right: selection is final, auto-continue to next step
      if (!multiple && direction === "right") {
        onSwipeComplete?.(nextValue ?? (typeof value === "string" ? value : ""));
        setIsSwipeAnimating(false);
        return;
      }
      // Multi-select or swipe left: advance to next card; on last card, complete
      if (activeIndex >= maxIndex) {
        onSwipeComplete?.(nextValue ?? (multiple ? selectedArray : (typeof value === "string" ? value : "")));
        setIsSwipeAnimating(false);
        return;
      }
      setActiveIndex((idx) => Math.min(maxIndex, idx + 1));
    };

    return (
      <div className={cn("w-full relative", className)}>
        {active && (
          <div className="relative w-full">
          <motion.button
            key={activeKey}
            type="button"
            onClick={() => {
              if (dragIntentRef.current || isSwipeAnimating) return;
              dismissSwipeHint();
              toggle(activeKey);
            }}
            aria-pressed={activePicked}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragDirectionLock
            dragElastic={0.24}
            dragMomentum
            style={{ x: swipeX, rotate: cardRotate, opacity: swipeOpacity, borderRadius: cardRadius }}
            transition={{ type: "spring", stiffness: 340, damping: 26 }}
            onDragStart={() => {
              dragIntentRef.current = false;
            }}
            onDrag={(_, info) => {
              if (Math.abs(info.offset.x) > 8) dragIntentRef.current = true;
            }}
            onDragEnd={async (_, info) => {
              const threshold = 44;
              const velocityThreshold = 240;
              const shouldLeft = info.offset.x <= -threshold || info.velocity.x <= -velocityThreshold;
              const shouldRight = info.offset.x >= threshold || info.velocity.x >= velocityThreshold;
              if (shouldLeft) {
                await handleSwipeDecision("left");
                return;
              }
              if (shouldRight) {
                await handleSwipeDecision("right");
                return;
              }
              animate(swipeX, 0, { type: "spring", stiffness: 340, damping: 26 });
              animate(swipeOpacity, 1, { type: "spring", stiffness: 300, damping: 28 });
            }}
            className={cn(
              "relative w-full overflow-hidden border-4 transition-all",
              activePicked ? "border-primary" : "border-transparent bg-muted/20"
            )}
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden">
              {active.imageUrl ? (
                <img
                  src={active.imageUrl}
                  alt={active.label}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full bg-muted/30" />
              )}
              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
                <div className="relative z-10">
                  {!hideOptionText ? (
                    <div className={cn(isCompact ? "text-[13px]" : "text-sm", "font-bold text-white")}>{active.label}</div>
                  ) : null}
                  {!hideOptionText && active.description ? (
                    <div className={cn(isCompact ? "text-[11px]" : "text-xs", "text-white/85")}>{active.description}</div>
                  ) : null}
                </div>
              </div>
              <div
                className="pointer-events-none absolute left-3 top-3 rounded-md border border-emerald-200/80 bg-emerald-500/85 px-2 py-1 text-xs font-semibold text-white shadow"
                style={{ opacity: likeOverlayOpacity as any }}
              >
                SELECT
              </div>
              <div
                className="pointer-events-none absolute right-3 top-3 rounded-md border border-rose-200/80 bg-rose-500/85 px-2 py-1 text-xs font-semibold text-white shadow"
                style={{ opacity: nopeOverlayOpacity as any }}
              >
                SKIP
              </div>
              {activePicked && (
                <div className="absolute top-3 right-3 bg-primary text-white p-1 rounded-full shadow-lg">
                  <Check className="w-4 h-4" strokeWidth={3} />
                </div>
              )}
            </div>
          </motion.button>
          {showSwipeHint && (
            <div
              className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl bg-black/60 backdrop-blur-sm p-4"
              style={{ borderRadius: cardRadius }}
            >
              <div className="font-semibold text-white text-sm sm:text-base">How swiping works</div>
              <div className="text-white/90 text-xs sm:text-sm mt-1 text-center">Right = select. Left = skip. You can still use arrows or tap.</div>
              <div className="mt-4 relative w-24 h-16 overflow-hidden rounded-lg border border-white/30">
                <div className="absolute left-1 top-1 text-[9px] font-semibold text-rose-300">SKIP</div>
                <div className="absolute right-1 top-1 text-[9px] font-semibold text-emerald-300">SELECT</div>
                <motion.div
                  className="absolute left-1/2 top-1/2 h-8 w-12 -translate-x-1/2 -translate-y-1/2 rounded border bg-white/90"
                  animate={{ x: [0, -24, 24, 0], rotate: [0, -6, 6, 0] }}
                  transition={{ duration: 2.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                />
              </div>
              <button
                type="button"
                onClick={dismissSwipeHint}
                className="mt-4 rounded-lg border border-white/40 bg-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/30 transition-colors"
              >
                Got it
              </button>
            </div>
          )}
          </div>
        )}

        {options.length > 1 && (
          <div className="mt-2 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              disabled={activeIndex <= 0}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous option"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-[56px] text-center text-[11px] text-muted-foreground tabular-nums">
              {activeIndex + 1} / {options.length}
            </div>
            <button
              type="button"
              onClick={goNext}
              disabled={activeIndex >= maxIndex}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next option"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {options.length > 1 && (
          <div className="mt-1 flex items-center justify-center gap-1.5">
            {options.map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  idx === activeIndex ? "bg-foreground/70" : "bg-foreground/20"
                )}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (useCompactScroller) {
    const compactCardWidth = isNarrowViewport ? "clamp(78px, 22vw, 104px)" : "clamp(96px, 12vw, 132px)";

    return (
      <div className={cn("relative w-full overflow-visible", className)}>
        {options.length > 2 ? (
          <>
            <button
              type="button"
              onClick={() => scrollCompactRail("left")}
              disabled={!canScrollLeft}
              className="absolute left-0 top-1/2 z-10 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)]/95 shadow-sm disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Scroll thumbnails left"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => scrollCompactRail("right")}
              disabled={!canScrollRight}
              className="absolute right-0 top-1/2 z-10 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)]/95 shadow-sm disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Scroll thumbnails right"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
        <div
          ref={scrollViewportRef}
          onScroll={updateScrollAffordances}
          className="h-full min-h-0 w-full overflow-x-auto overflow-y-visible px-6 py-0"
        >
          <div className="flex h-full min-h-0 min-w-max snap-x snap-mandatory items-stretch gap-1.5 pr-3">
            {options.map((opt, index) => {
              const key = opt.value || opt.label;
              const picked = selectedArray.includes(key);
              const disabled = Boolean(multiple && !picked && isAtSelectionCap);

              return (
                <motion.button
                  key={key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  disabled={disabled}
                  onClick={() => toggle(key)}
                  onMouseEnter={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setHoveredCompactOption({ label: opt.label, imageUrl: opt.imageUrl, rect });
                  }}
                  onMouseLeave={() => setHoveredCompactOption((current) => (current?.label === opt.label ? null : current))}
                  onFocus={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setHoveredCompactOption({ label: opt.label, imageUrl: opt.imageUrl, rect });
                  }}
                  onBlur={() => setHoveredCompactOption((current) => (current?.label === opt.label ? null : current))}
                  aria-disabled={disabled}
                  className={cn(
                    "group relative z-0 flex h-full min-h-0 shrink-0 snap-start flex-col overflow-hidden rounded-lg border bg-[var(--form-surface-color)] text-left transition-all duration-150",
                    picked ? "border-primary shadow-sm" : "border-[color:var(--form-surface-border-color)] hover:border-black/25",
                    disabled ? "cursor-not-allowed opacity-45" : "hover:z-20 hover:shadow-xl"
                  )}
                  style={{ width: compactCardWidth, borderRadius: `${theme.borderRadius}px` }}
                >
                  <div className="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-muted/30">
                    {opt.imageUrl ? (
                      <img
                        src={opt.imageUrl}
                        alt={opt.label}
                        loading="eager"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="h-full w-full animate-pulse bg-muted/40" />
                    )}
                  {!hideOptionText ? (
                    <div className="absolute inset-x-0 bottom-0 p-1">
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                      <div className="relative z-10 line-clamp-2 text-[clamp(8px,1.1vh,10px)] font-semibold leading-tight text-white">
                        {opt.label}
                      </div>
                    </div>
                  ) : null}
                  </div>
                  {picked ? (
                    <div className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-white shadow">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </div>
                  ) : null}
                </motion.button>
              );
            })}
          </div>
        </div>
        {canPortalPreview && hoveredCompactOption?.imageUrl
          ? createPortal(
              <div
                className="pointer-events-none fixed z-[9999] hidden sm:block"
                style={{
                  left: Math.max(12, hoveredCompactOption.rect.left + hoveredCompactOption.rect.width / 2 - 110),
                  top: Math.max(12, hoveredCompactOption.rect.top - 190),
                  width: 220,
                }}
              >
                <div
                  className="overflow-hidden border border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)] shadow-2xl"
                  style={{ borderRadius: `${theme.borderRadius + 4}px` }}
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-muted/30">
                    <img
                      src={hoveredCompactOption.imageUrl}
                      alt={hoveredCompactOption.label}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  {!hideOptionText ? (
                    <div className="px-2 py-1.5 text-[11px] font-medium leading-tight">
                      {hoveredCompactOption.label}
                    </div>
                  ) : null}
                </div>
              </div>,
              document.body
            )
          : null}
      </div>
    );
  }

  const requestedColumns = clampColumns(columns);
  const optionCount = Math.max(1, options.length);
  const isPricedExamples = displayMode === "priced_examples";
  const safeRequestedColumns = requestedColumns ? Math.min(requestedColumns, optionCount) : undefined;
  const mobileColumns = thumbnailMode
    ? (safeRequestedColumns ? Math.min(3, Math.max(1, safeRequestedColumns)) : (optionCount <= 2 ? 2 : 3))
    : (safeRequestedColumns ? Math.min(2, Math.max(1, safeRequestedColumns)) : Math.min(2, optionCount));
  const adaptiveDesktopColumns = safeRequestedColumns
    ? (
        thumbnailMode
          ? Math.min(4, Math.max(1, safeRequestedColumns))
          : optionCount <= 4
            ? optionCount
            : safeRequestedColumns
      )
    : thumbnailMode
      ? optionCount <= 2
        ? 2
        : optionCount <= 4
          ? optionCount
          : optionCount <= 8
            ? 4
            : 4
      : optionCount <= 2
        ? optionCount
        : optionCount <= 4
          ? optionCount
          : optionCount <= 8
            ? 3
            : 4;
  const gridColumns = isNarrowViewport ? mobileColumns : adaptiveDesktopColumns;
  return (
    <div
      className={cn(
        thumbnailMode
          ? "flex h-full min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden pr-1"
          : "w-full h-full min-h-0 overflow-y-auto overflow-x-hidden pr-1"
      )}
    >
      <div
        className={cn(
          "grid w-full min-w-0 content-start",
          thumbnailMode ? "gap-1.5 py-0 content-start" : isCompact ? "gap-3" : "gap-4",
          className
        )}
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, gridColumns)}, minmax(0, 1fr))`,
        }}
      >
        {options.map((opt, index) => {
          const key = opt.value || opt.label;
          const picked = selectedArray.includes(key);
          const disabled = Boolean(multiple && !picked && isAtSelectionCap);

          return (
            <motion.button
              key={key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              disabled={disabled || Boolean(opt.disabled)}
              onClick={() => toggle(key)}
              aria-disabled={disabled || Boolean(opt.disabled)}
              className={cn(
                "group relative flex h-full min-h-0 min-w-0 flex-col transition-all",
                thumbnailMode ? "overflow-hidden rounded-lg border" : "overflow-hidden rounded-2xl border-4",
                isPricedExamples
                  ? "transform-gpu shadow-sm hover:shadow-xl active:scale-[0.985] md:hover:scale-[1.03] md:hover:-translate-y-0.5"
                  : desktopThumbnailMode
                    ? "transform-gpu hover:scale-[1.06] hover:-translate-y-0.5 hover:z-10 hover:shadow-xl"
                    : null,
                disabled || opt.disabled ? "cursor-not-allowed opacity-45" : null,
                thumbnailMode
                  ? (picked ? "border-primary bg-transparent" : "border-black/10 bg-transparent hover:border-black/25")
                  : isPricedExamples
                    ? (picked ? "border-primary bg-black/[0.02]" : "border-black/10 bg-black/[0.02] hover:border-black/20")
                    : (picked ? "border-primary" : "border-transparent bg-muted/20")
              )}
              style={{ borderRadius: cardRadius }}
            >
              <div
                className={cn(
                  "relative w-full overflow-hidden bg-muted/30 min-h-0",
                  thumbnailMode
                    ? (isNarrowViewport ? "aspect-square min-w-0" : "aspect-[2/1] min-w-0")
                    : isPricedExamples
                      ? "aspect-[4/3] flex-1"
                      : isNarrowViewport
                      ? "aspect-[4/3] flex-1"
                      : "aspect-[16/10] flex-1"
                )}
              >
                {opt.imageUrl ? (
                  <img
                    src={opt.imageUrl}
                    alt={opt.label}
                    loading={thumbnailMode ? "eager" : "lazy"}
                    decoding="async"
                    className={cn(
                      "h-full w-full object-cover transition-transform",
                      isPricedExamples ? "group-hover:scale-[1.03]" : thumbnailMode ? "group-hover:scale-[1.02]" : "group-hover:scale-105"
                    )}
                  />
                ) : (
                  <div className="h-full w-full animate-pulse bg-muted/40" />
                )}
                {isPricedExamples ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3 text-left">
                    <div className="absolute inset-x-2 bottom-2 top-auto h-[4.25rem] rounded-2xl bg-black/35 backdrop-blur-sm" />
                    <div className="relative z-10">
                      <div className="text-sm font-semibold text-white drop-shadow-sm">
                        {formatPriceRangeLabel(opt.priceRange, pricingLocale) || "$••• - $•••"}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              {!hideOptionText && !isPricedExamples ? (
                <div className={cn(thumbnailMode ? "shrink-0 p-1" : isCompact ? "p-2.5" : "p-3", "text-left")}>
                  <div className={cn(thumbnailMode ? "text-[9px] sm:text-[10px]" : isCompact ? "text-[13px] sm:text-sm" : null, "font-bold leading-tight line-clamp-1")}>
                    {opt.label}
                  </div>
                  {!thumbnailMode && opt.description ? (
                  <div className={cn(thumbnailMode ? "text-[10px]" : isCompact ? "text-[11px]" : "text-xs", "text-muted-foreground")}>
                    {opt.description}
                  </div>
                  ) : null}
                </div>
              ) : null}
              {picked && (
              <div className={cn("absolute bg-primary text-white rounded-full", thumbnailMode ? "top-1 right-1 p-0.5" : "top-2 right-2 p-1 shadow-lg")}>
                <Check className={cn(thumbnailMode ? "w-3 h-3" : "w-4 h-4")} strokeWidth={3} />
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
