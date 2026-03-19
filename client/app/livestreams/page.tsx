"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChannelIconUrl } from "../lib/channelIcons";

const WS_PATH = "/api/livestreams/ws";
function getWsUrl(): string {
  const base =
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_API_BASE
      ? process.env.NEXT_PUBLIC_WS_API_BASE
      : typeof window !== "undefined"
        ? window.location.origin.replace(/^http/, "ws")
        : "";
  return base ? `${base}${WS_PATH}` : "";
}

type Stream = {
  video_id: string;
  video_url: string;
  status: "live" | "upcoming";
  title: string;
  thumbnail_url: string;
  channel_id: string;
  channel_name: string;
  channel_icon?: string | null;
  scheduled_start_time?: string | null;
  actual_start_time?: string | null;
  concurrent_viewers?: number | null;
  updated_at: string;
};

type Payload = {
  live: Stream[];
  upcoming: Stream[];
};

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
  live: Stream[];
};

export default function LivestreamsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wsStatus, setWsStatus] = useState<"closed" | "connecting" | "open">("closed");
  const dataRef = useRef<Payload | null>(null);
  dataRef.current = data;
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/livestreams", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Payload;
      setData(json);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // WebSocket: merge viewer updates into live list without refetching
  useEffect(() => {
    const wsUrl = getWsUrl();
    if (!wsUrl) return;

    setWsStatus("connecting");
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setWsStatus("open");
    ws.onclose = () => setWsStatus("closed");
    ws.onerror = () => setWsStatus("closed");

    ws.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data as string) as ViewerUpdate;
        if (!update.live || !Array.isArray(update.live)) return;

        setData((prev) => {
          if (!prev) return prev;
          return { ...prev, live: update.live };
        });
      } catch {
        // ignore parse errors
      }
    };

    return () => ws.close();
  }, []);

  const live = data?.live || [];
  const upcoming = data?.upcoming || [];

  // Increment "Live for" timers efficiently (only when there are live streams).
  useEffect(() => {
    if (live.length === 0) return;
    const id = window.setInterval(() => setNowTickMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [live.length]);

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

      const uA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const uB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      if (uB !== uA) return uB - uA;

      return a.video_id.localeCompare(b.video_id);
    });
    return copy;
  }, [live]);

  const subtitle = useMemo(() => {
    const base = `${live.length} live · ${upcoming.length} upcoming`;
    return wsStatus === "open" ? `${base} · live viewer updates` : base;
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
            <StreamRow key={`${s.channel_id}:${s.video_id}`} s={s} kind="live" />
          ))}
        </div>
      </Section>

      <Section title="Upcoming" emptyText="No upcoming livestreams found.">
        <div className="streamList">
          {upcoming.map((s) => (
            <StreamRow key={`${s.channel_id}:${s.video_id}`} s={s} kind="upcoming" />
          ))}
        </div>
      </Section>
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
    const timeText =
      kind === "live" ? `Live for ${fmtDurationSince(s.actual_start_time, nowTickMs)}` : fmtDate(s.scheduled_start_time);
    const viewers =
      kind === "live" && typeof s.concurrent_viewers === "number" ? `${nf.format(s.concurrent_viewers)} watching` : null;

    return (
      <a className="streamItem" href={s.video_url} target="_blank" rel="noreferrer">
        <div className="thumbWrap">
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
          </div>
          <div className="streamMeta">
            <span>{timeText}</span>
            {viewers ? (
              <>
                <span className="dot">·</span>
                <span>{viewers}</span>
              </>
            ) : null}
          </div>
        </div>
      </a>
    );
  }
}




