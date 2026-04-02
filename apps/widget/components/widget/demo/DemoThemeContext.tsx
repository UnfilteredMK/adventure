"use client";

import { createContext, useContext, useState, useMemo, ReactNode } from "react";

type DemoThemeContextValue = {
  themeKey: string | null;
  setThemeKey: (key: string | null) => void;
};

const DemoThemeContext = createContext<DemoThemeContextValue | undefined>(undefined);

/** Stable fallback when no provider — must not be a new function each render or hooks that list setThemeKey in deps re-run forever. */
const noopSetThemeKey: DemoThemeContextValue["setThemeKey"] = () => {};

export function DemoThemeProvider({ children, initialThemeKey }: { children: ReactNode; initialThemeKey?: string | null; }) {
  const [themeKey, setThemeKey] = useState<string | null>(initialThemeKey || null);
  const value = useMemo(() => ({ themeKey, setThemeKey }), [themeKey, setThemeKey]);
  return <DemoThemeContext.Provider value={value}>{children}</DemoThemeContext.Provider>;
}

export function useDemoTheme() {
  const ctx = useContext(DemoThemeContext);
  if (!ctx) {
    return { themeKey: null, setThemeKey: noopSetThemeKey };
  }
  return ctx;
}


