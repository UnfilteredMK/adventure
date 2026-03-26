import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/server/logger';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

function coerceSubcategoryComponents(
  raw: unknown,
): Array<{ key: string; label: string; priority: number }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: Array<{ key: string; label: string; priority: number }> = [];
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

function coerceHeroCtaText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t || null;
}

function coerceHeroCtaUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return t;
  return null;
}

function buildCatalogStyleOptions(rows: any[]): {
  options: Array<{
    label: string;
    value: string;
    imageUrl: string;
    description?: string | null;
    priceTier?: string | null;
  }>;
  question: string | null;
} {
  const seen = new Set<string>();
  const options: Array<{
    label: string;
    value: string;
    imageUrl: string;
    description?: string | null;
    priceTier?: string | null;
  }> = [];
  let question: string | null = null;

  for (const row of Array.isArray(rows) ? rows : []) {
    const meta = row?.metadata && typeof row.metadata === "object" ? row.metadata : null;
    const generatedFor = String(meta?.generated_for || "").trim();
    if (!meta || (generatedFor !== "style_seed" && generatedFor !== "subcategory_catalog")) continue;
    const label =
      typeof meta.option_label === "string" && meta.option_label.trim()
        ? meta.option_label.trim()
        : typeof meta.option_value === "string" && meta.option_value.trim()
          ? meta.option_value.trim()
          : "";
    const value =
      typeof meta.option_value === "string" && meta.option_value.trim()
        ? meta.option_value.trim()
        : label;
    const imageUrl = typeof row?.image_url === "string" ? row.image_url.trim() : "";
    if (!label || !value || !imageUrl) continue;
    const dedupeKey =
      typeof meta.catalog_key === "string" && meta.catalog_key.trim()
        ? meta.catalog_key.trim().toLowerCase()
        : value.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    options.push({
      label,
      value,
      imageUrl,
      ...(typeof meta.option_description === "string" && meta.option_description.trim()
        ? { description: meta.option_description.trim() }
        : {}),
      ...(typeof meta.price_tier === "string" && meta.price_tier.trim()
        ? { priceTier: meta.price_tier.trim() }
        : {}),
    });
    if (!question && typeof meta.question_text === "string" && meta.question_text.trim()) {
      question = meta.question_text.trim();
    }
  }

  return { options, question };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { instanceId: string } }
) {
  const timestamp = new Date().toISOString();
  const startedAtMs = Date.now();
  const requestId = `instance_${startedAtMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const instanceId = params.instanceId;
    const debugEnabled = (() => {
      try {
        const url = new URL(request.url);
        const v = (url.searchParams.get("debug") || url.searchParams.get("ai_form_debug") || url.searchParams.get("form_debug") || "")
          .trim()
          .toLowerCase();
        return v === "1" || v === "true" || v === "yes" || v === "on";
      } catch {
        return false;
      }
    })();
    const hintedServiceId = (() => {
      try {
        const url = new URL(request.url);
        const raw =
          url.searchParams.get("serviceId") ||
          url.searchParams.get("service_id") ||
          url.searchParams.get("service") ||
          null;
        return raw ? String(raw).trim() : null;
      } catch {
        return null;
      }
    })();
    if (debugEnabled) {
      logger.info("[instance] REQUEST", {
        requestId,
        instanceId,
        hintedServiceId,
        method: request.method,
        url: request.url,
      });
    }
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Try service role key first, fallback to anon key
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Missing environment variables' },
        { status: 500, headers: { "X-Request-Id": requestId } }
      );
    }

    // Create a fresh Supabase client for each request to avoid any caching
    const supabase = createClient(supabaseUrl, supabaseKey, {
      db: {
        schema: 'public'
      },
      global: {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'X-Cache-Bust': Date.now().toString()
        }
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });

    // First, let's check if the instance exists at all (this will help debug RLS issues)
    
    const { data: instanceExists, error: existsError } = await supabase
      .from('instances')
      .select('id, is_public')
      .eq('id', instanceId)
      .maybeSingle();

    if (existsError) {
      
    } else if (!instanceExists) {
      
      return NextResponse.json({
        error: 'Instance not found',
        instanceId: instanceId,
        details: 'Instance does not exist in database'
      }, { status: 404, headers: { "X-Request-Id": requestId } });
    } else {
      
    }

    // Fetch the instance data with explicit cache busting and force fresh data
    
    
    // Force fresh data by using a cache-busting approach
    const { data: instance, error: instanceError } = await supabase
      .from('instances')
      .select('*')
      .eq('id', instanceId)
      .single();
      
    // Log any query errors for debugging
    if (instanceError) {
      
    }

    if (instanceError) {
      
      return NextResponse.json({
        error: 'Instance not found',
        instanceId: instanceId,
        errorCode: instanceError.code,
        errorMessage: instanceError.message,
        details: 'This could be due to RLS policy blocking access (is_public = false) or instance does not exist'
      }, { status: 404, headers: { "X-Request-Id": requestId } });
    }

    const responseTimestamp = new Date().toISOString();
    
    const { data: rawConfig, error: rawError } = await supabase
      .from('instances')
      .select('config, updated_at, created_at, name')
      .eq('id', instanceId)
      .single();
      
    if (!rawError && rawConfig) {
      
    } else {
      
    }

    // Provide deterministic service options to the client so the form can render
    // service-selection without needing to hit /api/ai-form/:id/generate-steps.
    let serviceOptions: Array<{
      label: string;
      value: string;
      industryId?: string | null;
      industryName?: string | null;
      serviceName?: string | null;
      serviceSummary?: string | null;
      heroCtaUrl?: string | null;
      heroCtaText?: string | null;
      subcategoryComponents?: Array<{
        key: string;
        label: string;
        priority: number;
      }>;
      styleQuestion?: string | null;
      styleOptions?: Array<{
        label: string;
        value: string;
        imageUrl: string;
        description?: string | null;
        priceTier?: string | null;
      }>;
    }> = [];
    try {
      const { data: instanceSubcats, error: instanceSubcatsError } = await supabase
        .from("instance_subcategories")
        .select("category_subcategory_id")
        .eq("instance_id", instanceId);
      if (instanceSubcatsError) {
        logger.warn("[widget] Failed to read instance_subcategories for serviceOptions", {
          instanceId,
          error: instanceSubcatsError.message,
          code: (instanceSubcatsError as any).code,
        });
      }
      if (Array.isArray(instanceSubcats) && instanceSubcats.length > 0) {
        const ids = instanceSubcats
          .map((r: any) => r?.category_subcategory_id)
          .filter(Boolean) as string[];
        if (ids.length > 0) {
          const { data: subcats, error: subcatsError } = await supabase
            .from("categories_subcategories")
            .select(
              "id, subcategory, category_id, service_summary, subcategory_components, hero_cta_url, hero_cta_text, categories(name)",
            )
            .in("id", ids)
            .limit(60);
          if (subcatsError) {
            logger.warn("[widget] Failed to read categories_subcategories for serviceOptions", {
              instanceId,
              error: subcatsError.message,
              code: (subcatsError as any).code,
            });
          }
          const metaById = new Map<
            string,
            {
              serviceName: string;
              industryId: string | null;
              industryName: string | null;
              serviceSummary: string | null;
              heroCtaUrl: string | null;
              heroCtaText: string | null;
              subcategoryComponents: Array<{ key: string; label: string; priority: number }>;
            }
          >(
            (Array.isArray(subcats) ? subcats : []).map((s: any) => {
              const serviceName = String(s?.subcategory || "Service");
              const industryId = s?.category_id ? String(s.category_id) : null;
              const serviceSummary = typeof (s as any)?.service_summary === "string" ? String((s as any).service_summary).trim() || null : null;
              const heroCtaUrl = coerceHeroCtaUrl((s as any)?.hero_cta_url);
              const heroCtaText = coerceHeroCtaText((s as any)?.hero_cta_text);
              const subcategoryComponents = coerceSubcategoryComponents((s as any)?.subcategory_components);
              const cat = (s as any)?.categories;
              const industryName =
                cat && typeof cat === "object" && typeof (cat as any).name === "string"
                  ? String((cat as any).name)
                  : null;
              return [String(s.id), { serviceName, industryId, industryName, serviceSummary, heroCtaUrl, heroCtaText, subcategoryComponents }];
            })
          );
          serviceOptions = ids
            .map((id) => {
              const meta = metaById.get(id) || {
                serviceName: "Service",
                industryId: null,
                industryName: null,
                serviceSummary: null,
                heroCtaUrl: null as string | null,
                heroCtaText: null as string | null,
                subcategoryComponents: [],
              };
              const rawLabel = meta.serviceName || "Service";
              const cleanedLabel =
                rawLabel.replace(/\s*\(service\)\s*$/i, "").trim() || rawLabel;
              return {
                value: id,
                label: cleanedLabel,
                serviceName: cleanedLabel,
                industryId: meta.industryId,
                industryName: meta.industryName,
                serviceSummary: meta.serviceSummary,
                ...(meta.heroCtaUrl != null ? { heroCtaUrl: meta.heroCtaUrl } : {}),
                ...(meta.heroCtaText != null ? { heroCtaText: meta.heroCtaText } : {}),
                ...(meta.subcategoryComponents.length > 0 ? { subcategoryComponents: meta.subcategoryComponents } : {}),
              };
            })
            .slice(0, 40);
        }
      }
    } catch (e) {
      logger.warn("[widget] Failed to resolve serviceOptions", {
        instanceId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Fallbacks:
    // - If `instance_subcategories` isn't configured for this instance, use `config.aiFormConfig.services` when present.
    // - If the embed passes `?serviceId=...`, include that service so the form doesn't show a raw UUID text input.
    if (serviceOptions.length === 0) {
      const configServicesRaw = (instance as any)?.config?.aiFormConfig?.services;
      const configServices = Array.isArray(configServicesRaw)
        ? configServicesRaw.map((s: any) => (typeof s === "string" ? s.trim() : "")).filter(Boolean)
        : [];
      const candidateIds = (configServices.length > 0 ? configServices : hintedServiceId ? [hintedServiceId] : []).slice(
        0,
        40,
      );

      if (candidateIds.length > 0) {
        try {
          const { data: subcats, error: subcatsError } = await supabase
            .from("categories_subcategories")
            .select(
              "id, subcategory, category_id, service_summary, subcategory_components, hero_cta_url, hero_cta_text, categories(name)",
            )
            .in("id", candidateIds)
            .limit(60);
          if (subcatsError) {
            logger.warn("[widget] Failed to resolve fallback services from categories_subcategories", {
              instanceId,
              error: subcatsError.message,
              code: (subcatsError as any).code,
            });
          }

          const metaById = new Map<
            string,
            {
              label: string;
              industryId: string | null;
              industryName: string | null;
              serviceSummary: string | null;
              heroCtaUrl: string | null;
              heroCtaText: string | null;
              subcategoryComponents: Array<{ key: string; label: string; priority: number }>;
            }
          >(
            (Array.isArray(subcats) ? subcats : []).map((s: any) => {
              const rawLabel = String(s?.subcategory || "Service");
              const cleanedLabel = rawLabel.replace(/\s*\(service\)\s*$/i, "").trim() || rawLabel;
              const industryId = s?.category_id ? String(s.category_id) : null;
              const serviceSummary =
                typeof (s as any)?.service_summary === "string" ? String((s as any).service_summary).trim() || null : null;
              const heroCtaUrl = coerceHeroCtaUrl((s as any)?.hero_cta_url);
              const heroCtaText = coerceHeroCtaText((s as any)?.hero_cta_text);
              const subcategoryComponents = coerceSubcategoryComponents((s as any)?.subcategory_components);
              const cat = (s as any)?.categories;
              const industryName =
                cat && typeof cat === "object" && typeof (cat as any).name === "string"
                  ? String((cat as any).name)
                  : null;
              return [String(s.id), { label: cleanedLabel, industryId, industryName, serviceSummary, heroCtaUrl, heroCtaText, subcategoryComponents }];
            }),
          );

          serviceOptions = candidateIds.map((id) => {
            const meta = metaById.get(id);
            const label = meta?.label || id;
            return {
              value: id,
              label,
              serviceName: label,
              industryId: meta?.industryId ?? null,
              industryName: meta?.industryName ?? null,
              serviceSummary: meta?.serviceSummary ?? null,
              ...(meta?.heroCtaUrl != null ? { heroCtaUrl: meta.heroCtaUrl } : {}),
              ...(meta?.heroCtaText != null ? { heroCtaText: meta.heroCtaText } : {}),
              ...(meta?.subcategoryComponents?.length ? { subcategoryComponents: meta.subcategoryComponents } : {}),
            };
          });
        } catch (e) {
          logger.warn("[widget] Failed to build fallback serviceOptions", {
            instanceId,
            error: e instanceof Error ? e.message : String(e),
          });
          serviceOptions = candidateIds.map((id) => ({ value: id, label: id, serviceName: id }));
        }
      }
    }

    if (serviceOptions.length > 0) {
      try {
        const subcategoryIds = serviceOptions.map((opt) => String(opt.value || "").trim()).filter(Boolean);
        const accountId = typeof (instance as any)?.account_id === "string" ? String((instance as any).account_id).trim() : "";
        const selectCols = "subcategory_id, image_url, metadata, created_at, account_id";
        const [accountImages, globalImages] = await Promise.all([
          accountId
            ? supabase
                .from("images")
                .select(selectCols)
                .in("subcategory_id", subcategoryIds)
                .eq("account_id", accountId)
                .eq("status", "completed")
                .order("created_at", { ascending: false })
                .limit(500)
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from("images")
            .select(selectCols)
            .in("subcategory_id", subcategoryIds)
            .is("account_id", null)
            .eq("status", "completed")
            .order("created_at", { ascending: false })
            .limit(500),
        ]);

        const rowsBySubcategory = new Map<string, any[]>();
        for (const row of [
          ...(Array.isArray(accountImages.data) ? accountImages.data : []),
          ...(Array.isArray(globalImages.data) ? globalImages.data : []),
        ]) {
          const subcategoryId = typeof row?.subcategory_id === "string" ? row.subcategory_id : "";
          if (!subcategoryId) continue;
          const bucket = rowsBySubcategory.get(subcategoryId) || [];
          bucket.push(row);
          rowsBySubcategory.set(subcategoryId, bucket);
        }

        serviceOptions = serviceOptions.map((opt) => {
          const subcategoryId = String(opt.value || "").trim();
          const catalog = buildCatalogStyleOptions(rowsBySubcategory.get(subcategoryId) || []);
          return catalog.options.length > 0
            ? {
                ...opt,
                styleQuestion: catalog.question,
                styleOptions: catalog.options,
              }
            : opt;
        });
      } catch (e) {
        logger.warn("[widget] Failed to resolve styleOptions", {
          instanceId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const responseData = {
      success: true,
      instance: instance,
      serviceOptions,
      images: [],
      totalImages: 0,
      fetchedAt: responseTimestamp,
      requestTimestamp: timestamp
    };
    
    const response = NextResponse.json(responseData);

    // Comprehensive cache control to prevent any caching
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('Surrogate-Control', 'no-store');
    response.headers.set('Last-Modified', new Date().toUTCString());
    response.headers.set('ETag', `"${Date.now()}"`);
    response.headers.set("X-Request-Id", requestId);

    if (debugEnabled) {
      logger.info("[instance] RESPONSE", {
        requestId,
        instanceId,
        status: 200,
        durationMs: Date.now() - startedAtMs,
        hasServiceOptions: Array.isArray(serviceOptions) && serviceOptions.length > 0,
        serviceOptions: (serviceOptions || []).slice(0, 20).map((opt: any) => ({
          serviceId: String(opt?.value || ""),
          label: typeof opt?.label === "string" ? opt.label : null,
          componentCount: Array.isArray(opt?.subcategoryComponents) ? opt.subcategoryComponents.length : 0,
          componentKeys: Array.isArray(opt?.subcategoryComponents)
            ? opt.subcategoryComponents.map((component: any) => String(component?.key || "")).filter(Boolean)
            : [],
        })),
      });
    }

    return response;

  } catch (error) {
    logger.error("[instance] ERROR", {
      requestId,
      instanceId: params.instanceId,
      durationMs: Date.now() - startedAtMs,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({
      error: 'Internal server error',
      instanceId: params.instanceId,
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500, headers: { "X-Request-Id": requestId } });
  }
} 
