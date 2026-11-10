"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// How far a player got in the walkthrough: which exercises they have answered, and which lesson they
// were on. Kept in localStorage (every access in try/catch: private windows and blocked storage
// throw), with a copy in memory so the page still works for the rest of the visit.

const KEY = "nasfaq.mahjong.walkthrough";
type Saved = { done: string[]; at: number };

const listeners = new Set<() => void>();
let memory: string | null = null;

function read(): string {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function write(value: Saved) {
  const text = JSON.stringify(value);
  memory = text;
  try {
    window.localStorage.setItem(KEY, text);
  } catch {
    // Storage is blocked: the copy in memory carries the visit.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      memory = null;
      notify();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", onStorage);
  };
}

function parse(text: string): Saved {
  try {
    const value = JSON.parse(text) as Partial<Saved>;
    return { done: Array.isArray(value.done) ? value.done.filter((id): id is string => typeof id === "string") : [], at: Number.isInteger(value.at) ? Number(value.at) : 0 };
  } catch {
    return { done: [], at: 0 };
  }
}

export function useWalkthroughProgress() {
  const text = useSyncExternalStore(subscribe, read, () => "");
  const saved = useMemo(() => parse(text), [text]);
  const done = useMemo(() => new Set(saved.done), [saved]);
  const markDone = useCallback((id: string) => {
    const now = parse(read());
    if (!now.done.includes(id)) write({ ...now, done: [...now.done, id] });
  }, []);
  const setAt = useCallback((at: number) => write({ ...parse(read()), at }), []);
  const reset = useCallback(() => write({ done: [], at: 0 }), []);
  return { done, at: saved.at, markDone, setAt, reset };
}
