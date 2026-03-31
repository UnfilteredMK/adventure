import type { Suggestion } from "@/types";

export type SuggestionToolbarMode = "budget" | "uploads" | "prompt";

/**
 * Heuristic routing: which lower toolbar tab to emphasize after a suggestion is applied.
 */
export function inferSuggestionToolbarMode(s: Suggestion): SuggestionToolbarMode {
  const t = `${s.text} ${s.prompt || ""}`.toLowerCase();
  if (/\$|budget|cost range|price increase|premium materials|increase.*\d/.test(t)) {
    return "budget";
  }
  if (/upload|your photo|reference image|your image|attach/.test(t)) {
    return "uploads";
  }
  return "prompt";
}
