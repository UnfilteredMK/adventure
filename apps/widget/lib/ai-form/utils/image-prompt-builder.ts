/**
 * Image Prompt Builder
 *
 * Builds deterministic image generation prompts using the TypeScript builder.
 */

import type { ContextState } from "../state/context-state";
import type { PromptState } from "../context/prompt-state";
import { generateDesignerPrompt, prepareDesignerInput, type DesignerInput } from "./designer";

export type ModelRecommendation = {
  modelId?: string;
  guidanceScale?: number;
  numInferenceSteps?: number;
  maxReferenceImages?: number;
  aspectRatio?: string;
  outputFormat?: string;
  promptUpsampling?: boolean;
};

export type ImagePromptResult = {
  prompt: string;
  negativePrompt?: string;
  modelRecommendation?: ModelRecommendation;
  metadata?: {
    confidence?: number;
    completeness?: number;
    styleKeywords?: string[];
    technicalNotes?: string;
  };
  error?: string;
  fromDSPy?: boolean;
};

/**
 * Local-only prompt builder fallback.
 *
 * Prompt generation for real image requests now happens server-side inside `/api/generate`.
 * This helper remains available only for non-API local fallback usage.
 */
export async function buildImagePromptViaDSPy(params: {
  contextState: ContextState;
  service?: string | null;
  useCase: "tryon" | "scene-placement" | "scene-refinement" | "scene";
  industry?: string | null;
  businessContext?: string | null;
  previousPrompt?: string | null;
  refinementNotes?: string | null;
  steps?: any[];
  stepDataSoFar?: Record<string, any>;
  instanceId?: string;
  sessionId?: string;
  referenceImages?: string[];
  sceneImage?: string | null;
  productImage?: string | null;
  answeredQA?: Array<{ stepId?: string; question?: string; answer?: any }>;
  instanceContext?: Record<string, any> | null;
  generationIntent?: "initial" | "small_improvement" | "regenerate";
  originalReferenceImage?: string | null;
  generationIndex?: number;
}): Promise<ImagePromptResult> {
  const {
    contextState,
    service,
    useCase,
    industry,
    businessContext,
    steps = [],
    stepDataSoFar = {},
  } = params;

  return buildImagePromptFallback({ contextState, service, useCase, industry, businessContext, steps, stepDataSoFar });
}

/**
 * Fallback TypeScript prompt builder (used when DSPy unavailable)
 */
function buildImagePromptFallback(params: {
  contextState: ContextState;
  service?: string | null;
  useCase: "tryon" | "scene-placement" | "scene-refinement" | "scene";
  industry?: string | null;
  businessContext?: string | null;
  steps?: any[];
  stepDataSoFar?: Record<string, any>;
}): ImagePromptResult {
  const {
    contextState,
    service,
    useCase,
    industry,
    businessContext,
    steps = [],
    stepDataSoFar = {},
  } = params;

  // Build designer input from context state
  const designerInput: DesignerInput = {
    businessContext: businessContext || undefined,
    industry: industry || undefined,
    subcategoryName: service || undefined,
    promptState: contextState.promptState,
    preferences: {},
    previousAnswers: {},
  };

  // Extract preferences and answers from context entries
  for (const entry of contextState.entries) {
    const key = entry.stepId.replace(/^step-/, "").replace(/-/g, "_");
    designerInput.previousAnswers![key] = entry.answer;
    
    // Extract style-related preferences
    const questionLower = String((entry as any)?.question || "").toLowerCase();
    if (
      questionLower.includes("style") ||
      questionLower.includes("color") ||
      questionLower.includes("material") ||
      questionLower.includes("preference") ||
      questionLower.includes("design")
    ) {
      designerInput.preferences![key] = entry.answer;
    }
  }

  // Generate prompt using existing TypeScript builder
  const prompt = generateDesignerPrompt(designerInput);

  // Build negative prompt from exclusions
  const negativePromptParts: string[] = [];
  if (contextState.promptState.exclusions && contextState.promptState.exclusions.length > 0) {
    for (const exclusion of contextState.promptState.exclusions.slice(0, 5)) {
      negativePromptParts.push(String(exclusion.value));
    }
  }
  const negativePrompt = negativePromptParts.join(", ");

  // Extract style keywords from context
  const styleKeywords: string[] = [];
  for (const entry of contextState.entries) {
    if (typeof entry.answer === "string") {
      const words = entry.answer.split(/\s+/).filter((w) => w.length > 3);
      styleKeywords.push(...words.slice(0, 3));
    }
  }

  return {
    prompt,
    negativePrompt: negativePrompt || undefined,
    metadata: {
      confidence: contextState.confidence,
      completeness: contextState.isComplete ? 1.0 : contextState.confidence,
      styleKeywords: styleKeywords.slice(0, 10),
      technicalNotes: "Generated using TypeScript fallback builder",
    },
    fromDSPy: false,
  };
}

/**
 * Cache key for prompt caching
 */
export function getPromptCacheKey(params: {
  contextState: ContextState;
  service?: string | null;
  useCase: string;
  previousPrompt?: string | null;
}): string {
  const { contextState, service, useCase, previousPrompt } = params;
  
  // Create a hash-like key from context state
  const entriesKey = contextState.entries
    .map((e) => `${e.stepId}:${JSON.stringify(e.answer)}`)
    .join("|");
  
  return `${useCase}:${service || "general"}:${contextState.confidence.toFixed(2)}:${previousPrompt || ""}:${entriesKey}`;
}
