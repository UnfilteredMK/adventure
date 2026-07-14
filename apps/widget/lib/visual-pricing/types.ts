export type JourneyPhase = "project" | "look" | "concepts" | "estimate";

export const JOURNEY_PHASES: ReadonlyArray<{ key: JourneyPhase; label: string }> = [
  { key: "project", label: "Project" },
  { key: "look", label: "Look" },
  { key: "concepts", label: "Concepts" },
  { key: "estimate", label: "Estimate" },
];

export type VisualPricingJourneyVersion = "legacy" | "studio_v1";
export type JourneySurface = "page" | "embed" | "popup" | "inline";
export type PricingGateStrategy = "blurred" | "coarse_visible" | "experiment";
export type PricingGateVariant = "blurred" | "coarse_visible";

export type BudgetBandKey = "essential" | "mid_range" | "premium" | "not_sure";
export type BudgetBandSource = "qualitative" | "budget_tier_ranges" | "service_price_range";

export type BudgetBand = {
  key: BudgetBandKey;
  label: string;
  low?: number;
  high?: number;
  currency: string;
  source: BudgetBandSource;
};

export type JourneyStyleOption = {
  label: string;
  value: string;
  imageUrl?: string | null;
  description?: string | null;
  priceTier?: string | null;
  featuredRank?: number | null;
};

export type JourneyServiceOption = {
  label: string;
  value: string;
  serviceName?: string | null;
  serviceSummary?: string | null;
  industryId?: string | null;
  industryName?: string | null;
  subcategoryScope?: string[];
  subcategoryComponents?: Array<{ key: string; label: string; priority: number }>;
  styleQuestion?: string | null;
  styleOptions?: JourneyStyleOption[];
};

export function normalizeJourneySurface(raw: unknown): JourneySurface {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "embed" || value === "popup" || value === "inline") return value;
  return "page";
}
