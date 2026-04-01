/**
 * After refinement components exist, suggests 3–8 industry-typical scope checklist items
 * (first-step "what do you want done") and persists to categories_subcategories.subcategory_scope.
 */

import {
  callFormServiceJson,
  parseStoredSubcategoryComponents,
  type StoredSubcategoryComponent,
} from "./refinement-library-seed";

export type EnsureSubcategoryScopeResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  scopes?: string[];
  plannerCalled?: boolean;
};

function normalizeScopeList(raw: unknown, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const s = typeof x === "string" ? x.trim() : "";
    if (s.length < 2) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.slice(0, 96));
    if (out.length >= maxLen) break;
  }
  return out;
}

export async function persistSubcategoryScopeRow(params: {
  subcategoryId: string;
  supabase: any;
  scopes: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const scopes = normalizeScopeList(params.scopes, 16);
  const update = await params.supabase
    .from("categories_subcategories")
    .update({
      subcategory_scope: scopes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.subcategoryId);

  if (update.error) {
    return { error: update.error.message || "Failed to persist subcategory_scope", ok: false };
  }
  return { ok: true };
}

/**
 * Calls api-service POST /v1/api/subcategory-scope/suggest with refinement components in the payload.
 * Run after ensureRefinementLibraryForSubcategory so components reflect the latest plan.
 */
export async function suggestSubcategoryScopeOptions(params: {
  baseUrls: string[];
  categoryName?: string | null;
  companySummary?: string | null;
  serviceSummary: string;
  subcategoryId: string;
  subcategoryName: string;
  components: StoredSubcategoryComponent[];
  maxScopeCount?: number;
  minScopeCount?: number;
}): Promise<{ ok: true; scopes: string[]; json: any } | { ok: false; error: unknown }> {
  if (params.baseUrls.length === 0) {
    return { error: "DSPy service URL is not configured", ok: false };
  }
  const payload = {
    categoryName: params.categoryName ?? null,
    companySummary: params.companySummary ?? null,
    components: params.components.map((c) => ({
      key: c.key,
      label: c.label,
      priority: c.priority,
      ...(c.reason ? { reason: c.reason } : {}),
      ...(c.source ? { source: c.source } : {}),
    })),
    maxScopeCount: params.maxScopeCount ?? 8,
    minScopeCount: params.minScopeCount ?? 3,
    serviceSummary: params.serviceSummary,
    subcategoryId: params.subcategoryId,
    subcategoryName: params.subcategoryName,
  };

  const res = await callFormServiceJson({
    baseUrls: params.baseUrls,
    path: "/v1/api/subcategory-scope/suggest",
    payload,
  });

  if (!res.ok) {
    return { error: res.error, ok: false };
  }
  const scopes = normalizeScopeList(res.json?.scopes, 8);
  if (scopes.length < 3) {
    return { error: "scope_suggest_empty", ok: false };
  }
  return { json: res.json, ok: true, scopes };
}

/**
 * Skips when subcategory_scope already has entries (unless force). Requires non-empty components.
 */
export async function ensureSubcategoryScopeForSubcategory(params: {
  baseUrls: string[];
  categoryName?: string | null;
  companySummary?: string | null;
  force?: boolean;
  serviceSummary: string;
  subcategoryId: string;
  subcategoryName: string;
  supabase: any;
  /** From categories_subcategories.subcategory_components (parsed or raw). */
  subcategoryComponents: unknown;
  /** From categories_subcategories.subcategory_scope — skip seed if already set. */
  existingSubcategoryScope?: string[] | null;
  log?: (label: string, data: Record<string, unknown>) => void;
}): Promise<EnsureSubcategoryScopeResult> {
  const log = params.log || (() => undefined);
  const existing = Array.isArray(params.existingSubcategoryScope)
    ? params.existingSubcategoryScope.filter((s) => typeof s === "string" && s.trim())
    : [];
  if (!params.force && existing.length > 0) {
    log("subcategory_scope_skip_existing", { subcategoryId: params.subcategoryId });
    return { ok: true, skipped: true };
  }

  const components = parseStoredSubcategoryComponents(params.subcategoryComponents);
  if (components.length === 0) {
    log("subcategory_scope_skip_no_components", { subcategoryId: params.subcategoryId });
    return { error: "no_components", ok: false };
  }

  const suggested = await suggestSubcategoryScopeOptions({
    baseUrls: params.baseUrls,
    categoryName: params.categoryName,
    companySummary: params.companySummary,
    components,
    serviceSummary: params.serviceSummary,
    subcategoryId: params.subcategoryId,
    subcategoryName: params.subcategoryName,
  });

  if (!suggested.ok) {
    return { error: typeof suggested.error === "string" ? suggested.error : "scope_suggest_failed", ok: false };
  }

  const persist = await persistSubcategoryScopeRow({
    scopes: suggested.scopes,
    subcategoryId: params.subcategoryId,
    supabase: params.supabase,
  });

  if (!persist.ok) {
    return { error: persist.error, ok: false };
  }

  log("subcategory_scope_persisted", {
    count: suggested.scopes.length,
    subcategoryId: params.subcategoryId,
  });

  return { ok: true, plannerCalled: true, scopes: suggested.scopes };
}
