import type { CSSProperties } from 'react';
import type { DesignSettings } from '@/types/design';

/** 6-digit #rrggbb for appending alpha hex; supports shorthand #rgb. */
function hexRgbForBackdrop(color: string): string {
  const c = color.trim();
  if (!c.startsWith('#')) return '#374151';
  const body = c.slice(1);
  if (/^[0-9A-Fa-f]{3}$/.test(body)) {
    const [r, g, b] = body.split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9A-Fa-f]{6}$/.test(body)) return `#${body.toLowerCase()}`;
  return '#374151';
}

/** Match `buildPopupEmbedCode` defaults in LaunchTab.tsx */
export function widgetPopupPreviewBackdropStyle(config: DesignSettings): CSSProperties {
  const raw = config.modal_backdrop_color || '#374151';
  const modalBackdropColor = hexRgbForBackdrop(raw);
  const modalBackdropOpacity = config.modal_backdrop_opacity ?? 0.5;
  const hex = Math.round(modalBackdropOpacity * 255)
    .toString(16)
    .padStart(2, '0');
  return { backgroundColor: `${modalBackdropColor}${hex}` };
}

/** Panel uses viewport fill up to these pixel caps (same idea as the pasted embed). */
export function widgetPopupPreviewPanelStyle(config: DesignSettings): CSSProperties {
  const modalMaxWidth = Math.max(200, Number(config.modal_max_width) || 900);
  const modalMaxHeight = Math.max(200, Number(config.modal_max_height) || 900);
  const modalBorderRadius = config.modal_border_radius ?? 12;
  const modalBackgroundColor = config.modal_background_color || '#ffffff';
  const modalAnimationDuration = config.modal_animation_duration ?? 300;

  return {
    backgroundColor: modalBackgroundColor,
    borderRadius: `${modalBorderRadius}px`,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    height: 'calc(100dvh - 48px)',
    maxHeight: `${modalMaxHeight}px`,
    maxWidth: `${modalMaxWidth}px`,
    transitionProperty: 'opacity, transform, width, height, max-width, max-height, background-color, border-radius, box-shadow',
    transitionDuration: `${modalAnimationDuration}ms`,
    transitionTimingFunction: 'ease',
    width: 'calc(100vw - 24px)',
  };
}
