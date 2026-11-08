"use client";

import { useSyncExternalStore } from "react";

// One shared 1-second ticker for every countdown on the page (instead of an
// interval per component). Returns null during SSR and hydration so clocks
// render a placeholder rather than a mismatched time.

let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  return now || null;
}

function getServerSnapshot() {
  return null;
}

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The time rounded down to `stepMs`, for values that only change at a boundary: it re-renders when
 * the step rolls over, not every second. Unlike useNow it has a value during SSR and hydration, so
 * keep it behind a session gate or in text marked suppressHydrationWarning.
 */
export function useNowEvery(stepMs: number): number {
  const read = () => Math.floor(Date.now() / stepMs) * stepMs;
  return useSyncExternalStore(subscribe, read, read);
}
