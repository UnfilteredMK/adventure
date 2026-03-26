"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useFormTheme } from "@/components/form/demo/FormThemeProvider";
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

function withAlpha(color: string, alpha: number): string {
  const c = String(color || "").trim();
  const a = Math.max(0, Math.min(1, alpha));
  if (!c) return `rgba(15, 23, 42, ${a})`;
  const rgba = c.startsWith("#") ? hexToRgba(c, a) : null;
  if (rgba) return rgba;
  const pct = Math.round(a * 100);
  return `color-mix(in srgb, ${c} ${pct}%, transparent)`;
}

type LeadGenPayload = {
  email: string;
  name?: string;
  phone?: string;
};

interface LeadGenModalProps {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  sessionId: string;
  gateContext: string;
  requireTerms?: boolean;
  requirePhone?: boolean;
  onSubmitted?: (data: LeadGenPayload) => void;
}

type StoredDraft = {
  step: 0 | 1;
  fullName: string;
  email: string;
  phone: string;
  termsAccepted: boolean;
  lastUpdated: number;
};

function storageKey(instanceId: string, sessionId: string) {
  return `lead_gen_draft:v1:${instanceId}:${sessionId}`;
}

function legacyStorageKey(instanceId: string, sessionId: string) {
  return `lead_gem_draft:v1:${instanceId}:${sessionId}`;
}

function formStateStorageKey(sessionId: string) {
  return `formState:${sessionId}`;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  return null;
}

function extractFirstName(fullNameRaw: unknown): string | null {
  const full = normalizeOptionalString(fullNameRaw);
  if (!full) return null;
  const first = full.split(/\s+/).filter(Boolean)[0] || "";
  return first ? first : null;
}

function emitFormStateUpdated(sessionId: string, patch?: Record<string, any>) {
  if (!sessionId || typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("sif_form_state_updated", { detail: { sessionId, ...(patch ? { patch } : {}) } }));
  } catch {}
}

function upsertFormState(sessionId: string, patch: Record<string, any>) {
  if (!sessionId || typeof window === "undefined") return;
  try {
    const key = formStateStorageKey(sessionId);
    const raw = window.localStorage.getItem(key);
    const base = raw ? JSON.parse(raw) : {};
    const next: Record<string, any> = base && typeof base === "object" ? { ...(base as any) } : {};
    Object.assign(next, patch);
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {}
  emitFormStateUpdated(sessionId, patch);
}

function upsertLeadGate(sessionId: string, gateContext: string, patch: { shownAt?: number; completedAt?: number; dismissedAt?: number }) {
  if (!sessionId || typeof window === "undefined") return;
  let leadGates: Record<string, any> | null = null;
  try {
    const key = formStateStorageKey(sessionId);
    const raw = window.localStorage.getItem(key);
    const base = raw ? JSON.parse(raw) : {};
    const next: Record<string, any> = base && typeof base === "object" ? { ...(base as any) } : {};
    const existing = next.leadGates && typeof next.leadGates === "object" ? { ...(next.leadGates as any) } : {};
    const current = existing[gateContext] && typeof existing[gateContext] === "object" ? { ...existing[gateContext] } : {};
    existing[gateContext] = { ...current, ...patch };
    next.leadGates = existing;
    leadGates = next.leadGates;
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {}
  emitFormStateUpdated(sessionId, leadGates ? { leadGates } : undefined);
}

function loadPrefillFromFormState(sessionId: string): { fullName: string; email: string; phone: string } {
  if (!sessionId || typeof window === "undefined") return { fullName: "", email: "", phone: "" };
  try {
    const raw = window.localStorage.getItem(formStateStorageKey(sessionId));
    if (!raw) return { fullName: "", email: "", phone: "" };
    const parsed = JSON.parse(raw);
    const fullName = normalizeOptionalString((parsed as any)?.userFullName) ?? "";
    const email = normalizeOptionalString((parsed as any)?.leadEmail) ?? "";
    const phone = normalizeOptionalString((parsed as any)?.leadPhone) ?? "";
    return { fullName, email, phone };
  } catch {
    return { fullName: "", email: "", phone: "" };
  }
}

function loadDraft(instanceId: string, sessionId: string): StoredDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(storageKey(instanceId, sessionId)) ??
      window.localStorage.getItem(legacyStorageKey(instanceId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      step: (parsed as any)?.step === 1 ? 1 : 0,
      fullName: normalizeOptionalString((parsed as any)?.fullName) ?? "",
      email: normalizeOptionalString((parsed as any)?.email) ?? "",
      phone: normalizeOptionalString((parsed as any)?.phone) ?? "",
      termsAccepted: Boolean((parsed as any)?.termsAccepted),
      lastUpdated: Number((parsed as any)?.lastUpdated) || Date.now(),
    };
  } catch {
    return null;
  }
}

function saveDraft(instanceId: string, sessionId: string, draft: StoredDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(instanceId, sessionId), JSON.stringify(draft));
  } catch {}
}

export function LeadGenModal({
  open,
  onClose,
  instanceId,
  sessionId,
  gateContext,
  requireTerms = true,
  requirePhone = false,
  onSubmitted,
}: LeadGenModalProps) {
  const { theme } = useFormTheme();
  const { submitForm, isSubmitting, checkStep2Completion } = useFormSubmission({ instanceId, sessionId });
  const [isAvailable, setIsAvailable] = useState(true);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);

  const [step, setStep] = useState<0 | 1>(0);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveTimerRef = useRef<number | null>(null);

  const firstName = useMemo(() => extractFirstName(fullName), [fullName]);
  const canSubmitName = normalizeOptionalString(fullName) !== null;
  const canSubmitEmail = Boolean(normalizeOptionalString(email)?.includes("@"));
  const canSubmitPhone = !requirePhone || Boolean(normalizeOptionalString(phone));
  const canSubmitTerms = !requireTerms || termsAccepted;
  const canContinue = step === 0 ? canSubmitName : canSubmitEmail && canSubmitPhone && canSubmitTerms;

  const debouncedSave = useCallback(
    (patch: Partial<StoredDraft>) => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        const next: StoredDraft = {
          step,
          fullName,
          email,
          phone,
          termsAccepted,
          lastUpdated: Date.now(),
          ...patch,
        };
        saveDraft(instanceId, sessionId, next);
      }, 250);
    },
    [email, fullName, instanceId, phone, sessionId, step, termsAccepted]
  );

  useEffect(() => {
    if (!open) return;
    upsertLeadGate(sessionId, gateContext, { shownAt: Date.now() });

    // Prefill from FormState, then draft; draft wins.
    const prefill = loadPrefillFromFormState(sessionId);
    const draft = loadDraft(instanceId, sessionId);
    const initialFullName = (draft?.fullName || prefill.fullName || "").trim();
    const initialEmail = (draft?.email || prefill.email || "").trim();
    const initialPhone = (draft?.phone || prefill.phone || "").trim();
    const initialTerms = Boolean(draft?.termsAccepted);
    const initialStep: 0 | 1 =
      draft?.step ??
      (normalizeOptionalString(initialFullName) ? 1 : 0);

    setFullName(initialFullName);
    setEmail(initialEmail);
    setPhone(initialPhone);
    setTermsAccepted(initialTerms);
    setStep(initialStep);
    setError(null);

    // If already submitted in DB, mark lead captured locally to avoid re-gating.
    void checkStep2Completion()
      .then((ok) => {
        if (ok) {
          const now = Date.now();
          upsertFormState(sessionId, { leadCaptured: true, leadCapturedAt: now, leadEmail: initialEmail || null });
          upsertLeadGate(sessionId, gateContext, { completedAt: now });
        }
      })
      .catch(() => {});
  }, [checkStep2Completion, gateContext, instanceId, open, sessionId]);

  useEffect(() => {
    if (!open) return;
    setAvailabilityChecked(false);
    (async () => {
      try {
        const res = await fetch(`/api/leads/availability/${encodeURIComponent(instanceId)}`);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          setIsAvailable(Boolean((data as any)?.available ?? true));
        } else {
          setIsAvailable(true);
        }
      } catch {
        setIsAvailable(true);
      } finally {
        setAvailabilityChecked(true);
      }
    })();
  }, [instanceId, open]);

  useEffect(() => {
    if (!open) return;
    debouncedSave({});
  }, [debouncedSave, email, fullName, open, phone, termsAccepted]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  const close = useCallback(() => {
    upsertLeadGate(sessionId, gateContext, { dismissedAt: Date.now() });
    onClose();
  }, [gateContext, onClose, sessionId]);

  const handleContinue = useCallback(async () => {
    setError(null);
    if (!availabilityChecked || !isAvailable) return;
    if (!canContinue) return;

    if (step === 0) {
      const nowName = fullName.trim();
      if (nowName) {
        upsertFormState(sessionId, { userFullName: nowName, userFirstName: extractFirstName(nowName) });
      }
      setStep(1);
      debouncedSave({ step: 1 as const });
      return;
    }

    const payload: LeadGenPayload = {
      email: email.trim(),
      name: fullName.trim() || undefined,
      phone: phone.trim() || undefined,
    };

    const now = Date.now();
    upsertFormState(sessionId, {
      ...(payload.name ? { userFullName: payload.name, userFirstName: extractFirstName(payload.name) } : {}),
    });

    const result = await submitForm({
      email: payload.email,
      name: payload.name,
      phone: payload.phone,
      isPartial: false,
      submissionData: { gateContext },
    });

    if (!result.success) {
      setError(result.message || "Failed to submit. Please try again.");
      return;
    }

    upsertFormState(sessionId, { leadCaptured: true, leadCapturedAt: now, leadEmail: payload.email || null });
    upsertLeadGate(sessionId, gateContext, { completedAt: now });

    onSubmitted?.(payload);
    onClose();
  }, [availabilityChecked, canContinue, debouncedSave, email, fullName, gateContext, isAvailable, onClose, onSubmitted, phone, sessionId, step, submitForm]);

  const progressPct = step === 0 ? 45 : 85;
  const accent = (theme.primaryColor || "#3b82f6").trim();
  const secondary = (theme.secondaryColor || accent).trim();
  const popBg = "var(--form-surface-color, rgba(255,255,255,0.97))";
  const popBorder = withAlpha(accent, 0.22);
  const ring = withAlpha(accent, 0.35);
  const inputBorder = withAlpha(accent, 0.22);
  const iconMuted = withAlpha(theme.textColor || "#0f172a", 0.62);
  const popRadiusPx = Math.max(Number(theme.borderRadius ?? 14), 14);
  const closeBg = withAlpha(secondary, 0.18);
  const closeHoverBg = withAlpha(secondary, 0.26);

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : close())}>
      <DialogContent
        className={[
          "!w-[88vw] sm:!w-[22rem] max-w-none p-0 border-0 bg-transparent shadow-none overflow-visible",
          // Theme the default Radix close button injected by DialogContent (direct child).
          "[&>button]:rounded-full [&>button]:opacity-90 hover:[&>button]:opacity-100 [&>button]:ring-offset-0",
          "[&>button]:bg-[var(--sif-lead-close-bg)] hover:[&>button]:bg-[var(--sif-lead-close-hover-bg)]",
          "[&>button>svg]:text-[var(--sif-lead-close-fg)]",
          "[&>button]:focus-visible:ring-2 [&>button]:focus-visible:ring-[color:var(--sif-lead-ring)]",
        ].join(" ")}
        style={
          {
            ["--sif-lead-close-bg" as any]: closeBg,
            ["--sif-lead-close-hover-bg" as any]: closeHoverBg,
            ["--sif-lead-close-fg" as any]: iconMuted,
            ["--sif-lead-ring" as any]: ring,
          } as React.CSSProperties
        }
      >
        <div
          className="relative overflow-hidden p-6"
          style={{
            fontFamily: theme.fontFamily,
            backgroundColor: popBg,
            border: `1px solid ${popBorder}`,
            borderRadius: `${popRadiusPx}px`,
          }}
        >
          {/* Subtle theme glow */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(1200px 520px at 20% 0%, ${withAlpha(accent, 0.16)}, transparent 55%), radial-gradient(900px 420px at 95% 20%, ${withAlpha(secondary, 0.14)}, transparent 60%)`,
            }}
            aria-hidden
          />

          <div className="relative">
          <div className="mb-4">
            <div
              className="h-1.5 w-full rounded-full overflow-hidden"
              style={{ backgroundColor: withAlpha(theme.textColor || "#0f172a", 0.10) }}
            >
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                style={{ backgroundColor: accent }}
              />
            </div>
          </div>

          <DialogHeader>
            <DialogTitle style={{ color: theme.textColor }}>
              {step === 0 ? "Quick question" : "Where should we send it?"}
            </DialogTitle>
            <DialogDescription style={{ color: theme.textColor, opacity: 0.8 }}>
              {step === 0
                ? "To make this more personalized, what’s your name?"
                : "We’ll email your design preview and updated estimate so you can revisit it anytime."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            {!availabilityChecked ? (
              <div
                className="rounded-lg border p-3"
                style={{ backgroundColor: withAlpha(popBg, 0.72), borderColor: popBorder }}
              >
                <div className="flex items-center gap-2 text-sm" style={{ color: theme.textColor }}>
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: accent }} />
                  Checking availability…
                </div>
              </div>
            ) : !isAvailable ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                We’re not accepting new submissions right now.
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
            ) : null}

            <AnimatePresence mode="wait" initial={false}>
              {step === 0 ? (
                <motion.div
                  key="step-name"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2"
                >
                  <div className="text-sm font-medium" style={{ color: theme.textColor }}>
                    Full name
                  </div>
                  <Input
                    autoFocus
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      debouncedSave({ fullName: e.target.value });
                    }}
                    placeholder="e.g. Jon Smith"
                    className="h-11"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleContinue();
                    }}
                    style={{
                      fontFamily: theme.fontFamily,
                      borderColor: inputBorder,
                      backgroundColor: withAlpha(popBg, 0.78),
                      color: theme.textColor,
                      boxShadow: "none",
                    }}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="step-email"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-3"
                >
                  <div
                    className="rounded-xl border p-3"
                    style={{ backgroundColor: withAlpha(popBg, 0.72), borderColor: popBorder }}
                  >
                    <div className="text-xs font-medium" style={{ color: theme.textColor, opacity: 0.8 }}>
                      {firstName ? `Nice to meet you, ${firstName}.` : "Nice to meet you."}
                    </div>
                    <div className="text-xs" style={{ color: theme.textColor, opacity: 0.7 }}>
                      We’ll send your design & estimate to your email.
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium" style={{ color: theme.textColor }}>
                      Email
                    </div>
                    <Input
                      autoFocus
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        debouncedSave({ email: e.target.value });
                      }}
                      placeholder="you@company.com"
                      className="h-11"
                      inputMode="email"
                      style={{
                        fontFamily: theme.fontFamily,
                        borderColor: inputBorder,
                        backgroundColor: withAlpha(popBg, 0.78),
                        color: theme.textColor,
                        boxShadow: "none",
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium" style={{ color: theme.textColor }}>
                      Phone {requirePhone ? "" : <span className="opacity-60">(optional)</span>}
                    </div>
                    <Input
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        debouncedSave({ phone: e.target.value });
                      }}
                      placeholder="(555) 123-4567"
                      className="h-11"
                      inputMode="tel"
                      style={{
                        fontFamily: theme.fontFamily,
                        borderColor: inputBorder,
                        backgroundColor: withAlpha(popBg, 0.78),
                        color: theme.textColor,
                        boxShadow: "none",
                      }}
                    />
                  </div>

                  {requireTerms ? (
                    <label
                      className="flex items-start gap-2 rounded-lg border p-3 cursor-pointer"
                      style={{ backgroundColor: withAlpha(popBg, 0.72), borderColor: popBorder }}
                    >
                      <input
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(e) => setTermsAccepted(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300"
                        style={{ accentColor: accent }}
                      />
                      <div className="text-xs" style={{ color: theme.textColor, opacity: 0.8 }}>
                        I agree to be contacted about my design and estimate.
                      </div>
                    </label>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="pt-2 flex items-center justify-between gap-3">
              {step === 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep(0)}
                  disabled={isSubmitting}
                  className="hover:bg-transparent"
                  style={{ color: withAlpha(theme.textColor || "#0f172a", 0.78), fontFamily: theme.fontFamily }}
                >
                  Back
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={close}
                  disabled={isSubmitting}
                  className="hover:bg-transparent"
                  style={{ color: withAlpha(theme.textColor || "#0f172a", 0.78), fontFamily: theme.fontFamily }}
                >
                  Not now
                </Button>
              )}

              <Button
                type="button"
                onClick={() => void handleContinue()}
                disabled={!availabilityChecked || !isAvailable || !canContinue || isSubmitting}
                className="min-w-[160px]"
                style={{ backgroundColor: accent, fontFamily: theme.fontFamily }}
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </span>
                ) : step === 0 ? (
                  "Continue"
                ) : (
                  "Send me my design"
                )}
              </Button>
            </div>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
