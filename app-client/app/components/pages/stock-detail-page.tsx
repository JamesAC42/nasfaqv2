"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RankedBarChartCard, SuperchatHeatmapCard, SuperchatHistogramCard, TrendChartCard } from "@/app/components/charts/market-charts";
import { AssetDetailSection } from "@/app/components/home/asset-detail-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { createChannelChartTheme } from "@/app/lib/chart-theme";
import { fmtDate, fmtInteger, fmtNumber } from "@/app/lib/format";
import { normalizeAssetSuperchatSummary, normalizeAssetSuperchatTimeseries, normalizeLivestreams } from "@/app/lib/normalizers";
import type { AssetSuperchatSummaryBundle, AssetSuperchatTimeseriesBundle, LivestreamItem } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/pages/page-shell.module.scss";

const SUPERCHAT_TIMESERIES_OPTIONS = [
  { value: "7d", label: "Past 7 days" },
  { value: "14d", label: "Past 14 days" },
  { value: "1m", label: "Weekly for month" },
  { value: "1y", label: "Monthly for year" },
] as const;
const CURRENCY_FLAG_MAP: Record<string, string> = {
  AED: "AE",
  ARS: "AR",
  AUD: "AU",
  BRL: "BR",
  CAD: "CA",
  CHF: "CH",
  CLP: "CL",
  CNY: "CN",
  COP: "CO",
  CZK: "CZ",
  DKK: "DK",
  EUR: "EU",
  GBP: "GB",
  HKD: "HK",
  HUF: "HU",
  IDR: "ID",
  INR: "IN",
  JPY: "JP",
  YEN: "JP",
  KRW: "KR",
  KWD: "KW",
  MXN: "MX",
  MYR: "MY",
  NOK: "NO",
  NZD: "NZ",
  PEN: "PE",
  PHP: "PH",
  PLN: "PL",
  PYG: "PY",
  QAR: "QA",
  RON: "RO",
  SAR: "SA",
  SEK: "SE",
  SGD: "SG",
  THB: "TH",
  TRY: "TR",
  TWD: "TW",
  USD: "US",
  VND: "VN",
  ZAR: "ZA",
};

function formatCurrencyLabel(currencyCode: string) {
  const upper = currencyCode.trim().toUpperCase();
  return upper;
}

function getFlagEmoji(countryCode: string) {
  const upper = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  return String.fromCodePoint(...upper.split("").map((char) => 127397 + char.charCodeAt(0)));
}

function getCurrencyFlagEmoji(currencyCode: string) {
  const upper = currencyCode.trim().toUpperCase();
  const countryCode = CURRENCY_FLAG_MAP[upper];
  if (!countryCode) return "";
  return getFlagEmoji(countryCode);
}

function formatCurrencyLabelWithFlag(currencyCode: string) {
  const upper = formatCurrencyLabel(currencyCode);
  const flag = getCurrencyFlagEmoji(currencyCode);
  return flag ? `${flag} ${upper}` : upper;
}

function getCurrencyFlagUrl(currencyCode: string) {
  const upper = currencyCode.trim().toUpperCase();
  const countryCode = CURRENCY_FLAG_MAP[upper];
  if (!countryCode) return null;
  return `https://flagcdn.com/${countryCode.toLowerCase()}.svg`;
}

function formatBucketLabel(bucket: string, bucketUnit: AssetSuperchatTimeseriesBundle["bucket_unit"]) {
  if (!bucket) return "—";
  const parsed = new Date(bucket);
  if (Number.isNaN(parsed.getTime())) return bucket.slice(0, 10);
  const options: Intl.DateTimeFormatOptions =
    bucketUnit === "month"
      ? { month: "short", year: "2-digit" }
      : bucketUnit === "week"
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", options).format(parsed);
}

export function StockDetailPage({ symbol }: { symbol: string }) {
  const { user, refreshSession } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const detail = useMarketStore((state) => state.detail);
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const error = useMarketStore((state) => state.error);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const isLoadingDetail = useMarketStore((state) => state.isLoadingDetail);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const fetchAssetDetail = useMarketStore((state) => state.fetchAssetDetail);
  const [channelStreams, setChannelStreams] = useState<{ live: LivestreamItem[]; upcoming: LivestreamItem[] }>({
    live: [],
    upcoming: [],
  });
  const [livestreamError, setLivestreamError] = useState<string | null>(null);
  const [isLoadingLivestreams, setIsLoadingLivestreams] = useState(false);
  const [superchatSummary, setSuperchatSummary] = useState<AssetSuperchatSummaryBundle | null>(null);
  const [superchatError, setSuperchatError] = useState<string | null>(null);
  const [isLoadingSuperchats, setIsLoadingSuperchats] = useState(false);
  const [superchatTimeseriesRange, setSuperchatTimeseriesRange] = useState<(typeof SUPERCHAT_TIMESERIES_OPTIONS)[number]["value"]>("7d");
  const [superchatTimeseries, setSuperchatTimeseries] = useState<AssetSuperchatTimeseriesBundle | null>(null);
  const [superchatTimeseriesError, setSuperchatTimeseriesError] = useState<string | null>(null);
  const [isLoadingSuperchatTimeseries, setIsLoadingSuperchatTimeseries] = useState(false);

  useEffect(() => {
    void refreshSession();
    void refreshOverview();
  }, [refreshOverview, refreshSession]);

  useEffect(() => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    setSelectedSymbol(normalizedSymbol);
    void fetchAssetDetail(normalizedSymbol);
  }, [fetchAssetDetail, setSelectedSymbol, symbol]);

  const selectedAsset = assets.find((item) => item.symbol.toUpperCase() === symbol.trim().toUpperCase()) || null;
  const chartTheme = createChannelChartTheme(selectedAsset?.color);
  const chartPalette = chartTheme.categorical;

  useEffect(() => {
    const channelId = selectedAsset?.youtube_channel_id?.trim() || "";
    const normalizedSymbol = selectedAsset?.symbol?.trim().toUpperCase() || symbol.trim().toUpperCase();
    if (!channelId) {
      setChannelStreams({ live: [], upcoming: [] });
      setLivestreamError(null);
      setIsLoadingLivestreams(false);
      setSuperchatSummary(null);
      setSuperchatError(null);
      setIsLoadingSuperchats(false);
      return;
    }

    let cancelled = false;

    async function fetchLivestreams() {
      setIsLoadingLivestreams(true);
      setLivestreamError(null);
      try {
        const result = await apiFetch<{
          channel_id: string;
          live: Array<Record<string, unknown>>;
          upcoming: Array<Record<string, unknown>>;
        }>(`/api/livestreams/channel/${encodeURIComponent(channelId)}`);
        if (cancelled) return;
        setChannelStreams({
          live: normalizeLivestreams(result.live || []),
          upcoming: normalizeLivestreams(result.upcoming || []),
        });
      } catch (error) {
        if (cancelled) return;
        setChannelStreams({ live: [], upcoming: [] });
        setLivestreamError(String((error as Error).message || error));
      } finally {
        if (!cancelled) {
          setIsLoadingLivestreams(false);
        }
      }
    }

    async function fetchSuperchatSummary() {
      setIsLoadingSuperchats(true);
      setSuperchatError(null);
      try {
        const result = await apiFetch<Record<string, unknown>>(
          `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/superchats?range=7d`
        );
        if (cancelled) return;
        setSuperchatSummary(normalizeAssetSuperchatSummary(result));
      } catch (error) {
        if (cancelled) return;
        setSuperchatSummary(null);
        setSuperchatError(String((error as Error).message || error));
      } finally {
        if (!cancelled) {
          setIsLoadingSuperchats(false);
        }
      }
    }

    void fetchLivestreams();
    void fetchSuperchatSummary();
    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.symbol, selectedAsset?.youtube_channel_id, symbol]);

  useEffect(() => {
    const channelId = selectedAsset?.youtube_channel_id?.trim() || "";
    const normalizedSymbol = selectedAsset?.symbol?.trim().toUpperCase() || symbol.trim().toUpperCase();
    if (!channelId) {
      setSuperchatTimeseries(null);
      setSuperchatTimeseriesError(null);
      setIsLoadingSuperchatTimeseries(false);
      return;
    }

    let cancelled = false;

    async function fetchSuperchatTimeseries() {
      setIsLoadingSuperchatTimeseries(true);
      setSuperchatTimeseriesError(null);
      try {
        const result = await apiFetch<Record<string, unknown>>(
          `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/superchats/timeseries?range=${encodeURIComponent(superchatTimeseriesRange)}`
        );
        if (cancelled) return;
        setSuperchatTimeseries(normalizeAssetSuperchatTimeseries(result));
      } catch (error) {
        if (cancelled) return;
        setSuperchatTimeseries(null);
        setSuperchatTimeseriesError(String((error as Error).message || error));
      } finally {
        if (!cancelled) {
          setIsLoadingSuperchatTimeseries(false);
        }
      }
    }

    void fetchSuperchatTimeseries();
    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.symbol, selectedAsset?.youtube_channel_id, superchatTimeseriesRange, symbol]);

  async function refreshAll() {
    await refreshOverview();
    if (selectedAsset?.symbol) {
      await fetchAssetDetail(selectedAsset.symbol);
    }
  }

  function renderStreamItem(stream: LivestreamItem, label: "Live" | "Upcoming") {
    return (
      <Link
        key={stream.id}
        href={stream.url || `/livestreams`}
        className={styles.streamItem}
        target={stream.url ? "_blank" : undefined}
        rel={stream.url ? "noreferrer" : undefined}
      >
        {stream.thumbnail_url ? (
          <img src={stream.thumbnail_url} alt="" className={styles.streamThumb} />
        ) : (
          <div className={styles.streamThumbFallback} />
        )}
        <div className={styles.streamBody}>
          <div className={styles.streamTitle}>{stream.title}</div>
          <div className={styles.streamMeta}>{stream.creator}</div>
          <div className={styles.streamMeta}>
            {label === "Live" ? (
              <>
                <span className={styles.livePill}>LIVE</span>
                <span>{fmtNumber(stream.viewer_count)} viewers</span>
                {stream.started_at ? <span>Started {fmtDate(stream.started_at)}</span> : null}
              </>
            ) : (
              <>
                <span className={styles.upcomingPill}>UPCOMING</span>
                <span>{stream.started_at ? fmtDate(stream.started_at) : "Scheduled time unavailable"}</span>
              </>
            )}
          </div>
        </div>
      </Link>
    );
  }

  const superchatLineSeries = (() => {
    if (!superchatTimeseries) return [];

    const bucketOrder = Array.from(new Set(superchatTimeseries.points.map((point) => point.bucket))).sort((a, b) => a.localeCompare(b));
    const grouped = new Map<string, Map<string, number>>();
    const totalsByBucket = new Map<string, number>();
    const totalsByCurrency = new Map<string, number>();

    for (const point of superchatTimeseries.points) {
      const value = point.total_in_yen || 0;
      if (!grouped.has(point.currency_name)) {
        grouped.set(point.currency_name, new Map<string, number>());
      }
      grouped.get(point.currency_name)?.set(point.bucket, value);
      totalsByBucket.set(point.bucket, (totalsByBucket.get(point.bucket) || 0) + value);
      totalsByCurrency.set(point.currency_name, (totalsByCurrency.get(point.currency_name) || 0) + value);
    }

    const topCurrencies = Array.from(totalsByCurrency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([currencyName]) => currencyName);

    return [
      {
        name: "All currencies",
        color: chartTheme.complement,
        kind: "area" as const,
        values: bucketOrder.map((bucket) => ({
          time: bucket,
          value: totalsByBucket.get(bucket) || 0,
        })),
      },
      ...topCurrencies.map((currencyName, index) => ({
        name: formatCurrencyLabelWithFlag(currencyName),
        color: chartPalette[index % chartPalette.length],
        kind: "line" as const,
        values: bucketOrder.map((bucket) => ({
          time: bucket,
          value: grouped.get(currencyName)?.get(bucket) || 0,
        })),
      })),
    ];
  })();

  const sortedSuperchatCurrencies = superchatSummary
    ? [...superchatSummary.currencies].sort((a, b) => (b.total_in_yen || 0) - (a.total_in_yen || 0))
    : [];

  const totalSuperchatYen = sortedSuperchatCurrencies.reduce((sum, item) => sum + (item.total_in_yen || 0), 0);
  const totalSuperchatCount = sortedSuperchatCurrencies.reduce((sum, item) => sum + (item.donation_count || 0), 0);
  const topCurrency = sortedSuperchatCurrencies[0] || null;
  const averageDonationYen = totalSuperchatCount > 0 ? totalSuperchatYen / totalSuperchatCount : 0;
  const activeCurrencyCount = sortedSuperchatCurrencies.filter((item) => (item.total_in_yen || 0) > 0).length;

  const superchatHeatmap = (() => {
    if (!superchatTimeseries) {
      return { columns: [] as string[], rows: [] as Array<{ label: string; cells: Array<{ bucket: string; value: number; valueLabel: string }> }> };
    }

    const bucketOrder = Array.from(new Set(superchatTimeseries.points.map((point) => point.bucket))).sort((a, b) => a.localeCompare(b));
    const totalsByCurrency = new Map<string, number>();
    const valuesByCurrency = new Map<string, Map<string, number>>();

    for (const point of superchatTimeseries.points) {
      const value = point.total_in_yen || 0;
      totalsByCurrency.set(point.currency_name, (totalsByCurrency.get(point.currency_name) || 0) + value);
      if (!valuesByCurrency.has(point.currency_name)) {
        valuesByCurrency.set(point.currency_name, new Map<string, number>());
      }
      valuesByCurrency.get(point.currency_name)?.set(point.bucket, value);
    }

    const topCurrencies = Array.from(totalsByCurrency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([currencyName]) => currencyName);

    return {
      columns: bucketOrder.map((bucket) => formatBucketLabel(bucket, superchatTimeseries.bucket_unit)),
      rows: topCurrencies.map((currencyName) => ({
        label: formatCurrencyLabelWithFlag(currencyName),
        cells: bucketOrder.map((bucket) => {
          const value = valuesByCurrency.get(currencyName)?.get(bucket) || 0;
          return {
            bucket: formatBucketLabel(bucket, superchatTimeseries.bucket_unit),
            value,
            valueLabel: value > 0 ? `¥${fmtInteger(value)}` : "No superchats",
          };
        }),
      })),
    };
  })();

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <h1 className={styles.title}>{symbol.trim().toUpperCase()}</h1>
          <p className={styles.copy}>
            This asset detail route now owns the stock-specific charts, treasury, recent trades, and trade ticket that previously lived on the homepage.
          </p>
        </section>

        {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
        {isLoadingOverview || isLoadingDetail ? <div className={styles.panel}>Loading asset detail…</div> : null}

        <AssetDetailSection
          asset={selectedAsset}
          detail={detail}
          canTrade={Boolean(user)}
          marketStatus={marketStatus}
          onTradeComplete={refreshAll}
          chartTheme={chartTheme}
        />

        <section className={styles.panel}>
          <div>
            <h2 className={styles.title}>Livestreams</h2>
            <p className={styles.copy}>Current live and scheduled streams for this channel.</p>
          </div>

          {livestreamError ? <div className="statusMessage statusMessageError">Livestream error: {livestreamError}</div> : null}
          {isLoadingLivestreams ? <div className={styles.empty}>Loading livestreams…</div> : null}
          {!isLoadingLivestreams && !livestreamError && channelStreams.live.length === 0 && channelStreams.upcoming.length === 0 ? (
            <div className={styles.empty}>No live or upcoming streams in cache for this channel.</div>
          ) : null}

          {channelStreams.live.length > 0 ? (
            <div className={styles.streamSection}>
              <h3 className={styles.sectionLabel}>Live Now</h3>
              <div className={styles.streamList}>
                {channelStreams.live.map((stream) => renderStreamItem(stream, "Live"))}
              </div>
            </div>
          ) : null}

          {channelStreams.upcoming.length > 0 ? (
            <div className={styles.streamSection}>
              <h3 className={styles.sectionLabel}>Upcoming</h3>
              <div className={styles.streamList}>
                {channelStreams.upcoming.map((stream) => renderStreamItem(stream, "Upcoming"))}
              </div>
            </div>
          ) : null}
        </section>

        <section className={styles.panel}>
          <div>
            <h2 className={styles.title}>Weekly Superchats</h2>
            <p className={styles.copy}>Past 7 days of superchat totals by currency, scaled by total yen.</p>
            {superchatSummary?.week_start && superchatSummary?.week_end ? (
              <p className={styles.meta}>
                Window: {fmtDate(superchatSummary.week_start)} to {fmtDate(superchatSummary.week_end)}
              </p>
            ) : null}
          </div>

          {superchatError ? <div className="statusMessage statusMessageError">Superchat error: {superchatError}</div> : null}
          {isLoadingSuperchats ? <div className={styles.empty}>Loading superchat summary…</div> : null}
          {!isLoadingSuperchats && !superchatError && (!superchatSummary || superchatSummary.currencies.length === 0) ? (
            <div className={styles.empty}>No superchat currency totals for this channel in the past week.</div>
          ) : null}

          {superchatSummary && superchatSummary.currencies.length > 0 ? (
            <>
              <div className={styles.grid}>
                <div className={styles.card}>
                  <div className={styles.eyebrow}>Weekly Yen</div>
                  <div className={styles.cardTitle}>¥{fmtInteger(totalSuperchatYen)}</div>
                  <div className={styles.meta}>Across all currencies in the current 7-day window.</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.eyebrow}>Donation Count</div>
                  <div className={styles.cardTitle}>{fmtInteger(totalSuperchatCount)}</div>
                  <div className={styles.meta}>Average ticket size ¥{fmtInteger(averageDonationYen)}.</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.eyebrow}>Leading Currency</div>
                  <div className={styles.cardTitle}>{topCurrency ? formatCurrencyLabelWithFlag(topCurrency.currency_name) : "—"}</div>
                  <div className={styles.meta}>
                    {topCurrency && totalSuperchatYen > 0
                      ? `${fmtNumber(((topCurrency.total_in_yen || 0) / totalSuperchatYen) * 100)}% share across ${activeCurrencyCount} active currencies.`
                      : "No dominant currency yet."}
                  </div>
                </div>
              </div>

              <SuperchatHistogramCard
                title="Revenue Power"
                subtitle="Past 7 days of superchat value in yen by currency"
                theme={chartTheme}
                bars={sortedSuperchatCurrencies.map((item, index) => ({
                  label: formatCurrencyLabelWithFlag(item.currency_name),
                  color: chartPalette[index % chartPalette.length],
                  value: item.total_in_yen || 0,
                  subtitle: `${fmtInteger(item.donation_count || 0)} donations • ${fmtNumber(item.total_in_currency)} ${item.currency_name}`,
                  flagUrl: getCurrencyFlagUrl(item.currency_name),
                }))}
              />

              <div className={styles.superchatChartGrid}>
                <RankedBarChartCard
                  title="Share Of Value"
                  subtitle="Currency contribution to weekly yen volume"
                  bars={sortedSuperchatCurrencies.map((item, index) => ({
                    label: formatCurrencyLabelWithFlag(item.currency_name),
                    color: chartPalette[index % chartPalette.length],
                    value: item.total_in_yen || 0,
                    valueLabel: totalSuperchatYen > 0 ? `${fmtNumber(((item.total_in_yen || 0) / totalSuperchatYen) * 100)}%` : "0%",
                    meta: `¥${fmtInteger(item.total_in_yen)} total`,
                  }))}
                />
                <RankedBarChartCard
                  title="Donation Count"
                  subtitle="How many superchats each currency contributed"
                  bars={sortedSuperchatCurrencies.map((item, index) => ({
                    label: formatCurrencyLabelWithFlag(item.currency_name),
                    color: chartPalette[index % chartPalette.length],
                    value: item.donation_count || 0,
                    valueLabel: fmtInteger(item.donation_count || 0),
                    meta: totalSuperchatCount > 0 ? `${fmtNumber(((item.donation_count || 0) / totalSuperchatCount) * 100)}% of all donations` : "No donations",
                  }))}
                />
                <RankedBarChartCard
                  title="Average Ticket"
                  subtitle="Average yen per donation by currency"
                  bars={sortedSuperchatCurrencies
                    .filter((item) => (item.donation_count || 0) > 0)
                    .map((item, index) => ({
                      label: formatCurrencyLabelWithFlag(item.currency_name),
                      color: chartPalette[index % chartPalette.length],
                      value: (item.total_in_yen || 0) / Math.max(item.donation_count || 1, 1),
                      valueLabel: `¥${fmtInteger((item.total_in_yen || 0) / Math.max(item.donation_count || 1, 1))}`,
                      meta: `${fmtNumber(item.total_in_currency)} ${item.currency_name} across ${fmtInteger(item.donation_count || 0)} donations`,
                    }))}
                />
              </div>
            </>
          ) : null}

          <div className={styles.superchatSubsection}>
            <div className={styles.superchatToolbar}>
              <h3 className={styles.sectionLabel}>Totals Over Time</h3>
              <div className={styles.rangeSelector}>
                {SUPERCHAT_TIMESERIES_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={option.value === superchatTimeseriesRange ? styles.rangeChipActive : styles.rangeChip}
                    onClick={() => setSuperchatTimeseriesRange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {superchatTimeseries?.start_date && superchatTimeseries?.end_date ? (
              <p className={styles.meta}>
                Window: {fmtDate(superchatTimeseries.start_date)} to {fmtDate(superchatTimeseries.end_date)}
              </p>
            ) : null}

            {superchatTimeseriesError ? (
              <div className="statusMessage statusMessageError">Superchat timeseries error: {superchatTimeseriesError}</div>
            ) : null}
            {isLoadingSuperchatTimeseries ? <div className={styles.empty}>Loading superchat timeseries…</div> : null}
            {!isLoadingSuperchatTimeseries && !superchatTimeseriesError && superchatLineSeries.length === 0 ? (
              <div className={styles.empty}>No superchat timeseries data for this range.</div>
            ) : null}

            {superchatLineSeries.length > 0 ? (
              <div className={styles.superchatChartGrid}>
                <TrendChartCard
                  title="Revenue Pulse"
                  subtitle="Total yen flow over time with the strongest currencies layered on top"
                  series={superchatLineSeries}
                  theme={chartTheme}
                />
                <SuperchatHeatmapCard
                  title="Currency Heatmap"
                  subtitle="Spot bursts, quiet gaps, and which countries dominated each bucket"
                  columns={superchatHeatmap.columns}
                  rows={superchatHeatmap.rows}
                  theme={chartTheme}
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
