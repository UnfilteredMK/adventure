"use client";

import * as React from "react";
import { useFormTheme } from "../../demo/FormThemeProvider";
import { coerceDesignBoolean } from "@/lib/coerce-design-boolean";

interface BrandingHeaderProps {
  className?: string;
}

export function BrandingHeader({ className }: BrandingHeaderProps) {
  const { theme, config } = useFormTheme();
  const headerOn = coerceDesignBoolean(config.header_enabled, true);
  const logoOn = coerceDesignBoolean(config.logo_enabled, false);
  const brandOn = coerceDesignBoolean(config.brand_name_enabled, true);
  const showLogo = headerOn && logoOn && Boolean(config.logo_url);
  const showBrand = headerOn && brandOn && Boolean(config.brand_name);

  if (!showLogo && !showBrand) return null;

  const logoHeight = Number.isFinite(Number(config.logo_height))
    ? Math.max(18, Math.min(64, Math.floor(Number(config.logo_height))))
    : 28;

  return (
    <div className={className}>
      <div className="flex items-center gap-2.5 py-1.5">
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={String(config.logo_url)}
            alt={showBrand ? String(config.brand_name) : "Brand logo"}
            className="w-auto object-contain"
            style={{
              height: `${logoHeight}px`,
              borderRadius: `${Number(config.logo_border_radius || 0)}px`,
              borderWidth: Number(config.logo_border_width || 0) ? `${Number(config.logo_border_width)}px` : undefined,
              borderStyle: Number(config.logo_border_width || 0) ? "solid" : undefined,
              borderColor: config.logo_border_color || undefined,
            }}
          />
        ) : null}
        {showBrand ? (
          <span
            className="font-semibold leading-none"
            style={{
              color: config.brand_name_color || theme.textColor,
              fontFamily: config.brand_name_font_family || theme.fontFamily,
              fontSize: `${Math.max(12, Math.min(30, Number(config.brand_name_font_size || 18)))}px`,
            }}
          >
            {String(config.brand_name)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
