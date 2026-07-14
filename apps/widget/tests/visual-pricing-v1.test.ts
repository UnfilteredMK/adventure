import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveBudgetBands, normalizeReliableRange } from "../lib/visual-pricing/budget-bands";
import { isLookPhaseComplete, isProjectPhaseComplete } from "../lib/visual-pricing/completion";
import { assignPricingGateVariant } from "../lib/visual-pricing/experiment";
import { createLatestRequestSequence, mirrorBudgetBandAnswer } from "../lib/visual-pricing/state";
import { limitComponentPriorities, selectFeaturedStyles, toggleOrderedStyleSelection } from "../lib/visual-pricing/styles";
import { normalizeJourneySurface } from "../lib/visual-pricing/types";
import { extractAIFormConfig } from "../lib/ai-form/config/extract-ai-form-config";

const widgetRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("budget bands prefer reliable service tier ranges and merge premium through luxury", () => {
  const bands = deriveBudgetBands({
    source: "ai",
    currency: "usd",
    budgetTierRanges: {
      starter: { low: 10_000, high: 20_000 },
      standard: { low: 20_000, high: 40_000 },
      premium: { low: 40_000, high: 70_000 },
      luxury: { low: 70_000, high: 95_000 },
    },
  });
  assert.deepEqual(bands.map((band) => band.key), ["essential", "mid_range", "premium", "not_sure"]);
  assert.equal(bands[0].source, "budget_tier_ranges");
  assert.equal(bands[2].low, 40_000);
  assert.equal(bands[2].high, 95_000);
  assert.equal(bands[0].currency, "USD");
});

test("budget bands split a reliable service range into three rounded bands", () => {
  const bands = deriveBudgetBands({ source: "ai", servicePriceRange: { low: 12_000, high: 72_000 }, currency: "USD" });
  assert.equal(bands[0].source, "service_price_range");
  assert.equal(bands[0].low, 12_000);
  assert.equal(bands[2].high, 72_000);
  assert.ok(Number(bands[0].high) < Number(bands[1].high));
});

test("fallback, low-confidence, invalid, and overly broad ranges stay qualitative", () => {
  for (const seed of [
    { source: "fallback_preview", servicePriceRange: { low: 10_000, high: 50_000 } },
    { source: "ai", confidence: "low", servicePriceRange: { low: 10_000, high: 50_000 } },
    { source: "ai", servicePriceRange: { low: -1, high: 50_000 } },
    { source: "ai", servicePriceRange: { low: 5_000, high: 55_001 } },
  ]) {
    assert.ok(deriveBudgetBands(seed).every((band) => band.source === "qualitative"));
  }
  assert.equal(normalizeReliableRange({ low: 5_000, high: 50_000 })?.high, 50_000);
  assert.equal(normalizeReliableRange({ low: 5_000, high: 50_001 }), null);
});

test("budget selection mirrors the existing numeric key and Not sure clears it", () => {
  const numeric = mirrorBudgetBandAnswer({}, {
    key: "mid_range",
    label: "Mid-range",
    low: 20_000,
    high: 40_000,
    currency: "USD",
    source: "service_price_range",
  });
  assert.equal(numeric["step-budget-range"], 30_000);
  assert.equal(numeric["step-budget-band"].key, "mid_range");

  const unsure = mirrorBudgetBandAnswer(numeric, {
    key: "not_sure",
    label: "Not sure",
    currency: "USD",
    source: "qualitative",
  });
  assert.equal("step-budget-range" in unsure, false);
});

test("a newer pricing request invalidates a stale response", () => {
  const sequence = createLatestRequestSequence();
  const first = sequence.next();
  const second = sequence.next();
  assert.equal(sequence.isCurrent(first), false);
  assert.equal(sequence.isCurrent(second), true);
  sequence.invalidate();
  assert.equal(sequence.isCurrent(second), false);
});

test("pricing experiment assignment is deterministic and persisted for the session", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  const first = assignPricingGateVariant({
    strategy: "experiment",
    experimentPercent: 50,
    experimentKey: "gate-v1",
    instanceId: "instance-a",
    sessionId: "session-a",
    storage,
  });
  const afterConfigChange = assignPricingGateVariant({
    strategy: first === "blurred" ? "coarse_visible" : "blurred",
    experimentPercent: first === "blurred" ? 100 : 0,
    experimentKey: "gate-v1",
    instanceId: "instance-a",
    sessionId: "session-a",
    storage,
  });
  assert.equal(afterConfigChange, first);
  assert.equal(assignPricingGateVariant({ strategy: "experiment", experimentPercent: 100, instanceId: "i", sessionId: "s" }), "coarse_visible");
  assert.equal(assignPricingGateVariant({ strategy: "experiment", experimentPercent: 0, instanceId: "i", sessionId: "s" }), "blurred");
});

test("featured styles rank first and deterministically backfill fewer than six", () => {
  const options = Array.from({ length: 8 }, (_, index) => ({
    value: `style-${index}`,
    label: `Style ${index}`,
    featuredRank: index === 5 ? 1 : index === 2 ? 2 : null,
  }));
  const result = selectFeaturedStyles(options, 6);
  assert.deepEqual(result.featured.map((option) => option.value), ["style-5", "style-2", "style-0", "style-1", "style-3", "style-4"]);
  assert.deepEqual(result.remaining.map((option) => option.value), ["style-6", "style-7"]);
  assert.equal(selectFeaturedStyles(options.slice(0, 3), 6).featured.length, 3);
});

test("style and component limits preserve ordered V1 contracts", () => {
  assert.deepEqual(toggleOrderedStyleSelection([], "modern"), ["modern"]);
  assert.deepEqual(toggleOrderedStyleSelection(["modern"], "organic"), ["modern", "organic"]);
  assert.deepEqual(toggleOrderedStyleSelection(["modern", "organic"], "bold"), ["modern", "bold"]);
  assert.deepEqual(limitComponentPriorities(["a", "b", "c", "d", "e", "a"]), ["a", "b", "c", "d"]);
});

test("phase completion requires scope, conditional components, budget, and one or two styles", () => {
  const budget = { key: "not_sure", label: "Not sure", currency: "USD", source: "qualitative" } as const;
  assert.equal(isProjectPhaseComplete({ serviceId: "svc", scope: "full", componentKeys: [], componentsAvailable: false, budgetBand: budget }), true);
  assert.equal(isProjectPhaseComplete({ serviceId: "svc", scope: "full", componentKeys: [], componentsAvailable: true, budgetBand: budget }), false);
  assert.equal(isProjectPhaseComplete({ serviceId: "svc", scope: "full", componentKeys: ["tile"], componentsAvailable: true, budgetBand: budget }), true);
  assert.equal(isLookPhaseComplete([]), false);
  assert.equal(isLookPhaseComplete(["modern"]), true);
  assert.equal(isLookPhaseComplete(["modern", "organic"]), true);
  assert.equal(isLookPhaseComplete(["a", "b", "c"]), false);
});

test("rollout and surface normalization preserve canonical journey defaults", () => {
  const defaults = extractAIFormConfig({});
  assert.equal(defaults.visualPricingJourneyVersion, "legacy");
  assert.equal(defaults.pricingGateStrategy, "blurred");
  assert.equal(defaults.pricingGateExperimentPercent, 50);
  assert.equal(extractAIFormConfig({ visual_pricing_journey_version: "v1" }).visualPricingJourneyVersion, "legacy");
  assert.equal(extractAIFormConfig({ visual_pricing_journey_version: "studio_v1" }).visualPricingJourneyVersion, "studio_v1");
  assert.equal(normalizeJourneySurface(undefined), "page");
  assert.equal(normalizeJourneySurface("embed"), "embed");
  assert.equal(normalizeJourneySurface("popup"), "popup");
  assert.equal(normalizeJourneySurface("inline"), "inline");
  assert.equal(normalizeJourneySurface("unexpected"), "page");
});

test("canonical journey opens with one starter and expands it into the studio hero", () => {
  const styleStep = readFileSync(`${widgetRoot}/components/form/steps/static/deterministic-style-step.ts`, "utf8");
  const skeleton = readFileSync(`${widgetRoot}/components/form/steps/runtime/step-engine/utils/build-local-skeleton.ts`, "utf8");
  const body = readFileSync(`${widgetRoot}/components/form/steps/runtime/step-engine/sections/StepEngineBodySection.tsx`, "utf8");
  const grid = readFileSync(`${widgetRoot}/components/form/steps/step-screens/ImageChoiceGridStep.tsx`, "utf8");
  const stepLayout = readFileSync(`${widgetRoot}/components/form/steps/ui-layout/StepLayout.tsx`, "utf8");
  assert.match(styleStep, /multi_select:\s*false/);
  assert.match(styleStep, /\.slice\(0, 8\)/);
  assert.match(skeleton, /local-skeleton-v9-studio-repair/);
  assert.match(skeleton, /\[styleStep, \.\.\.scopeSteps/);
  assert.match(skeleton, /data\?\.required !== false/);
  assert.doesNotMatch(grid, /Use my project photo instead/);
  assert.doesNotMatch(grid, /One click opens the idea/);
  assert.doesNotMatch(grid, /Start with your actual space/);
  assert.match(grid, /isPricedGridStep \|\| isStyleStep/);
  assert.doesNotMatch(grid, /shadow-\[0_-12px_30px/);
  assert.match(stepLayout, /isStarterGalleryStep\s*\? "overflow-hidden"/);
  assert.match(body, /layoutId=\{starterConcept\?\.isProjectPhoto/);
  assert.match(body, /Back to ideas/);
  assert.match(body, /Want to see this in your space\? Add a photo/);
});

test("generation stays on one four-slot studio canvas without the duplicate priced grid", () => {
  const preview = readFileSync(`${widgetRoot}/components/form/steps/runtime/step-engine/sections/PreviewSection.tsx`, "utf8");
  const engine = readFileSync(`${widgetRoot}/components/form/steps/runtime/StepEngine.tsx`, "utf8");
  const header = readFileSync(`${widgetRoot}/components/form/steps/runtime/step-engine/sections/StepEngineHeaderSection.tsx`, "utf8");
  const canvas = readFileSync(`${widgetRoot}/components/form/steps/image-preview-experience/gallery/ImagePreviewExperience.tsx`, "utf8");
  assert.match(preview, /conceptCount=\{4\}/);
  assert.match(preview, /progressiveConcepts/);
  assert.match(preview, /studioGalleryActive/);
  assert.match(preview, /max-w-\[88rem\]/);
  assert.match(engine, /localSkeletonMode\s*\?\s*null\s*:\s*buildDeterministicPricedImageGridStep/);
  assert.match(engine, /suppressLegacyJourneyChrome = Boolean\(localSkeletonMode\)/);
  assert.match(canvas, /Your concepts are ready/);
  assert.match(canvas, /generated-concept:/);
  assert.match(canvas, /Creating your concepts…/);
  assert.match(canvas, /progressiveConcepts && shouldGenerateConceptGallery \? 1 : numOutputs/);
  assert.match(canvas, /Concept generation paused/);
  assert.match(canvas, /We couldn’t finish these concepts\. Try again in a moment\./);
  assert.match(canvas, /keepFailedConceptRun/);
  assert.doesNotMatch(canvas, />Built from</);
  assert.match(canvas, /Use this concept/);
  assert.match(canvas, /Personalized concept stack/);
  assert.match(canvas, /drag="x"/);
  assert.match(canvas, /showConcept/);
  assert.match(canvas, /h-full min-h-\[15rem\] w-full/);
  assert.match(canvas, /handleUseConcept/);
  assert.match(canvas, /max-w-\[72rem\]/);
  assert.match(canvas, /absolute left-3 top-1\/2/);
  assert.match(canvas, /absolute right-3 top-1\/2/);
  assert.doesNotMatch(canvas, /desktopFilmstripColumns/);
  assert.match(canvas, /selectedOptionReferenceImages\.length > 0/);
  assert.match(canvas, /referenceMode = "guide_only"/);
  assert.match(header, /aria-label="Design progress"/);
  assert.match(engine, /Starting point/);
  assert.match(engine, /phaseKey === "estimate"/);
  assert.match(engine, /onNavigateStudioPhase/);
  assert.match(engine, /selectedConceptIndex: null,[\s\S]*viewMode: "gallery"/);
});

test("estimate uses the cohesive studio composition without the legacy question rail", () => {
  const engine = readFileSync(`${widgetRoot}/components/form/steps/runtime/StepEngine.tsx`, "utf8");
  const body = readFileSync(`${widgetRoot}/components/form/steps/runtime/step-engine/sections/StepEngineBodySection.tsx`, "utf8");
  const preview = readFileSync(`${widgetRoot}/components/form/steps/runtime/step-engine/sections/PreviewSection.tsx`, "utf8");
  const canvas = readFileSync(`${widgetRoot}/components/form/steps/image-preview-experience/gallery/ImagePreviewExperience.tsx`, "utf8");
  const leadCopy = readFileSync(`${widgetRoot}/components/form/steps/image-preview-experience/lead-gen/pricingLeadCopy.ts`, "utf8");
  assert.match(engine, /studioEstimatePresentationActive/);
  assert.match(engine, /hideQuestionPaneUntilConceptSingle \|\|\s*studioEstimatePresentationActive/);
  assert.match(body, /studioEstimateMode[\s\S]*flex min-h-0 flex-col overflow-hidden/);
  assert.match(preview, /studioEstimateMode=\{studioEstimateMode\}/);
  assert.match(preview, /autoRegenerateEveryNAnsweredQuestions=\{studioEstimateMode \? 0 : 2\}/);
  assert.match(canvas, /max-w-\[88rem\]/);
  assert.match(canvas, /aria-label="Refine this concept"/);
  assert.match(canvas, /Unlock detailed estimate/);
  assert.match(canvas, /Preliminary estimate/);
  assert.match(canvas, /leadGateEnabled && !leadCaptured[\s\S]*formatCompactCurrency/);
  assert.match(canvas, /pricingGateVariant === "coarse_visible"/);
  assert.match(canvas, /Preliminary estimate ready/);
  assert.doesNotMatch(canvas, /\["Project scope", "Selected direction", "Budget"\]/);
  assert.match(canvas, /visibleStudioSuggestions\.map/);
  assert.match(canvas, /More ideas/);
  assert.match(canvas, /studioEstimateMode && reason === "auto"/);
  assert.match(canvas, /studioEstimateActive \? \([\s\S]*overflow-hidden/);
  assert.match(canvas, /applyStudioRefinement/);
  assert.match(canvas, /Applying your change…/);
  assert.doesNotMatch(canvas, /View my estimate/);
  assert.doesNotMatch(canvas, /studioDirectionSummary/);
  assert.match(canvas, /Back to concepts/);
  assert.match(leadCopy, /Want to keep refining this\?/);
  assert.match(canvas, /singleModePreviewChrome = Boolean\(hero && !showConceptPicker && toolingEnabled && !studioEstimateActive\)/);
});

test("launch resize bridge validates source, origin, instance, phase, and bounded height", () => {
  const launch = readFileSync(`${repoRoot}/apps/designer/src/components/features/LaunchTab.tsx`, "utf8");
  assert.match(launch, /event\.source !== iframe\.contentWindow/);
  assert.match(launch, /event\.origin !== expectedOrigin/);
  assert.match(launch, /data\.instanceId !== INSTANCE_ID/);
  assert.match(launch, /VALID_PHASES\.has\(data\.phase\)/);
  assert.match(launch, /nextHeight < 320 \|\| nextHeight > 5000/);
  const popupBlock = launch.slice(launch.indexOf("const buildPopupEmbedCode"), launch.indexOf("const hasAiForm"));
  assert.doesNotMatch(popupBlock, /ADVENTURE_RESIZE/);
});

test("production route uses the canonical StepEngine-backed form", () => {
  const route = readFileSync(`${widgetRoot}/app/adventure/[instanceId]/page.tsx`, "utf8");
  assert.match(route, /<AdventureFormExperience/);
  assert.doesNotMatch(route, /<VisualPricingJourney/);
});
