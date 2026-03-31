"use client";

import React, { useMemo } from "react";
import { AdaptiveImage } from "./AdaptiveImage";
import { DesignSettings } from "../../../types";
import { Skeleton } from "../../ui/skeleton";
import { Copy, Sparkles, ArrowRight, ImageIcon, ChevronDown } from "lucide-react";
import { Button } from "../../ui/button";

interface ImageSlot {
  id: number;
  image: string | null;
  hasImage: boolean;
  prompt: string | null;
  showPlaceholder: boolean;
}

interface MultiColumnGalleryProps {
  imageSlots: ImageSlot[];
  isLoading: boolean;
  isGenerating?: boolean;
  config: DesignSettings;
  containerWidth?: number;
  containerHeight?: number;
  isSampleGallery: boolean;
  hasUserGenerated: boolean;
  deployment?: boolean;
  onImageClick: (image: string) => void;
  onPromptClick: (prompt: string) => void;
  onPlaceholderClick: () => void;
}

export function MultiColumnGallery({
  imageSlots,
  isLoading,
  isGenerating,
  config,
  isSampleGallery,
  hasUserGenerated,
  deployment = false,
  onImageClick,
  onPromptClick,
  onPlaceholderClick
}: MultiColumnGalleryProps) {
  
  const showPrompts = config.gallery_show_prompts !== false;
  const [showScrollHint, setShowScrollHint] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const galleryConfig = useMemo(() => ({
    columns: config.gallery_columns || 3,
    spacing: config.gallery_spacing ?? 0,
    maxImages: config.gallery_max_images || 12,
    backgroundColor: config.gallery_background_color || 'transparent',
    imageBorderEnabled: config.gallery_image_border_enabled ?? false,
    imageBorderWidth: config.gallery_image_border_width ?? 1,
    imageBorderColor: config.gallery_image_border_color || '#e5e7eb',
    imageBorderStyle: config.gallery_image_border_style || 'solid',
    imageBorderRadius: config.gallery_image_border_radius ?? 8,
    galleryShadowStyle: config.gallery_shadow_style || 'medium',
  }), [config]);

  const tileBg =
    galleryConfig.backgroundColor === "transparent"
      ? (config.prompt_input_background_color || config.secondary_color || "rgba(255,255,255,0.70)")
      : galleryConfig.backgroundColor;
  const imageBorder = galleryConfig.imageBorderEnabled
    ? `${galleryConfig.imageBorderWidth}px ${galleryConfig.imageBorderStyle} ${galleryConfig.imageBorderColor}`
    : "2px solid transparent";

  const tileBoxShadow = useMemo(() => {
    switch (galleryConfig.galleryShadowStyle) {
      case "none":
        return "none";
      case "subtle":
        return "0 1px 3px rgba(0,0,0,0.06)";
      case "large":
        return "0 12px 28px rgba(0,0,0,0.12)";
      case "glow":
        return "0 0 24px rgba(59,130,246,0.22)";
      case "medium":
      default:
        return "0 4px 14px rgba(0,0,0,0.08)";
    }
  }, [galleryConfig.galleryShadowStyle]);

  // Scroll shell: fixed gallery height; inner grid fills and splits space evenly (2×N).
  const scrollShellStyles = useMemo(
    () => ({
      backgroundColor: galleryConfig.backgroundColor,
      fontFamily: config.gallery_font_family || "inherit",
      fontSize: config.gallery_font_size,
      padding: 0,
      width: "100%",
      height: "100%",
      minHeight: 0,
      maxHeight: "100%",
      overflowY: "auto" as const,
      overflowX: "hidden" as const,
      WebkitOverflowScrolling: "touch" as const,
      overscrollBehavior: "contain" as const,
    }),
    [galleryConfig.backgroundColor, config.gallery_font_family, config.gallery_font_size]
  );

  const gridStyles = useMemo(() => {
    const count = isLoading || isGenerating ? galleryConfig.maxImages : imageSlots.length;
    const rowCount = Math.max(1, Math.ceil(Math.max(1, count) / 2));
    return {
      display: "grid",
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))`,
      gap: galleryConfig.spacing,
      width: "100%",
      height: "100%",
      minHeight: 0,
      boxSizing: "border-box" as const,
    } as const;
  }, [galleryConfig.maxImages, galleryConfig.spacing, imageSlots.length, isGenerating, isLoading]);

  const imageWrapperStyles = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      minHeight: 0,
      position: "relative" as const,
      borderRadius: galleryConfig.imageBorderRadius,
      overflow: "hidden",
      backgroundColor: tileBg,
      border: imageBorder,
      boxShadow: tileBoxShadow,
    }),
    [galleryConfig.imageBorderRadius, imageBorder, tileBg, tileBoxShadow]
  );

  // Ensure hooks run before any early returns (React rule of hooks)
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      try {
        const overflows = el.scrollHeight > el.clientHeight + 8;
        const nearBottom = el.scrollTop >= (el.scrollHeight - el.clientHeight - 8);
        setShowScrollHint(overflows && !nearBottom);
      } catch {}
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    let ro: ResizeObserver | null = null;
    try {
      if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
        ro = new (window as any).ResizeObserver(update);
        if (ro) {
          ro.observe(el);
        }
      }
    } catch {}
    return () => {
      try { el.removeEventListener('scroll', update as any); } catch {}
      try {
        if (ro) ro.disconnect();
      } catch {}
    };
  }, []);

  if (isLoading || isGenerating) {
    return (
      <div ref={rootRef} className="relative h-full min-h-0 w-full" style={scrollShellStyles}>
        <div className="h-full min-h-0" style={gridStyles}>
          {Array.from({ length: galleryConfig.maxImages }).map((_, index) => (
            <div key={`loading-${index}`} className="relative min-h-0" style={imageWrapperStyles}>
              {isGenerating ? (
                <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-gray-300 dark:border-gray-600 border-t-gray-500 dark:border-t-gray-400 rounded-full animate-spin"></div>
                  </div>
                </div>
              ) : (
                <Skeleton className="absolute inset-0" />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative h-full min-h-0 w-full" style={scrollShellStyles}>
      <div className="h-full min-h-0" style={gridStyles}>
        {imageSlots.map((slot) => (
          <div key={slot.id} className="relative group min-h-0" style={imageWrapperStyles}>
          {slot.hasImage ? (
            <>
              <AdaptiveImage
                src={slot.image!}
                alt={`Generated image ${slot.id + 1}`}
                borderRadius={galleryConfig.imageBorderRadius}
                backgroundColor={tileBg}
                fit="cover"
                fillContainer
                onClick={() => {
                  if (isSampleGallery && !hasUserGenerated && slot.prompt) {
                    onPromptClick(slot.prompt);
                  } else {
                    onImageClick(slot.image!);
                  }
                }}
              />
              
              {/* Prompt overlay */}
              {showPrompts && slot.prompt && (
                <div
                  className={`absolute inset-0 z-[1] bg-gradient-to-t from-black/70 via-transparent to-transparent transition-opacity duration-200 pointer-events-none ${
                    isSampleGallery && !hasUserGenerated
                      ? "opacity-100"
                      : // For user-generated galleries, keep a small prompt snippet always visible.
                        "opacity-100"
                  }`}
                >
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <div className="flex items-center justify-between text-white">
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium ${
                          isSampleGallery && !hasUserGenerated 
                            ? 'text-[inherit] line-clamp-2 group-hover:line-clamp-none group-hover:max-h-32 group-hover:overflow-y-auto prompt-scroll'
                            : 'text-[inherit] line-clamp-2'
                        }`} style={{ fontFamily: config.gallery_font_family || 'inherit', fontSize: (config.gallery_font_size as number | undefined) || undefined }}>
                          {isSampleGallery && !hasUserGenerated ? (
                            <>
                              <Sparkles className="inline w-3 h-3 mr-1" />
                              {slot.prompt}
                              {slot.prompt.length > 100 && (
                                <span className="inline-block ml-1 text-xs text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                                  ↕
                                </span>
                              )}
                            </>
                          ) : (
                            slot.prompt
                          )}
                        </p>
                        {isSampleGallery && !hasUserGenerated && (
                          <p className="text-gray-300 mt-1" style={{ fontFamily: config.gallery_font_family || 'inherit', fontSize: (config.gallery_font_size as number | undefined) || undefined }}>Click anywhere to use this prompt</p>
                        )}
                      </div>
                      <div className={`pointer-events-auto ${isSampleGallery && !hasUserGenerated ? "" : "opacity-0 group-hover:opacity-100 transition-opacity"}`}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`text-white hover:bg-white/20 ${
                            isSampleGallery && !hasUserGenerated 
                              ? 'h-8 w-8'
                              : 'h-6 w-6'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (slot.prompt) {
                              onPromptClick(slot.prompt);
                            }
                          }}
                        >
                          {isSampleGallery && !hasUserGenerated ? (
                            <ArrowRight className="w-4 h-4" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : slot.showPlaceholder ? (
            <div 
              className="absolute inset-0 flex min-h-0 flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-colors duration-200 group/placeholder cursor-pointer w-full h-full"
              onClick={onPlaceholderClick}
              style={{
                backgroundColor: galleryConfig.backgroundColor === 'transparent' ? 'rgba(0,0,0,0.02)' : galleryConfig.backgroundColor,
                borderRadius: galleryConfig.imageBorderRadius,
                border: galleryConfig.imageBorderEnabled ? `${galleryConfig.imageBorderWidth}px ${galleryConfig.imageBorderStyle} ${galleryConfig.imageBorderColor}` : '2px dashed #d1d5db',
                boxShadow: galleryConfig.galleryShadowStyle === 'none' ? 'none' : 
                          galleryConfig.galleryShadowStyle === 'subtle' ? '0 1px 3px rgba(0,0,0,0.1)' :
                          galleryConfig.galleryShadowStyle === 'medium' ? '0 4px 6px rgba(0,0,0,0.1)' :
                          galleryConfig.galleryShadowStyle === 'large' ? '0 10px 15px rgba(0,0,0,0.1)' :
                          galleryConfig.galleryShadowStyle === 'glow' ? '0 0 20px rgba(59,130,246,0.3)' : '0 4px 6px rgba(0,0,0,0.1)',
              }}
            >
              <div className="w-12 h-12 mb-2 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-gray-400" />
              </div>
              <p className="font-medium text-gray-500 dark:text-gray-400" style={{ fontFamily: config.gallery_font_family || 'inherit', fontSize: (config.gallery_font_size as number | undefined) || undefined }}>
                Generate Image
              </p>
              <p className="text-gray-400 dark:text-gray-500 mt-1" style={{ fontFamily: config.gallery_font_family || 'inherit', fontSize: (config.gallery_font_size as number | undefined) || undefined }}>
                Click to create
              </p>
              {!deployment && (
                <div className="mt-2 px-2 py-1 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                  💰 1 credit
                </div>
              )}
            </div>
          ) : null}
          </div>
        ))}
      </div>
      {/* Scroll hint overlay */}
      {showScrollHint && (
        <div className="pointer-events-none sticky left-0 right-0 bottom-0 w-full">
          <div className="h-16 w-full bg-gradient-to-t from-black/5 via-black/0 to-transparent" />
          <div className="flex justify-center -mt-10 mb-2">
            <div className="pointer-events-auto inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/85 dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 shadow ring-1 ring-black/5" style={{ fontSize: 12 }}>
              <ChevronDown className="w-3.5 h-3.5 animate-bounce" />
              <span>Scroll to see more</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
