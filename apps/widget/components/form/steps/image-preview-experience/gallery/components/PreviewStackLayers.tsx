"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PreviewStackLayer } from "../types";

type PreviewStackLayersProps = {
  layers: PreviewStackLayer[];
};

export function PreviewStackLayers({ layers }: PreviewStackLayersProps) {
  return (
    <AnimatePresence initial={false}>
      {layers.map((layerConfig, idx) => {
        const layer = idx + 1;
        const isTransitionLayer = layerConfig.kind === "transition";
        const x = -(14 + idx * 10);
        const y = 2 + idx * 2;
        const rotate = -0.45 - idx * 0.18;
        const scale = 0.986 - idx * 0.022;
        const blurPx = isTransitionLayer ? 1.2 + idx * 1.2 : 2.4 + idx * 1.5;
        const layerOpacity = isTransitionLayer ? Math.max(0.5, 0.7 - idx * 0.08) : Math.max(0.18, 0.34 - idx * 0.09);
        const layerOverlay = isTransitionLayer ? Math.min(0.72, 0.54 + idx * 0.08) : Math.min(0.86, 0.64 + idx * 0.1);
        return (
          <motion.div
            key={layerConfig.key}
            className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none"
            style={{
              zIndex: layer,
              border: "1px solid rgba(255,255,255,0.2)",
              boxShadow: isTransitionLayer ? "0 18px 34px rgba(0,0,0,0.28)" : "0 8px 20px rgba(0,0,0,0.22)",
              backgroundColor: "#0f172a",
            }}
            initial={
              isTransitionLayer
                ? { x: 0, y: 0, rotate: 0, scale: 1.01, opacity: 0.84 }
                : { x: x + 6, y, rotate: rotate - 0.08, scale, opacity: 0 }
            }
            animate={{ x, y, rotate, scale, opacity: layerOpacity }}
            exit={isTransitionLayer ? { x, y: y + 2, rotate, scale, opacity: 0 } : { x: x - 4, y, rotate, scale, opacity: 0 }}
            transition={{ duration: isTransitionLayer ? 0.26 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={layerConfig.src}
              alt=""
              aria-hidden
              className="h-full w-full object-cover"
              style={{
                filter: `blur(${blurPx}px) saturate(0.85) brightness(${isTransitionLayer ? 0.84 : 0.72})`,
                transform: "scale(1.02)",
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(120% 100% at 50% 50%, rgba(15,23,42,${Math.max(0.4, layerOverlay - 0.18)}) 0%, rgba(15,23,42,${layerOverlay}) 72%, rgba(15,23,42,${Math.min(0.92, layerOverlay + 0.14)}) 100%)`,
              }}
            />
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}
