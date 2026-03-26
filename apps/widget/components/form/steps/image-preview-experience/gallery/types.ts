"use client";

export type PreviewCacheV2 = {
  schemaVersion: 2;
  status: "idle" | "running" | "complete" | "error";
  images: string[];
  message?: string | null;
  error?: string | null;
  refinementNote?: string | null;
  runStartedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  lastContextSignature?: string | null;
  generatedForContextSignature?: string | null;
};

export type CachedPricing = {
  totalMin: number;
  totalMax: number;
  currency: string;
  imagePriceRange?: { low: number; high: number };
  servicePriceRange?: { low: number; high: number };
  baselinePriceRange?: { low: number; high: number };
  deltaPriceRange?: { low: number; high: number };
  deltaDirection?: "up" | "down" | "flat";
  budgetTier?: string;
  budgetTierRanges?: Record<string, { low: number; high: number }>;
  priceDrivers?: Array<{ key: string; label: string }>;
  calibrationKey?: string;
};

export type PricingRequestInputs = {
  answeredQA: Array<{ stepId: string; question: string; answer: any }>;
  askedStepIds: string[];
  instanceContext: {
    businessContext?: any;
    serviceSummary?: string | null;
  };
  previewImageUrl?: string | null;
  pricingScenario?: "initial" | "comparison" | "refinement";
  baselineImageUrl?: string | null;
  baselinePriceRange?: { low: number; high: number } | null;
  changedRefinementKeys?: Array<{ key: string; label: string }>;
  budgetRange?: number | null;
};

export type PreviewRun = {
  id: string;
  createdAt: number;
  contextSignature: string;
  answeredQuestionCount?: number | null;
  images: string[];
  expectedImageCount?: number | null;
  message?: string | null;
  stepDataSnapshot?: Record<string, any>;
  imagePricing?: (CachedPricing | undefined)[];
};

export type PreviewViewMode = "gallery" | "single";

export type PreviewCacheV3 = {
  schemaVersion: 3;
  status: "idle" | "running" | "complete" | "error";
  runs: PreviewRun[];
  activeRunId?: string | null;
  selectedConceptIndex?: number | null;
  viewMode?: PreviewViewMode | null;
  message?: string | null;
  error?: string | null;
  errorDetails?: string | null;
  refinementNote?: string | null;
  runStartedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  lastContextSignature?: string | null;
  generatedForContextSignature?: string | null;
  lastGeneratedAnsweredCount?: number | null;
  overlayPricingCollapsed?: boolean;
};

export type NavigationTransition = {
  key: string;
  fromRunId: string;
  toRunId: string;
  fromImage: string;
  toImage: string;
  direction: -1 | 1;
};

export type PreviewStackLayer = {
  key: string;
  src: string;
  kind: "transition" | "history";
};
