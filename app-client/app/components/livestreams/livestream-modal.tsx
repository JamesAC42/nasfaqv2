"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtDurationSeconds, fmtInteger } from "@/app/lib/format";
import { getIconUrl } from "@/app/lib/normalizers";
import { getBucketWsUrl } from "@/app/lib/ws";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/livestreams/livestream-modal.module.scss";

export type LivestreamModalItem = {
  id: string;
  title: string;
  creator: string;
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

type SessionResponse = {
  session: {
    video_id: string;
    youtube_channel_id: string;
    status: "upcoming" | "live" | "ended";
    video_title: string | null;
    thumbnail_url: string | null;
    scheduled_start_at: string | null;
    actual_start_at: string | null;
    ended_at: string | null;
    total_views: number | null;
    avg_concurrent_viewers: number | null;
    max_concurrent_viewers: number | null;
    duration_seconds: number | null;
    channel_name: string;
    channel_icon: string | null;
    channel_color: string | null;
  } | null;
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

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHexColor(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function hexToRgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function mixHex(hex: string, target: string, amount: number) {
  const source = hexToRgb(hex);
  const to = hexToRgb(target);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `#${mix(source.r, to.r).toString(16).padStart(2, "0")}${mix(source.g, to.g)
    .toString(16)
    .padStart(2, "0")}${mix(source.b, to.b).toString(16).padStart(2, "0")}`;
}

function toChartTime(value: string): Time | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000) as Time;
}

function resolveChartFontFamily() {
  if (typeof window !== "undefined") {
    const computed = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    if (computed) return computed;
  }
  return "'Nasfaq Mono', 'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace";
}

function resolveCssVar(name: string, fallback: string) {
  if (typeof window !== "undefined") {
    const computed = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (computed) return computed;
  }
  return fallback;
}

function mergeBucketsByStart(prev: Bucket[], incoming: Bucket[]) {
  if (!prev.length) return incoming;
  if (!incoming.length) return prev;
  const byStart = new Map(prev.map((item) => [item.bucket_start, item]));
  for (const bucket of incoming) {
    const existing = byStart.get(bucket.bucket_start);
    byStart.set(bucket.bucket_start, existing ? { ...existing, ...bucket } : bucket);
  }
  return [...byStart.values()].sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
}

function sanitizeTitle(value: string | null | undefined) {
  return String(value || "").replace(/^\s+|\s+$/gu, "");
}

type ChartPoint = { time: Time; value: number };

function smoothSeriesData(points: ChartPoint[]) {
  if (points.length < 3) return points;

  const smoothed: ChartPoint[] = [];
  const segments = 6;

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];

    if (index === 0) {
      smoothed.push(p1);
    }

    for (let step = 1; step < segments; step += 1) {
      const t = step / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      const value =
        0.5 *
        ((2 * p1.value) +
          (-p0.value + p2.value) * t +
          (2 * p0.value - 5 * p1.value + 4 * p2.value - p3.value) * t2 +
          (-p0.value + 3 * p1.value - 3 * p2.value + p3.value) * t3);
      const rawTime = Number(p1.time) + (Number(p2.time) - Number(p1.time)) * t;
      const roundedTime = Math.round(rawTime) as Time;
      const nextTime = Number(roundedTime) > Number(smoothed[smoothed.length - 1]?.time ?? 0) ? roundedTime : ((Number(smoothed[smoothed.length - 1]?.time ?? 0) + 1) as Time);

      smoothed.push({
        time: nextTime,
        value: Math.max(0, value),
      });
    }

    smoothed.push(p2);
  }

  return smoothed;
}

function ViewerBucketsChart({ buckets, accentColor }: { buckets: Bucket[]; accentColor: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const avgSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const maxSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const chartTheme = useMemo(
    () => ({
      textColor: resolveCssVar("--text", "#112033"),
      gridColor: resolveCssVar("--border", "rgba(96, 178, 229, 0.644)"),
      crosshairColor: resolveCssVar("--muted", "#4d6986"),
    }),
    []
  );

  const avgData = useMemo(
    () => {
      const points =
        buckets
        .map((bucket) => {
          const time = toChartTime(bucket.bucket_end);
          if (!time || bucket.avg_viewers === null) return null;
          return { time, value: bucket.avg_viewers };
        })
        .filter(Boolean) as ChartPoint[];
      return smoothSeriesData(points);
    },
    [buckets]
  );

  const maxData = useMemo(
    () => {
      const points =
        buckets
        .map((bucket) => {
          const time = toChartTime(bucket.bucket_end);
          if (!time || bucket.max_viewers === null) return null;
          return { time, value: bucket.max_viewers };
        })
        .filter(Boolean) as ChartPoint[];
      return smoothSeriesData(points);
    },
    [buckets]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 280,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: chartTheme.textColor,
        fontFamily: resolveChartFontFamily(),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: chartTheme.gridColor },
        horzLines: { color: chartTheme.gridColor },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderVisible: false,
      },
      crosshair: {
        vertLine: { color: chartTheme.crosshairColor },
        horzLine: { color: chartTheme.crosshairColor },
      },
    });

    const avgSeries = chart.addSeries(LineSeries, {
      color: mixHex(accentColor, "#d7dce5", 0.35),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    const maxSeries = chart.addSeries(LineSeries, {
      color: accentColor,
      lineWidth: 3,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    avgSeriesRef.current = avgSeries;
    maxSeriesRef.current = maxSeries;

    return () => {
      chartRef.current = null;
      avgSeriesRef.current = null;
      maxSeriesRef.current = null;
      chart.remove();
    };
  }, [chartTheme]);

  useEffect(() => {
    if (!avgSeriesRef.current || !maxSeriesRef.current) return;
    avgSeriesRef.current.applyOptions({ color: mixHex(accentColor, "#d7dce5", 0.35) });
    maxSeriesRef.current.applyOptions({ color: accentColor });
  }, [accentColor]);

  useEffect(() => {
    if (!avgSeriesRef.current || !maxSeriesRef.current || !chartRef.current) return;
    avgSeriesRef.current.setData(avgData);
    maxSeriesRef.current.setData(maxData);
    chartRef.current.timeScale().fitContent();
  }, [avgData, maxData]);

  return buckets.length ? <div ref={containerRef} className={styles.chartCanvas} /> : <div className={styles.chartEmpty}>No bucket data yet.</div>;
}

export function LivestreamModal({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: LivestreamModalItem | null;
  onClose: () => void;
}) {
  const [session, setSession] = useState<SessionResponse["session"]>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isCompact, setIsCompact] = useState(false);
  const assets = useMarketStore((state) => state.assets);
  const activeSession = session?.video_id === item?.id ? session : null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const media = window.matchMedia("(max-width: 900px)");
    const updateCompact = () => setIsCompact(media.matches);
    updateCompact();

    media.addEventListener("change", updateCompact);
    return () => {
      media.removeEventListener("change", updateCompact);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    setSession(null);
    setBuckets([]);
    setError(null);
    setLoading(false);
  }, [open]);

  useEffect(() => {
    if (!open || !item?.id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [sessionResult, bucketsResult] = await Promise.all([
          apiFetch<SessionResponse>(`/api/livestreams/${encodeURIComponent(item.id)}`),
          apiFetch<{ buckets: Bucket[] }>(`/api/livestreams/${encodeURIComponent(item.id)}/buckets`),
        ]);
        if (cancelled) return;
        setSession(sessionResult.session);
        setBuckets(
          (bucketsResult.buckets || []).map((bucket) => ({
            ...bucket,
            avg_viewers: toNumber(bucket.avg_viewers),
            max_viewers: toNumber(bucket.max_viewers),
          }))
        );
      } catch (nextError) {
        if (cancelled) return;
        setError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item?.id, open]);

  useEffect(() => {
    if (!open || !item?.id || (activeSession?.status && activeSession.status !== "live")) return;
    const wsUrl = getBucketWsUrl();
    if (!wsUrl) return;
    let closed = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      attempt += 1;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, Math.min(15_000, 1_000 * Math.max(1, attempt)));
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {}
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as BucketUpdate;
          if (message.video_id !== item.id || !message.bucket_start) return;
          setBuckets((current) =>
            mergeBucketsByStart(current, [
              {
                bucket_start: message.bucket_start,
                bucket_end: message.bucket_end,
                duration_seconds: Math.max(
                  1,
                  Math.floor((new Date(message.bucket_end).getTime() - new Date(message.bucket_start).getTime()) / 1000)
                ),
                avg_viewers: toNumber(message.avg_viewers),
                max_viewers: toNumber(message.max_viewers),
              },
            ])
          );
        } catch {}
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {}
    };
  }, [activeSession?.status, item?.id, open]);

  const accentColor = normalizeHexColor(activeSession?.channel_color || item?.channel_color) || "#ff5c7a";
  const modalStyle = { "--stream-accent": accentColor } as CSSProperties;
  const youtubeUrl = item?.url || (item ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}` : "/livestreams");
  const channelId = activeSession?.youtube_channel_id || null;
  const stockAsset = useMemo(() => {
    if (!channelId) return null;
    return assets.find((asset) => asset.youtube_channel_id === channelId) || null;
  }, [assets, channelId]);

  const display = useMemo(() => {
    if (!item) return null;
    const started = activeSession?.scheduled_start_at || item.started_at || activeSession?.actual_start_at || item.actual_start_time || null;
    const actual = activeSession?.actual_start_at || item.actual_start_time || null;
    const ended = activeSession?.ended_at || item.ended_at || null;
    const duration = ended
      ? Math.floor((new Date(ended).getTime() - new Date(actual || started || ended).getTime()) / 1000)
      : actual
        ? Math.max(0, Math.floor((nowMs - new Date(actual).getTime()) / 1000))
        : null;
    return {
      title: sanitizeTitle(activeSession?.video_title || item.title) || "Livestream",
      thumbnail: activeSession?.thumbnail_url || item.thumbnail_url || "",
      creator: activeSession?.channel_name || item.creator,
      creatorIcon: activeSession?.channel_icon || item.creator_icon || null,
      started,
      actual,
      ended,
      duration,
      status: activeSession?.status || item.status,
      currentViewers: item.viewer_count ?? null,
    };
  }, [activeSession, item, nowMs]);

  if (!open || !item || !display) return null;

  const thumbStyle = !isCompact ? ({ width: "min(24rem, 42vw)" } as CSSProperties) : undefined;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalBackdrop} aria-hidden="true" />
        <div className={styles.modalSurface}>
          <button type="button" className={styles.closeX} onClick={onClose} aria-label="Close popup">
            ×
          </button>

          <div className={styles.hero}>
            <div className={styles.mediaColumn}>
              <div className={styles.thumbWrap} style={thumbStyle}>
                {display.thumbnail ? <img src={display.thumbnail} alt="" className={styles.thumb} /> : <div className={styles.thumbFallback} />}
              </div>

              <div className={styles.actions}>
                <Link href={youtubeUrl} target="_blank" rel="noreferrer" className={styles.actionButton}>
                  Open on YouTube
                </Link>
                {stockAsset ? (
                  <Link href={`/stocks/${encodeURIComponent(stockAsset.symbol)}`} className={styles.actionButton}>
                    Open stock page
                  </Link>
                ) : (
                  <button type="button" className={styles.actionButton} disabled>
                    Stock unavailable
                  </button>
                )}
                <button type="button" className={styles.actionButton} onClick={onClose}>
                  Close
                </button>
              </div>
            </div>

            <div className={styles.info}>
              <h2 className={styles.title}>{display.title}</h2>
              <div className={styles.channelRow}>
                {getIconUrl(display.creatorIcon) ? <img src={getIconUrl(display.creatorIcon) || ""} alt="" className={styles.channelIcon} /> : <div className={styles.channelIconFallback} />}
                <span className={styles.channelName}>{display.creator}</span>
              </div>
              <div className={styles.infoPanel}>
                <div className={styles.metaGrid}>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Started:</span>
                    <span>{fmtDate(display.started)}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Actual live start:</span>
                    <span>{fmtDate(display.actual)}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Ended:</span>
                    <span>{display.status === "ended" ? fmtDate(display.ended) : "—"}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Duration:</span>
                    <span>{fmtDurationSeconds(display.duration)}</span>
                  </div>
                  {display.status === "live" ? (
                    <div className={`${styles.metaRow} ${styles.metaRowFull} ${styles.liveWatching}`}>
                      <span className={styles.liveLabel}>LIVE</span>
                      <span className={styles.liveDot} aria-hidden="true" />
                      <span>{fmtInteger(display.currentViewers)} currently watching</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.chartSection}>
            <div className={styles.chartHeader}>
              <strong>Viewers over time</strong>
              <div className={styles.legend}>
                <span className={styles.legendItem} style={{ "--legend-color": mixHex(accentColor, "#d7dce5", 0.35) } as CSSProperties}>
                  Avg viewers
                </span>
                <span className={styles.legendItem} style={{ "--legend-color": accentColor } as CSSProperties}>
                  Max viewers
                </span>
              </div>
            </div>
            {loading ? (
              <div className={styles.chartLoading}>
                <div className={styles.chartSkeleton} />
              </div>
            ) : error ? (
              <div className={styles.chartEmpty}>Graph unavailable: {error}</div>
            ) : (
              <ViewerBucketsChart buckets={buckets} accentColor={accentColor} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
