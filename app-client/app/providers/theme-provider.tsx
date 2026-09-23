"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRootAttribute } from "@/app/lib/use-root-attribute";

type Theme = "dark" | "light";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "nasfaq.theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

// <html data-theme> is the source of truth: the boot script in app/layout.tsx
// sets it before first paint (dark unless the player picked light).
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme: Theme = useRootAttribute("theme", "dark") === "light" ? "light" : "dark";

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage can be unavailable (private mode); the choice still applies for this visit
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
