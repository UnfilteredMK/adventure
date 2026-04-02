"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { layoutDebugClassName, withLayoutDebugStyle } from "../debug-layout";

export type DesignAdventureInputMode = "questions" | "ideas" | "prompt" | "budget" | "uploads";

export interface DesignModeToolbarProps {
  adventureInputMode: DesignAdventureInputMode;
  setAdventureInputMode: (mode: DesignAdventureInputMode) => void;
  designToolsNeedLead: boolean;
  guidedTabDisabled: boolean;
  textMuted: string | undefined;
  layoutDebugEnabled: boolean;
  /** Smaller tab strip when the question pane is squashed (preview-under layout, including desktop). */
  compactTabs: boolean;
}

function modeTabClass(active: boolean, equalWidth: boolean, compactTabs: boolean) {
  return cn(
    "inline-flex min-w-0 items-center justify-center gap-0.5 rounded-full text-xs font-medium leading-none transition-colors",
    equalWidth ? "w-full" : "w-auto shrink-0",
    compactTabs
      ? cn(
          "min-h-[22px] h-[22px] text-[clamp(9px,1.3vh,11px)]",
          equalWidth ? "px-1" : "px-2"
        )
      : cn("h-6 min-h-[24px]", equalWidth ? "px-1.5" : "px-2.5"),
    active ? "bg-primary/10 text-foreground" : ""
  );
}

export function DesignModeToolbar({
  adventureInputMode,
  setAdventureInputMode,
  designToolsNeedLead,
  guidedTabDisabled,
  textMuted,
  layoutDebugEnabled,
  compactTabs,
}: DesignModeToolbarProps) {
  const muted = textMuted || "var(--form-text-color)";

  return (
    <div
      className={layoutDebugClassName(
        layoutDebugEnabled,
        cn(
          "flex w-full min-w-0 max-w-full items-center gap-0.5 rounded-full border border-[color:var(--form-surface-border-color)] bg-[var(--form-surface-color)] p-0.5",
          compactTabs ? "min-h-[28px] py-px" : "min-h-0 py-0.5"
        )
      )}
      style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
    >
      <button
        type="button"
        onClick={() => setAdventureInputMode("ideas")}
        className={modeTabClass(adventureInputMode === "ideas", false, compactTabs)}
        style={adventureInputMode !== "ideas" ? { color: muted } : undefined}
        title="Explore AI-suggested upgrades and styles"
      >
        <Sparkles
          className={cn("shrink-0 opacity-90", compactTabs ? "h-2.5 w-2.5" : "h-3 w-3")}
          aria-hidden
        />
        <span className="whitespace-nowrap">Ideas</span>
      </button>
      <div
        className={layoutDebugClassName(
          layoutDebugEnabled,
          "grid min-h-0 min-w-0 flex-1 grid-cols-4 items-center gap-0.5 self-center"
        )}
      >
        <button
          type="button"
          disabled={guidedTabDisabled}
          title={guidedTabDisabled ? "Finish the pricing step on the preview image to unlock" : undefined}
          onClick={() => setAdventureInputMode("questions")}
          className={cn(
            modeTabClass(adventureInputMode === "questions", true, compactTabs),
            guidedTabDisabled ? "opacity-45" : null
          )}
          style={adventureInputMode !== "questions" ? { color: muted } : undefined}
        >
          <span className="truncate">Guided</span>
        </button>
        <button
          type="button"
          disabled={designToolsNeedLead}
          title={designToolsNeedLead ? "Finish the pricing step on the preview image to unlock" : undefined}
          onClick={() => setAdventureInputMode("prompt")}
          className={cn(
            modeTabClass(adventureInputMode === "prompt", true, compactTabs),
            designToolsNeedLead ? "opacity-45" : null
          )}
          style={adventureInputMode !== "prompt" ? { color: muted } : undefined}
        >
          <span className="truncate">Prompt</span>
        </button>
        <button
          type="button"
          disabled={designToolsNeedLead}
          title={designToolsNeedLead ? "Finish the pricing step on the preview image to unlock" : undefined}
          onClick={() => setAdventureInputMode("budget")}
          className={cn(
            modeTabClass(adventureInputMode === "budget", true, compactTabs),
            designToolsNeedLead ? "opacity-45" : null
          )}
          style={adventureInputMode !== "budget" ? { color: muted } : undefined}
        >
          <span className="truncate">Budget</span>
        </button>
        <button
          type="button"
          disabled={designToolsNeedLead}
          title={designToolsNeedLead ? "Finish the pricing step on the preview image to unlock" : undefined}
          onClick={() => setAdventureInputMode("uploads")}
          className={cn(
            modeTabClass(adventureInputMode === "uploads", true, compactTabs),
            designToolsNeedLead ? "opacity-45" : null
          )}
          style={adventureInputMode !== "uploads" ? { color: muted } : undefined}
        >
          <span className="truncate">Uploads</span>
        </button>
      </div>
    </div>
  );
}
