"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { normalizeChannels } from "@/app/lib/normalizers";
import type { ChannelOverviewRow } from "@/app/lib/types";

type ChannelState = {
  channels: ChannelOverviewRow[];
  isLoading: boolean;
  error: string | null;
  fetchChannels: () => Promise<void>;
};

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  isLoading: true,
  error: null,
  fetchChannels: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await apiFetch<Record<string, unknown>[]>("/api/overview/latest");
      set({ channels: normalizeChannels(result) });
    } catch (error) {
      set({ error: String((error as Error).message || error), channels: [] });
    } finally {
      set({ isLoading: false });
    }
  },
}));
