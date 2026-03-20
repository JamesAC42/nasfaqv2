"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { getChannelIconUrl } from "../lib/channelIcons";
import { LivestreamModal, type ModalStream } from "./LivestreamModal";

const WS_PATH = "/api/livestreams/ws";

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

function getWsUrl(): string {
  const explicitBase =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_API_BASE
      ? toWsBase(process.env.NEXT_PUBLIC_WS_API_BASE)
      : "";
  const base =
    explicitBase || getProxyWsBase() || (typeof window !== "undefined" ? window.location.origin.replace(/^http/, "ws") : "");
  return base ? `${base}${WS_PATH}` : "";
}

type CurrentStream = {
  video_id: string;
  status: "live" | "upcoming";
  title: string;
  thumbnail_url: string;
  channel_name: string;
  channel_icon?: string | null;
  channel_color?: string | null;
  scheduled_start_time?: string | null;
  actual_start_time?: string | null;
  concurrent_viewers?: number | null;
  ui_concurrent_viewers?: number | null;
};

type PastStreamResponse = {
  video_id: string;
  status: "ended";
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

type PastStream = ModalStream;

type Payload = {
  live: CurrentStream[];
  upcoming: CurrentStream[];
};

type PastPayload = {
  page: number;
  week_start: string;
  week_end: string;
  has_older: boolean;
  streams: PastStreamResponse[];
};

const EMPTY_CURRENT_STREAMS: CurrentStream[] = [];
const EMPTY_PAST_STREAMS: PastStream[] = [];
const DEFAULT_LIVE_ACCENT = "#ff5c7a";

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function getVideoUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmtShortDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDurationSince(start: string | undefined | null, nowMs: number) {
  if (!start) return "—";
  const t = new Date(start).getTime();
  if (Number.isNaN(t)) return "—";
  const ms = nowMs - t;
  if (ms < 0) return "—";
  return fmtDurationSeconds(Math.floor(ms / 1000));
}

function fmtDurationSeconds(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.floor(seconds);
  const hh = Math.floor(whole / 3600);
  const mm = Math.floor((whole % 3600) / 60);
  const ss = whole % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function deriveDurationSeconds(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  return Math.floor((endMs - startMs) / 1000);
}

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

type ViewerUpdate = {
  at: string;
  live: Array<{
    video_id: string;
    concurrent_viewers?: number | null;
  }>;
};

type ViewerDelta = {
  video_id: string;
  concurrent_viewers?: number | null;
};

type SnapshotUpdate = {
  type: "snapshot";
  at: string;
  live: CurrentStream[];
  upcoming: CurrentStream[];
};

type DiffUpdate = {
  type: "diff";
  at: string;
  liveAdded: CurrentStream[];
  liveUpdated: CurrentStream[];
  liveRemoved: string[];
  upcomingAdded: CurrentStream[];
  upcomingUpdated: CurrentStream[];
  upcomingRemoved: string[];
};

function mergeLiveUpdates(prev: CurrentStream[], incoming: Array<Partial<CurrentStream> & { video_id: string }>): CurrentStream[] {
  if (prev.length === 0 || incoming.length === 0) return prev;

  const map = new Map<string, CurrentStream>();
  for (const stream of prev) map.set(stream.video_id, stream);

  for (const delta of incoming) {
    const existing = map.get(delta.video_id);
    if (!existing) continue;
    map.set(delta.video_id, { ...existing, ...delta });
  }

  return Array.from(map.values());
}

function withUiViewerCounts(streams: CurrentStream[]): CurrentStream[] {
  return streams.map((stream) => ({
    ...stream,
    ui_concurrent_viewers: typeof stream.concurrent_viewers === "number" ? stream.concurrent_viewers : null,
  }));
}

function getDisplayViewerCount(stream: CurrentStream): number | null {
  if (typeof stream.ui_concurrent_viewers === "number") return stream.ui_concurrent_viewers;
  if (typeof stream.concurrent_viewers === "number") return stream.concurrent_viewers;
  return null;
}

function normalizePastStream(stream: PastStreamResponse): PastStream {
  return {
    video_id: stream.video_id,
    status: stream.status,
    title: stream.video_title || "Livestream",
    thumbnail_url: stream.thumbnail_url || "",
    channel_name: stream.channel_name,
    channel_icon: stream.channel_icon,
    channel_color: stream.channel_color,
    scheduled_start_time: stream.scheduled_start_at,
    actual_start_time: stream.actual_start_at,
    ended_at: stream.ended_at,
    duration_seconds: toNum(stream.duration_seconds) ?? deriveDurationSeconds(stream.actual_start_at, stream.ended_at),
    total_views: toNum(stream.total_views),
    avg_concurrent_viewers: toNum(stream.avg_concurrent_viewers),
    max_concurrent_viewers: toNum(stream.max_concurrent_viewers),
  };
}

export default function LivestreamsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<"closed" | "connecting" | "open">("closed");
  const [selected, setSelected] = useState<{ mode: "current" | "past"; stream: ModalStream } | null>(null);
  const [selectedLiveCache, setSelectedLiveCache] = useState<CurrentStream | null>(null);
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());
  const [viewMode, setViewMode] = useState<"current" | "past">("current");
  const [pastPage, setPastPage] = useState(0);
  const [pastData, setPastData] = useState<PastPayload | null>(null);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);
  const initialLoading = !data && !error;

  useEffect(() => {
    const id = window.setInterval(() => setNowTickMs(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const pendingViewerDeltasRef = useRef<ViewerDelta[]>([]);
  const viewerFlushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setError(null);
    fetch("/api/livestreams", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Payload;
      })
      .then((json) =>
        startTransition(() =>
          setData({
            live: withUiViewerCounts(json.live || []),
            upcoming: json.upcoming || [],
          })
        )
      )
      .catch((e) => {
        setError(String((e as Error)?.message || e));
        setData(null);
      });
  }, []);

  useEffect(() => {
    if (viewMode !== "past") return;
    let cancelled = false;
    setPastLoading(true);
    setPastError(null);

    fetch(`/api/livestreams/history?page=${pastPage}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as PastPayload;
      })
      .then((json) => {
        if (cancelled) return;
        startTransition(() => setPastData(json));
      })
      .catch((e) => {
        if (cancelled) return;
        setPastError(String((e as Error)?.message || e));
        setPastData(null);
      })
      .finally(() => {
        if (!cancelled) setPastLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pastPage, viewMode]);

  useEffect(() => {
    const wsUrl = getWsUrl();
    if (!wsUrl) return;

    let closed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: number | null = null;

    const flushViewerDeltas = () => {
      if (closed) return;
      viewerFlushTimerRef.current = null;

      const deltas = pendingViewerDeltasRef.current;
      if (!deltas.length) return;
      pendingViewerDeltasRef.current = [];

      startTransition(() =>
        setData((prev) => ({
          live: mergeLiveUpdates(prev?.live || [], deltas),
          upcoming: prev?.upcoming || [],
        }))
      );
    };

    const scheduleViewerFlush = () => {
      if (closed || viewerFlushTimerRef.current != null) return;
      viewerFlushTimerRef.current = window.setTimeout(flushViewerDeltas, 250);
    };

    const connect = () => {
      if (closed) return;
      attempt++;
      setWsStatus("connecting");
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        attempt = 0;
        setWsStatus("open");
      };
      ws.onclose = () => {
        setWsStatus("closed");
        if (closed) return;
        const delay = Math.min(15_000, 1_000 * Math.max(1, attempt));
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        setWsStatus("closed");
        try {
          ws?.close();
        } catch {}
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Partial<SnapshotUpdate> & Partial<DiffUpdate> & Partial<ViewerUpdate>;

          if (msg.type === "snapshot") {
            if (!Array.isArray(msg.live) || !Array.isArray(msg.upcoming)) return;
            const liveSnapshot = msg.live as CurrentStream[];
            const upcomingSnapshot = msg.upcoming as CurrentStream[];
            pendingViewerDeltasRef.current = [];
            if (viewerFlushTimerRef.current != null) window.clearTimeout(viewerFlushTimerRef.current);
            viewerFlushTimerRef.current = null;
            startTransition(() =>
              setData({
                live: withUiViewerCounts(liveSnapshot),
                upcoming: upcomingSnapshot,
              })
            );
            return;
          }

          if (msg.type === "diff") {
            pendingViewerDeltasRef.current = [];
            if (viewerFlushTimerRef.current != null) window.clearTimeout(viewerFlushTimerRef.current);
            viewerFlushTimerRef.current = null;
            startTransition(() =>
              setData((prev) => {
                if (!prev) return prev;

                const liveById = new Map(prev.live.map((s) => [s.video_id, s]));
                const upcomingById = new Map(prev.upcoming.map((s) => [s.video_id, s]));

                if (Array.isArray(msg.liveRemoved)) {
                  for (const id of msg.liveRemoved) liveById.delete(id);
                }
                if (Array.isArray(msg.upcomingRemoved)) {
                  for (const id of msg.upcomingRemoved) upcomingById.delete(id);
                }

                const addOrUpdate = (target: Map<string, CurrentStream>, arr: CurrentStream[] | undefined) => {
                  if (!arr) return;
                  for (const s of arr) target.set(s.video_id, s);
                };

                addOrUpdate(liveById, msg.liveAdded);
                addOrUpdate(
                  liveById,
                  msg.liveUpdated?.map((stream) => ({
                    ...stream,
                    ui_concurrent_viewers: typeof stream.concurrent_viewers === "number" ? stream.concurrent_viewers : null,
                  }))
                );
                addOrUpdate(upcomingById, msg.upcomingAdded);
                addOrUpdate(upcomingById, msg.upcomingUpdated);

                return {
                  live: Array.from(liveById.values()).map((stream) => ({
                    ...stream,
                    ui_concurrent_viewers:
                      typeof stream.concurrent_viewers === "number"
                        ? stream.concurrent_viewers
                        : stream.ui_concurrent_viewers ?? null,
                  })),
                  upcoming: Array.from(upcomingById.values()),
                };
              })
            );
            return;
          }

          if (!msg.live || !Array.isArray(msg.live)) return;
          pendingViewerDeltasRef.current.push(...(msg.live as ViewerDelta[]));
          scheduleViewerFlush();
        } catch {
          // ignore parse errors
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (viewerFlushTimerRef.current != null) window.clearTimeout(viewerFlushTimerRef.current);
      viewerFlushTimerRef.current = null;
      pendingViewerDeltasRef.current = [];
      try {
        ws?.close();
      } catch {}
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setData((prev) => {
        if (!prev?.live?.length) return prev;

        let changed = false;
        const live = prev.live.map((stream) => {
          const base = typeof stream.concurrent_viewers === "number" ? stream.concurrent_viewers : null;
          if (base == null) return stream;

          const jitterRoll = Math.random();
          const nextUi = jitterRoll < 0.28 ? Math.max(0, base - 1) : jitterRoll > 0.72 ? base + 1 : base;

          if (nextUi === stream.ui_concurrent_viewers) return stream;
          changed = true;
          return { ...stream, ui_concurrent_viewers: nextUi };
        });

        return changed ? { ...prev, live } : prev;
      });
    }, 1800);

    return () => window.clearInterval(id);
  }, []);

  const live = useMemo(() => data?.live ?? EMPTY_CURRENT_STREAMS, [data]);
  const upcoming = useMemo(() => data?.upcoming ?? EMPTY_CURRENT_STREAMS, [data]);
  const upcomingSorted = useMemo(() => {
    const copy = [...upcoming];
    copy.sort((a, b) => {
      const atA = a.scheduled_start_time ? new Date(a.scheduled_start_time).getTime() : 0;
      const atB = b.scheduled_start_time ? new Date(b.scheduled_start_time).getTime() : 0;
      if (atA !== atB) return atA - atB;
      return a.video_id.localeCompare(b.video_id);
    });
    return copy;
  }, [upcoming]);

  useEffect(() => {
    if (selected?.mode !== "current" || !selected.stream.video_id) return;
    const next = live.find((s) => s.video_id === selected.stream.video_id);
    if (next) setSelectedLiveCache(next);
  }, [live, selected]);

  const selectedStream = useMemo(() => {
    if (!selected) return null;
    if (selected.mode === "past") return selected.stream;
    const current = live.find((s) => s.video_id === selected.stream.video_id);
    if (current) return current;
    return selectedLiveCache?.video_id === selected.stream.video_id ? selectedLiveCache : selected.stream;
  }, [live, selected, selectedLiveCache]);

  const liveSorted = useMemo(() => {
    const copy = [...live];
    copy.sort((a, b) => {
      const av = typeof a.concurrent_viewers === "number" ? a.concurrent_viewers : -1;
      const bv = typeof b.concurrent_viewers === "number" ? b.concurrent_viewers : -1;
      if (bv !== av) return bv - av;

      const atA = a.actual_start_time ? new Date(a.actual_start_time).getTime() : 0;
      const atB = b.actual_start_time ? new Date(b.actual_start_time).getTime() : 0;
      if (atB !== atA) return atB - atA;

      return a.video_id.localeCompare(b.video_id);
    });
    return copy;
  }, [live]);

  const pastStreams = useMemo(() => {
    if (!pastData?.streams?.length) return EMPTY_PAST_STREAMS;
    return pastData.streams.map(normalizePastStream);
  }, [pastData]);

  const subtitle = useMemo(() => {
    const base = `${live.length} live · ${upcoming.length} upcoming`;
    return wsStatus === "closed" ? `${base} · reconnecting` : base;
  }, [live.length, upcoming.length, wsStatus]);
  const weekLabel = useMemo(() => {
    if (!pastData) return "";
    return `${fmtShortDate(pastData.week_start)} to ${fmtShortDate(pastData.week_end)}`;
  }, [pastData]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="title">Livestreams</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <Link className="pill" href="/">
            Dashboard
          </Link>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p className="name">Failed to load</p>
          <p className="muted">{error}</p>
        </div>
      ) : null}

      <div className="sectionToolbar">
        <div className="segmentedControl" role="tablist" aria-label="Livestream mode">
          <button
            type="button"
            className={`segmentedButton${viewMode === "current" ? " active" : ""}`}
            onClick={() => {
              setViewMode("current");
              setSelected(null);
            }}
          >
            Current
          </button>
          <button
            type="button"
            className={`segmentedButton${viewMode === "past" ? " active" : ""}`}
            onClick={() => {
              setViewMode("past");
              setPastPage(0);
              setSelected(null);
            }}
          >
            Past
          </button>
        </div>
      </div>

      {viewMode === "current" ? (
        <>
          <Section title="Live now" emptyText="No channels are live right now." isEmpty={!initialLoading && live.length === 0}>
            {initialLoading ? (
              <StreamSkeletonList count={3} />
            ) : (
              <div className="streamList">
                {liveSorted.map((s) => (
                  <StreamRow key={s.video_id} stream={s} kind="live" nowTickMs={nowTickMs} onOpenCurrent={openCurrentStream} />
                ))}
              </div>
            )}
          </Section>

          <Section title="Upcoming" emptyText="No upcoming livestreams found." isEmpty={!initialLoading && upcoming.length === 0}>
            {initialLoading ? (
              <StreamSkeletonList count={3} />
            ) : (
              <div className="streamList">
                {upcomingSorted.map((s) => (
                  <StreamRow key={s.video_id} stream={s} kind="upcoming" nowTickMs={nowTickMs} onOpenCurrent={openCurrentStream} />
                ))}
              </div>
            )}
          </Section>
        </>
      ) : (
        <Section
          title="Past week"
          emptyText="No ended livestreams found for this week."
          isEmpty={!pastLoading && !pastError && pastStreams.length === 0}
        >
          <div className="historySectionHead">
            <div className="muted">{weekLabel || "Loading week…"}</div>
            <div className="historyPager">
              <button
                type="button"
                className="pill pillButton"
                onClick={() => setPastPage((page) => Math.max(0, page - 1))}
                disabled={pastPage === 0 || pastLoading}
              >
                Newer
              </button>
              <button
                type="button"
                className="pill pillButton"
                onClick={() => setPastPage((page) => page + 1)}
                disabled={!pastData?.has_older || pastLoading}
              >
                Older
              </button>
            </div>
          </div>

          {pastError ? (
            <div className="card">
              <p className="name">Failed to load past livestreams</p>
              <p className="muted">{pastError}</p>
            </div>
          ) : null}

          {pastLoading ? (
            <div className="card">
              <p className="name">Loading…</p>
            </div>
          ) : pastStreams.length > 0 ? (
            <div className="streamList">
              {pastStreams.map((s) => (
                <StreamRow key={s.video_id} stream={s} kind="past" nowTickMs={nowTickMs} onOpenPast={openPastStream} />
              ))}
            </div>
          ) : null}
        </Section>
      )}

      <LivestreamModal
        open={Boolean(selectedStream && selected)}
        onClose={() => {
          setSelected(null);
          setSelectedLiveCache(null);
        }}
        stream={selectedStream}
        mode={selected?.mode ?? "current"}
      />
    </div>
  );

  function openCurrentStream(stream: CurrentStream) {
    setSelected({ mode: "current", stream });
    setSelectedLiveCache(stream);
  }

  function openPastStream(stream: PastStream) {
    setSelected({ mode: "past", stream });
  }
}

function Section({
  title,
  emptyText,
  isEmpty,
  children,
}: {
  title: string;
  emptyText: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: "1.25rem" }}>
      <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.15rem", letterSpacing: "-0.01em" }}>{title}</h2>
      {isEmpty ? <div className="card muted">{emptyText}</div> : children}
    </div>
  );
}

function StreamRow({
  stream,
  kind,
  nowTickMs,
  onOpenCurrent,
  onOpenPast,
}: {
  stream: CurrentStream | PastStream;
  kind: "live" | "upcoming" | "past";
  nowTickMs: number;
  onOpenCurrent?: (stream: CurrentStream) => void;
  onOpenPast?: (stream: PastStream) => void;
}) {
  const timeText = kind === "upcoming" ? fmtDate(stream.scheduled_start_time) : null;
  const liveViewers = kind === "live" ? getDisplayViewerCount(stream as CurrentStream) : null;
  const pastStream = kind === "past" ? (stream as PastStream) : null;
  const accentColor = normalizeHexColor(stream.channel_color) || DEFAULT_LIVE_ACCENT;
  const streamStyle = { "--stream-accent": accentColor } as CSSProperties;

  return (
    <button
      type="button"
      className="streamItem"
      style={streamStyle}
      onClick={() => {
        if (kind === "live") {
          onOpenCurrent?.(stream as CurrentStream);
          return;
        }
        if (kind === "past") {
          onOpenPast?.(stream as PastStream);
          return;
        }
        window.open(getVideoUrl(stream.video_id), "_blank", "noreferrer");
      }}
    >
      <div className={kind === "live" ? "thumbWrap thumbWrapLive" : "thumbWrap"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="thumbImg" src={stream.thumbnail_url} alt="" />
        {kind === "live" ? <span className="liveBadge">LIVE</span> : null}
      </div>
      <div className="streamInfo">
        <div className="streamTitle">{stream.title}</div>
        <div className="channelRow">
          {getChannelIconUrl(stream.channel_icon) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="channelIcon" src={getChannelIconUrl(stream.channel_icon)!} alt="" loading="lazy" />
          ) : (
            <div className="channelIconFallback" />
          )}
          <div className="channelName">{stream.channel_name}</div>
          {kind === "live" ? (
            <div style={{ marginLeft: "auto", color: "var(--muted)", fontWeight: 650, whiteSpace: "nowrap" }}>
              <LiveForText actualStartTime={stream.actual_start_time} nowTickMs={nowTickMs} />
            </div>
          ) : null}
        </div>
        <div className="streamMeta">
          {kind === "live" ? (
            liveViewers == null ? null : (
              <div className="streamMetaWatchers">
                <div className="watchersNumber">{nf.format(liveViewers)}</div>
                <div className="watchersLabel">
                  <span>watching</span>
                  <span className="recordingDot recordingDotAnimating" aria-hidden="true" />
                </div>
              </div>
            )
          ) : kind === "upcoming" ? (
            <span>{timeText}</span>
          ) : (
            <div className="pastStatsGrid">
              <div className="pastStat">
                <span className="pastStatLabel">Views at end</span>
                <span className="pastStatValue">{fmtNullableNumber(pastStream?.total_views)}</span>
              </div>
              <div className="pastStat">
                <span className="pastStatLabel">Avg</span>
                <span className="pastStatValue">{fmtNullableNumber(pastStream?.avg_concurrent_viewers)}</span>
              </div>
              <div className="pastStat">
                <span className="pastStatLabel">Max</span>
                <span className="pastStatValue">{fmtNullableNumber(pastStream?.max_concurrent_viewers)}</span>
              </div>
              <div className="pastStat">
                <span className="pastStatLabel">Duration</span>
                <span className="pastStatValue">
                  {fmtDurationSeconds(
                    pastStream?.duration_seconds ?? deriveDurationSeconds(pastStream?.actual_start_time, pastStream?.ended_at)
                  )}
                </span>
              </div>
              <div className="pastStat pastStatWide">
                <span className="pastStatLabel">Started</span>
                <span className="pastStatValue">{fmtDate(pastStream?.actual_start_time)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function LiveForText({ actualStartTime, nowTickMs }: { actualStartTime?: string | null; nowTickMs: number }) {
  return <>{fmtDurationSince(actualStartTime, nowTickMs)}</>;
}

function fmtNullableNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return nf.format(value);
}

function StreamSkeletonList({ count }: { count: number }) {
  return (
    <div className="streamList" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="streamItem streamItemSkeleton">
          <div className="thumbWrap skeletonBlock" />
          <div className="streamInfo">
            <div className="streamTitle skeletonLine skeletonLineTitle" />
            <div className="channelRow">
              <div className="channelIconFallback skeletonBlock" />
              <div className="channelName skeletonLine skeletonLineShort" />
            </div>
            <div className="streamMeta">
              <div className="skeletonLine skeletonLineMedium" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
