import { Suggestion } from "../types";
import { createClient } from "../supabase/client";
import { fetchPreviewSuggestionsForInstance } from "./preview-suggestions-query";

export type { Suggestion };

/**
 * Get suggestions from the database based on instance subcategories.
 * Chip text uses `prompts.suggestion_label` when set. Appends a style suffix to `prompt` for legacy gallery generate behavior.
 */
export const getSuggestions = async (instanceId: string, count: number = 3): Promise<Suggestion[]> => {
  try {
    if (!instanceId) {
      console.warn("No instanceId provided for suggestions");
      return [];
    }

    const supabase = createClient();
    const base = await fetchPreviewSuggestionsForInstance(supabase, instanceId, count);
    return base.map((s) => ({
      ...s,
      prompt:
        s.prompt && s.style ? `${s.prompt}, in the style of ${s.style}` : s.prompt,
    }));
  } catch (error) {
    console.error("Error getting suggestions from database:", error);
    return [];
  }
};

/**
 * Legacy function for backward compatibility - now just calls getSuggestions
 * @deprecated Use getSuggestions instead
 */
export const getDynamicSuggestions = async (
  instanceId: string,
  count: number = 3,
  _supabase?: unknown
): Promise<Suggestion[]> => {
  void _supabase;
  return getSuggestions(instanceId, count);
};

/**
 * Legacy function for backward compatibility - now returns empty array
 * @deprecated Use getSuggestions instead
 */
export const getRandomSuggestions = (count: number = 3): Suggestion[] => {
  void count;
  console.warn("getRandomSuggestions is deprecated. Use getSuggestions instead.");
  return [];
};
