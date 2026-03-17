import type { Json } from "@/types/database";
import { IMAGES_BUCKET, IMAGE_STORAGE_PREFIXES } from "@/storage/prefixes";

export const SUBCATEGORY_IMAGE_CATALOG_GENERATED_FOR = "subcategory_catalog";
export const SUBCATEGORY_IMAGE_CATALOG_MODEL_ID = "black-forest-labs/flux-schnell";
export const SUBCATEGORY_IMAGE_CATALOG_SEED_COUNT = 20;
export const SUBCATEGORY_IMAGE_CATALOG_MAX_IMAGES = 50;

const PRICE_TIER_DESCS: Record<string, string> = {
  "$": "Budget-friendly, builder-grade materials, economy finishes, standard fixtures.",
  "$$": "Mid-range quality, quartz or laminate surfaces, semi-custom details.",
  "$$$": "Premium materials, natural stone, custom cabinetry, high-end fixtures.",
  "$$$$": "Luxury, bespoke finishes, marble, custom millwork, designer fixtures.",
};

export type CatalogOptionInput = {
  description?: string | null;
  label?: string | null;
  value?: string | null;
  imagePrompt?: string | null;
  priceTier?: string | null;
};

type CatalogImageRow = {
  account_id: string | null;
  created_at: string | null;
  id: string;
  image_url: string;
  metadata: Record<string, any> | null;
  prompt_id: string | null;
  status: string | null;
  subcategory_id: string | null;
  user_id: string | null;
};

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

function isHttpImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isCatalogImage(row: CatalogImageRow): boolean {
  const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
  return String(meta?.generated_for || "") === SUBCATEGORY_IMAGE_CATALOG_GENERATED_FOR;
}

function buildContextPrompt(params: {
  question?: string | null;
  serviceSummary?: string | null;
  categoryName?: string | null;
  subcategoryName?: string | null;
}): string {
  const serviceSummary = String(params.serviceSummary || "").trim();
  const categoryName = String(params.categoryName || "").trim();
  const subcategoryName = String(params.subcategoryName || "").trim();
  const question = String(params.question || "").trim() || "Choose a direction.";
  const subject = serviceSummary || [categoryName, subcategoryName].filter(Boolean).join(": ") || subcategoryName || "Service";
  return `${subject}: ${question}`;
}

export function buildCatalogKeyForOption(option: CatalogOptionInput): string {
  const raw =
    String(option.imagePrompt || "").trim() ||
    String(option.label || "").trim() ||
    String(option.value || "").trim();
  const tier = String(option.priceTier || "").trim();
  return normalizeText([raw, tier].filter(Boolean).join(" "));
}

export function buildCatalogPromptForOption(params: {
  option: CatalogOptionInput;
  question?: string | null;
  serviceSummary?: string | null;
  categoryName?: string | null;
  subcategoryName?: string | null;
}): string {
  const promptText =
    String(params.option.imagePrompt || "").trim() ||
    String(params.option.label || "").trim() ||
    String(params.option.value || "").trim() ||
    "Design direction";
  const description = String(params.option.description || "").trim();
  const tier = String(params.option.priceTier || "").trim();
  const tierSuffix = tier && PRICE_TIER_DESCS[tier] ? ` Price tier cues: ${PRICE_TIER_DESCS[tier]}` : "";
  const context = buildContextPrompt(params);
  const descriptionSuffix = description ? ` Direction details: ${description}` : "";
  return `Photorealistic photo, no text, no words, no letters, no labels, no captions, no watermarks, no signs. ${context}. Option: ${promptText}.${descriptionSuffix}${tierSuffix}`;
}

export async function listCatalogImages(params: {
  supabase: any;
  subcategoryId: string;
  accountId?: string | null;
  includeGlobal?: boolean;
}): Promise<CatalogImageRow[]> {
  const selectCols = "id, image_url, metadata, created_at, prompt_id, subcategory_id, status, account_id, user_id";
  const accountId = String(params.accountId || "").trim() || null;
  const [accountResult, globalResult] = await Promise.all([
    accountId
      ? params.supabase
          .from("images")
          .select(selectCols)
          .eq("subcategory_id", params.subcategoryId)
          .eq("account_id", accountId)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    params.includeGlobal === false
      ? Promise.resolve({ data: [], error: null })
      : params.supabase
          .from("images")
          .select(selectCols)
          .eq("subcategory_id", params.subcategoryId)
          .is("account_id", null)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(100),
  ]);

  const merged = [...(Array.isArray(accountResult.data) ? accountResult.data : []), ...(Array.isArray(globalResult.data) ? globalResult.data : [])];
  const seen = new Set<string>();
  const filtered: CatalogImageRow[] = [];
  for (const row of merged as CatalogImageRow[]) {
    if (!row?.id || seen.has(row.id) || !isCatalogImage(row)) continue;
    seen.add(row.id);
    filtered.push(row);
  }
  return filtered;
}

async function uploadCatalogImageFromUrl(params: {
  supabase: any;
  imageUrl: string;
  subcategoryId: string;
  fileHint: string;
}): Promise<{ publicUrl: string; storagePath: string } | null> {
  const resp = await fetch(params.imageUrl, { cache: "no-store" });
  if (!resp.ok) return null;
  const contentType = String(resp.headers.get("content-type") || "image/webp").trim() || "image/webp";
  const storagePath = `${IMAGE_STORAGE_PREFIXES.subcategory}/${params.subcategoryId}/${Date.now()}-${slugifySegment(params.fileHint)}.webp`;
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

export async function persistGeneratedCatalogImages(params: {
  supabase: any;
  generatedOptions: any[];
  options: CatalogOptionInput[];
  scope: "global" | "account";
  accountId?: string | null;
  instanceId?: string | null;
  subcategoryId: string;
  subcategoryName?: string | null;
  categoryName?: string | null;
  question?: string | null;
  serviceSummary?: string | null;
  source: "instance_seed" | "widget_option_images";
  stepId?: string | null;
}): Promise<number> {
  const currentRows = await listCatalogImages({
    accountId: params.scope === "account" ? params.accountId : null,
    includeGlobal: false,
    subcategoryId: params.subcategoryId,
    supabase: params.supabase,
  });
  const remainingSlots = Math.max(0, SUBCATEGORY_IMAGE_CATALOG_MAX_IMAGES - currentRows.length);
  if (remainingSlots === 0) return 0;

  const responseByKey = new Map<string, any>();
  for (const item of Array.isArray(params.generatedOptions) ? params.generatedOptions : []) {
    const key = buildCatalogKeyForOption({
      description: typeof item?.description === "string" ? item.description : typeof item?.descriptor === "string" ? item.descriptor : null,
      imagePrompt: typeof item?.image_prompt === "string" ? item.image_prompt : typeof item?.imagePrompt === "string" ? item.imagePrompt : null,
      label: typeof item?.label === "string" ? item.label : null,
      priceTier: typeof item?.price_tier === "string" ? item.price_tier : typeof item?.priceTier === "string" ? item.priceTier : null,
      value: typeof item?.value === "string" ? item.value : null,
    });
    if (!key || responseByKey.has(key)) continue;
    responseByKey.set(key, item);
  }

  let stored = 0;

  for (const option of params.options) {
    if (stored >= remainingSlots) break;
    const key = buildCatalogKeyForOption(option);
    if (!key) continue;
    const generated = responseByKey.get(key);
    const imageUrl =
      typeof generated?.imageUrl === "string"
        ? generated.imageUrl
        : typeof generated?.image_url === "string"
          ? generated.image_url
          : typeof generated?.image === "string"
            ? generated.image
            : "";
    if (!isHttpImageUrl(imageUrl)) continue;

    const promptText = buildCatalogPromptForOption({
      categoryName: params.categoryName,
      option,
      question: params.question,
      serviceSummary: params.serviceSummary,
      subcategoryName: params.subcategoryName,
    });
    const upload = await uploadCatalogImageFromUrl({
      fileHint: `${option.label || option.value || key}`,
      imageUrl,
      subcategoryId: params.subcategoryId,
      supabase: params.supabase,
    });
    if (!upload) continue;

    const promptInsert = await params.supabase
      .from("prompts")
      .insert({
        account_id: params.scope === "account" ? params.accountId || null : null,
        prompt: promptText,
        variables: null,
      })
      .select("id")
      .single();
    const promptId = String(promptInsert?.data?.id || "");

    const imageInsert = await params.supabase
      .from("images")
      .insert({
        account_id: params.scope === "account" ? params.accountId || null : null,
        image_url: upload.publicUrl,
        instance_id: null,
        metadata: {
          catalog_key: key,
          catalog_scope: params.scope,
          category_name: String(params.categoryName || "").trim() || null,
          generated_for: SUBCATEGORY_IMAGE_CATALOG_GENERATED_FOR,
          image_prompt_source: String(option.imagePrompt || "").trim() || null,
          model_id: SUBCATEGORY_IMAGE_CATALOG_MODEL_ID,
          option_description: String(option.description || "").trim() || null,
          option_label: String(option.label || "").trim() || null,
          option_value: String(option.value || "").trim() || null,
          origin_instance_id: String(params.instanceId || "").trim() || null,
          price_tier: String(option.priceTier || "").trim() || null,
          prompt_text: promptText,
          question_text: String(params.question || "").trim() || null,
          s3_path: upload.storagePath,
          source: params.source,
          source_step_id: String(params.stepId || "").trim() || null,
          subcategory_id: params.subcategoryId,
          subcategory_name: String(params.subcategoryName || "").trim() || null,
        } as Json,
        model_id: SUBCATEGORY_IMAGE_CATALOG_MODEL_ID,
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

export function isSystemOwnedSubcategory(row: { account_id?: string | null; user_id?: string | null } | null | undefined): boolean {
  return !row?.account_id && !row?.user_id;
}
