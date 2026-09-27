"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { normalizeHoloNewsFeed, normalizeNewsFeedResponse } from "@/app/lib/normalizers";
import type { NewsItem, WireItem } from "@/app/lib/types";

type NewsState = {
  items: NewsItem[];
  isLoading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  fetchNews: () => Promise<void>;
  wire: WireItem[];
  wireLoaded: boolean;
  wireFetchedAt: number | null;
  fetchWire: () => Promise<void>;
};

const NEWS_CACHE_TTL_MS = 60_000;
/** The front page wants this many stories; the /news/ rollup alone rarely has them. */
const FRONT_STORIES = 6;

function storyKey(item: NewsItem) {
  return item.article_slug || item.id;
}

/** The /news/ rollup plus the newest published articles, newest first, so the page is never empty or stale. */
function mergeStories(rollup: NewsItem[], latest: NewsItem[]) {
  const seen = new Set(rollup.map(storyKey));
  const time = (item: NewsItem) => (item.published_at ? Date.parse(item.published_at) || 0 : 0);
  return [...rollup, ...latest.filter((item) => !seen.has(storyKey(item)))].sort((a, b) => time(b) - time(a)).slice(0, Math.max(FRONT_STORIES, rollup.length));
}

function normalizeWire(value: unknown): WireItem[] {
  const rows = value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items) ? ((value as { items: unknown[] }).items as Record<string, unknown>[]) : [];
  return rows
    .filter((row) => row && row.headline && row.occurred_at)
    .map((row) => ({
      id: Number(row.id),
      kind: String(row.kind || ""),
      headline: String(row.headline),
      blurb: row.blurb ? String(row.blurb) : null,
      symbols: Array.isArray(row.symbols) ? row.symbols.map(String) : [],
      image_url: row.image_url ? String(row.image_url) : null,
      link_url: row.link_url ? String(row.link_url) : null,
      importance: Number(row.importance || 1),
      occurred_at: String(row.occurred_at),
      meta: row.meta && typeof row.meta === "object" ? (row.meta as WireItem["meta"]) : {},
    }));
}

export const useNewsStore = create<NewsState>((set, get) => ({
  items: [],
  isLoading: false,
  error: null,
  lastFetchedAt: null,
  fetchNews: async () => {
    const state = get();
    if (state.isLoading) return;
    if (state.items.length && state.lastFetchedAt && Date.now() - state.lastFetchedAt < NEWS_CACHE_TTL_MS) return;

    set({ isLoading: true, error: null });
    try {
      const [rollup, latest] = await Promise.all([
        apiFetch<Record<string, unknown>>("/api/overview/holonews")
          .then(normalizeHoloNewsFeed)
          .catch(() => [] as NewsItem[]),
        apiFetch<Record<string, unknown>>(`/api/news?sort=newest&limit=${FRONT_STORIES + 2}`)
          .then((result) => normalizeNewsFeedResponse(result).items)
          .catch(() => [] as NewsItem[]),
      ]);
      set({ items: mergeStories(rollup, latest), lastFetchedAt: Date.now() });
    } catch (error) {
      set({ items: [], error: String((error as Error).message || error) });
    } finally {
      set({ isLoading: false });
    }
  },
  wire: [],
  wireLoaded: false,
  wireFetchedAt: null,
  fetchWire: async () => {
    const state = get();
    if (state.wireFetchedAt && Date.now() - state.wireFetchedAt < NEWS_CACHE_TTL_MS) return;
    set({ wireFetchedAt: Date.now() });
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/overview/wire?limit=24");
      set({ wire: normalizeWire(result), wireLoaded: true });
    } catch {
      set({ wireLoaded: true });
    }
  },
}));
