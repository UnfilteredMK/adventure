import * as React from "react"
import { cn } from "../../lib/utils"

interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: number[];
  onValueChange: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  compact?: boolean;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function quantizeToStep(value: number, min: number, max: number, step: number) {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return clamp(value, min, max);
  const snapped = Math.round((value - min) / s) * s + min;
  // Avoid floating precision artifacts (e.g. 0.30000000004)
  const fixed = Number(snapped.toFixed(6));
  return clamp(fixed, min, max);
}

function pct(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return ((value - min) / (max - min)) * 100;
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onValueChange, min = 0, max = 100, step = 1, compact = false, ...props }, ref) => {
    const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
    const safeMax = Number.isFinite(Number(max)) ? Number(max) : 100;
    const safeStep = Number.isFinite(Number(step)) && Number(step) > 0 ? Number(step) : 1;

    const isRange = Array.isArray(value) && value.length >= 2;
    const single = quantizeToStep(Number(value?.[0] ?? safeMin), safeMin, safeMax, safeStep);
    const rawLow = Number(value?.[0] ?? safeMin);
    const rawHigh = Number(value?.[1] ?? safeMax);
    const orderedLow = quantizeToStep(Math.min(rawLow, rawHigh), safeMin, safeMax, safeStep);
    const orderedHigh = quantizeToStep(Math.max(rawLow, rawHigh), safeMin, safeMax, safeStep);

    const [activeThumb, setActiveThumb] = React.useState<null | "min" | "max">(null);
    const clearActive = React.useCallback(() => setActiveThumb(null), []);

    const emitSingle = React.useCallback((n: number) => {
      onValueChange([quantizeToStep(n, safeMin, safeMax, safeStep)]);
    }, [onValueChange, safeMin, safeMax, safeStep]);

    const emitRange = React.useCallback((low: number, high: number) => {
      const nextLow = quantizeToStep(Math.min(low, high), safeMin, safeMax, safeStep);
      const nextHigh = quantizeToStep(Math.max(low, high), safeMin, safeMax, safeStep);
      onValueChange([nextLow, nextHigh]);
    }, [onValueChange, safeMin, safeMax, safeStep]);

    const handleSingleChange = (e: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) => {
      const t = e.target as HTMLInputElement;
      const newValue = parseFloat(t.value);
      emitSingle(newValue);
    };

    const handleMinChange = (e: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) => {
      const t = e.target as HTMLInputElement;
      const nextLow = parseFloat(t.value);
      emitRange(nextLow, orderedHigh);
    };

    const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>) => {
      const t = e.target as HTMLInputElement;
      const nextHigh = parseFloat(t.value);
      emitRange(orderedLow, nextHigh);
    };

    // Default stacking for range thumbs: whichever is closer to the end gets higher z-index,
    // but while dragging we always keep the active thumb on top.
    const mid = (safeMin + safeMax) / 2;
    const minZ = activeThumb === "min" ? 3 : orderedLow > mid ? 3 : 1;
    const maxZ = activeThumb === "max" ? 3 : orderedHigh <= mid ? 3 : 2;

    return (
      <div className={cn("relative flex w-full min-w-0 items-center", compact ? "h-6" : "h-8", className)}>
        {/* Track */}
        <div
          className={cn(
            "pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 rounded-full bg-black/10",
            compact ? "h-1" : "h-[6px]"
          )}
        />

        {/* Range highlight (only when using 2 thumbs) */}
        {isRange ? (
          <div
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full",
              compact ? "h-1" : "h-[6px]"
            )}
            style={{
              left: `${pct(orderedLow, safeMin, safeMax)}%`,
              width: `${Math.max(0, pct(orderedHigh, safeMin, safeMax) - pct(orderedLow, safeMin, safeMax))}%`,
              background: "var(--form-primary-color, #3b82f6)",
              opacity: 0.55,
            }}
          />
        ) : null}

        {/* Inputs */}
        {!isRange ? (
          <input
            type="range"
            min={safeMin}
            max={safeMax}
            step={safeStep}
            value={single}
            onChange={handleSingleChange}
            onInput={handleSingleChange as any}
            onPointerUp={clearActive}
            onPointerCancel={clearActive}
            className={cn(
              // `sif-range` is styled in `app/adventure/globals.css` (and can be added elsewhere) to create a larger thumb,
              // making it much easier to grab/drag on mobile.
              "absolute inset-0 w-full cursor-pointer",
              compact ? "sif-range sif-range--compact" : "sif-range",
            )}
            ref={ref}
            {...props}
          />
        ) : (
          <>
            <input
              type="range"
              min={safeMin}
              max={safeMax}
              step={safeStep}
              value={orderedLow}
              onChange={handleMinChange}
              onInput={handleMinChange as any}
              onPointerDown={() => setActiveThumb("min")}
              onPointerUp={clearActive}
              onPointerCancel={clearActive}
              className={cn("absolute inset-0 w-full cursor-pointer", compact ? "sif-range sif-range--compact" : "sif-range")}
              style={{ zIndex: minZ }}
              {...props}
            />
            <input
              type="range"
              min={safeMin}
              max={safeMax}
              step={safeStep}
              value={orderedHigh}
              onChange={handleMaxChange}
              onInput={handleMaxChange as any}
              onPointerDown={() => setActiveThumb("max")}
              onPointerUp={clearActive}
              onPointerCancel={clearActive}
              className={cn("absolute inset-0 w-full cursor-pointer", compact ? "sif-range sif-range--compact" : "sif-range")}
              style={{ zIndex: maxZ }}
              {...props}
            />
          </>
        )}
      </div>
    )
  }
)
Slider.displayName = "Slider"

export { Slider }
