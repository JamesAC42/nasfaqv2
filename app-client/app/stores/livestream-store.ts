"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { normalizeLivestreams } from "@/app/lib/normalizers";
import type { LivestreamItem } from "@/app/lib/types";

type LivestreamState = {
  items: LivestreamItem[];
  isLoading: boolean;
  error: string | null;
  fetchLivestreams: () => Promise<void>;
};

export const useLivestreamStore = create<LivestreamState>((set) => ({
  items: [],
  isLoading: false,
  error: null,
  fetchLivestreams: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await apiFetch<{ live?: Array<Record<string, unknown>> }>("/api/livestreams");
      set({ items: normalizeLivestreams(result.live || []) });
    } catch (error) {
      set({ items: [], error: String((error as Error).message || error) });
    } finally {
      set({ isLoading: false });
    }
  },
}));
