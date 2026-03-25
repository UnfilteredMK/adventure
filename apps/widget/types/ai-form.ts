import type {
  UIStep as SharedUIStep,
  UIStepBlueprint as SharedUIStepBlueprint,
  UIStepType,
  UIOption,
  TextInputUI,
  MultipleChoiceUI,
  RatingUI,
  SliderUI,
  RangeSliderUI,
  FileUploadUI,
} from "@/types/ai-form-ui-contract";

export type { UIStepType, UIOption, TextInputUI, MultipleChoiceUI, RatingUI, SliderUI, RangeSliderUI, FileUploadUI };

export type UIStepBlueprint = SharedUIStepBlueprint & { family?: string | null };

type WithBlueprintFamily<T> = T extends { blueprint?: any }
  ? Omit<T, "blueprint"> & { blueprint?: UIStepBlueprint | null }
  : T;

export type UIStep = WithBlueprintFamily<SharedUIStep>;

// AI Form Types

export type ComponentType = 
  | 'choice' 
  | 'slider' 
  | 'upload' 
  | 'designer' 
  | 'pricing' 
  | 'confirmation' 
  | 'composite'
  | 'lead_capture'
  | 'gallery'
  | 'yes_no'
  | 'segmented_choice'
  | 'chips_multi'
  | 'image_choice_grid'
  | 'file_picker'
  | 'range_slider';

// Legacy chunk id (deprecated): kept only to avoid widespread edits. DSPy should not rely on chunking here.
export type ChunkId = "service" | "anchors" | "style" | "constraints" | "pricing" | "lead";

// StepIntent: explicit goal/purpose of a step (AI-visible + telemetry-friendly).
// This is intentionally small and stable.
export type StepIntent =
  | "collect_context"
  | "refine_preferences"
  | "visual_hook"
  | "collect_lead"
  | "show_pricing"
  | "confirmation";

export interface OptionDef {
  label: string;
  value?: string;
  description?: string;
  icon?: string;
  imageUrl?: string;
  image_url?: string;
}

export interface VisualDef {
  type: "image" | "icon" | "illustration";
  url: string;
  alt?: string;
  caption?: string;
}

/**
 * Composite step blocks: allow multiple UI blocks within a single step screen.
 * Example: show a visual gallery + a refinement question in the same step.
 */
export type CompositeBlock =
  | {
      kind: "visual_gallery";
      id: string;
      title?: string;
      description?: string;
      visuals: VisualDef[];
      layout?: "grid" | "masonry" | "single";
      columns?: number;
    }
  | {
      kind: "question";
      id: string;
      /** A nested question block rendered using the existing component system */
      step: StepDefinition;
    }
  | {
      kind: "markdown";
      id: string;
      text: string;
    };

export interface StepDefinition {
  id: string;
  componentType: ComponentType;
  intent: string; // Keep as string for backward compatibility
  data: any;
  copy?: {
    headline: string;
    subtext?: string;
    /** Layman-friendly explanation shown as a tooltip/modal. */
    helper?: string;
    /** Concrete example answers (2–4) to reduce uncertainty. */
    examples?: string[];
    /** Optional "typical" guidance for numeric questions. */
    typical?: { min?: number; max?: number; unit?: string; note?: string };
  };
  guardrails?: Record<string, any>;
  skipCondition?: (stepData: Record<string, any>) => boolean;

  // V2 fields (all optional for backward compatibility)
  /** Structured intent information */
  intentV2?: {
    goal: string; // What this step is trying to learn or accomplish
    /** Explicit step goal category (AI-visible + telemetry-friendly). */
    stepIntent?: StepIntent;
    confidenceImpact?: number; // Expected contribution (0–1)
    chunk?: ChunkId; // Which chunk this step belongs to
  };

  /** Structured content definition */
  content?: {
    prompt: string; // Primary user-facing question
    helperText?: string; // Additional context or explanation
    options?: OptionDef[]; // Structured options (preferred over data.options)
    visuals?: VisualDef[]; // Visual assets for this step
    /** Minimum number of options to show (for visual-heavy components, prefer 4-6) */
    minOptions?: number;
    /** Maximum number of options (for choice components, prefer 5-10) */
    maxOptions?: number;
    /** Whether options should be primarily visual (images/icons) vs text */
    visualFirst?: boolean;
    /** Group options into categories */
    optionGroups?: {
      label: string;
      options: OptionDef[];
    }[];
  };

  /** Interaction model definition */
  interaction?: {
    mode: "single" | "multi" | "freeform" | "passive";
    required?: boolean;
    maxSelections?: number;
    minSelections?: number;
    allowCustom?: boolean; // Allow user to enter custom value (e.g., "Other" option)
    customInputPlaceholder?: string; // Placeholder for custom input field
    validation?: {
      type?: "email" | "phone" | "url" | "number" | "text";
      min?: number;
      max?: number;
      pattern?: string; // Regex pattern
      errorMessage?: string;
    };
  };

  /** Presentation hints for rendering */
  presentation?: {
    tone?: "friendly" | "premium" | "direct";
    emphasis?: "visual" | "text" | "balanced";
    density?: "compact" | "comfortable" | "spacious";
    variant?: "hero" | "grid" | "compact" | "immersive" | "list" | "cards";
    affordances?: string[]; // e.g., ["tap-images", "swipe", "drag-drop"]
    /** Show progress indicator */
    showProgress?: boolean;
    /** Show step number */
    showStepNumber?: boolean;
    /** Icon or emoji to display with the question */
    icon?: string;
    /** Background color or gradient */
    backgroundColor?: string;
  };

  /** Constraints and requirements */
  constraints?: {
    mustCollect?: string[]; // Dimensions this step must resolve
    forbiddenTopics?: string[];
    timeBudgetMs?: number;
  };

  /** AI enhancement hints */
  aiHints?: {
    copyEditable?: boolean; // Allow AI to enhance copy
    layoutAdaptive?: boolean; // Allow AI to suggest layout adjustments
    explainWhy?: boolean; // Generate "why we ask this" helper text
  };

  /**
   * Composite steps can render multiple blocks on one screen.
   * When componentType === "composite", this should be provided.
   */
  blocks?: CompositeBlock[];

  /** Variation selection (new) - allows DSPy to choose between different component compositions */
  variation?: {
    stepIntent: StepIntent;
    variationId: string; // Which variation was chosen
    componentTree?: any; // Resolved component tree (optional, for debugging)
  };

  /** Psychological friction level - used for buyer journey guardrails */
  friction_level?: "low" | "medium" | "high";
}

/**
 * Form Plan Item - Question intent from Form Planner
 * Represents what information we need, not how to ask it
 * 
 * Synced with Pydantic FormPlanItem model in dspy/modules/signatures/flow_signatures.py
 */
export interface FormPlanItem {
  /** Unique identifier for this question */
  key: string;
  /** What this question accomplishes */
  goal: string;
  /** Why this question is needed (how it helps prompt) */
  why: string;
  /** High-level component type suggestion */
  component_hint: ComponentType;
  /** Importance level */
  priority: "critical" | "high" | "medium" | "low";
  /** How much this fills the context cup (0.0-1.0). Sum of answered questions' importance_weight = satiety */
  importance_weight: number;
  /** Expected confidence increase from this question (0.0-1.0). Used for adaptive questioning. */
  expected_metric_gain: number;
}

export type BatchAction =
  | { type: "form"; endpoint?: string | null }
  | { type: "image"; endpoint: string };

/**
 * Mini-schemas (abstract generation layer)
 *
 * DSPy BatchGenerator outputs MiniSteps. We then deterministically map MiniSteps -> StepDefinition
 * using existing UI component contracts (ComponentType).
 * 
 * Replaced by shared/ai-form-ui-contract/schema/ui_step.types.ts
 */
export type MiniStepType = UIStepType;

export type MiniBatchId = string; // Simple ID for telemetry tracking (e.g., "batch-0", "batch-1")

export type MiniStepBase = UIStep; // UIStep is already the union

export type MiniOption = UIOption;

export type TextInputMini = TextInputUI;

export type MultipleChoiceMini = MultipleChoiceUI;

export type RatingMini = RatingUI;

export type RefinementComponent = {
  key: string;
  label: string;
  priority: number;
};

export type FormState = {
  formId: string;
  batchIndex: number;
  /**
   * Backend-owned call cap (do not default or enforce client-side).
   * If present, it should come from the backend response, not a frontend constant.
   */
  maxBatches?: number;
  tokenBudgetTotal: number;
  tokensUsedSoFar: number;
  /** Question step IDs already shown to the user (answered or not). */
  askedStepIds: string[];
  /**
   * Monotonic flow progress (0..1) based on cumulative step `metric_gain`.
   * This is intentionally NOT derived from "answered/total" because we add new steps after the first answers.
   */
  metricProgress?: number;
  /**
   * Step IDs that have already been counted toward `metricProgress`.
   * Prevents double-counting if a user revisits/edits an answer.
   */
  metricProgressCountedStepIds?: string[];
  /**
   * @deprecated Use `askedStepIds`. Kept for backward compatibility with older localStorage state.
   */
  alreadyAskedKeys?: string[];
  /** Total number of question steps in the current plan (updated when backend returns new steps). */
  totalQuestionSteps?: number;
  /** Number of question steps the user has answered so far. */
  answeredQuestionCount?: number;
  batchPlan?: string[];
  /**
   * Human-readable "what this service does" summary.
   * Seeded from instance DB column `company_summary` (and optionally appended with per-service `service_summary`).
   * Used as shared context for both generate-steps and generate-image calls.
   */
  serviceSummary?: string | null;
  /** Optional business description (e.g. "Demo Bathroom remodeler"). */
  businessContext?: string | null;
  /** Selected step-1 service id for the current session. */
  selectedServiceId?: string | null;
  /** Supported refinement components for the selected service. */
  selectedServiceRefinementComponents?: RefinementComponent[] | null;
  /**
   * Optional user identity hints captured mid-flow (used for personalization).
   * Stored in session-scoped form state (resets when sessionId changes).
   */
  userFullName?: string | null;
  userFirstName?: string | null;
  /**
   * Lead-gate bookkeeping (session-scoped).
   * `leadCaptured` should represent "primary gate unlocked" for this session.
   */
  leadCaptured?: boolean;
  leadEmail?: string | null;
  leadCapturedAt?: number | null;
  leadGates?: Record<
    string,
    {
      shownAt?: number | null;
      completedAt?: number | null;
      dismissedAt?: number | null;
    }
  >;
  schemaVersion?: string;
};

export type FileUploadMini = FileUploadUI;

export type MiniStep = UIStep;

export interface MiniBatchConstraints {
  batchId: MiniBatchId;
  maxSteps: number;
  maxTokens?: number;
  allowedMiniTypes: MiniStepType[];
}

export interface FlowPlan {
  steps: (StepDefinition | UIStep)[];
  designerStepIndex?: number;
  leadCaptureStepIndex?: number;
  maxSteps: number;
  sessionId: string;
  mode?: "hybrid" | "local_skeleton";
  skeletonVersion?: string | null;
  /** Structural steps (upload/designer/lead/pricing/confirmation) to append only after Prompt Confidence is 100%. */
  structuralSteps?: StepDefinition[];
  /** Optional: look-ahead batch from backend (perf optimization). */
  lookAheadSteps?: StepDefinition[];
  potentialSatiety?: number;
}

export interface StepState {
  currentStepIndex: number;
  steps: (StepDefinition | UIStep)[];
  completedSteps: Set<string>;
  stepData: Record<string, any>;
  sessionId: string;
  skeletonVersion?: string | null;
}

export interface Step {
  id: string;
  componentType: ComponentType;
  data: any;
  completed: boolean;
  copy: { headline: string; subtext?: string };
  guardrails?: Record<string, any>;
}

export interface AIFormConfig {
  maxSteps?: number;
  maxImages?: number;
  allowedBuyerRefinements?: string[];
  requiredInputs?: string[];
  pricingVisibility?: 'always' | 'after_designer' | 'never';
  /**
   * How pricing should be shown when pricingVisibility allows it.
   * - hidden: don’t show prices (even if pricing step exists)
   * - range: show a range (safe default)
   * - exact: show exact totals (guardrail-controlled)
   */
  pricingMode?: 'hidden' | 'range' | 'exact';
  /**
   * If true, pricing can be shown before lead capture (when pricingVisibility allows).
   * If false, planner should route to lead capture before pricing.
   */
  quoteBeforeLead?: boolean;
  /** If true, show upgrades/alternatives post-designer (guardrail). */
  upgradesEnabled?: boolean;
  /** Confidence threshold to unlock uploads/generation. */
  minConfidenceForUploads?: number;
  /** Confidence threshold to unlock pricing (if used separately). */
  minConfidenceForPricing?: number;
  /** Maximum number of qualify questions before we force the next required step. */
  maxQualifyQuestions?: number;
  /** Minimum number of refinement questions before we allow the first visual (designer). */
  minQuestionsBeforeVisual?: number;
  /** If true, allow one refinement interaction after value is shown (before lead/pricing). */
  allowRefinement?: boolean;
  leadCaptureRequired?: boolean;
  businessContext?: string;
  industry?: string;
  services?: string[];
  /**
   * MVP pricing tease shown in image-gen surfaces (designer/gallery/preview).
   * Not a pricing engine; used only for an indicative range + lead gate.
   */
  previewPricing?: {
    totalMin: number;
    totalMax: number;
    currency?: string;
    /** Optional deterministic jitter (0.0–0.25 typical). */
    randomizePct?: number;
  };
}

export interface ModelOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  provider?: 'openai' | 'openrouter' | 'groq' | 'anthropic';
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  error?: string;
}

export interface StepMetrics {
  stepId: string;
  timeSpentMs: number;
  droppedOff: boolean;
  backNavigation: boolean;
  designerEngagement?: boolean;
  leadInputCompleted?: boolean;
  componentType?: string;
  confidence?: number;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface SessionMetrics {
  sessionId: string;
  instanceId: string;
  entrySource?: string;
  sessionGoal?: string;
  stepsCompleted: number;
  abandonedAtStep?: number;
  converted: boolean;
  leadCaptured: boolean;
  stepMetrics: StepMetrics[];
  metadata?: Record<string, any>;
  createdAt: Date;
}
