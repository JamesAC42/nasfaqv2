"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { normalizeLeaderboardResponse } from "@/app/lib/normalizers";
import type {
  LeaderboardEntry,
  LeaderboardMe,
  LeaderboardPagination,
  LeaderboardResponse,
  LeaderboardScope,
  LeaderboardStats,
  LeaderboardWindow,
} from "@/app/lib/types";

type LeaderboardFetchParams = {
  page?: number;
  limit?: number;
  scope?: LeaderboardScope;
  window?: LeaderboardWindow;
};

type LeaderboardState = {
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  pagination: LeaderboardPagination;
  stats: LeaderboardStats;
  entries: LeaderboardEntry[];
  me: LeaderboardMe | null;
  isLoading: boolean;
  error: string | null;
  fetchLeaderboard: (params?: LeaderboardFetchParams) => Promise<void>;
};

export const useLeaderboardStore = create<LeaderboardState>((set) => ({
  scope: "global",
  window: "1d",
  pagination: {
    total: 0,
    page: 1,
    limit: 25,
    page_count: 1,
    has_previous_page: false,
    has_next_page: false,
  },
  stats: {
    user_count: 0,
    cutoff_equity_top_10: null,
    cutoff_equity_top_100: null,
    last_updated_at: null,
  },
  entries: [],
  me: null,
  isLoading: false,
  error: null,
  fetchLeaderboard: async (params = {}) => {
    set({ isLoading: true, error: null });
    try {
      const query = new URLSearchParams();
      const nextScope = params.scope || "global";
      const nextWindow = params.window || "1d";
      const nextPage = params.page || 1;
      const nextLimit = params.limit || 25;
      query.set("scope", nextScope);
      query.set("window", nextWindow);
      query.set("page", String(nextPage));
      query.set("limit", String(nextLimit));
      const result = await apiFetch<Record<string, unknown>>(`/api/leaderboard?${query.toString()}`);
      const normalized: LeaderboardResponse = normalizeLeaderboardResponse(result);
      set({
        scope: normalized.scope,
        window: normalized.window,
        pagination: normalized.pagination,
        stats: normalized.stats,
        entries: normalized.entries,
        me: normalized.me,
      });
    } catch (error) {
      set({
        entries: [],
        me: null,
        pagination: {
          total: 0,
          page: params.page || 1,
          limit: params.limit || 25,
          page_count: 1,
          has_previous_page: false,
          has_next_page: false,
        },
        stats: {
          user_count: 0,
          cutoff_equity_top_10: null,
          cutoff_equity_top_100: null,
          last_updated_at: null,
        },
        error: String((error as Error).message || error),
      });
    } finally {
      set({ isLoading: false });
    }
  },
}));
