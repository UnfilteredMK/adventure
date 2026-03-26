"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PreviewLightboxProps = {
  hero: string | null;
  lightboxOpen: boolean;
  lightboxContain: boolean;
  primary: string;
  closeLightbox: () => void;
  setLightboxContain: React.Dispatch<React.SetStateAction<boolean>>;
  darkenHex: (hex: string, mixBlack: number) => string;
  hexToRgba: (hex: string, alpha: number) => string | null;
};

export function PreviewLightbox({
  hero,
  lightboxOpen,
  lightboxContain,
  primary,
  closeLightbox,
  setLightboxContain,
  darkenHex,
  hexToRgba,
}: PreviewLightboxProps) {
  return (
    <AnimatePresence initial={false}>
      {lightboxOpen && hero ? (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8 overscroll-contain touch-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onClick={closeLightbox}
        >
          <motion.div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          />

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            onAnimationComplete={() => setLightboxContain(true)}
            className="relative w-full aspect-square overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10"
            style={{
              maxWidth: "min(80rem, calc(100dvh - clamp(2rem, 8vw, 4rem)))",
              maxHeight: "calc(100dvh - clamp(2rem, 8vw, 4rem))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/70 via-black/35 to-transparent px-3 py-3 sm:px-4">
              <div className="min-w-0">
                <div className="text-xs font-medium text-white/95">Expanded preview</div>
                <div className="text-[0.6875rem] text-white/75">Press Esc or click outside to close</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[0.6875rem] font-medium text-white hover:opacity-90"
                  style={{
                    backgroundColor: darkenHex(primary, 0.5),
                    borderColor: hexToRgba(primary, 0.4) || "rgba(255,255,255,0.2)",
                  }}
                  onClick={() => setLightboxContain((prev) => !prev)}
                  aria-label={lightboxContain ? "Switch to fill mode" : "Switch to fit mode"}
                >
                  {lightboxContain ? "Fill" : "Fit"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-9 w-9 rounded-full text-white hover:opacity-90"
                  style={{
                    backgroundColor: darkenHex(primary, 0.5),
                    borderColor: hexToRgba(primary, 0.4) || "rgba(255,255,255,0.2)",
                  }}
                  onClick={closeLightbox}
                  aria-label="Close expanded preview"
                >
                  <span className="text-xl leading-none">&times;</span>
                </Button>
              </div>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hero}
              alt="Preview"
              className={cn(
                "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
                lightboxContain ? "opacity-0" : "opacity-100"
              )}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hero}
              alt="Preview (full)"
              className={cn(
                "absolute inset-0 h-full w-full object-contain transition-opacity duration-300",
                lightboxContain ? "opacity-100" : "opacity-0"
              )}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 py-3 text-[0.6875rem] text-white/80 sm:px-4">
              {lightboxContain ? "Fit mode: shows the full image." : "Fill mode: crops edges to fill the frame."}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
