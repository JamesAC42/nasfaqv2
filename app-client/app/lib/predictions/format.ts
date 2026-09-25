import type { Outcome, PredictionMarket } from "@/app/lib/predictions/types";
import { talentAccent } from "@/app/lib/talent-color";

// Formatting and colours for predictions. Prices are probabilities; we show them as cents (62¢)
// on tickets and as percent (62%) for the market's call. Green/red stay reserved for moves
// (a price going up or down); outcomes get their own colours.

export const cents = (price: number | null | undefined) => {
  if (price === null || price === undefined || Number.isNaN(price)) return "—";
  const value = price * 100;
  if (value > 0 && value < 1) return "<1¢";
  if (value > 99 && value < 100) return ">99¢";
  return `${Math.round(value)}¢`;
};

export const percent = (price: number | null | undefined) => {
  if (price === null || price === undefined || Number.isNaN(price)) return "—";
  const value = price * 100;
  if (value > 0 && value < 1) return "<1%";
  if (value > 99 && value < 100) return ">99%";
  return `${Math.round(value)}%`;
};

/** Signed change in cents: "+4¢", "−2¢", "±0¢". */
export const centsDelta = (delta: number) => {
  const value = Math.round(delta * 100);
  if (value === 0) return "±0¢";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}¢`;
};

export const money = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value < 0 ? "−" : ""}$${abs}`;
};

export const compactMoney = (value: number) => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 10_000) return `$${Math.round(value / 1000)}k`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(value)}`;
};

export const shares = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: value < 10 ? 2 : 1 });

const PALETTE = ["#3fb8f5", "#ff9e6b", "#b28cff", "#f5c542", "#ff7ad9", "#6ee7ff", "#c9b6ff", "#ffb3a7", "#9ad8ff", "#e2d4ff", "#ffd36e", "#8d95a8"];

/** YES is blue, NO coral; multi outcomes use the talent's colour when linked, else a palette. */
export function outcomeColor(market: Pick<PredictionMarket, "market_type">, outcome: Pick<Outcome, "outcome_code" | "asset" | "sort_order">) {
  if (market.market_type === "binary") return outcome.outcome_code === "yes" ? "#3fb8f5" : "#ff9e6b";
  if (outcome.asset?.color) return talentAccent(outcome.asset.color);
  return PALETTE[outcome.sort_order % PALETTE.length];
}

/** "3d 4h", "2h 05m", "4m 09s", "closed". */
export function timeLeft(to: string | number | Date, now = Date.now()) {
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return "closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function timeAgo(at: string | number | Date, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - new Date(at).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Waiting for approval",
  rejected: "Rejected",
  open: "Live",
  closed: "Closed",
  resolving: "Awaiting a call",
  proposed: "Call proposed",
  disputed: "Disputed",
  resolved: "Resolved",
  voided: "Voided",
};

export const TEMPLATE_LABEL: Record<string, string> = {
  "tick-direction": "Tick call",
  "tick-top-gainer": "Top gainer",
  "stream-peak": "Stream peak",
};

/** The leading outcome (highest price). */
export const leader = (outcomes: Outcome[]) => outcomes.reduce((best, outcome) => (!best || outcome.price > best.price ? outcome : best), null as Outcome | null);
