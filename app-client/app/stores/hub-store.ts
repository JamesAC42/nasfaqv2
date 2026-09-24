"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import {
  normalizeMarketAdjustmentSummary,
  normalizeMarketHubResponse,
  normalizeMarketHubTrade,
  normalizeMarketLiveOrderFlow,
  normalizeMarketLiveOrderSummary,
} from "@/app/lib/normalizers";
import type {
  MarketAdjustmentSummary,
  MarketHubResponse,
  MarketHubTrade,
  MarketLiveOrderFlow,
  MarketLiveOrderSummary,
} from "@/app/lib/types";
import { onMarketEvent } from "@/app/stores/market-store";

// Live market hub state for the Market tabs and the floor: recent fills, the live-order
// queue, activity windows and tick outcomes. HTTP loads it, websocket events keep it fresh,
// and a slow poll reconciles anything the socket missed.

const TRADE_PAGE = 100;
const RECONCILE_MS = 60_000;

type OrderFlash = { symbol: string; side: "buy" | "sell"; at: number };

type HubState = {
  hub: MarketHubResponse | null;
  trades: MarketHubTrade[];
  nextCursor: string | null;
  liveOrders: MarketLiveOrderSummary | null;
  adjustments: MarketAdjustmentSummary | null;
  lastFlash: OrderFlash | null;
  error: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadHub: () => Promise<void>;
  loadMoreTrades: () => Promise<void>;
  loadLiveOrders: () => Promise<void>;
  loadAdjustments: () => Promise<void>;
};

export const useHubStore = create<HubState>((set, get) => ({
  hub: null,
  trades: [],
  nextCursor: null,
  liveOrders: null,
  adjustments: null,
  lastFlash: null,
  error: null,
  isLoading: true,
  isLoadingMore: false,

  loadHub: async () => {
    try {
      const result = await apiFetch<Record<string, unknown>>(`/api/market/hub?trade_limit=${TRADE_PAGE}`, { cache: "no-store" });
      const hub = normalizeMarketHubResponse(result);
      set((state) => {
        // Keep any older pages we already loaded behind the fresh first page.
        const fresh = hub.recent_trades.items;
        const freshIds = new Set(fresh.map((trade) => trade.id));
        const oldest = fresh.at(-1)?.ts ?? "";
        const older = state.trades.filter((trade) => !freshIds.has(trade.id) && trade.ts < oldest);
        return {
          hub,
          trades: [...fresh, ...older],
          nextCursor: older.length ? state.nextCursor : hub.recent_trades.next_cursor,
          liveOrders: hub.activity.live_orders,
          error: null,
          isLoading: false,
        };
      });
    } catch (error) {
      set({ error: String((error as Error).message || error), isLoading: false });
    }
  },

  loadMoreTrades: async () => {
    const cursor = get().nextCursor;
    if (!cursor || get().isLoadingMore) return;
    set({ isLoadingMore: true });
    try {
      const result = await apiFetch<{ items?: Array<Record<string, unknown>>; next_cursor?: string | null }>(
        `/api/market/trades?limit=${TRADE_PAGE}&cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store" },
      );
      const items = (result.items ?? []).map(normalizeMarketHubTrade);
      set((state) => {
        const ids = new Set(state.trades.map((trade) => trade.id));
        return {
          trades: [...state.trades, ...items.filter((trade) => !ids.has(trade.id))],
          nextCursor: result.next_cursor ? String(result.next_cursor) : null,
        };
      });
    } catch {
      // Leave the cursor so the player can retry.
    } finally {
      set({ isLoadingMore: false });
    }
  },

  loadLiveOrders: async () => {
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/market/live-orders/summary?limit=200", { cache: "no-store" });
      set({ liveOrders: normalizeMarketLiveOrderSummary(result) });
    } catch {}
  },

  loadAdjustments: async () => {
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/market/adjustments/summary?recent_limit=500", { cache: "no-store" });
      set({ adjustments: normalizeMarketAdjustmentSummary(result) });
    } catch {}
  },
}));

export async function fetchLiveOrderFlow(symbol: string | null): Promise<MarketLiveOrderFlow | null> {
  try {
    const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
    const result = await apiFetch<Record<string, unknown>>(`/api/market/live-orders/flow${query}`, { cache: "no-store" });
    return normalizeMarketLiveOrderFlow(result);
  } catch {
    return null;
  }
}

let subscribers = 0;
let stopRealtime: (() => void) | null = null;
let reconcileTimer: number | null = null;
let liveOrderTimer: number | null = null;

function start() {
  const store = useHubStore.getState();
  void store.loadHub();
  void store.loadAdjustments();
  reconcileTimer = window.setInterval(() => {
    void useHubStore.getState().loadHub();
    void useHubStore.getState().loadAdjustments();
  }, RECONCILE_MS);

  const refreshLiveOrders = () => {
    if (liveOrderTimer !== null) return;
    liveOrderTimer = window.setTimeout(() => {
      liveOrderTimer = null;
      void useHubStore.getState().loadLiveOrders();
    }, 400);
  };

  stopRealtime = onMarketEvent((payload) => {
    const type = String(payload.type || "");
    if (type === "market.trade_fill" && payload.trade && typeof payload.trade === "object") {
      const trade = normalizeMarketHubTrade(payload.trade as Record<string, unknown>);
      useHubStore.setState((state) => (state.trades.some((item) => item.id === trade.id) ? state : { trades: [trade, ...state.trades] }));
      refreshLiveOrders();
      return;
    }
    if (type === "market.live_order_queued" || type === "market.live_order_rejected" || type === "market.live_order_cancelled") {
      const order = payload.order && typeof payload.order === "object" ? (payload.order as Record<string, unknown>) : null;
      const side = String(order?.side || "").toLowerCase();
      const symbol = String(order?.symbol || "").toUpperCase();
      if (type === "market.live_order_queued" && symbol && (side === "buy" || side === "sell")) {
        useHubStore.setState({ lastFlash: { symbol, side, at: Date.now() } });
      }
      refreshLiveOrders();
      return;
    }
    if (type === "market.adjustments_applied") {
      void useHubStore.getState().loadAdjustments();
      return;
    }
    if (type === "market.settlement_completed") {
      void useHubStore.getState().loadHub();
    }
  });
}

function stop() {
  stopRealtime?.();
  stopRealtime = null;
  if (reconcileTimer !== null) window.clearInterval(reconcileTimer);
  reconcileTimer = null;
  if (liveOrderTimer !== null) window.clearTimeout(liveOrderTimer);
  liveOrderTimer = null;
}

/** Subscribe a view to the live hub. Loads once, stays live while any view is mounted. */
export function useMarketHub() {
  useEffect(() => {
    subscribers += 1;
    if (subscribers === 1) start();
    return () => {
      subscribers -= 1;
      if (subscribers === 0) stop();
    };
  }, []);
}
