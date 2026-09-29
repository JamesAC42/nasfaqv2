"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { saveShowcase } from "@/app/lib/games/api";
import { gameErrorText } from "@/app/lib/games/errors";
import type { ShowcaseSlot } from "@/app/lib/games/types";
import { useGamesStore } from "@/app/stores/games-store";

export const SHOWCASE_SLOTS = 5;

const keysOf = (slots: ShowcaseSlot[] | undefined) =>
  [...(slots ?? [])].sort((a, b) => a.slot - b.slot).map((slot) => slot.card_key);

/**
 * The showcase as an ordered list of card keys. Every change saves straight away (the latest
 * wins if several land while a save is in flight), so there is no "unsaved" state to lose.
 */
export function useShowcase(saved: ShowcaseSlot[] | undefined) {
  // Local keys once the player edits; until then, follow the server.
  const [local, setLocal] = useState<string[] | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const pending = useRef<string[] | null>(null);
  const savedKey = keysOf(saved).join("|");
  const keys = useMemo(() => local ?? (savedKey ? savedKey.split("|") : []), [local, savedKey]);

  const flush = useCallback(async () => {
    if (inflight.current) return;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      inflight.current = true;
      setStatus("saving");
      try {
        await saveShowcase(next);
        if (!pending.current) {
          setStatus("saved");
          setError(null);
        }
      } catch (err) {
        setStatus("error");
        setError(gameErrorText(err));
        // Snap back to what the server has.
        if (!pending.current) setLocal(null);
      } finally {
        inflight.current = false;
      }
    }
    void useGamesStore.getState().loadCollection({ quiet: true });
  }, []);

  const commit = useCallback(
    (next: string[]) => {
      setLocal(next);
      pending.current = next;
      void flush();
    },
    [flush]
  );

  const pin = useCallback(
    (key: string, slot?: number) => {
      if (keys.includes(key)) return;
      const next = [...keys];
      if (slot !== undefined && slot < next.length) next[slot] = key;
      else if (next.length < SHOWCASE_SLOTS) next.push(key);
      else return;
      commit(next);
    },
    [commit, keys]
  );

  const unpin = useCallback((key: string) => commit(keys.filter((entry) => entry !== key)), [commit, keys]);

  const move = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= keys.length) return;
      const next = [...keys];
      [next[index], next[target]] = [next[target], next[index]];
      commit(next);
    },
    [commit, keys]
  );

  return { keys, pin, unpin, move, status, error, full: keys.length >= SHOWCASE_SLOTS };
}

export type ShowcaseControls = ReturnType<typeof useShowcase>;
