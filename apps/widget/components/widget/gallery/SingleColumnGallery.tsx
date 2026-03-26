"use client";

import React, { useMemo, useEffect, useRef, useState } from "react";
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

interface SingleColumnGalleryProps {
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
  singleImageMode?: boolean;
}

export function SingleColumnGallery({
  imageSlots,
  isLoading,
  isGenerating,
  config,
  containerHeight = 600,
  isSampleGallery,
  hasUserGenerated,
  deployment = false,
  onImageClick,
  onPromptClick,
  onPlaceholderClick,
  singleImageMode = false
}: SingleColumnGalleryProps) {
  
  const showPrompts = config.gallery_show_prompts !== false;
  // Measure actual available container size to avoid fallback caps
  const rootRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number>(0);
  const [availableHeight, setAvailableHeight] = useState<number>(0);
  const [showScrollHint, setShowScrollHint] = useState<boolean>(false);

  const isSingleImage = useMemo(() => {
    const count = imageSlots.filter(s => s.hasImage).length;
    return count === 1 && !isLoading && !isGenerating;
  }, [imageSlots, isLoading, isGenerating]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const update = () => {
      setAvailableWidth(node.clientWidth || 0);
      setAvailableHeight(node.clientHeight || 0);
      // Determine if content overflows to decide showing the scroll hint
      try {
        const overflows = node.scrollHeight > node.clientHeight + 8;
        const nearBottom = node.scrollTop >= (node.scrollHeight - node.clientHeight - 8);
        setShowScrollHint(overflows && !nearBottom && !isSingleImage && !singleImageMode);
      } catch {}
    };
    update();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(update);
      ro.observe(node);
    } catch {
      window.addEventListener("resize", update);
    }
    const onScroll = () => {
      try {
        const overflows = node.scrollHeight > node.clientHeight + 8;
        const nearBottom = node.scrollTop >= (node.scrollHeight - node.clientHeight - 8);
        setShowScrollHint(overflows && !nearBottom && !isSingleImage && !singleImageMode);
      } catch {}
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (ro) {
        try { ro.disconnect(); } catch {}
      } else {
        window.removeEventListener("resize", update);
      }
      try { node.removeEventListener('scroll', onScroll as any); } catch {}
    };
  }, [isSingleImage, singleImageMode]);

  const galleryConfig = useMemo(() => ({
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

  // For list mode, each item should expand to container width with a square aspect.
  // Single-image hero is handled separately below.

  // Container styles for single column
  const containerStyles = useMemo(() => ({
    backgroundColor: galleryConfig.backgroundColor,
    fontFamily: config.gallery_font_family || 'inherit',
    fontSize: config.gallery_font_size,
    padding: 0,
    width: '100%',
    height: '100%', // Fill parent height
    minHeight: 0,
    maxHeight: '100%', // Constrain to parent
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const, // Prevent horizontal overflow
    WebkitOverflowScrolling: 'touch' as const,
    overscrollBehavior: 'contain' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    gap: galleryConfig.spacing,
    boxSizing: 'border-box' as const, // Include padding/borders in height calculation
  }), [galleryConfig, config, isSingleImage, singleImageMode]);
  // Hero-specific container: center content and prevent vertical scroll so the image cannot be cut off
  const heroContainerStyles = useMemo(() => ({
    ...containerStyles,
    justifyContent: 'center',
    overflowY: 'hidden' as const,
    minHeight: '60vh'
  }), [containerStyles]);

  // Image wrapper styles - square sized to NOT exceed visible container height
  const maxTileHeight = useMemo(() => {
    const h = availableHeight || containerHeight || 0;
    // Subtract a small margin to avoid off-by-one clipping from borders/scrollbars
    const capped = (h > 0 ? h : 0) - 12;
    return Math.max(100, capped);
  }, [availableHeight, containerHeight]);

  const imageWrapperStyles = useMemo<React.CSSProperties>(() => ({
    width: '100%',
    aspectRatio: '1 / 1',
    maxHeight: maxTileHeight,
    position: 'relative' as const,
    borderRadius: galleryConfig.imageBorderRadius,
    overflow: 'hidden',
    backgroundColor: tileBg,
    border: imageBorder,
    flexShrink: 0, // Never shrink
    boxSizing: 'border-box', // Include border in dimensions
    display: 'block' // Force block display for proper sizing
  }), [maxTileHeight, galleryConfig, tileBg, imageBorder]);

  // Percentage-based vertical margin for first and last images
  const topBottomGapPercent = 0.75; // subtle 0.75% of image size

  

  if (isLoading || isGenerating) {
    return (
      <div style={containerStyles}>
        {Array.from({ length: galleryConfig.maxImages }).map((_, index) => (
          <div
            key={`loading-${index}`}
            className="relative"
            style={imageWrapperStyles}
          >
            {isGenerating ? (
              <div className="absolute inset-0 rounded-lg animate-pulse" style={{ backgroundColor: tileBg }}>
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
    );
  }

  // Showcase hero mode: preserve natural aspect ratio, center, and maximize within area
  const isHero = (isSingleImage || singleImageMode);
  if (isHero) {
    const heroSlot = imageSlots.find(s => s.hasImage) || imageSlots[0];
    // Optional vignette toggle from config (default off)
    const heroVignetteEnabled = Boolean((config as any)?.hero_vignette_enabled);
    return (
      <div ref={rootRef} className="h-full min-h-0 w-full" style={heroContainerStyles}>
        <div
          className="relative"
          style={{
            width: '100%',
            height: '100%',
            maxWidth: availableWidth || '100%',
            maxHeight: availableHeight || '100%',
            minHeight: '60vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            boxSizing: 'border-box'
          }}
        >
          <div
            className="relative group"
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              borderRadius: galleryConfig.imageBorderRadius,
              overflow: 'hidden',
              background: galleryConfig.backgroundColor === 'transparent'
                ? 'linear-gradient(180deg, rgba(0,0,0,0.03), rgba(0,0,0,0.06))'
                : galleryConfig.backgroundColor,
              border: galleryConfig.imageBorderEnabled
                ? `${galleryConfig.imageBorderWidth}px ${galleryConfig.imageBorderStyle} ${galleryConfig.imageBorderColor}`
                : 'none',
              boxShadow: 'none'
            }}
          >
            {heroSlot?.hasImage ? (
              <>
                <AdaptiveImage
                  src={heroSlot.image!}
                  alt={`Generated image ${heroSlot.id + 1}`}
                  fit="contain"
                  fillContainer
                  onClick={() => {
                    if (isSampleGallery && !hasUserGenerated && heroSlot.prompt) {
                      onPromptClick(heroSlot.prompt);
                    } else if (heroSlot.image) {
                      onImageClick(heroSlot.image);
                    }
                  }}
                  className="transition-transform duration-300 cursor-pointer group-hover:scale-[1.02]"
                />
                {/* Optional vignette to emphasize center (disabled by default) */}
                {heroVignetteEnabled && (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        'radial-gradient(60% 60% at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.12) 100%)'
                    }}
                  />
                )}
                {/* Prompt hint when sample gallery */}
                {showPrompts && heroSlot.prompt && isSampleGallery && !hasUserGenerated && (
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-white/95">
                    <div className="text-[inherit] line-clamp-1 md:line-clamp-2">
                      <Sparkles className="inline w-3 h-3 mr-1" />
                      {heroSlot.prompt}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-white hover:bg-white/20 h-7 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (heroSlot.prompt) onPromptClick(heroSlot.prompt);
                      }}
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </>
            ) : heroSlot?.showPlaceholder ? (
              <div 
                className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-colors duration-200 group/placeholder cursor-pointer"
                onClick={onPlaceholderClick}
                style={{
                  backgroundColor: tileBg
                }}
              >
                <div className="w-12 h-12 mb-2 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <ImageIcon className="w-6 h-6 text-gray-400" />
                </div>
                <p className="font-medium text-gray-500 dark:text-gray-400" style={{ fontFamily: config.gallery_font_family || 'inherit', fontSize: (config.gallery_font_size as number | undefined) || undefined }}>Generate Image</p>
                <p className="text-gray-400 dark:text-gray-500 mt-1" style={{ fontFamily: config.gallery_font_family || 'inherit', fontSize: (config.gallery_font_size as number | undefined) || undefined }}>Click to create</p>
                {!deployment && (
                  <div className="mt-2 px-2 py-1 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                    💰 1 credit
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="h-full min-h-0 w-full" style={containerStyles}>
      {imageSlots.map((slot, idx) => (
        <div
          key={slot.id}
          className="relative group"
          style={{
            ...imageWrapperStyles,
            marginTop: (isSingleImage || singleImageMode) ? 0 : (idx === 0 ? `${topBottomGapPercent}%` : 0),
            marginBottom: (isSingleImage || singleImageMode) ? 0 : (idx === imageSlots.length - 1 ? `${topBottomGapPercent}%` : 0)
          }}
        >
          {slot.hasImage ? (
            <>
              <AdaptiveImage
                src={slot.image!}
                alt={`Generated image ${slot.id + 1}`}
                borderRadius={galleryConfig.imageBorderRadius}
                border={imageBorder}
                backgroundColor={tileBg}
                fit={"contain"}
                fillContainer
                onClick={() => {
                  if (isSampleGallery && !hasUserGenerated && slot.prompt) {
                    onPromptClick(slot.prompt);
                  } else {
                    onImageClick(slot.image!);
                  }
                }}
                style={{ width: '100%' }}
              />
              
              {/* Prompt overlay */}
              {showPrompts && slot.prompt && (
                <div
                  className={`absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent transition-opacity duration-200 pointer-events-none ${
                    isSampleGallery && !hasUserGenerated
                      ? "opacity-100"
                      : // For user-generated galleries, keep a small prompt snippet always visible.
                        "opacity-100"
                  }`}
                >
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <div className="flex items-center justify-between text-white">
                      <div className="flex-1 min-w-0">
                        <p
                          className={`font-medium ${
                          isSampleGallery && !hasUserGenerated 
                            ? 'text-[inherit] line-clamp-2 group-hover:line-clamp-none group-hover:max-h-32 group-hover:overflow-y-auto prompt-scroll'
                            : 'text-[inherit] line-clamp-2'
                        }`}
                          style={{
                            fontFamily: config.gallery_font_family || 'inherit',
                            fontSize: (config.gallery_font_size as number | undefined) || undefined
                          }}
                        >
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
                          <p
                            className="text-gray-300 mt-1"
                            style={{ fontFamily: config.gallery_font_family || 'inherit', fontSize: (config.gallery_font_size as number | undefined) || undefined }}
                          >
                            Click anywhere to use this prompt
                          </p>
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
              className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-colors duration-200 group/placeholder cursor-pointer w-full h-full aspect-square"
              onClick={onPlaceholderClick}
              style={{
                backgroundColor: tileBg,
                borderRadius: galleryConfig.imageBorderRadius,
                border: galleryConfig.imageBorderEnabled ? `${galleryConfig.imageBorderWidth}px ${galleryConfig.imageBorderStyle} ${galleryConfig.imageBorderColor}` : '2px dashed #d1d5db',
                boxShadow: galleryConfig.galleryShadowStyle === 'none' ? 'none' : 
                          galleryConfig.galleryShadowStyle === 'subtle' ? '0 1px 3px rgba(0,0,0,0.1)' :
                          galleryConfig.galleryShadowStyle === 'medium' ? '0 4px 6px rgba(0,0,0,0.1)' :
                          galleryConfig.galleryShadowStyle === 'large' ? '0 10px 15px rgba(0,0,0,0.1)' :
                          galleryConfig.galleryShadowStyle === 'glow' ? '0 0 20px rgba(59,130,246,0.3)' : '0 4px 6px rgba(0,0,0,0.1)'
              }}
            >
              <div className="w-12 h-12 mb-2 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-gray-400" />
              </div>
              <p className="font-medium text-gray-500 dark:text-gray-400" style={{ fontFamily: config.gallery_font_family || 'inherit', fontSize: (config.gallery_font_size as number | undefined) || undefined }}>Generate Image</p>
              <p className="text-gray-400 dark:text-gray-500 mt-1" style={{ fontFamily: config.gallery_font_family || 'inherit', fontSize: (config.gallery_font_size as number | undefined) || undefined }}>Click to create</p>
              {!deployment && (
                <div className="mt-2 px-2 py-1 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                  💰 1 credit
                </div>
              )}
            </div>
          ) : null}
        </div>
      ))}
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
