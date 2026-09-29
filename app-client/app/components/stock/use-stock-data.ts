"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import {
  normalizeArticleListResponse,
  normalizeAssetCommentListResponse,
  normalizeAssetSuperchatSummary,
  normalizeAssetSuperchatTimeseries,
  normalizeCandles,
  normalizeLivestreams,
  normalizeMarketAssetAdjustmentHistory,
  normalizeOshiboardResponse,
  normalizeStats,
  normalizeTrades,
  normalizeTreasury,
} from "@/app/lib/normalizers";
import type {
  ArticleSummary,
  AssetCommentListResponse,
  AssetDetailBundle,
  AssetSuperchatSummaryBundle,
  AssetSuperchatTimeseriesBundle,
  CandlePoint,
  LivestreamItem,
  MarketAdjustmentOutcome,
  MarketStatPoint,
  OshiboardResponse,
  TradeRow,
} from "@/app/lib/types";

export type Loaded<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

/** Fetch a URL (null skips), normalize it, and cancel stale responses when the URL changes. */
export function useApi<T>(url: string | null, normalize: (raw: Record<string, unknown>) => T, pollMs?: number): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [nonce, setNonce] = useState(0);
  const norm = useRef(normalize);
  norm.current = normalize;

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<Record<string, unknown>>(url)
      .then((raw) => {
        if (!cancelled) setData(norm.current(raw));
      })
      .catch((reason) => {
        if (!cancelled) setError(String((reason as Error).message || reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  useEffect(() => {
    if (!url || !pollMs) return;
    const id = window.setInterval(() => setNonce((value) => value + 1), pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, url]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}

const enc = encodeURIComponent;
const list = <T,>(raw: unknown, key: string, map: (rows: Array<Record<string, unknown>>) => T[]) => {
  const rows = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : null;
  return map(Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []);
};

// ── Market ───────────────────────────────────────────────────────────────
export type ChartRange = "1d" | "1w" | "1m" | "3m" | "1y";
export const CHART_RANGES: Array<{ value: ChartRange; label: string; interval: string; range: string }> = [
  { value: "1d", label: "1D", interval: "5m", range: "24h" },
  { value: "1w", label: "1W", interval: "1h", range: "7d" },
  { value: "1m", label: "1M", interval: "1d", range: "30d" },
  { value: "3m", label: "3M", interval: "1d", range: "90d" },
  { value: "1y", label: "1Y", interval: "1d", range: "1y" },
];

export function useCandles(symbol: string, range: ChartRange) {
  const spec = CHART_RANGES.find((entry) => entry.value === range) ?? CHART_RANGES[0];
  return useApi<CandlePoint[]>(`/api/market/assets/${enc(symbol)}/candles?interval=${spec.interval}&range=${spec.range}`, (raw) => list(raw, "candles", normalizeCandles), range === "1d" ? 60_000 : undefined);
}

export function useStats(symbol: string) {
  return useApi<MarketStatPoint[]>(`/api/market/assets/${enc(symbol)}/stats?range=1y`, (raw) => list(raw, "stats", normalizeStats));
}

export function useTape(symbol: string) {
  return useApi<TradeRow[]>(`/api/market/assets/${enc(symbol)}/trades?limit=12`, (raw) => list(raw, "trades", normalizeTrades), 60_000);
}

export function useTreasury(symbol: string) {
  return useApi<AssetDetailBundle["treasury"]>(`/api/market/assets/${enc(symbol)}/treasury`, (raw) => normalizeTreasury(raw));
}

export function useTickHistory(symbol: string) {
  return useApi<MarketAdjustmentOutcome[]>(
    `/api/market/assets/${enc(symbol)}/adjustments?recent_limit=12&upcoming_limit=4`,
    (raw) => normalizeMarketAssetAdjustmentHistory(raw).items,
    120_000,
  );
}

// ── Community ────────────────────────────────────────────────────────────
export function useOshiboard(symbol: string) {
  return useApi<OshiboardResponse>(`/api/leaderboard/oshiboard/${enc(symbol)}?limit=12`, normalizeOshiboardResponse);
}

export function useComments(symbol: string, page: number) {
  return useApi<AssetCommentListResponse>(`/api/market/assets/${enc(symbol)}/comments?page=${page}&limit=8`, normalizeAssetCommentListResponse);
}

/** The latest 24 posts, only to read the board's mood. */
export function useBoardMood(symbol: string, revision: number) {
  return useApi<AssetCommentListResponse>(`/api/market/assets/${enc(symbol)}/comments?page=1&limit=24&r=${revision}`, normalizeAssetCommentListResponse);
}

export function useArticles(symbol: string) {
  return useApi<ArticleSummary[]>(`/api/articles?asset=${enc(symbol)}&limit=8`, (raw) => normalizeArticleListResponse(raw).items);
}

// ── Channel ──────────────────────────────────────────────────────────────
export type SuperchatRank = { symbol: string; range: string; total_in_yen: number | null; rank: number | null };

export function useSuperchats(symbol: string, enabled: boolean) {
  const summary = useApi<AssetSuperchatSummaryBundle>(enabled ? `/api/market/assets/${enc(symbol)}/superchats?range=7d` : null, normalizeAssetSuperchatSummary);
  const rank = useApi<SuperchatRank>(enabled ? `/api/market/assets/${enc(symbol)}/superchat-rank?range=7d` : null, (raw) => ({
    symbol: String(raw.symbol ?? symbol),
    range: String(raw.range ?? "7d"),
    total_in_yen: raw.total_in_yen === null || raw.total_in_yen === undefined ? null : Number(raw.total_in_yen),
    rank: raw.rank === null || raw.rank === undefined ? null : Number(raw.rank),
  }));
  const year = useApi<AssetSuperchatTimeseriesBundle>(enabled ? `/api/market/assets/${enc(symbol)}/superchats/timeseries?range=1y` : null, normalizeAssetSuperchatTimeseries);
  return { summary, rank, year };
}

export function useChannelStreams(channelId: string | null) {
  return useApi<{ live: LivestreamItem[]; upcoming: LivestreamItem[] }>(
    channelId ? `/api/livestreams/channel/${enc(channelId)}` : null,
    (raw) => ({ live: list(raw, "live", normalizeLivestreams), upcoming: list(raw, "upcoming", normalizeLivestreams) }),
    120_000,
  );
}

export type PastStream = {
  video_id: string;
  video_title: string | null;
  thumbnail_url: string | null;
  channel_name: string;
  channel_icon: string | null;
  channel_color: string | null;
  scheduled_start_at: string | null;
  actual_start_at: string | null;
  ended_at: string | null;
  total_views: number | null;
  avg_concurrent_viewers: number | null;
  max_concurrent_viewers: number | null;
  duration_seconds: number | null;
};

export type PastStreamWeek = { page: number; week_start: string; week_end: string; has_older: boolean; streams: PastStream[] };

export function usePastStreams(channelId: string | null, page: number) {
  return useApi<PastStreamWeek>(channelId ? `/api/livestreams/history?page=${page}&channel=${enc(channelId)}` : null, (raw) => ({
    page: Number(raw.page ?? page),
    week_start: String(raw.week_start ?? ""),
    week_end: String(raw.week_end ?? ""),
    has_older: Boolean(raw.has_older),
    streams: Array.isArray(raw.streams) ? (raw.streams as PastStream[]) : [],
  }));
}

/** Stream length in seconds, from the reported duration or the start/end stamps. */
export function streamSeconds(stream: PastStream) {
  if (stream.duration_seconds && stream.duration_seconds > 0) return stream.duration_seconds;
  const start = Date.parse(stream.actual_start_at ?? stream.scheduled_start_at ?? "");
  const end = Date.parse(stream.ended_at ?? "");
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 1000 : 0;
}
