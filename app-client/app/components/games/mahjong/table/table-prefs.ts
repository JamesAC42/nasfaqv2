"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-browser table settings, kept in localStorage and shared by everything on the page. A blocked
// store only means the choice lasts until the page reloads.

const listeners = new Set<() => void>();
const overrides = new Map<string, boolean>();

function read(key: string, fallback: boolean): boolean {
  if (overrides.has(key)) return overrides.get(key) as boolean;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean) {
  overrides.set(key, value);
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* kept in memory */
  }
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
};

function useFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback((next: boolean) => write(key, next), [key]);
  return [value, set];
}

/** Beginner help: on by default. */
export const useHelpOn = () => useFlag("nasfaq.mahjong.help", true);
/** One tap discards (instead of lift, then tap again). Off by default. */
export const useSingleTap = () => useFlag("nasfaq.mahjong.single-tap", false);
/** Floating reactions and the bar that sends them. */
export const useReactionsOn = () => useFlag("nasfaq.mahjong.reactions", true);
