"use client";

export function mergeUniqueImageUrls(existing: string[], incoming: string[]) {
  return Array.from(
    new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])].filter(Boolean))
  );
}

export function pickHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return t;
  return null;
}

export function isValidUrlLikeImage(src: any): src is string {
  if (typeof src !== "string") return false;
  if (!src) return false;
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:") || src.startsWith("/");
}

export function absolutizeImageUrl(src: string): string {
  if (!src || typeof src !== "string") return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) return src;
  if (src.startsWith("/") && typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${src}`;
  }
  return src;
}

export function decodeDataUrlText(dataUrl: string): string | null {
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
      return binary;
    }
  } catch {}
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

export function isPlaceholderPreviewImage(src: string): boolean {
  if (!src) return false;
  if (!src.startsWith("data:image/svg+xml")) return false;
  const decoded = decodeDataUrlText(src);
  if (!decoded) return true;
  return /placeholder|demo/i.test(decoded);
}
