/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useEffect, useMemo, useState } from "react";

import type { DesignSettings } from "@/types/design";
import { FormThemeProvider } from "@/components/form/demo/FormThemeProvider";
import { BrandingHeader } from "@/components/form/steps/ui-layout/BrandingHeader";
import { ImagePreviewExperience } from "@/components/form/steps/image-preview-experience/ImagePreviewExperience";
import { Widget } from "@/components/widget/Widget";
import { ShopifyProvider } from "@/hooks/use-shopify-context";
import { withWidgetDesignDefaults } from "@/lib/widget-design-defaults";
import { extractAIFormConfig } from "@/lib/ai-form/config/extract-ai-form-config";
import { getOrCreateSessionId } from "@/lib/ai-form/session-manager";
import { upsertFormStateContext } from "@/lib/ai-form/state/form-state-context";
import { ExperienceStateProvider } from "@/components/form/state/ExperienceState";

type WidgetProps = {
  instanceId: string;
  initialInstanceData: any;
  initialDesignConfig: DesignSettings;
  /** When true, do not render the fixed full-screen wrapper. */
  embedded?: boolean;
};

/**
 * Form-disabled adventure experience.
 *
 * Used by:
 * - adv-widget app/adventure/[instanceId] when form is disabled.
 * - adv-designer: embedded in an iframe for real-time preview (IframeWidgetPreview
 *   loads /adventure/:instanceId; this component listens for UPDATE_CONFIG and
 *   posts WIDGET_READY so the designer can push config as you work).
 *
 * Uses the legacy widget-style runtime (gallery + prompt input) and supports
 * realtime config updates from the designer via postMessage (UPDATE_CONFIG).
 */
export function AdventureWidgetExperience({
  instanceId,
  initialInstanceData,
  initialDesignConfig,
  embedded = false,
}: WidgetProps) {
  const [designConfig, setDesignConfig] = useState<DesignSettings>(() =>
    withWidgetDesignDefaults(initialDesignConfig as any, initialInstanceData?.name)
  );
  const [instanceData, setInstanceData] = useState<any>(() => initialInstanceData || null);

  const widgetKey = useMemo(() => `adventure-widget:${instanceId}`, [instanceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const inIframe = Boolean(window.parent && window.parent !== window);
    if (!inIframe) return;

    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const { data } = e as any;
      if (!data || typeof data !== "object") return;

      if (data.type === "UPDATE_CONFIG" && data.config) {
        try {
          const nextConfig = data.config as DesignSettings;
          setInstanceData((prev: any) => {
            const instanceName =
              (prev && typeof prev.name === "string" && prev.name.trim()) ||
              (typeof initialInstanceData?.name === "string" && String(initialInstanceData.name).trim()) ||
              undefined;
            setDesignConfig(withWidgetDesignDefaults(nextConfig as any, instanceName));
            if (!prev || typeof prev !== "object") return prev;
            return { ...prev, config: nextConfig };
          });
          try {
            window.parent?.postMessage({ type: "UPDATE_CONFIG_ACK" }, "*");
          } catch {}
        } catch {}
        return;
      }

      if (data.type === "UPDATE_FLOW_CONFIG") {
        try {
          window.parent?.postMessage({ type: "UPDATE_FLOW_CONFIG_ACK" }, "*");
        } catch {}
      }
    };

    try {
      window.parent?.postMessage({ type: "WIDGET_READY", surface: "adventure_widget" }, "*");
    } catch {}

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [instanceId]);

  const inner = (
    <ExperienceStateProvider initialFacts={{ viewportMode: "desktop", previewEnabled: false, showQuestionPane: false }}>
      <ShopifyProvider>
        <Widget
          key={widgetKey}
          instanceId={instanceId}
          designConfig={designConfig as any}
          instanceData={instanceData as any}
          fullPage={true}
          deployment={true}
          showDemoOverlay={false}
        />
      </ShopifyProvider>
    </ExperienceStateProvider>
  );
  if (embedded) return inner;
  return <main className="fixed inset-0 w-screen h-screen overflow-hidden">{inner}</main>;
}

type PreviewOnlyProps = {
  instanceId: string;
  initialInstanceData: any;
  initialDesignConfig: DesignSettings;
};

/**
 * Preview-only adventure: FormThemeProvider + BrandingHeader + ImagePreviewExperience.
 * No step flow; session is created and form context seeded for image generation.
 */
export function AdventurePreviewOnly(props: PreviewOnlyProps) {
  const { instanceId, initialInstanceData, initialDesignConfig } = props;

  const design = useMemo(() => withWidgetDesignDefaults(initialDesignConfig), [initialDesignConfig]);
  const aiForm = useMemo(() => extractAIFormConfig(initialInstanceData?.config), [initialInstanceData]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const stepDataSoFar = useMemo(() => ({}), []);

  useEffect(() => {
    const scopeKey = `${instanceId}::adventure::preview`;
    let isFresh = true;
    try {
      const sp = new URLSearchParams(window.location.search);
      const persist = sp.get("persist_session");
      if (persist === "1" || persist === "true") isFresh = false;
    } catch {}
    const id = getOrCreateSessionId(scopeKey, isFresh);
    setSessionId(id);

    try {
      const serviceSummary =
        typeof initialInstanceData?.company_summary === "string"
          ? String(initialInstanceData.company_summary).trim()
          : typeof initialInstanceData?.service_summary === "string"
            ? String(initialInstanceData.service_summary).trim()
            : null;
      const businessContext =
        typeof initialInstanceData?.business_context === "string"
          ? String(initialInstanceData.business_context).trim()
          : typeof initialInstanceData?.name === "string"
            ? String(initialInstanceData.name).trim()
            : null;
      const patch: any = {};
      if (serviceSummary) patch.serviceSummary = serviceSummary;
      if (businessContext) patch.businessContext = businessContext;
      if (Object.keys(patch).length > 0) upsertFormStateContext(id, patch);
    } catch {}
  }, [instanceId, initialInstanceData]);

  if (!sessionId) {
    return (
      <FormThemeProvider config={design}>
        <div className="min-h-screen w-full flex items-center justify-center">Loading…</div>
      </FormThemeProvider>
    );
  }

  const leadGateEnabled = true;

  return (
    <ExperienceStateProvider
      initialFacts={{
        viewportMode: "desktop",
        showBranding: true,
        showProgress: false,
        showTimeline: false,
        previewEnabled: true,
        showQuestionPane: false,
      }}
    >
      <FormThemeProvider config={design}>
        <div className="min-h-screen w-full">
          <div
            className="sticky top-0 z-50 backdrop-blur"
            style={{ backgroundColor: "var(--form-surface-color, rgba(255,255,255,0.85))" }}
          >
            <div className="px-4 py-2">
              <div className="w-full max-w-2xl mx-auto">
                <BrandingHeader />
              </div>
            </div>
          </div>

          <main className="px-4 py-4">
            <div className="w-full max-w-4xl mx-auto space-y-3">
              <ImagePreviewExperience
                enabled={true}
                leadGateEnabled={leadGateEnabled}
                instanceId={instanceId}
                sessionId={sessionId}
                config={{
                  businessContext: (initialInstanceData?.businessContext || initialInstanceData?.config?.businessContext) ?? undefined,
                  industry: (initialInstanceData?.industry || initialInstanceData?.config?.industry) ?? undefined,
                  useCase: initialInstanceData?.use_case ?? initialInstanceData?.useCase ?? initialInstanceData?.config?.useCase ?? undefined,
                  previewPricing: aiForm.previewPricing,
                }}
                stepDataSoFar={stepDataSoFar}
                answeredQuestionCount={0}
                autoRegenerateEveryNAnsweredQuestions={0}
                variant="hero"
                previewChromePx={8}
              />
            </div>
          </main>
        </div>
      </FormThemeProvider>
    </ExperienceStateProvider>
  );
}
