"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import {
  normalizeAsset,
  normalizeCandles,
  normalizeMarketIndex,
  normalizeMarketHubTrade,
  normalizeMarketStatus,
  normalizeStats,
  normalizeTrades,
  normalizeTreasury,
} from "@/app/lib/normalizers";
import { getMarketWsUrl } from "@/app/lib/ws";
import { useAuthStore } from "@/app/stores/auth-store";
import { useProfileStore } from "@/app/stores/profile-store";
import type { AssetDetailBundle, DailyReport, MarketAsset, MarketHubTrade, MarketIndexBundle, MarketStatus, TradeRow } from "@/app/lib/types";

const detailCache = new Map<string, AssetDetailBundle>();
let activeDetailRequestId = 0;
let wsRef: WebSocket | null = null;
let reconnectTimer: number | null = null;
let indexRefreshTimer: number | null = null;
let overviewRefreshTimer: number | null = null;
let tradingStateRefreshTimer: number | null = null;
let reconnectAttempt = 0;
let realtimeDisposed = false;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tradeToDetailRow(trade: MarketHubTrade): TradeRow {
  return {
    id: trade.id,
    ts: trade.ts,
    side: trade.side,
    price: trade.price,
    quantity: trade.quantity,
    gross_cash: trade.gross_cash,
  };
}

function mergeDetailTrades(current: TradeRow[], trade: MarketHubTrade) {
  const next = [tradeToDetailRow(trade), ...current.filter((item) => item.id !== trade.id)];
  return next.slice(0, Math.max(10, current.length || 10));
}

function patchAssetFromTrade(asset: MarketAsset, payload: Record<string, unknown>) {
  const quote = (payload.quote && typeof payload.quote === "object" ? payload.quote : {}) as Record<string, unknown>;
  const trade = (payload.trade && typeof payload.trade === "object" ? payload.trade : {}) as Record<string, unknown>;
  const symbol = String(quote.symbol || trade.symbol || "").toUpperCase();
  if (!symbol || asset.symbol.toUpperCase() !== symbol) return asset;
  const nextMidPrice = toNumber(quote.mid_price) ?? asset.current_mid_price;
  const todayOpenPrice = asset.previous_settlement_mid_price;

  return {
    ...asset,
    current_mid_price: nextMidPrice,
    market_price: nextMidPrice ?? asset.market_price,
    current_bid_price: toNumber(quote.bid_price) ?? asset.current_bid_price,
    current_ask_price: toNumber(quote.ask_price) ?? asset.current_ask_price,
    current_premium_pct: null,
    premium_discount_pct: null,
    volume_24h: (asset.volume_24h ?? 0) + (toNumber(trade.quantity) ?? 0),
    move_24h_pct: nextMidPrice !== null && todayOpenPrice !== null && todayOpenPrice !== 0
      ? (nextMidPrice - todayOpenPrice) / todayOpenPrice
      : asset.move_24h_pct,
  };
}

function patchAssetFromQuote(asset: MarketAsset, quote: Record<string, unknown>) {
  const symbol = String(quote.symbol || "").toUpperCase();
  if (!symbol || asset.symbol.toUpperCase() !== symbol) return asset;
  const nextMidPrice = toNumber(quote.mid_price) ?? asset.current_mid_price;
  const todayOpenPrice = asset.previous_settlement_mid_price;

  return {
    ...asset,
    current_mid_price: nextMidPrice,
    market_price: nextMidPrice ?? asset.market_price,
    current_bid_price: toNumber(quote.bid_price) ?? asset.current_bid_price,
    current_ask_price: toNumber(quote.ask_price) ?? asset.current_ask_price,
    current_premium_pct: null,
    premium_discount_pct: null,
    move_24h_pct: nextMidPrice !== null && todayOpenPrice !== null && todayOpenPrice !== 0
      ? (nextMidPrice - todayOpenPrice) / todayOpenPrice
      : asset.move_24h_pct,
  };
}

function patchAssetFromSettlement(asset: MarketAsset, incoming: MarketAsset) {
  if (asset.symbol.toUpperCase() !== incoming.symbol.toUpperCase()) return asset;
  return {
    ...asset,
    current_fair_value: null,
    base_rate: null,
    current_mid_price: incoming.current_mid_price,
    market_price: incoming.market_price ?? incoming.current_mid_price,
    previous_settlement_mid_price: incoming.previous_settlement_mid_price,
    pre_settlement_mid_price: incoming.pre_settlement_mid_price,
    current_bid_price: incoming.current_bid_price,
    current_ask_price: incoming.current_ask_price,
    current_premium_pct: null,
    premium_discount_pct: null,
    current_daily_emission: incoming.current_daily_emission,
    treasury_supply: incoming.treasury_supply,
    circulating_supply: incoming.circulating_supply,
    latest_snapshot_date: incoming.latest_snapshot_date,
    volume_24h: incoming.volume_24h ?? asset.volume_24h,
    move_24h_pct: incoming.move_24h_pct ?? asset.move_24h_pct,
  };
}

function patchStatusFromTrade(current: MarketStatus | null, statusPayload: Record<string, unknown>): MarketStatus {
  return {
    trading_status: current?.trading_status || (statusPayload.is_trading_open ? "open" : "settling"),
    is_trading_open: Boolean(statusPayload.is_trading_open),
    active_phase: current?.active_phase || "idle",
    trading_message: current?.trading_message || null,
    current_market_date: statusPayload.current_market_date ? String(statusPayload.current_market_date) : current?.current_market_date || null,
    current_cycle_started_at: current?.current_cycle_started_at || null,
    current_cycle_updated_at: current?.current_cycle_updated_at || null,
    last_settlement_market_date: statusPayload.last_settlement_market_date ? String(statusPayload.last_settlement_market_date) : current?.last_settlement_market_date || null,
    last_settlement_completed_at: current?.last_settlement_completed_at || null,
    next_scheduled_settlement_at: current?.next_scheduled_settlement_at || null,
    last_cycle_error: current?.last_cycle_error || null,
    updated_at: current?.updated_at || null,
  };
}

function scheduleIndexRefresh(fetchMarketIndexes: () => Promise<void>, hasIndexes: boolean) {
  if (!hasIndexes || typeof window === "undefined" || indexRefreshTimer !== null) return;
  indexRefreshTimer = window.setTimeout(() => {
    indexRefreshTimer = null;
    void fetchMarketIndexes();
  }, 750);
}

function scheduleOverviewRefresh(refreshOverview: () => Promise<void>) {
  if (typeof window === "undefined" || overviewRefreshTimer !== null) return;
  overviewRefreshTimer = window.setTimeout(() => {
    overviewRefreshTimer = null;
    void refreshOverview();
  }, 700);
}

function eventUserId(payload: Record<string, unknown>) {
  const trade = payload.trade && typeof payload.trade === "object" ? payload.trade as Record<string, unknown> : null;
  const order = payload.order && typeof payload.order === "object" ? payload.order as Record<string, unknown> : null;
  const parsed = Number(trade?.user_id ?? order?.user_id ?? payload.user_id);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function scheduleTradingStateRefresh(payload: Record<string, unknown>) {
  const userId = useAuthStore.getState().user?.id || null;
  if (!userId || eventUserId(payload) !== userId || typeof window === "undefined" || tradingStateRefreshTimer !== null) return;

  tradingStateRefreshTimer = window.setTimeout(() => {
    tradingStateRefreshTimer = null;
    void useProfileStore.getState().refreshTradingState();
  }, 400);
}

type MarketState = {
  assets: MarketAsset[];
  report: DailyReport | null;
  marketStatus: MarketStatus | null;
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
  connectRealtime: () => () => void;
  clearDetail: () => void;
};

export const useMarketStore = create<MarketState>((set, get) => ({
  assets: [],
  report: null,
  marketStatus: null,
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
      const [assetsResult, reportResult, statusResult] = await Promise.allSettled([
        apiFetch<Record<string, unknown>[]>("/api/market/assets"),
        apiFetch<DailyReport>("/api/market/report/daily/latest"),
        apiFetch<Record<string, unknown>>("/api/market/status"),
      ]);

      if (assetsResult.status !== "fulfilled") {
        throw assetsResult.reason;
      }
      if (statusResult.status !== "fulfilled") {
        throw statusResult.reason;
      }

      const assets = assetsResult.value.map(normalizeAsset);
      const nextSymbol = get().selectedSymbol || assets[0]?.symbol || "";

      set({
        assets,
        report: reportResult.status === "fulfilled" ? reportResult.value : null,
        marketStatus: normalizeMarketStatus(statusResult.value),
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
      activeDetailRequestId += 1;
      set({ detail: null, isLoadingDetail: false });
      return;
    }

    const cacheKey = symbol.trim().toUpperCase();
    const cachedDetail = detailCache.get(cacheKey) || null;

    if (cachedDetail) {
      set({ detail: cachedDetail, isLoadingDetail: false, error: null });
      return;
    }

    const requestId = ++activeDetailRequestId;
    set({ detail: null, isLoadingDetail: true, error: null });
    try {
      const [stats, candles, trades, treasury] = await Promise.all([
        apiFetch<{ stats: Array<Record<string, unknown>> }>(`/api/market/assets/${cacheKey}/stats?range=1y`),
        Promise.all([
          apiFetch<{ candles: Array<Record<string, unknown>> }>(`/api/market/assets/${cacheKey}/candles?interval=1d&range=1y`),
          apiFetch<{ candles: Array<Record<string, unknown>> }>(`/api/market/assets/${cacheKey}/candles?interval=1h&range=24h`),
        ]),
        apiFetch<{ trades: Array<Record<string, unknown>> }>(`/api/market/assets/${cacheKey}/trades?limit=10`),
        apiFetch<Record<string, unknown>>(`/api/market/assets/${cacheKey}/treasury`),
      ]);

      const nextDetail = {
        stats: normalizeStats(stats.stats),
        daily_candles: normalizeCandles(candles[0].candles),
        intraday_candles: normalizeCandles(candles[1].candles),
        trades: normalizeTrades(trades.trades),
        treasury: normalizeTreasury(treasury),
      };

      detailCache.set(cacheKey, nextDetail);
      if (requestId !== activeDetailRequestId) return;

      set({ detail: nextDetail });
    } catch (error) {
      if (requestId !== activeDetailRequestId) return;
      set({
        detail: null,
        error: String((error as Error).message || error),
      });
    } finally {
      if (requestId === activeDetailRequestId) {
        set({ isLoadingDetail: false });
      }
    }
  },
  connectRealtime: () => {
    if (typeof window === "undefined") return () => {};
    if (wsRef) return () => {};

    const wsUrl = getMarketWsUrl();
    if (!wsUrl) return () => {};
    realtimeDisposed = false;

    const connect = () => {
      if (realtimeDisposed || wsRef) return;
      wsRef = new WebSocket(wsUrl);

      wsRef.onopen = () => {
        reconnectAttempt = 0;
      };

      wsRef.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || "{}")) as Record<string, unknown>;

          if (payload.type === "market.trade_fill") {
            const trade = normalizeMarketHubTrade((payload.trade || {}) as Record<string, unknown>);
            const cacheKey = trade.symbol.trim().toUpperCase();
            if (cacheKey) detailCache.delete(cacheKey);

            set((state) => {
              const detailMatches = state.detail && state.selectedSymbol.trim().toUpperCase() === cacheKey;
              const statusPayload = payload.market_status && typeof payload.market_status === "object"
                ? payload.market_status as Record<string, unknown>
                : null;
              return {
                assets: state.assets.map((asset) => patchAssetFromTrade(asset, payload)),
                marketStatus: statusPayload ? patchStatusFromTrade(state.marketStatus, statusPayload) : state.marketStatus,
                detail: detailMatches
                  ? {
                      ...state.detail!,
                      trades: mergeDetailTrades(state.detail!.trades, trade),
                    }
                  : state.detail,
              };
            });
            scheduleIndexRefresh(get().fetchMarketIndexes, get().marketIndexes.length > 0);
            scheduleOverviewRefresh(get().refreshOverview);
            scheduleTradingStateRefresh(payload);
            return;
          }

          if (payload.type === "market.snapshot") {
            const assets = Array.isArray(payload.assets)
              ? (payload.assets as Array<Record<string, unknown>>).map(normalizeAsset)
              : [];
            const status = payload.status && typeof payload.status === "object"
              ? normalizeMarketStatus(payload.status as Record<string, unknown>)
              : null;

            if (assets.length || status) {
              set((state) => {
                const nextSymbol = state.selectedSymbol || assets[0]?.symbol || "";
                return {
                  assets: assets.length ? assets : state.assets,
                  marketStatus: status || state.marketStatus,
                  selectedSymbol: assets.length && !assets.some((asset) => asset.symbol === nextSymbol)
                    ? assets[0]?.symbol || ""
                    : nextSymbol,
                };
              });
            }
            scheduleIndexRefresh(get().fetchMarketIndexes, get().marketIndexes.length > 0);
            return;
          }

          if (payload.type === "market.status_update") {
            const status = payload.status && typeof payload.status === "object"
              ? normalizeMarketStatus(payload.status as Record<string, unknown>)
              : null;
            if (status) set({ marketStatus: status });
            return;
          }

          if (payload.type === "market.adjustments_applied") {
            const quotes = Array.isArray(payload.quotes)
              ? payload.quotes as Array<Record<string, unknown>>
              : [];
            const changedSymbols = new Set(quotes.map((quote) => String(quote.symbol || "").toUpperCase()).filter(Boolean));
            changedSymbols.forEach((symbol) => detailCache.delete(symbol));

            set((state) => ({
              assets: state.assets.map((asset) => {
                const quote = quotes.find((item) => String(item.symbol || "").toUpperCase() === asset.symbol.toUpperCase());
                return quote ? patchAssetFromQuote(asset, quote) : asset;
              }),
              detail: changedSymbols.has(state.selectedSymbol.trim().toUpperCase()) ? null : state.detail,
            }));

            const selectedSymbol = get().selectedSymbol.trim().toUpperCase();
            if (selectedSymbol && changedSymbols.has(selectedSymbol)) {
              void get().fetchAssetDetail(selectedSymbol);
            }
            scheduleIndexRefresh(get().fetchMarketIndexes, get().marketIndexes.length > 0);
            return;
          }

          if (payload.type === "market.live_order_queued" || payload.type === "market.live_order_rejected") {
            scheduleOverviewRefresh(get().refreshOverview);
            scheduleTradingStateRefresh(payload);
            return;
          }

          if (payload.type === "market.settlement_completed") {
            const incomingAssets = Array.isArray(payload.assets)
              ? (payload.assets as Array<Record<string, unknown>>).map(normalizeAsset)
              : [];
            const bySymbol = new Map(incomingAssets.map((asset) => [asset.symbol.toUpperCase(), asset]));
            incomingAssets.forEach((asset) => detailCache.delete(asset.symbol.toUpperCase()));

            set((state) => {
              const selectedIncoming = bySymbol.get(state.selectedSymbol.trim().toUpperCase()) || null;
              return {
                assets: state.assets.map((asset) => {
                  const incoming = bySymbol.get(asset.symbol.toUpperCase());
                  return incoming ? patchAssetFromSettlement(asset, incoming) : asset;
                }),
                report: payload.report && typeof payload.report === "object" ? payload.report as DailyReport : state.report,
                detail: selectedIncoming ? null : state.detail,
              };
            });

            void get().fetchMarketIndexes();
            const selectedSymbol = get().selectedSymbol.trim().toUpperCase();
            if (selectedSymbol && bySymbol.has(selectedSymbol)) {
              void get().fetchAssetDetail(selectedSymbol);
            }
          }
        } catch {
          // Ignore malformed websocket payloads; the next HTTP refresh will reconcile.
        }
      };

      wsRef.onclose = () => {
        wsRef = null;
        if (realtimeDisposed) return;
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, Math.min(15_000, 1_000 * reconnectAttempt));
      };

      wsRef.onerror = () => {
        try {
          wsRef?.close();
        } catch {}
      };
    };

    connect();

    return () => {
      realtimeDisposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (indexRefreshTimer !== null) {
        window.clearTimeout(indexRefreshTimer);
        indexRefreshTimer = null;
      }
      if (tradingStateRefreshTimer !== null) {
        window.clearTimeout(tradingStateRefreshTimer);
        tradingStateRefreshTimer = null;
      }
      try {
        wsRef?.close();
      } catch {}
      wsRef = null;
    };
  },
  clearDetail: () => {
    activeDetailRequestId += 1;
    set({ detail: null, isLoadingDetail: false });
  },
}));
