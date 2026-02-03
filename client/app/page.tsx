"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

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

type TimeSeriesPoint = {
  time: string;
  subscriber_count: number | null;
  view_count: number | null;
  video_count: number | null;
  hidden_subscriber_count: boolean | null;
  last_upload_at: string | null;
  last_upload_video_id: string | null;
  last_live_at: string | null;
  last_live_video_id: string | null;
  country: string | null;
  scraped_at: string;
};

type OverviewRow = {
  channel: Channel;
  series: TimeSeriesPoint[];
};

type MetricKey = "subscriber_count" | "view_count" | "video_count";

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
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(90);
  const [metricByChannel, setMetricByChannel] = useState<Record<string, MetricKey>>({});

  const lastScrapedAt = useMemo(() => {
    if (!rows) return null;
    const times = rows
      .flatMap((r) => r.series.map((s) => s.scraped_at))
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
      const res = await fetch(`/api/overview/timeseries?days=${days}&limit=500`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OverviewRow[];
      setRows(data);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1 className="title">YouTube Dashboard</h1>
          <p className="subtitle">
            Data from TimescaleDB via Next.js proxy rewrites (<span className="muted">/api → gateway</span>)
          </p>
          <p className="subtitle">
            Last scraped: <span className="muted">{lastScrapedAt || "—"}</span>
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <a className="pill" href="/livestreams">
            Livestreams
          </a>
          <a className="pill" href="/analysis">
            4chan Alpha
          </a>
          <a className="pill" href="/add">
            Add channel
          </a>
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
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
            Make sure the API gateway is running and `client/next.config.ts` rewrites point to it.
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
            const series = r.series;
            const latest = series.length ? series[series.length - 1] : null;
            const metric = metricByChannel[c.youtube_channel_id] || "subscriber_count";
            const chartOption = buildChartOption(series, c.name, metric);
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

                <MetricSwitch
                  value={metric}
                  onChange={(next) =>
                    setMetricByChannel((prev) => ({ ...prev, [c.youtube_channel_id]: next }))
                  }
                />

                <div className="chartPanel">
                  {series.length ? (
                    <ReactECharts option={chartOption} style={{ height: "240px", width: "100%" }} />
                  ) : (
                    <div className="muted">No time series data yet.</div>
                  )}
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

function toNum(v: number | string | null | undefined) {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function metricMeta(metric: MetricKey) {
  switch (metric) {
    case "view_count":
      return { label: "Views", color: "#5cc8ff" };
    case "video_count":
      return { label: "Videos", color: "#f7b267" };
    default:
      return { label: "Subscribers", color: "#37d67a" };
  }
}

function buildChartOption(series: TimeSeriesPoint[], name: string, metric: MetricKey) {
  const { label, color } = metricMeta(metric);
  const points = series.map((s) => [new Date(s.time).getTime(), toNum(s[metric])]);

  return {
    backgroundColor: "transparent",
    animationDuration: 500,
    grid: { left: 48, right: 20, top: 16, bottom: 28 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" }
    },
    legend: { show: false },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: "rgba(231, 238, 252, 0.2)" } },
      axisLabel: { color: "rgba(231, 238, 252, 0.7)", margin: 12 },
      splitLine: { lineStyle: { color: "rgba(231, 238, 252, 0.06)" } }
    },
    yAxis: {
      type: "value",
      scale: true,
      min: (value: { min: number; max: number }) => {
        if (!Number.isFinite(value.min) || !Number.isFinite(value.max)) return 0;
        if (value.max === value.min) return value.min - 1;
        const pad = (value.max - value.min) * 0.04;
        return value.min - pad;
      },
      axisLine: { lineStyle: { color: "rgba(231, 238, 252, 0.2)" } },
      axisLabel: { color: "rgba(231, 238, 252, 0.7)" },
      splitLine: { lineStyle: { color: "rgba(231, 238, 252, 0.06)" } }
    },
    series: [
      {
        name: label,
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color },
        areaStyle: { color: `${color}22` },
        data: points
      }
    ],
    title: {
      text: name,
      left: 12,
      top: 4,
      textStyle: { color: "transparent" }
    }
  };
}

function MetricSwitch({ value, onChange }: { value: MetricKey; onChange: (next: MetricKey) => void }) {
  return (
    <div className="metricSwitch">
      <button className={value === "subscriber_count" ? "metricBtn active" : "metricBtn"} onClick={() => onChange("subscriber_count")}>
        Subscribers
      </button>
      <button className={value === "view_count" ? "metricBtn active" : "metricBtn"} onClick={() => onChange("view_count")}>
        Views
      </button>
      <button className={value === "video_count" ? "metricBtn active" : "metricBtn"} onClick={() => onChange("video_count")}>
        Videos
      </button>
    </div>
  );
}
