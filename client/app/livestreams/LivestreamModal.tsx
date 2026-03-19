"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { getChannelIconUrl } from "../lib/channelIcons";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const BUCKET_WS_PATH = "/api/livestreams/buckets/ws";
function getVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
function toWsBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  return trimmed;
}

function getProxyWsBase(): string {
  if (typeof process === "undefined") return "";
  const isProxyMode = process.env.NEXT_PUBLIC_API_MODE === "proxy";
  if (!isProxyMode) return "";
  const proxyBase = process.env.NEXT_PUBLIC_API_PROXY_BASE_URL;
  if (!proxyBase) return "";
  return toWsBase(proxyBase);
}

function getBucketWsUrl(): string {
  const explicitBase =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_API_BASE
      ? toWsBase(process.env.NEXT_PUBLIC_WS_API_BASE)
      : "";
  const base =
    explicitBase || getProxyWsBase() || (typeof window !== "undefined" ? window.location.origin.replace(/^http/, "ws") : "");
  return base ? `${base}${BUCKET_WS_PATH}` : "";
}

type Stream = {
  video_id: string;
  status: "live" | "upcoming";
  title: string;
  thumbnail_url: string;
  channel_name: string;
  channel_icon?: string | null;
  scheduled_start_time?: string | null;
  actual_start_time?: string | null;
  concurrent_viewers?: number | null;
  ui_concurrent_viewers?: number | null;
};

type Session = {
  video_id: string;
  youtube_channel_id: string;
  status: "upcoming" | "live" | "ended";
  video_title: string | null;
  thumbnail_url: string | null;
  scheduled_start_at: string | null;
  actual_start_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  ended_at: string | null;
  avg_concurrent_viewers: number | null;
  max_concurrent_viewers: number | null;
  max_concurrent_viewers_at: string | null;
  channel_name: string;
  channel_icon: string | null;
};

type Bucket = {
  bucket_start: string;
  bucket_end: string;
  duration_seconds: number;
  avg_viewers: number | null;
  max_viewers: number | null;
};

type BucketUpdate = {
  video_id: string;
  bucket_start: string;
  bucket_end: string;
  avg_viewers?: number | string | null;
  max_viewers?: number | string | null;
};

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function fmtNum(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return nf.format(v);
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmtDurationSince(start: string | null | undefined, nowMs: number) {
  if (!start) return "—";
  const t = new Date(start).getTime();
  if (Number.isNaN(t)) return "—";
  const ms = nowMs - t;
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function getDisplayViewerCount(stream: Stream | null | undefined): number | null {
  if (!stream) return null;
  if (typeof stream.ui_concurrent_viewers === "number") return stream.ui_concurrent_viewers;
  if (typeof stream.concurrent_viewers === "number") return stream.concurrent_viewers;
  return null;
}

function buildOption(buckets: Bucket[]) {
  // Use `bucket_end` on the X axis so each point reflects the end of the 5-minute interval.
  const avg = buckets.map((b) => [new Date(b.bucket_end).getTime(), b.avg_viewers ?? null]);
  const mx = buckets.map((b) => [new Date(b.bucket_end).getTime(), b.max_viewers ?? null]);

  return {
    backgroundColor: "transparent",
    animationDuration: 350,
    grid: { left: 48, right: 20, top: 24, bottom: 28 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      valueFormatter: (value: number) => nf.format(value),
    },
    legend: {
      top: 0,
      textStyle: { color: "rgba(231, 238, 252, 0.7)" },
      data: ["Avg", "Max"],
    },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: "rgba(231, 238, 252, 0.2)" } },
      axisLabel: { color: "rgba(231, 238, 252, 0.7)", margin: 12 },
      splitLine: { lineStyle: { color: "rgba(231, 238, 252, 0.06)" } },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLine: { lineStyle: { color: "rgba(231, 238, 252, 0.2)" } },
      axisLabel: { color: "rgba(231, 238, 252, 0.7)" },
      splitLine: { lineStyle: { color: "rgba(231, 238, 252, 0.06)" } },
    },
    series: [
      {
        name: "Avg",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: "#5cc8ff" },
        areaStyle: { color: "#5cc8ff22" },
        data: avg,
      },
      {
        name: "Max",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: "#f7b267" },
        data: mx,
      },
    ],
  };
}

function mergeBucketsByStart(prev: Bucket[], incoming: Bucket[]): Bucket[] {
  // Merge by `bucket_start` so websocket updates can't be overwritten by the
  // initial HTTP `/buckets` response that might still be in-flight.
  if (prev.length === 0) return incoming;
  if (incoming.length === 0) return prev;

  const byStart = new Map<string, Bucket>();
  for (const b of prev) byStart.set(b.bucket_start, b);

  for (const b of incoming) {
    const existing = byStart.get(b.bucket_start);
    // Prefer the existing (likely newer websocket) value when present.
    if (existing) byStart.set(b.bucket_start, { ...b, ...existing });
    else byStart.set(b.bucket_start, b);
  }

  return [...byStart.values()].sort((a, b) => String(a.bucket_start).localeCompare(String(b.bucket_start)));
}

export function LivestreamModal({
  open,
  onClose,
  stream,
}: {
  open: boolean;
  onClose: () => void;
  stream: Stream | null;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());
  const [entered, setEntered] = useState(false);
  const [watchingDotAnimating, setWatchingDotAnimating] = useState(false);

  useLayoutEffect(() => {
    if (!open) {
      setEntered(false);
      setWatchingDotAnimating(false);
      return;
    }
    setEntered(false);
    setWatchingDotAnimating(false);
    // Use two rAFs so the browser has a chance to paint the "entered=false"
    // styles before we flip to "entered=true". This makes the modal transition
    // reliably run on every open (not only the first time).
    let rafEntered2: number | null = null;
    const raf1 = window.requestAnimationFrame(() => {
      rafEntered2 = window.requestAnimationFrame(() => setEntered(true));
    });
    const raf2 = window.requestAnimationFrame(() => setWatchingDotAnimating(true));
    const id = window.setInterval(() => setNowTickMs(Date.now()), 1_000);
    return () => {
      window.cancelAnimationFrame(raf1);
      if (rafEntered2 != null) window.cancelAnimationFrame(rafEntered2);
      window.cancelAnimationFrame(raf2);
      window.clearInterval(id);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !stream?.video_id) return;
    setLoading(true);
    setError(null);
    setSession(null);
    setBuckets([]);

    (async () => {
      try {
        const res = await fetch(`/api/livestreams/${encodeURIComponent(stream.video_id)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { session: Session | null };
        setSession(json.session);

        const res2 = await fetch(`/api/livestreams/${encodeURIComponent(stream.video_id)}/buckets`, { cache: "no-store" });
        if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
        const json2 = (await res2.json()) as { buckets: Bucket[] };
        const fetched = (json2.buckets || []).map((b) => ({
            ...b,
            avg_viewers: toNum((b as unknown as { avg_viewers?: unknown }).avg_viewers),
            max_viewers: toNum((b as unknown as { max_viewers?: unknown }).max_viewers),
          }));
        setBuckets((prev) => mergeBucketsByStart(prev, fetched));
      } catch (e) {
        setError(String((e as Error)?.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, stream?.video_id]);

  // Live bucket updates while modal is open.
  useEffect(() => {
    if (!open || !stream?.video_id) return;
    const wsUrl = getBucketWsUrl();
    if (!wsUrl) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      attempt++;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        attempt = 0;
      };
      ws.onclose = () => {
        if (closed) return;
        const delay = Math.min(15_000, 1_000 * Math.max(1, attempt));
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {}
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as BucketUpdate;
          if (msg.video_id !== stream.video_id) return;
          if (!msg.bucket_start) return;
          setBuckets((prev) => {
            const next: Bucket = {
              bucket_start: msg.bucket_start,
              bucket_end: msg.bucket_end,
              duration_seconds: Math.max(
                1,
                Math.floor((new Date(msg.bucket_end).getTime() - new Date(msg.bucket_start).getTime()) / 1000)
              ),
              avg_viewers: toNum(msg.avg_viewers),
              max_viewers: toNum(msg.max_viewers),
            };
            const idx = prev.findIndex((b) => b.bucket_start === msg.bucket_start);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], ...next };
              return copy;
            }
            return [...prev, next].sort((a, b) => String(a.bucket_start).localeCompare(String(b.bucket_start)));
          });
        } catch {
          // ignore
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {}
    };
  }, [open, stream?.video_id]);

  const display = useMemo(() => {
    const title = session?.video_title || stream?.title || "Livestream";
    const thumb = session?.thumbnail_url || stream?.thumbnail_url || "";
    const channelName = session?.channel_name || stream?.channel_name || "—";
    const channelIcon = session?.channel_icon || stream?.channel_icon || null;
    const scheduled = session?.scheduled_start_at || stream?.scheduled_start_time || null;
    const actual = session?.actual_start_at || stream?.actual_start_time || null;
    const currentViewers = getDisplayViewerCount(stream);
    return { title, thumb, channelName, channelIcon, scheduled, actual, currentViewers };
  }, [session, stream]);

  const stats = useMemo(() => {
    if (!buckets.length) return { avg: null as number | null, max: null as number | null };
    const avgs = buckets.map((b) => b.avg_viewers).filter((v): v is number => typeof v === "number");
    const maxs = buckets.map((b) => b.max_viewers).filter((v): v is number => typeof v === "number");
    const avg = avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null;
    const max = maxs.length ? Math.max(...maxs) : null;
    return { avg, max };
  }, [buckets]);

  const option = useMemo(() => buildOption(buckets), [buckets]);

  if (!open || !stream) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: entered ? "rgba(0,0,0,0.62)" : "rgba(0,0,0,0)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.25rem",
        zIndex: 50,
        transition: "background 220ms ease",
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(70rem, 100%)",
          maxHeight: "min(46rem, 90vh)",
          overflow: "auto",
          padding: "1.25rem",
          transform: entered ? "translateY(0) scale(1)" : "translateY(0.75rem) scale(0.985)",
          opacity: entered ? 1 : 0,
          transition: "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease",
          willChange: "transform, opacity",
          minHeight: "36rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: "1rem", alignItems: "stretch" }}>
            <div style={{ flex: "0 0 auto", height: "auto", display: "flex", minHeight: "10.25rem" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={display.thumb}
                alt=""
                style={{
                  height: "100%",
                  width: "auto",
                  maxWidth: "18rem",
                  borderRadius: "0.75rem",
                  objectFit: "cover",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div className="name" style={{ fontSize: "1.1rem" }}>
                {display.title}
              </div>
              <div className="meta" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
                {getChannelIconUrl(display.channelIcon) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getChannelIconUrl(display.channelIcon)!}
                    alt=""
                    style={{ width: "1.75rem", height: "1.75rem", borderRadius: "0.6rem", objectFit: "contain" }}
                    loading="lazy"
                  />
                ) : null}
                <span>{display.channelName}</span>
              </div>
              <div style={{ marginTop: "0.65rem", display: "grid", gap: "0.35rem" }}>
                <div className="muted">
                  <span style={{ color: "rgba(231, 238, 252, 0.55)", fontWeight: 650 }}>Scheduled</span>{" "}
                  <span className="muted">{fmtDate(display.scheduled)}</span>
                  <span className="dot">·</span>
                  <span style={{ color: "rgba(231, 238, 252, 0.55)", fontWeight: 650 }}>Actual</span>{" "}
                  <span className="muted">{fmtDate(display.actual)}</span>
                </div>
                <div className="muted">
                  <span style={{ color: "rgba(231, 238, 252, 0.55)", fontWeight: 650 }}>Length</span>{" "}
                  <span className="muted">{fmtDurationSince(display.actual, nowTickMs)}</span>
                  <span className="dot">·</span>
                  <span className="modalWatchingInline">
                    <span>Watching</span>
                    <span
                      className={`recordingDot${watchingDotAnimating ? " recordingDotAnimating" : ""}`}
                      aria-hidden="true"
                    />
                    <span className="modalWatchingNumber">{fmtNum(display.currentViewers)}</span>
                  </span>
                </div>
              </div>
              <div className="links" style={{ marginTop: "0.75rem" }}>
                <a className="pill" href={getVideoUrl(stream.video_id)} target="_blank" rel="noreferrer">
                  Open stream
                </a>
                <Link className="pill" href="/livestreams" onClick={onClose}>
                  Back to list
                </Link>
              </div>
            </div>
          </div>
          <button type="button" className="pill" onClick={onClose} style={{ cursor: "pointer", alignSelf: "flex-start" }}>
            Close
          </button>
        </div>

        {error ? (
          <div className="card" style={{ marginTop: "1rem" }}>
            <div className="name">Failed to load stream details</div>
            <div className="muted">{error}</div>
          </div>
        ) : null}

        {loading ? (
          <div className="card" style={{ marginTop: "1rem" }}>
            <div className="name">Loading…</div>
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 18rem", gap: "1rem", marginTop: "1rem" }}>
          <div className="card" style={{ padding: "0.75rem" }}>
            <div className="name" style={{ marginBottom: "0.5rem" }}>
              Viewers over time (5m buckets)
            </div>
            <div style={{ height: loading || buckets.length > 0 ? "20rem" : "auto" }}>
              {loading ? (
                <div
                  style={{
                    height: "100%",
                    borderRadius: "0.9rem",
                    border: "0.0625rem solid rgba(231, 238, 252, 0.08)",
                    background:
                      "linear-gradient(90deg, rgba(231,238,252,0.04) 0%, rgba(231,238,252,0.08) 45%, rgba(231,238,252,0.04) 100%)",
                  }}
                />
              ) : buckets.length === 0 ? (
                <div
                  style={{
                    minHeight: "7.5rem",
                    borderRadius: "0.9rem",
                    border: "0.0625rem dashed rgba(231, 238, 252, 0.14)",
                    background: "rgba(231, 238, 252, 0.03)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "1.25rem",
                    textAlign: "center",
                    color: "rgba(231, 238, 252, 0.66)",
                    fontWeight: 600,
                  }}
                >
                  Not enough data to show the graph yet.
                </div>
              ) : (
                <ReactECharts option={option} style={{ height: "100%", width: "100%" }} />
              )}
            </div>
          </div>
          <div className="card" style={{ padding: "0.75rem" }}>
            <div className="name">Current (so far)</div>
            <div className="kv" style={{ marginTop: "0.5rem" }}>
              <div className="k">Data points</div>
              <div className="v">{fmtNum(buckets.length)}</div>
              <div className="k">Avg viewers</div>
              <div className="v">{fmtNum(stats.avg)}</div>
              <div className="k">Max viewers</div>
              <div className="v">{fmtNum(stats.max)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

