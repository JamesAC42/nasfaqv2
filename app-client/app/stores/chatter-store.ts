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

/** "3.1×" when there's history to compare against, else null. */
export function heatLabel(talent: ChatterTalent) {
  return talent.heat === null ? null : `${talent.heat >= 10 ? Math.round(talent.heat) : talent.heat.toFixed(1)}×`;
}
