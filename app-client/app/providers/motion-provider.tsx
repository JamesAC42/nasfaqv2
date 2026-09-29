"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRootAttribute } from "@/app/lib/use-root-attribute";

// "Calm mode": turns off price flashes, the scrolling tape and the big tick/fill
// animations. On by default when the OS asks for reduced motion; players can
// flip it from the top bar. The boot script in app/layout.tsx applies the saved
// value to <html data-calm> before first paint, and globals.scss does the rest.

type MotionContextValue = {
  calm: boolean;
  setCalm: (calm: boolean) => void;
  toggleCalm: () => void;
};

const STORAGE_KEY = "nasfaq.calm";

const MotionContext = createContext<MotionContextValue | null>(null);

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const calm = useRootAttribute("calm", "false") === "true";

  const setCalm = useCallback((next: boolean) => {
    document.documentElement.dataset.calm = next ? "true" : "false";
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // storage unavailable; applies for this visit only
    }
  }, []);

  const value = useMemo<MotionContextValue>(
    () => ({ calm, setCalm, toggleCalm: () => setCalm(!calm) }),
    [calm, setCalm],
  );

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion() {
  const context = useContext(MotionContext);
  if (!context) throw new Error("useMotion must be used within MotionProvider");
  return context;
}

/** Imperative check for non-React code paths (canvas animations, timers). */
export function isCalm() {
  return typeof document !== "undefined" && document.documentElement.dataset.calm === "true";
}
