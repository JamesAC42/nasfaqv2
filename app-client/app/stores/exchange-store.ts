"use client";

import { create } from "zustand";
import { fetchDesk, fetchPriceBook, type Desk, type PriceBook } from "@/app/lib/games/exchange";

// Shared exchange state: the price book (card values for meters and binder worth) and your desk
// counts (incoming offers badge). Pages refresh these after actions and on live alerts.

type ExchangeStore = {
  prices: PriceBook | null;
  desk: Desk | null;
  loadPrices: (force?: boolean) => Promise<PriceBook | null>;
  loadDesk: () => Promise<Desk | null>;
  reset: () => void;
};

let pricesAt = 0;

export const useExchangeStore = create<ExchangeStore>((set, get) => ({
  prices: null,
  desk: null,
  loadPrices: async (force = false) => {
    if (!force && get().prices && Date.now() - pricesAt < 60_000) return get().prices;
    try {
      const prices = await fetchPriceBook();
      pricesAt = Date.now();
      set({ prices });
      return prices;
    } catch {
      return get().prices;
    }
  },
  loadDesk: async () => {
    try {
      const desk = await fetchDesk();
      set({ desk });
      return desk;
    } catch {
      return get().desk;
    }
  },
  reset: () => set({ prices: null, desk: null }),
}));
