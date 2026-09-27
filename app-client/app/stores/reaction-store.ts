"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import type { ChibiPose } from "@/app/lib/art-manifest";

/** A talent whose reactions the player unlocked by owning one of her cards. */
export type UnlockedReaction = {
  symbol: string;
  display_name: string;
  icon: string | null;
  color: string | null;
  cards: number;
  poses: ChibiPose[];
};

type ReactionStore = {
  unlocked: UnlockedReaction[] | null;
  loading: boolean;
  error: string | null;
  /** Loads once per session; `force` re-reads (after a card pull, say). */
  load: (force?: boolean) => Promise<void>;
  reset: () => void;
};

export const useReactionStore = create<ReactionStore>((set, get) => ({
  unlocked: null,
  loading: false,
  error: null,
  load: async (force = false) => {
    if (get().loading || (get().unlocked && !force)) return;
    set({ loading: true, error: null });
    try {
      const raw = await apiFetch<{ reactions?: Array<Record<string, unknown>> }>("/api/profiles/me/reactions", { cache: "no-store" });
      const unlocked = (raw.reactions ?? []).map((row) => ({
        symbol: String(row.symbol ?? ""),
        display_name: String(row.display_name ?? row.symbol ?? ""),
        icon: row.icon ? String(row.icon) : null,
        color: row.color ? String(row.color) : null,
        cards: Number(row.cards ?? 0),
        poses: (Array.isArray(row.poses) ? row.poses : []).map(String) as ChibiPose[],
      }));
      set({ unlocked: unlocked.filter((row) => row.symbol) });
    } catch (error) {
      set({ error: String((error as Error).message || error), unlocked: get().unlocked ?? [] });
    } finally {
      set({ loading: false });
    }
  },
  reset: () => set({ unlocked: null, loading: false, error: null }),
}));
