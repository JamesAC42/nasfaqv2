"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { fmtNumber } from "@/app/lib/format";
import { normalizePortfolio, normalizePortfolioOrdersResponse } from "@/app/lib/normalizers";
import type { PortfolioOrder, PortfolioSummary } from "@/app/lib/types";

type AdminBusy = false | "reset" | "rebuild";

type ProfileState = {
  portfolio: PortfolioSummary | null;
  pendingLiveOrders: PortfolioOrder[];
  isLoadingPortfolio: boolean;
  isLoadingOrders: boolean;
  portfolioError: string | null;
  tradingRevision: number;
  adminBusy: AdminBusy;
  adminStatus: string | null;
  adminError: string | null;
  fetchPortfolio: () => Promise<void>;
  fetchPortfolioOrders: () => Promise<void>;
  refreshTradingState: () => Promise<void>;
  clearPendingLiveOrders: () => void;
  clearPortfolio: () => void;
  resetMarket: (confirmation: "reset") => Promise<void>;
  rebuildMarket: (confirmation: "rebuild") => Promise<void>;
};

export const useProfileStore = create<ProfileState>((set) => ({
  portfolio: null,
  pendingLiveOrders: [],
  isLoadingPortfolio: false,
  isLoadingOrders: false,
  portfolioError: null,
  adminBusy: false,
  adminStatus: null,
  adminError: null,
  tradingRevision: 0,
  fetchPortfolio: async () => {
    set({ isLoadingPortfolio: true, portfolioError: null });
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/portfolio/me");
      set({ portfolio: normalizePortfolio(result) });
    } catch (error) {
      set({
        portfolio: null,
        portfolioError: String((error as Error).message || error),
      });
    } finally {
      set({ isLoadingPortfolio: false });
    }
  },
  fetchPortfolioOrders: async () => {
    set({ isLoadingOrders: true, portfolioError: null });
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/portfolio/me/orders?limit=50", { cache: "no-store" });
      set({
        pendingLiveOrders: normalizePortfolioOrdersResponse(result).orders.filter(
          (order) => order.status === "pending" && order.order_type === "live_market"
        ),
      });
    } catch (error) {
      set({
        pendingLiveOrders: [],
        portfolioError: String((error as Error).message || error),
      });
    } finally {
      set({ isLoadingOrders: false });
    }
  },
  refreshTradingState: async () => {
    const state = useProfileStore.getState();
    await Promise.allSettled([state.fetchPortfolio(), state.fetchPortfolioOrders()]);
    set((current) => ({ tradingRevision: current.tradingRevision + 1 }));
  },
  clearPendingLiveOrders: () => set({ pendingLiveOrders: [] }),
  clearPortfolio: () =>
    set({
      portfolio: null,
      pendingLiveOrders: [],
      portfolioError: null,
    }),
  resetMarket: async (confirmation) => {
    set({ adminBusy: "reset", adminError: null, adminStatus: null });
    try {
      const result = await apiFetch<{ starter_cash: number }>("/internal/market/reset", {
        method: "POST",
        body: JSON.stringify({ confirmation }),
      });
      set({
        portfolio: null,
        adminStatus: `Market reset complete. All users now have starter cash ${fmtNumber(result.starter_cash)}.`,
      });
    } catch (error) {
      set({ adminError: String((error as Error).message || error) });
    } finally {
      set({ adminBusy: false });
    }
  },
  rebuildMarket: async (confirmation) => {
    set({ adminBusy: "rebuild", adminError: null, adminStatus: null });
    try {
      const result = await apiFetch<{
        range: { from: string; to: string };
        fundamentals: { snapshots_processed: number; failed_snapshots: number };
        settlement: { settled_count: number };
      }>("/internal/market/rebuild-full", {
        method: "POST",
        body: JSON.stringify({
          active_only: true,
          fill_missing_dates: true,
          force: true,
          confirmation,
          version: 1,
        }),
      });
      set({
        adminStatus:
          `Rebuild complete for ${result.range.from} to ${result.range.to}. ` +
          `Fundamentals: ${result.fundamentals.snapshots_processed} snapshots, failed ${result.fundamentals.failed_snapshots}. ` +
          `Settled days: ${result.settlement.settled_count}.`,
      });
    } catch (error) {
      set({ adminError: String((error as Error).message || error) });
    } finally {
      set({ adminBusy: false });
    }
  },
}));
