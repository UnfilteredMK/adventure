import type { Json } from "@/types/database";
import { IMAGES_BUCKET, IMAGE_STORAGE_PREFIXES } from "@/storage/prefixes";
import refinementSupportedComponents from "./refinement-supported-components.json";

export const REFINEMENT_OPTION_GENERATED_FOR = "refinement_option";
export const REFINEMENT_OPTION_MODEL_ID = "black-forest-labs/flux-schnell";
export const REFINEMENT_LIBRARY_TARGET_CATEGORIES = 10;
export const REFINEMENT_LIBRARY_MIN_CATEGORIES = 10;
export const REFINEMENT_LIBRARY_MAX_CATEGORIES = 10;
export const REFINEMENT_LIBRARY_MIN_IMAGES_PER_CATEGORY = 6;

export type RefinementPlannerCategory = {
  canonical_key: string;
  label: string;
  priority: number;
  raw_name: string;
  reason: string;
  template_key: string;
};

export type StoredSubcategoryComponent = {
  key: string;
  label: string;
  priority: number;
};

export type RefinementTemplateOption = {
  imagePrompt: string;
  label: string;
  value: string;
  variationKey: string;
};

type RefinementImageRow = {
  account_id: string | null;
  created_at: string | null;
  id: string;
  image_url: string;
  instance_id: string | null;
  metadata: Record<string, any> | null;
  prompt_id: string | null;
  status: string | null;
  subcategory_id: string | null;
  user_id: string | null;
};

type CoverageItem = {
  count: number;
  images: RefinementImageRow[];
  label: string;
  priority: number;
  reason: string;
  templateKey: string;
  variationKeys: Set<string>;
};

type TemplateSeed = {
  imagePrompt: string;
  label: string;
};

type SupportedRefinementComponentManifestItem = {
  aliases?: string[];
  key: string;
  label: string;
  templateKey: string;
};

const BASE_PHOTO_PREFIX =
  "Photorealistic photo of one finished scene, not a split-screen or before-and-after layout. No text, no words, no letters, no labels, no captions, no watermarks, no signs.";

const TEMPLATE_LABELS: Record<string, { label: string; templateKey: string }> = {
  backsplash_tile: { label: "Backsplash Tile", templateKey: "backsplash_tile_v1" },
  cabinets: { label: "Cabinets", templateKey: "cabinets_v1" },
  countertops: { label: "Countertops", templateKey: "countertops_v1" },
  decking: { label: "Decking", templateKey: "decking_v1" },
  exterior_paint: { label: "Exterior Paint", templateKey: "exterior_paint_v1" },
  firepit: { label: "Firepit", templateKey: "firepit_v1" },
  fireplace: { label: "Fireplace", templateKey: "fireplace_v1" },
  flooring: { label: "Flooring", templateKey: "flooring_v1" },
  garage_door: { label: "Garage Door", templateKey: "garage_door_v1" },
  lighting_fixtures: { label: "Lighting Fixtures", templateKey: "lighting_fixtures_v1" },
  outdoor_kitchen: { label: "Outdoor Kitchen", templateKey: "outdoor_kitchen_v1" },
  outdoor_lighting: { label: "Outdoor Lighting", templateKey: "outdoor_lighting_v1" },
  pavers: { label: "Pavers", templateKey: "pavers_v1" },
  pergola_shade: { label: "Pergola / Shade", templateKey: "pergola_shade_v1" },
  pool_finish: { label: "Pool Finish", templateKey: "pool_finish_v1" },
  privacy_planting: { label: "Privacy Planting", templateKey: "privacy_planting_v1" },
  roofing: { label: "Roofing", templateKey: "roofing_v1" },
  seating_built_in: { label: "Built-in Seating", templateKey: "seating_built_in_v1" },
  shower_tile: { label: "Shower Tile", templateKey: "shower_tile_v1" },
  siding: { label: "Siding", templateKey: "siding_v1" },
  vanity: { label: "Vanity", templateKey: "vanity_v1" },
  walkway: { label: "Walkway", templateKey: "walkway_v1" },
  windows_doors: { label: "Windows / Doors", templateKey: "windows_doors_v1" },
};

const TEMPLATE_SEEDS: Record<string, TemplateSeed[]> = {
  backsplash_tile: [
    { imagePrompt: "glossy white subway-tile backsplash with classic kitchen brightness", label: "Glossy white subway" },
    { imagePrompt: "cream zellige-style backsplash with handcrafted texture", label: "Cream zellige" },
    { imagePrompt: "continuous marble slab backsplash with a luxury finish", label: "Marble slab splash" },
    { imagePrompt: "vertical stacked backsplash tile with a modern graphic look", label: "Vertical stacked tile" },
    { imagePrompt: "geometric mosaic backsplash adding designer detail", label: "Geometric mosaic" },
    { imagePrompt: "muted sage handmade backsplash tile with soft color variation", label: "Muted sage handmade tile" },
  ],
  cabinets: [
    { imagePrompt: "white shaker cabinetry with bright timeless appeal", label: "White shaker" },
    { imagePrompt: "walnut slab-front cabinetry with warm modern sophistication", label: "Walnut slab" },
    { imagePrompt: "deep green cabinetry creating a rich designer focal point", label: "Deep green painted" },
    { imagePrompt: "warm taupe flat-panel cabinets with a soft contemporary look", label: "Taupe flat-panel" },
    { imagePrompt: "black cabinetry with bold upscale contrast", label: "Black statement cabinets" },
    { imagePrompt: "natural oak minimalist cabinetry with clean modern lines", label: "Natural oak minimalist" },
  ],
  countertops: [
    { imagePrompt: "bright white quartz countertops with crisp clean edges", label: "Bright white quartz" },
    { imagePrompt: "warm lightly veined quartz countertops with soft luxury", label: "Warm veined quartz" },
    { imagePrompt: "dark soapstone-look countertops with moody sophistication", label: "Dark soapstone look" },
    { imagePrompt: "marble waterfall countertop with high-end dramatic detailing", label: "Marble waterfall" },
    { imagePrompt: "honed granite countertops with refined natural texture", label: "Honed granite" },
    { imagePrompt: "concrete-look countertops with modern architectural character", label: "Concrete surface" },
  ],
  decking: [
    { imagePrompt: "warm cedar deck boards with rich natural grain", label: "Warm cedar boards" },
    { imagePrompt: "cool gray composite decking with a modern profile", label: "Cool composite plank" },
    { imagePrompt: "dark premium timber decking with upscale depth", label: "Dark premium timber" },
    { imagePrompt: "light coastal deck planks with an airy upscale finish", label: "Wide coastal plank" },
    { imagePrompt: "modern deck with warm planks and a matte black structure", label: "Minimal matte black frame" },
    { imagePrompt: "rustic textured wood decking with a relaxed outdoor-living look", label: "Rustic textured wood" },
  ],
  exterior_paint: [
    { imagePrompt: "crisp white exterior paint with black trim accents", label: "Crisp white and black trim" },
    { imagePrompt: "soft greige exterior palette with warm understated sophistication", label: "Soft greige" },
    { imagePrompt: "deep charcoal exterior paint with dramatic modern contrast", label: "Deep charcoal" },
    { imagePrompt: "muted sage-green exterior palette with natural softness", label: "Muted sage green" },
    { imagePrompt: "warm taupe exterior paint complementing stone and landscaping", label: "Warm taupe blend" },
    { imagePrompt: "light blue-gray exterior palette with coastal freshness", label: "Coastal blue-gray" },
  ],
  firepit: [
    { imagePrompt: "round stone fire pit with classic gathering-circle appeal", label: "Round stone gathering pit" },
    { imagePrompt: "linear modern concrete fire feature with a luxury patio look", label: "Linear concrete feature" },
    { imagePrompt: "sunken conversation pit with an integrated central fire feature", label: "Sunken lounge firepit" },
    { imagePrompt: "sleek black metal fire bowl with minimalist styling", label: "Black metal bowl" },
    { imagePrompt: "rustic natural-stone fire pit with rugged outdoor charm", label: "Rustic boulder firepit" },
    { imagePrompt: "clean built-in gas fire table with upscale entertaining style", label: "Gas fire table" },
  ],
  fireplace: [
    { imagePrompt: "smooth plaster fireplace surround with organic modern softness", label: "Smooth plaster surround" },
    { imagePrompt: "stacked stone fireplace with timeless textural warmth", label: "Stacked stone fireplace" },
    { imagePrompt: "black steel fireplace surround with a sharp modern edge", label: "Black steel surround" },
    { imagePrompt: "traditional fireplace mantel with classic elegant detailing", label: "Traditional mantel" },
    { imagePrompt: "linear modern fireplace with clean horizontal luxury", label: "Linear modern flame" },
    { imagePrompt: "rustic fireplace with a reclaimed wood mantel and cozy character", label: "Rustic reclaimed beam" },
  ],
  flooring: [
    { imagePrompt: "light oak wide-plank flooring with an airy upscale feel", label: "Light oak plank" },
    { imagePrompt: "dark walnut flooring with rich traditional depth", label: "Dark walnut plank" },
    { imagePrompt: "polished concrete flooring with a clean modern edge", label: "Polished concrete" },
    { imagePrompt: "warm natural-stone flooring with timeless texture", label: "Warm natural stone" },
    { imagePrompt: "patterned tile flooring with designer personality", label: "Patterned statement tile" },
    { imagePrompt: "large-format porcelain flooring with sleek minimal joints", label: "Large-format porcelain" },
  ],
  garage_door: [
    { imagePrompt: "modern glass-panel garage door with sleek contemporary styling", label: "Modern glass panel" },
    { imagePrompt: "carriage-style wood garage door with classic charm", label: "Carriage wood style" },
    { imagePrompt: "flush black garage door with minimalist modern lines", label: "Flush black slab" },
    { imagePrompt: "white paneled garage door with clean traditional curb appeal", label: "White paneled classic" },
    { imagePrompt: "warm cedar-slat garage door with upscale texture", label: "Cedar slat design" },
    { imagePrompt: "ribbed steel garage door with a refined industrial look", label: "Industrial ribbed steel" },
  ],
  lighting_fixtures: [
    { imagePrompt: "oversized pendant lighting creating a bold design focal point", label: "Oversized pendants" },
    { imagePrompt: "warm brass sconces with inviting upscale detail", label: "Warm brass sconces" },
    { imagePrompt: "matte black modern light fixtures with crisp clean lines", label: "Matte black modern fixtures" },
    { imagePrompt: "lantern-style chandelier with timeless architectural character", label: "Lantern statement chandelier" },
    { imagePrompt: "minimal recessed lighting with clean contemporary restraint", label: "Minimal recessed lighting" },
    { imagePrompt: "sculptural statement light fixture with designer presence", label: "Sculptural statement fixture" },
  ],
  outdoor_kitchen: [
    { imagePrompt: "stainless outdoor grill island with a polished entertainer layout", label: "Stainless grill island" },
    { imagePrompt: "warm natural-stone outdoor kitchen with built-in appliances", label: "Warm stone kitchen" },
    { imagePrompt: "sleek black outdoor kitchen with modern cabinetry lines", label: "Black modern kitchen" },
    { imagePrompt: "bright white outdoor prep and serving bar with a coastal luxury feel", label: "Coastal white prep bar" },
    { imagePrompt: "rustic outdoor cooking station with wood-fired character", label: "Rustic wood-fired station" },
    { imagePrompt: "compact outdoor bar and grill setup optimized for entertaining", label: "Compact entertainment bar" },
  ],
  outdoor_lighting: [
    { imagePrompt: "warm path lighting that softly defines walkways and planting beds", label: "Warm path lights" },
    { imagePrompt: "modern bollard lights with architectural outdoor styling", label: "Modern bollard lights" },
    { imagePrompt: "elevated string lighting creating a relaxed entertaining atmosphere", label: "Cafe string lights" },
    { imagePrompt: "subtle recessed step lighting with a premium modern finish", label: "Recessed step lights" },
    { imagePrompt: "classic lantern-style outdoor sconces with timeless curb appeal", label: "Lantern wall sconces" },
    { imagePrompt: "dramatic tree and facade uplighting with a high-end evening effect", label: "Dramatic uplighting" },
  ],
  pavers: [
    { imagePrompt: "large-format light gray concrete pavers in a clean modern layout", label: "Large-format light gray concrete" },
    { imagePrompt: "dark charcoal modern slab pavers with sleek lines", label: "Charcoal modern slab" },
    { imagePrompt: "traditional brick-style pavers in a timeless pattern", label: "Classic brick pattern" },
    { imagePrompt: "warm-toned natural stone pavers with upscale character", label: "Warm natural stone" },
    { imagePrompt: "irregular rustic stone pavers with organic texture", label: "Rustic irregular stone" },
    { imagePrompt: "luxury geometric paver layout with crisp spacing and refined detailing", label: "Geometric luxury grid" },
  ],
  pergola_shade: [
    { imagePrompt: "sleek black aluminum pergola with a contemporary outdoor-living look", label: "Black aluminum pergola" },
    { imagePrompt: "natural cedar pergola with warm wood tones and open beams", label: "Natural cedar pergola" },
    { imagePrompt: "modern louvered shade structure with adjustable slats", label: "Louvered roof shade" },
    { imagePrompt: "bright white shade pavilion with a coastal upscale feel", label: "Coastal white pavilion" },
    { imagePrompt: "minimal tension sail shade with clean modern lines", label: "Tension sail shade" },
    { imagePrompt: "heavy timber pergola with rustic outdoor character", label: "Rustic timber frame" },
  ],
  pool_finish: [
    { imagePrompt: "bright aqua pool finish with a fresh resort-style look", label: "Bright aqua plaster" },
    { imagePrompt: "dark lagoon-inspired pool finish with rich water depth", label: "Dark lagoon finish" },
    { imagePrompt: "clean white coping and tile details with a bright modern pool look", label: "White coping and tile" },
    { imagePrompt: "moody black tile pool detailing with sleek architectural styling", label: "Black tile modern edge" },
    { imagePrompt: "light travertine-style pool finish with upscale resort cues", label: "Travertine resort surround" },
    { imagePrompt: "glass-tile-accent pool finish with subtle shimmering luxury", label: "Glass tile shimmer" },
  ],
  privacy_planting: [
    { imagePrompt: "tall column evergreen privacy screen with a structured look", label: "Column evergreen screen" },
    { imagePrompt: "layered privacy hedge with dense shrubs and soft depth", label: "Layered hedge border" },
    { imagePrompt: "lush tropical privacy planting with bold leafy texture", label: "Tropical lush screen" },
    { imagePrompt: "formal clipped privacy shrubs with a manicured estate feel", label: "Formal clipped shrubs" },
    { imagePrompt: "ornamental grass privacy border with soft movement and texture", label: "Ornamental grass buffer" },
    { imagePrompt: "naturalistic privacy planting with mixed trees, shrubs, and seasonal softness", label: "Natural mixed planting" },
  ],
  roofing: [
    { imagePrompt: "charcoal architectural roof shingles with modern curb appeal", label: "Charcoal architectural shingle" },
    { imagePrompt: "warm cedar-look roofing with rich natural character", label: "Warm cedar-look roof" },
    { imagePrompt: "matte black standing-seam metal roof with architectural sharpness", label: "Matte black metal roof" },
    { imagePrompt: "slate-inspired roof finish with premium traditional depth", label: "Slate-inspired roof" },
    { imagePrompt: "light gray roofing with airy coastal styling", label: "Light coastal gray roof" },
    { imagePrompt: "terracotta-inspired roof color with Mediterranean warmth", label: "Terracotta-inspired roof" },
  ],
  seating_built_in: [
    { imagePrompt: "curved built-in stone bench integrated into the patio layout", label: "Curved stone bench" },
    { imagePrompt: "clean linear built-in bench with a refined modern look", label: "Linear modern bench" },
    { imagePrompt: "retaining wall seating with a warm wood bench cap", label: "Wood-topped wall seat" },
    { imagePrompt: "built-in wraparound seating centered on a fire feature", label: "Firepit wraparound seating" },
    { imagePrompt: "built-in lounge seating with upscale outdoor cushions", label: "Cushioned lounge nook" },
    { imagePrompt: "minimal floating concrete bench with sculptural outdoor styling", label: "Floating slab bench" },
  ],
  shower_tile: [
    { imagePrompt: "large-format stone-look shower tile with a spa feel", label: "Large stone-look tile" },
    { imagePrompt: "vertical white subway shower tile with clean bright styling", label: "Vertical white subway" },
    { imagePrompt: "dark moody shower tile with dramatic modern sophistication", label: "Dark moody tile" },
    { imagePrompt: "terrazzo shower tile with playful upscale texture", label: "Terrazzo shower" },
    { imagePrompt: "warm textured sandstone-look shower tile with natural softness", label: "Warm sandstone texture" },
    { imagePrompt: "muted green spa-style shower tile with calming depth", label: "Green spa tile" },
  ],
  siding: [
    { imagePrompt: "modern vertical natural-wood siding with warm curb appeal", label: "Vertical natural wood" },
    { imagePrompt: "white board-and-batten siding with crisp classic proportions", label: "White board and batten" },
    { imagePrompt: "dark horizontal lap siding with bold contemporary contrast", label: "Dark horizontal lap" },
    { imagePrompt: "mixed stone and siding facade with layered exterior texture", label: "Stone and siding mix" },
    { imagePrompt: "warm cedar shingle siding with timeless character", label: "Warm cedar shingle" },
    { imagePrompt: "smooth modern stucco exterior with clean minimalist lines", label: "Smooth modern stucco" },
  ],
  vanity: [
    { imagePrompt: "floating wood vanity with warm modern bathroom styling", label: "Floating wood vanity" },
    { imagePrompt: "bright white double vanity with classic upscale detailing", label: "White double vanity" },
    { imagePrompt: "dark modern vanity with strong architectural contrast", label: "Dark modern vanity" },
    { imagePrompt: "furniture-style vanity with elegant traditional character", label: "Furniture-style vanity" },
    { imagePrompt: "fluted oak vanity with premium contemporary texture", label: "Fluted oak vanity" },
    { imagePrompt: "compact wall-mounted vanity with minimalist urban styling", label: "Compact wall-mounted vanity" },
  ],
  walkway: [
    { imagePrompt: "straight large-slab walkway with crisp modern joints", label: "Large slab straight path" },
    { imagePrompt: "rustic flagstone garden path with organic character", label: "Rustic flagstone path" },
    { imagePrompt: "classic brick walkway with traditional curb appeal", label: "Classic brick walkway" },
    { imagePrompt: "gravel path with clean stepping stones and soft edging", label: "Gravel stepping path" },
    { imagePrompt: "herringbone paver walkway with refined detail", label: "Herringbone paver walk" },
    { imagePrompt: "curved garden walkway winding through layered planting", label: "Curved garden walk" },
  ],
  windows_doors: [
    { imagePrompt: "black framed windows with a sharp modern facade", label: "Black framed windows" },
    { imagePrompt: "white-trimmed windows and doors with classic timeless appeal", label: "White classic trim" },
    { imagePrompt: "warm wood entry door as the focal exterior detail", label: "Warm wood front door" },
    { imagePrompt: "oversized glass doors connecting indoor and outdoor spaces", label: "Oversized glass slider" },
    { imagePrompt: "steel-look grid windows with a designer modern-industrial feel", label: "Steel-look grid windows" },
    { imagePrompt: "arched front door entry with upscale architectural character", label: "Arched statement entry" },
  ],
};

const SUPPORTED_REFINEMENT_COMPONENTS = (refinementSupportedComponents as SupportedRefinementComponentManifestItem[])
  .filter((item) => item && typeof item === "object" && typeof item.key === "string")
  .map((item) => ({
    aliases: Array.isArray(item.aliases) ? item.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0) : [],
    key: String(item.key).trim(),
    label: String(item.label || item.key).trim(),
    templateKey: String(item.templateKey || `${item.key}_v1`).trim(),
  }))
  .filter((item) => item.key.length > 0);

const SUPPORTED_COMPONENT_BY_KEY = new Map(
  SUPPORTED_REFINEMENT_COMPONENTS.map((item) => [item.key, item] as const),
);

function slugifySegment(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "image";
}

function normalizeText(input: unknown): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeVisualContextText(input: unknown): string {
  return String(input || "")
    .trim()
    .replace(/\bbefore\s*(?:\/|-|&|and)\s*after\b/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[,\s;:-]+|[,\s;:-]+$/g, "")
    .trim();
}

function isHttpImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isRefinementImage(row: RefinementImageRow): boolean {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
  return String(meta?.generated_for || "") === REFINEMENT_OPTION_GENERATED_FOR;
}

function isReadyRefinementImage(row: RefinementImageRow): boolean {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
  return row?.status === "completed" && isRefinementImage(row) && String(meta?.refinement_status || "") === "ready";
}

function makeTemplateOptions(items: TemplateSeed[]): RefinementTemplateOption[] {
  return items.map((item) => {
    const variationKey = slugifySegment(item.label).replace(/-/g, "_");
    return {
      imagePrompt: item.imagePrompt,
      label: item.label,
      value: variationKey,
      variationKey,
    };
  });
}

const TEMPLATE_OPTIONS_BY_KEY: Record<string, RefinementTemplateOption[]> = Object.fromEntries(
  Object.entries(TEMPLATE_SEEDS).map(([key, items]) => [key, makeTemplateOptions(items)]),
);

function normalizeComponentKey(input: unknown): string {
  return String(input || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizePriority(input: unknown, fallback: number): number {
  const value = Number(input);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function getRefinementTemplateOptions(categoryKey: string): RefinementTemplateOption[] {
  return TEMPLATE_OPTIONS_BY_KEY[String(categoryKey || "").trim()] || [];
}

export function getRefinementLabel(categoryKey: string): string {
  const key = String(categoryKey || "").trim();
  return SUPPORTED_COMPONENT_BY_KEY.get(key)?.label || TEMPLATE_LABELS[key]?.label || key;
}

export function getRefinementTemplateKey(categoryKey: string): string {
  const key = String(categoryKey || "").trim();
  return SUPPORTED_COMPONENT_BY_KEY.get(key)?.templateKey || TEMPLATE_LABELS[key]?.templateKey || `${key}_v1`;
}

export function isSupportedRefinementCategoryKey(categoryKey: string): boolean {
  return SUPPORTED_COMPONENT_BY_KEY.has(String(categoryKey || "").trim());
}

export function parseStoredSubcategoryComponents(value: unknown): StoredSubcategoryComponent[] {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const parsed: StoredSubcategoryComponent[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const raw = items[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const key = normalizeComponentKey((raw as any).key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const supported = SUPPORTED_COMPONENT_BY_KEY.get(key);
    const rawLabel = String((raw as any).label || "").trim();
    parsed.push({
      key,
      label: rawLabel || supported?.label || key,
      priority: normalizePriority((raw as any).priority, index + 1),
    });
  }
  return parsed.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

export function filterSupportedSubcategoryComponents(items: StoredSubcategoryComponent[]): StoredSubcategoryComponent[] {
  return parseStoredSubcategoryComponents(items).filter((item) => isSupportedRefinementCategoryKey(item.key));
}

export function buildStoredSubcategoryComponentsFromPlannerCategories(
  categories: RefinementPlannerCategory[],
): StoredSubcategoryComponent[] {
  return categories
    .filter((item) => item?.canonical_key && isSupportedRefinementCategoryKey(item.canonical_key))
    .map((item, index) => ({
      key: item.canonical_key,
      label: item.label || getRefinementLabel(item.canonical_key),
      priority: normalizePriority(item.priority, index + 1),
    }))
    .filter((item, index, arr) => arr.findIndex((candidate) => candidate.key === item.key) === index)
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

export function appendSupportedSubcategoryComponents(params: {
  existing: StoredSubcategoryComponent[];
  additions: StoredSubcategoryComponent[];
  maxSupportedCount?: number;
}): StoredSubcategoryComponent[] {
  const existing = parseStoredSubcategoryComponents(params.existing);
  const additions = parseStoredSubcategoryComponents(params.additions).filter((item) => isSupportedRefinementCategoryKey(item.key));
  const maxSupportedCount = Math.max(1, Math.floor(Number(params.maxSupportedCount || REFINEMENT_LIBRARY_TARGET_CATEGORIES)));
  const existingKeys = new Set(existing.map((item) => item.key));
  const existingSupportedCount = existing.filter((item) => isSupportedRefinementCategoryKey(item.key)).length;
  if (existingSupportedCount >= maxSupportedCount) return existing;

  let nextPriority = existing.reduce((max, item) => Math.max(max, normalizePriority(item.priority, 1)), 0) + 1;
  const merged = [...existing];
  let supportedCount = existingSupportedCount;

  for (const item of additions) {
    if (supportedCount >= maxSupportedCount) break;
    if (existingKeys.has(item.key)) continue;
    existingKeys.add(item.key);
    merged.push({
      key: item.key,
      label: item.label || getRefinementLabel(item.key),
      priority: nextPriority,
    });
    nextPriority += 1;
    supportedCount += 1;
  }

  return merged.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

export function buildPlannerCategoriesFromStoredComponents(
  items: StoredSubcategoryComponent[],
): RefinementPlannerCategory[] {
  return filterSupportedSubcategoryComponents(items)
    .slice(0, REFINEMENT_LIBRARY_TARGET_CATEGORIES)
    .map((item, index) => ({
      canonical_key: item.key,
      label: item.label || getRefinementLabel(item.key),
      priority: normalizePriority(item.priority, index + 1),
      raw_name: item.label || getRefinementLabel(item.key),
      reason: `${item.label || getRefinementLabel(item.key)} is a stored refinement component for this subcategory.`,
      template_key: getRefinementTemplateKey(item.key),
    }));
}

export function getGeneratableRefinementComponents(items: StoredSubcategoryComponent[]): StoredSubcategoryComponent[] {
  return filterSupportedSubcategoryComponents(items)
    .filter((item) => getRefinementTemplateOptions(item.key).length > 0)
    .slice(0, REFINEMENT_LIBRARY_TARGET_CATEGORIES);
}

export function hasReadyRefinementLibraryForComponents(
  rows: RefinementImageRow[],
  items: StoredSubcategoryComponent[],
): boolean {
  const targetComponents = getGeneratableRefinementComponents(items);
  if (targetComponents.length === 0) return true;
  const coverage = buildRefinementCoverage(rows);
  return targetComponents.every(
    (item) => (coverage.get(item.key)?.count || 0) >= REFINEMENT_LIBRARY_MIN_IMAGES_PER_CATEGORY,
  );
}

export function defaultRefinementCategoriesForContext(params: {
  categoryName?: string | null;
  subcategoryName?: string | null;
  limit?: number;
}): RefinementPlannerCategory[] {
  void params;
  return [];
}

export function buildRefinementCategoryQuestion(params: {
  categoryLabel: string;
  subcategoryName?: string | null;
}): string {
  const subject = sanitizeVisualContextText(params.subcategoryName) || "this design";
  return `Choose a ${sanitizeVisualContextText(params.categoryLabel).toLowerCase()} direction for ${subject}.`;
}

export function buildRefinementPromptForOption(params: {
  categoryLabel: string;
  categoryName?: string | null;
  option: RefinementTemplateOption;
  serviceSummary?: string | null;
  subcategoryName?: string | null;
}): string {
  const categoryLabel = sanitizeVisualContextText(params.categoryLabel) || "Refinement";
  const serviceSummary = sanitizeVisualContextText(params.serviceSummary);
  const categoryName = sanitizeVisualContextText(params.categoryName);
  const subcategoryName = sanitizeVisualContextText(params.subcategoryName);
  const subject = serviceSummary || [categoryName, subcategoryName].filter(Boolean).join(": ") || subcategoryName || "Service";
  const promptText = sanitizeVisualContextText(params.option.imagePrompt || params.option.label || params.option.value);
  return `${BASE_PHOTO_PREFIX} ${subject}. Refinement category: ${categoryLabel}. Option: ${promptText}.`;
}

export function buildRefinementOptionKey(categoryKey: string, option: RefinementTemplateOption): string {
  return normalizeText([categoryKey, option.variationKey, option.label].filter(Boolean).join(" "));
}

export async function listRefinementImages(params: {
  categoryId?: string | null;
  instanceId?: string | null;
  subcategoryId: string;
  supabase: any;
}): Promise<RefinementImageRow[]> {
  const selectCols = "id, image_url, metadata, created_at, prompt_id, subcategory_id, status, account_id, user_id, instance_id";
  const generatedForFilter = { generated_for: REFINEMENT_OPTION_GENERATED_FOR };
  const queries: PromiseLike<any>[] = [
    params.instanceId
      ? params.supabase
          .from("images")
          .select(selectCols)
          .eq("subcategory_id", params.subcategoryId)
          .eq("instance_id", params.instanceId)
          .eq("status", "completed")
          .contains("metadata", generatedForFilter)
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    params.supabase
      .from("images")
      .select(selectCols)
      .eq("subcategory_id", params.subcategoryId)
      .is("instance_id", null)
      .eq("status", "completed")
      .contains("metadata", generatedForFilter)
      .order("created_at", { ascending: false })
      .limit(200),
  ];

  const results = await Promise.all(queries);
  const merged = results.flatMap((result) => (Array.isArray(result?.data) ? result.data : []));
  const seen = new Set<string>();
  const filtered: RefinementImageRow[] = [];
  for (const row of merged as RefinementImageRow[]) {
    if (!row?.id || seen.has(row.id) || !isRefinementImage(row)) continue;
    seen.add(row.id);
    filtered.push(row);
  }
  return filtered;
}

export function buildRefinementCoverage(rows: RefinementImageRow[]): Map<string, CoverageItem> {
  const coverage = new Map<string, CoverageItem>();
  for (const row of rows) {
    if (!isReadyRefinementImage(row)) continue;
    const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : null;
    const key = typeof meta?.refinement_category_key === "string" ? String(meta.refinement_category_key).trim() : "";
    if (!key) continue;
    const variationKey =
      typeof meta?.refinement_variation_key === "string" ? String(meta.refinement_variation_key).trim() : row.id;
    const priority = Number(meta?.refinement_priority || 999);
    const existing = coverage.get(key);
    if (!existing) {
      const item: CoverageItem = {
        count: 0,
        images: [],
        label: typeof meta?.refinement_category_label === "string" ? String(meta.refinement_category_label) : getRefinementLabel(key),
        priority: Number.isFinite(priority) ? priority : 999,
        reason: typeof meta?.refinement_reason === "string" ? String(meta.refinement_reason) : `${getRefinementLabel(key)} is an existing refinement category.`,
        templateKey: typeof meta?.refinement_template_key === "string" ? String(meta.refinement_template_key) : getRefinementTemplateKey(key),
        variationKeys: new Set<string>(),
      };
      coverage.set(key, item);
    }
    const item = coverage.get(key)!;
    item.images.push(row);
    if (!item.variationKeys.has(variationKey)) {
      item.variationKeys.add(variationKey);
      item.count += 1;
    }
  }
  return coverage;
}

export function hasReadyRefinementLibrary(rows: RefinementImageRow[]): boolean {
  const coverage = buildRefinementCoverage(rows);
  const readyCategories = Array.from(coverage.values()).filter((item) => item.count >= REFINEMENT_LIBRARY_MIN_IMAGES_PER_CATEGORY);
  return readyCategories.length >= REFINEMENT_LIBRARY_TARGET_CATEGORIES;
}

export function deriveRefinementCategoriesFromImages(rows: RefinementImageRow[], limit: number): RefinementPlannerCategory[] {
  const coverage = buildRefinementCoverage(rows);
  return Array.from(coverage.entries())
    .filter(([, item]) => item.count > 0)
    .sort((a, b) => {
      const priorityDiff = a[1].priority - b[1].priority;
      if (priorityDiff !== 0) return priorityDiff;
      return b[1].count - a[1].count;
    })
    .slice(0, limit)
    .map(([canonicalKey, item], index) => ({
      canonical_key: canonicalKey,
      label: item.label || getRefinementLabel(canonicalKey),
      priority: Number.isFinite(item.priority) ? item.priority : index + 1,
      raw_name: item.label || getRefinementLabel(canonicalKey),
      reason: item.reason,
      template_key: item.templateKey || getRefinementTemplateKey(canonicalKey),
    }));
}

export function mergeRefinementCategories(params: {
  existing: RefinementPlannerCategory[];
  planned?: RefinementPlannerCategory[] | null;
  categoryName?: string | null;
  subcategoryName?: string | null;
}): RefinementPlannerCategory[] {
  const merged = new Map<string, RefinementPlannerCategory>();
  for (const item of params.existing || []) {
    if (!item?.canonical_key) continue;
    merged.set(item.canonical_key, {
      ...item,
      label: item.label || getRefinementLabel(item.canonical_key),
      template_key: item.template_key || getRefinementTemplateKey(item.canonical_key),
    });
  }
  for (const item of params.planned || []) {
    if (!item?.canonical_key || merged.has(item.canonical_key)) continue;
    merged.set(item.canonical_key, {
      ...item,
      label: item.label || getRefinementLabel(item.canonical_key),
      template_key: item.template_key || getRefinementTemplateKey(item.canonical_key),
    });
  }
  void params.categoryName;
  void params.subcategoryName;
  return Array.from(merged.values())
    .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))
    .slice(0, REFINEMENT_LIBRARY_TARGET_CATEGORIES);
}

export function buildMissingRefinementOptions(params: {
  categoryKey: string;
  existingRows: RefinementImageRow[];
  missingCount: number;
}): RefinementTemplateOption[] {
  const templateOptions = getRefinementTemplateOptions(params.categoryKey);
  if (!templateOptions.length || params.missingCount <= 0) return [];
  const existingVariationKeys = new Set<string>();
  for (const row of params.existingRows) {
    if (!isReadyRefinementImage(row)) continue;
    const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : null;
    const key = typeof meta?.refinement_category_key === "string" ? String(meta.refinement_category_key).trim() : "";
    const variationKey = typeof meta?.refinement_variation_key === "string" ? String(meta.refinement_variation_key).trim() : "";
    if (key === params.categoryKey && variationKey) existingVariationKeys.add(variationKey);
  }
  return templateOptions.filter((option) => !existingVariationKeys.has(option.variationKey)).slice(0, params.missingCount);
}

async function uploadRefinementImageFromUrl(params: {
  imageUrl: string;
  subcategoryId: string;
  variationKey: string;
  supabase: any;
}): Promise<{ publicUrl: string; storagePath: string } | null> {
  const resp = await fetch(params.imageUrl, { cache: "no-store" });
  if (!resp.ok) return null;
  const contentType = String(resp.headers.get("content-type") || "image/webp").trim() || "image/webp";
  const storagePath = `${IMAGE_STORAGE_PREFIXES.subcategory}/${params.subcategoryId}/refinement/${Date.now()}-${slugifySegment(params.variationKey)}.webp`;
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const upload = await params.supabase.storage.from(IMAGES_BUCKET).upload(storagePath, bytes, {
    cacheControl: "3600",
    contentType,
    upsert: false,
  });
  if (upload.error) return null;
  const publicData = params.supabase.storage.from(IMAGES_BUCKET).getPublicUrl(upload.data.path);
  const publicUrl = String(publicData?.data?.publicUrl || "");
  if (!publicUrl) return null;
  return { publicUrl, storagePath };
}

export async function persistGeneratedRefinementImages(params: {
  categoryId?: string | null;
  categoryName?: string | null;
  generatedOptions: any[];
  instanceId?: string | null;
  options: RefinementTemplateOption[];
  plannedCategory: RefinementPlannerCategory;
  serviceSummary?: string | null;
  subcategoryId: string;
  subcategoryName?: string | null;
  supabase: any;
}): Promise<number> {
  const responseByKey = new Map<string, any>();
  for (const item of Array.isArray(params.generatedOptions) ? params.generatedOptions : []) {
    const label = typeof item?.label === "string" ? item.label : "";
    const value = typeof item?.value === "string" ? item.value : "";
    const key = normalizeText([params.plannedCategory.canonical_key, label, value].filter(Boolean).join(" "));
    if (!key || responseByKey.has(key)) continue;
    responseByKey.set(key, item);
  }

  let stored = 0;
  for (const option of params.options) {
    const responseKey = normalizeText([params.plannedCategory.canonical_key, option.label, option.value].filter(Boolean).join(" "));
    const generated = responseByKey.get(responseKey);
    const imageUrl =
      typeof generated?.imageUrl === "string"
        ? generated.imageUrl
        : typeof generated?.image_url === "string"
          ? generated.image_url
          : typeof generated?.image === "string"
            ? generated.image
            : "";
    if (!isHttpImageUrl(imageUrl)) continue;

    const upload = await uploadRefinementImageFromUrl({
      imageUrl,
      subcategoryId: params.subcategoryId,
      supabase: params.supabase,
      variationKey: option.variationKey,
    });
    if (!upload) continue;

    const promptText = buildRefinementPromptForOption({
      categoryLabel: params.plannedCategory.label,
      categoryName: params.categoryName,
      option,
      serviceSummary: params.serviceSummary,
      subcategoryName: params.subcategoryName,
    });

    const promptInsert = await params.supabase
      .from("prompts")
      .insert({
        account_id: null,
        prompt: promptText,
        variables: null,
      })
      .select("id")
      .single();
    const promptId = String(promptInsert?.data?.id || "");

    const imageInsert = await params.supabase
      .from("images")
      .insert({
        account_id: null,
        image_url: upload.publicUrl,
        instance_id: null,
        metadata: {
          ai_model: REFINEMENT_OPTION_MODEL_ID,
          generated_for: REFINEMENT_OPTION_GENERATED_FOR,
          model_name: "Flux Schnell",
          model_provider: "Replicate",
          origin_instance_id: String(params.instanceId || "").trim() || null,
          prompt_text: promptText,
          refinement_category_id: String(params.categoryId || "").trim() || null,
          refinement_category_key: params.plannedCategory.canonical_key,
          refinement_category_label: params.plannedCategory.label,
          refinement_category_name: String(params.categoryName || "").trim() || null,
          refinement_priority: Number(params.plannedCategory.priority || 0) || null,
          refinement_quality: "draft",
          refinement_reason: String(params.plannedCategory.reason || "").trim() || null,
          refinement_scope: "subcategory",
          refinement_status: "ready",
          refinement_subcategory_id: params.subcategoryId,
          refinement_subcategory_name: String(params.subcategoryName || "").trim() || null,
          refinement_template_key: params.plannedCategory.template_key,
          refinement_variation_key: option.variationKey,
          refinement_variation_label: option.label,
          refinement_version: 1,
          s3_path: upload.storagePath,
          source: "instance_refinement_seed",
        } as Json,
        model_id: null,
        negative_prompt: null,
        prompt_id: promptId || null,
        replicate_prediction_id: null,
        status: "completed",
        subcategory_id: params.subcategoryId,
        user_id: null,
      })
      .select("id")
      .single();

    if (imageInsert.error) {
      await params.supabase.storage.from(IMAGES_BUCKET).remove([upload.storagePath]).catch(() => undefined);
      continue;
    }
    stored += 1;
  }

  return stored;
}
