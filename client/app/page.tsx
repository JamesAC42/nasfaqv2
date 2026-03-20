"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getChannelIconUrl } from "./lib/channelIcons";

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

type HoloNewsItem = {
  headline: string;
  characters: string[];
  rank: number | null;
  thumbnail_s3_key: string | null;
  thumbnail_url: string | null;
};

type HoloNewsPayload = {
  thread_id: number | null;
  source_post: number | null;
  updated_at: string | null;
  items: HoloNewsItem[];
};

type MetricKey = "subscriber_count" | "view_count" | "video_count";

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const marketDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  year: "numeric",
});
const marketDayShortFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
});

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

function fmtMarketDay(v: string | number | Date | null | undefined) {
  if (v === null || v === undefined) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return marketDayFormatter.format(d);
}

function fmtMarketDayShort(v: string | number | Date | null | undefined) {
  if (v === null || v === undefined) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return marketDayShortFormatter.format(d);
}

function splitHeadline(headline: string) {
  const trimmed = headline.trim();
  if (!trimmed) return { title: "", subhead: null as string | null };

  const match = trimmed.match(/^(.+?[.!?])(?:\s+)(.+)$/);
  if (!match) {
    return { title: trimmed, subhead: null as string | null };
  }

  return {
    title: match[1].trim(),
    subhead: match[2].trim() || null,
  };
}

export default function Home() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [holoNews, setHoloNews] = useState<HoloNewsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [holoNewsError, setHoloNewsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(90);
  const [metricByChannel, setMetricByChannel] = useState<Record<string, MetricKey>>({});
  const showCharts = searchParams.has("charts");

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
    setHoloNewsError(null);
    try {
      const [timeseriesResult, holoNewsResult] = await Promise.allSettled([
        fetch(`/api/overview/timeseries?days=${days}&limit=500`, { cache: "no-store" }),
        fetch(`/api/overview/holonews`, { cache: "no-store" }),
      ]);

      if (timeseriesResult.status === "rejected") {
        throw timeseriesResult.reason;
      }

      if (!timeseriesResult.value.ok) {
        throw new Error(`HTTP ${timeseriesResult.value.status}`);
      }

      const data = (await timeseriesResult.value.json()) as OverviewRow[];
      setRows(data);

      if (holoNewsResult.status === "rejected") {
        setHoloNews(null);
        setHoloNewsError(String((holoNewsResult.reason as Error)?.message || holoNewsResult.reason));
      } else if (!holoNewsResult.value.ok) {
        setHoloNews(null);
        setHoloNewsError(`HoloNews HTTP ${holoNewsResult.value.status}`);
      } else {
        const holoNewsData = (await holoNewsResult.value.json()) as HoloNewsPayload;
        setHoloNews(holoNewsData);
      }
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

  const leadStory = holoNews?.items.find((item) => item.rank === 1) ?? null;
  const secondaryStories = holoNews?.items.filter((item) => item.rank === 2 || item.rank === 3) ?? [];
  const otherStories = holoNews?.items.filter((item) => item.rank !== 1 && item.rank !== 2 && item.rank !== 3) ?? [];

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
          <Link className="pill" href="/add">
            Manage Channels
          </Link>
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

      <section className="holonewsSection">
        <div className="sectionHead">
          <div>
            <h2 className="sectionTitle">HoloNews</h2>
            <p className="subtitle">
              Latest scraped /vt/ roundup. Ranked items with thumbnails appear first.
            </p>
            <p className="subtitle">
              Updated: <span className="muted">{fmtDate(holoNews?.updated_at)}</span>
            </p>
          </div>
        </div>

        {holoNewsError ? (
          <div className="card">
            <p className="name">Failed to load HoloNews</p>
            <p className="muted">{holoNewsError}</p>
          </div>
        ) : null}

        {!holoNews && !holoNewsError ? (
          <div className="card">
            <p className="name">Loading HoloNews…</p>
          </div>
        ) : null}

        {holoNews && holoNews.items.length > 0 ? (
          <div className="holonewsLayout">
            <div className="holonewsMainColumn">
              {leadStory ? (
                <article className="holonewsLeadCard">
                  {leadStory.thumbnail_url ? (
                    <div className="holonewsThumbWrap holonewsThumbWrapLead">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="holonewsThumb" src={leadStory.thumbnail_url} alt={leadStory.headline} loading="lazy" />
                      <span className="holonewsRank">#1</span>
                    </div>
                  ) : null}
                    <div className="holonewsLeadBody">
                      <span className="holonewsKicker">Lead Story</span>
                      <HeadlineBlock headline={leadStory.headline} titleClassName="holonewsHeadline holonewsHeadlineLead" subheadClassName="holonewsSubhead holonewsSubheadLead" />
                      {leadStory.characters.length > 0 ? <p className="holonewsCharacters">{leadStory.characters.join(" • ")}</p> : null}
                    </div>
                  </article>
              ) : null}

              {secondaryStories.length > 0 ? (
                <div className="holonewsSecondaryRow">
                  {secondaryStories.map((item) => (
                    <article key={`${item.headline}-${item.rank ?? "secondary"}`} className="holonewsCard holonewsCardFeatured">
                      {item.thumbnail_url ? (
                        <div className="holonewsThumbWrap">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img className="holonewsThumb" src={item.thumbnail_url} alt={item.headline} loading="lazy" />
                          {item.rank ? <span className="holonewsRank">#{item.rank}</span> : null}
                        </div>
                      ) : null}
                      <div className="holonewsCardMeta">
                        <span className="holonewsKicker">Featured</span>
                      </div>
                      <HeadlineBlock headline={item.headline} titleClassName="holonewsHeadline" subheadClassName="holonewsSubhead" />
                      {item.characters.length > 0 ? <p className="holonewsCharacters">{item.characters.join(" • ")}</p> : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </div>

            {otherStories.length > 0 ? (
              <aside className="holonewsSidebar">
                <div className="holonewsSidebarHeader">
                  <span className="holonewsKicker">More Headlines</span>
                </div>
                <div className="holonewsList">
                  {otherStories.map((item, index) => (
                    <article key={`${item.headline}-${index}`} className="holonewsListItem">
                      <HeadlineBlock headline={item.headline} titleClassName="holonewsListHeadline" subheadClassName="holonewsListSubhead" />
                      {item.characters.length > 0 ? <p className="holonewsListCharacters">{item.characters.join(" • ")}</p> : null}
                    </article>
                  ))}
                </div>
              </aside>
            ) : null}
          </div>
        ) : null}

        {holoNews && holoNews.items.length === 0 ? (
          <div className="card">
            <p className="name">No HoloNews headlines yet.</p>
          </div>
        ) : null}
      </section>

      {!rows && !error ? (
        <div className="card">
          <p className="name">Loading…</p>
        </div>
      ) : null}

      {rows ? (
        <>
          <div className="chartGrid">
            {rows.map((r) => {
              const c = r.channel;
              const series = r.series;
              const latest = series.length ? series[series.length - 1] : null;
              const metric = metricByChannel[c.youtube_channel_id] || "subscriber_count";
              const chartOption = showCharts ? buildChartOption(series, metric) : null;
              return (
                <div key={c.youtube_channel_id} className="chartCard">
                  <div className="cardHeader">
                    <div>
                      <p className="name">
                        {c.name}
                        {formatTicker(c.symbol) ? ` · ${formatTicker(c.symbol)}` : ""}
                      </p>
                      <div className="meta">
                        <span>{c.youtube_channel_id}</span>
                      </div>
                    </div>
                    {getChannelIconUrl(c.icon) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getChannelIconUrl(c.icon)!}
                        alt=""
                        style={{ width: "2.5rem", height: "2.5rem", borderRadius: "0.75rem", objectFit: "contain" }}
                        loading="lazy"
                      />
                    ) : null}
                  </div>

                  {showCharts ? (
                    <>
                      <MetricSwitch
                        value={metric}
                        onChange={(next) => setMetricByChannel((prev) => ({ ...prev, [c.youtube_channel_id]: next }))}
                      />

                      <div className="chartPanel">
                        {series.length && chartOption ? (
                          <ReactECharts option={chartOption} style={{ height: "15rem", width: "100%" }} />
                        ) : (
                          <div className="muted">No time series data yet.</div>
                        )}
                      </div>
                    </>
                  ) : null}

                  {latest ? (
                    <>
                      <div className="kv">
                        <div className="k">Latest</div>
                        <div className="v">{fmtMarketDay(latest.time)}</div>

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
        </>
      ) : null}
    </div>
  );
}

function HeadlineBlock({
  headline,
  titleClassName,
  subheadClassName,
}: {
  headline: string;
  titleClassName: string;
  subheadClassName: string;
}) {
  const { title, subhead } = splitHeadline(headline);

  return (
    <div className="holonewsHeadlineBlock">
      <h3 className={titleClassName}>{title}</h3>
      {subhead ? <p className={subheadClassName}>{subhead}</p> : null}
    </div>
  );
}

function toNum(v: number | string | null | undefined) {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatTicker(value?: string | null) {
  return value ? value.trim().toUpperCase() : "";
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

function buildChartOption(series: TimeSeriesPoint[], metric: MetricKey) {
  const { label, color } = metricMeta(metric);
  const points = series.map((s) => [new Date(s.time).getTime(), toNum(s[metric])]);

  return {
    backgroundColor: "transparent",
    animationDuration: 500,
    grid: { left: 48, right: 20, top: 16, bottom: 28 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      valueFormatter: (value: number) => fmtNum(value),
    },
    legend: { show: false },
    xAxis: {
      type: "time",
      axisLine: { lineStyle: { color: "rgba(231, 238, 252, 0.2)" } },
      axisLabel: {
        color: "rgba(231, 238, 252, 0.7)",
        margin: 12,
        formatter: (value: number) => fmtMarketDayShort(value),
      },
      splitLine: { lineStyle: { color: "rgba(231, 238, 252, 0.06)" } },
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
      splitLine: { lineStyle: { color: "rgba(231, 238, 252, 0.06)" } },
    },
    series: [
      {
        name: label,
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color },
        areaStyle: { color: `${color}22` },
        data: points,
      },
    ],
  };
}

function MetricSwitch({ value, onChange }: { value: MetricKey; onChange: (next: MetricKey) => void }) {
  return (
    <div className="metricSwitch">
      <button
        type="button"
        className={value === "subscriber_count" ? "metricBtn active" : "metricBtn"}
        onClick={() => onChange("subscriber_count")}
      >
        Subscribers
      </button>
      <button
        type="button"
        className={value === "view_count" ? "metricBtn active" : "metricBtn"}
        onClick={() => onChange("view_count")}
      >
        Views
      </button>
      <button
        type="button"
        className={value === "video_count" ? "metricBtn active" : "metricBtn"}
        onClick={() => onChange("video_count")}
      >
        Videos
      </button>
    </div>
  );
}
