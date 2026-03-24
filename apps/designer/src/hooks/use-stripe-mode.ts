import { useState, useEffect } from "react";
import {
  getResolvedStripeMode,
  type StripeMode,
} from "@/lib/stripe/resolved-mode";

export type { StripeMode };

export function useStripeMode() {
  const [mode, setMode] = useState<StripeMode>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("stripeMode");
      if (stored === "test" || stored === "live") return stored;
    }
    return getResolvedStripeMode();
  });

  useEffect(() => {
    localStorage.setItem("stripeMode", mode)
  }, [mode])

  return { mode, setMode }
} 