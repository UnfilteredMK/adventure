"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { designThemes, getCompleteTheme, type DesignSettings } from "@mage/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useAccount } from "@/contexts/AccountContext";
import { useAuth } from "@/contexts/AuthContext";
import { toSubcategorySlug } from "@/utils/slug";
import { formatSubcategoryLabel } from "@/utils/subcategory";
import { PLAYGROUND_PRESETS } from "@/config/playground-presets";

type PlaygroundView = "internal" | "form";
type ServiceOption = {
  id: string;
  label: string;
  slug: string;
  demoThemeKey?: string | null;
  demoTemplateConfig?: Record<string, any> | null;
};

type ThemeOption = {
  key: string;
  name: string;
  description?: string;
  theme: (typeof designThemes)[number];
};

function slugifyThemeKey(name: string) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const THEME_OPTIONS: ThemeOption[] = designThemes.map((t) => ({
  key: slugifyThemeKey(t.name),
  name: t.name,
  description: t.description,
  theme: t,
}));

const THEME_BY_KEY = new Map<string, ThemeOption>(THEME_OPTIONS.map((o) => [o.key, o]));

const THEME_PATCH_KEYS: Array<keyof DesignSettings> = [
  "primary_color",
  "secondary_color",
  "background_color",
  "sidebar_background_color",
  "prompt_background_color",
  "prompt_border_style",
  "prompt_border_color",
  "prompt_border_width",
  "prompt_border_radius",
  "prompt_text_color",
  "prompt_placeholder_color",
  "prompt_input_background_color",
  "prompt_input_border_style",
  "prompt_input_border_color",
  "prompt_input_border_width",
  "prompt_input_border_radius",
  "prompt_input_text_color",
  "prompt_input_placeholder_color",
  "submit_button_background_color",
  "submit_button_hover_background_color",
  "submit_button_text_color",
  "uploader_background_color",
  "iframe_border_color",
  "gallery_container_border_color",
  "gallery_image_border_color",
  "suggestion_background_color",
  "suggestion_border_color",
  "suggestion_text_color",
  "overlay_background_color",
];

function pickThemePatch(full: DesignSettings): Partial<DesignSettings> {
  const patch: Partial<DesignSettings> = {};
  for (const key of THEME_PATCH_KEYS) {
    const value = full[key];
    if (value !== undefined) (patch as any)[key] = value;
  }
  return patch;
}

function useUpdateQueryParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (next: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      for (const [key, value] of Object.entries(next)) {
        if (value == null || value === "") params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
}

function ServiceCombobox({
  disabled,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  onChange: (slug: string) => void;
  options: ServiceOption[];
  value: string | null;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((x) => x.slug === value) || null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between rounded-full"
        >
          <span className="truncate">
            {selected ? selected.label : options.length > 0 ? "Select a service…" : "Loading services…"}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search services…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isSelected = opt.slug === value;
                return (
                  <CommandItem
                    key={opt.slug}
                    value={`${opt.label} ${opt.slug}`}
                    onSelect={() => {
                      onChange(opt.slug);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function PlaygroundClient() {
  const { session } = useAuth();
  const { currentAccount } = useAccount();
  const searchParams = useSearchParams();
  const updateQuery = useUpdateQueryParams();

  const initialViewRaw = String(searchParams?.get("view") || "").trim().toLowerCase();
  // Back-compat: `view=widget` used to mean internal mode.
  const initialView: PlaygroundView = initialViewRaw === "form" ? "form" : "internal";
  const initialService = searchParams?.get("service");
  const initialTheme = searchParams?.get("theme");

  const [view, setView] = useState<PlaygroundView>(initialView);
  const [service, setService] = useState<string | null>(initialService);
  const [themeKey, setThemeKey] = useState<string>(() => {
    const cleaned = slugifyThemeKey(String(initialTheme || ""));
    if (cleaned && THEME_BY_KEY.has(cleaned)) return cleaned;
    // Back-compat: allow passing the raw theme name.
    const byName = THEME_OPTIONS.find((t) => slugifyThemeKey(t.name) === cleaned);
    return byName?.key || THEME_OPTIONS[0]?.key || "modern-light";
  });

  const [demoWidgetInstanceId, setDemoWidgetInstanceId] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeReadyRef = useRef(false);
  const resendTimerRef = useRef<number | null>(null);
  const latestThemeRef = useRef<Partial<DesignSettings> | null>(null);

  const PLAYGROUND_MAX_GENERATIONS = 3;

  const playgroundSessionId = useMemo(() => {
    // Per-tab session id (resets when the tab is closed)
    if (typeof window === "undefined") return "server";
    const key = "sif_playground_session_id";
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const next = `pg_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    window.sessionStorage.setItem(key, next);
    return next;
  }, []);

  const playgroundDeviceId = useMemo(() => {
    // Per-device id (persists across tabs)
    if (typeof window === "undefined") return "server";
    const key = "sif_playground_device_id";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = `dev_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    window.localStorage.setItem(key, next);
    return next;
  }, []);

  useEffect(() => {
    // Normalize legacy query params.
    if (initialViewRaw === "widget") {
      updateQuery({ view: "internal" });
    }
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [demoWidgetRes, catsRes] = await Promise.all([
          // Playground always uses the unified runtime route: `/adventure/:instanceId`.
          // The "experience" is driven by config presets, not flow_config.
          fetch(`/api/public/demo-instance?type=industry&excludeFlowConfig=1`, { cache: "no-store" }),
          fetch(`/api/public/categories?ts=${Date.now()}`, { cache: "no-store" }),
        ]);

        if (!demoWidgetRes.ok) {
          const j = await demoWidgetRes.json().catch(() => null);
          throw new Error(j?.error || "Failed to load demo instance.");
        }
        if (!catsRes.ok) {
          throw new Error("Failed to load services.");
        }

        const demoWidgetJson = await demoWidgetRes.json();
        const catsJson = await catsRes.json();

        const bySlug = new Map<string, ServiceOption>();
        const seenLabels = new Set<string>();
        for (const c of catsJson.categories || []) {
          for (const s of c.categories_subcategories || []) {
            const id = String(s.id || "");
            const rawSlug = String(s.slug || "");
            const canonicalSlug = rawSlug || toSubcategorySlug(String(s.subcategory || ""));
            if (!id || !canonicalSlug || bySlug.has(canonicalSlug)) continue;
            const label = formatSubcategoryLabel(String(s.subcategory || canonicalSlug));
            const labelKey = label.trim().toLowerCase();
            if (!labelKey || seenLabels.has(labelKey)) continue;
            seenLabels.add(labelKey);
            bySlug.set(canonicalSlug, {
              id,
              label,
              slug: canonicalSlug,
              demoThemeKey: (s.demo_theme_key as string | null) ?? null,
              demoTemplateConfig: (s.demo_template_config as any) ?? null,
            });
          }
        }
        const nextServices = Array.from(bySlug.values()).sort((a, b) => a.label.localeCompare(b.label));

        if (cancelled) return;
        setDemoWidgetInstanceId(String(demoWidgetJson.instanceId));
        setServices(nextServices);

        // Default service: query param -> current state -> first option
        const nextDefault =
          (initialService && bySlug.has(initialService) ? initialService : null) || service || nextServices[0]?.slug || null;
        setService(nextDefault);
        if (nextDefault) updateQuery({ service: nextDefault });
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Failed to load Playground.");
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const widgetHost = useMemo(() => {
    const raw = (process.env.NEXT_PUBLIC_WIDGET_URL || "").trim();
    if (!raw) return "";
    return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  }, []);

  const widgetOrigin = useMemo(() => {
    try {
      return new URL(widgetHost || "http://localhost:3001").origin;
    } catch {
      return null;
    }
  }, [widgetHost]);

  const selectedServiceId = useMemo(() => {
    if (!service) return null;
    return services.find((s) => s.slug === service)?.id || null;
  }, [service, services]);

  const selectedService = useMemo(() => {
    if (!service) return null;
    return services.find((s) => s.slug === service) || null;
  }, [service, services]);

  const selectedDemoTemplateConfig = useMemo<Partial<DesignSettings>>(() => {
    const raw = selectedService?.demoTemplateConfig;
    if (!raw || typeof raw !== "object") return {};
    return raw as any;
  }, [selectedService?.demoTemplateConfig]);

  const selectedThemeSettings = useMemo<Partial<DesignSettings>>(() => {
    const opt = THEME_BY_KEY.get(themeKey) || THEME_OPTIONS[0] || null;
    if (!opt) return {};
    const full = getCompleteTheme(opt.theme as any);
    return pickThemePatch(full);
  }, [themeKey]);

  const selectedPlaygroundPreset = useMemo<Partial<DesignSettings>>(() => {
    return PLAYGROUND_PRESETS[view] || {};
  }, [view]);

  const selectedConfigPatch = useMemo<Partial<DesignSettings>>(() => {
    // Base demo template -> mode preset -> theme colors (theme wins on conflicts).
    const merged: Partial<DesignSettings> = {
      ...selectedDemoTemplateConfig,
      ...selectedPlaygroundPreset,
      ...selectedThemeSettings,
    };

    // Fallback title: if the vertical doesn't provide a brand/title, use "Acme" + service name.
    const currentName = String((merged as any).brand_name || "").trim();
    const serviceLabel = String(selectedService?.label || service || "").trim();
    if (!currentName) {
      (merged as any).brand_name_enabled = true;
      (merged as any).brand_name = serviceLabel ? `Acme — ${serviceLabel}` : "Acme";
    }
    return merged;
  }, [selectedDemoTemplateConfig, selectedPlaygroundPreset, selectedThemeSettings, selectedService?.label, service]);

  const selectedThemeFull = useMemo<DesignSettings | null>(() => {
    const opt = THEME_BY_KEY.get(themeKey) || THEME_OPTIONS[0] || null;
    if (!opt) return null;
    return getCompleteTheme(opt.theme as any);
  }, [themeKey]);

  const themePatchForKey = useCallback((key: string): Partial<DesignSettings> => {
    const opt = THEME_BY_KEY.get(key) || THEME_OPTIONS[0] || null;
    if (!opt) return {};
    return pickThemePatch(getCompleteTheme(opt.theme as any));
  }, []);

  const sendThemeOnce = useCallback(
    (settings: Partial<DesignSettings>) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || !widgetOrigin) return;
      // Compatibility payload: some runtimes may expect `config`, others `design` / `designConfig`.
      const payload = { config: settings, design: settings, designConfig: settings, timestamp: Date.now() };
      // Single source of truth: config (flow_config is deprecated).
      win.postMessage({ type: "UPDATE_CONFIG", ...payload }, widgetOrigin);
    },
    [widgetOrigin],
  );

  const scheduleThemeSend = useCallback(
    (settings: Partial<DesignSettings>) => {
      latestThemeRef.current = settings;
      iframeReadyRef.current = false;

      if (resendTimerRef.current) {
        window.clearTimeout(resendTimerRef.current);
        resendTimerRef.current = null;
      }

      let attempts = 0;
      const attempt = () => {
        const cfg = latestThemeRef.current;
        if (!cfg) return;
        if (!iframeRef.current?.contentWindow) {
          attempts += 1;
          if (attempts < 20) {
            resendTimerRef.current = window.setTimeout(attempt, 100);
          }
          return;
        }

        sendThemeOnce(cfg);
        attempts += 1;
        if (!iframeReadyRef.current && attempts < 10) {
          resendTimerRef.current = window.setTimeout(attempt, 150);
        }
      };

      resendTimerRef.current = window.setTimeout(attempt, 50);
    },
    [sendThemeOnce, view],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!widgetOrigin || e.source !== iframeRef.current?.contentWindow || e.origin !== widgetOrigin) return;
      const data: any = e.data;
      if (!data || typeof data !== "object") return;
      const type = String(data.type || "");
      if (
        type === "WIDGET_READY" ||
        type === "FORM_READY" ||
        type === "UPDATE_CONFIG_ACK" ||
        type === "UPDATE_FLOW_CONFIG_ACK" ||
        type === "SIF_PLAYGROUND_THEME_ACK"
      ) {
        iframeReadyRef.current = true;
        if (resendTimerRef.current) {
          window.clearTimeout(resendTimerRef.current);
          resendTimerRef.current = null;
        }
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (resendTimerRef.current) {
        window.clearTimeout(resendTimerRef.current);
        resendTimerRef.current = null;
      }
    };
  }, [widgetOrigin]);

  const previewUrl = useMemo(() => {
    if (!demoWidgetInstanceId) return null;
    const base = widgetHost || "http://localhost:3001";
    const slug = service || "interior-design";
    if (view === "form") {
      const u = new URL(`/adventure/${demoWidgetInstanceId}`, base);
      u.searchParams.set("embed", "1");
      u.searchParams.set("surface", "embed");
      u.searchParams.set("fresh", "1");
      u.searchParams.set("autostart", "1");
      // Playground cap (device + session) — enforced by runtime.
      u.searchParams.set("playground", "1");
      u.searchParams.set("playgroundSessionId", playgroundSessionId);
      u.searchParams.set("playgroundDeviceId", playgroundDeviceId);
      u.searchParams.set("maxSubmissions", String(PLAYGROUND_MAX_GENERATIONS));
      if (selectedServiceId) u.searchParams.set("serviceId", selectedServiceId);
      else u.searchParams.set("service", slug);
      return u.toString();
    }
    const u = new URL(`/adventure/${demoWidgetInstanceId}`, base);
    u.searchParams.set("demo", "true");
    u.searchParams.set("embed", "1");
    u.searchParams.set("surface", "embed");
    // Playground cap (device + session) — enforced by runtime.
    u.searchParams.set("playground", "1");
    u.searchParams.set("playgroundSessionId", playgroundSessionId);
    u.searchParams.set("playgroundDeviceId", playgroundDeviceId);
    u.searchParams.set("maxSubmissions", String(PLAYGROUND_MAX_GENERATIONS));
    // IMPORTANT: demo instance is only a shell for an ID; content should be driven by the chosen service/subcategory.
    // This makes the runtime load subcategory-specific sample data (e.g., sample company names) correctly.
    if (selectedServiceId) u.searchParams.set("serviceId", selectedServiceId);
    else u.searchParams.set("service", slug);
    return u.toString();
  }, [
    demoWidgetInstanceId,
    playgroundDeviceId,
    playgroundSessionId,
    selectedServiceId,
    service,
    view,
    widgetHost,
  ]);

  useEffect(() => {
    if (!iframeLoaded) return;
    scheduleThemeSend(selectedConfigPatch);
  }, [iframeLoaded, scheduleThemeSend, selectedConfigPatch]);

  useEffect(() => {
    if (!previewUrl || view !== "form") return;
    // Reduce theme flash before the iframe finishes booting.
    scheduleThemeSend(selectedConfigPatch);
  }, [previewUrl, scheduleThemeSend, selectedConfigPatch, view]);

  useEffect(() => {
    setIframeLoaded(false);
  }, [previewUrl]);

  const openInNewTabHref = previewUrl;
  const backHref = session?.user
    ? currentAccount?.id
      ? `/${currentAccount.id}/designer-instances`
      : "/accounts"
    : "/";

  return (
    <div className="h-[100dvh] w-full bg-background text-foreground overflow-hidden grid grid-rows-[auto_minmax(0,1fr)]">
      {/* Simple top navbar */}
      <div className="w-full border-b bg-background/75 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-[env(safe-area-inset-top)]">
        <div className="w-full px-3 sm:px-6">
          <div className="h-14 flex items-center justify-between gap-3">
          <Button asChild className="rounded-full" variant="ghost">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" />
              <span className="ml-2">{session?.user ? "Back to Designer" : "Back"}</span>
            </Link>
          </Button>

          <div className="flex items-center gap-2">
            {openInNewTabHref ? (
              <Button asChild className="rounded-full hidden sm:inline-flex" variant="outline">
                <a href={openInNewTabHref} rel="noreferrer" target="_blank">
                  Open preview <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            ) : null}

            <Popover onOpenChange={setControlsOpen} open={controlsOpen}>
              <PopoverTrigger asChild>
                <Button className="rounded-full" type="button" variant="outline">
                  Controls <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[360px] p-4">
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-semibold leading-none">Playground</div>
                    <div className="mt-1 text-xs text-muted-foreground">Choose a service and toggle the preview mode.</div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground px-1">Service offered</div>
                    <ServiceCombobox
                      disabled={loading || services.length === 0}
                      onChange={(slug) => {
                        setService(slug);
                        updateQuery({ service: slug });
                      }}
                      options={services}
                      value={service}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground px-1">Variation</div>
                    <Tabs
                      onValueChange={(v) => {
                        const nextView = v === "form" ? "form" : "internal";
                        setIframeLoaded(false);
                        setView(nextView);
                        updateQuery({ view: nextView });
                      }}
                      value={view}
                    >
                      <TabsList className="rounded-full w-full">
                        <TabsTrigger className="rounded-full flex-1" value="internal">
                          Internal
                        </TabsTrigger>
                        <TabsTrigger className="rounded-full flex-1" value="form">
                          Form
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground px-1">Theme</div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" disabled={loading} className="w-full justify-between rounded-full">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex gap-1">
                              <div
                                className="h-3 w-3 rounded-full border border-border"
                                style={{ backgroundColor: selectedThemeFull?.background_color || "#ffffff" }}
                              />
                              <div
                                className="h-3 w-3 rounded-full border border-border"
                                style={{
                                  backgroundColor:
                                    selectedThemeFull?.prompt_background_color || selectedThemeFull?.background_color || "#f9fafb",
                                }}
                              />
                              <div
                                className="h-3 w-3 rounded-full border border-border"
                                style={{
                                  backgroundColor:
                                    selectedThemeFull?.submit_button_background_color || selectedThemeFull?.primary_color || "#3b82f6",
                                }}
                              />
                            </div>
                            <span className="truncate">Theme</span>
                          </div>
                          <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-80 max-h-80 overflow-y-auto">
                        {THEME_OPTIONS.map((opt) => {
                          const full = getCompleteTheme(opt.theme as any);
                          return (
                            <DropdownMenuItem
                              key={opt.key}
                              className="h-auto cursor-pointer p-2"
                              onClick={() => {
                                setThemeKey(opt.key);
                                updateQuery({ theme: opt.key });
                                if (iframeLoaded) {
                                  // Keep the same merge order as `selectedConfigPatch`, but compute quickly here.
                                  const merged: Partial<DesignSettings> = {
                                    ...selectedDemoTemplateConfig,
                                    ...selectedPlaygroundPreset,
                                    ...themePatchForKey(opt.key),
                                  };
                                  const currentName = String((merged as any).brand_name || "").trim();
                                  const serviceLabel = String(selectedService?.label || service || "").trim();
                                  if (!currentName) {
                                    (merged as any).brand_name_enabled = true;
                                    (merged as any).brand_name = serviceLabel ? `Acme — ${serviceLabel}` : "Acme";
                                  }
                                  scheduleThemeSend(merged);
                                }
                              }}
                            >
                              <div className="flex w-full items-center gap-2">
                                <div className="flex gap-1">
                                  <div
                                    className="h-3 w-3 rounded-full border border-border"
                                    style={{ backgroundColor: full.background_color || "#ffffff" }}
                                  />
                                  <div
                                    className="h-3 w-3 rounded-full border border-border"
                                    style={{ backgroundColor: full.prompt_background_color || full.background_color || "#f9fafb" }}
                                  />
                                  <div
                                    className="h-3 w-3 rounded-full border border-border"
                                    style={{
                                      backgroundColor: full.submit_button_background_color || (opt.theme as any).accent_color || "#3b82f6",
                                    }}
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium">{opt.name}</div>
                                  {opt.description ? (
                                    <div className="text-xs text-muted-foreground truncate">{opt.description}</div>
                                  ) : null}
                                </div>
                              </div>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    {openInNewTabHref ? (
                      <Button asChild className="rounded-full sm:hidden" variant="outline">
                        <a href={openInNewTabHref} rel="noreferrer" target="_blank">
                          Open preview <ExternalLink className="ml-2 h-4 w-4" />
                        </a>
                      </Button>
                    ) : (
                      <div />
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        </div>
      </div>

      {/* Playground demo area (never overlaps navbar) */}
      <div className="min-h-0 overflow-hidden">
        {error ? (
          <div className="h-full grid place-items-center p-6 text-sm text-destructive bg-background">{error}</div>
        ) : previewUrl ? (
          <iframe
            key={previewUrl}
            src={previewUrl}
            title="Playground preview"
            className="block w-full h-full bg-background"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            referrerPolicy="no-referrer-when-downgrade"
            ref={iframeRef}
            onLoad={() => setIframeLoaded(true)}
          />
        ) : (
          <div className="h-full grid place-items-center p-6 text-sm text-muted-foreground bg-background">
            {loading ? "Loading preview…" : "Select a service to start."}
          </div>
        )}
      </div>
    </div>
  );
}
