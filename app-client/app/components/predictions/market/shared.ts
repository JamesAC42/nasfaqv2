"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/app/lib/api";
import { STATUS_LABEL } from "@/app/lib/predictions/format";
import type { Fill, Outcome, PredictionMarketDetail, Trade } from "@/app/lib/predictions/types";

// Small helpers shared by the market page's pieces.

/** Re-renders every `ms` so countdowns tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const COMPACT_QUERY = "(max-width: 1020px)";

/** True at tablet width and below, where the ticket moves into a bottom sheet (matches the bottom nav). */
export function useCompact() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(COMPACT_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  );
}

/** "41.0¢": one decimal, for average prices where whole cents hide the slippage. */
export const centsFine = (price: number | null | undefined) => {
  if (price === null || price === undefined || !Number.isFinite(price)) return "—";
  return `${(price * 100).toFixed(1)}¢`;
};

export const signedMoney = (value: number) => {
  const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(value) < 0.005) return `$${abs}`;
  return `${value > 0 ? "+" : "−"}$${abs}`;
};

export const tone = (value: number, epsilon = 0.0005) => (value > epsilon ? "up" : value < -epsilon ? "down" : "flat");

/** 46100 → "46.1k". */
export const compactCount = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
};

/** Text on an outcome-coloured fill: dark ink on light colours, white on dark ones. */
export function inkOn(hex: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "#05080d";
  const n = parseInt(match[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.28 ? "#05080d" : "#ffffff";
}

export type StatusTone = "live" | "wait" | "warn" | "done" | "void";

export function statusOf(market: Pick<PredictionMarketDetail, "status" | "trading_status">): { label: string; tone: StatusTone } {
  if (market.status === "open" && market.trading_status === "halted") return { label: "Halted", tone: "warn" };
  if (market.status === "open" && market.trading_status === "pending_open") return { label: "Opens soon", tone: "wait" };
  const label = STATUS_LABEL[market.status] ?? market.status;
  switch (market.status) {
    case "open":
      return { label, tone: "live" };
    case "proposed":
    case "disputed":
    case "resolving":
      return { label, tone: "warn" };
    case "resolved":
      return { label, tone: "done" };
    case "voided":
    case "rejected":
      return { label, tone: "void" };
    default:
      return { label, tone: "wait" };
  }
}

export const isTradeable = (market: Pick<PredictionMarketDetail, "status" | "trading_status">) => market.status === "open" && market.trading_status === "open";

/** Auto-resolution data in words: "AKI 10.86 → 10.83", "peak 46.1k vs line 45k", "PEK +3.2%". */
export function evidenceText(evidence: Record<string, unknown> | null | undefined) {
  if (!evidence) return null;
  const e = evidence as Record<string, number | string | undefined>;
  if (e.price_before !== undefined && e.price_after !== undefined) {
    return `${e.symbol ?? ""} ${Number(e.price_before).toFixed(2)} → ${Number(e.price_after).toFixed(2)}`.trim();
  }
  if (e.peak !== undefined && e.line !== undefined) return `peak ${compactCount(Number(e.peak))} vs line ${compactCount(Number(e.line))}`;
  if (e.top_gainer !== undefined) return `${e.top_gainer} ${Number(e.move_pct) >= 0 ? "+" : ""}${Number(e.move_pct ?? 0).toFixed(2)}%`;
  if (e.reason) return String(e.reason);
  return null;
}

let tradeSeq = 0;
/** A socket fill in the shape of the trades feed. */
export function fillToTrade(fill: Fill): Trade {
  tradeSeq += 1;
  return {
    id: -tradeSeq,
    market_id: fill.market_id,
    slug: fill.slug,
    market_title: "",
    outcome_code: fill.outcome_code,
    outcome_label: fill.outcome_label,
    side: fill.side,
    shares: fill.shares,
    cash: fill.cash,
    avg_price: fill.avg_price,
    price_after: fill.price_after,
    via_limit: fill.limit_order_id !== null && fill.limit_order_id !== undefined,
    username: fill.username ?? null,
    profile_color: null,
    at: fill.at,
  };
}

/** The outcome a `?outcome=` param means (code or label, any case). */
export function findOutcome(outcomes: Outcome[], wanted: string | null | undefined) {
  if (!wanted) return null;
  const key = wanted.trim().toLowerCase();
  return outcomes.find((outcome) => outcome.outcome_code.toLowerCase() === key || outcome.label.toLowerCase() === key) ?? null;
}

// ── Comments (API from the first build; shapes in api/src/predictionMarketDb.js) ─────────────
export type CommentAuthor = { id: number; username: string; profile_picture_url: string | null; profile_color: string | null; total_equity: number | null; rank: number | null };
export type CommentStake = { outcome_id: number; outcome_code: string; outcome_label: string | null; shares: number; avg_entry_price: number };
export type MarketComment = { id: number; market_id: number; body: string; created_at: string; updated_at: string; author: CommentAuthor | null; author_stakes: CommentStake[] };
export type CommentsPage = {
  slug: string;
  comments: MarketComment[];
  pagination: { total: number; page: number; limit: number; page_count: number; has_previous_page: boolean; has_next_page: boolean };
  viewer_context: { is_authenticated: boolean; can_post: boolean; positions: CommentStake[] };
};

const COMMENTS = (slug: string) => `/api/prediction-markets/${encodeURIComponent(slug)}/comments`;
export const fetchComments = (slug: string, page = 1, limit = 12) => apiFetch<CommentsPage>(`${COMMENTS(slug)}?page=${page}&limit=${limit}`, { cache: "no-store" });
export const postComment = (slug: string, body: string) => apiFetch<{ comment?: MarketComment }>(COMMENTS(slug), { method: "POST", body: JSON.stringify({ body }) });
