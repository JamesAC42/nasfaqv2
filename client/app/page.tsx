"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Channel = {
  youtube_channel_id: string;
  name: string;
  symbol: string | null;
  icon: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  youtube_channel_url?: string;
};

type LatestPoint = {
  time: string;
  subscriber_count: number | null;
  view_count: number | null;
  video_count: number | null;
  hidden_subscriber_count: boolean | null;
  last_upload_at: string | null;
  last_upload_video_id: string | null;
  last_live_at: string | null;
  last_live_video_id: string | null;
  last_upload_url: string | null;
  last_live_url: string | null;
  country: string | null;
  scraped_at: string;
};

type OverviewLatestRow = {
  channel: Channel;
  latest: LatestPoint | null;
};

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function fmtNum(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return nf.format(v);
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function Home() {
  const [rows, setRows] = useState<OverviewLatestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const lastScrapedAt = useMemo(() => {
    if (!rows) return null;
    const times = rows
      .map((r) => r.latest?.scraped_at || null)
      .filter((x): x is string => Boolean(x))
      .map((s) => new Date(s).getTime())
      .filter((t) => !Number.isNaN(t));
    if (times.length === 0) return null;
    return new Date(Math.max(...times)).toLocaleString();
  }, [rows]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/overview/latest", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OverviewLatestRow[];
      setRows(data);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="title">YouTube Dashboard</h1>
          <p className="subtitle">Current latest channel numbers from API gateway</p>
          <p className="subtitle">
            Last scraped: <span className="muted">{lastScrapedAt || "—"}</span>
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <Link className="pill" href="/livestreams">
            Livestreams
          </Link>
          <Link className="pill" href="/analysis">
            4chan Alpha
          </Link>
          <Link className="pill" href="/add">
            Add channel
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
          <p className="muted">
            Make sure the API gateway is running and `client/next.config.ts` API mode is configured correctly.
          </p>
        </div>
      ) : null}

      {!rows && !error ? (
        <div className="card">
          <p className="name">Loading…</p>
        </div>
      ) : null}

      {rows ? (
        <div className="chartGrid">
          {rows.map((r) => {
            const c = r.channel;
            const latest = r.latest;
            return (
              <div key={c.youtube_channel_id} className="chartCard">
                <div className="cardHeader">
                  <div>
                    <p className="name">{c.name}</p>
                    <div className="meta">
                      <span>{c.symbol || "—"}</span>
                      <span>·</span>
                      <span>{c.youtube_channel_id}</span>
                    </div>
                  </div>
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.icon}
                      alt=""
                      style={{ width: "2.5rem", height: "2.5rem", borderRadius: "0.75rem", objectFit: "cover" }}
                    />
                  ) : null}
                </div>

                {latest ? (
                  <>
                    <div className="kv">
                      <div className="k">Latest</div>
                      <div className="v">{new Date(latest.time).toLocaleDateString()}</div>

                      <div className="k">Subscribers</div>
                      <div className="v">{fmtNum(latest.subscriber_count)}</div>

                      <div className="k">Views</div>
                      <div className="v">{fmtNum(latest.view_count)}</div>

                      <div className="k">Videos</div>
                      <div className="v">{fmtNum(latest.video_count)}</div>

                      <div className="k">Last upload</div>
                      <div className="v">{fmtDate(latest.last_upload_at)}</div>

                      <div className="k">Last live</div>
                      <div className="v">{fmtDate(latest.last_live_at)}</div>
                    </div>

                    <div className="links">
                      <a className="pill" href={`https://www.youtube.com/channel/${c.youtube_channel_id}`} target="_blank" rel="noreferrer">
                        Channel
                      </a>
                      {latest.last_upload_video_id ? (
                        <a className="pill" href={`https://www.youtube.com/watch?v=${latest.last_upload_video_id}`} target="_blank" rel="noreferrer">
                          Last upload
                        </a>
                      ) : null}
                      {latest.last_live_video_id ? (
                        <a className="pill" href={`https://www.youtube.com/watch?v=${latest.last_live_video_id}`} target="_blank" rel="noreferrer">
                          Last live
                        </a>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="muted">No stats scraped yet for this channel.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
