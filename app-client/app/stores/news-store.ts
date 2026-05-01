"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { normalizeHoloNewsFeed } from "@/app/lib/normalizers";
import type { NewsItem } from "@/app/lib/types";

type NewsState = {
  items: NewsItem[];
  isLoading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  fetchNews: () => Promise<void>;
};

const NEWS_CACHE_TTL_MS = 60_000;

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
      const result = await apiFetch<Record<string, unknown>>("/api/overview/holonews");
      set({ items: normalizeHoloNewsFeed(result), lastFetchedAt: Date.now() });
    } catch (error) {
      set({ items: [], error: String((error as Error).message || error) });
    } finally {
      set({ isLoading: false });
    }
  },
}));
