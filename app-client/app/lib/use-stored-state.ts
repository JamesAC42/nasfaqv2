"use client";

import { useCallback, useSyncExternalStore } from "react";

// State remembered in the browser as JSON: localStorage (kept until changed) or sessionStorage (this
// tab only). Like useLocalFlag, the server render and hydration see `fallback` and the stored value
// applies right after, so there's no hydration mismatch. If storage is blocked (private windows,
// cleared site data) the value lives in memory for the visit instead.

export type StorageArea = "local" | "session";

const listeners = new Set<() => void>();
const memory = new Map<string, string>(); // area:key → JSON, for when storage can't be written
const decoded = new Map<string, { raw: string; value: unknown }>(); // so an unchanged value keeps its identity

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// Another tab changed it: forget any in-memory copy and re-read.
function onStorage(event: StorageEvent) {
  if (event.key) {
    memory.delete(`local:${event.key}`);
    memory.delete(`session:${event.key}`);
  }
  listeners.forEach((notify) => notify());
}

function area(kind: StorageArea): Storage | null {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(kind: StorageArea, key: string): string | null {
  const id = `${kind}:${key}`;
  if (memory.has(id)) return memory.get(id) ?? null;
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function decode<T>(id: string, raw: string | null, fallback: T, parse?: (value: unknown) => T | null): T {
  if (raw === null) return fallback;
  const hit = decoded.get(id);
  if (hit && hit.raw === raw) return hit.value as T;
  let value = fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    value = (parse ? parse(parsed) : (parsed as T)) ?? fallback;
  } catch {
    // not JSON (an old or hand-edited value): use the fallback
  }
  decoded.set(id, { raw, value });
  return value;
}

/** The stored value right now, outside render (e.g. in an effect that runs before hydration settles). */
export function peekStored<T>(key: string, fallback: T, { storage = "local", parse }: { storage?: StorageArea; parse?: (value: unknown) => T | null } = {}): T {
  return decode(`${storage}:${key}`, readRaw(storage, key), fallback, parse);
}

/**
 * `useState` that survives a refresh and coming back to the page. `parse` checks what's stored (it
 * may be from an older version) and returns null to use `fallback`. Pass a stable `fallback` and
 * `parse` (module constants): a value that hasn't changed keeps its identity between renders.
 */
export function useStoredState<T>(
  key: string,
  fallback: T,
  { storage = "local", parse }: { storage?: StorageArea; parse?: (value: unknown) => T | null } = {},
): [T, (next: T | ((current: T) => T)) => void] {
  const id = `${storage}:${key}`;
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storage, key),
    () => null,
  );
  const value = decode(id, raw, fallback, parse);
  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = decode(id, readRaw(storage, key), fallback, parse);
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      const json = JSON.stringify(resolved);
      try {
        area(storage)?.setItem(key, json);
        memory.delete(id);
      } catch {
        memory.set(id, json);
      }
      if (!area(storage)) memory.set(id, json);
      listeners.forEach((notify) => notify());
    },
    [fallback, id, key, parse, storage],
  );
  return [value, setValue];
}
