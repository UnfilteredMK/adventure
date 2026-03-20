"use client";

import React, { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { layoutDebugClassName, withLayoutDebugStyle } from "../steps/runtime/step-engine/debug-layout";

interface EaseFeedbackPromptProps {
  visible: boolean;
  onSelect: (vote: "up" | "down") => void;
  layoutDebugEnabled?: boolean;
}

export function EaseFeedbackPrompt({ visible, onSelect, layoutDebugEnabled = false }: EaseFeedbackPromptProps) {
  if (!visible) return null;
  return (
    <div
      className={layoutDebugClassName(layoutDebugEnabled, "flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground")}
      style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "sky")}
    >
      <span className="whitespace-nowrap hidden sm:inline">Easy to answer?</span>
      <button
        type="button"
        onClick={() => onSelect("up")}
        className="flex items-center justify-center w-7 h-7 rounded-full border border-border/70 bg-background/90 hover:bg-emerald-50/70 hover:border-emerald-300 transition-colors"
        style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
        aria-label="Yes, easy to answer"
      >
        <ThumbsUp className="w-3.5 h-3.5 text-foreground/80" />
      </button>
      <button
        type="button"
        onClick={() => onSelect("down")}
        className="flex items-center justify-center w-7 h-7 rounded-full border border-border/70 bg-background/90 hover:bg-rose-50/70 hover:border-rose-300 transition-colors"
        style={withLayoutDebugStyle(undefined, layoutDebugEnabled, "violet")}
        aria-label="Not really, difficult to answer"
      >
        <ThumbsDown className="w-3.5 h-3.5 text-foreground/80" />
      </button>
    </div>
  );
}

interface ReflectionFeedbackPromptProps {
  visible: boolean;
  onSubmit: (rating: number, comment: string) => void;
}

export function ReflectionFeedbackPrompt({ visible, onSubmit }: ReflectionFeedbackPromptProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!visible || submitted) return null;

  const handleSubmit = () => {
    if (!rating) return;
    onSubmit(rating, comment.trim());
    setSubmitted(true);
  };

  return (
    <div className="mt-5 w-full max-w-xl rounded-xl border border-border/70 bg-background/90 px-4 py-4 shadow-sm backdrop-blur">
      <div className="text-sm font-semibold text-foreground">Did this reflect your project?</div>
      <div className="mt-3 flex gap-2">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            className={`h-9 w-9 rounded-full border text-sm font-semibold ${
              rating === value
                ? "border-foreground bg-foreground text-background"
                : "border-border/80 bg-background text-foreground/80"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="What was missing? (optional)"
        className="mt-3 h-20 w-full resize-none rounded-lg border border-border/80 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      <button
        type="button"
        onClick={handleSubmit}
        className="mt-3 w-full rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background disabled:opacity-50"
        disabled={!rating}
      >
        Send feedback
      </button>
    </div>
  );
}
