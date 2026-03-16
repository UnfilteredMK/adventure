"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DesignSettings } from "@/types/design";
import type { StepDefinition, UIStep } from "@/types/ai-form";
import type { GalleryUI } from "@/types/ai-form-ui-contract";
import { buildContextState } from "@/lib/ai-form/state/context-state";
import { loadServiceCatalog } from "@/lib/ai-form/state/service-catalog-storage";
import { buildImagePromptViaDSPy } from "@/lib/ai-form/utils/image-prompt-builder";
import { emitTelemetry } from "@/lib/ai-form/telemetry";
import { useFormSubmission } from "@/hooks/use-form-submission";
import { StepLayout } from "../../ui-layout/StepLayout";
import { useFormTheme } from "../../../demo/FormThemeProvider";
import { ImageGallery } from "@/components/widget/gallery/ImageGallery";
import { LeadCaptureModal } from "@/components/widget/LeadCaptureModal";
import { LeadGenPopover } from "../lead-gen/LeadGenPopover";
import { ReferenceImageUpload } from "@/components/widget/user-input-section/ReferenceImageUpload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import { detectCurrencyFromLocale, formatCurrency } from "@/lib/ai-form/utils/currency";

function collectImagesFromAllStepData(allStepData: Record<string, any>) {
  const out: Array<{ src: string; key: string }> = [];
  for (const [k, v] of Object.entries(allStepData || {})) {
    if (!v) continue;
    const pushSrc = (src: any) => {
      if (typeof src !== "string") return;
      if (!src.startsWith("data:image") && !src.startsWith("http")) return;
      out.push({ src, key: `${k}:${src.slice(0, 32)}` });
    };
    if (typeof v === "string") pushSrc(v);
    else if (Array.isArray(v)) v.forEach(pushSrc);
  }
  // De-dupe by src
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.src) ? false : (seen.add(x.src), true))).slice(0, 12);
}

interface GalleryStepProps {
  step: StepDefinition | GalleryUI | UIStep;
  stepData?: any;
  onComplete: (data: any) => void;
  onBack?: () => void;
  canGoBack: boolean;
  isLoading: boolean;
  allStepData?: Record<string, any>;
  allSteps?: Array<StepDefinition | UIStep>;
  instanceId?: string;
  sessionId?: string;
  config?: { businessContext?: string; industry?: string; useCase?: string };
  instanceData?: any;
}

export function GalleryStep({
  step,
  stepData,
  onComplete,
  onBack,
  canGoBack,
  isLoading,
  allStepData = {},
  allSteps = [],
  instanceId,
  sessionId,
  config,
}: GalleryStepProps) {
  const { theme, config: designConfig } = useFormTheme();
  const layoutVariant = (step as any)?.blueprint?.validation?.layout_variant;
  const isEndcapPreview = layoutVariant === "endcap_preview";

  // Keep the gallery viewport-safe on all devices (avoid fixed 520px overflow).
  const [galleryHeight, setGalleryHeight] = useState<number>(520);
  useEffect(() => {
    const compute = () => {
      const h = typeof window !== "undefined" ? window.innerHeight : 900;
      // 55% of viewport, clamped.
      const next = Math.min(520, Math.max(320, Math.floor(h * 0.55)));
      setGalleryHeight(next);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  const images = useMemo(() => collectImagesFromAllStepData(allStepData), [allStepData]);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<Array<{ image: string | null; prompt?: string | null }>>(
    []
  );
  const [prompt, setPrompt] = useState<string>("");
  const promptInputStepId = "step-promptInput";
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [showPricingGate, setShowPricingGate] = useState(false);
  const [regenerationsRemaining, setRegenerationsRemaining] = useState<number>(0);

  const leadSubmission = useFormSubmission({ instanceId: instanceId || "", sessionId });
  const hasSubmitted = leadSubmission.hasSubmitted;
  const setHasSubmitted = leadSubmission.setHasSubmitted;

  useEffect(() => {
    if (!instanceId || !sessionId) return;
    leadSubmission
      .checkStep2Completion()
      .then((ok) => {
        if (ok) setHasSubmitted(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, sessionId]);

  // Seed reference images from uploads (best-effort), so users can tweak/append without re-uploading.
  useEffect(() => {
    if (isEndcapPreview) return;
    const seeded = images.map((x) => x.src);
    if (seeded.length === 0) return;
    setReferenceImages((prev) => {
      const merged = [...prev];
      for (const u of seeded) {
        if (!merged.includes(u)) merged.push(u);
      }
      // Keep it tight so the UI doesn't get noisy.
      return merged.slice(0, 6);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length, isEndcapPreview]);

  const normalizeUseCase = (raw?: any): "tryon" | "scene-placement" | "scene" => {
    const v = String(raw || "").trim().toLowerCase().replace(/_/g, "-");
    if (v === "tryon" || v === "try-on") return "tryon";
    if (v === "scene-placement") return "scene-placement";
    if (v === "scene") return "scene";
    return "scene";
  };

  const useCase = useMemo(() => normalizeUseCase(config?.useCase), [config?.useCase]);

  const normalizeUploadToStrings = (raw: any): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
    if (typeof raw === "string") return [raw];
    return [];
  };

  const uploadReferenceImage = useCallback(
    async (img: string): Promise<string> => {
      if (!img) return img;
      if (!instanceId) return img;
      if (!img.startsWith("data:")) return img;
      try {
        const res = await fetch("/api/upload-reference-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, image: img }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data?.url) return String(data.url);
        }
      } catch {}
      return img;
    },
    [instanceId]
  );

  const ensureReferenceImageUrls = useCallback(
    async (imgs: string[]): Promise<string[]> => {
      const out: string[] = [];
      for (const img of imgs) {
        if (typeof img !== "string") continue;
        const url = await uploadReferenceImage(img);
        if (url) out.push(url);
      }
      // De-dupe
      return Array.from(new Set(out));
    },
    [uploadReferenceImage]
  );

  // The backend may omit `question`; StepLayout can render without it.
  const continueLabel = (step as any)?.blueprint?.presentation?.continue_label ?? "Continue";

  const quoteStub = (step as any)?.blueprint?.validation?.quote_stub as
    | {
        currency?: string;
        totalMin?: number;
        totalMax?: number;
        items?: Array<{ id: string; label: string; labor: number; material: number }>;
      }
    | undefined;
  const locale =
    typeof navigator !== "undefined"
      ? ((navigator.languages && navigator.languages[0]) || navigator.language || undefined)
      : undefined;
  const quoteCurrency = (quoteStub?.currency || detectCurrencyFromLocale(locale) || "USD").toUpperCase();
  const quoteItems = Array.isArray(quoteStub?.items) ? quoteStub!.items : [];
  const quoteRange = useMemo(() => {
    const min = Number((quoteStub as any)?.totalMin);
    const max = Number((quoteStub as any)?.totalMax);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (hi <= 0) return null;
    return { min: lo, max: hi };
  }, [(quoteStub as any)?.totalMin, (quoteStub as any)?.totalMax]);
  const quoteTotals = useMemo(() => {
    let labor = 0;
    let material = 0;
    for (const it of quoteItems) {
      labor += Number(it?.labor || 0);
      material += Number(it?.material || 0);
    }
    return { labor, material, total: labor + material };
  }, [quoteItems]);
  const pricingGateStyle = useMemo(
    () =>
      ({
        ["--sif-overlay-bg" as any]: "rgba(51, 65, 85, 0.52)",
        ["--sif-overlay-hover-bg" as any]: "rgba(51, 65, 85, 0.64)",
        ["--sif-overlay-border" as any]: "rgba(255,255,255,0.24)",
        ["--sif-lead-gen-overlay-bg" as any]: "rgba(51, 65, 85, 0.52)",
        ["--sif-lead-gen-fg" as any]: "rgba(255,255,255,0.95)",
        ["--sif-lead-gen-muted" as any]: "rgba(255,255,255,0.72)",
        ["--sif-lead-gen-input-bg" as any]: "rgba(255,255,255,0.12)",
        ["--sif-lead-gen-input-border" as any]: "rgba(255,255,255,0.20)",
        ["--sif-lead-gen-placeholder" as any]: "rgba(255,255,255,0.58)",
        ["--sif-lead-gen-action-bg" as any]: "rgba(255,255,255,0.18)",
        ["--sif-lead-gen-action-fg" as any]: "#ffffff",
        ["--sif-lead-gen-action-border" as any]: "rgba(255,255,255,0.26)",
        ["--sif-lead-gen-ring" as any]: "rgba(255,255,255,0.38)",
      }) as React.CSSProperties,
    []
  );
  const formattedEstimate = useMemo(() => {
    if (quoteRange) {
      const lo = formatCurrency(quoteRange.min, { locale, currency: quoteCurrency });
      const hi = formatCurrency(quoteRange.max, { locale, currency: quoteCurrency });
      return `${lo} – ${hi}`;
    }
    return formatCurrency(quoteTotals.total, { locale, currency: quoteCurrency });
  }, [locale, quoteCurrency, quoteRange, quoteTotals.total]);

  const [pricingModalOpen, setPricingModalOpen] = useState(false);
  const [pricingSlider, setPricingSlider] = useState(50); // 0..100, midpoint default
  const pricingMultiplier = useMemo(() => 0.85 + 0.4 * (Math.max(0, Math.min(100, pricingSlider)) / 100), [pricingSlider]);
  const adjustedRange = useMemo(() => {
    if (!quoteRange) return null;
    const min = Math.max(0, Math.round(quoteRange.min * pricingMultiplier));
    const max = Math.max(min, Math.round(quoteRange.max * pricingMultiplier));
    return { min, max };
  }, [pricingMultiplier, quoteRange]);

  type LeadGateVariant = "blur_image" | "download_gate";
  const leadGateExperiment = (step as any)?.blueprint?.validation?.lead_gate_experiment as
    | { seed?: string; variants?: Array<{ id: LeadGateVariant; weight: number }> }
    | undefined;

  const leadGateVariant: LeadGateVariant = useMemo(() => {
    if (typeof window === "undefined") return "download_gate";
    if (!sessionId) return "download_gate";
    const storageKey = `gallery_gate_variant:${sessionId}`;
    const existing = window.localStorage.getItem(storageKey);
    if (existing === "blur_image" || existing === "download_gate") return existing;

    const variants =
      Array.isArray(leadGateExperiment?.variants) && leadGateExperiment!.variants.length > 0
        ? leadGateExperiment!.variants
        : ([
            { id: "blur_image", weight: 0.5 },
            { id: "download_gate", weight: 0.5 },
          ] as const);

    const totalWeight = variants.reduce((sum, v) => sum + Math.max(0, Number(v.weight) || 0), 0) || 1;
    const key = `${instanceId || ""}:${sessionId}:${leadGateExperiment?.seed || ""}`;

    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    const r = (h >>> 0) / 2 ** 32;

    let acc = 0;
    for (const v of variants) {
      acc += Math.max(0, Number(v.weight) || 0) / totalWeight;
      if (r <= acc) {
        window.localStorage.setItem(storageKey, v.id);
        return v.id;
      }
    }
    window.localStorage.setItem(storageKey, variants[variants.length - 1].id);
    return variants[variants.length - 1].id;
  }, [instanceId, leadGateExperiment?.seed, leadGateExperiment?.variants, sessionId]);

  const blurGateActive = leadGateVariant === "blur_image" && !hasSubmitted;
  const downloadGateActive = !hasSubmitted;

  const openLeadModal = useCallback(
    (gateContext: "photos" | "estimate", gateType?: string) => {
      if (sessionId && instanceId) {
        emitTelemetry({
          sessionId,
          instanceId,
          eventType: "gate_shown",
          stepId: `${String((step as any)?.id || "step-involved-gallery")}:${gateContext}`,
          timestamp: Date.now(),
          payload: {
            gate_context: gateContext,
            gate_type: gateType || (gateContext === "photos" ? (blurGateActive ? "blur_image" : "download_gate") : "quote_blur"),
            step_type: "gallery",
          },
        });
      }
      setShowLeadModal(true);
    },
    [blurGateActive, instanceId, sessionId, step]
  );

  // "Blur image" variant: the gate is visible immediately (moment of desire).
  useEffect(() => {
    if (!blurGateActive) return;
    if (!sessionId || !instanceId) return;
    emitTelemetry({
      sessionId,
      instanceId,
      eventType: "gate_shown",
      stepId: `${String((step as any)?.id || "step-involved-gallery")}:blur_image`,
      timestamp: Date.now(),
      payload: {
        gate_context: "photos",
        gate_type: "blur_image",
        step_type: "gallery",
      },
    });
  }, [blurGateActive, instanceId, sessionId, step]);

  const galleryMaxImages =
    Number.isFinite(Number((step as any)?.blueprint?.validation?.gallery_max_images))
      ? Math.max(1, Math.min(12, Math.floor(Number((step as any)?.blueprint?.validation?.gallery_max_images))))
      : Number.isFinite(Number(designConfig.gallery_max_images))
        ? Math.max(1, Math.min(12, Math.floor(Number(designConfig.gallery_max_images))))
        : 6;

  const refreshRegenAllowance = useCallback(async () => {
    if (!instanceId) return;
    try {
      const required = Math.max(1, Number(galleryMaxImages || 1));
      const res = await fetch(`/api/leads/availability/${encodeURIComponent(instanceId)}?required=${required}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const bal = typeof data?.currentBalance === "number" ? Number(data.currentBalance) : 0;
      setRegenerationsRemaining(Math.max(0, Math.floor(bal / required)));
    } catch {}
  }, [galleryMaxImages, instanceId]);

  useEffect(() => {
    void refreshRegenAllowance();
  }, [refreshRegenAllowance]);

  const resolveServiceName = useCallback((): string | null => {
    if (!sessionId) return null;
    const serviceIdRaw =
      allStepData?.["step-service-primary"] ??
      allStepData?.["step-service"] ??
      allStepData?.["step_service_primary"] ??
      allStepData?.["step_service"];
    const serviceId = Array.isArray(serviceIdRaw) ? String(serviceIdRaw[0] || "") : String(serviceIdRaw || "");
    if (!serviceId) return null;
    const cat = loadServiceCatalog(sessionId);
    const meta = cat?.byServiceId?.[serviceId];
    return meta?.serviceName || null;
  }, [allStepData, sessionId]);

  const resolveServiceSummary = useCallback((): string | null => {
    if (!sessionId) return null;
    const serviceIdRaw =
      allStepData?.["step-service-primary"] ??
      allStepData?.["step-service"] ??
      allStepData?.["step_service_primary"] ??
      allStepData?.["step_service"];
    const serviceId = Array.isArray(serviceIdRaw) ? String(serviceIdRaw[0] || "") : String(serviceIdRaw || "");
    if (!serviceId) return null;
    const cat = loadServiceCatalog(sessionId);
    const meta: any = cat?.byServiceId?.[serviceId];
    return typeof meta?.serviceSummary === "string" ? meta.serviceSummary : null;
  }, [allStepData, sessionId]);

  const handleGenerateGallery = useCallback(async (manualPromptInput?: string) => {
    if (!instanceId) return;
    setGenerationError(null);
    setIsGenerating(true);
    try {
      const manualPrompt = typeof manualPromptInput === "string" ? manualPromptInput.trim() : "";
      const stepDataSoFarWithPrompt = manualPrompt
        ? { ...(allStepData || {}), [promptInputStepId]: manualPrompt }
        : allStepData;

      const promptInputStepForQA: StepDefinition = {
        id: promptInputStepId,
        componentType: "promptInput" as any,
        intent: "refine_preferences",
        data: { placeholder: "Describe what you want to change…" },
        copy: {
          headline: "What would you like to change?",
          subtext: "Tell us what to update and we’ll regenerate.",
        },
      };

      const ctx = buildContextState({
        stepDataSoFar: stepDataSoFarWithPrompt,
        steps: allSteps,
        extra: { useCase, subcategoryName: null },
      });

      const serviceName = resolveServiceName();
      const promptResult = await buildImagePromptViaDSPy({
        contextState: ctx,
        service: serviceName,
        useCase,
        industry: config?.industry ?? null,
        businessContext: config?.businessContext ?? null,
        previousPrompt: manualPrompt ? prompt : undefined,
        refinementNotes: manualPrompt ? manualPrompt : undefined,
        steps: allSteps,
        stepDataSoFar: stepDataSoFarWithPrompt,
        instanceId,
        sessionId,
        referenceImages,
      });
      const nextPrompt = String(promptResult.prompt || "").trim();
      if (!nextPrompt) throw new Error("Prompt builder returned an empty prompt.");
      setPrompt(nextPrompt);

      // Gather use-case specific uploads (if present)
      const userImageRaw = allStepData?.["step-upload-user-image"];
      const productImageRaw = allStepData?.["step-upload-product-image"];
      const sceneImageRaw = allStepData?.["step-upload-scene-image"];

      const userImage = normalizeUploadToStrings(userImageRaw)[0] || null;
      const productImage = normalizeUploadToStrings(productImageRaw)[0] || null;
      const sceneImage = normalizeUploadToStrings(sceneImageRaw)[0] || null;

      const [userImageUrl, productImageUrl, sceneImageUrl] = await Promise.all([
        userImage ? uploadReferenceImage(userImage) : Promise.resolve(null),
        productImage ? uploadReferenceImage(productImage) : Promise.resolve(null),
        sceneImage ? uploadReferenceImage(sceneImage) : Promise.resolve(null),
      ]);

      const referenceUrls = await ensureReferenceImageUrls(referenceImages);
      const referenceSeed = typeof activeImage === "string" && activeImage ? [activeImage] : [];
      // Cap to primary + 2-3 secondary to avoid muddy edits.
      const mergedReferenceUrls = Array.from(new Set([...referenceSeed, ...referenceUrls])).slice(0, 4);

      // Minimal validation: if the use-case needs specific uploads, require them.
      if (useCase === "tryon" && (!userImageUrl || !productImageUrl)) {
        throw new Error("Please upload both a person photo and a product photo to generate a try-on result.");
      }
      if (useCase === "scene-placement" && (!sceneImageUrl || !productImageUrl)) {
        throw new Error("Please upload both a room photo and a product photo to generate a placement result.");
      }

      const noCache =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("fresh") === "1" ||
            new URLSearchParams(window.location.search).get("fresh") === "true"
          : undefined;

      const endpoint =
        useCase === "tryon" ? "/api/generate/try-on" : useCase === "scene-placement" ? "/api/generate/scene-placement" : "/api/generate/scene";

      const requestBody: any = {
        prompt: nextPrompt,
        instanceId,
        numOutputs: galleryMaxImages,
        outputFormat: useCase === "scene" ? undefined : "jpg",
      };

      if (promptResult.negativePrompt) requestBody.negativePrompt = promptResult.negativePrompt;

      if (useCase === "tryon") {
        requestBody.userImage = userImageUrl;
        requestBody.productImage = productImageUrl;
        requestBody.referenceImages = Array.from(new Set([userImageUrl, productImageUrl, ...mergedReferenceUrls].filter(Boolean))).slice(0, 4);
      } else if (useCase === "scene-placement") {
        requestBody.sceneImage = sceneImageUrl;
        requestBody.productImage = productImageUrl;
        requestBody.referenceImages = Array.from(new Set([sceneImageUrl, productImageUrl, ...mergedReferenceUrls].filter(Boolean))).slice(0, 4);
      } else {
        const primaryScene = sceneImageUrl || mergedReferenceUrls[0] || null;
        if (primaryScene) requestBody.sceneImage = primaryScene;
      }

      if (noCache && (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_API_LOGS === "true")) {
        try {
          const exactBody = JSON.stringify(requestBody);
          console.log(JSON.stringify(JSON.parse(exactBody), null, 2));
        } catch {
          console.log(requestBody);
        }
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 402) {
          throw new Error(err?.error || "Insufficient credits or subscription inactive.");
        }
        throw new Error(err?.error || "Failed to generate images.");
      }
      const data = await res.json().catch(() => ({}));
      const imgs = Array.isArray(data?.images) ? data.images : [];
      setGeneratedImages(imgs.map((u: string) => ({ image: u, prompt: nextPrompt })));
      setRefreshTrigger((n) => n + 1);
      if (imgs[0]) setActiveImage(imgs[0]);
      void refreshRegenAllowance();
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : "Failed to generate images.");
    } finally {
      setIsGenerating(false);
    }
  }, [
    allStepData,
    allSteps,
    activeImage,
    config,
    ensureReferenceImageUrls,
    galleryMaxImages,
    instanceId,
    prompt,
    promptInputStepId,
    referenceImages,
    resolveServiceName,
    resolveServiceSummary,
    refreshRegenAllowance,
    sessionId,
    uploadReferenceImage,
    useCase,
  ]);

  const handlePromptSubmit = useCallback(
    (newPrompt: string) => {
      const trimmed = String(newPrompt || "").trim();
      if (!trimmed) return;
      void handleGenerateGallery(trimmed);
    },
    [handleGenerateGallery]
  );

  const handleDrillDownSubmit = useCallback(() => {
    // Drilldown is handled inside `DrillDownModal` (used by ImageGallery).
  }, []);

  const effectiveConfig: DesignSettings = useMemo(() => {
    // `ImageGallery` expects widget-like design settings; the form config is compatible.
    // These defaults make the gallery usable in the form layout without requiring instance config changes.
    return {
      ...designConfig,
      gallery_columns: designConfig.gallery_columns ?? 1,
      gallery_max_images: designConfig.gallery_max_images ?? 6,
      gallery_spacing: designConfig.gallery_spacing ?? 8,
    };
  }, [designConfig]);

  const effectiveGalleryConfig: DesignSettings = useMemo(() => {
    // Configure the underlying widget gallery to gate downloads until lead capture is complete.
    // This is used by `DrillDownModal` when the user clicks Download.
    if (!downloadGateActive) return effectiveConfig;
    return {
      ...effectiveConfig,
      lead_capture_enabled: true as any,
      lead_capture_trigger: "download" as any,
    } as any;
  }, [downloadGateActive, effectiveConfig]);

  const canRegenerate =
    Boolean(instanceId) &&
    !isLoading &&
    !isGenerating &&
    (generatedImages.length === 0 || typeof regenerationsRemaining !== "number" || regenerationsRemaining > 0);

  if (isEndcapPreview) {
    const hero = generatedImages?.[0]?.image || null;
    const canGenerate = Boolean(instanceId) && !isLoading && !isGenerating;
    const promptFromStep =
      typeof (allStepData as any)?.[promptInputStepId] === "string"
        ? String((allStepData as any)[promptInputStepId]).trim()
        : "";
    const submitLabel = hero ? "Regenerate" : "Generate";

    return (
      <StepLayout
        step={step as any}
        onComplete={() => onComplete(stepData ?? true)}
        onBack={onBack}
        canGoBack={canGoBack}
        isLoading={isLoading}
        canContinue={true}
        continueLabel={continueLabel}
        className="max-w-2xl"
      >
        <div className="space-y-3">
          {generationError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {generationError}
            </div>
          )}

          <div
            className="relative w-full overflow-hidden rounded-xl border bg-[var(--form-surface-color)] border-[color:var(--form-surface-border-color)]"
            style={{ aspectRatio: "1 / 1" }}
          >
            {hero ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={hero} alt="Generated preview" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-[color:var(--form-surface-border-color)]/40" />
            )}
            {isGenerating ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/15">
                <div
                  className="rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--form-surface-color)] border border-[color:var(--form-surface-border-color)]"
                  style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                >
                  Generating…
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!canGenerate || (Boolean(hero) && !canRegenerate)}
              onClick={() => void handleGenerateGallery(promptFromStep || undefined)}
              className="h-8"
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      </StepLayout>
    );
  }

  return (
    <StepLayout
      step={step as any}
      onComplete={() => onComplete(stepData ?? true)}
      onBack={onBack}
      canGoBack={canGoBack}
      isLoading={isLoading}
      canContinue={true}
      continueLabel={continueLabel}
      className="max-w-6xl"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        {/* Left: uploads + simple controls */}
        <div className="lg:col-span-3">
          <Card className="bg-[var(--form-surface-color)] border-[color:var(--form-surface-border-color)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Reference image</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ReferenceImageUpload
                instanceId={instanceId}
                onImageUpload={(img) => {
                  if (!img) return;
                  setReferenceImages((prev) => {
                    const next = prev.includes(img) ? prev : [...prev, img];
                    return next.slice(0, effectiveConfig.uploader_max_images ?? 4);
                  });
                }}
                onImageRemove={(idx) => {
                  setReferenceImages((prev) => prev.filter((_, i) => i !== idx));
                }}
                currentImages={referenceImages}
                maxImages={effectiveConfig.uploader_max_images ?? 4}
                variant="chatgpt"
                textSettings={{
                  secondaryText: "Upload",
                  textColor: theme.textColor,
                  fontFamily: theme.fontFamily,
                  fontSize: 14,
                }}
              />

              <div className="pt-2 border-t text-xs opacity-70" style={{ color: theme.textColor }}>
                Filters (coming next): quick selectors + sliders to refine options.
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Center: gallery + drilldown */}
        <div className="lg:col-span-6">
          <Card className="bg-[var(--form-surface-color)] border-[color:var(--form-surface-border-color)] relative">
            <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-sm">Design ideas</CardTitle>
              <Button
                size="sm"
                onClick={() => void handleGenerateGallery()}
                disabled={!instanceId || isLoading || isGenerating}
                className="h-8"
              >
                {isGenerating ? "Generating…" : "Generate"}
              </Button>
            </CardHeader>
            <CardContent>
              {generationError && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {generationError}
                </div>
              )}
              <div className="relative" style={{ height: galleryHeight }}>
                <div className={cn("h-full", blurGateActive && "blur-sm pointer-events-none select-none")}>
                  <ImageGallery
                    images={generatedImages}
                    isLoading={Boolean(isLoading)}
                    isGenerating={isGenerating}
                    config={effectiveGalleryConfig}
                    fullPage={false}
                    deployment={false}
                    layoutContext="vertical"
                    containerWidth={900}
                    containerHeight={galleryHeight}
                    instanceId={instanceId}
                    prompt={prompt}
                    setPrompt={setPrompt}
                    referenceImages={referenceImages}
                    onGenerateGallery={handleGenerateGallery}
                    onRegenerate={handleGenerateGallery}
                    regenerationsRemaining={regenerationsRemaining}
                    onPromptSubmit={handlePromptSubmit}
                    onDrillDownSubmit={handleDrillDownSubmit}
                    onActiveImageChange={setActiveImage}
                    onReplaceImage={(imageData: string) => {
                      setGeneratedImages((prev) => {
                        if (!activeImage) return prev;
                        const idx = prev.findIndex((x) => x?.image === activeImage);
                        if (idx < 0) return prev;
                        const next = [...prev];
                        next[idx] = { ...next[idx], image: imageData };
                        return next;
                      });
                      setActiveImage(imageData);
                    }}
                    onImageUpload={(img) => {
                      if (!img) return;
                      setReferenceImages((prev) => (prev.includes(img) ? prev : [...prev, img]).slice(0, 6));
                    }}
                    onImageRemove={(idx) => setReferenceImages((prev) => prev.filter((_, i) => i !== idx))}
                    onRefreshSuggestions={() => {}}
                    originalPrompt={prompt}
                    refreshTrigger={refreshTrigger}
                    hasSubmitted={hasSubmitted}
                    onRequestLeadCapture={() => openLeadModal("photos", "download_gate")}
                  />
                </div>

                <div className="absolute top-3 right-3 z-10 pointer-events-auto flex items-center gap-2">
                  {typeof regenerationsRemaining === "number" && (
                    <div
                      className="px-2 py-1 rounded-full text-[11px] shadow-sm bg-[var(--form-surface-color)] border border-[color:var(--form-surface-border-color)]"
                      style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                    >
                      {Math.max(0, regenerationsRemaining)} left
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    disabled={!canRegenerate}
                    onClick={() => void handleGenerateGallery()}
                    className="backdrop-blur-sm"
                    title="Regenerate images"
                    aria-label="Regenerate images"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {blurGateActive && (
                <div className="absolute inset-x-4 bottom-6 flex justify-center pointer-events-auto">
                  <Button onClick={() => openLeadModal("photos", "blur_image")} className="h-10 px-4">
                    Email me my photos
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: quote + breakdown */}
        <div className="lg:col-span-3">
          <Card className="bg-[var(--form-surface-color)] border-[color:var(--form-surface-border-color)] relative">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm">Estimate (preview)</CardTitle>
                {!blurGateActive && (
                  <Dialog open={pricingModalOpen} onOpenChange={setPricingModalOpen}>
                    {instanceId && sessionId && !hasSubmitted ? (
                      <LeadGenPopover
                        open={showPricingGate}
                        onOpenChange={setShowPricingGate}
                        instanceId={instanceId}
                        sessionId={sessionId}
                        gateContext="pricing_details"
                        surface="overlay"
                        contentStyle={pricingGateStyle}
                        title="Where should we send the pricing to?"
                        description="Enter your email to reveal pricing."
                        finePrint="Instant reveal after sending."
                        ctaLabel="Send pricing"
                        phoneTitle="Best phone number?"
                        phoneDescription="We can text updates too."
                        requirePhone
                        submitOnEmail={false}
                        submissionData={{ surface: "preview_pricing" }}
                        side="top"
                        align="end"
                        sideOffset={6}
                        onSubmitted={() => {
                          setHasSubmitted(true);
                          setShowPricingGate(false);
                          setPricingModalOpen(true);
                        }}
                      >
                        <Button variant="outline" className="h-8 px-3 text-xs">
                          View details
                        </Button>
                      </LeadGenPopover>
                    ) : (
                      <DialogTrigger asChild>
                        <Button variant="outline" className="h-8 px-3 text-xs">
                          View details
                        </Button>
                      </DialogTrigger>
                    )}
                    <DialogContent
                      className="max-w-xl border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)] p-0 shadow-2xl"
                      style={{ color: theme.textColor, fontFamily: theme.fontFamily }}
                    >
                      <DialogHeader className="space-y-3 border-b border-[color:var(--form-surface-border-color)] px-6 py-5 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <div
                            className="rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] bg-[var(--form-surface-color)] border border-[color:var(--form-surface-border-color)]"
                            style={{ color: theme.textColor }}
                          >
                            Pricing preview
                          </div>
                          {quoteRange ? (
                            <div
                              className="rounded-full px-3 py-1.5 text-xs font-medium border border-[color:var(--form-surface-border-color)]"
                              style={{ color: theme.primaryColor, backgroundColor: "color-mix(in srgb, var(--form-primary-color) 10%, white 90%)" }}
                            >
                              Adjustable range
                            </div>
                          ) : null}
                        </div>
                        <DialogTitle className="text-xl font-semibold tracking-tight">Estimate details</DialogTitle>
                        <DialogDescription className="text-sm opacity-75" style={{ color: theme.textColor }}>
                          Review the same pricing preview shown in the adventure flow, with a finish-level slider and itemized totals.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 px-6 py-5">
                        {quoteRange ? (
                          <div className="rounded-2xl border border-[color:var(--form-surface-border-color)] bg-white/50 p-4 backdrop-blur-sm">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div
                                className="rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] border border-[color:var(--form-surface-border-color)]"
                                style={{ color: theme.textColor }}
                              >
                                Range
                              </div>
                              <div className="text-[11px] opacity-70">UI-only preview</div>
                            </div>
                            <div className="text-xl font-semibold tabular-nums">
                              <span style={{ color: theme.primaryColor }}>
                                {formatCurrency(adjustedRange?.min ?? quoteRange.min, { locale, currency: quoteCurrency })}
                              </span>{" "}
                              <span className="opacity-50">–</span>{" "}
                              <span>
                                {formatCurrency(adjustedRange?.max ?? quoteRange.max, { locale, currency: quoteCurrency })}
                              </span>
                            </div>
                            <div className="mt-2 text-xs opacity-75">
                              Slide to preview cheaper vs higher-end finish levels (UI-only preview).
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-[color:var(--form-surface-border-color)] bg-white/50 p-4 backdrop-blur-sm">
                            <div
                              className="mb-3 inline-flex rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] border border-[color:var(--form-surface-border-color)]"
                              style={{ color: theme.textColor }}
                            >
                              Total
                            </div>
                            <div className="text-xl font-semibold tabular-nums" style={{ color: theme.primaryColor }}>
                              {formattedEstimate}
                            </div>
                          </div>
                        )}

                        {quoteRange && (
                          <div className="rounded-2xl border border-[color:var(--form-surface-border-color)] bg-white/50 p-4 backdrop-blur-sm">
                            <div className="mb-3 flex items-center justify-between text-xs opacity-75">
                              <span>Budget-friendly</span>
                              <span>Higher-end</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={pricingSlider}
                              onChange={(e) => setPricingSlider(Number(e.target.value))}
                              className="sif-range"
                              style={{ ["--form-primary-color" as any]: theme.primaryColor }}
                            />
                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/8">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${pricingSlider}%`,
                                  background: `linear-gradient(90deg, ${theme.primaryColor} 0%, ${theme.primaryColor}cc 100%)`,
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {quoteItems.length > 0 && (
                          <div className="rounded-2xl border border-[color:var(--form-surface-border-color)] bg-white/50 p-4 backdrop-blur-sm">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div
                                className="rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] border border-[color:var(--form-surface-border-color)]"
                                style={{ color: theme.textColor }}
                              >
                                Line items
                              </div>
                              <div className="text-xs font-medium tabular-nums" style={{ color: theme.primaryColor }}>
                                {formatCurrency(quoteTotals.total, { locale, currency: quoteCurrency })}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {quoteItems.map((it) => (
                                <div
                                  key={it.id}
                                  className="flex items-center justify-between rounded-2xl border border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)] px-3 py-2 text-sm"
                                >
                                  <span className="opacity-75">{it.label}</span>
                                  <span className="font-medium tabular-nums">
                                    {formatCurrency(Number(it.labor || 0) + Number(it.material || 0), { locale, currency: quoteCurrency })}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardHeader>
            <CardContent className={cn("space-y-3", blurGateActive && "blur-sm pointer-events-none select-none")}>
              <div className="space-y-1">
                <div className="text-sm font-semibold" style={{ color: theme.textColor, fontFamily: theme.fontFamily }}>
                  Your personalized estimate is ready
                </div>
                <div className="text-xs opacity-75" style={{ fontFamily: theme.fontFamily, color: theme.textColor }}>
                  {blurGateActive ? "Enter your email to see pricing and download options" : "Indicative range (preview)"}
                </div>
              </div>

	              <div className="border-t pt-3">
	                <div className="flex items-center justify-between">
	                  <span className="text-xs text-gray-500">{quoteRange ? "Range" : "Total"}</span>
	                  {quoteRange ? (
	                    <span className="text-2xl font-semibold tabular-nums whitespace-nowrap">
	                      <span style={{ color: theme.primaryColor }}>
	                        {formatCurrency(quoteRange.min, { locale, currency: quoteCurrency })}
	                      </span>
	                      <span className="text-muted-foreground mx-2">–</span>
	                      <span className="text-muted-foreground">
	                        {formatCurrency(quoteRange.max, { locale, currency: quoteCurrency })}
	                      </span>
	                    </span>
	                  ) : (
	                    <span className="text-2xl font-semibold tabular-nums whitespace-nowrap" style={{ color: theme.primaryColor }}>
	                      {formattedEstimate}
	                    </span>
	                  )}
	                </div>
	              </div>
            </CardContent>
            {blurGateActive && (
              <div className="absolute inset-4 flex items-center justify-center pointer-events-auto">
                <div className="text-center p-3 rounded-lg bg-white/80 backdrop-blur-sm border border-black/10 max-w-xs">
                  <div className="text-sm font-medium mb-1">Your personalized estimate is ready</div>
                  <div className="text-xs text-gray-600 mb-3">Enter your email to see pricing and download options</div>
                  <Button onClick={() => openLeadModal("estimate", "quote_blur")} className="h-9 px-4">
                    Unlock My Estimate
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {showLeadModal && instanceId && (
        <LeadCaptureModal
          config={effectiveGalleryConfig}
          instanceId={instanceId}
          sessionId={sessionId}
          onClose={() => setShowLeadModal(false)}
          onSubmit={async (data) => {
            // LeadCaptureModal already writes to `/api/leads` via its internal hook.
            // We only need to update local state to unlock gates.
            if (!data?.isPartial) {
              setHasSubmitted(true);
              setShowLeadModal(false);
            } else if (!data?.keepModalOpen) {
              setShowLeadModal(false);
            }
          }}
        />
      )}
    </StepLayout>
  );
}
