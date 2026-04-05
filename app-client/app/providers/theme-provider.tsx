"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "dark" | "light";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "nasfaq.theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "dark";

  const storedTheme = window.localStorage.getItem(STORAGE_KEY);
  if (storedTheme === "dark" || storedTheme === "light") return storedTheme;

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(getPreferredTheme());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <div data-theme={theme}>{children}</div>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
