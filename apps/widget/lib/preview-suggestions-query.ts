import type { SupabaseClient } from "@supabase/supabase-js";
import type { Suggestion } from "@/types";

/** Browser + server Supabase clients use different Database generics; keep the query loose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase client generic varies by browser vs service role
type AnyPublicClient = SupabaseClient<any, "public", any>;

const artStyles = [
  "anime",
  "art nouveau",
  "ukiyo-e",
  "watercolor",
  "photorealistic",
  "digital art",
  "oil painting",
  "sketch",
];

function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

type CsRow = {
  subcategory?: string;
  categories?: { name?: string };
};

function normalizeCs(
  cs: CsRow | CsRow[] | null | undefined
): { subcategory: string; category: string } | null {
  if (!cs) return null;
  const row = Array.isArray(cs) ? cs[0] : cs;
  if (!row) return null;
  return {
    subcategory: row.subcategory || "Unknown",
    category: (row.categories?.name as string) || "Unknown",
  };
}

/**
 * Loads suggestion chips for an instance: instance_subcategories → images (prompt_id) → prompts,
 * plus prompts tied directly via `prompts.subcategory_id` (no image required).
 * IDEAS chips use only `prompts.suggestion_label` (rows without a label are omitted).
 * `Suggestion.prompt` remains the full DB prompt for apply/refinement (not shown on the chip).
 */
export async function fetchPreviewSuggestionsForInstance(
  supabase: AnyPublicClient,
  instanceId: string,
  count: number = 5
): Promise<Suggestion[]> {
  if (!instanceId) return [];

  const { data: instanceSubcategories, error: subError } = await supabase
    .from("instance_subcategories")
    .select(
      `
      category_subcategory_id,
      categories_subcategories (
        id,
        subcategory,
        categories ( name )
      )
    `
    )
    .eq("instance_id", instanceId);

  if (subError || !instanceSubcategories?.length) {
    return [];
  }

  const subcategoryIds = (
    instanceSubcategories as Array<{
      categories_subcategories?: { id?: string } | Array<{ id?: string }> | null;
    }>
  )
    .map((item) => {
      const cs = item.categories_subcategories;
      if (!cs) return undefined;
      return Array.isArray(cs) ? cs[0]?.id : cs.id;
    })
    .filter(Boolean) as string[];

  if (subcategoryIds.length === 0) return [];

  type PromptRow = {
    id: string;
    prompt: string;
    variables?: unknown;
    suggestion_label: string | null;
    subcategory_id?: string | null;
    categories_subcategories?: CsRow | CsRow[] | null;
  };

  const imagesQuery = supabase
    .from("images")
    .select(
      `
      id,
      prompt_id,
      subcategory_id,
      categories_subcategories (
        subcategory,
        categories ( name )
      )
    `
    )
    .in("subcategory_id", subcategoryIds)
    .not("prompt_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const promptsBySubcategoryQuery = supabase
    .from("prompts")
    .select(
      `
      id,
      prompt,
      variables,
      suggestion_label,
      subcategory_id,
      categories_subcategories (
        subcategory,
        categories ( name )
      )
    `
    )
    .in("subcategory_id", subcategoryIds)
    .limit(100);

  const [{ data: images, error: imageError }, { data: fromSubcategory, error: pe2 }] = await Promise.all([
    imagesQuery,
    promptsBySubcategoryQuery,
  ]);

  if (imageError || pe2) {
    return [];
  }

  const imageRows = (images || []) as Array<{
    prompt_id?: string;
    categories_subcategories?: CsRow | CsRow[];
  }>;

  const promptIdsFromImages = [
    ...new Set(imageRows.map((img) => img.prompt_id).filter(Boolean)),
  ] as string[];

  const promptById = new Map<string, PromptRow>();

  if (promptIdsFromImages.length > 0) {
    const { data: fromImages, error: pe1 } = await supabase
      .from("prompts")
      .select(
        `
        id,
        prompt,
        variables,
        suggestion_label,
        subcategory_id,
        categories_subcategories (
          subcategory,
          categories ( name )
        )
      `
      )
      .in("id", promptIdsFromImages);

    if (pe1) {
      return [];
    }
    for (const p of fromImages || []) {
      promptById.set(String((p as PromptRow).id), p as PromptRow);
    }
  }

  for (const p of fromSubcategory || []) {
    const row = p as PromptRow;
    if (!promptById.has(row.id)) {
      promptById.set(row.id, row);
    }
  }

  if (promptById.size === 0) return [];

  const seenPromptIds = new Set<string>();
  const suggestions: Array<{
    id: string;
    prompt: string;
    suggestion_label: string | null;
    category: string;
    subcategory: string;
    variables?: unknown;
  }> = [];

  for (const image of imageRows) {
    const pid = image.prompt_id as string | undefined;
    if (!pid || seenPromptIds.has(pid)) continue;
    const promptData = promptById.get(pid);
    if (!promptData || !image.categories_subcategories) continue;
    const names = normalizeCs(image.categories_subcategories);
    if (!names) continue;
    seenPromptIds.add(pid);
    suggestions.push({
      id: promptData.id,
      prompt: promptData.prompt,
      suggestion_label: promptData.suggestion_label,
      category: names.category,
      subcategory: names.subcategory,
      variables: promptData.variables,
    });
  }

  for (const promptData of promptById.values()) {
    if (seenPromptIds.has(promptData.id)) continue;
    const sid = promptData.subcategory_id;
    if (!sid || !subcategoryIds.includes(sid)) continue;
    const names = normalizeCs(promptData.categories_subcategories);
    if (!names) continue;
    seenPromptIds.add(promptData.id);
    suggestions.push({
      id: promptData.id,
      prompt: promptData.prompt,
      suggestion_label: promptData.suggestion_label,
      category: names.category,
      subcategory: names.subcategory,
      variables: promptData.variables,
    });
  }

  const labeledOnly = suggestions.filter((s) => String(s.suggestion_label || "").trim().length > 0);
  if (labeledOnly.length === 0) return [];

  const shuffledSuggestions = shuffle(labeledOnly);
  const selected = shuffledSuggestions.slice(0, Math.max(1, count));
  const shuffledStyles = shuffle(artStyles);

  return selected.map((item, index) => {
    const raw = item.prompt.trim();
    const suggestionLabel = item.suggestion_label!.trim();
    return {
      promptId: item.id,
      text: suggestionLabel,
      suggestionLabel,
      prompt: raw,
      category: item.category,
      subcategory: item.subcategory,
      style: shuffledStyles[index % shuffledStyles.length],
    };
  });
}
