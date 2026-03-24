"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { normalizeNews } from "@/app/lib/normalizers";
import type { NewsItem } from "@/app/lib/types";

type NewsState = {
  items: NewsItem[];
  isLoading: boolean;
  error: string | null;
  fetchNews: () => Promise<void>;
};

export const useNewsStore = create<NewsState>((set) => ({
  items: [],
  isLoading: false,
  error: null,
  fetchNews: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await apiFetch<Record<string, unknown>[]>("/api/news");
      set({ items: normalizeNews(result) });
    } catch (error) {
      set({ items: [], error: String((error as Error).message || error) });
    } finally {
      set({ isLoading: false });
    }
  },
}));
