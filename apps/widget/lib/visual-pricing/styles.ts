import type { JourneyStyleOption } from "./types";

export function selectFeaturedStyles(
  options: JourneyStyleOption[],
  count = 6,
): { featured: JourneyStyleOption[]; remaining: JourneyStyleOption[] } {
  const normalized = Array.isArray(options) ? options.filter((option) => option && option.value && option.label) : [];
  const ranked = normalized
    .map((option, catalogIndex) => ({ option, catalogIndex }))
    .filter(({ option }) => Number.isFinite(Number(option.featuredRank)) && Number(option.featuredRank) > 0)
    .sort((a, b) => Number(a.option.featuredRank) - Number(b.option.featuredRank) || a.catalogIndex - b.catalogIndex);

  const featured: JourneyStyleOption[] = [];
  const selectedValues = new Set<string>();
  for (const { option } of ranked) {
    if (selectedValues.has(option.value)) continue;
    featured.push(option);
    selectedValues.add(option.value);
    if (featured.length >= count) break;
  }
  for (const option of normalized) {
    if (featured.length >= count) break;
    if (selectedValues.has(option.value)) continue;
    featured.push(option);
    selectedValues.add(option.value);
  }

  return {
    featured,
    remaining: normalized.filter((option) => !selectedValues.has(option.value)),
  };
}

export function toggleOrderedStyleSelection(selected: string[], value: string): string[] {
  const current = Array.isArray(selected) ? selected.filter(Boolean).slice(0, 2) : [];
  if (current.includes(value)) return current.filter((entry) => entry !== value);
  if (current.length >= 2) return [current[0], value];
  return [...current, value];
}

export function limitComponentPriorities(values: string[]): string[] {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))).slice(0, 4);
}

