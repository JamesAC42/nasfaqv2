"use client";

import { create } from "zustand";
import { fetchCollection } from "@/app/lib/games/api";
import type { CollectionResponse, Pity } from "@/app/lib/games/types";

// The player's card collection, shards and pity, shared by the gacha, binder, locker and the
// duel deck picker. Pages call loadCollection() on mount; actions patch it in place and then
// reload quietly so it never drifts from the server.

type GamesStore = {
  collection: CollectionResponse | null;
  loading: boolean;
  error: string | null;
  loadCollection: (options?: { quiet?: boolean }) => Promise<CollectionResponse | null>;
  setShards: (shards: number) => void;
  setPity: (pool: "standard" | "featured" | "capsule", pity: Pity) => void;
  clear: () => void;
};

let inflight: Promise<CollectionResponse | null> | null = null;

export const useGamesStore = create<GamesStore>((set, get) => ({
  collection: null,
  loading: false,
  error: null,
  loadCollection: async ({ quiet = false } = {}) => {
    if (inflight) return inflight;
    if (!quiet) set({ loading: !get().collection, error: null });
    inflight = fetchCollection()
      .then((collection) => {
        set({ collection, loading: false, error: null });
        return collection;
      })
      .catch((error) => {
        set({ loading: false, error: String((error as Error).message || error) });
        return null;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },
  setShards: (shards) => set((state) => (state.collection ? { collection: { ...state.collection, shards } } : state)),
  setPity: (pool, pity) =>
    set((state) => (state.collection ? { collection: { ...state.collection, pity: { ...state.collection.pity, [pool]: pity } } } : state)),
  clear: () => set({ collection: null, loading: false, error: null }),
}));
