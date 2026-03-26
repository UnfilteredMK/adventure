"use client";

import React, { useMemo } from "react";
import { SquareImage } from "./SquareImage";
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

  // Container styles - vertical stack of rows
  const containerStyles = useMemo(() => ({
    backgroundColor: galleryConfig.backgroundColor,
    fontFamily: config.gallery_font_family || 'inherit',
    fontSize: config.gallery_font_size,
    padding: 0,
    width: '100%',
    height: '100%',
    minHeight: 0,
    maxHeight: '100%',
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    WebkitOverflowScrolling: 'touch' as const,
    overscrollBehavior: 'contain' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: galleryConfig.spacing,
  }), [galleryConfig, config]);

  // Row styles - 1fr 1fr grid, full width and height
  const rowStyles = useMemo(() => ({
    display: 'grid',
    gridTemplateColumns: '1fr 1fr', // Equal columns
    width: '100%',
    height: 'auto', // Height determined by square images
    gap: galleryConfig.spacing, // Spacing between images
    justifyItems: 'stretch', // Images stretch to fill their grid cell width
    alignItems: 'center', // Center images vertically
    flexShrink: 0
  }), [galleryConfig.spacing]);

  // Image wrapper styles - ALWAYS SQUARE, no exceptions
  const imageWrapperStyles = useMemo(() => ({
    width: '100%', // Fill the 1fr column width
    aspectRatio: '1 / 1', // ALWAYS SQUARE - height = width
    position: 'relative' as const,
    borderRadius: galleryConfig.imageBorderRadius,
    overflow: 'hidden',
    backgroundColor: tileBg,
    border: imageBorder,
    justifySelf: 'center', // Center in grid cell horizontally
    alignSelf: 'center', // Center in grid cell vertically
    flexShrink: 0 // Never shrink - maintain square
  }), [galleryConfig, tileBg, imageBorder]);

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
      <div style={containerStyles}>
        {Array.from({ length: galleryConfig.maxImages }).map((_, index) => (
          <div
            key={`loading-${index}`}
            className="relative"
            style={imageWrapperStyles}
          >
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
    );
  }

  // Group images into rows of 2
  const rows = [];
  for (let i = 0; i < imageSlots.length; i += 2) {
    rows.push(imageSlots.slice(i, i + 2));
  }

  // Percentage-based vertical margin for first and last rows
  const topBottomGapPercent = 0.75; // subtle 0.75% of image size

  return (
    <div ref={rootRef} className="relative h-full min-h-0 w-full" style={containerStyles}>
      {rows.map((rowSlots, rowIndex) => (
        <div key={`row-${rowIndex}`} style={{
          ...rowStyles,
          marginTop: rowIndex === 0 ? `${topBottomGapPercent}%` : 0,
          marginBottom: rowIndex === rows.length - 1 ? `${topBottomGapPercent}%` : 0
        }}>
          {rowSlots.map((slot) => (
            <div
              key={slot.id}
              className="relative group"
              style={imageWrapperStyles}
            >
          {slot.hasImage ? (
            <>
              <SquareImage
                src={slot.image!}
                alt={`Generated image ${slot.id + 1}`}
                sizePercent={100}
                borderRadius={galleryConfig.imageBorderRadius}
                border={imageBorder}
                backgroundColor={tileBg}
                objectFit={"cover"}
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
              className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-colors duration-200 group/placeholder cursor-pointer w-full h-full aspect-square"
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
                aspectRatio: '1 / 1'
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
