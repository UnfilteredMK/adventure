/** Default max length for `prompts.suggestion_label` (chip UI). */
export const DEFAULT_SUGGESTION_LABEL_MAX = 50;

/**
 * Builds a short label for suggestion chips. Prefer a human-facing short string (e.g. option label)
 * when available; otherwise truncate the full prompt.
 */
export function buildSuggestionLabel(
  fullPrompt: string,
  preferredShort?: string | null,
  maxLen: number = DEFAULT_SUGGESTION_LABEL_MAX
): string {
  const preferred = typeof preferredShort === "string" ? preferredShort.trim() : "";
  if (preferred) {
    return preferred.length <= maxLen ? preferred : `${preferred.slice(0, Math.max(0, maxLen - 1))}…`;
  }
  const p = String(fullPrompt || "").trim();
  if (!p) return "";
  return p.length <= maxLen ? p : `${p.slice(0, Math.max(0, maxLen - 1))}…`;
}
