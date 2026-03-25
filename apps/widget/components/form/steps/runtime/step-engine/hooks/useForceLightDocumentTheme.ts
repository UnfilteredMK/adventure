import { useEffect } from "react";

export function useForceLightDocumentTheme() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.remove("dark");
    try {
      window.localStorage.setItem("sif_theme", "light");
    } catch {}
  }, []);
}
