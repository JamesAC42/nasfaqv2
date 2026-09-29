"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api";

/**
 * Channel stats per ticker, from the rankings table. Superchats, stream time and subscriber/view
 * growth cover `range` (sc7/stream7/subsCh/viewsCh keep their names whatever the range); for 24h the
 * growth comes from a 3-day overview series instead of the daily snapshots.
 */
export type Channel = { subs: number | null; views: number | null; videos: number | null; sc7: number | null; stream7: number | null; oshis: number | null; subsCh: number | null; viewsCh: number | null; growthDays: number | null };

export type ChannelRange = "24h" | "7d" | "30d" | "90d" | "1y";
export const CHANNEL_RANGES: ChannelRange[] = ["24h", "7d", "30d", "90d", "1y"];

const toNum = (value: unknown) => {
  const parsed = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? null : parsed;
};

export function useChannelData(range: ChannelRange = "7d") {
  const [channels, setChannels] = useState<Map<string, Channel>>(new Map());
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiFetch<{ rows?: Array<Record<string, unknown>> }>(`/api/market/rankings?superchat_range=${range}`, { cache: "no-store" }),
      range === "24h"
        ? apiFetch<Array<{ channel: { symbol?: string | null }; series?: Array<Record<string, unknown>> }>>("/api/overview/timeseries?days=3&limit=200", { cache: "no-store" })
        : Promise.resolve([] as Array<{ channel: { symbol?: string | null }; series?: Array<Record<string, unknown>> }>),
    ]).then(([rankings, series]) => {
      if (cancelled) return;
      const map = new Map<string, Channel>();
      if (rankings.status === "fulfilled") {
        for (const row of rankings.value.rows ?? []) {
          const symbol = String(row.symbol || "").toUpperCase();
          if (!symbol) continue;
          map.set(symbol, {
            subs: toNum(row.subscribers),
            views: toNum(row.views),
            videos: toNum(row.videos),
            sc7: toNum(row.superchat_earnings),
            stream7: toNum(row.stream_duration_seconds ?? row.stream_duration_seconds_7d) !== null ? (toNum(row.stream_duration_seconds ?? row.stream_duration_seconds_7d) as number) / 3600 : null,
            oshis: toNum(row.oshicoin_users),
            subsCh: range === "24h" ? null : toNum(row.subs_growth),
            viewsCh: range === "24h" ? null : toNum(row.views_growth),
            growthDays: range === "24h" ? 1 : toNum(row.growth_days),
          });
        }
      }
      if (series.status === "fulfilled") {
        for (const row of series.value ?? []) {
          const symbol = String(row.channel?.symbol || "").toUpperCase();
          const points = [...(row.series ?? [])].sort((a, b) => String(a.time).localeCompare(String(b.time)));
          const latest = points.at(-1);
          if (!symbol || !latest) continue;
          const latestTs = new Date(String(latest.time)).getTime();
          const prior = [...points].reverse().find((point) => new Date(String(point.time)).getTime() <= latestTs - 86_400_000);
          const change = (key: string) => {
            const now = toNum(latest[key]);
            const then = prior ? toNum(prior[key]) : null;
            return now !== null && then ? (now - then) / then : null;
          };
          const current = map.get(symbol) ?? { subs: null, views: null, videos: null, sc7: null, stream7: null, oshis: null, subsCh: null, viewsCh: null, growthDays: 1 };
          map.set(symbol, {
            ...current,
            subs: current.subs ?? toNum(latest.subscriber_count),
            views: current.views ?? toNum(latest.view_count),
            videos: current.videos ?? toNum(latest.video_count),
            subsCh: change("subscriber_count"),
            viewsCh: change("view_count"),
          });
        }
      }
      setChannels(map);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);
  return channels;
}

