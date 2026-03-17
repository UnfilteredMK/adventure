'use client';

import React, { useState } from 'react';
import { useFormTheme } from '../../../demo/FormThemeProvider';
import { detectCurrencyFromLocale, formatCurrency } from '@/lib/ai-form/utils/currency';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LeadGenPopover } from '@/components/form/steps/image-preview-experience/lead-gen/LeadGenPopover';

export interface PricingBreakdown {
  base: number;
  currency?: string;
  period?: string;
  lineItems?: Array<{
    label: string;
    amount: number;
    description?: string;
  }>;
  total?: number;
  totalMin?: number;
  totalMax?: number;
  features?: string[];
  description?: string;
}

type PricingExperiencePanelProps = {
  variant?: 'panel';
  pricing: PricingBreakdown | null;
  blurred?: boolean;
  leadCaptured?: boolean;
  instanceId?: string;
  sessionId?: string;
  gateContext?: string;
  designChoices?: Record<string, any>;
  onLeadCaptured?: () => void;
  className?: string;
};

type PricingExperiencePillProps = {
  variant: 'pill';
  price: string;
  revealed: boolean;
  instanceId?: string;
  sessionId?: string;
  gateContext?: string;
  submissionData?: Record<string, any>;
  label?: string;
  termsHref?: string;
  lockedPrice?: string;
  loading?: boolean;
  allowToggle?: boolean;
  autoReveal?: boolean;
  requirePhone?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
  style?: React.CSSProperties;
  accentColor?: string;
  transparentBackground?: boolean;
  containerClassName?: string;
  onRevealed?: () => void;
};

export type PricingExperienceProps = PricingExperiencePanelProps | PricingExperiencePillProps;

function hexToRgba(hex: string, alpha: number): string | null {
  const h = String(hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function withAlpha(color: string | undefined, alpha: number): string {
  const c = String(color || '').trim();
  const a = Math.max(0, Math.min(1, alpha));
  if (!c) return `rgba(15, 23, 42, ${a})`;
  const rgba = c.startsWith('#') ? hexToRgba(c, a) : null;
  if (rgba) return rgba;
  const pct = Math.round(a * 100);
  return `color-mix(in srgb, ${c} ${pct}%, transparent)`;
}

function maskedLockedParts(): { prefix: string; masked: string } {
  // Intentional, consistent mask: "$1" + "XXXXX" (only X's are blurred in UI)
  return { prefix: '$1', masked: 'XXXXX' };
}

export interface PricingPillProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label?: string;
  termsHref?: string;
  price: string;
  lockedPrice?: string;
  revealed: boolean;
  loading?: boolean;
  allowToggle?: boolean;
  autoReveal?: boolean;
  accentColor?: string;
  className?: string;
  /** When true, outer container is transparent and fills parent (for matching sibling pill styling) */
  transparentBackground?: boolean;
  containerClassName?: string;
}

// Keep locked state easy to scan: lock + "Show pricing" + masked value.
const PricingPill = React.forwardRef<HTMLButtonElement, PricingPillProps>(function PricingPill(
  {
    label,
    termsHref,
    price,
    lockedPrice,
    revealed,
    loading = false,
    allowToggle = true,
    autoReveal = true,
    accentColor,
    className,
    style: propsStyle,
    onClick,
    disabled,
    transparentBackground,
    containerClassName,
    ...props
  },
  ref
) {
  const effectiveDisabled = Boolean(disabled || (loading && revealed));
  const accent = typeof accentColor === 'string' && accentColor.trim().length > 0 ? accentColor.trim() : null;
  const lockedMask = maskedLockedParts();

  void termsHref;
  void lockedPrice;
  void allowToggle;
  void autoReveal;

  const rawLabel = (label && String(label).trim()) ? String(label).trim() : 'Show pricing';
  const pillLabel = rawLabel === 'Show pricing' ? 'Pricing' : rawLabel;
  const pricingFont = "'DM Mono', 'JetBrains Mono', 'IBM Plex Mono', monospace";
  const base = accent || '#0f172a';
  const tagBg = withAlpha(accent || base, 1);
  const transparentUsesFullWidth = Boolean(
    transparentBackground && /\bw-full\b/.test(`${containerClassName || ""} ${className || ""}`)
  );
  const labelWidthClass = transparentBackground
    ? transparentUsesFullWidth
      ? "w-full"
      : "w-auto max-w-full"
    : "w-[clamp(18rem,46vw,24rem)] max-w-[calc(100vw-2.5rem)]";
  const priceWidthClass = transparentBackground
    ? transparentUsesFullWidth
      ? "w-[min(100%,calc(100%-0.1rem))]"
      : "w-auto max-w-full"
    : "w-[clamp(19rem,48vw,25rem)] max-w-[calc(100vw-2rem)]";
  const revealedPriceClass = transparentBackground
    ? transparentUsesFullWidth
      ? "w-full min-w-0 px-[clamp(0.5rem,2vw,0.85rem)]"
      : "w-auto max-w-[calc(100vw-6rem)] self-center px-[0.85rem]"
    : priceWidthClass;
  // When transparentBackground, parent provides the bg - stay fully transparent to avoid double-layer/halo
  const outerBg = transparentBackground ? 'transparent' : tagBg;
  const pillOverflowClass = transparentBackground && !transparentUsesFullWidth ? "overflow-hidden" : "overflow-visible";
  return (
    <div
      className={cn(
        "relative w-auto h-full",
        pillOverflowClass,
        transparentBackground ? "border-0" : "rounded-[12%] border border-white/10",
        containerClassName
      )}
      style={{
        backgroundColor: outerBg,
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        width: transparentBackground ? (transparentUsesFullWidth ? '100%' : 'fit-content') : 'fit-content',
        minWidth: 'unset',
        maxWidth: 'calc(100vw - 2rem)',
      }}
    >
      <button
        ref={ref}
        type="button"
        disabled={effectiveDisabled}
        onClick={onClick}
        className={cn(
          'relative h-full rounded-[12%] text-white border-0 bg-white/[0.05] transition-all duration-200',
          pillOverflowClass,
          transparentBackground ? (transparentUsesFullWidth ? 'w-full' : 'w-auto max-w-full') : 'w-full',
          'hover:bg-white/[0.10] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
          'disabled:opacity-60 disabled:cursor-not-allowed',
          className
        )}
        style={{
          ...(propsStyle || {}),
          color: '#fff',
          ...(transparentBackground && propsStyle?.backgroundColor ? { backgroundColor: 'transparent' } : {}),
        }}
        {...props}
      >
        <div className="flex h-full w-full items-stretch">
          {!revealed ? (
            <div
              data-pricing-label-reveal
              className={cn("relative box-border flex w-full min-w-0 flex-1 flex-col justify-center items-stretch gap-[clamp(0.1rem,1cqi,0.22rem)] text-center pl-[clamp(0.35rem,3cqi,0.75rem)] pr-0 py-[clamp(0.15rem,1.5cqi,0.3rem)] min-h-[clamp(2.5rem,15cqi,4rem)]")}
            >
              <div
                data-pricing-label
                className={cn(
                  labelWidthClass,
                  "w-full min-w-0 inline-flex items-center justify-center gap-[0.35em]",
                  "text-[clamp(0.72rem,5.5cqi,1.9rem)] font-medium tracking-[0.03em] leading-[1.05] text-white uppercase"
                )}
                style={{ fontFamily: pricingFont }}
              >
                {pillLabel}
              </div>
              <div
                data-pricing-reveal
                className={cn(
                  "box-border inline-flex min-h-[clamp(1.75rem,12cqi,3rem)] w-full min-w-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] px-[clamp(0.25rem,2.5cqi,0.6rem)] py-[1.5%] text-[clamp(0.55rem,8cqi,2rem)] font-semibold tabular-nums text-white/95 select-none tracking-[0.01em] leading-none overflow-hidden"
                )}
                style={{ fontFamily: pricingFont }}
              >
                <span className="inline-flex items-center leading-none px-[0.12em] py-[0.05em]">
                  <span className="text-white/95 leading-none">{lockedMask.prefix}</span>
                  <span className="inline-flex items-center leading-none -ml-[0.02em]">
                    <span className="inline-block px-[0.03em] blur-[0.22em] opacity-90 leading-none">{lockedMask.masked}</span>
                  </span>
                </span>
              </div>
            </div>
          ) : (
            <div
              data-pricing-label-reveal
              className={cn("relative box-border flex w-full min-w-0 flex-1 flex-col justify-center items-stretch gap-[clamp(0.1rem,1cqi,0.22rem)] text-center pl-[clamp(0.35rem,3cqi,0.75rem)] pr-0 py-[clamp(0.15rem,1.5cqi,0.3rem)] min-h-[clamp(2.5rem,15cqi,4rem)]")}
            >
              <div
                data-pricing-label
                className={cn(
                  labelWidthClass,
                  "w-full min-w-0",
                  "text-[clamp(0.7rem,5cqi,1.1rem)] font-normal tracking-[0.02em] leading-[1.2] text-white/95"
                )}
                style={{ fontFamily: pricingFont }}
              >
                {pillLabel}
              </div>
              <div
                data-pricing-reveal
                className={cn(
                  revealedPriceClass,
                  "box-border inline-flex min-h-[clamp(1.75rem,12cqi,3rem)] min-w-0 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] px-[clamp(0.25rem,2.5cqi,0.6rem)] py-[1.5%] text-[clamp(0.55rem,8cqi,2rem)] font-semibold tabular-nums text-white/95 select-none tracking-[0.01em] leading-none overflow-hidden"
                )}
                style={{ fontFamily: pricingFont }}
              >
                {loading ? (
                  <span className="text-white/90 min-w-0">Calculating…</span>
                ) : (
                  <span className="min-w-0">{price}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </button>
    </div>
  );
});

function PricingExperiencePill(props: PricingExperiencePillProps) {
  const { theme } = useFormTheme();
  const {
    instanceId,
    sessionId,
    gateContext = 'design_and_estimate',
    submissionData,
    label = 'Estimated price range',
    termsHref,
    price,
    lockedPrice,
    revealed,
    allowToggle = true,
    autoReveal = true,
    loading = false,
    onClick,
    className,
    style,
    accentColor: accentColorProp,
    transparentBackground,
    containerClassName,
    onRevealed,
    requirePhone = true,
  } = props;

  const [open, setOpen] = useState(false);
  const leadGateEnabled = Boolean(instanceId && sessionId);

  const pill = (
    <PricingPill
      className={className}
      style={style}
      label={label}
      termsHref={termsHref}
      price={price}
      lockedPrice={lockedPrice}
      revealed={revealed}
      loading={loading}
      allowToggle={allowToggle}
      autoReveal={autoReveal}
      onClick={onClick}
      accentColor={accentColorProp ?? theme.primaryColor}
      transparentBackground={transparentBackground}
      containerClassName={containerClassName}
    />
  );

  if (!leadGateEnabled) return pill;
  if (revealed) return pill;

	  return (
	    <LeadGenPopover
	      open={open}
	      onOpenChange={setOpen}
	      instanceId={instanceId as string}
	      sessionId={sessionId as string}
	      gateContext={gateContext}
	      surface="overlay"
	      contentStyle={style}
	      title="Where should we send the pricing to?"
	      description="Enter your email to reveal pricing."
	      finePrint="Instant reveal after sending."
	      ctaLabel="Send pricing"
	      phoneTitle="Best phone number?"
	      phoneDescription="We can text updates too."
	      requirePhone={requirePhone}
	      submitOnEmail={false}
      submissionData={{ surface: 'preview_pricing', ...(submissionData || {}) }}
      onSubmitted={() => onRevealed?.()}
      side="top"
      align="center"
      sideOffset={8}
    >
      {pill}
    </LeadGenPopover>
  );
}

function PricingExperiencePanel(props: PricingExperiencePanelProps) {
  const { theme } = useFormTheme();

  const {
    pricing,
    blurred = true,
    leadCaptured = false,
    instanceId,
    sessionId,
    gateContext = 'estimate',
    designChoices = {},
    onLeadCaptured,
    className,
  } = props;

  const [showUnlockGate, setShowUnlockGate] = useState(false);
  const locale =
    typeof navigator !== 'undefined'
      ? ((navigator.languages && navigator.languages[0]) || navigator.language || undefined)
      : undefined;

  if (!pricing) {
    return (
      <div className={`border rounded-lg p-6 bg-white ${className || ''}`}>
        <p className="text-sm text-gray-500">Pricing will be calculated based on your selections</p>
      </div>
    );
  }

  const currency = (pricing.currency || detectCurrencyFromLocale(locale) || 'USD').toUpperCase();
  const total = pricing.total ?? pricing.base;
  const hasRange = typeof pricing.totalMin === 'number' && typeof pricing.totalMax === 'number';
  const rangeMin = hasRange ? Math.min(pricing.totalMin as number, pricing.totalMax as number) : null;
  const rangeMax = hasRange ? Math.max(pricing.totalMin as number, pricing.totalMax as number) : null;
  const formattedTotal = formatCurrency(total, { locale, currency });
  const formattedRangeMin = rangeMin !== null ? formatCurrency(rangeMin, { locale, currency }) : null;
  const formattedRangeMax = rangeMax !== null ? formatCurrency(rangeMax, { locale, currency }) : null;
  const formattedRange =
    rangeMin !== null && rangeMax !== null
      ? `${formattedRangeMin}-${formattedRangeMax}`
      : null;

  const isLocked = Boolean(blurred && !leadCaptured);
  const primaryColor = theme.primaryColor || '#3b82f6';
  const secondaryColor = theme.secondaryColor || primaryColor;

  return (
    <div className={`border rounded-lg p-6 bg-white ${className || ''}`}>
      <div className="relative">
        <div
          className={`space-y-4 transition ${isLocked ? 'blur-md opacity-70 saturate-50 contrast-75 pointer-events-none select-none' : ''}`}
        >
          {/* Header */}
          <div>
            <h3
              className="text-lg font-semibold mb-1"
              style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
            >
              Your personalized estimate is ready
            </h3>
            <p className="text-xs text-gray-500" style={{ fontFamily: theme.fontFamily }}>
              Exact pricing will be calculated once you unlock your estimate.
            </p>
          </div>

          {/* Total */}
          <div className="border-t pt-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-medium" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                {formattedRange ? 'Range' : 'Total'}
              </span>
              <div className="flex items-center gap-2">
                <div
                  className="text-[2.25rem] font-medium whitespace-nowrap tabular-nums tracking-[0.01em] leading-none text-white/95"
                  style={{ color: theme.primaryColor, fontFamily: theme.fontFamily }}
                >
                  {formattedRangeMin && formattedRangeMax ? (
                    <span className="inline-flex items-baseline gap-2">
                      <span>{formattedRangeMin}</span>
                      <span className="text-muted-foreground">–</span>
                      <span className="text-muted-foreground">{formattedRangeMax}</span>
                    </span>
                  ) : (
                    formattedTotal
                  )}
                  {pricing.period && !formattedRange && (
                    <span className="text-sm font-normal ml-1 text-gray-500">/ {pricing.period}</span>
                  )}
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-4 h-4 text-gray-400 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-xs">Exact pricing will be calculated once you unlock your estimate.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>

          {/* Line items */}
          {pricing.lineItems && pricing.lineItems.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              {pricing.lineItems.map((item, index) => (
                <div key={index} className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-sm" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                        {item.label}
                      </span>
                      {item.description && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3 h-3 text-gray-400 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">{item.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium ml-4" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                    {formatCurrency(item.amount, { locale, currency })}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Base price breakdown */}
          {pricing.lineItems && pricing.lineItems.length === 0 && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                  Base Price
                </span>
                <span className="text-sm font-medium" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                  {formatCurrency(pricing.base, { locale, currency })}
                </span>
              </div>
            </div>
          )}

          {/* Features */}
          {pricing.features && pricing.features.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-2" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                What’s Included:
              </h4>
              <ul className="space-y-1">
                {pricing.features.map((feature, index) => (
                  <li
                    key={index}
                    className="flex items-center gap-2 text-sm"
                    style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                  >
                    <span style={{ color: theme.primaryColor }}>✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Description */}
          {pricing.description && (
            <div className="border-t pt-4">
              <p className="text-xs text-gray-600" style={{ fontFamily: theme.fontFamily }}>
                {pricing.description}
              </p>
            </div>
          )}

          {/* Design choices impact (if any) */}
          {Object.keys(designChoices).length > 0 && (
            <div className="border-t pt-4">
              <p className="text-xs text-gray-500 mb-2" style={{ fontFamily: theme.fontFamily }}>
                Pricing reflects your current selections
              </p>
            </div>
          )}
        </div>

        {isLocked && (
          <div className="absolute inset-0 overflow-hidden rounded-lg">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `radial-gradient(110% 80% at 50% 20%, ${secondaryColor}2e 0%, rgba(0,0,0,0) 55%), linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.55))`,
              }}
            />
            <div className="absolute inset-0 bg-black/35" />
            <div className="relative flex h-full w-full items-center justify-center backdrop-blur-sm">
              <div className="text-center p-4 max-w-xs">
                <p className="text-sm font-medium mb-1">Your personalized estimate is ready</p>
                <p className="text-xs text-white/80 mb-3">Enter your email to see pricing and download options</p>
                {instanceId && sessionId ? (
                  <LeadGenPopover
                    open={showUnlockGate}
                    onOpenChange={setShowUnlockGate}
                    instanceId={instanceId}
                    sessionId={sessionId}
                    gateContext={gateContext}
                    surface="overlay"
                    contentStyle={{
                      ["--sif-overlay-bg" as any]: "rgba(51, 65, 85, 0.52)",
                      ["--sif-lead-gen-overlay-bg" as any]: "rgba(51, 65, 85, 0.52)",
                      ["--sif-lead-gen-fg" as any]: "rgba(255,255,255,0.95)",
                      ["--sif-lead-gen-muted" as any]: "rgba(255,255,255,0.72)",
                      ["--sif-lead-gen-input-bg" as any]: "rgba(255,255,255,0.12)",
                      ["--sif-lead-gen-input-border" as any]: "rgba(255,255,255,0.20)",
                      ["--sif-lead-gen-placeholder" as any]: "rgba(255,255,255,0.58)",
                      ["--sif-lead-gen-action-bg" as any]: "rgba(255,255,255,0.18)",
                      ["--sif-lead-gen-action-fg" as any]: "#ffffff",
                      ["--sif-lead-gen-action-border" as any]: "rgba(255,255,255,0.26)",
                      ["--sif-lead-gen-ring" as any]: "rgba(255,255,255,0.38)",
                    }}
                    title="Your personalized estimate is ready"
                    description="Enter your email to see pricing and download options"
                    finePrint="Instant unlock after sending."
                    ctaLabel="Unlock My Estimate"
                    requirePhone
                    submitOnEmail={false}
                    enableExitIntentSubmit
                    phoneTitle="Best phone number?"
                    phoneDescription="We can text updates too."
                    submissionData={{ surface: 'pricing_panel' }}
                    onSubmitted={() => onLeadCaptured?.()}
                  >
                    <Button
                      type="button"
                      className="h-9 px-4"
                      style={{
                        backgroundColor: theme.buttonStyle?.backgroundColor || theme.primaryColor,
                        color: theme.buttonStyle?.textColor || '#ffffff',
                      }}
                    >
                      Unlock My Estimate
                    </Button>
                  </LeadGenPopover>
                ) : (
                  <Button type="button" className="h-9 px-4" disabled>
                    Unlock My Estimate
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PricingExperience(props: PricingExperienceProps) {
  if (props.variant === 'pill') return <PricingExperiencePill {...(props as PricingExperiencePillProps)} />;
  return <PricingExperiencePanel {...(props as PricingExperiencePanelProps)} />;
}
