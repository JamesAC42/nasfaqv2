"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { fmtNumber } from "@/app/lib/format";
import { normalizePortfolio } from "@/app/lib/normalizers";
import type { PortfolioSummary } from "@/app/lib/types";

type AdminBusy = false | "reset" | "rebuild";

type ProfileState = {
  portfolio: PortfolioSummary | null;
  isLoadingPortfolio: boolean;
  portfolioError: string | null;
  adminBusy: AdminBusy;
  adminStatus: string | null;
  adminError: string | null;
  fetchPortfolio: () => Promise<void>;
  clearPortfolio: () => void;
  resetMarket: () => Promise<void>;
  rebuildMarket: () => Promise<void>;
};

export const useProfileStore = create<ProfileState>((set) => ({
  portfolio: null,
  isLoadingPortfolio: false,
  portfolioError: null,
  adminBusy: false,
  adminStatus: null,
  adminError: null,
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
  clearPortfolio: () =>
    set({
      portfolio: null,
      portfolioError: null,
    }),
  resetMarket: async () => {
    set({ adminBusy: "reset", adminError: null, adminStatus: null });
    try {
      const result = await apiFetch<{ starter_cash: number }>("/internal/market/reset", {
        method: "POST",
        body: "{}",
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
  rebuildMarket: async () => {
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
