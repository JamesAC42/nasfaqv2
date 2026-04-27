"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import {
  normalizePredictionCandlesResponse,
  normalizePredictionMarketDetailResponse,
  normalizePredictionMarketEventResponse,
  normalizePredictionMarketListResponse,
  normalizePredictionOpenOrdersResponse,
  normalizePredictionOrderBookResponse,
  normalizePredictionPositionsResponse,
  normalizePredictionTradeResponse,
} from "@/app/lib/normalizers";
import type {
  PredictionCandlePoint,
  PredictionMarket,
  PredictionMarketEvent,
  PredictionMarketPagination,
  PredictionMarketScope,
  PredictionOpenOrder,
  PredictionOrderBook,
  PredictionPosition,
  PredictionTrade,
} from "@/app/lib/types";
import { getPredictionMarketWsUrl } from "@/app/lib/ws";

export type PredictionMarketDetailBundle = {
  market: PredictionMarket;
  orderbook: PredictionOrderBook;
  trades: PredictionTrade[];
  yesCandles: PredictionCandlePoint[];
  noCandles: PredictionCandlePoint[];
  openOrders: PredictionOpenOrder[];
  positions: PredictionPosition[];
  events: PredictionMarketEvent[];
};

type PredictionListFilters = {
  scope: PredictionMarketScope;
  status: string;
  query: string;
  page: number;
  limit: number;
};

type PredictionMarketState = {
  markets: PredictionMarket[];
  pagination: PredictionMarketPagination | null;
  detailBySlug: Record<string, PredictionMarketDetailBundle>;
  selectedSlug: string;
  filters: PredictionListFilters;
  isLoadingList: boolean;
  isLoadingDetail: boolean;
  error: string | null;
  wsConnected: boolean;
  setFilters: (filters: Partial<PredictionListFilters>) => void;
  setSelectedSlug: (slug: string) => void;
  fetchMarkets: () => Promise<void>;
  fetchMarketDetail: (slug: string, includePrivate?: boolean) => Promise<void>;
  connectRealtime: () => () => void;
};

let wsRef: WebSocket | null = null;

export const usePredictionMarketStore = create<PredictionMarketState>((set, get) => ({
  markets: [],
  pagination: null,
  detailBySlug: {},
  selectedSlug: "",
  filters: {
    scope: "public",
    status: "all",
    query: "",
    page: 1,
    limit: 40,
  },
  isLoadingList: false,
  isLoadingDetail: false,
  error: null,
  wsConnected: false,
  setFilters: (filters) => set((state) => ({
    filters: {
      ...state.filters,
      ...filters,
      page: filters.page ?? (filters.status || filters.scope || filters.query !== undefined ? 1 : state.filters.page),
    },
  })),
  setSelectedSlug: (slug) => set({ selectedSlug: slug }),
  fetchMarkets: async () => {
    const filters = get().filters;
    set({ isLoadingList: true, error: null });
    try {
      const params = new URLSearchParams();
      params.set("scope", filters.scope);
      params.set("limit", String(filters.limit));
      params.set("page", String(filters.page));
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.query.trim()) params.set("q", filters.query.trim());
      const result = await apiFetch<Record<string, unknown>>(`/api/prediction-markets?${params.toString()}`, { cache: "no-store" });
      const normalized = normalizePredictionMarketListResponse(result);
      set((state) => ({
        markets: normalized.items,
        pagination: normalized.pagination,
        selectedSlug: state.selectedSlug || normalized.items[0]?.slug || "",
      }));
    } catch (error) {
      set({ markets: [], pagination: null, error: String((error as Error).message || error) });
    } finally {
      set({ isLoadingList: false });
    }
  },
  fetchMarketDetail: async (slug, includePrivate = true) => {
    if (!slug) return;
    set({ isLoadingDetail: true, error: null });
    try {
      const requests: Array<Promise<Record<string, unknown>>> = [
        apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}`, { cache: "no-store" }),
        apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/orderbook`, { cache: "no-store" }),
        apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/trades?limit=24`, { cache: "no-store" }),
        apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/candles?interval=1h&outcome=yes&limit=120`, { cache: "no-store" }),
        apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/candles?interval=1h&outcome=no&limit=120`, { cache: "no-store" }),
        apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/events?limit=50`, { cache: "no-store" }),
      ];

      if (includePrivate) {
        requests.push(apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/orders/mine`, { cache: "no-store" }));
        requests.push(apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/positions/mine`, { cache: "no-store" }));
      }

      const results = await Promise.allSettled(requests);
      const required = results.slice(0, 6);
      const failedRequired = required.find((result) => result.status === "rejected");
      if (failedRequired?.status === "rejected") throw failedRequired.reason;

      const values = results.map((result) => result.status === "fulfilled" ? result.value : null);
      const bundle: PredictionMarketDetailBundle = {
        market: normalizePredictionMarketDetailResponse(values[0] || {}).market,
        orderbook: normalizePredictionOrderBookResponse(values[1] || {}).orderbook,
        trades: normalizePredictionTradeResponse(values[2] || {}).trades,
        yesCandles: normalizePredictionCandlesResponse(values[3] || {}).candles,
        noCandles: normalizePredictionCandlesResponse(values[4] || {}).candles,
        events: normalizePredictionMarketEventResponse(values[5] || {}).events,
        openOrders: values[6] ? normalizePredictionOpenOrdersResponse(values[6]).orders : [],
        positions: values[7] ? normalizePredictionPositionsResponse(values[7]).positions : [],
      };

      set((state) => ({
        selectedSlug: slug,
        detailBySlug: {
          ...state.detailBySlug,
          [slug]: bundle,
        },
      }));
    } catch (error) {
      set({ error: String((error as Error).message || error) });
    } finally {
      set({ isLoadingDetail: false });
    }
  },
  connectRealtime: () => {
    if (wsRef || typeof window === "undefined") return () => {};
    const url = getPredictionMarketWsUrl();
    if (!url) return () => {};

    const ws = new WebSocket(url);
    wsRef = ws;
    ws.addEventListener("open", () => set({ wsConnected: true }));
    ws.addEventListener("close", () => {
      if (wsRef === ws) wsRef = null;
      set({ wsConnected: false });
    });
    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data || "{}"));
        const slug = String(payload.slug || "");
        const market = payload.market && typeof payload.market === "object"
          ? normalizePredictionMarketDetailResponse({ market: payload.market }).market
          : null;
        if (market) {
          set((state) => ({
            markets: state.markets.map((item) => item.id === market.id ? market : item),
            detailBySlug: state.detailBySlug[market.slug]
              ? {
                  ...state.detailBySlug,
                  [market.slug]: {
                    ...state.detailBySlug[market.slug],
                    market,
                  },
                }
              : state.detailBySlug,
          }));
        }
        const activeSlug = slug || market?.slug || get().selectedSlug;
        if (activeSlug && activeSlug === get().selectedSlug) {
          void get().fetchMarketDetail(activeSlug);
        } else {
          void get().fetchMarkets();
        }
      } catch {}
    });

    return () => {
      if (wsRef === ws) wsRef = null;
      ws.close();
    };
  },
}));
