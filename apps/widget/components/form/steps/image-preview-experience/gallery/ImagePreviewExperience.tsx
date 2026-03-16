"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormTheme } from "../../../demo/FormThemeProvider";
import { cn } from "@/lib/utils";
import { buildAnsweredQAFromSteps } from "@/lib/ai-form/answered-qa";
import { loadStepState } from "@/lib/ai-form/state/step-state";
import { loadFormStateContext } from "@/lib/ai-form/state/form-state-context";
import { loadServiceCatalog } from "@/lib/ai-form/state/service-catalog-storage";
import {
  formStateStorageKey,
  loadFormStateSnapshot,
  loadLeadState,
  upsertLeadGate,
  upsertLeadState,
  upsertFormStateSnapshot,
} from "@/lib/ai-form/state/form-state-storage";
import { buildImagePromptViaDSPy } from "@/lib/ai-form/utils/image-prompt-builder";
import { buildPreviewPricingFromConfig } from "@/lib/ai-form/components/structural-steps";
import { detectCurrencyFromLocale, formatCurrency } from "@/lib/ai-form/utils/currency";
import { Download, Loader2, Mail, Maximize2, Phone } from "lucide-react";
import { FormLoader } from "@/components/form/FormLoader";
import { LeadGenPopover } from "@/components/form/steps/image-preview-experience/lead-gen/LeadGenPopover";
import { isDevModeEnabled } from "@/lib/ai-form/dev-mode";
import { PricingExperience } from "../pricing/PricingExperience";
import { useFormSubmission } from "@/hooks/use-form-submission";

function hexToRgba(hex: string, alpha: number): string | null {
  const h = String(hex || "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Darken a hex color by mixing with black. mixBlack 0.5 = 50% black. */
function darkenHex(hex: string, mixBlack: number): string {
  const h = String(hex || "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return hex;
  const f = Math.max(0, Math.min(1, 1 - mixBlack));
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
}

function isValidEmail(value: string): boolean {
  const s = value.trim();
  if (!s || s.length < 5) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isValidFullName(value: string): boolean {
  return value.trim().length >= 2;
}

function formatPhoneInput(value: string): { display: string; digits: string } {
  const digits = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 10);
  if (digits.length <= 3) return { display: digits ? `(${digits}` : "", digits };
  if (digits.length <= 6) return { display: `(${digits.slice(0, 3)}) ${digits.slice(3)}`, digits };
  return { display: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`, digits };
}

const IMAGE_GENERATION_ESTIMATED_SECONDS = 15;

type PreviewCacheV2 = {
  schemaVersion: 2;
  status: "idle" | "running" | "complete" | "error";
  images: string[];
  message?: string | null;
  error?: string | null;
  refinementNote?: string | null;
  runStartedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  // Tracks the latest context signature we've seen (helps detect changes across reloads).
  lastContextSignature?: string | null;
  // Tracks the specific context signature the current `images` were generated for.
  generatedForContextSignature?: string | null;
};

type PreviewRun = {
  id: string;
  createdAt: number;
  contextSignature: string;
  answeredQuestionCount?: number | null;
  images: string[];
  message?: string | null;
};

type PreviewCacheV3 = {
  schemaVersion: 3;
  status: "idle" | "running" | "complete" | "error";
  runs: PreviewRun[];
  activeRunId?: string | null;
  message?: string | null;
  error?: string | null;
  errorDetails?: string | null;
  refinementNote?: string | null;
  runStartedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  // Tracks the latest context signature we've seen (helps detect changes across reloads).
  lastContextSignature?: string | null;
  // Tracks the specific context signature the current run was generated for.
  generatedForContextSignature?: string | null;
  // Answer-count gating for auto-regeneration.
  lastGeneratedAnsweredCount?: number | null;
};

type NavigationTransition = {
  key: string;
  fromRunId: string;
  toRunId: string;
  fromImage: string;
  toImage: string;
  direction: -1 | 1;
};

type PreviewStackLayer = {
  key: string;
  src: string;
  kind: "transition" | "history";
};

function storageKeyV1(instanceId: string, sessionId: string) {
  return `ai_form_image_preview:v1:${instanceId}:${sessionId}`;
}

function storageKeyV2(instanceId: string, sessionId: string) {
  return `ai_form_image_preview:v2:${instanceId}:${sessionId}`;
}

function storageKeyV3(instanceId: string, sessionId: string) {
  return `ai_form_image_preview:v3:${instanceId}:${sessionId}`;
}

function storageKeyUploads(instanceId: string, sessionId: string) {
  return `ai_form_image_preview:uploads:v1:${instanceId}:${sessionId}`;
}

function safeJsonStringify(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function computeContextSignature(stepDataSoFar: Record<string, any>) {
  const keys = Object.keys(stepDataSoFar || {})
    .filter((k) => typeof k === "string" && !k.startsWith("__"))
    .sort();
  const snapshot: Record<string, any> = {};
  for (const k of keys) snapshot[k] = stepDataSoFar[k];
  return safeJsonStringify(snapshot);
}

function extractBudgetValue(stepData: Record<string, any>): number | null {
  const raw =
    (stepData as any)?.["step-budget-range"] ??
    (stepData as any)?.["budget_range"] ??
    (stepData as any)?.["budgetRange"] ??
    (stepData as any)?.["step-budget"];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isValidUrlLikeImage(src: any): src is string {
  if (typeof src !== "string") return false;
  if (!src) return false;
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:") || src.startsWith("/");
}

function absolutizeImageUrl(src: string): string {
  if (!src || typeof src !== "string") return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) return src;
  if (src.startsWith("/") && typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${src}`;
  }
  return src;
}

function decodeDataUrlText(dataUrl: string): string | null {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      if (typeof atob !== "function") return null;
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
      // Fallback: best-effort latin1 -> utf8-ish
      return binary;
    }
  } catch {}
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

function isPlaceholderPreviewImage(src: string): boolean {
  if (!src) return false;
  if (!src.startsWith("data:image/svg+xml")) return false;
  const decoded = decodeDataUrlText(src);
  if (!decoded) return true;
  return /placeholder|demo/i.test(decoded);
}

function newRunId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadCache(instanceId: string, sessionId: string): PreviewCacheV3 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(storageKeyV3(instanceId, sessionId)) ??
      window.localStorage.getItem(storageKeyV2(instanceId, sessionId)) ??
      window.localStorage.getItem(storageKeyV1(instanceId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    if ((parsed as any).schemaVersion === 3) {
      const base = parsed as PreviewCacheV3;
      const runs = Array.isArray(base.runs) ? base.runs : [];
      const normalizedRuns = runs
        .filter((r) => r && typeof r === "object")
        .map((r) => ({
          id: typeof (r as any).id === "string" ? (r as any).id : newRunId(),
          createdAt: Number((r as any).createdAt) || Date.now(),
          contextSignature: typeof (r as any).contextSignature === "string" ? (r as any).contextSignature : "",
          answeredQuestionCount:
            typeof (r as any).answeredQuestionCount === "number" && Number.isFinite((r as any).answeredQuestionCount)
              ? (r as any).answeredQuestionCount
              : null,
          images: Array.isArray((r as any).images)
            ? (r as any).images.filter(isValidUrlLikeImage).filter((src: string) => !isPlaceholderPreviewImage(src))
            : [],
          message: typeof (r as any).message === "string" ? (r as any).message : null,
        }))
        .filter((r) => Boolean(r.images?.length));

      const activeRunId = typeof base.activeRunId === "string" ? base.activeRunId : null;
      const hasActive = activeRunId && normalizedRuns.some((r) => r.id === activeRunId);
      const nextActiveRunId = hasActive ? activeRunId : normalizedRuns.at(-1)?.id ?? null;
      const next: PreviewCacheV3 = {
        schemaVersion: 3,
        status: base.status === "running" ? "idle" : base.status,
        runs: normalizedRuns,
        activeRunId: nextActiveRunId,
        message: typeof base.message === "string" ? base.message : null,
        error: typeof base.error === "string" ? base.error : null,
        errorDetails: typeof (base as any).errorDetails === "string" ? (base as any).errorDetails : null,
        refinementNote: typeof base.refinementNote === "string" ? base.refinementNote : null,
        runStartedAt: null,
        createdAt: Number(base.createdAt) || Date.now(),
        updatedAt: Number(base.updatedAt) || Date.now(),
        lastContextSignature: typeof base.lastContextSignature === "string" ? base.lastContextSignature : null,
        generatedForContextSignature:
          typeof base.generatedForContextSignature === "string" ? base.generatedForContextSignature : null,
        lastGeneratedAnsweredCount:
          typeof base.lastGeneratedAnsweredCount === "number" && Number.isFinite(base.lastGeneratedAnsweredCount)
            ? base.lastGeneratedAnsweredCount
            : normalizedRuns.at(-1)?.answeredQuestionCount ?? null,
      };
      return next;
    }

    if ((parsed as any).schemaVersion === 2) {
      const v2 = parsed as PreviewCacheV2;
      const imgs = Array.isArray(v2.images)
        ? v2.images.filter(isValidUrlLikeImage).filter((src: string) => !isPlaceholderPreviewImage(src))
        : [];
      const run: PreviewRun | null =
        imgs.length > 0 && typeof v2.generatedForContextSignature === "string" && v2.generatedForContextSignature
          ? {
              id: newRunId(),
              createdAt: Number(v2.createdAt) || Date.now(),
              contextSignature: v2.generatedForContextSignature,
              answeredQuestionCount: null,
              images: imgs,
              message: typeof v2.message === "string" ? v2.message : null,
            }
          : null;
      return {
        schemaVersion: 3,
        status: v2.status === "running" ? "idle" : v2.status,
        runs: run ? [run] : [],
        activeRunId: run ? run.id : null,
        message: typeof v2.message === "string" ? v2.message : null,
        error: typeof v2.error === "string" ? v2.error : null,
        errorDetails: null,
        refinementNote: typeof v2.refinementNote === "string" ? v2.refinementNote : null,
        runStartedAt: null,
        createdAt: Number(v2.createdAt) || Date.now(),
        updatedAt: Date.now(),
        lastContextSignature: typeof v2.lastContextSignature === "string" ? v2.lastContextSignature : null,
        generatedForContextSignature:
          typeof v2.generatedForContextSignature === "string" ? v2.generatedForContextSignature : null,
        lastGeneratedAnsweredCount: null,
      };
    }

    if ((parsed as any).schemaVersion === 1) {
      // Migrate v1 → v3, but keep no images (v1 may contain placeholders).
      return {
        schemaVersion: 3,
        status: "idle",
        runs: [],
        activeRunId: null,
        message: null,
        error: null,
        errorDetails: null,
        refinementNote: (parsed as any)?.refinementNote ?? null,
        runStartedAt: null,
        createdAt: Number((parsed as any)?.createdAt) || Date.now(),
        updatedAt: Date.now(),
        lastContextSignature: null,
        generatedForContextSignature: null,
        lastGeneratedAnsweredCount: null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveCache(instanceId: string, sessionId: string, cache: PreviewCacheV3) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyV3(instanceId, sessionId), JSON.stringify(cache));
  } catch {}
}

function loadUploadedImages(instanceId: string, sessionId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKeyUploads(instanceId, sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidUrlLikeImage).slice(0, 6);
  } catch {
    return [];
  }
}

function saveUploadedImages(instanceId: string, sessionId: string, images: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyUploads(instanceId, sessionId), JSON.stringify(images.filter(isValidUrlLikeImage).slice(0, 6)));
  } catch {}
}

export function ImagePreviewExperience(props: {
  instanceId: string;
  sessionId: string;
  useCase?: string;
  contextState?: any;
  /** If false, never gate preview actions behind lead capture. Defaults to true. */
  leadGateEnabled?: boolean;
  /** When true, removes the card/surface background behind the preview. */
  transparentChrome?: boolean;
  /** Fires when a real preview image becomes available (hero exists). */
  onHasImageChange?: (hasImage: boolean) => void;
  config?: {
    businessContext?: string;
    industry?: string;
    useCase?: string;
    previewPricing?: { totalMin: number; totalMax: number; currency?: string; randomizePct?: number };
  };
  stepDataSoFar: Record<string, any>;
  answeredQuestionCount?: number;
  autoRegenerateEveryNAnsweredQuestions?: number;
  enabled: boolean;
  onPreviewVisibleChange?: (visible: boolean) => void;
  variant?: "hero" | "rail" | "tiny";
  previewMaxVh?: number;
  previewMaxPx?: number;
  previewMaxVw?: number;
  previewChromePx?: number;
  /** When true, hides the "Upload your own image" overlay button on the preview image. */
  suppressUploadOverlay?: boolean;
  /** When true, hides the budget slider overlay (e.g. when preview is in dominant/large mode). */
  hideBudgetInOverlay?: boolean;
}) {
  const { theme } = useFormTheme();
  const {
    instanceId,
    sessionId,
    contextState,
    enabled,
    leadGateEnabled = true,
    transparentChrome = false,
    onHasImageChange,
    stepDataSoFar,
    answeredQuestionCount = 0,
    autoRegenerateEveryNAnsweredQuestions = 2,
    config,
    onPreviewVisibleChange,
    variant = "hero",
    previewMaxVh,
    previewMaxPx,
    previewMaxVw,
    previewChromePx,
    suppressUploadOverlay = false,
    hideBudgetInOverlay = false,
  } = props;

  const initialCache = useMemo(() => loadCache(instanceId, sessionId), [instanceId, sessionId]);
  const [cache, setCache] = useState<PreviewCacheV3 | null>(initialCache);
  const inFlightRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingOwnImages, setIsUploadingOwnImages] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>(() => loadUploadedImages(instanceId, sessionId));

  const sceneUploadUrl = useMemo(() => {
    const sceneUploadStepIds = ["step-upload-scene-image", "step-refinement-upload-scene-image"] as const;
    for (const stepId of sceneUploadStepIds) {
      const raw = (stepDataSoFar as any)?.[stepId];
      const arr = Array.isArray(raw) ? raw : (typeof raw === "string" && raw ? [raw] : []);
      const hit = arr.find(isValidUrlLikeImage);
      if (hit) return hit;
    }
    return null;
  }, [stepDataSoFar]);
  const userUploadUrl = useMemo(() => {
    const raw = (stepDataSoFar as any)?.["step-upload-user-image"];
    const arr = Array.isArray(raw) ? raw : (typeof raw === "string" && raw ? [raw] : []);
    return arr.find(isValidUrlLikeImage) ?? null;
  }, [stepDataSoFar]);
  // Image uploaded through the form's dedicated upload step — shown as a static thumbnail.
  const formStepUploadThumbnail = sceneUploadUrl ?? userUploadUrl ?? null;
  const [leadCaptured, setLeadCaptured] = useState<boolean>(() => loadLeadState(sessionId).leadCaptured);
  const [showCenteredPricingForm, setShowCenteredPricingForm] = useState(false);
  const [centeredPricingStep, setCenteredPricingStep] = useState<"email" | "name" | "phone">("email");
  const [centeredPricingEmail, setCenteredPricingEmail] = useState<string>(() => loadLeadState(sessionId).leadEmail || "");
  const [centeredPricingName, setCenteredPricingName] = useState<string>(() => {
    const snap = loadFormStateSnapshot(sessionId);
    return typeof (snap as any)?.userFullName === "string" ? String((snap as any).userFullName).trim() : "";
  });
  const [centeredPricingPhone, setCenteredPricingPhone] = useState<string>(() => {
    const prefillPhone = loadLeadState(sessionId).leadPhone || "";
    return formatPhoneInput(prefillPhone).display;
  });
  const [centeredPricingError, setCenteredPricingError] = useState<string | null>(null);
  const { submitForm: submitCenteredPricingLead, isSubmitting: isSubmittingCenteredPricingLead } = useFormSubmission({
    instanceId,
    sessionId,
  });
  const devMode = useMemo(() => isDevModeEnabled(), []);
  const debugSessionRef = useRef<string | null>(null);
  const debugLeadCapturedRef = useRef<boolean | null>(null);
  const [showUploadGate, setShowUploadGate] = useState(false);
  const [showDownloadGate, setShowDownloadGate] = useState(false);
  const [showGenerateGate, setShowGenerateGate] = useState(false);
  const [loaderElapsedSec, setLoaderElapsedSec] = useState(0);
  const pendingActionRef = useRef<null | "refresh" | "upload" | "download">(null);
  const pendingGenerateModeRef = useRef<"manual" | "auto">("manual");
  const gateContextRef = useRef<string>("design_and_estimate");
  const promptSubmitNonceRef = useRef<number>(0);
  const promptSubmitNonceInitializedRef = useRef(false);
  const previewRefreshNonceRef = useRef<number>(0);
  const pendingManualGenerateRef = useRef(false);
  const pendingBudgetRefineRef = useRef(false);
  const prevBudgetForPricingRef = useRef<number | null>(null);
  const prevRunsLengthRef = useRef(0);
  const fetchAccuratePricingRef = useRef<(() => Promise<void>) | null>(null);
  const [accuratePricing, setAccuratePricing] = useState<null | {
    totalMin: number;
    totalMax: number;
    currency: string;
    /** Image-specific price range (for this design). Used for budget slider bounds. */
    imagePriceRange?: { low: number; high: number };
    /** Typical service price range (e.g. Landscape $5k–$175k). For validation/display. */
    servicePriceRange?: { low: number; high: number };
  }>(null);
  const [accuratePricingStatus, setAccuratePricingStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [liveBudget, setLiveBudget] = useState<number | null>(() => extractBudgetValue(stepDataSoFar || {}));
  const [liveBudgetDirty, setLiveBudgetDirty] = useState(false);

  useEffect(() => {
    setUploadedImages(loadUploadedImages(instanceId, sessionId));
  }, [instanceId, sessionId]);

  useEffect(() => {
    const lead = loadLeadState(sessionId);
    const snap = loadFormStateSnapshot(sessionId);
    setLeadCaptured(lead.leadCaptured);
    setCenteredPricingEmail(lead.leadEmail || "");
    setCenteredPricingName(typeof (snap as any)?.userFullName === "string" ? String((snap as any).userFullName).trim() : "");
    setCenteredPricingPhone(formatPhoneInput(lead.leadPhone || "").display);
    setCenteredPricingStep("email");
    setCenteredPricingError(null);
    setShowCenteredPricingForm(false);
  }, [sessionId]);

  useEffect(() => {
    if (!devMode) return;
    if (!sessionId || debugSessionRef.current === sessionId) return;
    debugSessionRef.current = sessionId;
    try {
      const parsed = loadFormStateSnapshot(sessionId);
      console.log("[ImagePreviewExperience] lead state (session)", {
        instanceId,
        sessionId,
        leadGateEnabled,
        leadCaptured: loadLeadState(sessionId).leadCaptured,
        formState: parsed
          ? {
              leadCaptured: (parsed as any)?.leadCaptured,
              leadEmail: (parsed as any)?.leadEmail,
              leadCapturedAt: (parsed as any)?.leadCapturedAt,
              leadGates: (parsed as any)?.leadGates ? Object.keys((parsed as any).leadGates) : null,
              storageKey: formStateStorageKey(sessionId),
            }
          : null,
      });
    } catch {}
  }, [devMode, instanceId, leadGateEnabled, sessionId]);

  useEffect(() => {
    if (!devMode) return;
    if (debugLeadCapturedRef.current === leadCaptured) return;
    debugLeadCapturedRef.current = leadCaptured;
    try {
      console.log("[ImagePreviewExperience] leadCaptured changed", { instanceId, sessionId, leadCaptured });
    } catch {}
  }, [devMode, instanceId, leadCaptured, sessionId]);

  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const detail = (e as any)?.detail;
        if (!detail || detail.sessionId !== sessionId) return;
        setLeadCaptured(loadLeadState(sessionId).leadCaptured);
      } catch {}
    };
    window.addEventListener("sif_form_state_updated", handler as any);
    return () => window.removeEventListener("sif_form_state_updated", handler as any);
  }, [sessionId]);

  useEffect(() => {
    const next = extractBudgetValue(stepDataSoFar || {});
    if (next !== null) setLiveBudget(next);
  }, [stepDataSoFar]);

  const handleCenteredPricingEmailSubmit = useCallback(async () => {
    setCenteredPricingError(null);
    const email = centeredPricingEmail.trim();
    if (!isValidEmail(email)) {
      setCenteredPricingError("Please enter a valid email address.");
      return;
    }
    setCenteredPricingStep("name");
  }, [centeredPricingEmail]);

  const handleCenteredPricingNameSubmit = useCallback(async () => {
    setCenteredPricingError(null);
    const name = centeredPricingName.trim();
    if (!isValidFullName(name)) {
      setCenteredPricingError("Please enter your name.");
      return;
    }
    if (sessionId) upsertFormStateSnapshot(sessionId, { userFullName: name });
    setCenteredPricingStep("phone");
  }, [centeredPricingName, sessionId]);

  const handleCenteredPricingPhoneSubmit = useCallback(async () => {
    setCenteredPricingError(null);
    const email = centeredPricingEmail.trim();
    const name = centeredPricingName.trim();
    const { display: formattedPhone, digits } = formatPhoneInput(centeredPricingPhone);

    if (!isValidEmail(email)) {
      setCenteredPricingStep("email");
      setCenteredPricingError("Please enter a valid email address.");
      return;
    }
    if (!isValidFullName(name)) {
      setCenteredPricingStep("name");
      setCenteredPricingError("Please enter your name.");
      return;
    }
    if (digits.length < 10) {
      setCenteredPricingError("Enter a valid phone number.");
      return;
    }

    const result = await submitCenteredPricingLead({
      email,
      name,
      phone: formattedPhone,
      isPartial: false,
      submissionData: { gateContext: "design_and_estimate", surface: "inline_pricing", step: "phone" },
    });

    if (!result.success) {
      setCenteredPricingError(result.message || "Couldn’t submit. Try again.");
      return;
    }

    if (sessionId) upsertFormStateSnapshot(sessionId, { userFullName: name });
    upsertLeadState(sessionId, {
      leadCaptured: true,
      leadEmail: email,
      leadPhone: formattedPhone,
      leadCapturedAt: Date.now(),
    });
    upsertLeadGate(sessionId, "design_and_estimate", { completedAt: Date.now() });
    setAccuratePricingStatus("running");
    setLeadCaptured(true);
    setShowCenteredPricingForm(false);
    setCenteredPricingStep("email");
    void fetchAccuratePricingRef.current?.();
  }, [centeredPricingEmail, centeredPricingName, centeredPricingPhone, sessionId, submitCenteredPricingLead]);

  const effectiveStepDataSoFar = useMemo(() => {
    const base = { ...(stepDataSoFar || {}) };
    if (liveBudget !== null && Number.isFinite(liveBudget) && liveBudget > 0) {
      base["step-budget-range"] = Math.round(liveBudget);
      base["budget_range"] = Math.round(liveBudget);
      base["budgetRange"] = Math.round(liveBudget);
    }
    return base;
  }, [liveBudget, stepDataSoFar]);

  const contextSignature = useMemo(() => computeContextSignature(effectiveStepDataSoFar), [effectiveStepDataSoFar]);
  const runs = cache?.runs ?? [];
  const activeRunId = cache?.activeRunId ?? null;
  const activeRun = useMemo(() => {
    if (!runs.length) return null;
    if (activeRunId) {
      const found = runs.find((r) => r.id === activeRunId);
      if (found) return found;
    }
    return runs.at(-1) ?? null;
  }, [activeRunId, runs]);
  const activeIndex = useMemo(() => {
    if (!runs.length) return 0;
    const idx = activeRunId ? runs.findIndex((r) => r.id === activeRunId) : -1;
    return idx >= 0 ? idx : Math.max(0, runs.length - 1);
  }, [activeRunId, runs]);

  // Persist "context updated" info, but do NOT auto-regenerate.
  useEffect(() => {
    if (!enabled) return;
    setCache((prev) => {
      const next: PreviewCacheV3 = prev
        ? { ...prev }
        : {
            schemaVersion: 3,
            status: "idle",
            runs: [],
            activeRunId: null,
            message: null,
            error: null,
            errorDetails: null,
            refinementNote: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastContextSignature: null,
            generatedForContextSignature: null,
            lastGeneratedAnsweredCount: null,
          };
      if (next.lastContextSignature !== contextSignature) {
        next.lastContextSignature = contextSignature;
        next.updatedAt = Date.now();
        saveCache(instanceId, sessionId, next);
      }
      return next;
    });
  }, [contextSignature, enabled, instanceId, sessionId]);

  const runGenerate = useCallback(
    async (reason: "auto" | "manual") => {
      if (!enabled) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      let responseErrorDetails: string | null = null;

      const normalizeUseCase = (raw?: unknown): "tryon" | "scene-placement" | "scene" => {
        const v = String(raw || "")
          .trim()
          .toLowerCase()
          .replace(/_/g, "-")
          .replace(/\s+/g, "-");
        if (v === "tryon" || v === "try-on") return "tryon";
        if (v === "scene-placement") return "scene-placement";
        if (v === "scene") return "scene";
        return "scene";
      };

      const signatureAtStart = computeContextSignature(effectiveStepDataSoFar || {});
      const latestRun = runs.length ? runs.at(-1) ?? null : null;
      const baseReferenceImage = latestRun?.images?.[0] ?? null;
      const normalizeUploadToStrings = (raw: any): string[] => {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
        if (typeof raw === "string") return [raw];
        return [];
      };
      const stepSceneUpload = (
        ["step-upload-scene-image", "step-refinement-upload-scene-image"] as const
      )
        .map((stepId) => normalizeUploadToStrings((effectiveStepDataSoFar as any)?.[stepId]).filter(isValidUrlLikeImage)[0] ?? null)
        .find(Boolean) ?? null;
      const stepUserUpload =
        normalizeUploadToStrings((effectiveStepDataSoFar as any)?.["step-upload-user-image"]).filter(isValidUrlLikeImage)[0] ?? null;
      const stepProductUpload =
        normalizeUploadToStrings((effectiveStepDataSoFar as any)?.["step-upload-product-image"]).filter(isValidUrlLikeImage)[0] ?? null;
	      const storedUploads = Array.from(
	        new Set([
	          ...(stepSceneUpload ? [stepSceneUpload] : []),
	          ...(stepUserUpload ? [stepUserUpload] : []),
	          ...(stepProductUpload ? [stepProductUpload] : []),
	          ...uploadedImages,
	        ])
	      )
	        .filter(isValidUrlLikeImage)
	        .slice(0, 6);

      const selectedOptionReferenceImages = (() => {
        try {
          const stepsForRefs = typeof window !== "undefined" ? loadStepState(instanceId)?.steps ?? [] : [];
          const urls: string[] = [];
          for (const step of stepsForRefs) {
            if (!step || typeof step !== "object") continue;
            const id = String((step as any)?.id || "");
            if (!id) continue;
            const answer = (effectiveStepDataSoFar as any)?.[id];
            if (answer === null || answer === undefined) continue;
            const options = Array.isArray((step as any)?.options) ? ((step as any).options as any[]) : [];
            if (options.length === 0) continue;
            const wanted = Array.isArray(answer) ? answer.map(String) : [String(answer)];
            for (const w of wanted) {
              const opt = options.find((o: any) => {
                if (!o || typeof o !== "object") return false;
                const v = typeof o.value === "string" ? o.value : null;
                const l = typeof o.label === "string" ? o.label : null;
                return (v && v === w) || (l && l === w);
              });
              const img = opt && typeof opt.imageUrl === "string" ? opt.imageUrl : null;
              if (img && isValidUrlLikeImage(img)) urls.push(img);
            }
          }
          return Array.from(new Set(urls)).slice(0, 3);
        } catch {
          return [] as string[];
        }
      })();

      const hasExistingPreview = Boolean(baseReferenceImage);
      const isBudgetDrivenRegeneration = Boolean(pendingBudgetRefineRef.current);
      const generationSignatureAtStart = safeJsonStringify({
        contextSignature: signatureAtStart,
        uploads: storedUploads,
        selectionRefs: selectedOptionReferenceImages,
      });
      // Explicit scene uploads always become the active anchor from this point on.
      const activeAnchorImage = (stepSceneUpload || baseReferenceImage || storedUploads?.[0] || null) as string | null;
      // For budget-driven regeneration, prefer the user's originally uploaded scene anchor
      // instead of the latest generated preview image.
      const originalUploadedAnchorImage = (stepSceneUpload || stepUserUpload || storedUploads?.[0] || null) as string | null;
      const runAnchorImage =
        isBudgetDrivenRegeneration
          ? (originalUploadedAnchorImage || activeAnchorImage)
          : activeAnchorImage;
      // First preview uses uploaded anchors. After the first generated preview exists,
      // treat prompt/guided edits as refinements anchored to the active anchor image.
      const primaryReferenceImage = runAnchorImage;
      const referenceImagesForRequest = (
        hasExistingPreview
          ? [
              ...(runAnchorImage ? [runAnchorImage] : []),
              ...storedUploads.filter((u) => u && u !== runAnchorImage),
              ...selectedOptionReferenceImages.filter((u) => u && u !== runAnchorImage),
            ]
          : [
              ...(primaryReferenceImage ? [primaryReferenceImage] : []),
              ...storedUploads.filter((u) => u && u !== primaryReferenceImage),
              // Only include selection images once the user has uploaded something.
              ...(storedUploads.length > 0 ? selectedOptionReferenceImages : []),
            ]
      )
        .filter(isValidUrlLikeImage)
        .slice(0, 6);
      const useCase = normalizeUseCase((config as any)?.useCase);
      // After first image exists, use scene-placement inpaint for refinements/budget changes.
      const canUseScenePlacementForRefinement =
        hasExistingPreview &&
        (useCase === "scene" || useCase === "scene-placement") &&
        (runAnchorImage || stepSceneUpload || primaryReferenceImage);
      const effectiveUseCase = canUseScenePlacementForRefinement ? "scene-placement" : useCase;
      // For refinements: use latest image as base. scene-placement + hasExistingPreview = drilldown edit.
      const sceneImageForRequest =
        useCase === "scene" && runAnchorImage
          ? runAnchorImage
          : useCase === "scene" && stepSceneUpload
            ? stepSceneUpload
            : useCase === "scene" && primaryReferenceImage
              ? primaryReferenceImage
              : (useCase === "scene-placement" && runAnchorImage)
                ? runAnchorImage
                : useCase === "scene-placement" && stepSceneUpload
                  ? stepSceneUpload
                  : useCase === "scene-placement" && primaryReferenceImage
                    ? primaryReferenceImage
                    : undefined;
      const lastGeneratedSignature = latestRun?.contextSignature ?? cache?.generatedForContextSignature ?? null;
      if (
        reason === "auto" &&
        generationSignatureAtStart &&
        lastGeneratedSignature &&
        generationSignatureAtStart === lastGeneratedSignature &&
        runs.length > 0
      ) {
        inFlightRef.current = false;
        return;
      }

      const runId = newRunId();
      setCache((prev) => {
        const base: PreviewCacheV3 =
          prev ??
          ({
            schemaVersion: 3,
            status: "idle",
            runs: [],
            activeRunId: null,
            message: null,
            error: null,
            errorDetails: null,
            refinementNote: null,
            runStartedAt: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastContextSignature: signatureAtStart,
            generatedForContextSignature: null,
            lastGeneratedAnsweredCount: null,
          } satisfies PreviewCacheV3);
        const next: PreviewCacheV3 = {
          ...base,
          status: "running",
          error: null,
          errorDetails: null,
          generatedForContextSignature: null,
          lastContextSignature: signatureAtStart,
          message:
            reason === "auto"
              ? runs.length
                ? "Fine-tuning your design + pricing…"
                : "Generating your design + pricing for you…"
              : "Refreshing your design + pricing…",
          runStartedAt: Date.now(),
          updatedAt: Date.now(),
        };
        saveCache(instanceId, sessionId, next);
        return next;
      });

	      try {
	        const stepsForQA = typeof window !== "undefined" ? loadStepState(instanceId)?.steps ?? [] : [];
	        const answeredQA = buildAnsweredQAFromSteps(stepsForQA, effectiveStepDataSoFar || {}, 60);
	        const formCtx = loadFormStateContext(sessionId);
	        const serviceIdRaw =
	          (effectiveStepDataSoFar as any)?.["step-service-primary"] ??
	          (effectiveStepDataSoFar as any)?.["step-service"] ??
	          (effectiveStepDataSoFar as any)?.["step_service_primary"] ??
	          (effectiveStepDataSoFar as any)?.["step_service"];
	        const selectedServiceId = Array.isArray(serviceIdRaw) ? String(serviceIdRaw[0] || "") : String(serviceIdRaw || "");
	        const perServiceSummary =
	          selectedServiceId
	            ? (() => {
	                const cat = loadServiceCatalog(sessionId);
	                const meta: any = cat?.byServiceId?.[selectedServiceId];
	                return typeof meta?.serviceSummary === "string" ? meta.serviceSummary : null;
	              })()
	            : null;
	        const combinedServiceSummary =
	          [formCtx.serviceSummary, perServiceSummary].filter((s) => typeof s === "string" && String(s).trim()).join("\n\n") || null;
		      const instanceContext = {
		          businessContext: (config as any)?.businessContext ?? formCtx.businessContext,
		          serviceSummary: combinedServiceSummary,
		        };

		        const ensureUrlLikeImage = async (src: string): Promise<string> => {
		          if (!src || typeof src !== "string") return src;
		          if (!src.startsWith("data:")) return absolutizeImageUrl(src);
		          try {
		            const uploadRes = await fetch("/api/upload-reference-image", {
		              method: "POST",
		              headers: { "Content-Type": "application/json" },
		              body: JSON.stringify({ instanceId, image: src }),
		            });
		            if (uploadRes.ok) {
		              const data = await uploadRes.json().catch(() => ({}));
		              if (data?.url && typeof data.url === "string" && isValidUrlLikeImage(data.url)) {
                    return absolutizeImageUrl(data.url);
                  }
		            }
		          } catch {}
		          return src;
		        };

		        const normalizedUseCase = effectiveUseCase;
		        const promptResult =
		          contextState && typeof contextState === "object"
		            ? await buildImagePromptViaDSPy({
		                contextState,
		                useCase: normalizedUseCase,
		                industry: config?.industry ?? null,
		                businessContext: instanceContext.businessContext ?? null,
		                service: null,
		                stepDataSoFar: effectiveStepDataSoFar,
                    instanceId,
                    sessionId,
                    referenceImages: referenceImagesForRequest,
                    answeredQA,
                    instanceContext,
		              })
		            : null;

		        const promptFromBuilder = typeof promptResult?.prompt === "string" ? promptResult.prompt.trim() : "";
		        const negativePrompt =
		          typeof promptResult?.negativePrompt === "string" && promptResult.negativePrompt.trim()
		            ? promptResult.negativePrompt.trim()
		            : undefined;

		        const promptFallback = (() => {
		          const isUuidLike = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s?.trim?.() || "");
		          const isUrlLike = (s: string) => /^https?:\/\//i.test(s?.trim?.() || "");
		          const isInternalKey = (q: string) => {
		            const low = (q || "").toLowerCase();
		            return low.includes("pricing") || low.startsWith("wait") || low.includes("collect_context");
		          };
		          const cleanValue = (raw: any): string => {
		            if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string" && x && !isUuidLike(x) && !isUrlLike(x)).join(", ");
		            if (typeof raw === "string" && raw && !isUuidLike(raw) && !isUrlLike(raw)) return raw;
		            return "";
		          };
		          const prefs = answeredQA
		            .slice(0, 15)
		            .map((qa: any) => {
		              const q = typeof qa?.question === "string" ? qa.question : String(qa?.stepId || "Preference");
		              if (isInternalKey(q)) return null;
		              const aText = cleanValue(qa?.answer);
		              return aText ? `- ${q}: ${aText}` : null;
		            })
		            .filter(Boolean)
		            .join("\n");

		          const hasUploadedImage = !!(sceneImageForRequest || storedUploads.length > 0);
		          const serviceName = (() => {
		            const raw = instanceContext.serviceSummary || "";
		            const m = raw.match(/^(.{3,80}?)\s+is\s+(?:an?\s+)?service\b/i);
		            return m ? m[1].trim() : "home improvement";
		          })();

		          let header: string;
			          if (hasUploadedImage) {
			            header = normalizedUseCase === "tryon"
			              ? "Create a photorealistic try-on preview showing the product on the person."
			              : normalizedUseCase === "scene-placement"
			                ? (stepProductUpload
			                    ? `Seamlessly place the product into this scene for a ${serviceName} project.`
			                    : `Edit this uploaded scene in place for a ${serviceName} project while preserving camera angle, layout, and perspective.`)
			                : `Redesign this space to show a completed ${serviceName} project. Keep the room layout, walls, windows, and camera angle. Transform the finishes, fixtures, and materials to match these preferences:`;
			          } else {
		            header = normalizedUseCase === "tryon"
		              ? "Photorealistic try-on preview."
		              : normalizedUseCase === "scene-placement"
		                ? "Photorealistic scene placement preview."
		                : `A photorealistic image of a beautifully completed ${serviceName} project.`;
		          }

		          return [header, prefs ? `${hasUploadedImage ? "Design preferences" : "Preferences"}:\n${prefs}` : null, "Photorealistic, high quality, realistic materials and natural lighting.", "No text, no logos, no watermarks, no annotations."]
		            .filter((s) => typeof s === "string" && String(s).trim())
		            .join("\n\n");
		        })();

		        const prompt = promptFromBuilder || promptFallback;

		        const userImage = stepUserUpload ? await ensureUrlLikeImage(stepUserUpload) : null;
			        const productImageRaw = stepProductUpload || null;
			        const productImage = productImageRaw ? await ensureUrlLikeImage(productImageRaw) : null;
			        const sceneImage =
			          sceneImageForRequest && typeof sceneImageForRequest === "string" ? await ensureUrlLikeImage(sceneImageForRequest) : null;

	            // For scene edits, avoid injecting option-card style references into generation.
	            // Keep the edit tightly anchored to the user's scene image.
	            const scenePlacementInpaintMode = normalizedUseCase === "scene-placement" && !productImage;
	            const refsForGeneration =
	              normalizedUseCase === "scene" || scenePlacementInpaintMode
	                ? [sceneImage || sceneImageForRequest].filter(isValidUrlLikeImage)
	                : referenceImagesForRequest;
		        const ensuredRefs = await Promise.all(refsForGeneration.map((u) => ensureUrlLikeImage(u)));
		        const uniqueRefs = Array.from(new Set(ensuredRefs.filter(isValidUrlLikeImage))).slice(0, 6);

		        const endpoint = "/api/generate";
		        const budgetForRequest = extractBudgetValue(effectiveStepDataSoFar || {});
            const promptWithBudgetConstraint =
              budgetForRequest !== null && isBudgetDrivenRegeneration
                ? `${prompt}\n\nBudget target: about $${Math.round(budgetForRequest).toLocaleString()}. Keep the same overall style and layout, but visibly adjust materials, finishes, fixtures, and scope to fit this budget level.`
                : prompt;
		        const requestBody: any = {
		          prompt: promptWithBudgetConstraint,
		          instanceId,
		          numOutputs: 1,
		          useCase: normalizedUseCase,
              generationIntent: isBudgetDrivenRegeneration ? "regenerate" : hasExistingPreview ? "small_improvement" : "initial",
		        };
		        if (budgetForRequest !== null) requestBody.budgetRange = budgetForRequest;
		        if (negativePrompt) requestBody.negativePrompt = negativePrompt;

		        const modelRec = typeof (promptResult as any)?.modelRecommendation === "object" ? (promptResult as any).modelRecommendation : null;
		        if (modelRec) requestBody.modelRecommendation = modelRec;

			        if (normalizedUseCase === "tryon") {
			          if (!userImage || !productImage) {
			            throw new Error("Please upload both a person photo and a product photo to generate a try-on preview.");
			          }
			          requestBody.userImage = userImage;
			          requestBody.productImage = productImage;
			          requestBody.referenceImages = Array.from(new Set([userImage, productImage, ...uniqueRefs])).slice(0, 6);
			        } else if (normalizedUseCase === "scene-placement") {
			          if (!sceneImage) {
			            throw new Error("Please upload a scene photo to generate a placement/inpaint preview.");
			          }
			          requestBody.sceneImage = sceneImage;
			          if (productImage) requestBody.productImage = productImage;
			          requestBody.referenceImages = Array.from(new Set([sceneImage, ...(productImage ? [productImage] : []), ...uniqueRefs])).slice(0, 6);
			        } else {
		          if (sceneImage) requestBody.sceneImage = sceneImage;
		          if (uniqueRefs.length > 0) requestBody.referenceImages = uniqueRefs.slice(0, 6);
		        }

		        const res = await fetch(endpoint, {
		          method: "POST",
		          headers: { "Content-Type": "application/json", Accept: "application/json" },
		          cache: "no-store",
		          body: JSON.stringify(requestBody),
		        });
		        const json = await res.json().catch(() => ({}));
		        if (!res.ok) {
		          const errorMessage =
	            res.status === 413
	              ? "That photo is too large to process. Try a smaller image (or retake the photo)."
	              : typeof (json as any)?.error === "string"
	                ? (json as any).error
	                : `Failed (${res.status})`;
	          const detailsRaw = (json as any)?.details;
	          const normalizedDetails =
	            typeof detailsRaw === "string"
	              ? detailsRaw
	              : detailsRaw && typeof detailsRaw === "object"
	                ? safeJsonStringify(detailsRaw)
	                : null;
          responseErrorDetails = normalizedDetails ? normalizedDetails.slice(0, 800) : null;
          const err = new Error(errorMessage) as Error & { details?: string | null };
          err.details = responseErrorDetails;
          throw err;
        }

        const imgs = Array.isArray((json as any)?.images) ? (json as any).images.filter((x: any) => typeof x === "string" && x) : [];
        const msg = typeof (json as any)?.message === "string" ? String((json as any).message) : null;
        if (imgs.length === 0) {
          throw new Error("Preview generated, but no images were returned.");
        }

        const normalizedImages = imgs.filter(isValidUrlLikeImage).filter((src: string) => !isPlaceholderPreviewImage(src));
        if (normalizedImages.length === 0) {
          throw new Error("Preview generated, but only a placeholder image was returned.");
        }

        setCache((prev) => {
          const base = prev ?? loadCache(instanceId, sessionId);
          const nextRuns = Array.isArray(base?.runs) ? [...base!.runs] : [];
          const run: PreviewRun = {
            id: runId,
            createdAt: Date.now(),
            contextSignature: generationSignatureAtStart,
            answeredQuestionCount: Number.isFinite(answeredQuestionCount) ? answeredQuestionCount : null,
            images: normalizedImages,
            message: msg,
          };
          nextRuns.push(run);

          const next: PreviewCacheV3 = {
            schemaVersion: 3,
            status: "complete",
            runs: nextRuns,
            activeRunId: runId,
            message: msg,
            error: null,
            errorDetails: null,
            refinementNote: base?.refinementNote ?? null,
            runStartedAt: null,
            createdAt: base?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
            lastContextSignature: signatureAtStart,
            generatedForContextSignature: generationSignatureAtStart,
            lastGeneratedAnsweredCount: Number.isFinite(answeredQuestionCount) ? answeredQuestionCount : base?.lastGeneratedAnsweredCount ?? null,
          };
          saveCache(instanceId, sessionId, next);
          return next;
        });
      } catch (e) {
        pendingBudgetRefineRef.current = false;
        const message = e instanceof Error ? e.message : "Failed to generate preview.";
        const details =
          e && typeof e === "object" && "details" in e && typeof (e as any).details === "string"
            ? String((e as any).details)
            : responseErrorDetails;
        setCache((prev) => {
          const base: PreviewCacheV3 =
            prev ??
            ({
              schemaVersion: 3,
              status: "idle",
              runs: [],
              activeRunId: null,
              message: null,
              error: null,
              errorDetails: null,
              refinementNote: null,
              runStartedAt: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              lastContextSignature: signatureAtStart,
              generatedForContextSignature: null,
              lastGeneratedAnsweredCount: null,
            } satisfies PreviewCacheV3);
          const next: PreviewCacheV3 = {
            ...base,
            status: "error",
            error: message,
            errorDetails: details || null,
            runStartedAt: null,
            updatedAt: Date.now(),
            lastContextSignature: signatureAtStart,
            generatedForContextSignature: null,
          };
          saveCache(instanceId, sessionId, next);
          return next;
        });
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      answeredQuestionCount,
      cache?.generatedForContextSignature,
      cache?.refinementNote,
      config,
      enabled,
      instanceId,
	      runs,
	      sessionId,
	      effectiveStepDataSoFar,
	      contextState,
	    ]
	  );

  const requestManualGenerate = useCallback(() => {
    if (!enabled) return;
    if (inFlightRef.current || cache?.status === "running") {
      pendingManualGenerateRef.current = true;
      return;
    }
    void runGenerate("manual");
  }, [cache?.status, enabled, runGenerate]);

  const readFileAsDataURL = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(String(e.target?.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image"));
      reader.readAsDataURL(file);
    });

  const uploadReferenceImage = useCallback(
    async (dataUrl: string): Promise<string> => {
      if (!dataUrl) return dataUrl;
      try {
        const res = await fetch("/api/upload-reference-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId, image: dataUrl }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data?.url) return absolutizeImageUrl(String(data.url));
        }
      } catch {}
      return dataUrl;
    },
    [instanceId]
  );

  const handleOwnImageUpload = useCallback(
    async (files: File[]) => {
      const existing = loadUploadedImages(instanceId, sessionId);
      const remaining = Math.max(0, 6 - existing.length);
      const toProcess = files
        .filter((f) => f && typeof f.type === "string" && f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024)
        .slice(0, remaining);
      if (toProcess.length === 0) return;

      setIsUploadingOwnImages(true);
      try {
        const added: string[] = [];
        for (const file of toProcess) {
          const dataUrl = await readFileAsDataURL(file);
          const url = await uploadReferenceImage(dataUrl);
          if (isValidUrlLikeImage(url)) added.push(url);
        }
        if (added.length) {
          const next = Array.from(new Set([...added, ...existing])).slice(0, 6);
          saveUploadedImages(instanceId, sessionId, next);
          setUploadedImages(next);
        }
      } finally {
        setIsUploadingOwnImages(false);
      }

      requestManualGenerate();
    },
    [instanceId, requestManualGenerate, sessionId, uploadReferenceImage]
  );

  // Auto-generate the first preview once enabled (if no runs yet).
  useEffect(() => {
    if (!enabled) return;
    if ((cache?.runs?.length || 0) > 0) return;
    if (cache?.status === "running") return;
    // Prevent an infinite retry loop if the first attempt fails (e.g., 404/502).
    // Users can manually retry via the UI.
    if (cache?.status === "error") return;
    void runGenerate("auto");
  }, [cache?.runs?.length, cache?.status, enabled, runGenerate]);

  const hero = activeRun?.images?.[0] ?? null;
  const isPlaceholderHero = useMemo(() => (hero ? isPlaceholderPreviewImage(hero) : false), [hero]);
  const lightboxLayoutId = `image-preview:${instanceId}:${sessionId}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxContain, setLightboxContain] = useState(false);
  const previousActiveRunRef = useRef<{ runId: string | null; index: number; runsLength: number; hero: string | null }>({
    runId: null,
    index: 0,
    runsLength: 0,
    hero: null,
  });
  const [navigationTransition, setNavigationTransition] = useState<NavigationTransition | null>(null);

  const openLightbox = useCallback(() => {
    if (!hero) return;
    setLightboxContain(false);
    setLightboxOpen(true);
  }, [hero]);

  const closeLightbox = useCallback(() => {
    setLightboxContain(false);
    setLightboxOpen(false);
  }, []);

  useEffect(() => {
    const previous = previousActiveRunRef.current;
    const currentRunId = activeRun?.id ?? null;

    if (previous.runId && currentRunId && previous.runId !== currentRunId) {
      const navigatedBetweenExistingRuns = runs.length === previous.runsLength && previous.runsLength > 1;

      if (navigatedBetweenExistingRuns && previous.hero && hero) {
        const direction: -1 | 1 = activeIndex > previous.index ? 1 : -1;
        setNavigationTransition({
          key: `${previous.runId}:${currentRunId}:${Date.now()}`,
          fromRunId: previous.runId,
          toRunId: currentRunId,
          fromImage: previous.hero,
          toImage: hero,
          direction,
        });
      } else {
        setNavigationTransition(null);
      }
    } else if (!hero) {
      setNavigationTransition(null);
    }

    previousActiveRunRef.current = {
      runId: currentRunId,
      index: activeIndex,
      runsLength: runs.length,
      hero,
    };
  }, [activeIndex, activeRun?.id, hero, runs.length]);

  useEffect(() => {
    if (!navigationTransition) return;
    const timeoutId = window.setTimeout(() => {
      setNavigationTransition((current) => (current?.key === navigationTransition.key ? null : current));
    }, 460);
    return () => window.clearTimeout(timeoutId);
  }, [navigationTransition]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeLightbox, lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    if (hero) return;
    setLightboxOpen(false);
  }, [hero, lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [lightboxOpen]);

  const busy = cache?.status === "running";
  const isPreviewVisible = Boolean(enabled && (hero || busy || (cache?.status === "error" && cache?.error)));
  const showLoader = !hero && (busy || !cache || cache.status === "idle");
  const showRefreshMask = Boolean(hero && busy);
  const leadGateActive = leadGateEnabled && Boolean(hero) && !leadCaptured;
  const canUseLiveBudgetSlider = !leadGateEnabled || leadCaptured;
  const formattedLoaderCountdown = useMemo(() => {
    const safe = Math.max(0, Math.floor(IMAGE_GENERATION_ESTIMATED_SECONDS - loaderElapsedSec));
    const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
    const seconds = String(safe % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [loaderElapsedSec]);

  useEffect(() => {
    if (!busy) {
      setLoaderElapsedSec(0);
      return;
    }
    setLoaderElapsedSec(0);
    const timer = window.setInterval(() => {
      setLoaderElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  // Auto-regenerate every N answered questions, starting after the first successful run.
  useEffect(() => {
    if (!enabled) return;
    if (!Number.isFinite(autoRegenerateEveryNAnsweredQuestions) || autoRegenerateEveryNAnsweredQuestions <= 0) return;
    if (cache?.status === "running") return;
    if (cache?.status === "error") return;
    if (!Number.isFinite(answeredQuestionCount) || answeredQuestionCount <= 0) return;

    const last = cache?.lastGeneratedAnsweredCount ?? runs.at(-1)?.answeredQuestionCount ?? null;
    // If we have never generated a run yet, kick off the first preview once the user has answered enough.
    if (typeof last !== "number" || !Number.isFinite(last)) {
      if (answeredQuestionCount >= autoRegenerateEveryNAnsweredQuestions) {
        void runGenerate("auto");
      }
      return;
    }
    if (answeredQuestionCount >= last + autoRegenerateEveryNAnsweredQuestions) {
      // Never interrupt the user with a lead-capture popover due to an *auto* regeneration.
      // If lead capture is required, simply skip auto-regeneration until the user explicitly
      // takes an action (e.g. refresh/download/show pricing) that can open the gate.
      if (leadGateActive) return;
      void runGenerate("auto");
    }
  }, [
    answeredQuestionCount,
    autoRegenerateEveryNAnsweredQuestions,
    cache?.lastGeneratedAnsweredCount,
    cache?.status,
    enabled,
    leadGateActive,
    runGenerate,
    runs,
  ]);

  // Prompt "Send" is an explicit action: always regenerate on each submit nonce bump.
  useEffect(() => {
    if (!enabled) return;
    if (!hero) return;
    const rawNonce = (effectiveStepDataSoFar as any)?.__promptSubmitNonce;
    const nonce = typeof rawNonce === "number" ? rawNonce : Number(rawNonce);
    if (!Number.isFinite(nonce) || nonce <= 0) return;

    if (!promptSubmitNonceInitializedRef.current) {
      promptSubmitNonceInitializedRef.current = true;
      promptSubmitNonceRef.current = nonce;
      return;
    }
    if (nonce <= promptSubmitNonceRef.current) return;

    promptSubmitNonceRef.current = nonce;
    if (cache?.status === "error") return;
    requestManualGenerate();
  }, [cache?.status, effectiveStepDataSoFar, enabled, hero, requestManualGenerate]);

  // Upload-driven refresh nonce: explicit regeneration trigger even when hero is absent/stale.
  useEffect(() => {
    if (!enabled) return;
    const rawNonce = (effectiveStepDataSoFar as any)?.__previewRefreshNonce;
    const nonce = typeof rawNonce === "number" ? rawNonce : Number(rawNonce);
    if (!Number.isFinite(nonce) || nonce <= 0) return;

    if (nonce <= previewRefreshNonceRef.current) return;

    previewRefreshNonceRef.current = nonce;
    requestManualGenerate();
  }, [effectiveStepDataSoFar, enabled, requestManualGenerate]);

  useEffect(() => {
    if (!enabled) return;
    if (!pendingManualGenerateRef.current) return;
    if (inFlightRef.current) return;
    if (cache?.status === "running") return;
    pendingManualGenerateRef.current = false;
    void runGenerate("manual");
  }, [cache?.status, enabled, runGenerate]);

  const budgetSliderBounds = useMemo(() => {
    const previewPricingSeed = buildPreviewPricingFromConfig((config as any)?.previewPricing, sessionId);
    // Slider uses service price range (wider) only; never image range (totalMin/totalMax)
    const sourceMin =
      accuratePricing?.servicePriceRange?.low ?? previewPricingSeed?.totalMin ?? 2000;
    const sourceMax =
      accuratePricing?.servicePriceRange?.high ?? previewPricingSeed?.totalMax ?? 50000;
    const min = Math.max(500, Math.min(sourceMin, sourceMax));
    const max = Math.max(min + 500, Math.max(sourceMin, sourceMax));
    const span = Math.max(0, max - min);
    // Prefer fewer, more meaningful slider positions for visible image changes.
    // More intervals for finer budget selection
    const step =
      span <= 10000 ? 1000 : span <= 20000 ? 1500 : span <= 40000 ? 2000 : span <= 60000 ? 2500 : Math.max(1000, Math.round(span / 24));
    return { min, max, step };
  }, [accuratePricing, config, sessionId]);

  const previewPricing = useMemo(() => {
    return buildPreviewPricingFromConfig((config as any)?.previewPricing, sessionId);
  }, [(config as any)?.previewPricing, sessionId]);
  const pricingLocale =
    typeof navigator !== "undefined"
      ? ((navigator.languages && navigator.languages[0]) || navigator.language || undefined)
      : undefined;
  const pricingCurrency = (previewPricing?.currency || detectCurrencyFromLocale(pricingLocale) || "USD").toUpperCase();

  const budgetSliderLabels = useMemo(() => {
    const { min, max } = budgetSliderBounds;
    const currency = (accuratePricing?.currency || pricingCurrency || "USD").toUpperCase();
    return [0, 0.5, 1].map((pct) => {
      const val = pct === 0 ? min : pct === 1 ? max : Math.round(min + (max - min) * pct);
      return formatCurrency(val, { locale: pricingLocale, currency, compact: true });
    });
  }, [accuratePricing?.currency, budgetSliderBounds, pricingCurrency, pricingLocale]);

  const fetchAccuratePricing = useCallback(async () => {
    if (!instanceId || !sessionId) return;
    if (accuratePricingStatus === "running") return;
    setAccuratePricingStatus("running");

    try {
      const stepsForQA = typeof window !== "undefined" ? loadStepState(instanceId)?.steps ?? [] : [];
      const answeredQA = buildAnsweredQAFromSteps(stepsForQA, effectiveStepDataSoFar || {}, 60);
      const askedStepIds = stepsForQA
        .map((s: any) => String(s?.id ?? s?.stepId ?? s?.key ?? ""))
        .filter((v: string) => Boolean(v && v.trim().length));

      const formCtx = loadFormStateContext(sessionId);
      const serviceIdRaw =
        (effectiveStepDataSoFar as any)?.["step-service-primary"] ??
        (effectiveStepDataSoFar as any)?.["step-service"] ??
        (effectiveStepDataSoFar as any)?.["step_service_primary"] ??
        (effectiveStepDataSoFar as any)?.["step_service"];
      const selectedServiceId = Array.isArray(serviceIdRaw) ? String(serviceIdRaw[0] || "") : String(serviceIdRaw || "");
      const perServiceSummary =
        selectedServiceId
          ? (() => {
              const cat = loadServiceCatalog(sessionId);
              const meta: any = cat?.byServiceId?.[selectedServiceId];
              return typeof meta?.serviceSummary === "string" ? meta.serviceSummary : null;
            })()
          : null;
      const combinedServiceSummary =
        [formCtx.serviceSummary, perServiceSummary].filter((s) => typeof s === "string" && String(s).trim()).join("\n\n") || null;
      const instanceContext = {
        businessContext: (config as any)?.businessContext ?? formCtx.businessContext,
        serviceSummary: combinedServiceSummary,
      };

      const res = await fetch(`/api/ai-form/${encodeURIComponent(instanceId)}/pricing`, {
        method: "POST",
        headers: { "content-type": "application/json", Accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          sessionId,
          useCase: (config as any)?.useCase,
          stepDataSoFar: effectiveStepDataSoFar,
          answeredQA,
          askedStepIds,
          instanceContext,
          noCache: true,
          ...(hero && (hero.startsWith("http://") || hero.startsWith("https://")) ? { previewImageUrl: hero } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message = typeof (json as any)?.error === "string" ? String((json as any).error) : `Pricing failed (${res.status})`;
        throw new Error(message);
      }
      const est = (json as any)?.estimate ?? json;
      const totalMin = Number((est as any)?.totalMin);
      const totalMax = Number((est as any)?.totalMax);
      const currencyRaw = typeof (est as any)?.currency === "string" ? String((est as any).currency).trim().toUpperCase() : "USD";
      if (!Number.isFinite(totalMin) || !Number.isFinite(totalMax)) {
        throw new Error("Pricing returned invalid numbers");
      }
      const svcRange = (est as any)?.servicePriceRange ?? (est as any)?.service_price_range;
      const servicePriceRange =
        typeof svcRange === "object" &&
        svcRange !== null &&
        typeof svcRange.low === "number" &&
        typeof svcRange.high === "number"
          ? { low: Math.min(svcRange.low, svcRange.high), high: Math.max(svcRange.low, svcRange.high) }
          : undefined;
      const imgRange = (est as any)?.imagePriceRange ?? (est as any)?.image_price_range;
      const imagePriceRange =
        typeof imgRange === "object" &&
        imgRange !== null &&
        typeof imgRange.low === "number" &&
        typeof imgRange.high === "number"
          ? { low: Math.min(imgRange.low, imgRange.high), high: Math.max(imgRange.low, imgRange.high) }
          : { low: Math.min(totalMin, totalMax), high: Math.max(totalMin, totalMax) };
      setAccuratePricing((prev) => {
        // Service range is fixed after first load — slider bounds stay the same; only image estimate updates.
        const keepServiceRange = prev?.servicePriceRange &&
          typeof prev.servicePriceRange.low === "number" &&
          typeof prev.servicePriceRange.high === "number";
        const finalServiceRange = keepServiceRange && prev?.servicePriceRange
          ? prev.servicePriceRange
          : servicePriceRange;
        return {
          totalMin: Math.min(totalMin, totalMax),
          totalMax: Math.max(totalMin, totalMax),
          currency: currencyRaw || "USD",
          imagePriceRange,
          ...(finalServiceRange ? { servicePriceRange: finalServiceRange } : {}),
        };
      });
      setAccuratePricingStatus("complete");
    } catch {
      setAccuratePricingStatus("error");
    }
  }, [accuratePricingStatus, config, effectiveStepDataSoFar, hero, instanceId, sessionId]);
  fetchAccuratePricingRef.current = fetchAccuratePricing;

  // Default budget to 20% into the range when no value from step data
  useEffect(() => {
    if (liveBudget !== null) return;
    const { min, max, step } = budgetSliderBounds;
    const at20Pct = min + (max - min) * 0.2;
    const stepped = Math.round(at20Pct / step) * step;
    const clamped = Math.max(min, Math.min(max, stepped));
    setLiveBudget(clamped);
  }, [budgetSliderBounds, liveBudget]);

  // If budget changes while pricing is revealed, refetch accurate pricing after the next regeneration.
  // This covers both the in-overlay slider and external budget changes (e.g. question-pane Budget mode).
  useEffect(() => {
    if (liveBudget === null || !Number.isFinite(liveBudget)) return;
    if (prevBudgetForPricingRef.current === null) {
      prevBudgetForPricingRef.current = liveBudget;
      return;
    }
    if (prevBudgetForPricingRef.current === liveBudget) return;
    prevBudgetForPricingRef.current = liveBudget;
    if (!enabled || !hero) return;
    if (!leadCaptured) return;
    pendingBudgetRefineRef.current = true;
    prevRunsLengthRef.current = runs.length;
  }, [enabled, hero, leadCaptured, liveBudget, runs.length]);

  useEffect(() => {
    if (!enabled) return;
    if (!hero) return;
    if (!liveBudgetDirty) return;
    if (!canUseLiveBudgetSlider) return;
    const timer = window.setTimeout(() => {
      setLiveBudgetDirty(false);
      pendingBudgetRefineRef.current = true;
      void runGenerate("manual");
    }, 900);
    return () => window.clearTimeout(timer);
  }, [canUseLiveBudgetSlider, enabled, hero, liveBudgetDirty, runGenerate]);

  // Defer pricing until after regeneration completes (when triggered by budget slider).
  useEffect(() => {
    if (!enabled || !leadCaptured) return;
    if (!pendingBudgetRefineRef.current) {
      prevRunsLengthRef.current = runs.length;
      return;
    }
    if (runs.length <= prevRunsLengthRef.current) return;
    prevRunsLengthRef.current = runs.length;
    pendingBudgetRefineRef.current = false;
    void fetchAccuratePricingRef.current?.();
  }, [enabled, leadCaptured, runs.length]);

  const downloadActiveImage = useCallback(async () => {
    if (!hero) return;
    const filename = `preview-${Date.now()}.png`;
    try {
      if (hero.startsWith("data:")) {
        const a = document.createElement("a");
        a.href = hero;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }

      const res = await fetch(hero);
      if (!res.ok) throw new Error("fetch_failed");
      const blob = await res.blob();
      if (!blob || (blob.type && !blob.type.startsWith("image/"))) throw new Error("not_image");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 750);
    } catch {
      try {
        window.open(hero, "_blank", "noopener,noreferrer");
      } catch {}
    }
  }, [hero]);

  const handleRefreshClick = useCallback(() => {
    if (leadGateActive) {
      pendingActionRef.current = "refresh";
      pendingGenerateModeRef.current = "manual";
      gateContextRef.current = "regenerate_manual";
      setShowGenerateGate(true);
      return;
    }
    requestManualGenerate();
  }, [leadGateActive, requestManualGenerate]);

  const handleUploadClick = useCallback(() => {
    if (leadGateActive) {
      gateContextRef.current = "upload_reference";
      pendingActionRef.current = "upload";
      setShowUploadGate(true);
      return;
    }
    uploadInputRef.current?.click();
  }, [leadGateActive]);

  const handleDownloadClick = useCallback(() => {
    if (!hero) return;
    if (leadGateActive) {
      gateContextRef.current = "download";
      pendingActionRef.current = "download";
      setShowDownloadGate(true);
      return;
    }
    void downloadActiveImage();
  }, [downloadActiveImage, hero, leadGateActive]);

  const handleSkipContinue = useCallback(() => {
    pendingActionRef.current = null;
    setShowUploadGate(false);
    setShowDownloadGate(false);
    setShowGenerateGate(false);
    // Explicit skip should allow continuing without forcing lead capture UX.
    setLeadCaptured(true);
  }, []);

  // Let the parent know whether a real preview image is currently visible.
  useEffect(() => {
    onPreviewVisibleChange?.(isPreviewVisible);
  }, [isPreviewVisible, onPreviewVisibleChange]);

  // Let the parent know whether we have an actual preview image yet.
  useEffect(() => {
    onHasImageChange?.(Boolean(hero));
  }, [hero, onHasImageChange]);

  // UX: generate in the background while the user completes the form.
  // Show the preview shell immediately while generating, then swap in the real image when ready.

  const canPrev = activeIndex > 0;
  const canNext = activeIndex < runs.length - 1;
  const activeNavigationTransition =
    navigationTransition && navigationTransition.toRunId === activeRun?.id && navigationTransition.toImage === hero
      ? navigationTransition
      : null;
  const stackedPreviewLayers = useMemo(() => {
    if (!hero || runs.length <= 1) return [] as PreviewStackLayer[];

    const layers: PreviewStackLayer[] = [];
    const seen = new Set<string>([hero]);
    const addLayer = (src: string | null | undefined, key: string, kind: PreviewStackLayer["kind"]) => {
      if (!isValidUrlLikeImage(src) || seen.has(src) || layers.length >= 4) return;
      seen.add(src);
      layers.push({ key, src, kind });
    };

    if (activeNavigationTransition?.fromImage) {
      addLayer(activeNavigationTransition.fromImage, `transition-${activeNavigationTransition.key}`, "transition");
    }

    // Faded stack on left: previous runs (history) + next runs (upcoming)
    const previousRuns = runs.slice(0, activeIndex).reverse();
    const nextRuns = runs.slice(activeIndex + 1);
    previousRuns.forEach((run) => addLayer(run.images?.[0], `history-${run.id}`, "history"));
    nextRuns.forEach((run) => addLayer(run.images?.[0], `next-${run.id}`, "history"));

    return layers;
  }, [activeIndex, activeNavigationTransition, hero, runs]);
  const goPrev = () => {
    if (!canPrev) return;
    const nextId = runs[activeIndex - 1]?.id;
    if (!nextId) return;
    setCache((prev) => {
      const base = prev ?? loadCache(instanceId, sessionId);
      if (!base) return prev;
      const next: PreviewCacheV3 = { ...base, activeRunId: nextId, updatedAt: Date.now() };
      saveCache(instanceId, sessionId, next);
      return next;
    });
  };
  const goNext = () => {
    if (!canNext) return;
    const nextId = runs[activeIndex + 1]?.id;
    if (!nextId) return;
    setCache((prev) => {
      const base = prev ?? loadCache(instanceId, sessionId);
      if (!base) return prev;
      const next: PreviewCacheV3 = { ...base, activeRunId: nextId, updatedAt: Date.now() };
      saveCache(instanceId, sessionId, next);
      return next;
    });
  };
  // previewMaxVh >= 95 means full-screen dominant layout (mobile/adventure) — no space below the image.
  const isDominantLayout = typeof previewMaxVh === "number" && previewMaxVh >= 95;

	  const base =
	    variant === "tiny"
	      ? { vw: 92, px: 320, vh: 18 }
	      : variant === "rail"
	        ? { vw: 92, px: 520, vh: 28 }
	        : { vw: 98, px: 1200, vh: 82 };

  const maxVw =
    typeof previewMaxVw === "number" && Number.isFinite(previewMaxVw) ? Math.min(base.vw, previewMaxVw) : base.vw;
  const chromePx =
    typeof previewChromePx === "number" && Number.isFinite(previewChromePx) ? Math.max(0, Math.floor(previewChromePx)) : 0;
  // Guard: parent measurement can briefly produce 0/negative values on first reveal;
  // treating that as a real constraint collapses the preview.
  const hasValidPreviewMaxPx = typeof previewMaxPx === "number" && Number.isFinite(previewMaxPx) && previewMaxPx > 0;
  const maxPxRaw = hasValidPreviewMaxPx ? Math.min(base.px, previewMaxPx) : base.px;
  const maxPx = Math.max(0, maxPxRaw - (hasValidPreviewMaxPx ? chromePx : 0));
  const maxVh = typeof previewMaxVh === "number" && Number.isFinite(previewMaxVh) ? Math.min(base.vh, previewMaxVh) : base.vh;

  // Keep the sizing expression stable across the entire lifecycle (generating -> revealed),
  // so we don't "snap" between different min() constraints as measurements settle.
  const previewSize = `min(100%, ${maxVw}vw, ${maxPx}px, ${maxVh}dvh)`;

  // Let the preview size respond to parent layout changes (e.g. toggling between prompt/questions)
  // without using framer-motion layout animations (they can jitter while measurements settle).
  const effectivePreviewSize = previewSize;
  // Neutral glass palette for all overlay controls (pills + lead popover).
  const primary = theme.primaryColor || "#3b82f6";
  const pillBg = "rgba(51, 65, 85, 0.52)";
  const overlayBg = pillBg;
  const overlayHoverBg = "rgba(51, 65, 85, 0.64)";
  const overlayBorder = "rgba(255,255,255,0.24)";
  // Keep lead popover on the exact same glass color token as overlay pills.
  const leadGenOverlayBg = overlayBg;
  const leadGenFg = "rgba(255,255,255,0.95)";
  const leadGenMuted = "rgba(255,255,255,0.72)";
  const leadGenInputBg = "rgba(255,255,255,0.12)";
  const leadGenInputBorder = "rgba(255,255,255,0.20)";
  const leadGenPlaceholder = "rgba(255,255,255,0.58)";
  const leadGenActionBg = "rgba(255,255,255,0.18)";
  const leadGenActionFg = "#ffffff";
  const leadGenActionBorder = "rgba(255,255,255,0.26)";
  const leadGenRing = "rgba(255,255,255,0.38)";
  const overlayVars = {
    ["--sif-overlay-bg" as any]: overlayBg,
    ["--sif-overlay-hover-bg" as any]: overlayHoverBg,
    ["--sif-overlay-border" as any]: overlayBorder,
    ["--sif-lead-gen-overlay-bg" as any]: leadGenOverlayBg,
    ["--sif-lead-gen-fg" as any]: leadGenFg,
    ["--sif-lead-gen-muted" as any]: leadGenMuted,
    ["--sif-lead-gen-input-bg" as any]: leadGenInputBg,
    ["--sif-lead-gen-input-border" as any]: leadGenInputBorder,
    ["--sif-lead-gen-placeholder" as any]: leadGenPlaceholder,
    ["--sif-lead-gen-action-bg" as any]: leadGenActionBg,
    ["--sif-lead-gen-action-fg" as any]: leadGenActionFg,
    ["--sif-lead-gen-action-border" as any]: leadGenActionBorder,
    ["--sif-lead-gen-ring" as any]: leadGenRing,
  } as React.CSSProperties;
  const overlayButtonClass =
    "h-8 sm:h-7 inline-flex items-center gap-1.5 rounded-xl px-3 text-[0.6875rem] font-medium leading-none text-white/95 shadow-sm backdrop-blur-md bg-[var(--sif-overlay-bg)] hover:bg-[var(--sif-overlay-hover-bg)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60 disabled:cursor-not-allowed";
  const overlayIconButtonClass =
    "h-8 w-8 sm:h-7 sm:w-7 inline-flex items-center justify-center rounded-full text-white/85 bg-white/0 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors";

  const pricingPillVars = {
    ["--sif-overlay-bg" as any]: pillBg,
    ["--sif-overlay-hover-bg" as any]: overlayHoverBg,
    ["--sif-pill-fg" as any]: "#ffffff",
    ["--sif-lead-gen-overlay-bg" as any]: leadGenOverlayBg,
    ["--sif-lead-gen-fg" as any]: leadGenFg,
    ["--sif-lead-gen-muted" as any]: leadGenMuted,
    ["--sif-lead-gen-input-bg" as any]: leadGenInputBg,
    ["--sif-lead-gen-input-border" as any]: leadGenInputBorder,
    ["--sif-lead-gen-placeholder" as any]: leadGenPlaceholder,
    ["--sif-lead-gen-action-bg" as any]: leadGenActionBg,
    ["--sif-lead-gen-action-fg" as any]: leadGenActionFg,
    ["--sif-lead-gen-action-border" as any]: leadGenActionBorder,
    ["--sif-lead-gen-ring" as any]: leadGenRing,
  } as React.CSSProperties;

  // Pricing pill: show whenever we have hero image + pricing config. In dominant layout (full-screen preview),
  // the pill is the only UI besides the image — user explicitly wants it visible at that stage.
  const shouldShowPricingPill = Boolean(hero && variant === "hero" && previewPricing);
  const formattedPricingRange = previewPricing
    ? `${formatCurrency(previewPricing.totalMin, { locale: pricingLocale, currency: pricingCurrency })}-${formatCurrency(
        previewPricing.totalMax,
        { locale: pricingLocale, currency: pricingCurrency }
      )}`
    : null;
  const formattedSeedPricing = previewPricing
    ? formatCurrency(Math.round((previewPricing.totalMin + previewPricing.totalMax) / 2), {
        locale: pricingLocale,
        currency: pricingCurrency,
      })
    : null;

  const formattedAccuratePricingRange = useMemo(() => {
    if (!accuratePricing) return null;
    const c = (accuratePricing.currency || pricingCurrency || "USD").toUpperCase();
    // Prefer imagePriceRange (raw AI estimate) for the pill so we always show the actual range
    const low = accuratePricing.imagePriceRange?.low ?? accuratePricing.totalMin;
    const high = accuratePricing.imagePriceRange?.high ?? accuratePricing.totalMax;
    return `${formatCurrency(low, { locale: pricingLocale, currency: c })}-${formatCurrency(high, {
      locale: pricingLocale,
      currency: c,
    })}`;
  }, [accuratePricing, pricingCurrency, pricingLocale]);

  const pillLabel = leadGateEnabled ? (leadCaptured ? "EST. PRICING" : "Show pricing") : "EST. PRICING";
  // Price pill shows the image-specific price range (totalMin – totalMax) from the API
  const pillPrice = formattedAccuratePricingRange
    ? formattedAccuratePricingRange
    : accuratePricingStatus === "error"
      ? formattedPricingRange || "$•••-$•••"
      : leadGateEnabled && leadCaptured
        ? "$•••-$•••"
        : formattedPricingRange || "$•••-$•••";
  const pillLoading = Boolean(leadGateEnabled && leadCaptured && accuratePricingStatus === "running");
  const hasBudgetOverlayControl = Boolean(hero && canUseLiveBudgetSlider && !hideBudgetInOverlay);
  const shouldShowCenteredPricingPill = Boolean(
    shouldShowPricingPill && formattedPricingRange && leadGateEnabled && !leadCaptured
  );
  const shouldShowBottomPricingPill = Boolean(
    shouldShowPricingPill && formattedPricingRange && !shouldShowCenteredPricingPill
  );
  const shouldShowBottomControlsRow = Boolean(
    !shouldShowCenteredPricingPill &&
      (hasBudgetOverlayControl || shouldShowBottomPricingPill)
  );
  const uploadControlPositionClass =
    hero && !busy
      ? "top-[calc(env(safe-area-inset-top)+52px)] sm:top-11"
      : "top-[calc(env(safe-area-inset-top)+12px)] sm:top-3";

  useEffect(() => {
    if (!leadGateEnabled) return;
    if (!leadCaptured) return;
    if (formattedAccuratePricingRange) return;
    if (accuratePricingStatus !== "idle") return;
    void fetchAccuratePricingRef.current?.();
  }, [accuratePricingStatus, formattedAccuratePricingRange, leadCaptured, leadGateEnabled]);

  if (!enabled) return null;

  function renderPreview() {
    return (
      <LayoutGroup id={lightboxLayoutId}>
        <>
          {/* min-h-0 + overflow-hidden ensure the card never bleeds outside the flex layout; overflow-visible when stack shown */}
          <div className={cn("w-full min-h-0", stackedPreviewLayers.length > 0 ? "overflow-visible" : "overflow-hidden")}>
        <Card
	          className={
	            transparentChrome
	              ? "bg-transparent border-0 shadow-none overflow-hidden"
              : "bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60 border-border overflow-hidden"
          }
	        >
	          <CardContent className={cn(previewMaxPx ? "p-0" : transparentChrome ? "p-0" : "p-3", stackedPreviewLayers.length > 0 ? "overflow-visible" : "overflow-hidden")}>
	            {previewMaxPx && chromePx > 0 ? <div style={{ height: chromePx }} /> : null}
            <div className={cn("flex justify-center", stackedPreviewLayers.length > 0 && "pl-14")}>
	            <motion.div
	              initial={{ opacity: 0 }}
	              animate={{ opacity: 1 }}
	              transition={{ duration: 0.18, ease: "easeOut" }}
				              className="relative mx-auto overflow-visible"
				              style={{
				                width: effectivePreviewSize,
				                maxWidth: "100%",
				                aspectRatio: "1 / 1",
				                maxHeight: effectivePreviewSize,
				              }}
			            >
			              {/* Keep prior previews visually present, but only use the deck animation when browsing history. */}
				              <AnimatePresence initial={false}>
				                {stackedPreviewLayers.map((layerConfig, idx) => {
				                  const layer = idx + 1;
				                  const isTransitionLayer = layerConfig.kind === "transition";
				                  const x = -(14 + idx * 10);
				                  const y = 2 + idx * 2;
				                  const rotate = -0.45 - idx * 0.18;
				                  const scale = 0.986 - idx * 0.022;
				                  const blurPx = isTransitionLayer ? 1.2 + idx * 1.2 : 2.4 + idx * 1.5;
				                  const layerOpacity = isTransitionLayer ? Math.max(0.5, 0.7 - idx * 0.08) : Math.max(0.18, 0.34 - idx * 0.09);
				                  const layerOverlay = isTransitionLayer ? Math.min(0.72, 0.54 + idx * 0.08) : Math.min(0.86, 0.64 + idx * 0.1);
				                  return (
				                    <motion.div
				                      key={layerConfig.key}
				                      className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none"
				                      style={{
				                        zIndex: layer,
				                        border: "1px solid rgba(255,255,255,0.2)",
				                        boxShadow: isTransitionLayer
				                          ? "0 18px 34px rgba(0,0,0,0.28)"
				                          : "0 8px 20px rgba(0,0,0,0.22)",
				                        backgroundColor: "#0f172a",
				                      }}
				                      initial={
				                        isTransitionLayer
				                          ? { x: 0, y: 0, rotate: 0, scale: 1.01, opacity: 0.84 }
				                          : { x: x + 6, y, rotate: rotate - 0.08, scale, opacity: 0 }
				                      }
				                      animate={{ x, y, rotate, scale, opacity: layerOpacity }}
				                      exit={
				                        isTransitionLayer
				                          ? { x, y: y + 2, rotate, scale, opacity: 0 }
				                          : { x: x - 4, y, rotate, scale, opacity: 0 }
				                      }
				                      transition={{ duration: isTransitionLayer ? 0.26 : 0.18, ease: [0.22, 1, 0.36, 1] }}
				                    >
				                      {/* eslint-disable-next-line @next/next/no-img-element */}
				                      <img
                                src={layerConfig.src}
                                alt=""
                                aria-hidden
                                className="h-full w-full object-cover"
                                style={{
                                  filter: `blur(${blurPx}px) saturate(0.85) brightness(${isTransitionLayer ? 0.84 : 0.72})`,
                                  transform: "scale(1.02)",
                                }}
                              />
				                      <div
				                        className="absolute inset-0 pointer-events-none"
				                        style={{
				                          background: `radial-gradient(120% 100% at 50% 50%, rgba(15,23,42,${Math.max(0.4, layerOverlay - 0.18)}) 0%, rgba(15,23,42,${layerOverlay}) 72%, rgba(15,23,42,${Math.min(0.92, layerOverlay + 0.14)}) 100%)`,
				                        }}
				                      />
				                    </motion.div>
				                  );
				                })}
				              </AnimatePresence>
				              <div
				                className={cn(
				                  "absolute inset-0 z-20 overflow-hidden rounded-xl",
				                  transparentChrome ? "bg-transparent" : "bg-muted/30"
				                )}
				                style={{ willChange: "transform" }}
				              >
	            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (uploadInputRef.current) uploadInputRef.current.value = "";
                void handleOwnImageUpload(files);
              }}
	            />

              {hero && isPlaceholderHero ? (
                <div className="absolute left-2 top-2 z-10">
                  <div
                    className="rounded-xl px-3 py-2 text-[0.6875rem] font-medium text-white/95 shadow-sm backdrop-blur-md bg-[var(--sif-overlay-bg)]"
                    style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                  >
                    Demo preview (not generated)
                  </div>
                </div>
              ) : null}

              {/* Top controls: compact layout so actions stay available but less visually busy */}
              {hero ? (
                <div className="absolute inset-x-2 top-2 z-10 flex items-start justify-between pointer-events-none">
                  <div className="pointer-events-auto">
                    {hero && !busy ? (
                      leadGateEnabled ? (
                        <LeadGenPopover
                          open={showGenerateGate}
                          onOpenChange={(open) => {
                            if (!open) {
                              pendingActionRef.current = null;
                              pendingGenerateModeRef.current = "manual";
                              gateContextRef.current = "design_and_estimate";
                            }
                            setShowGenerateGate(open);
                          }}
                          instanceId={instanceId}
                          sessionId={sessionId}
                          gateContext={gateContextRef.current || "regenerate_manual"}
                          surface="overlay"
                          contentStyle={overlayVars}
                          title="Where should we send the pricing to?"
                          description="Before regenerating this preview, we'll email you pricing."
                          finePrint="Instant unlock after sending."
                          ctaLabel="Send pricing"
                          phoneTitle="Best phone number?"
                          phoneDescription="We can text the updated preview too."
                          requirePhone
                          submitOnEmail={false}
                          submissionData={{ surface: "preview_generate" }}
                          side="bottom"
                          align="start"
                          sideOffset={6}
                          onSubmitted={() => {
                            setLeadCaptured(true);
                            const action = pendingActionRef.current;
                            const mode = pendingGenerateModeRef.current;
                            pendingActionRef.current = null;
                            pendingGenerateModeRef.current = "manual";
                            if (action === "refresh") void runGenerate(mode);
                          }}
                        >
                          <button
                            type="button"
                            disabled={busy}
                            onClick={handleRefreshClick}
                            className={overlayButtonClass}
                            aria-label="Not what you want? Try again"
                            style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                          >
                            <span className="opacity-65">Not what you want?</span>
                            <span className="font-medium">Try again</span>
                          </button>
                        </LeadGenPopover>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleRefreshClick}
                          className={overlayButtonClass}
                          aria-label="Not what you want? Try again"
                          style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                        >
                          <span className="opacity-65">Not what you want?</span>
                          <span className="font-medium">Try again</span>
                        </button>
                      )
                    ) : null}
                  </div>

                  <div
                    className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-[var(--sif-overlay-bg)] p-1 text-white shadow-sm backdrop-blur-md"
                    style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                  >
                    {leadGateEnabled ? (
                      <LeadGenPopover
                        open={showDownloadGate}
                        onOpenChange={(v) => {
                          if (!v) {
                            pendingActionRef.current = null;
                            setShowDownloadGate(false);
                          }
                        }}
                        instanceId={instanceId}
                        sessionId={sessionId}
                        gateContext="download"
                        surface="overlay"
                        contentStyle={overlayVars}
                        title="Where should we send the pricing to?"
                        description="Before downloading this preview, we’ll email you pricing and a copy of the file."
                        finePrint="Instant download after sending."
                        ctaLabel="Send pricing"
                        phoneTitle="Best phone number?"
                        phoneDescription="We can text the download link too."
                        side="top"
                        align="end"
                        sideOffset={4}
                        requirePhone
                        submitOnEmail={false}
                        submissionData={{ surface: "preview_download" }}
                        onSubmitted={async () => {
                          setLeadCaptured(true);
                          const action = pendingActionRef.current;
                          pendingActionRef.current = null;
                          if (action === "download") await downloadActiveImage();
                        }}
                      >
                        <button
                          type="button"
                          disabled={busy || !hero}
                          onClick={handleDownloadClick}
                          className={overlayIconButtonClass}
                          aria-label="Download preview"
                          title="Download preview"
                        >
                          <Download className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </button>
                      </LeadGenPopover>
                    ) : (
                      <button
                        type="button"
                        disabled={busy || !hero}
                        onClick={handleDownloadClick}
                        className={overlayIconButtonClass}
                        aria-label="Download preview"
                        title="Download preview"
                      >
                        <Download className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={openLightbox}
                      disabled={!hero}
                      aria-label="View larger"
                      title="View larger"
                      className={overlayIconButtonClass}
                    >
                      <Maximize2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}

	            <AnimatePresence initial={false} mode="wait">
	              {hero ? (
	                <motion.div
	                  key="hero"
	                  layoutId={lightboxLayoutId}
	                  layout={false}
	                  className="h-full w-full cursor-zoom-in"
	                  role="button"
	                  tabIndex={0}
	                  aria-label="Open larger preview"
	                  initial={{ opacity: 0 }}
	                  animate={
	                    activeNavigationTransition
	                      ? {
	                          x: [activeNavigationTransition.direction * 28, 0],
	                          opacity: [0.8, 1],
	                        }
	                      : {
	                          x: 0,
	                          opacity: 1,
	                        }
	                  }
	                  exit={{ opacity: 0 }}
	                  transition={
	                    activeNavigationTransition
	                      ? { type: "spring", stiffness: 400, damping: 35 }
	                      : { duration: 0.12, ease: "easeOut" }
	                  }
	                  onClick={openLightbox}
	                  onKeyDown={(e) => {
	                    if (e.key === "Enter" || e.key === " ") {
	                      e.preventDefault();
	                      openLightbox();
	                    }
	                  }}
	                >
	                  {/* eslint-disable-next-line @next/next/no-img-element */}
	                  <img
	                    src={hero}
	                    alt="Preview"
	                    className="h-full w-full object-cover"
	                  />
	                </motion.div>
	              ) : (
	                <motion.div
	                  key="placeholder"
	                  className="h-full w-full bg-gray-100"
	                  initial={{ opacity: 0 }}
	                  animate={{ opacity: 1 }}
	                  exit={{ opacity: 0 }}
	                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
	                >
	                  <div className="h-full w-full animate-pulse" />
	                </motion.div>
	              )}
	            </AnimatePresence>

            {/* Top-left: form-step upload thumbnail OR "upload your own image" button.
                Hidden when: (a) dedicated upload CTA step is showing below, or (b) image is generating and no thumbnail yet. */}
            <div
              className={cn(
                "absolute left-3 z-20 flex items-center gap-2",
                uploadControlPositionClass,
                "!hidden",
                hero ? "hidden" : null,
                !formStepUploadThumbnail && (suppressUploadOverlay || showLoader || busy) ? "hidden" : null
              )}
            >

              {formStepUploadThumbnail ? (
                <>
                  {/* User already uploaded via the form's upload step — show thumbnail + change action */}
                  <div
                    className="h-10 w-10 sm:h-9 sm:w-9 flex-shrink-0 rounded-xl overflow-hidden border border-white/20 shadow-sm"
                    title="Your uploaded photo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={formStepUploadThumbnail} alt="Your uploaded photo" className="h-full w-full object-cover" />
                  </div>
                  {leadGateEnabled ? (
                    <LeadGenPopover
                      open={showUploadGate}
                      onOpenChange={(v) => {
                        if (!v) {
                          pendingActionRef.current = null;
                          setShowUploadGate(false);
                        }
                      }}
                      instanceId={instanceId}
                      sessionId={sessionId}
                      gateContext="upload_reference"
                      surface="overlay"
                      contentStyle={overlayVars}
                      title="Where should we send the pricing to?"
                      description="Before changing your reference image, we'll email you pricing."
                      finePrint="You can swap to a new image right after sending."
                      ctaLabel="Send pricing"
                      phoneTitle="Best phone number?"
                      phoneDescription="We can text updates too."
                      side="top"
                      align="start"
                      sideOffset={8}
                      requirePhone
                      submitOnEmail={false}
                      submissionData={{ surface: "preview_change_reference" }}
                      onSubmitted={() => {
                        setLeadCaptured(true);
                        const action = pendingActionRef.current;
                        pendingActionRef.current = null;
                        if (action === "upload") uploadInputRef.current?.click();
                      }}
                    >
                      <button
                        type="button"
                        disabled={isUploadingOwnImages || busy}
                        onClick={handleUploadClick}
                        className={overlayButtonClass}
                        aria-label="Change uploaded image"
                        style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                      >
                        {isUploadingOwnImages ? "Uploading…" : "Change image"}
                      </button>
                    </LeadGenPopover>
                  ) : (
                    <button
                      type="button"
                      disabled={isUploadingOwnImages || busy}
                      onClick={handleUploadClick}
                      className={overlayButtonClass}
                      aria-label="Change uploaded image"
                      style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                    >
                      {isUploadingOwnImages ? "Uploading…" : "Change image"}
                    </button>
                  )}
                </>
              ) : (
                /* No form-step upload yet — offer the preview-level "Upload your own image" button */
                leadGateEnabled ? (
                  <LeadGenPopover
                    open={showUploadGate}
                    onOpenChange={(v) => {
                      if (!v) {
                        pendingActionRef.current = null;
                        setShowUploadGate(false);
                      }
                    }}
                    instanceId={instanceId}
                    sessionId={sessionId}
                    gateContext="upload_reference"
                    surface="overlay"
                    contentStyle={overlayVars}
                    title="Where should we send the pricing to?"
                    description="Before uploading reference images, we'll email you pricing."
                    finePrint="Upload multiple images after sending."
                    ctaLabel="Send pricing"
                    phoneTitle="Best phone number?"
                    phoneDescription="We can text updates too."
                    side="top"
                    align="start"
                    sideOffset={8}
                    requirePhone
                    submitOnEmail={false}
                    submissionData={{ surface: "preview_upload_reference" }}
                    onSubmitted={() => {
                      setLeadCaptured(true);
                      const action = pendingActionRef.current;
                      pendingActionRef.current = null;
                      if (action === "upload") uploadInputRef.current?.click();
                    }}
                  >
                    <button
                      type="button"
                      disabled={isUploadingOwnImages || busy}
                      onClick={handleUploadClick}
                      className={overlayButtonClass}
                      aria-label="Upload your own image"
                      style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                    >
                      {isUploadingOwnImages ? "Uploading…" : "Upload your own image"}
                    </button>
                  </LeadGenPopover>
                ) : (
                  <button
                    type="button"
                    disabled={isUploadingOwnImages || busy}
                    onClick={handleUploadClick}
                    className={overlayButtonClass}
                    aria-label="Upload your own image"
                    style={{ fontFamily: theme.fontFamily, ...overlayVars }}
                  >
                    {isUploadingOwnImages ? "Uploading…" : "Upload your own image"}
                  </button>
                )
              )}

            </div>


            {/* Uploaded images count is shown inline on the upload button */}

            {showLoader || busy ? (
              <div
                className={cn(
                  "absolute inset-0 flex items-center justify-center",
                  showRefreshMask ? "z-20 bg-black/15" : null
                )}
              >
                <FormLoader
                  variant="pill"
                  size="sm"
                  tone="overlay"
                  className="bg-slate-900/75"
                  style={{ ...overlayVars }}
                  message={cache?.message || (hero ? "Refreshing your design + pricing…" : "Generating your design + pricing for you…")}
                >
                  <div
                    className="rounded-full bg-white/15 px-2 py-0.5 text-[0.625rem] font-medium tracking-wide text-white/80 shrink-0 ring-1 ring-white/15"
                    style={{ fontFamily: theme.fontFamily }}
                  >
                    {formattedLoaderCountdown} left
                  </div>
                </FormLoader>
              </div>
            ) : null}

	              {cache?.status === "error" && cache?.error ? (
	                <div className="absolute inset-0 flex items-end">
                  <div className="w-full p-3 bg-gradient-to-t from-black/70 via-black/25 to-transparent">
                    <div className="text-xs font-medium text-white">Having trouble updating the preview image.</div>
                    <div className="mt-1 text-xs text-white/90">{cache.error}</div>
                    {cache.errorDetails ? (
                      <div className="mt-1 text-[0.6875rem] text-white/70 break-words">{cache.errorDetails}</div>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void runGenerate("manual")}
                        style={{ fontFamily: theme.fontFamily }}
                      >
                        Try again
                      </Button>
                    </div>
                  </div>
	                </div>
	              ) : null}

              {!lightboxOpen && shouldShowCenteredPricingPill ? (
                <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
                  <div
                    className={cn(
                      "pointer-events-auto overflow-visible backdrop-blur-xl",
                      "w-[min(19.2rem,calc(100vw-1.5rem))] rounded-2xl shadow-[0_10px_28px_rgba(15,23,42,0.24)]",
                      showCenteredPricingForm ? "min-h-[clamp(7rem,16dvh,8.75rem)]" : "h-auto"
                    )}
                    style={{
                      backgroundColor: pillBg,
                      WebkitBackdropFilter: "blur(14px)",
                    }}
                  >
                    {showCenteredPricingForm ? (
                      <div className="flex w-full items-center justify-center px-3 py-2">
                        <div className="box-border flex min-h-[clamp(6.25rem,14dvh,7.5rem)] w-full flex-col justify-center space-y-1.5 px-2 py-1.5" style={{ fontFamily: theme.fontFamily, ...pricingPillVars }}>
                          <div className="space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-[0.72rem] font-semibold leading-snug text-[var(--sif-lead-gen-fg)]">
                                {centeredPricingStep === "email"
                                  ? "Where should we send the pricing to?"
                                  : centeredPricingStep === "name"
                                    ? "What's your name?"
                                    : "Best phone number?"}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setCenteredPricingError(null);
                                  if (centeredPricingStep === "phone") {
                                    setCenteredPricingStep("name");
                                    return;
                                  }
                                  if (centeredPricingStep === "name") {
                                    setCenteredPricingStep("email");
                                    return;
                                  }
                                  setShowCenteredPricingForm(false);
                                }}
                                className="shrink-0 text-[0.66rem] font-medium leading-none text-[var(--sif-lead-gen-muted)] hover:text-[var(--sif-lead-gen-fg)]"
                              >
                                Back
                              </button>
                            </div>
                          </div>

                          {centeredPricingStep === "email" ? (
                            <div className="relative">
                              <Mail className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sif-lead-gen-muted)]" />
                              <Input
                                autoFocus
                                value={centeredPricingEmail}
                                onChange={(e) => setCenteredPricingEmail(e.target.value)}
                                placeholder="you@company.com"
                                inputMode="email"
                                className="h-7 rounded-xl border-0 bg-[var(--sif-lead-gen-input-bg)] pl-8 pr-[34%] text-[0.75rem] text-[var(--sif-lead-gen-fg)] placeholder:text-[color:var(--sif-lead-gen-placeholder)] focus-visible:ring-2 focus-visible:ring-offset-0"
                                style={{ fontFamily: theme.fontFamily, ["--tw-ring-color" as any]: "var(--sif-lead-gen-ring)" }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleCenteredPricingEmailSubmit();
                                }}
                              />
                              <Button
                                type="button"
                                size="sm"
                                disabled={isSubmittingCenteredPricingLead || !isValidEmail(centeredPricingEmail)}
                                onClick={() => void handleCenteredPricingEmailSubmit()}
                                className="absolute right-0.5 top-1/2 flex h-6 -translate-y-1/2 items-center rounded-full border-0 bg-[var(--sif-lead-gen-action-bg)] px-2.5 text-[0.6875rem] font-medium leading-none text-[var(--sif-lead-gen-action-fg)] shadow-sm hover:brightness-[0.96]"
                                style={{ fontFamily: theme.fontFamily }}
                              >
                                Continue
                              </Button>
                            </div>
                          ) : centeredPricingStep === "name" ? (
                            <div className="relative">
                              <Input
                                autoFocus
                                value={centeredPricingName}
                                onChange={(e) => setCenteredPricingName(e.target.value)}
                                placeholder="Jane Appleseed"
                                autoComplete="name"
                                className="h-7 rounded-xl border-0 bg-[var(--sif-lead-gen-input-bg)] px-3 pr-[34%] text-[0.75rem] text-[var(--sif-lead-gen-fg)] placeholder:text-[color:var(--sif-lead-gen-placeholder)] focus-visible:ring-2 focus-visible:ring-offset-0"
                                style={{ fontFamily: theme.fontFamily, ["--tw-ring-color" as any]: "var(--sif-lead-gen-ring)" }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleCenteredPricingNameSubmit();
                                }}
                              />
                              <Button
                                type="button"
                                size="sm"
                                disabled={isSubmittingCenteredPricingLead || !isValidFullName(centeredPricingName)}
                                onClick={() => void handleCenteredPricingNameSubmit()}
                                className="absolute right-0.5 top-1/2 flex h-6 -translate-y-1/2 items-center rounded-full border-0 bg-[var(--sif-lead-gen-action-bg)] px-2.5 text-[0.6875rem] font-medium leading-none text-[var(--sif-lead-gen-action-fg)] shadow-sm hover:brightness-[0.96]"
                                style={{ fontFamily: theme.fontFamily }}
                              >
                                Continue
                              </Button>
                            </div>
                          ) : (
                            <div className="relative">
                              <Phone className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sif-lead-gen-muted)]" />
                              <Input
                                autoFocus
                                value={centeredPricingPhone}
                                onChange={(e) => setCenteredPricingPhone(formatPhoneInput(e.target.value).display)}
                                placeholder="(555) 123-4567"
                                inputMode="tel"
                                className="h-7 rounded-xl border-0 bg-[var(--sif-lead-gen-input-bg)] pl-8 pr-[41%] text-[0.75rem] text-[var(--sif-lead-gen-fg)] placeholder:text-[color:var(--sif-lead-gen-placeholder)] focus-visible:ring-2 focus-visible:ring-offset-0"
                                style={{ fontFamily: theme.fontFamily, ["--tw-ring-color" as any]: "var(--sif-lead-gen-ring)" }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleCenteredPricingPhoneSubmit();
                                }}
                              />
                              <Button
                                type="button"
                                size="sm"
                                disabled={isSubmittingCenteredPricingLead}
                                onClick={() => void handleCenteredPricingPhoneSubmit()}
                                className="absolute right-0.5 top-1/2 flex h-6 -translate-y-1/2 items-center rounded-full border-0 bg-[var(--sif-lead-gen-action-bg)] px-2.5 text-[0.6875rem] font-medium leading-none text-[var(--sif-lead-gen-action-fg)] shadow-sm hover:brightness-[0.96]"
                                style={{ fontFamily: theme.fontFamily }}
                              >
                                {isSubmittingCenteredPricingLead ? <Loader2 className="h-4 w-4 animate-spin" /> : "Show pricing"}
                              </Button>
                            </div>
                          )}

                          {centeredPricingError ? (
                            <div className="text-[0.66rem] text-red-200">{centeredPricingError}</div>
                          ) : (
                            <div className="flex items-center justify-between gap-2 text-[0.66rem] text-[var(--sif-lead-gen-muted)]">
                              <span>
                                {centeredPricingStep === "email"
                                  ? "Instant reveal after sending."
                                  : centeredPricingStep === "name"
                                    ? "We won't save this information."
                                    : "We will never text you unless it's something worth it :)"}
                              </span>
                              {centeredPricingStep === "phone" ? (
                                <a
                                  href="/terms"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="shrink-0 underline underline-offset-2 hover:text-[var(--sif-lead-gen-fg)]"
                                  style={{ fontFamily: theme.fontFamily }}
                                >
                                  Terms
                                </a>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex w-full items-center justify-center px-[2.5%] py-[1.5%]">
                        <PricingExperience
                          variant="pill"
                          className="w-full border-0"
                          containerClassName="w-full px-[3%] py-[1%]"
                          label={pillLabel}
                          termsHref="/terms"
                          price={pillPrice}
                          loading={pillLoading}
                          lockedPrice={formattedAccuratePricingRange || formattedPricingRange || formattedSeedPricing || "$•••"}
                          revealed={leadGateEnabled ? leadCaptured : true}
                          allowToggle
                          autoReveal
                          transparentBackground
                          onClick={() => {
                            if (leadGateEnabled && !leadCaptured) {
                              setCenteredPricingError(null);
                              setCenteredPricingStep("email");
                              setShowCenteredPricingForm(true);
                              upsertLeadGate(sessionId, "design_and_estimate", { shownAt: Date.now() });
                              return;
                            }
                          }}
                          instanceId={undefined}
                          sessionId={undefined}
                          gateContext="design_and_estimate"
                          submissionData={{ surface: "inline_pricing" }}
                          requirePhone
                          onRevealed={() => {
                            setLeadCaptured(true);
                            void fetchAccuratePricing();
                          }}
                          accentColor={pillBg}
                          style={{ fontFamily: theme.fontFamily, backgroundColor: pillBg, ...pricingPillVars }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
	              </div>{/* end inner overflow-hidden container */}

              {/* Bottom controls row — keeps pricing reveal + budget slider aligned side-by-side. Hidden when lightbox open. Budget hidden when preview is dominant/large. */}
              {!lightboxOpen && shouldShowBottomControlsRow ? (
                <div className="absolute bottom-3 left-3 right-3 z-30 pointer-events-auto sm:left-4 sm:right-4 sm:bottom-4">
                  <div className="flex items-stretch gap-2 sm:gap-3">
		                    {hasBudgetOverlayControl ? (
		                      <div
		                        className="min-w-0 flex-1 h-[3.5rem] flex flex-col justify-center rounded-2xl px-3.5 py-2 backdrop-blur-md shadow-lg shadow-black/20"
		                        style={{
		                          backgroundColor: pillBg,
		                          backdropFilter: 'blur(12px)',
		                          WebkitBackdropFilter: 'blur(12px)',
		                        }}
		                      >
                        <style dangerouslySetInnerHTML={{ __html: `
                          input[data-budget-slider]::-webkit-slider-thumb:hover,
                          input[data-budget-slider]::-webkit-slider-thumb:active { background: white !important; filter: none !important; }
                          input[data-budget-slider]::-webkit-slider-runnable-track:hover { filter: none !important; opacity: 1 !important; }
                          input[data-budget-slider]::-moz-range-thumb:hover,
                          input[data-budget-slider]::-moz-range-thumb:active { background: white !important; filter: none !important; }
                          input[data-budget-slider]::-moz-range-track:hover { filter: none !important; opacity: 1 !important; }
                          input[data-budget-slider]:hover { accent-color: var(--slider-accent) !important; }
                        ` }} />
	                        <div className="flex items-center justify-between text-[0.6875rem] font-medium text-white/95">
	                          <span>Budget</span>
	                          <span aria-live="polite">
	                            {formatCurrency(liveBudget ?? budgetSliderBounds.min, {
	                              locale: pricingLocale,
	                              currency: (accuratePricing?.currency || pricingCurrency || "USD").toUpperCase(),
	                              compact: true,
	                            })}
	                          </span>
	                        </div>
	                        <input
                          type="range"
                          data-budget-slider
                          min={budgetSliderBounds.min}
                          max={budgetSliderBounds.max}
                          step={budgetSliderBounds.step}
                          value={liveBudget ?? budgetSliderBounds.min}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            setLiveBudget(n);
                            setLiveBudgetDirty(true);
                          }}
	                          className="mt-1 w-full h-1 rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb:hover]:!bg-white [&::-webkit-slider-thumb:hover]:!shadow [&::-webkit-slider-thumb:active]:!bg-white [&::-webkit-slider-thumb:active]:!shadow [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb:hover]:!bg-white [&::-moz-range-thumb:active]:!bg-white [&:hover]:[accent-color:var(--slider-accent)]"
	                          style={{
	                            accentColor: primary,
	                            ['--slider-accent' as string]: primary,
	                          } as React.CSSProperties}
	                          aria-label="Adjust budget and regenerate preview"
	                        />
	                        <div className="mt-1 flex items-center justify-between text-[0.6875rem] font-medium text-white/70">
	                          {budgetSliderLabels.map((label, i) => (
	                            <span key={i}>{label}</span>
	                          ))}
	                        </div>
	                      </div>
	                    ) : null}
				                    {shouldShowBottomPricingPill ? (
				                      <div
				                        data-pricing-pill
				                        className="@container ml-auto min-w-0 flex-1 flex flex-col rounded-2xl overflow-hidden shadow-lg shadow-black/25 backdrop-blur-md min-w-[8rem] transition-[max-width,padding] duration-300 ease-out"
			                        style={{
			                          maxWidth: 'clamp(45%, 72% - 7vw, 50%)',
			                          padding: 'clamp(0.25rem, 1.5vw, 0.625rem) clamp(0.5rem, 2vw, 0.625rem)',
			                          backgroundColor: pillBg,
			                          backdropFilter: 'blur(12px)',
			                          WebkitBackdropFilter: 'blur(12px)',
			                        }}
			                      >
				                          <PricingExperience
				                            variant="pill"
				                            className="w-full border-0"
				                            containerClassName="w-full min-w-0 px-1 py-0"
                            transparentBackground
                            label={pillLabel}
                          termsHref="/terms"
                          price={pillPrice}
                          loading={pillLoading}
                          lockedPrice={formattedAccuratePricingRange || formattedPricingRange || formattedSeedPricing || "$•••"}
                          revealed={leadGateEnabled ? leadCaptured : true}
                          allowToggle
                          autoReveal
                          instanceId={leadGateEnabled ? instanceId : undefined}
                          sessionId={leadGateEnabled ? sessionId : undefined}
                          gateContext="design_and_estimate"
                          submissionData={{ surface: "preview_pricing" }}
                          requirePhone
                          onRevealed={() => {
                            setLeadCaptured(true);
                            void fetchAccuratePricing();
                          }}
                          accentColor={pillBg}
                          style={{ fontFamily: theme.fontFamily, backgroundColor: pillBg, ...pricingPillVars }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

	              {/* Side navigation arrows — outside the clipped inner container */}
	              {hero && canPrev && (
	                <button
	                  type="button"
	                  onClick={goPrev}
	                  className="absolute left-0 top-1/2 -translate-y-1/2 z-30 flex h-16 w-8 sm:h-20 sm:w-9 items-center justify-center rounded-r-lg border-y border-r border-white/20 bg-black/25 text-3xl sm:text-4xl font-thin leading-none text-white/90 transition-colors hover:bg-black/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
	                  aria-label="Previous preview"
	                >
	                  ‹
	                </button>
	              )}
	              {hero && canNext && (
	                <button
	                  type="button"
	                  onClick={goNext}
	                  className="absolute right-0 top-1/2 -translate-y-1/2 z-30 flex h-16 w-8 sm:h-20 sm:w-9 items-center justify-center rounded-l-lg border-y border-l border-white/20 bg-black/25 text-3xl sm:text-4xl font-thin leading-none text-white/90 transition-colors hover:bg-black/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
	                  aria-label="Next preview"
	                >
	                  ›
	                </button>
	              )}

	              {/* Pagination dots — only in dominant/full-screen layout where there's no room for a strip below */}
	              {runs.length > 1 && hero && isDominantLayout && (
	                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 pointer-events-none">
	                  {runs.map((_, idx) => (
	                    <div
	                      key={idx}
	                      className={cn(
	                        "h-1.5 rounded-full transition-all duration-200",
	                        idx === activeIndex ? "w-4 bg-white shadow" : "w-1.5 bg-white/45"
	                      )}
	                    />
	                  ))}
	                </div>
	              )}
	            </motion.div>{/* end outer stack wrapper */}

              {/* Upload section below image — folds in smoothly once image is ready (no jarring layout push) */}
              <AnimatePresence initial={false}>
                {hero && !busy && isDominantLayout && (!leadGateEnabled || leadCaptured) ? (
                  <motion.div
                    key="upload-section"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                  >
                      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <button
                      type="button"
                      disabled={isUploadingOwnImages}
                      onClick={handleUploadClick}
                      className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium transition-colors hover:bg-primary/10"
                      style={{
                        fontFamily: theme.fontFamily,
                        color: theme.primaryColor || "#3b82f6",
                      }}
                    >
                      {isUploadingOwnImages ? "Uploading…" : "Upload your own image!"}
                    </button>
                    <button
                      type="button"
                      onClick={handleSkipContinue}
                      className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
                      style={{ fontFamily: theme.fontFamily }}
                    >
                      Skip and keep playing around
                    </button>
                  </div>
                        </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

            </div>
	          </CardContent>
	        </Card>
	      </div>

      <AnimatePresence initial={false}>
        {lightboxOpen && hero ? (
          <motion.div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 overscroll-contain touch-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={closeLightbox}
          >
            <motion.div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            />

            <motion.div
              layoutId={lightboxLayoutId}
              layout
              className="relative w-full aspect-square overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10"
              style={{
                // Keep the expanded square fully inside the viewport, even on very wide screens.
                maxWidth: "min(80rem, calc(100dvh - clamp(2rem, 8vw, 4rem)))",
                maxHeight: "calc(100dvh - clamp(2rem, 8vw, 4rem))",
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onLayoutAnimationComplete={() => setLightboxContain(true)}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/70 via-black/35 to-transparent px-3 py-3 sm:px-4">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white/95">Expanded preview</div>
                  <div className="text-[0.6875rem] text-white/75">Press Esc or click outside to close</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 rounded-full px-3 text-[0.6875rem] font-medium text-white hover:opacity-90"
                    style={{
                      backgroundColor: darkenHex(primary, 0.5),
                      borderColor: hexToRgba(primary, 0.4) || "rgba(255,255,255,0.2)",
                    }}
                    onClick={() => setLightboxContain((prev) => !prev)}
                    aria-label={lightboxContain ? "Switch to fill mode" : "Switch to fit mode"}
                  >
                    {lightboxContain ? "Fill" : "Fit"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-9 w-9 rounded-full text-white hover:opacity-90"
                    style={{
                      backgroundColor: darkenHex(primary, 0.5),
                      borderColor: hexToRgba(primary, 0.4) || "rgba(255,255,255,0.2)",
                    }}
                    onClick={closeLightbox}
                    aria-label="Close expanded preview"
                  >
                    <span className="text-xl leading-none">&times;</span>
                  </Button>
                </div>
              </div>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hero}
                alt="Preview"
                className={cn(
                  "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
                  lightboxContain ? "opacity-0" : "opacity-100"
                )}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hero}
                alt="Preview (full)"
                className={cn(
                  "absolute inset-0 h-full w-full object-contain transition-opacity duration-300",
                  lightboxContain ? "opacity-100" : "opacity-0"
                )}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 py-3 text-[0.6875rem] text-white/80 sm:px-4">
                {lightboxContain ? "Fit mode: shows the full image." : "Fill mode: crops edges to fill the frame."}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

        </>
      </LayoutGroup>
  );
  }
  return renderPreview();
}
