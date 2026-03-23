// AI Form Page Renderer - Entry point that loads config and wraps the engine
'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StepEngine } from './steps/runtime/StepEngine';
import { FormThemeProvider } from './demo/FormThemeProvider';
import type { FlowPlan, StepDefinition, UIStep, AIFormConfig, StepState } from '@/types/ai-form';
import { DesignSettings, defaultDesignSettings } from '@/types/design';
import { useDemoTheme } from '@/components/widget/demo/DemoThemeContext';
import { applyThemeToConfig, getPresetByKey, themeForSlugOrName } from '@/lib/demo-themes';
import { clearStepState, loadStepState, saveStepState } from '@/lib/ai-form/state/step-state';
import { saveServiceCatalog } from '@/lib/ai-form/state/service-catalog-storage';
import { upsertFormStateContext } from '@/lib/ai-form/state/form-state-context';
import { emitTelemetry } from '@/lib/ai-form/telemetry';
import { isDevModeEnabled } from "@/lib/ai-form/dev-mode";
import { getOrCreateSessionId, hasSessionStarted, markSessionStarted, clearSession, peekCachedSession } from '@/lib/ai-form/session-manager';
import { withWidgetDesignDefaults } from "@/lib/widget-design-defaults";
import { extractAIFormConfig } from "@/lib/ai-form/config/extract-ai-form-config";
import { ExperienceStateProvider } from "./state/ExperienceState";
import { buildDeterministicStyleStep } from "./steps/static/deterministic-style-step";

interface AIFormPageRendererProps {
  instanceId: string;
  demoType?: "prospect" | "industry";
  demoSlug?: string;
  initialInstanceData?: any;
  initialDesignConfig?: DesignSettings;
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

export function AdventureFormExperience({
  instanceId,
  demoType,
  demoSlug,
  initialInstanceData,
  initialDesignConfig,
  designSource = "widget",
}: AIFormPageRendererProps) {
  // `flow` is kept only for back-compat; it is treated as `widget`.
  const useWidgetDefaults = designSource === "widget" || designSource === "flow";
  const [designConfig, setDesignConfig] = useState<DesignSettings | null>(() => {
    const init = initialDesignConfig || null;
    return useWidgetDefaults && init ? (withWidgetDesignDefaults(init as any, initialInstanceData?.name) as any) : init;
  });
  const [instanceData, setInstanceData] = useState<any>(initialInstanceData || null);
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
  const sessionScopeKey = isDemoRoute ? `${instanceId}::demo::${demoType}::${demoSlug}` : instanceId;
  const playgroundModeRef = useRef(false);

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
            setDesignConfig(useWidgetDefaults ? withWidgetDesignDefaults(merged as any, instanceData?.name) : merged);
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
          const filledNext = useWidgetDefaults ? withWidgetDesignDefaults(nextConfig as any, instanceData?.name) : nextConfig;
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
  }, [isDemoRoute, useWidgetDefaults, instanceData]);

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

        const params = new URLSearchParams(window.location.search);
        const isFresh = params.get("fresh") === "1" || params.get("fresh") === "true";
        const isPlayground =
          isDemoRoute ||
          params.get("demo") === "1" ||
          params.get("playground") === "1";
        playgroundModeRef.current = isPlayground;
        const queryThemeKeyRaw = isPlayground ? params.get("theme") || params.get("themeKey") : null;
        const queryThemeKey = queryThemeKeyRaw ? String(queryThemeKeyRaw).trim().toLowerCase() : null;

        // Use module-level session manager to ensure consistency across component remounts
        const shouldHandleFreshParam = isFresh && !freshResetHandledRef.current;
        let shouldForceFresh = shouldHandleFreshParam;

        // If the form "restarts" (step state cleared) but this tab still has a cached session,
        // treat it as a brand-new session so lead gates (pricing pill) start locked again.
        // This happens frequently in /adventure previews where the parent reloads the iframe.
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
          // Clear persisted step state + session so the form truly resets.
          clearStepState(instanceId);
          clearSession(sessionScopeKey);
          sessionIdRef.current = null;
          if (shouldHandleFreshParam) freshResetHandledRef.current = true;
        }

        // Get or create session ID (module-level, persists across remounts)
        const sessionId =
          sessionIdRef.current ?? getOrCreateSessionId(sessionScopeKey, shouldForceFresh);
        sessionIdRef.current = sessionId;

        // Only emit session_started once per session ID (persisted in localStorage)
        if (!hasSessionStarted(sessionScopeKey, sessionId)) {
          emitTelemetry({
            sessionId,
            instanceId,
            eventType: "session_started",
            timestamp: Date.now(),
            payload: {
              entry_source: typeof document !== 'undefined' ? (document.referrer || null) : null,
              user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            },
          });
          markSessionStarted(sessionScopeKey, sessionId);
        }

        // Bootstrap deterministic steps on the client.
        // StepEngine is responsible for AI generation (`/generate-steps` calls).
        const initialUseCase = normalizeUseCase(
          initialInstanceData?.use_case ??
            initialInstanceData?.useCase ??
            initialInstanceData?.config?.useCase ??
            initialInstanceData?.config?.use_case
        );

        const instanceUrl =
          isDemoRoute && demoType && demoSlug
            ? `/api/instance/${instanceId}/demo/${demoType}/${encodeURIComponent(demoSlug)}`
            : `/api/instance/${instanceId}`;

        // Pass through `serviceId` hint so the instance bootstrap route can return a deterministic label/value
        // (prevents the form from falling back to a raw UUID text input in demo/autostart flows).
        let instanceUrlWithHint = instanceUrl;
        try {
          const hintedServiceId =
            params.get("serviceId") || params.get("service_id") || params.get("service") || null;
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
            serviceOptions = [
              {
                value: subcatId,
                label: subcatName,
                serviceName: subcatName,
                industryId: null,
                industryName: null,
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
                  serviceSummary: typeof o?.serviceSummary === "string" ? o.serviceSummary : typeof o?.service_summary === "string" ? o.service_summary : null,
                  subcategoryComponents: Array.isArray(o?.subcategoryComponents)
                    ? o.subcategoryComponents
                    : Array.isArray(o?.subcategory_components)
                      ? o.subcategory_components
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

        // Seed formState with DB-backed service summary so all subsequent API calls can reuse it.
        // (This intentionally lives in formState so callers like image preview can read it later.)
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

        // Extract base design config (consolidated instance.config).
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

        // Playground override for first paint (query param wins in playground mode).
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
          isPlayground && injected ? ({ ...(nextDesign as any), ...(injected as any) } as DesignSettings) : nextDesign;
        setDesignConfig(useWidgetDefaults ? withWidgetDesignDefaults(mergedNext as any, (instance as any)?.name) : mergedNext);

        // Extract consolidated form config (root keys preferred; legacy aiFormConfig fallback)
        setFormConfig(extractAIFormConfig((instance as any)?.config));

        // Deterministic bootstrap steps (frontend-owned).
        // NOTE: We intentionally do NOT show the old yes/no "pricing accuracy consent" gate.
        const steps: Array<StepDefinition | UIStep> = [];

        if (serviceOptions.length > 0) {
          steps.push({
            id: "step-service-primary",
            type: "multiple_choice",
            question:
              "Wait — to help us give you accurate pricing, mind answering a few quick questions?",
            humanism: "What service are you interested in? Select one to start.",
            options: serviceOptions.slice(0, 40).map((o: any) => ({
              label: String(o?.label || "Service"),
              value: String(o?.value || ""),
            })),
            multi_select: false,
            variant: "cards",
            columns: 2,
            blueprint: { presentation: { auto_advance: true, continue_label: "Continue" } },
          } as any);
        } else {
          // If the instance doesn't have a DB-backed service catalog, we still need a deterministic
          // step 1 so the user can tell us what they're looking for.
          steps.push({
            id: "step-service-primary",
            type: "text_input",
            question:
              "Wait — to help us give you accurate pricing, mind answering a few quick questions?",
            humanism: "What service are you interested in? Type it to start.",
            placeholder: "e.g., bathroom remodel, landscaping, roof repair…",
            required: true,
            blueprint: { presentation: { continue_label: "Continue" } },
          } as any);
        }

        const serviceParamRaw =
          params.get("serviceId") ||
          params.get("service_id") ||
          params.get("service") ||
          null;
        const serviceParam = typeof serviceParamRaw === "string" ? serviceParamRaw.trim() : "";
        const serviceParamLower = serviceParam.toLowerCase();
        const shouldAutostart =
          params.get("autostart") === "1" ||
          params.get("autostart") === "true" ||
          params.get("start") === "1" ||
          params.get("start") === "true";
        const selectedFromParam =
          serviceParam && serviceOptions.length > 0
            ? serviceOptions.find((o: any) => {
                const value = String(o?.value || "").trim();
                const label = String(o?.label || o?.serviceName || "").trim().toLowerCase();
                return value === serviceParam || (label && label === serviceParamLower);
              })
            : null;
        const prefillService =
          selectedFromParam && selectedFromParam.value
            ? String(selectedFromParam.value)
            : serviceParam
              ? serviceParam
              : shouldAutostart && serviceOptions.length === 1 && serviceOptions[0]?.value
                ? String(serviceOptions[0].value)
                : null;
        const prefillServiceOption =
          prefillService && serviceOptions.length > 0
            ? serviceOptions.find((o: any) => String(o?.value || "") === prefillService) || null
            : null;
        const prefillStyleStep = prefillServiceOption ? buildDeterministicStyleStep(prefillServiceOption) : null;
        if (prefillStyleStep) {
          steps.push(prefillStyleStep);
        }

        // If a service is already known (single option / query param), seed it into step state so
        // StepEngine can immediately call `/generate-steps` and advance.
        try {
          if (prefillService) {
            const existing = loadStepState(instanceId);
            const hasExistingForSession = Boolean(existing && existing.sessionId === sessionId);
            const alreadyAnswered =
              hasExistingForSession && (existing as any)?.stepData && (existing as any).stepData["step-service-primary"] !== undefined;
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
                stepData: { "step-service-primary": prefillService },
                sessionId,
              };
              saveStepState(instanceId, seeded);
            }
          }
        } catch {}

        setFlowPlan({
          sessionId,
          maxSteps: (steps?.length || 0) + 20,
          steps,
        } as FlowPlan);

        console.log('[AIFormPageRenderer] Bootstrap complete', {
          sessionId,
          initialUseCase,
          deterministicSteps: steps.map((s: any) => s?.id),
          serviceOptionsCount: serviceOptions.length,
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
  }, [instanceId, demoType, demoSlug, recordMeta, sessionScopeKey, useWidgetDefaults]);

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

  return (
    <FormThemeProvider config={designConfig || defaultDesignSettings}>
      <ExperienceStateProvider>
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
          {dspyMeta?.lintFailed && (
            <div className="fixed bottom-4 right-4 z-50 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700 shadow-sm">
              We adjusted wording for clarity
            </div>
          )}
          <StepEngine 
            instanceId={instanceId} 
            sessionScopeKey={sessionScopeKey}
            flowPlan={flowPlan} 
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
      </ExperienceStateProvider>
    </FormThemeProvider>
  );
}

export const AIFormPageRenderer = AdventureFormExperience;
