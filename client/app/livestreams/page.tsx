"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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

function fmtDurationSince(start?: string | null) {
  if (!start) return "—";
  const t = new Date(start).getTime();
  if (Number.isNaN(t)) return "—";
  const ms = Date.now() - t;
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export default function LivestreamsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const live = data?.live || [];
  const upcoming = data?.upcoming || [];

  const subtitle = useMemo(() => {
    return `${live.length} live · ${upcoming.length} upcoming`;
  }, [live.length, upcoming.length]);

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
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
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
          {live.map((s) => (
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
    const timeText = kind === "live" ? `Live for ${fmtDurationSince(s.actual_start_time)}` : fmtDate(s.scheduled_start_time);
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {s.channel_icon ? <img className="channelIcon" src={s.channel_icon} alt="" /> : <div className="channelIconFallback" />}
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


