"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { normalizeLeaderboard } from "@/app/lib/normalizers";
import type { LeaderboardEntry } from "@/app/lib/types";

type LeaderboardState = {
  entries: LeaderboardEntry[];
  isLoading: boolean;
  error: string | null;
  fetchLeaderboard: () => Promise<void>;
};

export const useLeaderboardStore = create<LeaderboardState>((set) => ({
  entries: [],
  isLoading: false,
  error: null,
  fetchLeaderboard: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await apiFetch<Record<string, unknown>[]>("/api/leaderboard");
      set({ entries: normalizeLeaderboard(result) });
    } catch (error) {
      set({ entries: [], error: String((error as Error).message || error) });
    } finally {
      set({ isLoading: false });
    }
  },
}));
