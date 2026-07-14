export const STUDIO_STARTER_CONCEPT_MIN_COUNT = 6;
export const STUDIO_STARTER_CONCEPT_MAX_COUNT = 8;

export type StarterConceptCatalogSource = "account" | "global";

export type StarterConceptStyleInput = {
  value?: unknown;
  label?: unknown;
  imageUrl?: unknown;
  imageId?: unknown;
  catalogKey?: unknown;
  description?: unknown;
  priceTier?: unknown;
  featuredRank?: unknown;
  catalogSource?: unknown;
};

export type StarterConceptServiceInput = {
  value?: unknown;
  label?: unknown;
  serviceName?: unknown;
  industryId?: unknown;
  industryName?: unknown;
  styleOptions?: StarterConceptStyleInput[] | null;
};

export type StudioStarterConcept = {
  /** Stable within a service catalog; prefers the persisted image row id. */
  id: string;
  imageId?: string;
  catalogKey?: string;
  serviceId: string;
  serviceLabel: string;
  serviceName: string;
  industryId?: string;
  industryName?: string;
  value: string;
  label: string;
  imageUrl: string;
  description?: string;
  priceTier?: string;
  featuredRank?: number;
  catalogSource?: StarterConceptCatalogSource;
};

function text(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function compareText(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a < b) return -1;
  if (a > b) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function positiveInteger(raw: unknown): number | undefined {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

/** Allows public HTTP(S) catalog assets and same-origin paths; rejects inline/active schemes. */
function safeImageUrl(raw: unknown): string {
  const value = text(raw);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "";
}

function normalizeSource(raw: unknown): StarterConceptCatalogSource | undefined {
  return raw === "account" || raw === "global" ? raw : undefined;
}

function compareConcepts(left: StudioStarterConcept, right: StudioStarterConcept): number {
  const leftRanked = typeof left.featuredRank === "number";
  const rightRanked = typeof right.featuredRank === "number";
  if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
  if (leftRanked && rightRanked && left.featuredRank !== right.featuredRank) {
    return Number(left.featuredRank) - Number(right.featuredRank);
  }
  return (
    compareText(left.label, right.label) ||
    compareText(left.value, right.value) ||
    compareText(left.imageId || left.imageUrl, right.imageId || right.imageUrl)
  );
}

function normalizeService(service: StarterConceptServiceInput): {
  id: string;
  label: string;
  name: string;
  industryId?: string;
  industryName?: string;
} | null {
  const id = text(service?.value);
  const label = text(service?.label) || text(service?.serviceName);
  if (!id || !label) return null;
  const name = text(service?.serviceName) || label;
  const industryId = text(service?.industryId) || undefined;
  const industryName = text(service?.industryName) || undefined;
  return { id, label, name, ...(industryId ? { industryId } : {}), ...(industryName ? { industryName } : {}) };
}

/**
 * Builds the canonical visual-first starter set from existing service style catalogs.
 *
 * Candidates are ordered deterministically within each service, then selected in a
 * round-robin so multi-service instances do not let one catalog consume every slot.
 * When fewer than the recommended six safe candidates exist, the safe subset is
 * returned rather than inventing or duplicating imagery; callers can choose a legacy
 * fallback based on the returned count.
 */
export function buildStudioStarterConcepts(
  rawServices: StarterConceptServiceInput[] | null | undefined,
  maxCount = STUDIO_STARTER_CONCEPT_MAX_COUNT,
): StudioStarterConcept[] {
  const limit = Number.isFinite(Number(maxCount))
    ? Math.max(1, Math.min(STUDIO_STARTER_CONCEPT_MAX_COUNT, Math.floor(Number(maxCount))))
    : STUDIO_STARTER_CONCEPT_MAX_COUNT;

  const services = (Array.isArray(rawServices) ? rawServices : [])
    .map((service) => ({ service, normalized: normalizeService(service) }))
    .filter((entry): entry is { service: StarterConceptServiceInput; normalized: NonNullable<ReturnType<typeof normalizeService>> } => Boolean(entry.normalized))
    .sort(
      (left, right) =>
        compareText(left.normalized.label, right.normalized.label) ||
        compareText(left.normalized.id, right.normalized.id),
    );

  const queues = services
    .map(({ service, normalized }) => {
      const seenWithinService = new Set<string>();
      const concepts: StudioStarterConcept[] = [];
      for (const option of Array.isArray(service.styleOptions) ? service.styleOptions : []) {
        const value = text(option?.value);
        const label = text(option?.label) || value;
        const imageUrl = safeImageUrl(option?.imageUrl);
        if (!value || !label || !imageUrl) continue;

        const imageId = text(option?.imageId) || undefined;
        const catalogKey = text(option?.catalogKey) || undefined;
        const stablePart = imageId || catalogKey || value;
        const dedupeKey = `${stablePart.toLowerCase()}|${imageUrl.toLowerCase()}`;
        if (seenWithinService.has(dedupeKey)) continue;
        seenWithinService.add(dedupeKey);

        const description = text(option?.description) || undefined;
        const priceTier = text(option?.priceTier) || undefined;
        const featuredRank = positiveInteger(option?.featuredRank);
        const catalogSource = normalizeSource(option?.catalogSource);
        concepts.push({
          id: `${normalized.id}:${stablePart}`,
          ...(imageId ? { imageId } : {}),
          ...(catalogKey ? { catalogKey } : {}),
          serviceId: normalized.id,
          serviceLabel: normalized.label,
          serviceName: normalized.name,
          ...(normalized.industryId ? { industryId: normalized.industryId } : {}),
          ...(normalized.industryName ? { industryName: normalized.industryName } : {}),
          value,
          label,
          imageUrl,
          ...(description ? { description } : {}),
          ...(priceTier ? { priceTier } : {}),
          ...(featuredRank ? { featuredRank } : {}),
          ...(catalogSource ? { catalogSource } : {}),
        });
      }
      concepts.sort(compareConcepts);
      return concepts;
    })
    .filter((queue) => queue.length > 0);

  const selected: StudioStarterConcept[] = [];
  const seenImageUrls = new Set<string>();
  let depth = 0;
  while (selected.length < limit && queues.some((queue) => depth < queue.length)) {
    for (const queue of queues) {
      const candidate = queue[depth];
      if (!candidate) continue;
      const imageKey = candidate.imageUrl.toLowerCase();
      if (seenImageUrls.has(imageKey)) continue;
      seenImageUrls.add(imageKey);
      selected.push(candidate);
      if (selected.length >= limit) break;
    }
    depth += 1;
  }

  return selected;
}
