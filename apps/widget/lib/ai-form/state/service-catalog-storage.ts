"use client";

import type { RefinementComponent } from "@/types/ai-form";

export type ServiceCatalogItem = {
  serviceId: string;
  serviceName: string | null;
  industryId: string | null;
  industryName: string | null;
  serviceSummary?: string | null;
  heroCtaUrl?: string | null;
  heroCtaText?: string | null;
  subcategoryComponents?: RefinementComponent[];
  /** Preset labels for the first scope question (from categories_subcategories.subcategory_scope). */
  subcategoryScope?: string[];
  styleQuestion?: string | null;
  styleOptions?: Array<{
    label: string;
    value: string;
    imageUrl: string;
    description?: string | null;
    priceTier?: string | null;
    featuredRank?: number | null;
  }>;
};

export type ServiceCatalogSnapshot = {
  v: 1;
  byServiceId: Record<string, ServiceCatalogItem>;
};

function coerceSubcategoryComponents(raw: unknown): RefinementComponent[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: RefinementComponent[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const key = typeof (entry as any).key === "string" ? (entry as any).key.trim() : "";
    if (!key) continue;
    const dedupeKey = key.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const label =
      typeof (entry as any).label === "string" && (entry as any).label.trim()
        ? (entry as any).label.trim()
        : key;
    const priorityRaw = Number((entry as any).priority);
    items.push({
      key,
      label,
      priority: Number.isFinite(priorityRaw) ? priorityRaw : index + 1,
    });
  }
  return items;
}

function storageKey(sessionId: string) {
  return `serviceCatalog:${sessionId}`;
}

export function loadServiceCatalog(sessionId: string): ServiceCatalogSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if ((parsed as any).v !== 1) return null;
    if (!(parsed as any).byServiceId || typeof (parsed as any).byServiceId !== "object") return null;
    return parsed as ServiceCatalogSnapshot;
  } catch {
    return null;
  }
}

export function saveServiceCatalog(sessionId: string, items: ServiceCatalogItem[] | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      window.localStorage.removeItem(storageKey(sessionId));
      return;
    }
    const byServiceId: Record<string, ServiceCatalogItem> = {};
    for (const item of items) {
      const serviceId = typeof item?.serviceId === "string" ? item.serviceId : "";
      if (!serviceId) continue;
      const subcategoryComponents = coerceSubcategoryComponents((item as any)?.subcategoryComponents);
      byServiceId[serviceId] = {
        serviceId,
        serviceName: typeof item?.serviceName === "string" ? item.serviceName : null,
        industryId: typeof item?.industryId === "string" ? item.industryId : null,
        industryName: typeof item?.industryName === "string" ? item.industryName : null,
        serviceSummary: typeof (item as any)?.serviceSummary === "string" ? String((item as any).serviceSummary).trim() || null : null,
        ...(typeof (item as any)?.heroCtaUrl === "string" && String((item as any).heroCtaUrl).trim()
          ? { heroCtaUrl: String((item as any).heroCtaUrl).trim() }
          : {}),
        ...(typeof (item as any)?.heroCtaText === "string" && String((item as any).heroCtaText).trim()
          ? { heroCtaText: String((item as any).heroCtaText).trim() }
          : {}),
        ...(subcategoryComponents.length > 0 ? { subcategoryComponents } : {}),
        ...(Array.isArray((item as any)?.subcategoryScope) && (item as any).subcategoryScope.length > 0
          ? {
              subcategoryScope: (item as any).subcategoryScope
                .map((s: any) => (typeof s === "string" ? s.trim() : ""))
                .filter(Boolean)
                .slice(0, 16),
            }
          : {}),
        styleQuestion: typeof (item as any)?.styleQuestion === "string" ? String((item as any).styleQuestion).trim() || null : null,
        styleOptions: Array.isArray((item as any)?.styleOptions)
          ? (item as any).styleOptions
              .map((opt: any) => ({
                label: typeof opt?.label === "string" ? opt.label : "",
                value: typeof opt?.value === "string" ? opt.value : "",
                imageUrl: typeof opt?.imageUrl === "string" ? opt.imageUrl : "",
                description: typeof opt?.description === "string" ? opt.description : null,
                priceTier: typeof opt?.priceTier === "string" ? opt.priceTier : null,
                featuredRank:
                  Number.isFinite(Number(opt?.featuredRank ?? opt?.featured_rank)) && Number(opt?.featuredRank ?? opt?.featured_rank) > 0
                    ? Math.floor(Number(opt?.featuredRank ?? opt?.featured_rank))
                    : null,
              }))
              .filter((opt: any) => opt.label && opt.value && opt.imageUrl)
              .slice(0, 20)
          : undefined,
      };
    }
    const snapshot: ServiceCatalogSnapshot = { v: 1, byServiceId };
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(snapshot));
  } catch {}
}

export function clearServiceCatalog(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(sessionId));
  } catch {}
}
