/**
 * Shared refinement-library seeding and lazy repair (designer instance seed + widget repair).
 */

export const REFINEMENT_OPTION_GENERATED_FOR = "refinement_option";
export const REFINEMENT_OPTION_MODEL_ID = "black-forest-labs/flux-schnell";
export const REFINEMENT_LIBRARY_TARGET_COMPONENTS = 10;
export const REFINEMENT_LIBRARY_MAX_COMPONENTS = 10;
export const REFINEMENT_LIBRARY_MIN_IMAGES_PER_COMPONENT = 6;
export const REFINEMENT_PLANNER_SOURCE = "dspy_refinement_library_planner";

const IMAGES_BUCKET = "images";
const IMAGE_SUBCATEGORY_PREFIX = "subcategory";

const BASE_PHOTO_PREFIX =
  "Photorealistic photo of one finished scene, not a split-screen or before-and-after layout. No text, no words, no letters, no labels, no captions, no watermarks, no signs.";

export type StoredSubcategoryComponent = {
  key: string;
  label: string;
  priority: number;
  reason?: string;
  source?: string;
};

export type RefinementPlannerComponent = {
  key: string;
  label: string;
  priority: number;
  reason: string;
};

export type RefinementOptionSeed = {
  label: string;
  value: string;
  imagePrompt: string;
};

export type RefinementCatalogOption = {
  label: string;
  value: string;
  imageUrl: string;
};

export type RefinementCatalogItem = {
  key: string;
  label: string;
  priority: number;
  options: RefinementCatalogOption[];
};

export type EnsureRefinementLibraryMode = "instance_seed" | "lazy_repair";

export type EnsureRefinementLibraryResult = {
  ok: boolean;
  skipped?: boolean;
  plannerCalled?: boolean;
  error?: string;
  plannerOk?: boolean;
  storedImages?: number;
  componentsPersisted?: boolean;
};

type RefinementImageRow = {
  account_id: string | null;
  created_at: string | null;
  id: string;
  image_url: string;
  instance_id: string | null;
  metadata: Record<string, unknown> | null;
  prompt_id: string | null;
  status: string | null;
  subcategory_id: string | null;
  user_id: string | null;
};

function normalizeServiceUrl(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  return s.replace(/\/+$/, "");
}

export function resolveDspyServiceBaseUrls(params?: {
  isRuntimeProduction?: boolean;
  devFlag?: string;
  publicDevFlag?: string;
}): string[] {
  const isRuntimeProduction =
    params?.isRuntimeProduction ??
    (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production");
  const serverDevModeFlag = String((params?.devFlag ?? process.env.AI_FORM_DEV_MODE) || "").trim().toLowerCase();
  const clientDevModeFlag = isRuntimeProduction
    ? ""
    : String((params?.publicDevFlag ?? process.env.NEXT_PUBLIC_AI_FORM_DEV_MODE) || "").trim().toLowerCase();
  const forceDev = serverDevModeFlag === "true" || clientDevModeFlag === "true";
  const forceProd = serverDevModeFlag === "false" || clientDevModeFlag === "false";
  const isDevMode = forceDev || (!forceProd && !isRuntimeProduction);
  const devUrl = normalizeServiceUrl(process.env.DEV_DSPY_SERVICE_URL || "");
  const prodUrl = normalizeServiceUrl(process.env.PROD_DSPY_SERVICE_URL || process.env.DSPY_SERVICE_URL || "");
  const urls: string[] = [];
  if (isDevMode) {
    if (devUrl) urls.push(devUrl);
    if (prodUrl) urls.push(prodUrl);
  } else {
    if (prodUrl) urls.push(prodUrl);
    if (devUrl) urls.push(devUrl);
  }
  return Array.from(new Set(urls)).filter(Boolean);
}

export async function callFormServiceJson(params: {
  baseUrls: string[];
  path: string;
  payload: unknown;
}): Promise<{ ok: true; json: any } | { ok: false; error: unknown }> {
  let lastErr: unknown = null;
  for (const baseUrl of params.baseUrls) {
    const endpoint = new URL(params.path, baseUrl).toString();
    try {
      const resp = await fetch(endpoint, {
        body: JSON.stringify(params.payload),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const text = await resp.text().catch(() => "");
      const json = text
        ? (() => {
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })()
        : null;
      if (!resp.ok) {
        lastErr = { details: json ?? text.slice(0, 2000), status: resp.status };
        continue;
      }
      return { json: json ?? {}, ok: true };
    } catch (error) {
      lastErr = error instanceof Error ? error.message : String(error);
    }
  }
  return { error: lastErr, ok: false };
}

function normalizeComponentKey(input: unknown): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function normalizePriority(input: unknown, fallback: number): number {
  const value = Number(input);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function parseStoredSubcategoryComponents(value: unknown): StoredSubcategoryComponent[] {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const parsed: StoredSubcategoryComponent[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const raw = items[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const key = normalizeComponentKey(rec.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const rawLabel = String(rec.label || "").trim();
    const rawReason = String(rec.reason || "").trim();
    parsed.push({
      key,
      label: rawLabel || key.replace(/_/g, " "),
      priority: normalizePriority(rec.priority, index + 1),
      ...(rawReason ? { reason: rawReason } : {}),
      ...(typeof rec.source === "string" && rec.source.trim() ? { source: String(rec.source).trim() } : {}),
    });
  }
  return parsed.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

export function coerceSubcategoryComponentsForWidget(
  raw: unknown,
): Array<{ key: string; label: string; priority: number }> {
  const parsed = parseStoredSubcategoryComponents(raw);
  return parsed.map(({ key, label, priority }) => ({ key, label, priority }));
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const s = value.trim();
    return s.length > 0 ? s : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object") {
    const r = value as Record<string, unknown>;
    const raw = r.value ?? r.id ?? r.key;
    if (typeof raw === "string") {
      const s = raw.trim();
      return s.length > 0 ? s : null;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  }
  return null;
}

function isReadyRefinementImage(row: RefinementImageRow): boolean {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
  return (
    row?.status === "completed" &&
    String(meta?.generated_for || "").trim() === REFINEMENT_OPTION_GENERATED_FOR &&
    String(meta?.refinement_status || "").trim() === "ready"
  );
}

export function buildRefinementCatalogForWidget(rows: unknown[], rawComponents: unknown): RefinementCatalogItem[] {
  const components = coerceSubcategoryComponentsForWidget(rawComponents);
  if (components.length === 0) return [];

  const buckets = new Map<
    string,
    RefinementCatalogItem & {
      seenVariationKeys: Set<string>;
    }
  >();
  for (const component of components) {
    buckets.set(component.key, {
      ...component,
      options: [],
      seenVariationKeys: new Set<string>(),
    });
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    const r = row as RefinementImageRow;
    if (!isReadyRefinementImage(r)) continue;
    const meta = r?.metadata && typeof r.metadata === "object" ? (r.metadata as Record<string, unknown>) : null;
    const key = normalizeOptionalString(meta?.refinement_category_key);
    const imageUrl = normalizeOptionalString(r?.image_url);
    if (!key || !imageUrl || !buckets.has(key)) continue;

    const bucket = buckets.get(key)!;
    const value = normalizeOptionalString(meta?.refinement_variation_key) || String(r?.id || "");
    const label =
      normalizeOptionalString(meta?.refinement_variation_label) ||
      normalizeOptionalString(meta?.option_label) ||
      value;
    if (!value || !label) continue;

    const dedupeKey = value.toLowerCase();
    if (bucket.seenVariationKeys.has(dedupeKey)) continue;
    bucket.seenVariationKeys.add(dedupeKey);
    bucket.options.push({ label, value, imageUrl });
  }

  return Array.from(buckets.values())
    .map(({ seenVariationKeys: _s, ...item }) => ({
      ...item,
      options: item.options.slice(0, 8),
    }))
    .filter((item) => item.options.length >= 2)
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
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
    if (!row?.id || seen.has(row.id)) continue;
    const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : null;
    if (String((meta as any)?.generated_for || "") !== REFINEMENT_OPTION_GENERATED_FOR) continue;
    seen.add(row.id);
    filtered.push(row);
  }
  return filtered;
}

function buildCoverage(rows: RefinementImageRow[]): Map<string, number> {
  const counts = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!isReadyRefinementImage(row)) continue;
    const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null;
    const key = normalizeOptionalString(meta?.refinement_category_key);
    const variationKey = normalizeOptionalString(meta?.refinement_variation_key);
    if (!key || !variationKey) continue;
    if (!counts.has(key)) counts.set(key, new Set());
    counts.get(key)!.add(variationKey.toLowerCase());
  }
  return new Map(Array.from(counts.entries()).map(([k, s]) => [k, s.size]));
}

export function hasCompleteRefinementCoverage(
  rows: RefinementImageRow[],
  components: StoredSubcategoryComponent[],
): boolean {
  if (components.length === 0) return false;
  const cov = buildCoverage(rows);
  return components.every((c) => (cov.get(c.key) || 0) >= REFINEMENT_LIBRARY_MIN_IMAGES_PER_COMPONENT);
}

export function buildRefinementCategoryQuestion(params: {
  categoryLabel: string;
  subcategoryName?: string | null;
}): string {
  const subject = String(params.subcategoryName || "").trim() || "this design";
  const label = String(params.categoryLabel || "").trim().toLowerCase();
  return `Choose a ${label} direction for ${subject}.`;
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

function buildRefinementPromptForSeed(params: {
  categoryLabel: string;
  categoryName?: string | null;
  option: RefinementOptionSeed;
  serviceSummary?: string | null;
  subcategoryName?: string | null;
}): string {
  const categoryLabel = sanitizeVisualContextText(params.categoryLabel) || "Refinement";
  const serviceSummary = sanitizeVisualContextText(params.serviceSummary);
  const categoryName = sanitizeVisualContextText(params.categoryName);
  const subcategoryName = sanitizeVisualContextText(params.subcategoryName);
  const subject =
    serviceSummary || [categoryName, subcategoryName].filter(Boolean).join(": ") || subcategoryName || "Service";
  const promptText = sanitizeVisualContextText(params.option.imagePrompt || params.option.label || params.option.value);
  return `${BASE_PHOTO_PREFIX} ${subject}. Refinement category: ${categoryLabel}. Option: ${promptText}.`;
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

function isHttpImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function slugifySegment(input: string): string {
  return (
    String(input || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "image"
  );
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
  const storagePath = `${IMAGE_SUBCATEGORY_PREFIX}/${params.subcategoryId}/refinement/${Date.now()}-${slugifySegment(params.variationKey)}.webp`;
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

export async function deleteRefinementOptionsOutsideKeys(params: {
  supabase: any;
  subcategoryId: string;
  allowedKeys: Set<string>;
}): Promise<{ deletedRowCount: number }> {
  const { data, error } = await params.supabase
    .from("images")
    .select("id, metadata")
    .eq("subcategory_id", params.subcategoryId)
    .contains("metadata", { generated_for: REFINEMENT_OPTION_GENERATED_FOR });

  if (error || !Array.isArray(data)) {
    return { deletedRowCount: 0 };
  }

  let deleted = 0;
  for (const row of data as { id: string; metadata: Record<string, unknown> | null }[]) {
    const key = normalizeOptionalString(row?.metadata?.refinement_category_key);
    if (!key || params.allowedKeys.has(key)) continue;
    const storagePath =
      typeof row.metadata?.s3_path === "string" && row.metadata.s3_path.trim()
        ? row.metadata.s3_path.trim()
        : null;
    if (storagePath) {
      await params.supabase.storage.from(IMAGES_BUCKET).remove([storagePath]).catch(() => undefined);
    }
    const del = await params.supabase.from("images").delete().eq("id", row.id);
    if (!del.error) deleted += 1;
  }
  return { deletedRowCount: deleted };
}

export async function persistSubcategoryComponentsRow(params: {
  subcategoryId: string;
  supabase: any;
  components: StoredSubcategoryComponent[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = parseStoredSubcategoryComponents(params.components);
  const payload = normalized.map((c) => ({
    key: c.key,
    label: c.label,
    priority: c.priority,
    ...(c.reason ? { reason: c.reason } : {}),
    source: c.source || REFINEMENT_PLANNER_SOURCE,
  }));
  const update = await params.supabase
    .from("categories_subcategories")
    .update({
      subcategory_components: payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.subcategoryId);

  if (update.error) {
    return { error: update.error.message || "Failed to persist subcategory components", ok: false };
  }
  return { ok: true };
}

async function persistGeneratedRefinementBatch(params: {
  categoryId?: string | null;
  categoryName?: string | null;
  component: RefinementPlannerComponent;
  generatedOptions: any[];
  instanceId?: string | null;
  options: RefinementOptionSeed[];
  serviceSummary?: string | null;
  subcategoryId: string;
  subcategoryName?: string | null;
  supabase: any;
}): Promise<number> {
  const responseByKey = new Map<string, any>();
  for (const item of Array.isArray(params.generatedOptions) ? params.generatedOptions : []) {
    const label = typeof item?.label === "string" ? item.label : "";
    const value = typeof item?.value === "string" ? item.value : "";
    const key = normalizeText([params.component.key, label, value].filter(Boolean).join(" "));
    if (!key || responseByKey.has(key)) continue;
    responseByKey.set(key, item);
  }

  let stored = 0;
  for (const option of params.options) {
    const responseKey = normalizeText([params.component.key, option.label, option.value].filter(Boolean).join(" "));
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
      variationKey: option.value,
    });
    if (!upload) continue;

    const promptText = buildRefinementPromptForSeed({
      categoryLabel: params.component.label,
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
          refinement_category_key: params.component.key,
          refinement_category_label: params.component.label,
          refinement_category_name: String(params.categoryName || "").trim() || null,
          refinement_priority: Number(params.component.priority || 0) || null,
          refinement_quality: "draft",
          refinement_reason: String(params.component.reason || "").trim() || null,
          refinement_scope: "subcategory",
          refinement_source: REFINEMENT_PLANNER_SOURCE,
          refinement_status: "ready",
          refinement_subcategory_id: params.subcategoryId,
          refinement_subcategory_name: String(params.subcategoryName || "").trim() || null,
          refinement_variation_key: option.value,
          refinement_variation_label: option.label,
          refinement_version: 1,
          s3_path: upload.storagePath,
          source: "instance_refinement_seed",
        },
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

function seedsForComponent(
  optionSeeds: any[],
  componentKey: string,
): RefinementOptionSeed[] {
  for (const group of Array.isArray(optionSeeds) ? optionSeeds : []) {
    if (!group || typeof group !== "object") continue;
    const ck = normalizeComponentKey((group as any).componentKey || (group as any).component_key);
    if (ck !== componentKey) continue;
    const opts = (group as any).options;
    if (!Array.isArray(opts)) return [];
    const out: RefinementOptionSeed[] = [];
    for (const o of opts) {
      if (!o || typeof o !== "object") continue;
      const label = String((o as any).label || "").trim();
      const value = String((o as any).value || "").trim();
      const imagePrompt = String((o as any).imagePrompt || (o as any).image_prompt || "").trim();
      if (!label || !value || imagePrompt.length < 8) continue;
      out.push({ imagePrompt, label, value });
    }
    return out.slice(0, REFINEMENT_LIBRARY_MIN_IMAGES_PER_COMPONENT);
  }
  return [];
}

function missingSeedsForCategory(params: {
  categoryKey: string;
  existingRows: RefinementImageRow[];
  seeds: RefinementOptionSeed[];
  missingCount: number;
}): RefinementOptionSeed[] {
  if (params.missingCount <= 0) return [];
  const existingVariationKeys = new Set<string>();
  for (const row of params.existingRows) {
    if (!isReadyRefinementImage(row)) continue;
    const meta = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null;
    const key = normalizeOptionalString(meta?.refinement_category_key);
    const variationKey = normalizeOptionalString(meta?.refinement_variation_key);
    if (key === params.categoryKey && variationKey) existingVariationKeys.add(variationKey.toLowerCase());
  }
  return params.seeds.filter((s) => !existingVariationKeys.has(s.value.toLowerCase())).slice(0, params.missingCount);
}

export async function planRefinementLibrary(params: {
  baseUrls: string[];
  categoryId?: string | null;
  categoryName?: string | null;
  companySummary?: string | null;
  existingComponents?: StoredSubcategoryComponent[];
  serviceSummary: string;
  subcategoryId: string;
  subcategoryName: string;
  targetComponentCount?: number;
  targetOptionsPerComponent?: number;
}): Promise<{ ok: true; json: any } | { ok: false; error: unknown }> {
  return callFormServiceJson({
    baseUrls: params.baseUrls,
    path: "/v1/api/refinement-library-planner/plan",
    payload: {
      categoryId: params.categoryId,
      categoryName: params.categoryName,
      companySummary: params.companySummary,
      existingComponents: params.existingComponents || [],
      serviceSummary: params.serviceSummary,
      subcategoryId: params.subcategoryId,
      subcategoryName: params.subcategoryName,
      targetComponentCount: params.targetComponentCount ?? REFINEMENT_LIBRARY_TARGET_COMPONENTS,
      targetOptionsPerComponent: params.targetOptionsPerComponent ?? REFINEMENT_LIBRARY_MIN_IMAGES_PER_COMPONENT,
    },
  });
}

async function seedAllMissingImages(params: {
  baseUrls: string[];
  categoryId?: string | null;
  categoryName?: string | null;
  components: RefinementPlannerComponent[];
  instanceId?: string | null;
  optionSeeds: any[];
  serviceSummary: string;
  subcategoryId: string;
  subcategoryName: string;
  supabase: any;
}): Promise<number> {
  let total = 0;
  let refinementRows = await listRefinementImages({
    categoryId: params.categoryId,
    instanceId: params.instanceId,
    subcategoryId: params.subcategoryId,
    supabase: params.supabase,
  });

  for (const component of params.components) {
    const allSeeds = seedsForComponent(params.optionSeeds, component.key);
    if (allSeeds.length === 0) continue;

    const cov = buildCoverage(refinementRows);
    const existingCount = cov.get(component.key) || 0;
    const missingCount = Math.max(0, REFINEMENT_LIBRARY_MIN_IMAGES_PER_COMPONENT - existingCount);
    const missingOptions = missingSeedsForCategory({
      categoryKey: component.key,
      existingRows: refinementRows,
      missingCount,
      seeds: allSeeds,
    });
    if (missingOptions.length === 0) continue;

    const optionResult = await callFormServiceJson({
      baseUrls: params.baseUrls,
      path: "/v1/api/option-images/generate",
      payload: {
        industry: params.categoryName,
        instanceId: params.instanceId,
        modelId: REFINEMENT_OPTION_MODEL_ID,
        options: missingOptions.map((option) => ({
          imagePrompt: option.imagePrompt,
          label: option.label,
          value: option.value,
        })),
        question: buildRefinementCategoryQuestion({
          categoryLabel: component.label,
          subcategoryName: params.subcategoryName,
        }),
        service: params.subcategoryName,
        serviceSummary: params.serviceSummary,
        session: {
          instanceId: params.instanceId,
          sessionId: `refinement-seed:${params.subcategoryId}:${component.key}`,
        },
        stepId: `refinement-seed:${params.subcategoryId}:${component.key}`,
      },
    });

    if (!optionResult.ok || !Array.isArray(optionResult.json?.options)) continue;

    const stored = await persistGeneratedRefinementBatch({
      categoryId: params.categoryId,
      categoryName: params.categoryName,
      component,
      generatedOptions: optionResult.json.options,
      instanceId: params.instanceId,
      options: missingOptions,
      serviceSummary: params.serviceSummary,
      subcategoryId: params.subcategoryId,
      subcategoryName: params.subcategoryName,
      supabase: params.supabase,
    });
    total += stored;
    refinementRows = await listRefinementImages({
      categoryId: params.categoryId,
      instanceId: params.instanceId,
      subcategoryId: params.subcategoryId,
      supabase: params.supabase,
    });
  }

  return total;
}

function plannerComponentsFromResponse(json: any): RefinementPlannerComponent[] {
  const raw = Array.isArray(json?.components) ? json.components : [];
  const out: RefinementPlannerComponent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const key = normalizeComponentKey((item as any).key);
    const label = String((item as any).label || "").trim() || key;
    const reason = String((item as any).reason || "").trim() || `${label} is a visual refinement for this service.`;
    const priority = normalizePriority((item as any).priority, out.length + 1);
    if (!key) continue;
    out.push({ key, label, priority, reason });
  }
  return out.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

export async function ensureRefinementLibraryForSubcategory(params: {
  baseUrls: string[];
  categoryId?: string | null;
  categoryName?: string | null;
  companySummary?: string | null;
  forceReplan?: boolean;
  instanceId?: string | null;
  mode: EnsureRefinementLibraryMode;
  serviceSummary: string;
  subcategoryId: string;
  subcategoryName: string;
  supabase: any;
  existingSubcategoryComponents?: unknown;
  log?: (label: string, data: Record<string, unknown>) => void;
}): Promise<EnsureRefinementLibraryResult> {
  const log = params.log || (() => undefined);
  const stored = parseStoredSubcategoryComponents(params.existingSubcategoryComponents);
  let refinementRows = await listRefinementImages({
    categoryId: params.categoryId,
    instanceId: params.instanceId,
    subcategoryId: params.subcategoryId,
    supabase: params.supabase,
  });

  const catalog = buildRefinementCatalogForWidget(refinementRows, stored);

  if (!params.forceReplan) {
    if (params.mode === "instance_seed") {
      if (hasCompleteRefinementCoverage(refinementRows, stored)) {
        log("refinement_skip_complete", { subcategoryId: params.subcategoryId });
        return { ok: true, skipped: true };
      }
    } else {
      const invalidComponents = stored.length === 0;
      const emptyCatalog = catalog.length === 0;
      if (!invalidComponents && !emptyCatalog) {
        return { ok: true, skipped: true };
      }
    }
  }

  if (params.baseUrls.length === 0) {
    return { error: "DSPy service URL is not configured", ok: false };
  }

  const planned = await planRefinementLibrary({
    baseUrls: params.baseUrls,
    categoryId: params.categoryId,
    categoryName: params.categoryName,
    companySummary: params.companySummary,
    existingComponents: stored,
    serviceSummary: params.serviceSummary,
    subcategoryId: params.subcategoryId,
    subcategoryName: params.subcategoryName,
  });

  if (!planned.ok || !planned.json?.ok) {
    log("refinement_planner_failed", {
      error: planned.ok ? planned.json : (planned as any).error,
      subcategoryId: params.subcategoryId,
    });
    return { error: "refinement_planner_failed", ok: false, plannerCalled: true, plannerOk: false };
  }

  const components = plannerComponentsFromResponse(planned.json);
  const optionSeeds = planned.json.optionSeeds;
  if (components.length === 0 || !Array.isArray(optionSeeds)) {
    return { error: "refinement_planner_empty", ok: false, plannerCalled: true, plannerOk: false };
  }

  const allowed = new Set(components.map((c) => c.key));
  await deleteRefinementOptionsOutsideKeys({
    allowedKeys: allowed,
    subcategoryId: params.subcategoryId,
    supabase: params.supabase,
  });

  const persist = await persistSubcategoryComponentsRow({
    components: components.map((c) => ({
      key: c.key,
      label: c.label,
      priority: c.priority,
      reason: c.reason,
      source: REFINEMENT_PLANNER_SOURCE,
    })),
    subcategoryId: params.subcategoryId,
    supabase: params.supabase,
  });

  if (!persist.ok) {
    return { error: persist.error, ok: false, plannerCalled: true, plannerOk: true };
  }

  const storedImages = await seedAllMissingImages({
    baseUrls: params.baseUrls,
    categoryId: params.categoryId,
    categoryName: params.categoryName,
    components,
    instanceId: params.instanceId,
    optionSeeds,
    serviceSummary: params.serviceSummary,
    subcategoryId: params.subcategoryId,
    subcategoryName: params.subcategoryName,
    supabase: params.supabase,
  });

  log("refinement_ensure_done", {
    componentCount: components.length,
    storedImages,
    subcategoryId: params.subcategoryId,
  });

  return {
    componentsPersisted: true,
    ok: true,
    plannerCalled: true,
    plannerOk: true,
    storedImages,
  };
}
