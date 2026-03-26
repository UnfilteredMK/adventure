"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { DesignSettings } from "../../../types";
import { DrillDownModal } from "../drilldown/DrillDownModal";
import { Suggestion } from "../../../lib/suggestions";
import { PlaceholderGallery } from "./PlaceholderGallery";
import { SingleColumnGallery } from "./SingleColumnGallery";
import { MultiColumnGallery } from "./MultiColumnGallery";
import { useSubcategoryImages } from "../../../hooks/use-subcategory-images";
import { useInstanceImages } from "../../../hooks/use-instance-images";
import { Sparkles, ArrowRight, DollarSign, RefreshCw } from "lucide-react";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { useShopifyContext } from "@/hooks/use-shopify-context";
import { ShopifyProductSummaryCard } from "./ShopifyProductSummaryCard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/dialog";
import { AnimatePresence, motion } from "framer-motion";

interface ImageGalleryProps {
  images: Array<{ image: string | null; prompt?: string | null; id?: string }>;
  isLoading: boolean;
  isGenerating?: boolean; // Add this prop
  config: DesignSettings;
  fullPage?: boolean;
  deployment?: boolean;
  layoutContext?: 'vertical' | 'horizontal';
  containerWidth?: number;
  containerHeight?: number; // Add available height for proper sizing
  instanceId?: string;
  onGenerateGallery?: () => void;
  onResetToSampleGallery?: () => void; // Add this prop
  // DrillDownModal props
  prompt?: string;
  setPrompt?: (prompt: string) => void;
  suggestions?: Suggestion[];
  referenceImages?: string[];
  onPromptSubmit?: (prompt: string) => void;
  onDrillDownSubmit?: (drillDownPrompt: string, selectedImage: string) => void; // Add drill-down submit function
  onSuggestionClick?: (suggestion: Suggestion) => void;
  onImageUpload?: (imageData: string | null) => void;
  onImageRemove?: (index: number) => void;
  onRefreshSuggestions?: () => void;
  onReplaceImage?: (imageData: string) => void; // Add replace image function
  /** Optional callback to track which image is being edited in the drilldown modal. */
  onActiveImageChange?: (image: string | null) => void;
  originalPrompt?: string;
  refreshTrigger?: number; // Add this to trigger refresh when generation completes
  // Lead capture plumbing
  hasSubmitted?: boolean;
  onRequestLeadCapture?: () => void;
  // Regenerate overlay (used by AI Form GalleryStep, and can be reused elsewhere)
  onRegenerate?: () => void;
  regenerationsRemaining?: number;
}

export function ImageGallery({
  images,
  isLoading,
  isGenerating, // Add this parameter
  config,
  deployment = false,
  containerWidth = 1024,
  containerHeight, // Add available height
  instanceId,
  onGenerateGallery,
  onResetToSampleGallery, // Destructure new prop
  // DrillDownModal props
  prompt = "",
  setPrompt = () => {},
  suggestions = [],
  referenceImages = [],
  onPromptSubmit = () => {},
  onDrillDownSubmit = () => {}, // Add drill-down submit function
  onSuggestionClick = () => {},
  onImageUpload = () => {},
  onImageRemove = () => {},
  onRefreshSuggestions = () => {},
  onReplaceImage = () => {}, // Add replace image function
  onActiveImageChange,
  originalPrompt = "",
  refreshTrigger = 0, // Initialize with 0
  // Lead capture plumbing
  hasSubmitted,
  onRequestLeadCapture,
  onRegenerate,
  regenerationsRemaining
}: ImageGalleryProps) {

  const shopify = useShopifyContext();
  const demoEnabled = config.demo_enabled !== false;
  const placeholdersEnabled = config.gallery_show_placeholder_images === true;
  // "Sample gallery" / instance-image fallback should only ever run when placeholders are enabled.
  // Otherwise we can briefly render samples while data loads/hydrates (flash).
  const sampleGalleryEnabled = Boolean(
    placeholdersEnabled && (config.gallery_sample_gallery_enabled ?? true)
  );
  const shopifyImages = useMemo(() => {
    const norm = (u: string): string | null => {
      if (!u) return null;
      let s = u.trim();
      if (s.startsWith("//")) s = `https:${s}`;
      try {
        const parsed = new URL(s);
        return `${parsed.origin}${parsed.pathname}${parsed.search}`;
      } catch {
        let out = s.split("#")[0];
        if (out.startsWith("//")) out = `https:${out}`;
        if (!/^https?:\/\//i.test(out)) out = `https://${out}`;
        return out;
      }
    };
    const arr = Array.isArray(shopify?.images) ? shopify!.images : [];
    const normalized = arr.map(norm).filter((x): x is string => !!x);
    return Array.from(new Set(normalized));
  }, [shopify, shopify?.images]);
  // Auto-sync Shopify images into uploader once
  const shopifyUploaderSyncRef = useRef(false);
  useEffect(() => {
    if (shopify?.isShopify && shopifyImages.length > 0 && !shopifyUploaderSyncRef.current) {
      shopifyUploaderSyncRef.current = true;
      // Add all product images to uploader (parent enforces max)
      shopifyImages.forEach((u) => {
        try { onImageUpload(u); } catch {}
      });
    }
  }, [shopify?.isShopify, shopifyImages, onImageUpload]);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isDrillDownOpen, setIsDrillDownOpen] = useState(false);
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const [showCreditDialog, setShowCreditDialog] = useState(false);
  const [hasUserGenerated, setHasUserGenerated] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Check subcategory images if instanceId is provided (hook may have side-effects / caching)
  useSubcategoryImages(instanceId || "");
  
  // Fetch instance images if instanceId is provided AND we don't have generated images
  const shouldFetchInstanceImages = sampleGalleryEnabled && instanceId && images.length === 0 && !shopify?.isShopify;

  const { 
    images: instanceImages, 
    loading: instanceImagesLoading, 
    refresh: refreshImages,
    isSampleGallery,
    setIsGenerating: setInstanceIsGenerating
  } = useInstanceImages(shouldFetchInstanceImages ? instanceId : null);

  // Check if user has generated anything (for this session)
  useEffect(() => {
    if (instanceId) {
      const hasGenerated = sessionStorage.getItem(`has_generated_${instanceId}`) === 'true';
      setHasUserGenerated(hasGenerated);
    }
  }, [instanceId]);

  // Watch for refresh trigger changes (when generation completes)
  useEffect(() => {
    if (refreshTrigger > 0 && instanceId) {
      setInstanceIsGenerating(false);
      // Don't refresh images if we have generated images - they're already in the props
      if (images.length === 0) {
        refreshImages();
      }
    }
  }, [refreshTrigger, instanceId, refreshImages, setInstanceIsGenerating, images.length]);

  // Use passed images (generated) if available, otherwise fall back to instance images (sample gallery)
  const effectiveImages = useMemo(() => {
    if (images.length > 0) {
      // Use generated images from props
      const result = images.map(img => ({ 
        image: img.image, 
        prompt: img.prompt || null, 
        id: img.id || `generated-${Math.random()}` 
      }));
      return result;
    } else if (sampleGalleryEnabled && instanceImages.length > 0) {
      // Fall back to instance images (sample gallery)
      const result = instanceImages.map(img => ({ 
        image: img.image, 
        prompt: img.prompt || null, 
        id: img.id 
      }));
      return result;
    } else {
      // No images available
      return [];
    }
  }, [images, instanceImages, sampleGalleryEnabled]);

  // During generation, avoid rendering a "temporary" gallery (sample/placeholder) that can cause
  // layout/scroll changes and then "snap" once real outputs arrive. Instead show a stable loader.
  const hasMeaningfulPropImages = useMemo(() => {
    const isHomepageSample = (src: string) => src.startsWith("/homepage/");
    return images.some((img) => {
      const src = img?.image;
      return typeof src === "string" && src.trim().length > 0 && !isHomepageSample(src.trim());
    });
  }, [images]);

  const showGenerationLoader = Boolean(isGenerating) && !hasMeaningfulPropImages;
  const generationLabel = (config.gallery_max_images || 1) > 1 ? "Generating images…" : "Generating image…";



  // Get configuration values with defaults
  const galleryConfig = useMemo(() => ({
    columns: config.gallery_columns || 3,
    spacing: config.gallery_spacing ?? 0, // Allow zero spacing
    maxImages: config.gallery_max_images || 12,
    backgroundColor: config.gallery_background_color || 'transparent',
    containerBorderEnabled: config.gallery_container_border_enabled ?? false,
    containerBorderWidth: config.gallery_container_border_width ?? 1,
    containerBorderColor: config.gallery_container_border_color || '#e5e7eb',
    containerBorderStyle: config.gallery_container_border_style || 'solid',
    containerBorderRadius: config.gallery_container_border_radius ?? 12,
    imageBorderEnabled: config.gallery_image_border_enabled ?? false,
    imageBorderWidth: config.gallery_image_border_width ?? 1,
    imageBorderColor: config.gallery_image_border_color || '#e5e7eb',
    imageBorderStyle: config.gallery_image_border_style || 'solid',
    imageBorderRadius: config.gallery_image_border_radius ?? 8,
    galleryShadowStyle: config.gallery_shadow_style || 'medium',
    overlayEnabled: false, // Disable overlay since we're using DrillDownModal
  }), [config]);

  // Single image hero mode: 1 column and max 1 image
  const singleImageMode = useMemo(() => {
    return (galleryConfig.columns === 1) && (galleryConfig.maxImages === 1);
  }, [galleryConfig.columns, galleryConfig.maxImages]);

  // Create array of slots based on max images
  const imageSlots = useMemo(() => {
    // When placeholders are disabled, only render real images (no empty slots).
    const slotCount = placeholdersEnabled
      ? galleryConfig.maxImages
      : Math.min(effectiveImages.length, galleryConfig.maxImages);

    const slots = Array.from({ length: slotCount }, (_, index) => {
      const imageData = effectiveImages[index]?.image;
      const slot = {
        id: index,
        image: imageData,
        hasImage: !!imageData,
        prompt: effectiveImages[index]?.prompt || null,
        showPlaceholder: placeholdersEnabled && !imageData,
      };
      return slot;
    });

    return slots;
  }, [
    effectiveImages,
    galleryConfig.maxImages,
    placeholdersEnabled,
    isSampleGallery,
    hasUserGenerated,
  ]);

  // Determine if single column mode
  const isSingleColumn = galleryConfig.columns === 1;

  const handleImageClick = (image: string) => {
    // If this is sample gallery (we're using instanceImages, not generated images), treat as suggestion
    if (images.length === 0 && instanceImages.length > 0) {
      // This is a sample gallery image - treat as suggestion
      const imageSlot = imageSlots.find(slot => slot.image === image);
      if (imageSlot?.prompt) {
        setPrompt(imageSlot.prompt);
        // Optionally trigger generation or just set the prompt
      }
    } else {
      // Normal drilldown behavior for generated images
      setSelectedImage(image);
      setIsDrillDownOpen(true);
      onActiveImageChange?.(image);
    }
  };

  const handleCloseDrillDown = () => {
    setIsDrillDownOpen(false);
    setSelectedImage(null);
    onActiveImageChange?.(null);
  };

  const handleDrillDownPromptSubmit = (newPrompt: string) => {
    // Start generation state
    setInstanceIsGenerating(true);
    
    // Use the drill-down submit function if available and we have a selected image
    if (onDrillDownSubmit && selectedImage) {
      onDrillDownSubmit(newPrompt, selectedImage);
    } else {
      // Fallback to regular prompt submit
      onPromptSubmit(newPrompt);
    }
    
    handleCloseDrillDown();
  };

  const handlePromptClick = (prompt: string) => {
    // If this is sample gallery, treat as suggestion
    if (isSampleGallery && !hasUserGenerated) {
      setPrompt(prompt);
      
    } else {
      // Normal behavior for generated images
      setPrompt(prompt);
    }
  };

  const handleResetToSampleGallery = () => {
    if (!sampleGalleryEnabled) return;
    if (instanceId) {
      // Clear session storage
      sessionStorage.removeItem(`has_generated_${instanceId}`);
      
      // Reset local state
      setHasUserGenerated(false);
      setInstanceIsGenerating(false);
      
      // Clear generated images by calling the parent's reset function
      if (onResetToSampleGallery) {
        onResetToSampleGallery(); // This will clear the generated images
      }
    }
  };

  const handlePlaceholderClick = () => {
    // Show credit confirmation dialog
    setShowCreditDialog(true);
  };

  const handleConfirmGeneration = () => {
    setShowCreditDialog(false);
    // Open the DrillDownModal for image generation
    setSelectedImage(null); // No selected image since we're generating new one
    setIsDrillDownOpen(true);
    onActiveImageChange?.(null);
  };

  const handleBackToGallery = () => {
    setShowPlaceholders(false);
  };

  return (
    <>
      {showPlaceholders ? (
        // Show placeholder gallery
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackToGallery}
              className="flex items-center gap-2"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              Back to Gallery
            </Button>
          </div>
          <PlaceholderGallery
            config={config}
            instanceId={instanceId}
            onGenerateGallery={onGenerateGallery}
            onImageClick={handlePlaceholderClick}
            onPromptClick={handlePromptClick}
          />
        </div>
      ) : (
        // Show main gallery
        <div 
          ref={rootRef}
          data-tour="gallery-area"
          className="relative h-full min-h-0 w-full"
          style={{ 
            height: '100%', // Fill parent height - bounded by gallery section
            minHeight: 0,
            width: '100%',
            maxHeight: '100%', // Don't overflow parent
            overflow: 'hidden', // Container doesn't scroll - children do
            boxSizing: 'border-box', // Include padding/borders in height calculation
            // Typography cascade for all gallery content
            fontFamily: config.gallery_font_family || 'inherit',
            fontSize: config.gallery_font_size,
            // Apply gallery container border styles
            border: showGenerationLoader
              ? 'none'
              : galleryConfig.containerBorderEnabled 
              ? `${galleryConfig.containerBorderWidth}px ${galleryConfig.containerBorderStyle} ${galleryConfig.containerBorderColor}`
              : 'none',
            borderRadius: galleryConfig.containerBorderRadius
          }}
        >
          {/* Top-right overlays */}
          <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
            {(() => {
              const bg =
                config.prompt_input_background_color ||
                config.secondary_color ||
                "rgba(255,255,255,0.86)";
              const borderColor =
                config.prompt_border_color ||
                config.gallery_container_border_color ||
                "rgba(0,0,0,0.10)";
              const textColor = config.prompt_text_color || config.brand_name_color || "#111827";

              const surfaceStyle: React.CSSProperties = {
                backgroundColor: bg,
                borderColor,
                color: textColor,
                boxShadow: "0 10px 24px rgba(0,0,0,0.10)",
              };

              const buttonStyle: React.CSSProperties = {
                ...surfaceStyle,
                borderWidth: 1,
                borderStyle: "solid",
              };

              return (
                <>
                  {typeof onRegenerate === "function" && images.length > 0 && (
                    <>
                      {typeof regenerationsRemaining === "number" && (
                        <div
                          className="px-2 py-1 rounded-full backdrop-blur-sm border text-[11px]"
                          style={surfaceStyle}
                        >
                          {Math.max(0, Math.floor(regenerationsRemaining))} left
                        </div>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onRegenerate()}
                        disabled={
                          Boolean(isGenerating) ||
                          (typeof regenerationsRemaining === "number" && regenerationsRemaining <= 0)
                        }
                        className="h-8 w-8 p-0 backdrop-blur-sm border hover:opacity-95"
                        style={buttonStyle}
                        title="Regenerate"
                        aria-label="Regenerate"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                    </>
                  )}

                  {/* Reset Button - Overlay */}
                  {sampleGalleryEnabled && hasUserGenerated && images.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleResetToSampleGallery}
                      className="h-8 px-3 text-xs backdrop-blur-sm border hover:opacity-95"
                      style={buttonStyle}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      Back to Samples
                    </Button>
                  )}
                </>
              );
            })()}
          </div>
          
          {/* Conditionally render single or multi-column gallery */}
          <AnimatePresence mode="wait" initial={false}>
            {showGenerationLoader ? (
              <motion.div
                key="gen"
                className="h-full w-full flex items-center justify-center"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-2">
                  <Spinner className="h-4 w-4" />
                  <div
                    className="text-sm font-medium"
                    style={{
                      color: config.prompt_text_color || config.brand_name_color || "#0f172a",
                      fontFamily: config.prompt_font_family || config.gallery_font_family || "inherit",
                    }}
                  >
                    {generationLabel}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="gallery"
                className="h-full min-h-0 w-full"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                {isSingleColumn ? (
                  <SingleColumnGallery
                    imageSlots={imageSlots}
                    isLoading={isLoading || instanceImagesLoading}
                    isGenerating={isGenerating}
                    config={config}
                    containerWidth={containerWidth}
                    containerHeight={containerHeight}
                    isSampleGallery={isSampleGallery}
                    hasUserGenerated={hasUserGenerated}
                    deployment={deployment}
                    onImageClick={handleImageClick}
                    onPromptClick={handlePromptClick}
                    onPlaceholderClick={handlePlaceholderClick}
                    singleImageMode={singleImageMode}
                  />
                ) : (
                  <MultiColumnGallery
                    imageSlots={imageSlots}
                    isLoading={isLoading || instanceImagesLoading}
                    isGenerating={isGenerating}
                    config={config}
                    containerWidth={containerWidth}
                    containerHeight={containerHeight}
                    isSampleGallery={isSampleGallery}
                    hasUserGenerated={hasUserGenerated}
                    deployment={deployment}
                    onImageClick={handleImageClick}
                    onPromptClick={handlePromptClick}
                    onPlaceholderClick={handlePlaceholderClick}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Shopify product summary overlay (only when Shopify context is active) */}
          {shopify?.isShopify && shopifyImages.length > 0 && (
            <ShopifyProductSummaryCard
              images={shopifyImages}
              title={shopify?.productTitle}
              description={shopify?.productDescription}
              priceMin={shopify?.productPriceMin}
              priceMax={shopify?.productPriceMax}
              currency={shopify?.productCurrency}
              config={config}
            />
          )}
        </div>
      )}

      {/* DrillDownModal */}
      <DrillDownModal
          isOpen={isDrillDownOpen}
          onClose={handleCloseDrillDown}
          selectedImage={selectedImage}
          config={config}
          prompt={prompt}
          setPrompt={setPrompt}
          isLoading={isLoading}
          suggestions={suggestions}
          referenceImages={referenceImages}
          generatedImages={images}
          containerWidth={containerWidth}
          onPromptSubmit={handleDrillDownPromptSubmit}
          onSuggestionClick={onSuggestionClick}
          onImageUpload={onImageUpload}
          onImageRemove={onImageRemove}
          onRefreshSuggestions={onRefreshSuggestions}
          onReplaceImage={onReplaceImage}
          originalPrompt={originalPrompt}
          instanceId={instanceId}
          hasSubmitted={hasSubmitted}
          onRequestLeadCapture={onRequestLeadCapture}
        />

      {/* Credit Confirmation Dialog */}
      <Dialog open={showCreditDialog} onOpenChange={setShowCreditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-yellow-600" />
              Generate New Image
            </DialogTitle>
            <DialogDescription>
              This will cost 1 credit from your account. Are you sure you want to proceed?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setShowCreditDialog(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmGeneration}
              className="flex-1"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Generate (1 credit)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
} 
