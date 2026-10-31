"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { findSeason, type SeasonId } from "@/app/lib/seasons";
import { useRootAttribute } from "@/app/lib/use-root-attribute";

type Theme = "dark" | "light";

/** What the player picked: dark, light, or the seasonal theme on offer (app/lib/seasons.ts). */
export type ThemeChoice = Theme | SeasonId;

type ThemeContextValue = {
  /** The light/dark palette in use; a seasonal theme reports the one it's built on. */
  theme: Theme;
  choice: ThemeChoice;
  /** Dark, the seasonal theme while one is on offer, then light: the order the switch cycles in. */
  choices: ThemeChoice[];
  /** Where toggleTheme goes from here. */
  next: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "nasfaq.theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

// <html> is the source of truth: the boot script in app/layout.tsx sets data-theme (dark unless
// the player picked light) and, for a seasonal pick, data-season before first paint.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme: Theme = useRootAttribute("theme", "dark") === "light" ? "light" : "dark";
  const season = findSeason(useRootAttribute("season", ""));
  const seasonNow = findSeason(useRootAttribute("seasonNow", ""));
  const choice: ThemeChoice = season?.id ?? theme;

  const setChoice = useCallback((next: ThemeChoice) => {
    const root = document.documentElement;
    const picked = findSeason(next);
    if (picked) {
      root.dataset.season = picked.id;
      root.dataset.theme = picked.base;
    } else {
      delete root.dataset.season;
      root.dataset.theme = next;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage can be unavailable (private mode); the choice still applies for this visit
    }
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const choices: ThemeChoice[] = seasonNow ? ["dark", seasonNow.id, "light"] : ["dark", "light"];
    const next = choices[(choices.indexOf(choice) + 1) % choices.length];
    return { theme, choice, choices, next, setChoice, toggleTheme: () => setChoice(next) };
  }, [choice, seasonNow, setChoice, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
