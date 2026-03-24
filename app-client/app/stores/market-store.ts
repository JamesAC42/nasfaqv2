"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import {
  normalizeAsset,
  normalizeCandles,
  normalizeMarketIndex,
  normalizeStats,
  normalizeTrades,
  normalizeTreasury,
} from "@/app/lib/normalizers";
import type { AssetDetailBundle, DailyReport, MarketAsset, MarketIndexBundle } from "@/app/lib/types";

type MarketState = {
  assets: MarketAsset[];
  report: DailyReport | null;
  selectedSymbol: string;
  selectedUnit: string;
  detail: AssetDetailBundle | null;
  marketIndexes: MarketIndexBundle[];
  isLoadingOverview: boolean;
  isLoadingDetail: boolean;
  isLoadingIndex: boolean;
  error: string | null;
  setSelectedSymbol: (symbol: string) => void;
  setSelectedUnit: (unit: string) => void;
  refreshOverview: () => Promise<void>;
  fetchMarketIndexes: () => Promise<void>;
  fetchAssetDetail: (symbol: string) => Promise<void>;
  clearDetail: () => void;
};

export const useMarketStore = create<MarketState>((set, get) => ({
  assets: [],
  report: null,
  selectedSymbol: "",
  selectedUnit: "all",
  detail: null,
  marketIndexes: [],
  isLoadingOverview: true,
  isLoadingDetail: false,
  isLoadingIndex: false,
  error: null,
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setSelectedUnit: (unit) => set({ selectedUnit: unit }),
  refreshOverview: async () => {
    set({ isLoadingOverview: true, error: null });
    try {
      const [assetsResult, reportResult] = await Promise.all([
        apiFetch<Record<string, unknown>[]>("/api/market/assets"),
        apiFetch<DailyReport>("/api/market/report/daily/latest"),
      ]);

      const assets = assetsResult.map(normalizeAsset);
      const nextSymbol = get().selectedSymbol || assets[0]?.symbol || "";

      set({
        assets,
        report: reportResult,
        selectedSymbol: assets.some((asset) => asset.symbol === nextSymbol) ? nextSymbol : assets[0]?.symbol || "",
      });
    } catch (error) {
      set({ error: String((error as Error).message || error) });
    } finally {
      set({ isLoadingOverview: false });
    }
  },
  fetchMarketIndexes: async () => {
    set({ isLoadingIndex: true, error: null });
    try {
      const result = await apiFetch<Record<string, unknown>[]>(
        "/api/market/indexes/overview?group_by=unit&range=1y&weighting=equal"
      );
      set({ marketIndexes: result.map(normalizeMarketIndex) });
    } catch (error) {
      set({
        marketIndexes: [],
        error: String((error as Error).message || error),
      });
    } finally {
      set({ isLoadingIndex: false });
    }
  },
  fetchAssetDetail: async (symbol) => {
    if (!symbol) {
      set({ detail: null });
      return;
    }

    set({ isLoadingDetail: true, error: null });
    try {
      const [stats, candles, trades, treasury] = await Promise.all([
        apiFetch<{ stats: Array<Record<string, unknown>> }>(`/api/market/assets/${symbol}/stats?range=1y`),
        Promise.all([
          apiFetch<{ candles: Array<Record<string, unknown>> }>(`/api/market/assets/${symbol}/candles?interval=1d&range=1y`),
          apiFetch<{ candles: Array<Record<string, unknown>> }>(`/api/market/assets/${symbol}/candles?interval=1h&range=24h`),
        ]),
        apiFetch<{ trades: Array<Record<string, unknown>> }>(`/api/market/assets/${symbol}/trades?limit=10`),
        apiFetch<Record<string, unknown>>(`/api/market/assets/${symbol}/treasury`),
      ]);

      set({
        detail: {
          stats: normalizeStats(stats.stats),
          daily_candles: normalizeCandles(candles[0].candles),
          intraday_candles: normalizeCandles(candles[1].candles),
          trades: normalizeTrades(trades.trades),
          treasury: normalizeTreasury(treasury),
        },
      });
    } catch (error) {
      set({
        detail: null,
        error: String((error as Error).message || error),
      });
    } finally {
      set({ isLoadingDetail: false });
    }
  },
  clearDetail: () => set({ detail: null }),
}));
