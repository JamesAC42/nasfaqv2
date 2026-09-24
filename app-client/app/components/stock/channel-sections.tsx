"use client";

import { useMemo, useState } from "react";
import { Sparkline } from "@/app/components/common/sparkline";
import type { StreamPreview } from "@/app/lib/streams";
import { fmtBig, yen, type Rank } from "@/app/components/stock/format";
import { streamSeconds, usePastStreams, useStats, type Loaded, type PastStream, type useSuperchats } from "@/app/components/stock/use-stock-data";
import { formatEtTime, MARKET_TIME_ZONE } from "@/app/lib/market-clock";
import { signedPct, timeAgo, toneOf } from "@/app/lib/time";
import type { LivestreamItem, MarketAsset } from "@/app/lib/types";
import { useChannelData } from "@/app/lib/use-channel-data";
import styles from "@/app/components/stock/dossier.module.scss";

type Streams = Loaded<{ live: LivestreamItem[]; upcoming: LivestreamItem[] }>;

// ── Channel ──────────────────────────────────────────────────────────────
const CHANNEL_RANGES = [
  { days: 7, label: "7D" },
  { days: 30, label: "1M" },
  { days: 365, label: "1Y" },
];

export function ChannelSection({ asset, ranks, streams }: { asset: MarketAsset; ranks: Rank[]; streams: Streams }) {
  const [days, setDays] = useState(365);
  const stats = useStats(asset.symbol);
  const channels = useChannelData();
  const stream7 = channels.get(asset.symbol.toUpperCase())?.stream7 ?? null;

  const smalls = useMemo(() => {
    const points = [...(stats.data ?? [])].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const end = points.length ? Date.parse(points[points.length - 1].snapshot_date) : 0;
    const windowed = points.filter((point) => Date.parse(point.snapshot_date) >= end - days * 86_400_000);
    const build = (key: "subscriber_count" | "view_count" | "video_count", label: string) => {
      const values = windowed.map((point) => point[key]).filter((value): value is number => value !== null && Number.isFinite(value));
      const last = values.at(-1) ?? null;
      const first = values[0] ?? null;
      const delta = last !== null && first !== null ? last - first : null;
      return { label, values, last, delta, pct: delta !== null && first ? delta / first : null };
    };
    return [build("subscriber_count", "Subscribers"), build("view_count", "Views"), build("video_count", "Videos")];
  }, [days, stats.data]);

  const live = streams.data?.live.length ?? 0;
  const maxRankOf = Math.max(...ranks.map((rank) => rank.of), 1);

  return (
    <section className={styles.sec} id="s-channel">
      <div className={styles.secHead}>
        <h2>The channel</h2>
        <div className={styles.tabs} role="tablist" aria-label="Channel range">
          {CHANNEL_RANGES.map((entry) => (
            <button key={entry.days} type="button" role="tab" aria-selected={days === entry.days} onClick={() => setDays(entry.days)}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.smalls}>
        {smalls.map((small) => (
          <div key={small.label} className={styles.small}>
            <span className={styles.label}>{small.label}</span>
            <span className={styles.smallV}>{small.label === "Videos" ? (small.last ?? 0).toLocaleString("en-US") : fmtBig(small.last)}</span>
            <span className={`${styles.smallD} ${styles[toneOf(small.delta)]}`}>
              {small.delta !== null ? `${small.delta >= 0 ? "+" : "−"}${small.label === "Videos" ? Math.abs(small.delta).toLocaleString("en-US") : fmtBig(Math.abs(small.delta))} (${signedPct(small.pct)})` : stats.loading ? "…" : "—"}
            </span>
            {small.values.length > 1 ? <Sparkline values={small.values} tone="flat" width={220} height={46} fill className={styles.smallSpark} /> : null}
          </div>
        ))}
        <div className={styles.small}>
          <span className={styles.label}>Streamed · 7d</span>
          <span className={styles.smallV}>{stream7 !== null ? `${stream7.toFixed(1)}h` : "—"}</span>
          <span className={styles.smallD}>{live ? <b className={styles.liveTxt}>live right now</b> : "see Streams below"}</span>
        </div>
      </div>
      <div className={styles.label} style={{ margin: "1rem 0 0.5rem" }}>
        Where it ranks · of {maxRankOf}
      </div>
      <div className={styles.rankGrid}>
        {ranks.map((rank) => (
          <div key={rank.label} className={styles.rk}>
            <span className={styles.rkN}>
              {rank.rank ? `#${rank.rank}` : "—"}
              <small>/{rank.of}</small>
            </span>
            <span className={styles.rkL}>{rank.label}</span>
            <i className={styles.rkBar}>
              <s style={{ width: rank.rank ? `${Math.max(4, (1 - (rank.rank - 1) / Math.max(1, rank.of)) * 100)}%` : 0 }} />
            </i>
            <span className={styles.rkV}>{rank.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Superchats ───────────────────────────────────────────────────────────
const CUR_COLORS = ["var(--text)", "var(--blue)", "#F5C542", "#C9A7FF", "#FF8A3D", "var(--dim)"];

export function SuperchatSection({ asset, superchats, hasChannel }: { asset: MarketAsset; superchats: ReturnType<typeof useSuperchats>; hasChannel: boolean }) {
  const { summary, rank, year } = superchats;
  const currencies = useMemo(() => [...(summary.data?.currencies ?? [])].filter((row) => (row.total_in_yen ?? 0) > 0).sort((a, b) => (b.total_in_yen ?? 0) - (a.total_in_yen ?? 0)), [summary.data]);
  const totalYen = currencies.reduce((sum, row) => sum + (row.total_in_yen ?? 0), 0);
  const donations = currencies.reduce((sum, row) => sum + (row.donation_count ?? 0), 0);

  const daily = useMemo(() => {
    const map = new Map<string, number>();
    for (const point of year.data?.points ?? []) {
      const key = point.bucket.slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + (point.total_in_yen ?? 0));
    }
    return map;
  }, [year.data]);

  const heat = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today.getTime() - 364 * 86_400_000);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    const cells: Array<{ key: string; value: number; future: boolean }> = [];
    for (let t = start.getTime(); t <= today.getTime() + 6 * 86_400_000; t += 86_400_000) {
      const key = new Date(t).toISOString().slice(0, 10);
      cells.push({ key, value: daily.get(key) ?? 0, future: t > today.getTime() });
    }
    const sorted = cells.map((cell) => cell.value).filter((value) => value > 0).sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 1;
    return { cells, p90 };
  }, [daily]);

  const weekOverWeek = useMemo(() => {
    const keys = [...daily.keys()].sort();
    if (keys.length < 8) return null;
    const lastKey = keys[keys.length - 1];
    const end = Date.parse(lastKey);
    let thisWeek = 0;
    let lastWeek = 0;
    for (const [key, value] of daily) {
      const age = (end - Date.parse(key)) / 86_400_000;
      if (age < 7) thisWeek += value;
      else if (age < 14) lastWeek += value;
    }
    return lastWeek > 0 ? thisWeek / lastWeek - 1 : null;
  }, [daily]);

  const shown = currencies.slice(0, 5);
  const other = currencies.slice(5);
  const rows = [
    ...shown.map((row, i) => ({ name: row.currency_name, yen: row.total_in_yen ?? 0, count: row.donation_count ?? 0, color: CUR_COLORS[i] })),
    ...(other.length ? [{ name: "Other", yen: other.reduce((sum, row) => sum + (row.total_in_yen ?? 0), 0), count: other.reduce((sum, row) => sum + (row.donation_count ?? 0), 0), color: CUR_COLORS[5] }] : []),
  ];

  return (
    <section className={styles.sec} id="s-sc">
      <div className={styles.secHead}>
        <h2>Superchats</h2>
        <span className={styles.aside}>yen value · {rank.data?.rank ? `#${rank.data.rank} on the board this week` : "last 7 days"}</span>
      </div>
      {!hasChannel ? (
        <p className={styles.empty}>No YouTube channel linked to {asset.symbol}.</p>
      ) : (
        <>
          <div className={styles.kpis}>
            <div>
              <span className={styles.label}>This week</span>
              <span className={styles.kpiV}>{summary.loading ? "…" : yen(totalYen)}</span>
              <span className={`${styles.kpiD} ${styles[toneOf(weekOverWeek)]}`}>{weekOverWeek !== null ? `${signedPct(weekOverWeek)} vs last week` : " "}</span>
            </div>
            <div>
              <span className={styles.label}>Donations</span>
              <span className={styles.kpiV}>{donations.toLocaleString("en-US")}</span>
              <span className={styles.kpiD}>this week</span>
            </div>
            <div>
              <span className={styles.label}>Top currency</span>
              <span className={styles.kpiV}>{rows[0]?.name ?? "—"}</span>
              <span className={styles.kpiD}>{rows[0] && totalYen ? `${Math.round((rows[0].yen / totalYen) * 100)}% of value` : " "}</span>
            </div>
            <div>
              <span className={styles.label}>Avg ticket</span>
              <span className={styles.kpiV}>{donations ? `¥${Math.round(totalYen / donations).toLocaleString("en-US")}` : "—"}</span>
              <span className={styles.kpiD}>per superchat</span>
            </div>
          </div>
          <div className={styles.heatWrap}>
            <div className={styles.heat} role="img" aria-label="Daily superchat yen, last 52 weeks">
              {heat.cells.map((cell) => (
                <i
                  key={cell.key}
                  className={cell.future ? styles.future : cell.value ? undefined : styles.zero}
                  style={cell.value ? ({ "--l": Math.min(1, 0.15 + (cell.value / heat.p90) * 0.85) } as React.CSSProperties) : undefined}
                  title={`${cell.key}: ${yen(cell.value)}`}
                />
              ))}
            </div>
          </div>
          <div className={styles.heatLegend}>
            <span>less</span>
            {[0.15, 0.4, 0.65, 0.9].map((level) => (
              <i key={level} style={{ "--l": level } as React.CSSProperties} />
            ))}
            <span>more</span>
          </div>
          {rows.length ? (
            <>
              <div className={styles.curBar}>
                {rows.map((row) => (
                  <i key={row.name} style={{ flex: row.yen, background: row.color }}>
                    {row.yen / totalYen > 0.08 ? row.name : ""}
                  </i>
                ))}
              </div>
              <table className={styles.curTab}>
                <thead>
                  <tr>
                    <th className={styles.l}>Currency</th>
                    <th>Value</th>
                    <th>Share</th>
                    <th>Count</th>
                    <th>Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name}>
                      <td className={styles.l}>
                        <i style={{ background: row.color }} />
                        {row.name}
                      </td>
                      <td>{yen(row.yen)}</td>
                      <td>{totalYen ? `${Math.round((row.yen / totalYen) * 100)}%` : "—"}</td>
                      <td>{row.count.toLocaleString("en-US")}</td>
                      <td>{row.count ? `¥${Math.round(row.yen / row.count).toLocaleString("en-US")}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className={styles.empty}>{summary.loading ? "Loading superchats…" : "No superchats this week."}</p>
          )}
        </>
      )}
    </section>
  );
}

// ── Streams ──────────────────────────────────────────────────────────────
function toModal(item: LivestreamItem): StreamPreview {
  return { id: item.id, title: item.title, creator: item.creator, channel_id: item.channel_id ?? null, creator_icon: item.creator_icon, channel_color: item.channel_color, thumbnail_url: item.thumbnail_url, started_at: item.started_at, status: item.status, viewer_count: item.viewer_count, url: item.url };
}

function pastToModal(stream: PastStream): StreamPreview {
  return {
    id: stream.video_id,
    title: stream.video_title || "Untitled stream",
    creator: stream.channel_name,
    creator_icon: stream.channel_icon,
    channel_color: stream.channel_color,
    thumbnail_url: stream.thumbnail_url,
    started_at: stream.actual_start_at ?? stream.scheduled_start_at,
    actual_start_time: stream.actual_start_at,
    ended_at: stream.ended_at,
    status: "ended",
    viewer_count: null,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(stream.video_id)}`,
  };
}

const hours = (seconds: number) => (seconds >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : `${Math.round(seconds / 60)}m`);
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
/** Day of week (0 = Sunday) in New York time. */
const etDay = (ms: number) => new Date(new Date(ms).toLocaleString("en-US", { timeZone: MARKET_TIME_ZONE })).getDay();

export function StreamsSection({ asset, channelId, streams, onOpen }: { asset: MarketAsset; channelId: string | null; streams: Streams; onOpen: (item: StreamPreview) => void }) {
  const [page, setPage] = useState(0);
  const past = usePastStreams(channelId, page);
  const thisWeek = usePastStreams(channelId, 0);
  const live = streams.data?.live ?? [];
  const upcoming = streams.data?.upcoming ?? [];

  const byDay = useMemo(() => {
    const totals = Array.from({ length: 7 }, () => 0);
    const now = Date.now();
    for (const stream of thisWeek.data?.streams ?? []) {
      const start = Date.parse(stream.actual_start_at ?? stream.scheduled_start_at ?? "");
      if (!Number.isFinite(start) || now - start > 7 * 86_400_000) continue;
      totals[etDay(start)] += streamSeconds(stream);
    }
    for (const stream of live) {
      const start = Date.parse(stream.started_at ?? "");
      if (Number.isFinite(start)) totals[etDay(now)] += (now - start) / 1000;
    }
    return totals;
  }, [live, thisWeek.data]);
  const maxDay = Math.max(...byDay, 1);
  const today = etDay(Date.now());
  const order = Array.from({ length: 7 }, (_, i) => (today + 1 + i) % 7);

  if (!channelId) {
    return (
      <section className={styles.sec} id="s-streams">
        <div className={styles.secHead}>
          <h2>Streams</h2>
        </div>
        <p className={styles.empty}>No YouTube channel linked to {asset.symbol}.</p>
      </section>
    );
  }

  return (
    <section className={styles.sec} id="s-streams">
      <div className={styles.secHead}>
        <h2>Streams</h2>
        <span className={styles.aside}>{live.length ? "live now" : upcoming.length ? `${upcoming.length} scheduled` : "offline"}</span>
      </div>
      <div className={styles.streams}>
        <div>
          {live.map((item) => (
            <button key={item.id} type="button" className={styles.liveCard} onClick={() => onOpen(toModal(item))}>
              <span className={styles.thumb} style={item.thumbnail_url ? { backgroundImage: `url(${item.thumbnail_url})` } : undefined}>
                <span className={styles.livePillSm}>LIVE</span>
              </span>
              <span className={styles.liveBody}>
                <b>{item.title}</b>
                <small suppressHydrationWarning>
                  {item.viewer_count !== null ? `${fmtBig(item.viewer_count)} watching` : "live"}
                  {item.started_at ? ` · started ${formatEtTime(new Date(item.started_at))} ET` : ""}
                </small>
              </span>
            </button>
          ))}
          {upcoming.length ? (
            <>
              <div className={styles.label} style={{ margin: "0.75rem 0 0.25rem" }}>
                Upcoming
              </div>
              {upcoming.slice(0, 4).map((item) => (
                <button key={item.id} type="button" className={styles.upc} onClick={() => onOpen(toModal(item))}>
                  <time suppressHydrationWarning>{item.started_at ? `${new Date(item.started_at).toLocaleDateString("en-US", { weekday: "short", timeZone: MARKET_TIME_ZONE })} ${formatEtTime(new Date(item.started_at))} ET` : "TBA"}</time>
                  <span>{item.title}</span>
                </button>
              ))}
            </>
          ) : null}
          {!live.length && !upcoming.length ? <p className={styles.empty}>{streams.loading ? "Checking the schedule…" : "Nothing live or scheduled right now."}</p> : null}
        </div>
        <div>
          <div className={styles.label}>Hours streamed · last 7 days</div>
          <div className={styles.hours}>
            {order.map((day) => (
              <div key={day}>
                <small>{byDay[day] ? hours(byDay[day]) : "–"}</small>
                <i style={{ height: `${(byDay[day] / maxDay) * 100}%` }} className={day === today ? styles.todayBar : undefined} />
                <span>{DOW[day]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.pastHead}>
        <div className={styles.label}>Past streams {past.data?.week_start ? `· week of ${new Date(`${past.data.week_start.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}</div>
        <div className={styles.pager}>
          <button type="button" onClick={() => setPage(page + 1)} disabled={!past.data?.has_older}>
            ‹ OLDER
          </button>
          <button type="button" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            NEWER ›
          </button>
        </div>
      </div>
      {past.data?.streams.length ? (
        <div className={styles.pastList}>
          {past.data.streams.map((stream) => (
            <button key={stream.video_id} type="button" className={styles.pastRow} onClick={() => onOpen(pastToModal(stream))}>
              <time suppressHydrationWarning>{stream.actual_start_at ? timeAgo(stream.actual_start_at) : "—"}</time>
              <span>{stream.video_title || "Untitled stream"}</span>
              <small>{hours(streamSeconds(stream))}</small>
              <small>{stream.max_concurrent_viewers ? `${fmtBig(stream.max_concurrent_viewers)} peak` : ""}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>{past.loading ? "Loading past streams…" : "No streams that week."}</p>
      )}
    </section>
  );
}
