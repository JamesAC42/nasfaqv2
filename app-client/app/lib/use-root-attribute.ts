"use client";

import { useSyncExternalStore } from "react";

// Reads a data-* attribute on <html> reactively. Theme and calm mode live on
// <html> (stamped before first paint by the boot script in app/layout.tsx), so
// the DOM is the source of truth and React just subscribes to it.

function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-calm"] });
  return () => observer.disconnect();
}

export function useRootAttribute(name: "theme" | "calm", serverValue: string) {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset[name] ?? serverValue,
    () => serverValue,
  );
}
