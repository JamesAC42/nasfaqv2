"use client";

import { useCallback, useSyncExternalStore } from "react";

// A boolean remembered in localStorage (e.g. "dismissed the newbie strip").
// Server render and hydration see `fallback`, then the stored value applies.

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useLocalFlag(key: string, fallback = false): [boolean, (value: boolean) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = raw === null ? fallback : raw === "1";
  const setValue = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // storage unavailable: keep it for this render cycle only
      }
      listeners.forEach((notify) => notify());
    },
    [key],
  );
  return [value, setValue];
}
