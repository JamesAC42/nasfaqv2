"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getChannelIconUrl } from "../lib/channelIcons";
import { LivestreamModal } from "./LivestreamModal";

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
};

type Payload = {
  live: Stream[];
  upcoming: Stream[];
};
const EMPTY_STREAMS: Stream[] = [];

function getVideoUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmtDurationSince(start: string | undefined | null, nowMs: number) {
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

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

type ViewerUpdate = {
  at: string;
  // Viewer websocket sends only deltas between full snapshots.
  live: Array<{
    video_id: string;
    concurrent_viewers?: number | null;
  }>;
};

type SnapshotUpdate = {
  type: "snapshot";
  at: string;
  live: Stream[];
  upcoming: Stream[];
};

type DiffUpdate = {
  type: "diff";
  at: string;
  liveAdded: Stream[];
  liveUpdated: Stream[];
  liveRemoved: string[];
  upcomingAdded: Stream[];
  upcomingUpdated: Stream[];
  upcomingRemoved: string[];
};

function mergeLiveUpdates(prev: Stream[], incoming: Array<Partial<Stream> & { video_id: string }>): Stream[] {
  // Viewer websocket updates are deltas; ignore updates if we don't yet have the full snapshot data.
  if (prev.length === 0) return prev;
  if (incoming.length === 0) return prev;

  const map = new Map<string, Stream>();
  for (const stream of prev) map.set(stream.video_id, stream);

  for (const delta of incoming) {
    const existing = map.get(delta.video_id);
    // Ignore deltas for unknown streams; snapshots are what introduce new streams.
    if (!existing) continue;
    map.set(delta.video_id, { ...existing, ...delta });
  }

  return Array.from(map.values());
}

export default function LivestreamsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<"closed" | "connecting" | "open">("closed");
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedStreamCache, setSelectedStreamCache] = useState<Stream | null>(null);

  // Initial load (snapshot will also arrive via WebSocket).
  useEffect(() => {
    setError(null);
    fetch("/api/livestreams", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Payload;
      })
      .then((json) => setData(json))
      .catch((e) => {
        setError(String((e as Error)?.message || e));
        setData(null);
      });
  }, []);

  // WebSocket: merge viewer updates into live list without refetching
  useEffect(() => {
    const wsUrl = getWsUrl();
    if (!wsUrl) return;

    let closed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: number | null = null;

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
            setData({ live: msg.live, upcoming: msg.upcoming });
            return;
          }

          if (msg.type === "diff") {
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

              const addOrUpdate = (target: Map<string, Stream>, arr: Stream[] | undefined) => {
                if (!arr) return;
                for (const s of arr) target.set(s.video_id, s);
              };

              addOrUpdate(liveById, msg.liveAdded);
              addOrUpdate(liveById, msg.liveUpdated);
              addOrUpdate(upcomingById, msg.upcomingAdded);
              addOrUpdate(upcomingById, msg.upcomingUpdated);

              return {
                live: Array.from(liveById.values()),
                upcoming: Array.from(upcomingById.values()),
              };
            });
            return;
          }

          // Viewer delta payloads do not include `type`, so treat any `msg.live` array as viewer-count deltas.
          if (!msg.live || !Array.isArray(msg.live)) return;
          setData((prev) => ({
            live: mergeLiveUpdates(prev?.live || [], msg.live as any),
            upcoming: prev?.upcoming || [],
          }));
        } catch {
          // ignore parse errors
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
  }, []);

  const live = useMemo(() => data?.live ?? EMPTY_STREAMS, [data]);
  const upcoming = useMemo(() => data?.upcoming ?? EMPTY_STREAMS, [data]);
  const upcomingSorted = useMemo(() => {
    const copy = [...upcoming];
    copy.sort((a, b) => {
      const atA = a.scheduled_start_time ? new Date(a.scheduled_start_time).getTime() : 0;
      const atB = b.scheduled_start_time ? new Date(b.scheduled_start_time).getTime() : 0;
      if (atA !== atB) return atA - atB; // asc
      return a.video_id.localeCompare(b.video_id);
    });
    return copy;
  }, [upcoming]);

  // Keep selected stream data in sync with live websocket updates.
  useEffect(() => {
    if (!selectedVideoId) return;
    const next = live.find((s) => s.video_id === selectedVideoId);
    if (next) setSelectedStreamCache(next);
  }, [live, selectedVideoId]);

  const selectedStream = useMemo(() => {
    if (!selectedVideoId) return null;
    const current = live.find((s) => s.video_id === selectedVideoId);
    if (current) return current;
    return selectedStreamCache?.video_id === selectedVideoId ? selectedStreamCache : null;
  }, [live, selectedVideoId, selectedStreamCache]);

  // Keep UI stable: sort live streams by viewer count descending.
  const liveSorted = useMemo(() => {
    const copy = [...live];
    copy.sort((a, b) => {
      const av = typeof a.concurrent_viewers === "number" ? a.concurrent_viewers : -1;
      const bv = typeof b.concurrent_viewers === "number" ? b.concurrent_viewers : -1;
      if (bv !== av) return bv - av; // desc

      const atA = a.actual_start_time ? new Date(a.actual_start_time).getTime() : 0;
      const atB = b.actual_start_time ? new Date(b.actual_start_time).getTime() : 0;
      if (atB !== atA) return atB - atA;

      return a.video_id.localeCompare(b.video_id);
    });
    return copy;
  }, [live]);

  const subtitle = useMemo(() => {
    const base = `${live.length} live · ${upcoming.length} upcoming`;
    return wsStatus !== "closed" ? `${base} · live viewer updates` : base;
  }, [live.length, upcoming.length, wsStatus]);

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

      <Section title="Live now" emptyText="No channels are live right now.">
        <div className="streamList">
          {liveSorted.map((s) => (
            <StreamRow key={s.video_id} s={s} kind="live" />
          ))}
        </div>
      </Section>

      <Section title="Upcoming" emptyText="No upcoming livestreams found.">
        <div className="streamList">
          {upcomingSorted.map((s) => (
            <StreamRow key={s.video_id} s={s} kind="upcoming" />
          ))}
        </div>
      </Section>

      <LivestreamModal
        open={Boolean(selectedStream)}
        onClose={() => {
          setSelectedVideoId(null);
          setSelectedStreamCache(null);
        }}
        stream={selectedStream}
      />
    </div>
  );

  function Section({ title, emptyText, children }: { title: string; emptyText: string; children: React.ReactNode }) {
    const isEmpty = title === "Live now" ? live.length === 0 : upcoming.length === 0;
    return (
      <div style={{ marginTop: "1.25rem" }}>
        <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.15rem", letterSpacing: "-0.01em" }}>{title}</h2>
        {isEmpty ? <div className="card muted">{emptyText}</div> : children}
      </div>
    );
  }

  function StreamRow({ s, kind }: { s: Stream; kind: "live" | "upcoming" }) {
    const timeText = kind === "upcoming" ? fmtDate(s.scheduled_start_time) : null;
    const liveViewers = kind === "live" && typeof s.concurrent_viewers === "number" ? s.concurrent_viewers : null;

    return (
      <button
        type="button"
        className="streamItem"
        onClick={() => {
          if (kind === "live") {
            setSelectedVideoId(s.video_id);
            setSelectedStreamCache(s);
          }
            else window.open(getVideoUrl(s.video_id), "_blank", "noreferrer");
        }}
      >
        <div className={kind === "live" ? "thumbWrap thumbWrapLive" : "thumbWrap"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="thumbImg" src={s.thumbnail_url} alt="" />
          {kind === "live" ? <span className="liveBadge">LIVE</span> : null}
        </div>
          <div className="streamInfo">
          <div className="streamTitle">{s.title}</div>
          <div className="channelRow">
            {getChannelIconUrl(s.channel_icon) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="channelIcon" src={getChannelIconUrl(s.channel_icon)!} alt="" loading="lazy" />
            ) : (
              <div className="channelIconFallback" />
            )}
            <div className="channelName">{s.channel_name}</div>
            {kind === "live" ? (
              <div style={{ marginLeft: "auto", color: "var(--muted)", fontWeight: 650, whiteSpace: "nowrap" }}>
                <LiveForText actualStartTime={s.actual_start_time} />
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
            ) : (
              <span>{timeText}</span>
            )}
          </div>
        </div>
      </button>
    );
  }

  function LiveForText({ actualStartTime }: { actualStartTime?: string | null }) {
    const [nowTickMs, setNowTickMs] = useState(() => Date.now());
    useEffect(() => {
      const id = window.setInterval(() => setNowTickMs(Date.now()), 1_000);
      return () => window.clearInterval(id);
    }, []);
    return <>{fmtDurationSince(actualStartTime, nowTickMs)}</>;
  }
}




