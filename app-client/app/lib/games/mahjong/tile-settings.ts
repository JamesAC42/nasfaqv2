"use client";

import { useCallback, useSyncExternalStore } from "react";

// Whether tiles carry their small corner labels (1-9, E S W N, Wh G R). On by default; a player's
// choice is kept in localStorage and shared by every tile on the page.

const KEY = "nasfaq.mahjong.tile-labels";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setTileLabels(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: the choice lasts until reload through the listeners below.
    override = on;
  }
  listeners.forEach((notify) => notify());
}

let override: boolean | null = null;
const snapshot = () => (override !== null ? override : read());
const subscribe = (notify: () => void) => {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
};

/** [labels on, set it]. Server render and first paint say "on". */
export function useTileLabels(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, snapshot, () => true);
  const set = useCallback((next: boolean) => setTileLabels(next), []);
  return [on, set];
}
