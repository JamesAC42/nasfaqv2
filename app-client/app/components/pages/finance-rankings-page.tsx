"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FaArrowTrendUp,
  FaChartColumn,
  FaDollarSign,
  FaEye,
  FaHeart,
  FaStopwatch,
  FaUsers,
  FaVideo,
  FaYenSign,
} from "react-icons/fa6";
import {
  CandleChartCard,
  MetricHistogramCard,
  TrendChartCard,
  VolumeChartCard,
} from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { createChannelChartTheme } from "@/app/lib/chart-theme";
import { fmtInteger, fmtNumber, toNumber } from "@/app/lib/format";
import { normalizeCandles, normalizeStats } from "@/app/lib/normalizers";
import type { CandlePoint, MarketStatPoint } from "@/app/lib/types";
import styles from "@/app/components/pages/finance-rankings-page.module.scss";

type RankingMetricKey =
  | "price"
  | "volume24h"
  | "move24h"
  | "subscribers"
  | "views"
  | "superchatEarnings"
  | "streamTime7d"
  | "videos"
  | "oshicoinUsers";

type RankingRow = {
  id: number;
  symbol: string;
  displayName: string;
  icon: string | null;
  color: string | null;
  unit: string | null;
  currentMidPrice: number | null;
  volume24h: number | null;
  move24hPct: number | null;
  subscribers: number | null;
  views: number | null;
  superchatEarnings: number | null;
  streamTime7d: number | null;
  videos: number | null;
  oshicoinUsers: number | null;
};

type RankingsResponse = {
  superchat_range: string;
  rows: Array<Record<string, unknown>>;
};

type RankingDetail = {
  candles: CandlePoint[];
  stats: MarketStatPoint[];
  superchatBars: Array<{ bucket: string; total: number }>;
  streamTimeBars: Array<{ bucket: string; durationSeconds: number }>;
};

type StatsResponse = {
  stats: Array<Record<string, unknown>>;
};

type CandleResponse = {
  candles: Array<Record<string, unknown>>;
};

type SuperchatTimeseriesResponse = {
  points: Array<Record<string, unknown>>;
};

type StreamTimeTimeseriesResponse = {
  points: Array<Record<string, unknown>>;
};

const METRIC_OPTIONS: Array<{
  key: RankingMetricKey;
  label: string;
  valueLabel: string;
  icon: typeof FaDollarSign;
  toneClass: string;
}> = [
  { key: "price", label: "Price", valueLabel: "Price", icon: FaDollarSign, toneClass: styles.metricPrice },
  { key: "volume24h", label: "24H Volume", valueLabel: "24H Volume", icon: FaChartColumn, toneClass: styles.metricVolume },
  { key: "move24h", label: "24H Move", valueLabel: "24H Move", icon: FaArrowTrendUp, toneClass: styles.metricMove },
  { key: "subscribers", label: "Subscribers", valueLabel: "Subscribers", icon: FaUsers, toneClass: styles.metricSubscribers },
  { key: "views", label: "Views", valueLabel: "Views", icon: FaEye, toneClass: styles.metricViews },
  { key: "superchatEarnings", label: "Superchat Earnings", valueLabel: "7D Superchat", icon: FaYenSign, toneClass: styles.metricSuperchat },
  { key: "streamTime7d", label: "Time Streamed", valueLabel: "7D Stream Time", icon: FaStopwatch, toneClass: styles.metricStreamTime },
  { key: "videos", label: "Videos", valueLabel: "Videos", icon: FaVideo, toneClass: styles.metricVideos },
  { key: "oshicoinUsers", label: "Oshicoin Users", valueLabel: "Oshicoin Users", icon: FaHeart, toneClass: styles.metricOshicoin },
];

function normalizeRankingRow(row: Record<string, unknown>): RankingRow {
  return {
    id: Number(row.id || 0),
    symbol: String(row.symbol || ""),
    displayName: String(row.display_name || row.symbol || ""),
    icon: row.icon ? String(row.icon) : null,
    color: row.color ? String(row.color) : null,
    unit: row.unit ? String(row.unit) : null,
    currentMidPrice: toNumber(row.current_mid_price),
    volume24h: toNumber(row.volume_24h),
    move24hPct: toNumber(row.move_24h_pct),
    subscribers: toNumber(row.subscribers),
    views: toNumber(row.views),
    superchatEarnings: toNumber(row.superchat_earnings),
    streamTime7d: toNumber(row.stream_duration_seconds_7d),
    videos: toNumber(row.videos),
    oshicoinUsers: toNumber(row.oshicoin_users),
  };
}

function metricValue(row: RankingRow, metric: RankingMetricKey) {
  switch (metric) {
    case "price":
      return row.currentMidPrice;
    case "volume24h":
      return row.volume24h;
    case "move24h":
      return row.move24hPct;
    case "subscribers":
      return row.subscribers;
    case "views":
      return row.views;
    case "superchatEarnings":
      return row.superchatEarnings;
    case "streamTime7d":
      return row.streamTime7d;
    case "videos":
      return row.videos;
    case "oshicoinUsers":
      return row.oshicoinUsers;
    default:
      return null;
  }
}

function formatSignedPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatDuration(value: number) {
  const whole = Math.max(0, Math.floor(value));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatMetricValue(row: RankingRow, metric: RankingMetricKey) {
  switch (metric) {
    case "price":
      return fmtNumber(row.currentMidPrice, "$");
    case "volume24h":
      return fmtInteger(row.volume24h);
    case "move24h":
      return formatSignedPct(row.move24hPct);
    case "subscribers":
      return fmtInteger(row.subscribers);
    case "views":
      return fmtInteger(row.views);
    case "superchatEarnings":
      return `¥${fmtInteger(row.superchatEarnings)}`;
    case "streamTime7d":
      return row.streamTime7d === null || row.streamTime7d === undefined ? "—" : formatDuration(row.streamTime7d);
    case "videos":
      return fmtInteger(row.videos);
    case "oshicoinUsers":
      return fmtInteger(row.oshicoinUsers);
    default:
      return "—";
  }
}

function metricToneClass(row: RankingRow, metric: RankingMetricKey) {
  if (metric !== "move24h") return "";
  const value = row.move24hPct ?? 0;
  if (value > 0) return styles.metricPositive;
  if (value < 0) return styles.metricNegative;
  return "";
}

function formatBucketLabel(bucket: string) {
  const parsed = new Date(bucket);
  if (Number.isNaN(parsed.getTime())) return bucket;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildSuperchatBars(points: Array<Record<string, unknown>>) {
  const totals = new Map<string, number>();
  for (const point of points) {
    const bucket = String(point.bucket || "");
    const value = toNumber(point.total_in_yen) || 0;
    totals.set(bucket, (totals.get(bucket) || 0) + value);
  }

  return Array.from(totals.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([bucket, total]) => ({ bucket, total }));
}

function buildStreamTimeBars(points: Array<Record<string, unknown>>) {
  return points
    .map((point) => ({
      bucket: String(point.bucket || ""),
      durationSeconds: toNumber(point.duration_seconds) || 0,
    }))
    .sort((left, right) => left.bucket.localeCompare(right.bucket));
}

function buildMoveSeries(candles: CandlePoint[]) {
  const valid = candles.filter((item) => {
    const close = item.close_mark ?? item.close;
    return close !== null && close !== undefined && Number.isFinite(close);
  });

  return valid
    .map((item, index) => {
      if (index === 0) return null;
      const current = item.close_mark ?? item.close;
      const previous = valid[index - 1].close_mark ?? valid[index - 1].close;
      if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null;
      return {
        time: item.bucket,
        value: (current - previous) / previous,
      };
    })
    .filter((item): item is { time: string; value: number } => Boolean(item));
}

function DetailPanel({
  row,
  metric,
  detail,
  loading,
  error,
  totalOshicoinUsers,
}: {
  row: RankingRow;
  metric: RankingMetricKey;
  detail: RankingDetail | null;
  loading: boolean;
  error: string | null;
  totalOshicoinUsers: number;
}) {
  const theme = createChannelChartTheme(row.color);
  const trimmedCandles = detail?.candles.slice(-14) || [];
  const trimmedStats = detail?.stats.slice(-30) || [];
  const moveSeries = buildMoveSeries(trimmedCandles);
  const oshiShare = totalOshicoinUsers > 0 ? ((row.oshicoinUsers || 0) / totalOshicoinUsers) * 100 : 0;

  let content: ReactNode = null;

  if (loading) {
    content = <div className={styles.detailEmpty}>Loading detail…</div>;
  } else if (error) {
    content = <div className="statusMessage statusMessageError">Detail unavailable: {error}</div>;
  } else if (!detail && metric !== "oshicoinUsers") {
    content = <div className={styles.detailEmpty}>No detail available.</div>;
  } else {
    switch (metric) {
      case "price":
        content = (
          <CandleChartCard
            title="Price Trend"
            subtitle="Recent daily closes"
            candles={trimmedCandles}
            chartType="line"
            theme={theme}
            height={280}
          />
        );
        break;
      case "volume24h":
        content = (
          <VolumeChartCard
            title="Daily Volume"
            subtitle="Recent settled daily share volume"
            candles={trimmedCandles}
            theme={theme}
            height={280}
          />
        );
        break;
      case "move24h":
        content = (
          <TrendChartCard
            title="Daily Price Move"
            subtitle="Day-over-day closing change"
            bare
            theme={theme}
            series={[
              {
                name: `${row.symbol} move`,
                symbol: row.symbol,
                icon: row.icon,
                color: theme.complementDeep,
                kind: "line",
                values: moveSeries,
              },
            ]}
          />
        );
        break;
      case "subscribers":
        content = (
          <TrendChartCard
            title="Subscriber History"
            subtitle="Recent channel subscriber snapshots"
            bare
            theme={theme}
            series={[
              {
                name: `${row.symbol} subscribers`,
                symbol: row.symbol,
                icon: row.icon,
                color: theme.baseDeep,
                kind: "area",
                values: trimmedStats.map((point) => ({
                  time: point.snapshot_date,
                  value: point.subscriber_count,
                })),
              },
            ]}
          />
        );
        break;
      case "views":
        content = (
          <TrendChartCard
            title="View History"
            subtitle="Recent cumulative channel views"
            bare
            theme={theme}
            series={[
              {
                name: `${row.symbol} views`,
                symbol: row.symbol,
                icon: row.icon,
                color: theme.highlight,
                kind: "area",
                values: trimmedStats.map((point) => ({
                  time: point.snapshot_date,
                  value: point.view_count,
                })),
              },
            ]}
          />
        );
        break;
      case "videos":
        content = (
          <TrendChartCard
            title="Upload Count History"
            subtitle="Recent cumulative video totals"
            bare
            theme={theme}
            series={[
              {
                name: `${row.symbol} videos`,
                symbol: row.symbol,
                icon: row.icon,
                color: theme.base,
                kind: "line",
                values: trimmedStats.map((point) => ({
                  time: point.snapshot_date,
                  value: point.video_count,
                })),
              },
            ]}
          />
        );
        break;
      case "superchatEarnings":
        content = (
          <MetricHistogramCard
            title="Daily Superchat Earnings"
            subtitle="Vertical bars for the past 7 days"
            theme={theme}
            emptyLabel="No superchat data for the past 7 days."
            bars={(detail?.superchatBars || []).map((bar) => ({
              label: formatBucketLabel(bar.bucket),
              color: theme.baseDeep,
              value: bar.total,
              valueLabel: `¥${fmtInteger(bar.total)}`,
              subtitle: "Superchat earnings",
            }))}
          />
        );
        break;
      case "streamTime7d":
        content = (
          <MetricHistogramCard
            title="Daily Stream Time"
            subtitle="Vertical bars for the past 7 days"
            theme={theme}
            emptyLabel="No archived stream time in the past 7 days."
            bars={(detail?.streamTimeBars || []).map((bar) => ({
              label: formatBucketLabel(bar.bucket),
              color: theme.complementDeep,
              value: bar.durationSeconds,
              valueLabel: formatDuration(bar.durationSeconds),
              subtitle: "Streamed time",
            }))}
          />
        );
        break;
      case "oshicoinUsers":
        content = (
          <div className={styles.oshiDetailCard}>
            <div className={styles.oshiDetailHeader}>
              <strong>Oshicoin Support</strong>
              <span>{fmtInteger(row.oshicoinUsers)} users</span>
            </div>
            <div className={styles.oshiMeterTrack}>
              <div className={styles.oshiMeterFill} style={{ width: `${oshiShare}%` }} />
            </div>
            <div className={styles.oshiMetaRow}>
              <span>{oshiShare.toFixed(2)}% of all current oshicoin selections</span>
              <span>{fmtInteger(totalOshicoinUsers)} total selections</span>
            </div>
          </div>
        );
        break;
      default:
        content = <div className={styles.detailEmpty}>No detail available for this metric.</div>;
    }
  }

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailTopRow}>
        <div>
          <h3 className={styles.detailTitle}>{row.displayName} Detail</h3>
          <p className={styles.detailCopy}>Expanded view for {METRIC_OPTIONS.find((item) => item.key === metric)?.label?.toLowerCase() || "this metric"}.</p>
        </div>
        <Link href={`/stocks/${encodeURIComponent(row.symbol)}`} className={styles.detailLink}>
          Open stock page
        </Link>
      </div>
      {content}
    </div>
  );
}

export function FinanceRankingsPage() {
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<RankingMetricKey>("price");
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [detailBySymbol, setDetailBySymbol] = useState<Record<string, RankingDetail>>({});
  const [detailLoadingBySymbol, setDetailLoadingBySymbol] = useState<Record<string, boolean>>({});
  const [detailErrorBySymbol, setDetailErrorBySymbol] = useState<Record<string, string | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const result = await apiFetch<RankingsResponse>("/api/market/rankings?superchat_range=7d", { cache: "no-store" });
        if (cancelled) return;
        setRows((result.rows || []).map(normalizeRankingRow).filter((row) => row.symbol));
      } catch (nextError) {
        if (cancelled) return;
        setError(String((nextError as Error).message || nextError));
        setRows([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedMetricOption = METRIC_OPTIONS.find((metric) => metric.key === selectedMetric) || METRIC_OPTIONS[0];

  const rankedRows = useMemo(() => {
    return [...rows].sort((left, right) => {
      const leftValue = metricValue(left, selectedMetric);
      const rightValue = metricValue(right, selectedMetric);
      const leftSortable = leftValue ?? Number.NEGATIVE_INFINITY;
      const rightSortable = rightValue ?? Number.NEGATIVE_INFINITY;
      if (rightSortable !== leftSortable) return rightSortable - leftSortable;
      return left.symbol.localeCompare(right.symbol);
    });
  }, [rows, selectedMetric]);

  const totalOshicoinUsers = useMemo(
    () => rankedRows.reduce((sum, row) => sum + (row.oshicoinUsers || 0), 0),
    [rankedRows]
  );

  async function ensureDetail(symbol: string) {
    if (detailBySymbol[symbol]) return;

    setDetailLoadingBySymbol((current) => ({ ...current, [symbol]: true }));
    setDetailErrorBySymbol((current) => ({ ...current, [symbol]: null }));

    try {
      const [statsResult, candlesResult, superchatResult, streamTimeResult] = await Promise.all([
        apiFetch<StatsResponse>(`/api/market/assets/${encodeURIComponent(symbol)}/stats?range=30d`, { cache: "no-store" }),
        apiFetch<CandleResponse>(`/api/market/assets/${encodeURIComponent(symbol)}/candles?interval=1d&range=30d`, { cache: "no-store" }),
        apiFetch<SuperchatTimeseriesResponse>(`/api/market/assets/${encodeURIComponent(symbol)}/superchats/timeseries?range=7d`, { cache: "no-store" }),
        apiFetch<StreamTimeTimeseriesResponse>(`/api/market/assets/${encodeURIComponent(symbol)}/stream-time/timeseries?range=7d`, { cache: "no-store" }),
      ]);

      setDetailBySymbol((current) => ({
        ...current,
        [symbol]: {
          stats: normalizeStats(statsResult.stats || []),
          candles: normalizeCandles(candlesResult.candles || []),
          superchatBars: buildSuperchatBars(superchatResult.points || []),
          streamTimeBars: buildStreamTimeBars(streamTimeResult.points || []),
        },
      }));
    } catch (nextError) {
      setDetailErrorBySymbol((current) => ({
        ...current,
        [symbol]: String((nextError as Error).message || nextError),
      }));
    } finally {
      setDetailLoadingBySymbol((current) => ({ ...current, [symbol]: false }));
    }
  }

  async function toggleRow(row: RankingRow) {
    const isExpanded = expandedSymbol === row.symbol;
    setExpandedSymbol(isExpanded ? null : row.symbol);
    if (!isExpanded && selectedMetric !== "oshicoinUsers") {
      await ensureDetail(row.symbol);
    }
  }

  return (
    <SiteShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Rankings</h1>
          <p className={styles.copy}>
            Rank every asset by the metric you care about. Click a row to expand a metric-specific detail view directly below it.
          </p>
          <div className={styles.metricBubbleRow}>
            {METRIC_OPTIONS.map((metric) => {
              const Icon = metric.icon;
              const isActive = metric.key === selectedMetric;

              return (
                <button
                  key={metric.key}
                  type="button"
                  className={[
                    styles.metricBubble,
                    metric.toneClass,
                    isActive ? styles.metricBubbleActive : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setSelectedMetric(metric.key)}
                  aria-pressed={isActive}
                >
                  <span className={styles.metricBubbleIcon}>
                    <Icon aria-hidden="true" />
                  </span>
                  <span className={styles.metricBubbleLabel}>{metric.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.rankingsPanel}>
          <div className={styles.panelHeader}>
            <div>
              <h2 className={styles.panelTitle}>{selectedMetricOption.label}</h2>
              <p className={styles.panelCopy}>Click a row to inspect a chart or deeper visual for the selected metric.</p>
            </div>
            <div className={styles.resultMeta}>{fmtInteger(rankedRows.length)} assets</div>
          </div>

          <div className={styles.listHeader} aria-hidden="true">
            <span className={styles.listHeaderRank}>Rank</span>
            <span>Asset</span>
            <span>Price</span>
            <span className={styles.listHeaderMetric}>{selectedMetricOption.valueLabel}</span>
          </div>

          {error ? <div className="statusMessage statusMessageError">Rankings unavailable: {error}</div> : null}
          {isLoading ? <div className={styles.empty}>Loading rankings…</div> : null}
          {!isLoading && !error && rankedRows.length === 0 ? <div className={styles.empty}>No ranking data available.</div> : null}

          {!isLoading && !error && rankedRows.length ? (
            <div className={styles.list}>
              {rankedRows.map((row, index) => {
                const isExpanded = expandedSymbol === row.symbol;

                return (
                  <div key={row.symbol} className={styles.rowGroup}>
                    <button
                      type="button"
                      className={[styles.row, isExpanded ? styles.rowExpanded : ""].filter(Boolean).join(" ")}
                      onClick={() => void toggleRow(row)}
                      aria-expanded={isExpanded}
                    >
                      <span className={styles.rankBadge}>#{index + 1}</span>

                      <span className={styles.assetCell}>
                        <AssetCoin
                          symbol={row.symbol}
                          icon={row.icon}
                          color={row.color}
                          className={styles.assetCoin}
                        />
                        <span className={styles.assetCopy}>
                          <strong className={styles.assetTicker}>{row.symbol}</strong>
                          <span className={styles.assetName}>{row.displayName}</span>
                        </span>
                      </span>

                      <span className={styles.priceCell}>{fmtNumber(row.currentMidPrice, "$")}</span>

                      <span className={[styles.metricValue, metricToneClass(row, selectedMetric)].filter(Boolean).join(" ")}>
                        {formatMetricValue(row, selectedMetric)}
                      </span>
                    </button>

                    {isExpanded ? (
                      <DetailPanel
                        row={row}
                        metric={selectedMetric}
                        detail={detailBySymbol[row.symbol] || null}
                        loading={Boolean(detailLoadingBySymbol[row.symbol])}
                        error={detailErrorBySymbol[row.symbol] || null}
                        totalOshicoinUsers={totalOshicoinUsers}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </SiteShell>
  );
}
