"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Suggestion } from "@/types";

type PreviewSuggestionsValue = {
  suggestions: Suggestion[];
  loading: boolean;
};

const PreviewSuggestionsContext = createContext<PreviewSuggestionsValue | undefined>(undefined);

/**
 * Loads preview idea chips once when the adventure form mounts (same timing as instanceId).
 */
export function PreviewSuggestionsProvider({
  instanceId,
  children,
}: {
  instanceId: string;
  children: React.ReactNode;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!instanceId) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setSuggestions([]);
    setLoading(true);
    void fetch(`/api/preview-suggestions/${encodeURIComponent(instanceId)}?count=8`)
      .then((res) => res.json())
      .then((data: { suggestions?: Suggestion[] }) => {
        if (cancelled) return;
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  const value = useMemo(() => ({ suggestions, loading }), [suggestions, loading]);

  return (
    <PreviewSuggestionsContext.Provider value={value}>{children}</PreviewSuggestionsContext.Provider>
  );
}

export function usePreviewSuggestions(): PreviewSuggestionsValue {
  const ctx = useContext(PreviewSuggestionsContext);
  return ctx ?? { suggestions: [], loading: false };
}
