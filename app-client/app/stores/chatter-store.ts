"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";

/** One talent on the /vt/ chatter index. `heat` is recent posts against their usual pace (null until there's a day of history). */
export type ChatterTalent = {
  symbol: string;
  posts_recent: number;
  posts_24h: number;
  usual_recent: number | null;
  heat: number | null;
  hourly: number[];
  topic: "stream" | "music" | "collab" | "hype" | "market" | null;
  /** The last day's posts about her by topic (Jev's reads; rumours and "not her" left out). */
  topics?: Record<string, number>;
  /** The leading topic when it's clear, complaints included. */
  mood?: string | null;
};

export type ChatterSummary = {
  generated_at: string;
  board: string;
  ready: boolean;
  recent_hours: number;
  talents: ChatterTalent[];
  /** Well above their usual pace (only once there's a day of history). */
  hot: string[];
  /** Most posts, full stop. */
  busiest: string[];
};

type ChatterState = {
  summary: ChatterSummary | null;
  loaded: boolean;
  fetchedAt: number | null;
  fetchChatter: () => Promise<void>;
};

const TTL_MS = 60_000;

export const useChatterStore = create<ChatterState>((set, get) => ({
  summary: null,
  loaded: false,
  fetchedAt: null,
  fetchChatter: async () => {
    const { fetchedAt } = get();
    if (fetchedAt && Date.now() - fetchedAt < TTL_MS) return;
    set({ fetchedAt: Date.now() });
    try {
      const summary = await apiFetch<ChatterSummary>("/api/overview/chatter");
      set({ summary: summary && Array.isArray(summary.talents) ? summary : null, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

export const CHATTER_TOPIC: Record<NonNullable<ChatterTalent["topic"]>, string> = {
  stream: "Streams",
  music: "Music",
  collab: "Collabs",
  hype: "Hype",
  market: "Her stock",
};

// What the posts are about, in plain words for a sentence. `passing` isn't listed: mentions in passing
// aren't a subject to name.
const THREAD_ABOUT: Record<string, string> = {
  stream: "mostly about streams",
  music: "mostly about music",
  collab: "mostly about collabs",
  hype: "mostly hype",
  market: "mostly about the stock",
  negative: "mostly complaints",
};

/**
 * "The thread is on it: 34 posts in the last day, mostly about streams." for a talent really running
 * hot (in `hot`, or at the same bar past its top 8), naming the subject only when it's clear. Null
 * otherwise, including before the summary is ready: nothing is claimed without data.
 */
export function threadLine(summary: ChatterSummary | null, symbol: string) {
  if (!summary?.ready) return null;
  const talent = summary.talents.find((entry) => entry.symbol === symbol);
  if (!talent) return null;
  if (!summary.hot.includes(symbol) && !(talent.posts_recent >= 5 && (talent.heat ?? 0) >= 1.5)) return null;
  const about = THREAD_ABOUT[talent.mood ?? ""] ?? THREAD_ABOUT[talent.topic ?? ""];
  return `The thread is on it: ${talent.posts_24h} posts in the last day${about ? `, ${about}` : ""}.`;
}

/** "3.1×" when there's history to compare against, else null. */
export function heatLabel(talent: ChatterTalent) {
  return talent.heat === null ? null : `${talent.heat >= 10 ? Math.round(talent.heat) : talent.heat.toFixed(1)}×`;
}
