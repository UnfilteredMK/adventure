import { useEffect, useState } from "react";
import {
  PREVIEW_CACHE_UPDATED_EVENT,
  readPreviewCacheSnapshot,
  type PreviewCacheSnapshot,
} from "../../../image-preview-experience/gallery/preview-cache-bridge";

export function usePreviewCacheBridge(args: { instanceId: string; sessionId: string }) {
  const { instanceId, sessionId } = args;
  const [previewCacheSnapshot, setPreviewCacheSnapshot] = useState<PreviewCacheSnapshot | null>(null);

  useEffect(() => {
    if (!sessionId || !instanceId) {
      setPreviewCacheSnapshot(null);
      return;
    }
    setPreviewCacheSnapshot(readPreviewCacheSnapshot(instanceId, sessionId));
    const handlePreviewCacheUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId?: string; sessionId?: string; cache?: PreviewCacheSnapshot | null }>).detail;
      if (!detail) return;
      if (detail.instanceId !== instanceId || detail.sessionId !== sessionId) return;
      setPreviewCacheSnapshot(detail.cache ?? readPreviewCacheSnapshot(instanceId, sessionId));
    };
    window.addEventListener(PREVIEW_CACHE_UPDATED_EVENT, handlePreviewCacheUpdate as EventListener);
    return () => window.removeEventListener(PREVIEW_CACHE_UPDATED_EVENT, handlePreviewCacheUpdate as EventListener);
  }, [instanceId, sessionId]);

  return { previewCacheSnapshot, setPreviewCacheSnapshot };
}
