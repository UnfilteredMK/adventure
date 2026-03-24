"use client";

import { DesignSettings, getBackgroundColor } from "../../types";
import { motion, useReducedMotion } from "framer-motion";
import { coerceDesignBoolean } from "@/lib/coerce-design-boolean";

interface BrandHeaderProps {
  config: DesignSettings;
  containerWidth?: number;
  hideInMobile?: boolean; // New prop to control mobile/iframe visibility
}

export function BrandHeader({ config, containerWidth = 1024, hideInMobile = false }: BrandHeaderProps) {
  const reduceMotion = useReducedMotion();
  const headerOn = coerceDesignBoolean(config.header_enabled, true);
  const logoOn = coerceDesignBoolean(config.logo_enabled, false);
  const brandOn = coerceDesignBoolean(config.brand_name_enabled, true);
  const hasLogo = logoOn && Boolean(config.logo_url);
  const hasBrandName = brandOn && Boolean(config.brand_name);

  if (!headerOn || (!hasLogo && !hasBrandName) || hideInMobile) {
    return null;
  }

  const headerAlignment = config.header_alignment || 'center'; // left, center, right
  
  const alignmentClasses = {
  center: 'justify-center text-center',
  left: 'justify-start text-left',
  right: 'justify-end text-right'
};

  // Use minimal spacing that respects the configured padding
  const itemGap = Math.max(6, Math.min(16, containerWidth * 0.01));
  const logoHeight = Math.max(16, Math.round((config.logo_height || 48) * 0.9));

  const sticky = Boolean(config.sticky_header);

  return (
    <motion.div
      initial={reduceMotion ? undefined : { opacity: 0, y: -4 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={reduceMotion ? undefined : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={`${sticky ? "sticky top-0" : "relative"} z-20 flex-shrink-0 flex ${alignmentClasses[headerAlignment as keyof typeof alignmentClasses]} w-full`}
      style={{
        backgroundColor: getBackgroundColor(config.background_color || "#ffffff", config.background_opacity),
        fontFamily: config.font_family || 'inherit',
        fontSize: config.base_font_size ? `${config.base_font_size}px` : undefined,
        padding: `10px ${Math.max(12, 16)}px 6px`
      }}
    >
      <div 
        className="flex items-center"
        style={{ gap: `${itemGap}px` }}
      >
        {/* Logo - Always left of brand name */}
        {hasLogo && (
          <img 
            src={config.logo_url} 
            alt={config.brand_name || "Logo"} 
            className="object-contain flex-shrink-0"
            style={{
              height: `${logoHeight}px`,
              maxWidth: `${logoHeight * 2}px`, // Maintain aspect ratio
              border: `${config.logo_border_width || 0}px solid ${config.logo_border_color || '#e5e7eb'}`,
              borderRadius: `${config.logo_border_radius || 4}px`
            }}
          />
        )}
        
        {/* Brand Name - Right of logo */}
        {hasBrandName && (
          <h1 
            className="font-semibold leading-tight"
            style={{ 
              color: config.brand_name_color || '#000000',
              fontFamily: config.brand_name_font_family || 'inherit',
              fontSize: `${config.brand_name_font_size || 32}px`,
            }}
          >
            {config.brand_name}
          </h1>
        )}
      </div>
    </motion.div>
  );
} 
