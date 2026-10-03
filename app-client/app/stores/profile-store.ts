"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { fmtNumber } from "@/app/lib/format";
import { normalizePortfolio, normalizePortfolioOrdersResponse } from "@/app/lib/normalizers";
import { normalizeOrderAllowance, type OrderAllowance } from "@/app/lib/trade";
import type { PortfolioOrder, PortfolioSummary } from "@/app/lib/types";

type AdminBusy = false | "reset" | "rebuild";

type ProfileState = {
  portfolio: PortfolioSummary | null;
  pendingLiveOrders: PortfolioOrder[];
  /** Shares your orders can still ask for before the next tick (null signed out, or not loaded). */
  orderAllowance: OrderAllowance | null;
  /** The latest orders of any status (filled ones carry their fill), for the fill-moment fallback. */
  recentOrders: PortfolioOrder[];
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
  /** Follows a rebuild that's already running (started in another tab, or before a reload). True if there was one. */
  resumeRebuild: () => Promise<boolean>;
};

type RebuildJob = {
  id: string;
  status: "running" | "completed" | "failed";
  progress: { phase: string; done: number; total: number | null; market_date: string | null };
  result: null | {
    range: { from: string; to: string };
    fundamentals: { snapshots_processed: number | null; failed_snapshots: number | null };
    settlement: { settled_count: number; skipped_dates: Array<{ market_date: string; error: string }> };
    adjustments_applied: number;
  };
  error: string | null;
  started_at?: string | null;
};

/** Where a rebuild is, in words. Step 1 is one long database write with nothing to count; step 2 counts days. */
function describeRebuild(job: RebuildJob, now = Date.now()) {
  const started = job.started_at ? Date.parse(job.started_at) : Number.NaN;
  const elapsed = Number.isFinite(started) ? ` ${Math.max(0, Math.floor((now - started) / 60000))} min in.` : "";
  if (job.progress.phase === "settling" && job.progress.total) {
    return `Rebuilding, step 2 of 2: replaying day ${job.progress.done} of ~${job.progress.total}${job.progress.market_date ? ` (${job.progress.market_date})` : ""}.${elapsed}`;
  }
  return `Rebuilding, step 1 of 2: recalculating fundamentals${job.progress.total ? ` for ~${job.progress.total} days` : ""}. It shows no count until that's done.${elapsed}`;
}

/** Polls a running rebuild until it ends, keeping adminStatus current; then reports the result. */
async function followRebuild(set: (partial: Partial<ProfileState>) => void, started: RebuildJob) {
  let job = started;
  while (job.status === "running") {
    set({ adminStatus: describeRebuild(job) });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    job = (await apiFetch<{ job: RebuildJob | null }>(`/internal/market/rebuild-full?id=${encodeURIComponent(job.id)}`)).job ?? { ...job, status: "failed", error: "rebuild_lost (the API restarted)" };
  }
  if (job.status === "failed" || !job.result) throw new Error(`Rebuild failed: ${job.error ?? "unknown error"}`);
  const { range, fundamentals, settlement, adjustments_applied } = job.result;
  set({
    adminStatus:
      `Rebuild complete for ${range.from} to ${range.to}. ` +
      `Fundamentals: ${fundamentals.snapshots_processed ?? "?"} snapshots, failed ${fundamentals.failed_snapshots ?? 0}. ` +
      `Settled days: ${settlement.settled_count}, adjustments replayed: ${fmtNumber(adjustments_applied)}.` +
      (settlement.skipped_dates.length ? ` Skipped ${settlement.skipped_dates.length} day(s), first ${settlement.skipped_dates[0].market_date}: ${settlement.skipped_dates[0].error}.` : ""),
  });
}

// The allowance resets at the next tick: fetch it again just after, so it doesn't sit at zero.
let allowanceTimer: ReturnType<typeof setTimeout> | null = null;
function refreshAllowanceAt(resetsAt: string | null) {
  if (allowanceTimer) clearTimeout(allowanceTimer);
  allowanceTimer = null;
  const wait = resetsAt ? Date.parse(resetsAt) - Date.now() + 2000 : NaN;
  if (Number.isFinite(wait) && wait > 0 && wait < 8 * 3600_000) {
    allowanceTimer = setTimeout(() => void useProfileStore.getState().fetchPortfolioOrders(), wait);
  }
}

export const useProfileStore = create<ProfileState>((set) => ({
  portfolio: null,
  pendingLiveOrders: [],
  orderAllowance: null,
  recentOrders: [],
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
      const orders = normalizePortfolioOrdersResponse(result).orders;
      const orderAllowance = normalizeOrderAllowance(result.allowance);
      set({
        recentOrders: orders,
        pendingLiveOrders: orders.filter((order) => order.status === "pending" && order.order_type === "live_market"),
        orderAllowance,
      });
      refreshAllowanceAt(orderAllowance?.resetsAt ?? null);
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
  clearPendingLiveOrders: () => {
    refreshAllowanceAt(null);
    set({ pendingLiveOrders: [], orderAllowance: null });
  },
  clearPortfolio: () =>
    set({
      portfolio: null,
      pendingLiveOrders: [],
      orderAllowance: null,
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
    // The rebuild runs in the background on the API (it takes longer than a proxied request can
    // stay open): start it, then poll its progress.
    set({ adminBusy: "rebuild", adminError: null, adminStatus: "Starting rebuild…" });
    try {
      const { job } = await apiFetch<{ job: RebuildJob }>("/internal/market/rebuild-full", {
        method: "POST",
        body: JSON.stringify({
          active_only: true,
          fill_missing_dates: true,
          force: true,
          confirmation,
          version: 1,
        }),
      }).catch(async (error: Error & { status?: number; body?: { job?: RebuildJob } }) => {
        // Already running (another tab, or a page reload): follow that one.
        if (error.status === 409 && error.body?.job) return { job: error.body.job };
        throw error;
      });
      await followRebuild(set, job);
    } catch (error) {
      set({ adminStatus: null, adminError: String((error as Error).message || error) });
    } finally {
      set({ adminBusy: false });
    }
  },
  resumeRebuild: async () => {
    if (useProfileStore.getState().adminBusy !== false) return false;
    let job: RebuildJob | null = null;
    try {
      job = (await apiFetch<{ job: RebuildJob | null }>("/internal/market/rebuild-full", { cache: "no-store" })).job;
    } catch {
      return false;
    }
    if (job?.status !== "running" || useProfileStore.getState().adminBusy !== false) return false;
    set({ adminBusy: "rebuild", adminError: null, adminStatus: describeRebuild(job) });
    try {
      await followRebuild(set, job);
    } catch (error) {
      set({ adminStatus: null, adminError: String((error as Error).message || error) });
    } finally {
      set({ adminBusy: false });
    }
    return true;
  },
}));
