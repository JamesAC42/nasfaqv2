import { create } from "zustand";
import type { TradeSide } from "@/app/lib/trade";

// The trade drawer is global: any ticker on any page can open it.
type TradeStore = {
  symbol: string | null;
  side: TradeSide;
  /** Live orders submitted this session, so their fills can be celebrated. */
  pendingOrderIds: Array<string | number>;
  openTrade: (symbol: string, side?: TradeSide) => void;
  closeTrade: () => void;
  trackOrder: (id: string | number) => void;
  untrackOrder: (id: string | number) => void;
};

export const useTradeStore = create<TradeStore>((set) => ({
  symbol: null,
  side: "buy",
  pendingOrderIds: [],
  openTrade: (symbol, side = "buy") => set({ symbol: symbol.toUpperCase(), side }),
  closeTrade: () => set({ symbol: null }),
  trackOrder: (id) => set((state) => ({ pendingOrderIds: [...state.pendingOrderIds, id] })),
  untrackOrder: (id) => set((state) => ({ pendingOrderIds: state.pendingOrderIds.filter((item) => String(item) !== String(id)) })),
}));
