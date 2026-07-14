import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DesignSettings } from "@mage/types";
import { ModalSettings } from "./design/ModalSettings";
import { IframeSettings } from "./design/IframeSettings";
import { useInstance } from "@/contexts/InstanceContext";
import { useAuth } from "@/contexts/AuthContext";
import { fetchBillingSnapshotCached } from "@/lib/billing-snapshot-cache";

interface LaunchTabProps {
  config: DesignSettings;
  instanceId: string;
  openSections: Record<string, Record<string, boolean>>;
  toggleSection: (tab: string, section: string) => void;
  updateConfig: (updates: Partial<DesignSettings>) => void;
}

type LaunchSurface = "page" | "embed" | "popup" | "inline";

function normalizeCssDimension(value: unknown, fallback: string): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!raw) return fallback;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return `${raw}px`;
  if (/^\d+(?:\.\d+)?(?:px|%|vh|vw|dvh|svh|lvh)$/.test(raw)) return raw;
  return fallback;
}

export const LaunchTab: React.FC<LaunchTabProps> = ({
  config,
  instanceId,
  openSections,
  toggleSection,
  updateConfig,
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentInstance } = useInstance();
  const [embedCode, setEmbedCode] = useState<string | null>(null);
  const [inlineEmbedCode, setInlineEmbedCode] = useState<string | null>(null);
  const [modalEmbedCode, setModalEmbedCode] = useState<string | null>(null);
  const [showMadeWith, setShowMadeWith] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const accountId = currentInstance?.account_id || null;
      if (!user?.id || !accountId) {
        setShowMadeWith(false);
        return;
      }

      try {
        const snapshot = await fetchBillingSnapshotCached(user.id, accountId, { background: true });
        if (cancelled) return;

        const sub = snapshot.subscription;
        const isTrial =
          !sub ||
          sub.status === "trialing" ||
          (typeof sub.trial_end === "string" && Date.parse(sub.trial_end) > Date.now());

        setShowMadeWith(isTrial);
      } catch {
        if (!cancelled) setShowMadeWith(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [user?.id, currentInstance?.account_id]);

  const widgetBaseUrl = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_WIDGET_URL || "http://localhost:3001";
    const withProtocol = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `http://${raw}`;
    return withProtocol.replace(/\/+$/g, "");
  }, []);

  const adventureUrlForSurface = useCallback(
    (surface: LaunchSurface) => {
      const url = new URL(`/adventure/${encodeURIComponent(instanceId)}`, widgetBaseUrl);
      url.searchParams.set("surface", surface);
      return url.toString();
    },
    [instanceId, widgetBaseUrl]
  );

  const pageAdventureUrl = useMemo(
    () => adventureUrlForSurface("page"),
    [adventureUrlForSurface]
  );

  const madeWithHref = process.env.NEXT_PUBLIC_SITE_URL || "https://adventure.app";

  const buildContainedEmbedCode = useCallback((surface: "embed" | "inline") => {
    const productName = "Adventure";
    const adventureUrl = adventureUrlForSurface(surface);
    const safeInstanceId = instanceId.replace(/[^a-zA-Z0-9_-]/g, "");
    const iframeId = `adventure-${surface}-${safeInstanceId || "widget"}`;
    const madeWith = showMadeWith
      ? `\n<div style="text-align: center; font-size: 12px; color: #6b7280; margin-top: 8px;">Made with <a href="${madeWithHref}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Adventure</a></div>`
      : "";

    const iframeWidth = normalizeCssDimension(config.iframe_width, "100%");
    const iframeHeight = normalizeCssDimension(config.iframe_height, "760px");
    const iframeBorderRadius = config.iframe_border_radius || 12;
    const iframeBorderWidth = config.iframe_border === false ? 0 : config.iframe_border_width || 1;
    const iframeBorderColor = config.iframe_border_color || "#e5e7eb";
    const iframeBackgroundColor = config.background_color || "#fff7ed";
    const iframeShadow = config.iframe_shadow || "medium";
    const iframeLoading = config.iframe_loading || "lazy";
    const iframeScrolling = config.iframe_scrolling || "auto";
    const iframeSandbox = config.iframe_sandbox || "allow-scripts allow-same-origin allow-forms";
    const iframeReferrerPolicy = config.iframe_referrerpolicy || "no-referrer-when-downgrade";
    const iframeAllowTransparency = config.iframe_allowtransparency !== false;

    const shadowStyles: Record<string, string> = {
      glow: "0 0 15px rgba(99, 102, 241, 0.3)",
      large: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
      medium: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
      none: "none",
      subtle: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
      small: "0 1px 3px 0 rgb(0 0 0 / 0.1)",
    };

    const resolvedShadow = shadowStyles[String(iframeShadow)] ?? shadowStyles.medium;

    return `<div style="display: flex; width: 100%; justify-content: center; margin: 20px 0;">
  <iframe 
    id="${iframeId}"
    src="${adventureUrl}"
    width="${iframeWidth}"
    height="${iframeHeight}"
    style="display: block; width: ${iframeWidth}; max-width: 100%; height: ${iframeHeight}; border-radius: ${iframeBorderRadius}px; border: ${iframeBorderWidth}px solid ${iframeBorderColor}; background-color: ${iframeBackgroundColor}; box-shadow: ${resolvedShadow};"
    frameborder="0"
    loading="${iframeLoading}"
    scrolling="${iframeScrolling}"
    sandbox="${iframeSandbox}"
    referrerpolicy="${iframeReferrerPolicy}"
    ${iframeAllowTransparency ? 'allowtransparency="true"' : ""}
  ></iframe>
</div>${madeWith}

<!-- ${productName} iframe bridge: secure resize + exit intent -->
<script>
(function() {
  const IFRAME_MESSAGE_TYPE = 'MAGE_WIDGET_EXIT_INTENT';
  const RESIZE_MESSAGE_TYPE = 'ADVENTURE_RESIZE';
  const INSTANCE_ID = ${JSON.stringify(instanceId)};
  const IFRAME_ID = ${JSON.stringify(iframeId)};
  const VALID_PHASES = new Set(['project', 'look', 'concepts', 'estimate']);
  const iframe = document.getElementById(IFRAME_ID);
  if (!iframe) return;
  let expectedOrigin;
  try {
    expectedOrigin = new URL(iframe.src, document.baseURI).origin;
  } catch (e) {
    return;
  }
  let registered = false;
  let mouseLeaveTimeout;

  window.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow || event.origin !== expectedOrigin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.instanceId !== INSTANCE_ID) return;

    if (data.type === RESIZE_MESSAGE_TYPE) {
      if (!VALID_PHASES.has(data.phase)) return;
      if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return;
      const nextHeight = Math.ceil(data.height);
      if (nextHeight < 320 || nextHeight > 5000) return;
      iframe.style.height = nextHeight + 'px';
      iframe.setAttribute('height', String(nextHeight));
      return;
    }

    if (data.type === IFRAME_MESSAGE_TYPE && data.action === 'register') {
      registered = true;
    }
  });

  function notifyIframe() {
    if (!registered || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({
        type: IFRAME_MESSAGE_TYPE,
        action: 'exit-intent',
        instanceId: INSTANCE_ID
      }, expectedOrigin);
    } catch (e) {}
  }

  document.addEventListener('mousemove', (e) => {
    if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      if (mouseLeaveTimeout) clearTimeout(mouseLeaveTimeout);
      mouseLeaveTimeout = setTimeout(notifyIframe, 1000);
    } else {
      if (mouseLeaveTimeout) clearTimeout(mouseLeaveTimeout);
    }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) notifyIframe(); });
  window.addEventListener('beforeunload', notifyIframe);
  window.addEventListener('unload', notifyIframe);
})();
</script>`;
  }, [adventureUrlForSurface, config, instanceId, madeWithHref, showMadeWith]);

  const buildPopupEmbedCode = useCallback(() => {
    const productName = "Adventure";
    const adventureUrl = adventureUrlForSurface("popup");
    const madeWith = showMadeWith
      ? `\n    <div style="text-align: center; font-size: 12px; padding: 8px 12px; color: #6b7280; border-top: 1px solid rgba(0,0,0,0.06);">Made with <a href="${madeWithHref}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Adventure</a></div>`
      : "";

    // Fill the viewport with margin; pixel caps are what you set in Popup settings (widget/form area).
    const modalWidth = "calc(100vw - 24px)";
    const modalHeight = "calc(100dvh - 48px)";
    const modalMaxWidth = Math.max(200, Number(config.modal_max_width) || 900);
    const modalMaxHeight = Math.max(200, Number(config.modal_max_height) || 900);
    const modalBorderRadius = config.modal_border_radius || 12;
    const modalBackdropColor = config.modal_backdrop_color || "#374151";
    const modalBackdropOpacity = config.modal_backdrop_opacity || 0.2;
    const modalBackgroundColor = config.modal_background_color || "#ffffff";
    const modalAnimationType = config.modal_animation_type || "fade";
    const modalAnimationDuration = config.modal_animation_duration || 300;
    const modalCloseOnBackdrop = config.modal_close_on_backdrop !== false;
    const modalCloseOnEscape = config.modal_close_on_escape !== false;

    const backdropOpacityHex = Math.round(modalBackdropOpacity * 255)
      .toString(16)
      .padStart(2, "0");
    const backdropColor = `${modalBackdropColor}${backdropOpacityHex}`;

    return `<!-- ${productName} AI widget popup (overlay + panel) -->
<div id="ai-widget-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 9999; background-color: ${backdropColor};">
  <div class="modal-container" style="
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: ${modalWidth};
    height: ${modalHeight};
    max-width: ${modalMaxWidth}px;
    max-height: ${modalMaxHeight}px;
    background: ${modalBackgroundColor};
    border-radius: ${modalBorderRadius}px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  ">
    <div style="flex: 1 1 auto; overflow: auto;">
      <iframe src="${adventureUrl}" width="100%" height="100%" frameborder="0" loading="lazy" scrolling="auto" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer-when-downgrade" allowtransparency="true" style="display: block;"></iframe>
    </div>
${madeWith}
  </div>
</div>

<!-- Trigger Button -->
<button id="open-ai-widget" style="
  background: #3b82f6;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 500;
  transition: background-color 0.2s;
" onmouseover="this.style.backgroundColor='#2563eb'" onmouseout="this.style.backgroundColor='#3b82f6'">
  Open ${productName}
</button>

<script>
(function() {
  const modal = document.getElementById('ai-widget-modal');
  const openBtn = document.getElementById('open-ai-widget');
  const modalContainer = modal.querySelector('.modal-container');

  const animationDuration = ${modalAnimationDuration}; // in ms
  const animationType = '${modalAnimationType}';
  
  function showModal() {
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    setTimeout(() => {
      modal.style.opacity = '1';
      if (animationType === 'fade') {
        modalContainer.style.opacity = '1';
        modalContainer.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    }, 10);
  }
  
  function hideModal() {
    if (animationType === 'fade') {
      modal.style.opacity = '0';
      modalContainer.style.opacity = '0';
      modalContainer.style.transform = 'translate(-50%, -50%) scale(0.95)';
    }
    setTimeout(() => {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }, animationDuration);
  }

  modal.style.transition = \`opacity \${animationDuration}ms ease\`;
  modalContainer.style.transition = \`all \${animationDuration}ms ease\`;
  modal.style.opacity = '0';
  modalContainer.style.opacity = '0';
  modalContainer.style.transform = 'translate(-50%, -50%) scale(0.95)';

  openBtn.addEventListener('click', showModal);
${modalCloseOnBackdrop ? `  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      hideModal();
    }
  });` : ""}
${modalCloseOnEscape ? `  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'block') {
      hideModal();
    }
  });` : ""}
})();
</script>`;
  }, [adventureUrlForSurface, config, madeWithHref, showMadeWith]);

  const hasAiForm = Boolean((config as any)?.form_status_enabled);

  const ensureIframeCode = useCallback(() => {
    const next = buildContainedEmbedCode("embed");
    setEmbedCode(next);
    return next;
  }, [buildContainedEmbedCode]);

  const ensureInlineCode = useCallback(() => {
    const next = buildContainedEmbedCode("inline");
    setInlineEmbedCode(next);
    return next;
  }, [buildContainedEmbedCode]);

  const ensurePopupCode = useCallback(() => {
    const next = buildPopupEmbedCode();
    setModalEmbedCode(next);
    return next;
  }, [buildPopupEmbedCode]);

  const copy = useCallback(
    async (text: string, label: string) => {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: label });
    },
    [toast]
  );

  const Card = useCallback(
    ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
      <div className="rounded-xl border border-border/60 bg-card/20 p-3">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </div>
    ),
    []
  );

  const CodeBlock = useCallback(
    ({
      code,
      ensureCode,
      copyLabel,
    }: {
      code: string | null;
      ensureCode: () => string;
      copyLabel: string;
    }) => (
      <details className="group">
        <summary
          className="flex items-center justify-between gap-2 cursor-pointer rounded-md border border-border/40 bg-background/40 px-2.5 py-2 text-xs font-medium text-foreground hover:bg-muted/40 transition-colors select-none"
          onClick={() => {
            ensureCode();
          }}
        >
          <span>Code</span>
          <span className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = ensureCode();
                copy(next, copyLabel).catch(() => {});
              }}
            >
              Copy
            </Button>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border/40 bg-background/40 p-3">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">{code || ""}</pre>
        </div>
      </details>
    ),
    [copy]
  );

  return (
    <div className="space-y-4 pt-2">
      <p className="px-1 text-xs text-muted-foreground leading-relaxed">
        Direct link and embed codes point at{" "}
        <code className="rounded bg-muted/50 px-1 py-0.5 font-mono text-[11px]">/adventure/{instanceId}?surface=…</code>
        {hasAiForm ? " (AI form when enabled for this instance, otherwise the classic widget)." : "."}
      </p>

      <Card title="Open in browser" description="Centered standalone page experience.">
        <div className="flex">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => window.open(pageAdventureUrl, "_blank")}
          >
            Open
          </Button>
        </div>
      </Card>

      <Card title="Iframe embed" description="Optional exit-intent helper script included below the iframe.">
        <div className="mb-3">
          <IframeSettings
            config={config}
            updateConfig={updateConfig}
            isOpen={openSections.launch?.["iframe-settings"] || false}
            onToggle={() => toggleSection("launch", "iframe-settings")}
          />
        </div>
        <CodeBlock code={embedCode} ensureCode={ensureIframeCode} copyLabel="Iframe embed code copied" />
      </Card>

      <Card title="Inline embed" description="Responsive homepage embed with automatic height updates.">
        <CodeBlock code={inlineEmbedCode} ensureCode={ensureInlineCode} copyLabel="Inline embed code copied" />
      </Card>

      <Card title="Popup" description="HTML/JS embed. Expand settings to edit; preview uses Popup mode on Launch.">
        <div className="mb-3">
          <ModalSettings
            config={config}
            updateConfig={updateConfig}
            isOpen={openSections.launch?.["modal-settings"] || false}
            onToggle={() => toggleSection("launch", "modal-settings")}
          />
        </div>
        <CodeBlock code={modalEmbedCode} ensureCode={ensurePopupCode} copyLabel="Popup embed code copied" />
      </Card>
    </div>
  );
};
