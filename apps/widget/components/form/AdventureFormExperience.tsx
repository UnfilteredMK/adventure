// AI Form Page Renderer - Entry point that loads config and wraps the engine
'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { StepEngine } from './steps/runtime/StepEngine';
import { FormThemeProvider } from './demo/FormThemeProvider';
import type { FlowPlan, AIFormConfig, StepState } from '@/types/ai-form';
import { DesignSettings, defaultDesignSettings } from '@/types/design';
import { useDemoTheme } from '@/components/widget/demo/DemoThemeContext';
import { applyThemeToConfig, getPresetByKey, themeForSlugOrName } from '@/lib/demo-themes';
import { clearStepState, loadStepState, saveStepState } from '@/lib/ai-form/state/step-state';
import { loadServiceCatalog, saveServiceCatalog } from '@/lib/ai-form/state/service-catalog-storage';
import { upsertFormStateContext } from '@/lib/ai-form/state/form-state-context';
import { emitTelemetry } from '@/lib/ai-form/telemetry';
import { isDevModeEnabled } from "@/lib/ai-form/dev-mode";
import { getOrCreateSessionId, hasSessionStarted, markSessionStarted, clearSession, peekCachedSession } from '@/lib/ai-form/session-manager';
import { withWidgetDesignDefaults } from "@/lib/widget-design-defaults";
import { extractAIFormConfig } from "@/lib/ai-form/config/extract-ai-form-config";
import { ExperienceStateProvider } from "./state/ExperienceState";
import { PreviewSuggestionsProvider } from "./state/PreviewSuggestionsContext";
import { BrandHeader } from "@/components/widget/BrandHeader";
import {
  buildLocalSkeletonFlow,
  LOCAL_SKELETON_FLOW_MODE,
  LOCAL_SKELETON_VERSION,
} from "./steps/runtime/step-engine/utils/build-local-skeleton";

interface AIFormPageRendererProps {
  instanceId: string;
  demoType?: "prospect" | "industry";
  demoSlug?: string;
  initialInstanceData?: any;
  initialDesignConfig?: DesignSettings;
  /** Adventure-only toggle: hide deprecated pre-image budget/upload steps. */
  disableLegacyBudgetUploadSteps?: boolean;
  /**
   * Which design source to use for base theming.
   * - widget: instance.config (used by /adventure)
   * Note: instances no longer carry `flow_config`; "flow" is kept for back-compat and treated as "widget".
   */
  designSource?: "flow" | "widget";
}

type DspyMeta = {
  copyPackId?: string;
  copyPackVersion?: string;
  lintFailed?: boolean;
  lintViolationCodes?: string[];
};

type BootstrapServiceOption = {
  value: string;
  label: string;
  serviceName?: string | null;
  industryId?: string | null;
  industryName?: string | null;
  serviceSummary?: string | null;
  heroCtaUrl?: string | null;
  heroCtaText?: string | null;
  subcategoryComponents?: Array<{ key: string; label: string; priority: number }>;
  subcategoryScope?: string[];
  styleQuestion?: string | null;
  styleOptions?: Array<{
    label: string;
    value: string;
    imageUrl: string;
    description?: string | null;
    priceTier?: string | null;
  }>;
};

function readHintedServiceId(params: URLSearchParams): string | null {
  const raw = params.get("serviceId") || params.get("service_id") || params.get("service") || null;
  const value = typeof raw === "string" ? raw.trim() : "";
  return value || null;
}

function inferBootstrapServiceOptions({
  instance,
  sessionId,
  hintedServiceId,
}: {
  instance: any;
  sessionId: string;
  hintedServiceId: string | null;
}): BootstrapServiceOption[] {
  const cachedCatalog = loadServiceCatalog(sessionId);
  const cachedByServiceId =
    cachedCatalog?.byServiceId && typeof cachedCatalog.byServiceId === "object" ? cachedCatalog.byServiceId : null;

  if (cachedByServiceId) {
    const cachedOptions = Object.entries(cachedByServiceId)
      .map(([serviceId, meta]: [string, any]) => {
        const trimmedId = String(serviceId || "").trim();
        if (!trimmedId) return null;
        const label =
          typeof meta?.serviceName === "string" && meta.serviceName.trim()
            ? meta.serviceName.trim()
            : trimmedId;
        return {
          value: trimmedId,
          label,
          serviceName: label,
          industryId: typeof meta?.industryId === "string" ? meta.industryId : null,
          industryName: typeof meta?.industryName === "string" ? meta.industryName : null,
          serviceSummary: typeof meta?.serviceSummary === "string" ? meta.serviceSummary : null,
          ...(typeof meta?.heroCtaUrl === "string" && meta.heroCtaUrl.trim() ? { heroCtaUrl: meta.heroCtaUrl.trim() } : {}),
          ...(typeof meta?.heroCtaText === "string" && meta.heroCtaText.trim() ? { heroCtaText: meta.heroCtaText.trim() } : {}),
          subcategoryComponents: Array.isArray(meta?.subcategoryComponents) ? meta.subcategoryComponents : undefined,
          subcategoryScope: Array.isArray(meta?.subcategoryScope) ? meta.subcategoryScope : undefined,
          styleQuestion: typeof meta?.styleQuestion === "string" ? meta.styleQuestion : null,
          styleOptions: Array.isArray(meta?.styleOptions) ? meta.styleOptions : undefined,
        } satisfies BootstrapServiceOption;
      })
      .filter(Boolean) as BootstrapServiceOption[];

    if (cachedOptions.length > 0) {
      if (!hintedServiceId) return cachedOptions;
      const hinted = cachedOptions.find((option) => String(option.value || "").trim() === hintedServiceId);
      return hinted ? [hinted] : cachedOptions;
    }
  }

  if (hintedServiceId) {
    const serviceSummary =
      typeof instance?.company_summary === "string"
        ? String(instance.company_summary).trim() || null
        : typeof instance?.service_summary === "string"
          ? String(instance.service_summary).trim() || null
          : null;
    return [
      {
        value: hintedServiceId,
        label: hintedServiceId,
        serviceName: hintedServiceId,
        serviceSummary,
      },
    ];
  }

  const configServicesRaw = instance?.config?.aiFormConfig?.services;
  const configServices = Array.isArray(configServicesRaw)
    ? configServicesRaw.map((entry: any) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];
  if (configServices.length === 1) {
    const onlyServiceId = configServices[0];
    const serviceSummary =
      typeof instance?.company_summary === "string"
        ? String(instance.company_summary).trim() || null
        : typeof instance?.service_summary === "string"
          ? String(instance.service_summary).trim() || null
          : null;
    return [
      {
        value: onlyServiceId,
        label: onlyServiceId,
        serviceName: onlyServiceId,
        serviceSummary,
      },
    ];
  }

  return [];
}

function coerceSubcategoryScopeStringsFromRow(row: any): string[] | undefined {
  const raw = row?.subcategory_scope;
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const s = typeof x === "string" ? x.trim() : "";
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.slice(0, 200));
    if (out.length >= 16) break;
  }
  return out.length > 0 ? out : undefined;
}

function coerceSubcategoryComponentsFromRow(row: any): Array<{ key: string; label: string; priority: number }> | undefined {
  const raw = row?.subcategory_components;
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: Array<{ key: string; label: string; priority: number }> = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const key = typeof (entry as any).key === "string" ? (entry as any).key.trim() : "";
    if (!key) continue;
    const dk = key.toLowerCase();
    if (seen.has(dk)) continue;
    seen.add(dk);
    const label =
      typeof (entry as any).label === "string" && (entry as any).label.trim()
        ? (entry as any).label.trim()
        : key;
    const pr = Number((entry as any).priority);
    out.push({
      key,
      label,
      priority: Number.isFinite(pr) ? pr : index + 1,
    });
  }
  return out.length > 0 ? out : undefined;
}

function normalizeUseCase(raw?: any): "tryon" | "scene-placement" | "scene" | undefined {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
  if (!v) return undefined;
  if (v === "tryon" || v === "try-on") return "tryon";
  if (v === "scene-placement") return "scene-placement";
  if (v === "scene") return "scene";
  return undefined;
}

/** One pass, sequential decode — runs after first paint via idle/timeout so it does not block the first step. */
function prefetchImageUrlsSequential(urls: string[]) {
  const seen = new Set<string>();
  const list = urls.filter((u) => {
    const s = typeof u === "string" ? u.trim() : "";
    if (!s || seen.has(s)) return false;
    seen.add(s);
    return true;
  });
  let i = 0;
  const next = () => {
    if (i >= list.length) return;
    const url = list[i++];
    const img = new Image();
    const step = () => {
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(() => next(), { timeout: 2000 });
      } else {
        setTimeout(next, 0);
      }
    };
    img.onload = step;
    img.onerror = step;
    img.src = url;
  };
  const kickoff = () => next();
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(kickoff, { timeout: 400 });
  } else {
    setTimeout(kickoff, 0);
  }
}

function imageUrlFromOptionish(o: any): string {
  if (!o || typeof o !== "object") return "";
  if (typeof o.imageUrl === "string" && o.imageUrl.trim()) return o.imageUrl.trim();
  if (typeof o.image_url === "string" && o.image_url.trim()) return o.image_url.trim();
  if (typeof o.image === "string" && o.image.trim()) return o.image.trim();
  return "";
}

function collectImageUrlsFromSkeletonSteps(steps: any[] | undefined): string[] {
  const out: string[] = [];
  for (const step of steps || []) {
    const t = String((step as any)?.type || "").toLowerCase();
    if (t !== "image_choice_grid") continue;
    const raw = (step as any)?.options;
    if (!Array.isArray(raw)) continue;
    for (const o of raw) {
      const u = imageUrlFromOptionish(o);
      if (u) out.push(u);
    }
  }
  return out;
}

function collectStyleImageUrlsFromServiceCatalog(sessionId: string): string[] {
  const cat = loadServiceCatalog(sessionId);
  const by = cat?.byServiceId && typeof cat.byServiceId === "object" ? cat.byServiceId : null;
  if (!by) return [];
  const out: string[] = [];
  for (const meta of Object.values(by) as any[]) {
    if (!Array.isArray(meta?.styleOptions)) continue;
    for (const o of meta.styleOptions) {
      const u = imageUrlFromOptionish(o);
      if (u) out.push(u);
    }
  }
  return out;
}

function syncAdventureSession(args: {
  instanceId: string;
  sessionScopeKey: string;
  isDemoRoute: boolean;
  freshResetHandledRef: React.MutableRefObject<boolean>;
  sessionIdRef: React.MutableRefObject<string | null>;
  playgroundModeRef: React.MutableRefObject<boolean>;
}): { sessionId: string; hintedServiceId: string | null; queryThemeKey: string | null; isPlayground: boolean } {
  const { instanceId, sessionScopeKey, isDemoRoute, freshResetHandledRef, sessionIdRef, playgroundModeRef } = args;
  const params = new URLSearchParams(window.location.search);
  const isFresh = params.get("fresh") === "1" || params.get("fresh") === "true";
  const isPlayground =
    isDemoRoute ||
    params.get("demo") === "1" ||
    params.get("playground") === "1";
  playgroundModeRef.current = isPlayground;
  const queryThemeKeyRaw = isPlayground ? params.get("theme") || params.get("themeKey") : null;
  const queryThemeKey = queryThemeKeyRaw ? String(queryThemeKeyRaw).trim().toLowerCase() : null;

  const shouldHandleFreshParam = isFresh && !freshResetHandledRef.current;
  let shouldForceFresh = shouldHandleFreshParam;

  if (!shouldForceFresh && !sessionIdRef.current) {
    try {
      const cached = peekCachedSession(sessionScopeKey);
      const saved = loadStepState(instanceId);
      if (cached && cached.valid && !saved) {
        shouldForceFresh = true;
        if (isDevModeEnabled()) {
          console.log("[AIFormPageRenderer] Forcing fresh session (cached session exists but step state missing)", {
            instanceId,
            sessionScopeKey,
            cachedSessionId: cached.sessionId,
            cachedAgeMs: cached.ageMs,
          });
        }
      }
    } catch {}
  }

  if (shouldForceFresh) {
    clearStepState(instanceId);
    clearSession(sessionScopeKey);
    sessionIdRef.current = null;
    if (shouldHandleFreshParam) freshResetHandledRef.current = true;
  }

  const sessionId = sessionIdRef.current ?? getOrCreateSessionId(sessionScopeKey, shouldForceFresh);
  sessionIdRef.current = sessionId;

  if (!hasSessionStarted(sessionScopeKey, sessionId)) {
    emitTelemetry({
      sessionId,
      instanceId,
      eventType: "session_started",
      timestamp: Date.now(),
      payload: {
        entry_source: typeof document !== "undefined" ? (document.referrer || null) : null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      },
    });
    markSessionStarted(sessionScopeKey, sessionId);
  }

  const hintedServiceId = readHintedServiceId(params);
  return { sessionId, hintedServiceId, queryThemeKey, isPlayground };
}

export function AdventureFormExperience({
  instanceId,
  demoType,
  demoSlug,
  initialInstanceData,
  initialDesignConfig,
  designSource = "widget",
  disableLegacyBudgetUploadSteps = false,
}: AIFormPageRendererProps) {
  // `flow` is kept only for back-compat; it is treated as `widget`.
  const useWidgetDefaults = designSource === "widget" || designSource === "flow";
  const [designConfig, setDesignConfig] = useState<DesignSettings | null>(() => {
    const init = initialDesignConfig || null;
    return useWidgetDefaults && init ? (withWidgetDesignDefaults(init as any, initialInstanceData?.name) as any) : init;
  });
  const [instanceData, setInstanceData] = useState<any>(initialInstanceData || null);
  const instanceDataRef = useRef<any>(initialInstanceData || null);
  useEffect(() => {
    instanceDataRef.current = instanceData;
  }, [instanceData]);
  const [rawDesignConfig, setRawDesignConfig] = useState<DesignSettings | null>(null);
  const [flowPlan, setFlowPlan] = useState<FlowPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formConfig, setFormConfig] = useState<AIFormConfig | null>(null);
  const [dspyMeta, setDspyMeta] = useState<DspyMeta | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null); // Abort previous requests
  const metaSignatureRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const freshResetHandledRef = useRef(false);
  // Demo-only: injected playground theme layer that should win over boot-time design.
  const injectedDesignRef = useRef<Partial<DesignSettings> | null>(null);
  // Base design as computed by boot (instance config + demo theme). Used to re-merge injected overrides.
  const baseDesignRef = useRef<DesignSettings | null>(
    useWidgetDefaults && initialDesignConfig ? (withWidgetDesignDefaults(initialDesignConfig as any, initialInstanceData?.name) as any) : initialDesignConfig || null
  );
  const { themeKey, setThemeKey } = useDemoTheme();
  const isDemoRoute = Boolean(demoType && demoSlug);
  const baseSessionScopeKey = isDemoRoute ? `${instanceId}::demo::${demoType}::${demoSlug}` : instanceId;
  const sessionScopeKey = `${baseSessionScopeKey}::${LOCAL_SKELETON_VERSION}`;
  const playgroundModeRef = useRef(false);
  /** Bumps when skeleton steps gain options (e.g. widget fills style images) so we prefetch again once. */
  const staticPrefetchSignatureRef = useRef<string | null>(null);

  const recordMeta = useCallback((payload: any) => {
    if (!payload || typeof payload !== "object") return;
    const source = payload.meta && typeof payload.meta === "object" ? payload.meta : payload;
    const next: DspyMeta = {
      copyPackId: source.copyPackId ?? source.copy_pack_id,
      copyPackVersion: source.copyPackVersion ?? source.copy_pack_version,
      lintFailed: typeof source.lintFailed === "boolean" ? source.lintFailed : source.lint_failed,
      lintViolationCodes: Array.isArray(source.lintViolationCodes)
        ? source.lintViolationCodes
        : Array.isArray(source.lint_violation_codes)
        ? source.lint_violation_codes
        : undefined,
    };
    const hasAny = Object.values(next).some((v) => v !== undefined);
    if (!hasAny) return;
    setDspyMeta((prev) => ({ ...(prev || {}), ...next }));

    const signature = JSON.stringify(next);
    if (metaSignatureRef.current === signature) return;
    metaSignatureRef.current = signature;
    if (typeof window !== "undefined") {
      const analytics = (window as any).analytics;
      if (analytics && typeof analytics.track === "function") {
        analytics.track("ai_form_dspy_meta", next);
      }
    }
    console.info("[AIForm] DSPy meta", next);
  }, []);

  // Iframe handshake (designer ↔ form): ready + live config updates
  useEffect(() => {
    if (typeof window === "undefined") return;
    const inIframe = Boolean(window.parent && window.parent !== window);
    if (!inIframe) return;

    try {
      const sp = new URLSearchParams(window.location.search);
      playgroundModeRef.current =
        isDemoRoute ||
        sp.get("demo") === "1" ||
        sp.get("playground") === "1";
    } catch {}

    const allowedOrigins = (process.env.NEXT_PUBLIC_IFRAME_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(e.origin)) return;
      const { data } = e as any;
      if (!data || typeof data !== "object") return;

      const isPlainObject = (value: unknown): value is Record<string, any> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value);

      const isPlaygroundThemeMsg =
        data.type === "SIF_PLAYGROUND_THEME" && data.v === 1 && data.design && typeof data.design === "object";
      const isLegacyUpdate =
        data.type === "UPDATE_CONFIG" ||
        data.type === "UPDATE_FLOW_CONFIG";
      if (!isPlaygroundThemeMsg && !isLegacyUpdate) return;

      const isUpdateConfig = data.type === "UPDATE_CONFIG";
      const isUpdateFlowConfig = data.type === "UPDATE_FLOW_CONFIG";

      // UPDATE_CONFIG: config object (design settings + UI toggles)
      // UPDATE_FLOW_CONFIG: legacy message; we ACK and translate layout -> V2 config keys when possible.
      const nextInstanceConfigRaw = isUpdateConfig ? (data.config ?? null) : null;
      const nextFlowRaw =
        isUpdateFlowConfig ? (data.flowConfig ?? data.flow_config ?? data.config ?? null) : null;
      const nextFlowObj = isPlainObject(nextFlowRaw) ? (nextFlowRaw as any) : null;
      const nextFlowLayout = nextFlowObj && isPlainObject(nextFlowObj.layout) ? (nextFlowObj.layout as any) : null;
      const nextFlowConfigPatch: Record<string, any> | null = (() => {
        if (!nextFlowObj) return null;
        const patch: Record<string, any> = {};

        // Direct V2 keys (in case a parent is misusing UPDATE_FLOW_CONFIG to send config).
        if ("form_status_enabled" in nextFlowObj) patch.form_status_enabled = nextFlowObj.form_status_enabled;
        if ("form_show_progress_bar" in nextFlowObj) patch.form_show_progress_bar = nextFlowObj.form_show_progress_bar;
        if ("form_show_step_descriptions" in nextFlowObj)
          patch.form_show_step_descriptions = nextFlowObj.form_show_step_descriptions;

        // Legacy flow_config fields -> V2 config.form_* fields.
        if ("name" in nextFlowObj) patch.form_name = nextFlowObj.name;
        if ("description" in nextFlowObj) patch.form_description = nextFlowObj.description;
        if ("steps" in nextFlowObj) patch.form_steps = nextFlowObj.steps;
        if ("questionGenerationMode" in nextFlowObj)
          patch.form_question_generation_mode = nextFlowObj.questionGenerationMode;
        if ("designGenerationStrategy" in nextFlowObj)
          patch.form_design_generation_strategy = nextFlowObj.designGenerationStrategy;
        if ("designGenerationTriggers" in nextFlowObj)
          patch.form_design_generation_triggers = nextFlowObj.designGenerationTriggers;
        if ("dataCollection" in nextFlowObj) patch.form_data_collection = nextFlowObj.dataCollection;
        if ("componentLibrary" in nextFlowObj) patch.form_component_library = nextFlowObj.componentLibrary;

        // Legacy layout flags -> V2 keys.
        if (nextFlowLayout) {
          if ("showProgressBar" in nextFlowLayout) patch.form_show_progress_bar = nextFlowLayout.showProgressBar;
          if ("showStepNumbers" in nextFlowLayout) patch.form_show_step_descriptions = nextFlowLayout.showStepNumbers;
        }

        return Object.keys(patch).length > 0 ? patch : null;
      })();
      const nextDesignRaw =
        isPlaygroundThemeMsg
          ? data.design
          : isUpdateConfig
            ? (data.config ?? data.design)
            : isUpdateFlowConfig && nextFlowObj
              ? (nextFlowObj.design ?? null)
              : null;

      try {
        const replyOrigin = typeof e.origin === "string" && e.origin && e.origin !== "null" ? e.origin : "*";
        const isPlayground = playgroundModeRef.current;
        if (isPlayground) {
          // Apply instance.config updates so runtime UI toggles work live (form_show_* etc).
          if (isPlainObject(nextInstanceConfigRaw)) {
            setInstanceData((prev: any) => (prev && typeof prev === "object" ? { ...(prev as any), config: nextInstanceConfigRaw } : prev));
          } else if (nextFlowConfigPatch) {
            setInstanceData((prev: any) => {
              if (!prev || typeof prev !== "object") return prev;
              const prevCfg = isPlainObject((prev as any).config) ? (prev as any).config : {};
              return { ...(prev as any), config: { ...(prevCfg as any), ...(nextFlowConfigPatch as any) } };
            });
          }

          if (nextDesignRaw && typeof nextDesignRaw === "object" && !Array.isArray(nextDesignRaw)) {
            injectedDesignRef.current = nextDesignRaw as Partial<DesignSettings>;
            const base = baseDesignRef.current || defaultDesignSettings;
            const merged = { ...(base as any), ...((injectedDesignRef.current as any) || {}) } as DesignSettings;
            setDesignConfig(
              useWidgetDefaults
                ? withWidgetDesignDefaults(merged as any, instanceDataRef.current?.name)
                : merged
            );
          }
          if (isPlaygroundThemeMsg) {
            try { window.parent?.postMessage({ type: "SIF_PLAYGROUND_THEME_ACK", v: 1 }, replyOrigin); } catch {}
          } else {
            try { window.parent?.postMessage({ type: "UPDATE_CONFIG_ACK" }, replyOrigin); } catch {}
            if (data.type === "UPDATE_FLOW_CONFIG") {
              try { window.parent?.postMessage({ type: "UPDATE_FLOW_CONFIG_ACK" }, replyOrigin); } catch {}
            }
          }
          return;
        }

        // Apply instance.config updates so runtime UI toggles work live (form_show_* etc).
        if (isPlainObject(nextInstanceConfigRaw)) {
          setInstanceData((prev: any) => {
            if (!prev || typeof prev !== "object") return prev;
            return { ...(prev as any), config: nextInstanceConfigRaw };
          });
        } else if (nextFlowConfigPatch) {
          setInstanceData((prev: any) => {
            if (!prev || typeof prev !== "object") return prev;
            const prevCfg = isPlainObject((prev as any).config) ? (prev as any).config : {};
            return { ...(prev as any), config: { ...(prevCfg as any), ...(nextFlowConfigPatch as any) } };
          });
        }

        // Only update theme when we actually received design settings (UPDATE_CONFIG, legacy flowConfig.design, or playground theme).
        if (nextDesignRaw && typeof nextDesignRaw === "object" && !Array.isArray(nextDesignRaw)) {
          const nextConfig = { ...defaultDesignSettings, ...(nextDesignRaw as any) } as DesignSettings;
          const filledNext = useWidgetDefaults
            ? withWidgetDesignDefaults(nextConfig as any, instanceDataRef.current?.name)
            : nextConfig;
          baseDesignRef.current = filledNext;
          setDesignConfig(filledNext);
        }

        try { window.parent?.postMessage({ type: "UPDATE_CONFIG_ACK" }, replyOrigin); } catch {}
        if (data.type === "UPDATE_FLOW_CONFIG") {
          try { window.parent?.postMessage({ type: "UPDATE_FLOW_CONFIG_ACK" }, replyOrigin); } catch {}
        }
      } catch {}
    };

    try { window.parent?.postMessage({ type: "FORM_READY" }, "*"); } catch {}
    // Back-compat for parents that only listen to widget readiness.
    try { window.parent?.postMessage({ type: "WIDGET_READY", surface: "form" }, "*"); } catch {}

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isDemoRoute, useWidgetDefaults]);

  const commitFlowBootstrap = useCallback(
    (
      instance: any,
      serviceOptionsInput: BootstrapServiceOption[],
      source: "initial" | "widget",
      opts: {
        sessionId: string;
        hintedServiceId: string | null;
        queryThemeKey: string | null;
        isPlayground: boolean;
        signal?: AbortSignal;
      }
    ) => {
      if (opts.signal?.aborted) return;
      const { sessionId, hintedServiceId, queryThemeKey, isPlayground: playgroundActive } = opts;
      const initialUseCase = normalizeUseCase(
        instance?.use_case ?? instance?.useCase ?? instance?.config?.useCase ?? instance?.config?.use_case
      );

      const serviceOptions = Array.isArray(serviceOptionsInput) ? serviceOptionsInput : [];
      setInstanceData(instance);
      try {
        if (serviceOptions.length > 0) {
          saveServiceCatalog(
            sessionId,
            serviceOptions
              .map((o: any) => ({
                serviceId: String(o?.value || ""),
                serviceName: typeof o?.serviceName === "string" ? o.serviceName : typeof o?.label === "string" ? o.label : null,
                industryId: typeof o?.industryId === "string" ? o.industryId : null,
                industryName: typeof o?.industryName === "string" ? o.industryName : null,
                serviceSummary: typeof o?.serviceSummary === "string" ? o.serviceSummary : null,
                ...(typeof o?.heroCtaUrl === "string" && o.heroCtaUrl.trim() ? { heroCtaUrl: o.heroCtaUrl.trim() } : {}),
                ...(typeof o?.heroCtaText === "string" && o.heroCtaText.trim() ? { heroCtaText: o.heroCtaText.trim() } : {}),
                subcategoryComponents: Array.isArray(o?.subcategoryComponents)
                  ? o.subcategoryComponents
                  : Array.isArray(o?.subcategory_components)
                    ? o.subcategory_components
                    : undefined,
                subcategoryScope: Array.isArray(o?.subcategoryScope)
                  ? o.subcategoryScope
                  : Array.isArray(o?.subcategory_scope)
                    ? o.subcategory_scope
                    : undefined,
                styleQuestion: typeof o?.styleQuestion === "string" ? o.styleQuestion : null,
                styleOptions: Array.isArray(o?.styleOptions) ? o.styleOptions : undefined,
              }))
              .filter((x: any) => Boolean(x.serviceId)),
          );
        } else {
          saveServiceCatalog(sessionId, null);
        }
      } catch {}

      try {
        const serviceSummary =
          typeof (instance as any)?.company_summary === "string"
            ? String((instance as any).company_summary).trim()
            : typeof (instance as any)?.service_summary === "string"
              ? String((instance as any).service_summary).trim()
              : null;
        const businessContext =
          typeof (instance as any)?.business_context === "string"
            ? String((instance as any).business_context).trim()
            : typeof (instance as any)?.config?.businessContext === "string"
              ? String((instance as any).config.businessContext).trim()
              : typeof (instance as any)?.config?.aiFormConfig?.businessContext === "string"
                ? String((instance as any).config.aiFormConfig.businessContext).trim()
                : typeof (instance as any)?.name === "string"
                  ? String((instance as any).name).trim()
                  : null;
        const patch: any = {};
        if (serviceSummary) patch.serviceSummary = serviceSummary;
        if (businessContext) patch.businessContext = businessContext;
        if (Object.keys(patch).length > 0) upsertFormStateContext(sessionId, patch);
      } catch {}

      let baseDesign: any = defaultDesignSettings;
      baseDesign =
        (instance?.config as any) ||
        instance?.designSettings ||
        instance?.designConfig ||
        instance?.design_settings ||
        instance?.config?.designSettings ||
        instance?.config?.design ||
        instance?.design ||
        defaultDesignSettings;

      let normalizedBaseDesign: DesignSettings = {
        ...defaultDesignSettings,
        ...(baseDesign as any),
      } as any;
      if (useWidgetDefaults) {
        normalizedBaseDesign = withWidgetDesignDefaults(normalizedBaseDesign as any, (instance as any)?.name);
      }

      setRawDesignConfig(normalizedBaseDesign);

      let nextDesign: DesignSettings = normalizedBaseDesign;
      if (isDemoRoute) {
        const demoCfg: any =
          (instance as any)?.active_demo?.subcategory?.demo_template_config ||
          (instance as any)?.active_demo?.prospect?.demo_template_config ||
          null;
        const storedThemeKey =
          demoCfg && typeof demoCfg.theme_key === "string" && demoCfg.theme_key.trim()
            ? String(demoCfg.theme_key).toLowerCase()
            : typeof (instance as any)?.active_demo?.prospect?.demo_theme_key === "string" &&
                (instance as any).active_demo.prospect.demo_theme_key.trim()
              ? String((instance as any).active_demo.prospect.demo_theme_key).toLowerCase()
              : null;

        if (storedThemeKey && !themeKey) {
          setThemeKey(storedThemeKey);
        }

        const effectiveKey = themeKey || storedThemeKey;
        if (effectiveKey) {
          const preset = getPresetByKey(effectiveKey);
          const safePreset: any = { ...(preset as any) };
          delete safePreset.logo_url;
          delete safePreset.brand_name;
          delete safePreset.title_text;
          nextDesign = { ...(normalizedBaseDesign as any), ...(safePreset as any) } as any;
        } else {
          const inferred = themeForSlugOrName(
            (instance as any)?.active_demo?.subcategory?.subcategory ||
              (instance as any)?.active_demo?.prospect?.company_name ||
              demoSlug ||
              ""
          );
          nextDesign = applyThemeToConfig(inferred as any, normalizedBaseDesign as any) as any;
        }
        (nextDesign as any).demo_enabled = true;
      }

      if (queryThemeKey) {
        if (!themeKey) setThemeKey(queryThemeKey);
        const preset = getPresetByKey(queryThemeKey);
        const safePreset: any = { ...(preset as any) };
        delete safePreset.logo_url;
        delete safePreset.brand_name;
        delete safePreset.title_text;
        nextDesign = { ...(normalizedBaseDesign as any), ...(safePreset as any) } as any;
        (nextDesign as any).demo_enabled = true;
      }

      baseDesignRef.current = nextDesign;
      const injected = injectedDesignRef.current;
      const mergedNext =
        playgroundActive && injected ? ({ ...(nextDesign as any), ...(injected as any) } as DesignSettings) : nextDesign;
      setDesignConfig(useWidgetDefaults ? withWidgetDesignDefaults(mergedNext as any, (instance as any)?.name) : mergedNext);

      const extractedFormConfig = extractAIFormConfig((instance as any)?.config);
      setFormConfig(extractedFormConfig);

      const hasSingleCatalogService = serviceOptions.length === 1;

      const serviceParam = hintedServiceId || "";
      const serviceParamLower = serviceParam.toLowerCase();
      const selectedFromParam =
        serviceParam && serviceOptions.length > 0
          ? serviceOptions.find((o: any) => {
              const value = String(o?.value || "").trim();
              const label = String(o?.label || o?.serviceName || "").trim().toLowerCase();
              return value === serviceParam || (label && label === serviceParamLower);
            })
          : null;
      const singleCatalogServiceValue =
        hasSingleCatalogService && serviceOptions[0]?.value ? String(serviceOptions[0].value) : null;
      const prefillService =
        selectedFromParam && selectedFromParam.value
          ? String(selectedFromParam.value)
          : singleCatalogServiceValue || serviceParam || null;
      const steps = buildLocalSkeletonFlow({
        serviceOptions,
        selectedServiceId: prefillService,
        useCase: (extractedFormConfig as any)?.useCase,
        previewPricing: extractedFormConfig?.previewPricing,
      });

      try {
        if (prefillService) {
          const existing = loadStepState(instanceId);
          const hasExistingForSession = Boolean(existing && existing.sessionId === sessionId);
          const alreadyAnswered =
            hasExistingForSession &&
            (existing as any)?.stepData &&
            (existing as any).stepData["step-service-primary"] !== undefined;
          if (!alreadyAnswered) {
            if (serviceOptions.length === 0) {
              saveServiceCatalog(sessionId, [
                {
                  serviceId: prefillService,
                  serviceName: prefillService,
                  industryId: null,
                  industryName: null,
                },
              ]);
            }
            const seeded: StepState = {
              currentStepIndex: 0,
              steps,
              completedSteps: new Set<string>(),
              stepData: {
                "step-service-primary": prefillService,
                service_primary: prefillService,
              },
              sessionId,
              skeletonVersion: LOCAL_SKELETON_VERSION,
            };
            saveStepState(instanceId, seeded);
          }
        }
      } catch {}

      setFlowPlan({
        sessionId,
        maxSteps: (steps?.length || 0) + 20,
        steps,
        mode: LOCAL_SKELETON_FLOW_MODE,
        skeletonVersion: LOCAL_SKELETON_VERSION,
      } as FlowPlan);

      console.log("[AIFormPageRenderer] Bootstrap complete", {
        source,
        sessionId,
        initialUseCase,
        deterministicSteps: steps.map((s: any) => s?.id),
        serviceOptionsCount: serviceOptions.length,
      });
    },
    [demoSlug, instanceId, isDemoRoute, setThemeKey, themeKey, useWidgetDefaults]
  );

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (flowPlan !== null) return;
    try {
      const session = syncAdventureSession({
        instanceId,
        sessionScopeKey,
        isDemoRoute,
        freshResetHandledRef,
        sessionIdRef,
        playgroundModeRef,
      });
      const earlyServiceOptions = inferBootstrapServiceOptions({
        instance: initialInstanceData ?? {},
        sessionId: session.sessionId,
        hintedServiceId: session.hintedServiceId,
      });
      if (earlyServiceOptions.length === 0) return;
      commitFlowBootstrap(initialInstanceData ?? {}, earlyServiceOptions, "initial", {
        sessionId: session.sessionId,
        hintedServiceId: session.hintedServiceId,
        queryThemeKey: session.queryThemeKey,
        isPlayground: session.isPlayground,
      });
    } catch (e) {
      console.warn("[AIFormPageRenderer] Early bootstrap failed", e);
    }
  }, [commitFlowBootstrap, flowPlan, initialInstanceData, instanceId, isDemoRoute, sessionScopeKey]);

  useEffect(() => {
    if (!flowPlan?.sessionId || flowPlan.mode !== LOCAL_SKELETON_FLOW_MODE) return;
    const optionTally = (flowPlan.steps || []).reduce(
      (n: number, s: any) => n + (Array.isArray(s?.options) ? s.options.length : 0),
      0
    );
    const sig = `${flowPlan.sessionId}:${optionTally}`;
    if (staticPrefetchSignatureRef.current === sig) return;
    staticPrefetchSignatureRef.current = sig;
    const fromSteps = collectImageUrlsFromSkeletonSteps(flowPlan.steps as any[]);
    const fromCatalog = collectStyleImageUrlsFromServiceCatalog(flowPlan.sessionId);
    prefetchImageUrlsSequential([...fromSteps, ...fromCatalog]);
  }, [flowPlan]);

  useEffect(() => {
    // Don't reset sessionStartedRef - it should persist across re-renders
    async function loadConfig() {
      // Abort any previous request
      if (abortControllerRef.current) {
        console.log('[AIFormPageRenderer] Aborting previous request');
        abortControllerRef.current.abort();
      }
      
      // Create new AbortController for this request
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      
      console.log('[AIFormPageRenderer] Starting load');
      
      try {
        setError(null);

        const session = syncAdventureSession({
          instanceId,
          sessionScopeKey,
          isDemoRoute,
          freshResetHandledRef,
          sessionIdRef,
          playgroundModeRef,
        });
        const { sessionId, hintedServiceId, queryThemeKey, isPlayground } = session;

        const instanceUrl =
          isDemoRoute && demoType && demoSlug
            ? `/api/instance/${instanceId}/demo/${demoType}/${encodeURIComponent(demoSlug)}`
            : `/api/widget/${instanceId}`;

        // Pass through `serviceId` hint so the instance bootstrap route can return a deterministic label/value
        // (prevents the form from falling back to a raw UUID text input in demo/autostart flows).
        let instanceUrlWithHint = instanceUrl;
        try {
          if (hintedServiceId) {
            const u = new URL(instanceUrl, window.location.origin);
            u.searchParams.set("serviceId", hintedServiceId);
            instanceUrlWithHint = u.pathname + u.search + u.hash;
          }
        } catch {}

        const widgetRes = await fetch(instanceUrlWithHint, { cache: 'no-store', signal: abortController.signal });
        if (!widgetRes.ok) throw new Error(`Failed to fetch instance: ${widgetRes.status}`);
        const widgetJson = await widgetRes.json();
        const instance = widgetJson?.instance;
        let serviceOptions = Array.isArray(widgetJson?.serviceOptions) ? widgetJson.serviceOptions : [];

        if (isDemoRoute && demoType === "industry") {
          const subcat = (instance as any)?.active_demo?.subcategory;
          const subcatId = subcat?.id ? String(subcat.id) : "";
          const subcatName = subcat?.subcategory ? String(subcat.subcategory) : "";
          if (subcatId && subcatName) {
            const subcategoryScope = coerceSubcategoryScopeStringsFromRow(subcat);
            const subcategoryComponents = coerceSubcategoryComponentsFromRow(subcat);
            serviceOptions = [
              {
                value: subcatId,
                label: subcatName,
                serviceName: subcatName,
                industryId: null,
                industryName: null,
                ...(subcategoryComponents?.length ? { subcategoryComponents } : {}),
                ...(subcategoryScope?.length ? { subcategoryScope } : {}),
              },
            ];
          }
        }

        if (isDemoRoute && serviceOptions.length === 0) {
          try {
            const baseRes = await fetch(`/api/instance/${instanceId}`, { cache: 'no-store', signal: abortController.signal });
            if (baseRes.ok) {
              const baseJson = await baseRes.json();
              const next = Array.isArray(baseJson?.serviceOptions) ? baseJson.serviceOptions : [];
              if (next.length > 0) serviceOptions = next;
            }
          } catch {}
        }

        if (abortController.signal.aborted) return;

        commitFlowBootstrap(instance, serviceOptions as BootstrapServiceOption[], "widget", {
          sessionId,
          hintedServiceId,
          queryThemeKey,
          isPlayground,
          signal: abortController.signal,
        });
        // Legacy initial SSE bootstrap removed: StepEngine is the only `/generate-steps` caller.
        return;
        /*
        void fetch(`/api/instance/${instanceId}`, { cache: 'no-store', signal: abortController.signal })
          .then(async (instanceRes) => {
            if (!instanceRes.ok) throw new Error(`Failed to fetch instance: ${instanceRes.status}`);
            const instanceJson = await instanceRes.json();
            const instance = instanceJson?.instance;
            if (abortController.signal.aborted) return;
            setInstanceData(instance);

            let design = defaultDesignSettings;

            design =
              instance?.designSettings ||
              instance?.designConfig ||
              instance?.design_settings ||
              instance?.config?.designSettings ||
              instance?.config?.design ||
              instance?.design ||
              defaultDesignSettings;

            setDesignConfig(design);

            // Extract form config
            const raw = (instance.config as any)?.aiFormConfig || {};
            const aiFormConfig: AIFormConfig = {
              maxSteps: raw.maxSteps,
              maxImages: raw.maxImages,
              allowedBuyerRefinements: raw.allowedBuyerRefinements,
              requiredInputs: raw.requiredInputs,
              pricingVisibility: raw.pricingVisibility,
              pricingMode: raw.pricingMode,
              quoteBeforeLead: raw.quoteBeforeLead,
              upgradesEnabled: raw.upgradesEnabled,
              minConfidenceForUploads: raw.minConfidenceForUploads,
              minConfidenceForPricing: raw.minConfidenceForPricing,
              maxQualifyQuestions: raw.maxQualifyQuestions,
              minQuestionsBeforeVisual: raw.minQuestionsBeforeVisual,
              allowRefinement: raw.allowRefinement,
              leadCaptureRequired: raw.leadCaptureRequired,
              businessContext: raw.businessContext,
              industry: raw.industry,
              services: raw.services,
            };
            setFormConfig(aiFormConfig);
          })
          .catch((err) => {
            if (abortController.signal.aborted) return;
            console.warn('[AIFormPageRenderer] Instance fetch failed', err);
          });

        // Check if request was aborted
        if (abortController.signal.aborted) {
          console.log('[AIFormPageRenderer] Request aborted before fetch');
          return;
        }
        
        // Fetch initial steps via JSON (generate-steps)
        // This will return deterministic steps (like service selection) if needed, then stop
        // After deterministic steps are completed, StepEngine will call generate-steps again for AI steps
        const planItemsFromStoredPlan = (plan: FormPlan | null) => {
          if (!plan) return null;
          if (Array.isArray(plan)) return plan;
          const items = (plan as any)?.planItems;
          return Array.isArray(items) ? items : null;
        };

        console.log('[AIFormPageRenderer] Fetching generate-steps', { instanceId });
        const saved = loadStepState(instanceId);
        const stepDataSoFar = (saved && typeof saved === "object" && (saved as any).stepData && typeof (saved as any).stepData === "object")
          ? (saved as any).stepData
          : {};
        const stepsForQA: any[] = Array.isArray((saved as any)?.steps) ? (saved as any).steps : [];
        const askedStepIds = stepsForQA.map((s: any) => s?.id).filter(Boolean);
        const answeredQA = stepsForQA
          .map((s: any) => {
            const stepId = s?.id;
            if (!stepId) return null;
            const answer = (stepDataSoFar as any)[stepId];
            if (answer === undefined) return null;
            const q = typeof s?.question === "string"
              ? s.question
              : typeof s?.copy?.headline === "string"
                ? s.copy.headline
                : typeof s?.intent === "string"
                  ? s.intent
                  : stepId;
            return { stepId, question: q, answer };
          })
          .filter(Boolean);
        const resp = await fetch(`/api/ai-form/${instanceId}/generate-steps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          signal: abortController.signal, // Pass abort signal
          body: JSON.stringify({
            sessionId,
            stepDataSoFar,
            askedStepIds,
            answeredQA,
            formState: {
              formId: sessionId,
              batchIndex: 0,
              askedStepIds,
            },
            noCache: isFresh,
            useCase: initialUseCase,
          }),
        });
        if (!resp.ok) {
          if (resp.status === 413) {
            throw new Error("Request too large (413). If you uploaded a photo, try a smaller image.");
          }
          throw new Error(`Failed to load flow: ${resp.status}`);
        }
        if (resp.headers.get('X-Streaming-Disabled') === '1') {
          console.warn('[AIFormPageRenderer] Streaming disabled for generate-steps response (X-Streaming-Disabled: 1)');
        }

        const json = await resp.json().catch(() => ({}));
        const frames: any[] = Array.isArray((json as any)?.frames) ? (json as any).frames : [];
        const directMiniSteps: any[] = Array.isArray((json as any)?.miniSteps) ? (json as any).miniSteps : [];

        const steps: Array<StepDefinition | UIStep> = [];

        if (directMiniSteps.length > 0) {
          steps.push(...directMiniSteps);
        }

        const extractFormPlan = (rawPlan: any): FormPlan | null => {
          if (Array.isArray(rawPlan)) return rawPlan as any;
          if (rawPlan && typeof rawPlan === "object") return rawPlan as any;
          return null;
        };

        let sawComplete = false;
        let batchMeta: { batchId?: string | null; modelRequestId?: string | null } | null = null;
        let batchTrace: { requestPayload?: any; responsePayload?: any } | null = null;
        let sseError: string | null = null;
        for (const obj of frames) {
          if (!obj || typeof obj !== 'object') continue;
            if (directMiniSteps.length === 0 && obj.type === 'step' && obj.step) {
              // Log to verify options are present when received
              if (obj.step.type === 'multiple_choice' || obj.step.type === 'choice') {
                console.log('[AIFormPageRenderer] Step received (FULL OBJECT):', {
                  id: obj.step.id,
                  type: obj.step.type,
                  hasOptions: Array.isArray(obj.step.options),
                  optionsCount: Array.isArray(obj.step.options) ? obj.step.options.length : 0,
                  options: obj.step.options ? obj.step.options.slice(0, 3).map((opt: any) => ({ label: opt.label, value: opt.value })) : 'MISSING',
                  allStepKeys: Object.keys(obj.step), // Show all keys to verify nothing is stripped
                });
              }
              // CRITICAL: Push the FULL step object as-is - no transformation
              steps.push(obj.step);
            } else if (obj.type === 'meta') {
              const requestPayload =
                obj.payloadRequest ??
                obj.requestPayload ??
                obj.payload?.request ??
                obj.request ??
                null;
              const responsePayload =
                obj.payloadResponse ??
                obj.responsePayload ??
                obj.payload?.response ??
                obj.response ??
                null;
              const responseDspy = (responsePayload as any)?.dspyResponse ?? null;
              const extractDeterministicPlacements = (raw: any) => {
                if (raw && typeof raw === "object" && (raw as any).deterministicPlacements) {
                  return (raw as any).deterministicPlacements;
                }
                return null;
              };
              batchTrace = {
                requestPayload,
                responsePayload,
              };
              const maybeFormPlan =
                extractFormPlan((obj as any)?.formPlan) ||
                extractFormPlan((responsePayload as any)?.formPlan) ||
                extractFormPlan((responsePayload as any)?.meta?.formPlan) ||
                extractFormPlan((responsePayload as any)?.upstream?.formPlan) ||
                extractFormPlan((responseDspy as any)?.formPlan) ||
                null;
              if (maybeFormPlan) {
                saveFormPlan(sessionId, maybeFormPlan);
              }

              const maybeUIPlan =
                extractDeterministicPlacements(obj as any) ||
                extractDeterministicPlacements(responsePayload as any) ||
                extractDeterministicPlacements((responsePayload as any)?.meta) ||
                extractDeterministicPlacements((responsePayload as any)?.upstream) ||
                extractDeterministicPlacements(responseDspy as any) ||
                null;
              if (maybeUIPlan) {
                saveUIPlan(sessionId, maybeUIPlan);
              }
              if (isDevModeEnabled()) {
                const requestState = requestPayload && typeof requestPayload === "object" ? (requestPayload as any).state : null;
                const requestFormPlan = extractFormPlan(requestState?.formPlan);
                const requestDeterministicPlacements = extractDeterministicPlacements(requestState);
                const responseFormPlan =
                  extractFormPlan((responsePayload as any)?.formPlan) ||
                  extractFormPlan((responsePayload as any)?.meta?.formPlan) ||
                  extractFormPlan((responsePayload as any)?.upstream?.formPlan) ||
                  extractFormPlan((responseDspy as any)?.formPlan) ||
                  null;
                const responseDeterministicPlacements =
                  extractDeterministicPlacements(responsePayload as any) ||
                  extractDeterministicPlacements((responsePayload as any)?.meta) ||
                  extractDeterministicPlacements((responsePayload as any)?.upstream) ||
                  extractDeterministicPlacements(responseDspy as any) ||
                  null;
                console.log("[AIFormPageRenderer] Plan trace", {
                  request: { formPlan: requestFormPlan, deterministicPlacements: requestDeterministicPlacements },
                  response: { formPlan: responseFormPlan, deterministicPlacements: responseDeterministicPlacements },
                });
              }
              recordMeta(obj);
            } else if (obj.type === 'complete') {
              // Normalize old batch IDs
              const rawBatchId = obj?.batchId ?? null;
              const normalizedBatchId = rawBatchId === "ContextCore" ? "batch-0" 
                : rawBatchId === "PersonalGuide" ? "batch-1"
                : rawBatchId?.startsWith("Batch") ? (() => {
                    const match = rawBatchId.match(/Batch(\d+)/);
                    return match ? `batch-${parseInt(match[1], 10) - 1}` : rawBatchId;
                  })()
                : rawBatchId;
              
              batchMeta = {
                batchId: normalizedBatchId,
                modelRequestId: obj?.modelRequestId ?? null,
              };
              // Only emit batch_completed once per batch (deduplication handled in emitTelemetry)
              if (batchMeta.batchId || batchMeta.modelRequestId) {
                emitTelemetry({
                  sessionId,
                  instanceId,
                  eventType: "batch_completed",
                  batchId: batchMeta.batchId ?? undefined,
                  modelRequestId: batchMeta.modelRequestId ?? undefined,
                  timestamp: Date.now(),
                  payload: {
                    batch_id: batchMeta.batchId ?? null,
                    model_request_id: batchMeta.modelRequestId ?? null,
                    calls_used: obj?.callsUsed ?? null,
                    max_calls: obj?.maxCalls ?? null,
                    total_steps: obj?.totalSteps ?? null,
                    answered_steps: obj?.answeredSteps ?? null,
                    satiety: obj?.satiety ?? null,
                    is_last_batch: obj?.isLastBatch ?? null,
                    request_payload: batchTrace?.requestPayload ?? null,
                    response_payload: batchTrace?.responsePayload ?? null,
                    timestamp: Date.now(),
                  },
                });
              }
              recordMeta(obj);
              sawComplete = true;
            } else if (obj.type === 'error') {
              const details = obj.details ? ` (${String(obj.details).slice(0, 300)})` : '';
              sseError = `${obj.error || 'DSPy service error'}${details}`;
              sawComplete = true;
            }
          if (sawComplete) break;
        }
        if (sseError) {
          setError(sseError);
          return;
        }

        // IMPORTANT: The server (batch generator) is the source of truth for step ordering.
        // Do not insert/reorder steps client-side based on heuristics.
        const annotatedSteps = steps.map((step) => {
          const existingMeta = (step as any).__telemetry;
          if (existingMeta) return step;
          return {
            ...step,
            __telemetry: {
              batchId: batchMeta?.batchId ?? null,
              modelRequestId: batchMeta?.modelRequestId ?? null,
              payloadRequest: batchTrace?.requestPayload ?? null,
              payloadResponse: batchTrace?.responsePayload ?? null,
            },
          };
        });

        // Check if request was aborted before setting state
        if (abortController.signal.aborted) {
          console.log('[AIFormPageRenderer] Request aborted before state update');
          return;
        }
        
        console.log('[AIFormPageRenderer] Load complete', { 
          stepsCount: annotatedSteps.length,
        });
        
        setFlowPlan({
          sessionId,
          maxSteps: (annotatedSteps?.length || 0) + 20,
          steps: annotatedSteps,
        } as FlowPlan);
        */
      } catch (err: any) {
        // Ignore abort errors
        if (err.name === 'AbortError' || abortController.signal.aborted) {
          console.log('[AIFormPageRenderer] Request aborted');
          return;
        }
        // Only set error if request wasn't aborted
        if (!abortController.signal.aborted) {
          setError(err.message);
        }
      }
    }

    loadConfig();
    
    // Cleanup: abort request on unmount or when instanceId changes
    return () => {
      if (abortControllerRef.current) {
        console.log('[AIFormPageRenderer] Cleanup: aborting request');
        abortControllerRef.current.abort();
      }
    };
  }, [commitFlowBootstrap, instanceId, demoType, demoSlug, recordMeta, sessionScopeKey, useWidgetDefaults]);

  // Re-apply theme instantly when themeKey changes (demo route only)
  useEffect(() => {
    if (!isDemoRoute) return;
    if (!rawDesignConfig) return;
    if (!instanceData) return;

    let queryThemeKey: string | null = null;
    try {
      const sp = new URLSearchParams(window.location.search);
      const isPlayground = sp.get("demo") === "1" || sp.get("playground") === "1";
      if (isPlayground) {
        const raw = sp.get("theme") || sp.get("themeKey") || null;
        queryThemeKey = raw ? String(raw).trim().toLowerCase() : null;
      }
    } catch {}

    const demoCfg: any =
      instanceData?.active_demo?.subcategory?.demo_template_config ||
      instanceData?.active_demo?.prospect?.demo_template_config ||
      null;
    const storedThemeKey =
      demoCfg && typeof demoCfg.theme_key === "string" && demoCfg.theme_key.trim()
        ? String(demoCfg.theme_key).toLowerCase()
        : typeof instanceData?.active_demo?.prospect?.demo_theme_key === "string" &&
          instanceData.active_demo.prospect.demo_theme_key.trim()
          ? String(instanceData.active_demo.prospect.demo_theme_key).toLowerCase()
          : null;

    if (storedThemeKey && !themeKey) {
      setThemeKey(storedThemeKey);
    }

    if (queryThemeKey && !themeKey) {
      setThemeKey(queryThemeKey);
    }

    const effectiveKey = queryThemeKey || themeKey || storedThemeKey;
	    let next: DesignSettings = rawDesignConfig;
	    if (effectiveKey) {
	      const preset = getPresetByKey(effectiveKey);
	      const safePreset: any = { ...(preset as any) };
	      delete safePreset.logo_url;
	      delete safePreset.brand_name;
	      delete safePreset.title_text;
	      next = { ...(rawDesignConfig as any), ...(safePreset as any) } as any;
	    } else {
	      const inferred = themeForSlugOrName(
	        instanceData?.active_demo?.subcategory?.subcategory ||
	          instanceData?.active_demo?.prospect?.company_name ||
	          demoSlug ||
          ""
      );
      next = applyThemeToConfig(inferred as any, rawDesignConfig as any) as any;
    }
    (next as any).demo_enabled = true;
    baseDesignRef.current = next;
    const injected = injectedDesignRef.current;
    const merged = injected ? ({ ...(next as any), ...(injected as any) } as DesignSettings) : next;
    setDesignConfig(useWidgetDefaults ? withWidgetDesignDefaults(merged as any, instanceData?.name) : merged);
  }, [themeKey, isDemoRoute, rawDesignConfig, instanceData, demoSlug, setThemeKey, useWidgetDefaults]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6 text-center text-red-500">
        {error}
      </div>
    );
  }

  const instanceUseCase = normalizeUseCase(
    instanceData?.use_case ?? instanceData?.useCase ?? instanceData?.config?.useCase ?? instanceData?.config?.use_case
  );
  const showBrandingHeader =
    useWidgetDefaults &&
    instanceData?.config?.form_status_enabled !== false &&
    instanceData?.config?.form_show_branding_header !== false &&
    instanceData?.config?.form_show_branding !== false;

  const resolvedDesign = (designConfig || defaultDesignSettings) as DesignSettings;

  return (
    <FormThemeProvider config={resolvedDesign}>
      <ExperienceStateProvider>
        <PreviewSuggestionsProvider instanceId={instanceId}>
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
          {dspyMeta?.lintFailed && (
            <div className="fixed bottom-4 right-4 z-50 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 shadow-sm">
              We adjusted wording for clarity
            </div>
          )}
          {useWidgetDefaults ? (
            <BrandHeader config={resolvedDesign} containerWidth={1024} hideInMobile={false} />
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">
            <StepEngine
              instanceId={instanceId}
              sessionScopeKey={sessionScopeKey}
              flowPlan={flowPlan}
              disableLegacyBudgetUploadSteps={disableLegacyBudgetUploadSteps}
              onMeta={recordMeta}
              showBrandingHeader={showBrandingHeader}
              formUI={{
                showProgressBar: instanceData?.config?.form_show_progress_bar,
                showStepDescriptions: instanceData?.config?.form_show_step_descriptions,
              }}
              config={{
                businessContext: instanceData?.businessContext || instanceData?.config?.businessContext,
                industry: instanceData?.industry || instanceData?.config?.industry,
                useCase:
                  instanceUseCase ||
                  instanceData?.use_case ||
                  instanceData?.useCase ||
                  instanceData?.config?.useCase ||
                  instanceData?.config?.use_case,
                previewPricing: formConfig?.previewPricing,
                leadCaptureRequired: formConfig?.leadCaptureRequired,
              }}
            />
          </div>
        </div>
        </PreviewSuggestionsProvider>
      </ExperienceStateProvider>
    </FormThemeProvider>
  );
}

export const AIFormPageRenderer = AdventureFormExperience;
