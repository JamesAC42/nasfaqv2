"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/app/lib/api";

/** A player's place on the net worth leaderboard; rank 0 when they aren't on it. */
export type Worth = { rank: number; total_equity: number };

type Entries = { entries: Array<Record<string, unknown>> };

const fetchWorth = (ids: number[]) => apiFetch<Entries>(`/api/leaderboard/net-worth?user_ids=${ids.join(",")}`);

function merge(current: Record<number, Worth>, raw: Entries) {
  const next = { ...current };
  for (const entry of raw.entries || []) {
    const id = Number(entry.user_id || 0);
    if (id) next[id] = { rank: Number(entry.rank || 0), total_equity: Number(entry.total_equity || 0) };
  }
  return next;
}

/**
 * Net worth ranks for the players in `ids`, for the rank badge next to their names. Asks only for
 * players it hasn't asked about yet (anyone the board leaves out comes back as rank 0, and the badge
 * hides), and refreshes the ones it has every few minutes, since ranks move all day.
 */
export function useNetWorth(ids: readonly (number | null | undefined)[]) {
  const [worth, setWorth] = useState<Record<number, Worth>>({});
  const key = [...new Set(ids.filter((id): id is number => typeof id === "number" && id > 0))].join(",");
  const wanted = useMemo(() => (key ? key.split(",").map(Number) : []), [key]);

  useEffect(() => {
    const missing = wanted.filter((id) => !worth[id]);
    if (!missing.length) return;
    let cancelled = false;
    fetchWorth(missing)
      .then((raw) => {
        if (cancelled) return;
        setWorth((current) => {
          const next = merge(current, raw);
          for (const id of missing) if (!next[id]) next[id] = { rank: 0, total_equity: 0 };
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wanted, worth]);

  const known = useRef<number[]>([]);
  useEffect(() => {
    known.current = Object.keys(worth).map(Number);
  }, [worth]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const ids = known.current.slice(-200);
      if (!ids.length) return;
      fetchWorth(ids)
        .then((raw) => setWorth((current) => merge(current, raw)))
        .catch(() => undefined);
    }, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return worth;
}
