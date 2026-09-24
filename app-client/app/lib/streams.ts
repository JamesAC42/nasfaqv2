import type { LivestreamItem, MarketAsset } from "@/app/lib/types";

/** What we already know about a stream when someone opens it (the sheet fetches the rest). */
export type StreamPreview = {
  id: string;
  title: string;
  creator: string;
  channel_id?: string | null;
  creator_icon?: string | null;
  channel_color?: string | null;
  thumbnail_url?: string | null;
  started_at?: string | null;
  actual_start_time?: string | null;
  ended_at?: string | null;
  status: string;
  viewer_count?: number | null;
  url?: string | null;
};

/** A finished stream, as /api/livestreams/history returns it. */
export type PastStreamRow = {
  video_id: string;
  youtube_channel_id: string | null;
  status: string;
  video_title: string | null;
  thumbnail_url: string | null;
  channel_name: string;
  channel_icon: string | null;
  channel_color: string | null;
  scheduled_start_at: string | null;
  actual_start_at: string | null;
  ended_at: string | null;
  total_views: number | string | null;
  avg_concurrent_viewers: number | string | null;
  max_concurrent_viewers: number | string | null;
  duration_seconds: number | string | null;
};

export type PastStream = {
  id: string;
  channel_id: string | null;
  title: string;
  creator: string;
  creator_icon: string | null;
  channel_color: string | null;
  thumbnail_url: string | null;
  started_at: string | null;
  scheduled_at: string | null;
  ended_at: string | null;
  total_views: number | null;
  avg_viewers: number | null;
  max_viewers: number | null;
  duration_seconds: number | null;
};

export const num = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function normalizePastStream(row: PastStreamRow): PastStream {
  const started = row.actual_start_at || row.scheduled_start_at;
  const duration = num(row.duration_seconds) ?? (started && row.ended_at ? Math.max(0, (Date.parse(row.ended_at) - Date.parse(started)) / 1000) : null);
  return {
    id: row.video_id,
    channel_id: row.youtube_channel_id,
    title: row.video_title?.trim() || "Untitled stream",
    creator: row.channel_name,
    creator_icon: row.channel_icon,
    channel_color: row.channel_color,
    thumbnail_url: row.thumbnail_url,
    started_at: started,
    scheduled_at: row.scheduled_start_at,
    ended_at: row.ended_at,
    total_views: num(row.total_views),
    avg_viewers: num(row.avg_concurrent_viewers),
    max_viewers: num(row.max_concurrent_viewers),
    duration_seconds: duration,
  };
}

export function previewOf(item: LivestreamItem | PastStream): StreamPreview {
  if ("max_viewers" in item) {
    return {
      id: item.id,
      title: item.title,
      creator: item.creator,
      channel_id: item.channel_id,
      creator_icon: item.creator_icon,
      channel_color: item.channel_color,
      thumbnail_url: item.thumbnail_url,
      started_at: item.started_at,
      actual_start_time: item.started_at,
      ended_at: item.ended_at,
      status: "ended",
      viewer_count: null,
      url: youtubeUrl(item.id),
    };
  }
  return { ...item, channel_id: item.channel_id ?? null };
}

export const youtubeUrl = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

const key = (value: string | null | undefined) => (value || "").trim().toLowerCase();

/** The stock for a stream's channel (by channel id, falling back to the talent's name). */
export function assetForStream(assets: MarketAsset[], channelId: string | null | undefined, creator: string | null | undefined) {
  const id = key(channelId);
  if (id) {
    const byId = assets.find((asset) => key(asset.youtube_channel_id) === id);
    if (byId) return byId;
  }
  const name = key(creator);
  return name ? assets.find((asset) => key(asset.display_name) === name) ?? null : null;
}

/** 1:23:45 / 23:45 style uptime. */
export function clockDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** 3h 20m / 45m style length. */
export function shortDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
}

/** "in 2h 05m", "in 3d 4h", "any minute", "12m late". */
export function untilLabel(iso: string | null | undefined, now: number) {
  if (!iso) return "time TBD";
  const diff = Date.parse(iso) - now;
  if (!Number.isFinite(diff)) return "time TBD";
  const mins = Math.round(Math.abs(diff) / 60_000);
  if (diff < 0) {
    if (mins < 2) return "any minute";
    if (mins >= 24 * 60) return "delayed";
    return mins < 60 ? `${mins}m late` : `${Math.floor(mins / 60)}h ${mins % 60}m late`;
  }
  if (mins < 1) return "any minute";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `in ${h}h ${String(mins % 60).padStart(2, "0")}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export function compactCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  if (value >= 1e4) return `${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1)}k`;
  return Math.round(value).toLocaleString("en-US");
}

export const localTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—");

export function localDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Today / Tomorrow / Wednesday, Sep 30 in the viewer's time zone. */
export function dayHeading(iso: string | null | undefined, now: number) {
  if (!iso) return "Unscheduled";
  const date = new Date(iso);
  const today = new Date(now);
  const tomorrow = new Date(now + 86_400_000);
  if (date.getTime() < now) return "Waiting to start";
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}
