/**
 * Pricing lead gates: outcome-first email step + matching name/phone tone.
 * Popover spreads `PRICING_LEAD_COPY` only; centered modal also uses `PRICING_LEAD_MODAL`.
 */
export const PRICING_LEAD_COPY = {
  title: "See your exact price",
  description: "Where should we send it?",
  finePrint: "Instant reveal",
  ctaLabel: "Show my price",
  emailPlaceholder: "Enter your email",
  phoneTitle: "One last thing",
  phoneDescription: "We’ll text your price link — quick, not spammy.",
  phoneCtaLabel: "Show my price",
} as const;

/** Centered pricing sheet (email → name → phone); phone lines match `PRICING_LEAD_COPY`. */
export const PRICING_LEAD_MODAL = {
  nameTitle: "Almost there",
  nameDescription: "What should we call you?",
  namePlaceholder: "First name is fine",
  nameCtaLabel: "Continue",
  nameFinePrint: "Just to personalize your estimate.",
  phoneFinePrint: "Only texts that matter.",
} as const;
