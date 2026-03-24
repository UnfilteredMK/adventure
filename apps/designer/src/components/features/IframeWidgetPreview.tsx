"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { DesignSettings } from "@mage/types";
import { useSupabaseClientWithAuth } from '@/hooks/useSupabaseClientWithAuth';

interface IframeWidgetPreviewProps {
  className?: string;
  fullPage?: boolean;
  instanceId: string;
  liveConfig?: DesignSettings | null;
  mode?: 'widget' | 'form';
  previewMode?: 'desktop' | 'mobile' | 'iframe';
  style?: React.CSSProperties;
}

/** Skeleton placeholder while the preview iframe boots — distinct from a generic spinner. */
function PreviewIframeLoader({ variant }: { variant: 'mobile' | 'iframe' | 'desktop' }) {
  const accent =
    variant === 'mobile'
      ? 'bg-blue-500/30 dark:bg-blue-400/25'
      : variant === 'iframe'
        ? 'bg-purple-500/30 dark:bg-purple-400/25'
        : 'bg-primary/35';

  return (
    <div
      className="flex w-48 max-w-[72%] flex-col gap-3"
      role="status"
      aria-label="Loading preview"
    >
      <div className={`h-1 w-14 rounded-full ${accent} animate-pulse`} />
      <div className="h-[5.5rem] w-full rounded-xl bg-muted/70 dark:bg-slate-700/50 animate-pulse" />
      <div className="h-2 w-full rounded-full bg-muted-foreground/15 animate-pulse delay-75" />
      <div className="h-2 w-[85%] rounded-full bg-muted-foreground/12 animate-pulse delay-150" />
      <div className="mt-0.5 flex gap-2">
        <div className="h-9 flex-1 rounded-lg bg-muted-foreground/12 animate-pulse delay-200" />
        <div className="h-9 w-14 rounded-lg bg-muted-foreground/12 animate-pulse delay-300" />
      </div>
    </div>
  );
}

const IframeWidgetPreview: React.FC<IframeWidgetPreviewProps> = ({
  className,
  fullPage = false,
  instanceId,
  liveConfig,
  mode = 'widget',
  previewMode = 'desktop',
  style,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [freshNonce, setFreshNonce] = useState(0);
  const [designerSessionId, setDesignerSessionId] = useState<string>(() => {
    // This id is sent to the widget runtime to scope per-session limits.
    // It is regenerated when the designer asks to "refresh session".
    if (typeof window === "undefined") return `designer_server_${Date.now()}`;
    return `designer_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  });
  const designerDeviceIdRef = useRef<string | null>(null);
  const widgetReadyRef = useRef(false);
  const resendTimerRef = useRef<number | null>(null);
  const resendAttemptsRef = useRef(0);
  const latestConfigRef = useRef<DesignSettings | null>(null);
  const supabase = useSupabaseClientWithAuth();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Stable per-device id for preview/runtime (persisted in designer app localStorage).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "sif_designer_device_id";
    const existing = window.localStorage.getItem(key);
    if (existing) {
      designerDeviceIdRef.current = existing;
      return;
    }
    const next = `dd_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    window.localStorage.setItem(key, next);
    designerDeviceIdRef.current = next;
  }, []);

  // Load the real runtime URL in the iframe using environment variable
  const getTargetUrl = useCallback(() => {
    const rawBaseUrl = process.env.NEXT_PUBLIC_WIDGET_URL || 'http://localhost:3001';
    const baseUrl =
      rawBaseUrl.startsWith('http://') || rawBaseUrl.startsWith('https://')
        ? rawBaseUrl
        : `http://${rawBaseUrl}`;

    // Unified experience: both internal + form preview load /adventure/:instanceId
    const url = new URL(`/adventure/${instanceId}`, baseUrl);
    if (fullPage) url.searchParams.set('fullPage', 'true');
    // Designer preview runs embedded in an iframe.
    url.searchParams.set('embed', '1');
    url.searchParams.set('designerRefresh', String(refreshNonce));

    // Only request a "new session" when the user explicitly clicks Refresh.
    // Contract: `fresh=1` (or `fresh=true`) triggers the runtime boot code to clear
    // step state + session id and generate a new one.
    if (freshNonce > 0) {
      url.searchParams.set('fresh', '1');
      url.searchParams.set('freshNonce', String(freshNonce));
    }

    url.searchParams.set('designerSessionId', designerSessionId);
    url.searchParams.set('sessionId', designerSessionId);
    // Compatibility with playground runtime naming (safe if ignored).
    url.searchParams.set('playgroundSessionId', designerSessionId);
    if (designerDeviceIdRef.current) {
      url.searchParams.set('designerDeviceId', designerDeviceIdRef.current);
      url.searchParams.set('playgroundDeviceId', designerDeviceIdRef.current);
    }
    return url.toString();
  }, [designerSessionId, freshNonce, fullPage, instanceId, refreshNonce]);

  // Allow parent designer UI to force-refresh the iframe (e.g. after placeholder gallery reorder).
  useEffect(() => {
    const handler = () => {
      widgetReadyRef.current = false;
      setIsIframeLoaded(false);
      setIframeError(null);
      // Generate a brand-new session id so per-session usage limits reset.
      setDesignerSessionId(`designer_${Math.random().toString(36).slice(2)}_${Date.now()}`);
      // Force the runtime to start a new session via the supported contract.
      setFreshNonce((n) => n + 1);
      setRefreshNonce((n) => n + 1);

      // Best-effort: ask the runtime to clear any in-memory counters before reload.
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'SIF_RESET_SESSION', sessionId: designerSessionId, timestamp: Date.now() },
          '*',
        );
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'RESET_SESSION', sessionId: designerSessionId, timestamp: Date.now() },
          '*',
        );
      } catch {}
    };
    window.addEventListener('designer-refresh-widget-preview', handler as EventListener);
    return () => {
      window.removeEventListener('designer-refresh-widget-preview', handler as EventListener);
    };
  }, [designerSessionId]);

  // Send config once (no debounce) to the iframe
  const sendConfigOnce = useCallback((config: DesignSettings) => {
    if (iframeRef.current?.contentWindow) {
      // Compatibility payload: some runtimes may expect `config`, others `design` / `designConfig`.
      const payload = { config, design: config, designConfig: config, timestamp: Date.now() };
      // Unified runtime: send both messages for compatibility.
      iframeRef.current.contentWindow.postMessage({ type: 'UPDATE_CONFIG', ...payload }, '*');
      iframeRef.current.contentWindow.postMessage({ type: 'UPDATE_FLOW_CONFIG', ...payload }, '*');
    }
  }, [mode]);

  // Schedule reliable delivery: burst a few times until we see READY/ACK
  const scheduleSend = useCallback(() => {
    if (!isIframeLoaded || !liveConfig) return;
    latestConfigRef.current = liveConfig;

    if (resendTimerRef.current) {
      window.clearTimeout(resendTimerRef.current);
      resendTimerRef.current = null;
    }
    resendAttemptsRef.current = 0;

    const attempt = () => {
      const cfg = latestConfigRef.current;
      if (!cfg) return;
      sendConfigOnce(cfg);
      resendAttemptsRef.current += 1;
      if (!widgetReadyRef.current && resendAttemptsRef.current < 12) {
        resendTimerRef.current = window.setTimeout(attempt, 150);
      }
    };

    // Small delay to allow widget boot code to attach listeners
    resendTimerRef.current = window.setTimeout(attempt, 50);
  }, [isIframeLoaded, liveConfig, sendConfigOnce]);

  // Handle iframe load
  const handleIframeLoad = useCallback(() => {
    widgetReadyRef.current = false;
    setIsIframeLoaded(true);
    setIframeError(null);
    // Send current config into the widget as soon as it loads
    if (liveConfig) {
      scheduleSend();
    }
  }, [liveConfig, scheduleSend]);

  // Handle iframe error
  const handleIframeError = useCallback(() => {
    setIframeError('Failed to load widget preview');
    setIsIframeLoaded(false);
  }, []);

  // Listen for messages from the iframe (ready/ack)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data: any = event.data;
      if (!data || typeof data !== 'object') return;
      const type = data.type as string | undefined;
      if (!type) return;
      if (
        type === 'WIDGET_READY' ||
        type === 'FORM_READY' ||
        type === 'UPDATE_CONFIG_ACK' ||
        type === 'UPDATE_FLOW_CONFIG_ACK' ||
        type === 'SIF_READY' ||
        type === 'SIF_PONG'
      ) {
        widgetReadyRef.current = true;
        if (resendTimerRef.current) {
          window.clearTimeout(resendTimerRef.current);
          resendTimerRef.current = null;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Bridge "preview-demo-overlay" custom event to the iframe
  useEffect(() => {
    const forwardPreviewEvent = () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: 'PREVIEW_DEMO_OVERLAY' },
          '*'
        );
      }
    };
    window.addEventListener('preview-demo-overlay', forwardPreviewEvent as EventListener);
    return () => {
      window.removeEventListener('preview-demo-overlay', forwardPreviewEvent as EventListener);
    };
  }, []);

  // Track previous config to detect major changes
  const prevConfigRef = useRef<DesignSettings | null>(null);

  // Send config updates when liveConfig changes (no reloads, reliable delivery)
  useEffect(() => {
    if (!liveConfig) return;
    scheduleSend();
    prevConfigRef.current = liveConfig;
  }, [liveConfig, scheduleSend]);

  // Subscribe to Supabase realtime updates for this instance's config
  useEffect(() => {
    if (!supabase || !instanceId) return;

    // Avoid duplicate subscriptions
    if (channelRef.current) {
      try { channelRef.current.unsubscribe(); } catch {}
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`realtime:public:instances:${instanceId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', filter: `id=eq.${instanceId}`, schema: 'public', table: 'instances' },
        async (payload: any) => {
          try {
            // Single source of truth: `instances.config` (flow_config is deprecated).
            const nextConfig: DesignSettings | null = payload?.new?.config || null;
            if (nextConfig) {
              latestConfigRef.current = nextConfig;
              sendConfigOnce(nextConfig);
              return;
            }

            const res = await fetch(`/api/instances/${instanceId}`, { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            const cfg = (data?.instance?.config ?? data?.config) as DesignSettings | null;
            if (!cfg) return;
            latestConfigRef.current = cfg;
            sendConfigOnce(cfg);
          } catch {}
        }
      )
      .subscribe();

    channelRef.current = channel as any;

    return () => {
      try { channel.unsubscribe(); } catch {}
      channelRef.current = null;
    };
  }, [supabase, instanceId, sendConfigOnce]);

  // Get iframe dimensions based on preview mode
  const getIframeDimensions = () => {
    switch (previewMode) {
      case 'mobile':
        return { height: '844px', width: '390px' };
      case 'iframe':
        const width = liveConfig?.iframe_width || '500px';
        const height = liveConfig?.iframe_height || '600px';
        return { height, width };
      default:
        return { height: '100%', width: '100%' };
    }
  };

  const { height, width } = getIframeDimensions();
  const targetUrl = getTargetUrl();
  // Force a true runtime reboot when refreshing the session.
  // (Some runtimes persist session counters in storage; remounting helps ensure boot code runs.)
  const iframeKey = `${instanceId}:${previewMode}:${fullPage ? '1' : '0'}:${refreshNonce}:${freshNonce}:${designerSessionId}`;

  // Render mobile view with smartphone frame
  if (previewMode === 'mobile') {
    return (
      <div className={`w-full h-full ${className || ''}`} style={style}>
        <div className="flex items-center justify-center w-full h-full p-8">
          {/* Header */}
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Mobile Preview</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              <span className="text-xs text-slate-500 dark:text-slate-400">Live</span>
            </div>
          </div>
          
          {/* Mobile Frame */}
          <div className="relative mt-8 bg-white dark:bg-slate-900 rounded-[2rem] overflow-hidden" style={{ height: '750px', width: '375px' }}>
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={targetUrl}
              className="w-full h-full border-0"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              style={{ height: '100%', width: '100%' }}
              title="Widget Preview"
            />
            
            {/* Loading State */}
            {!isIframeLoaded && !iframeError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-slate-900">
                <PreviewIframeLoader variant="mobile" />
              </div>
            )}
            
            {/* Error State */}
            {iframeError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-slate-900">
                <div className="text-center text-red-500">
                  <p className="text-sm font-medium mb-2">Failed to load widget preview</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{iframeError}</p>
                  <button 
                    onClick={() => window.location.reload()} 
                    className="mt-2 text-xs text-blue-500 hover:underline"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render iframe view with code container
  if (previewMode === 'iframe') {
    return (
      <div className={`w-full h-full ${className || ''}`} style={style}>
        <div className="flex items-center justify-center w-full h-full p-8">
          {/* Header */}
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Code Preview</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              <span className="text-xs text-slate-500 dark:text-slate-400">Live</span>
            </div>
          </div>
          
          {/* Window Container */}
          <div className="relative mt-8 bg-white dark:bg-slate-900 rounded-lg overflow-hidden" style={{ height, width }}>
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={targetUrl}
              className="w-full h-full border-0"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              style={{ height, width }}
              title="Widget Preview"
            />
            
            {/* Loading State */}
            {!isIframeLoaded && !iframeError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-slate-900">
                <PreviewIframeLoader variant="iframe" />
              </div>
            )}
            
            {/* Error State */}
            {iframeError && (
              <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-slate-900">
                <div className="text-center text-red-500">
                  <p className="text-sm font-medium mb-2">Failed to load widget preview</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{iframeError}</p>
                  <button 
                    onClick={() => window.location.reload()} 
                    className="mt-2 text-xs text-purple-500 hover:underline"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default desktop view (full width/height, fills designer preview area)
  return (
    <div className={`relative w-full h-full min-w-0 min-h-0 flex flex-col ${className || ''}`} style={style}>
      {/* Iframe */}
      <iframe
        key={iframeKey}
        ref={iframeRef}
        src={targetUrl}
        className="flex-1 w-full min-h-0 min-w-0 border-0"
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        style={{
          ...getIframeDimensions(),
          minHeight: 0,
          ...style
        }}
        title="Widget Preview"
      />
      
      {/* Loading State */}
      {!isIframeLoaded && !iframeError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <PreviewIframeLoader variant="desktop" />
        </div>
      )}
      
      {/* Error State */}
      {iframeError && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <div className="text-center text-destructive">
            <p className="text-sm font-medium mb-2">Failed to load widget preview</p>
            <p className="text-xs text-muted-foreground">{iframeError}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="mt-2 text-xs text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default IframeWidgetPreview; 
