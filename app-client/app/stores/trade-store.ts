import { create } from "zustand";
import type { TradeSide } from "@/app/lib/trade";

// The trade drawer is global: any ticker on any page can open it.
type TradeStore = {
  symbol: string | null;
  side: TradeSide;
  /**
   * The page the drawer was opened on. Each page mounts its own shell (and drawer), so without this
   * an open drawer would reappear on the next page, the back button's in particular.
   */
  openedOn: string | null;
  /** Live orders submitted this session, so their fills can be celebrated. */
  pendingOrderIds: Array<string | number>;
  openTrade: (symbol: string, side?: TradeSide) => void;
  closeTrade: () => void;
  setOpenedOn: (pathname: string) => void;
  trackOrder: (id: string | number) => void;
  untrackOrder: (id: string | number) => void;
};

export const useTradeStore = create<TradeStore>((set) => ({
  symbol: null,
  side: "buy",
  openedOn: null,
  pendingOrderIds: [],
  openTrade: (symbol, side = "buy") => set({ symbol: symbol.toUpperCase(), side, openedOn: null }),
  closeTrade: () => set({ symbol: null, openedOn: null }),
  setOpenedOn: (pathname) => set({ openedOn: pathname }),
  trackOrder: (id) => set((state) => ({ pendingOrderIds: [...state.pendingOrderIds, id] })),
  untrackOrder: (id) => set((state) => ({ pendingOrderIds: state.pendingOrderIds.filter((item) => String(item) !== String(id)) })),
}));
