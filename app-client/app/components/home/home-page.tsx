"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { MarketSidebar } from "@/app/components/common/market-sidebar";
import { LivestreamSection } from "@/app/components/home/livestream-section";
import { MarketReportSection } from "@/app/components/home/market-report-section";
import { CompactNewsGrid, NewsSection, partitionHomepageNewsItems } from "@/app/components/home/news-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { getUsableChannelColor } from "@/app/lib/color";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { computeDailyPriceChangePct } from "@/app/lib/market-metrics";
import { normalizeArticleListResponse } from "@/app/lib/normalizers";
import { getSiteStatsWsUrl } from "@/app/lib/ws";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useChannelStore } from "@/app/stores/channel-store";
import { useLeaderboardStore } from "@/app/stores/leaderboard-store";
import { useLivestreamStore } from "@/app/stores/livestream-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useNewsStore } from "@/app/stores/news-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/home/home-page.module.scss";
import Image from "next/image";
import { MdPerson } from "react-icons/md";
import { BsRecordCircle, BsYoutube } from "react-icons/bs";
import type { ArticleSummary, ChannelOverviewRow, MarketAsset, SiteStats } from "@/app/lib/types";
import {
  FaArrowTrendDown,
  FaArrowTrendUp,
  FaChartLine,
  FaGaugeHigh,
  FaMoneyBillTrendUp,
  FaRegCalendar,
} from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";

function renderAssetLabel(
  asset: {
    symbol: string;
    display_name?: string | null;
    icon?: string | null;
    color?: string | null;
  } | null | undefined,
  fallbackName = "—"
) {
  if (!asset) return <strong>{fallbackName}</strong>;

  return (
    <strong className={styles.assetLabel}>
      <AssetCoin
        symbol={asset.symbol}
        icon={asset.icon ?? null}
        color={asset.color ?? null}
        className={styles.inlineAssetIcon}
      />
      <span>{asset.display_name || asset.symbol || fallbackName}</span>
    </strong>
  );
}

function getToneClass(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return styles.neutral;
  if (value > 0) return styles.positive;
  if (value < 0) return styles.negative;
  return styles.neutral;
}

function getMonthsAgoDate(months: number) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff;
}

function formatSessionDate(value: string | null | undefined) {
  if (!value) return "Market desk";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const day = parsed.getDate();
  const suffix = day % 10 === 1 && day !== 11
    ? "st"
    : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
        ? "rd"
        : "th";
  const month = parsed.toLocaleDateString("en-US", { month: "long" });
  return `${month} ${day}${suffix}, ${parsed.getFullYear()}`;
}

type OverviewTimeSeriesPoint = {
  time: string;
  subscriber_count: number | null;
  view_count: number | null;
  video_count: number | null;
};

type OverviewRow = {
  channel: {
    youtube_channel_id: string;
  };
  series: OverviewTimeSeriesPoint[];
};

type ChannelMetricCard = {
  channel: ChannelOverviewRow;
  asset: MarketAsset | null;
  value: number;
};

type ChannelChartRow = {
  key: string;
  label: string;
  iconSymbol: string;
  icon: string | null;
  color: string | null;
  value: number;
  valueLabel: string;
  meta: string;
};

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function toDayKey(value: string | null | undefined) {
  const timestamp = toTimestamp(value);
  if (timestamp === null) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function latestSeriesPoint(series: OverviewTimeSeriesPoint[]) {
  return [...series]
    .filter((point) => toTimestamp(point.time) !== null)
    .sort((a, b) => (toTimestamp(a.time) ?? 0) - (toTimestamp(b.time) ?? 0))
    .at(-1) || null;
}

function computeCurrentUploadStreak(series: OverviewTimeSeriesPoint[]) {
  const daily = new Map<string, OverviewTimeSeriesPoint>();

  [...series]
    .filter((point) => toTimestamp(point.time) !== null)
    .sort((a, b) => (toTimestamp(a.time) ?? 0) - (toTimestamp(b.time) ?? 0))
    .forEach((point) => {
      const dayKey = toDayKey(point.time);
      if (dayKey) {
        daily.set(dayKey, point);
      }
    });

  const days = [...daily.entries()]
    .map(([day, point]) => ({ day, point, timestamp: toTimestamp(day) ?? 0 }))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (days.length < 2) return 0;

  let streak = 0;
  for (let index = days.length - 1; index > 0; index -= 1) {
    const current = days[index];
    const previous = days[index - 1];
    const dayGap = Math.round((current.timestamp - previous.timestamp) / (24 * 60 * 60 * 1000));
    if (dayGap !== 1) break;

    const currentVideos = current.point.video_count ?? null;
    const previousVideos = previous.point.video_count ?? null;
    if (
      currentVideos === null ||
      previousVideos === null ||
      Number.isNaN(currentVideos) ||
      Number.isNaN(previousVideos) ||
      currentVideos <= previousVideos
    ) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function findAssetForChannel(channel: ChannelOverviewRow, assets: MarketAsset[]) {
  const channelId = channel.channel.youtube_channel_id?.trim();
  if (channelId) {
    const byChannelId = assets.find((asset) => asset.youtube_channel_id?.trim() === channelId) || null;
    if (byChannelId) return byChannelId;
  }

  const symbol = channel.channel.symbol?.trim().toUpperCase();
  if (symbol) {
    const bySymbol = assets.find((asset) => asset.symbol?.trim().toUpperCase() === symbol) || null;
    if (bySymbol) return bySymbol;
  }

  return null;
}

function buildChannelMetricCard(
  channels: ChannelOverviewRow[],
  assets: MarketAsset[],
  selector: (row: ChannelOverviewRow) => number | null,
  direction: "max" | "min"
) {
  const ranked = channels
    .map((channel) => ({ channel, value: selector(channel) }))
    .filter((item): item is { channel: ChannelOverviewRow; value: number } => (
      item.value !== null && item.value !== undefined && Number.isFinite(item.value)
    ))
    .sort((a, b) => direction === "max" ? b.value - a.value : a.value - b.value);

  const winner = ranked[0];
  if (!winner) return null;

  return {
    channel: winner.channel,
    asset: findAssetForChannel(winner.channel, assets),
    value: winner.value,
  };
}

function buildChannelChartRows(
  channels: ChannelOverviewRow[],
  assets: MarketAsset[],
  selector: (row: ChannelOverviewRow) => number | null,
  valueFormatter: (value: number) => string,
  metaFormatter: (row: ChannelOverviewRow) => string
) {
  return channels
    .map((channel) => {
      const value = selector(channel);
      const asset = findAssetForChannel(channel, assets);
      if (value === null || value === undefined || Number.isNaN(value)) return null;
      return {
        key: channel.channel.youtube_channel_id,
        label: channel.channel.name || channel.channel.name_short || asset?.display_name || asset?.symbol || "—",
        iconSymbol: asset?.symbol || channel.channel.symbol || channel.channel.name.slice(0, 1) || "—",
        icon: asset?.icon ?? null,
        color: asset?.color ?? null,
        value,
        valueLabel: valueFormatter(value),
        meta: metaFormatter(channel),
      } satisfies ChannelChartRow;
    })
    .filter((row): row is ChannelChartRow => Boolean(row))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function ChannelMetricLabel({ card, fallback }: { card: ChannelMetricCard | null; fallback: string }) {
  if (!card) return <strong>{fallback}</strong>;

  return renderAssetLabel(
    card.asset
      ? {
          ...card.asset,
          display_name: card.channel.channel.name || card.asset.display_name,
        }
      : null,
    card.channel.channel.name || fallback
  );
}

function ChannelRankChart({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: ChannelChartRow[];
}) {
  const { theme } = useTheme();
  const maxValue = Math.max(...rows.map((row) => row.value), 0);

  return (
    <div className={styles.channelChartCard}>
      <div className={styles.channelChartHeader}>
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      </div>
      {maxValue > 0 ? (
        <div className={styles.channelBars}>
          {rows.map((row, index) => {
            const width = `${(row.value / maxValue) * 100}%`;
            return (
              <div key={row.key} className={styles.channelBarRow}>
                <div className={styles.channelBarHeader}>
                  <div className={styles.channelBarLabel}>
                    <span className={styles.channelBarRank}>{index + 1}</span>
                    <AssetCoin
                      symbol={row.iconSymbol}
                      icon={row.icon}
                      color={row.color}
                      className={styles.channelBarIcon}
                    />
                    <span className={styles.channelBarName}>{row.label}</span>
                  </div>
                  <span className={styles.channelBarValue}>{row.valueLabel}</span>
                </div>
                <div className={styles.channelBarTrack}>
                  <div
                    className={styles.channelBarFill}
                    style={{
                      "--channel-bar-width": width,
                      "--channel-bar-color": getUsableChannelColor(row.color, theme) || "#f97316",
                    } as CSSProperties}
                  />
                </div>
                <span className={styles.channelBarMeta}>{row.meta}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.sectionEmpty}>No channel ranking data available.</div>
      )}
    </div>
  );
}

export function HomePage() {
  const { user, refreshSession } = useAuth();
  const [siteStats, setSiteStats] = useState<SiteStats | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<number | null>(null);
  const [channelOverviewRows, setChannelOverviewRows] = useState<OverviewRow[]>([]);
  const [channelOverviewError, setChannelOverviewError] = useState<string | null>(null);
  const assets = useMarketStore((state) => state.assets);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
  const report = useMarketStore((state) => state.report);
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const isLoadingIndex = useMarketStore((state) => state.isLoadingIndex);
  const error = useMarketStore((state) => state.error);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const fetchMarketIndexes = useMarketStore((state) => state.fetchMarketIndexes);

  const livestreamItems = useLivestreamStore((state) => state.items);
  const livestreamError = useLivestreamStore((state) => state.error);
  const fetchLivestreams = useLivestreamStore((state) => state.fetchLivestreams);

  const newsItems = useNewsStore((state) => state.items);
  const newsError = useNewsStore((state) => state.error);
  const fetchNews = useNewsStore((state) => state.fetchNews);

  const channels = useChannelStore((state) => state.channels);
  const fetchChannels = useChannelStore((state) => state.fetchChannels);

  const leaderboardEntries = useLeaderboardStore((state) => state.entries);
  const leaderboardError = useLeaderboardStore((state) => state.error);
  const fetchLeaderboard = useLeaderboardStore((state) => state.fetchLeaderboard);

  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const clearPortfolio = useProfileStore((state) => state.clearPortfolio);
  const portfolio = useProfileStore((state) => state.portfolio);
  const isLoadingPortfolio = useProfileStore((state) => state.isLoadingPortfolio);
  const portfolioError = useProfileStore((state) => state.portfolioError);
  const [communityArticles, setCommunityArticles] = useState<ArticleSummary[]>([]);
  const homepageNewsLayout = useMemo(() => partitionHomepageNewsItems(newsItems), [newsItems]);

  const featuredHoldings = [...(portfolio?.holdings || [])]
    .sort((a, b) => b.market_value - a.market_value)
    .slice(0, 4);
  const homepageLeaderboard = leaderboardEntries.length
    ? leaderboardEntries.slice(0, 5)
    : [...assets]
      .sort((a, b) => (b.current_mid_price ?? 0) - (a.current_mid_price ?? 0))
      .slice(0, 5)
      .map((asset, index) => ({
        id: asset.symbol,
        rank: index + 1,
        label: `${asset.symbol} Syndicate`,
        username: `${asset.symbol} Syndicate`,
        profile_picture_url: null,
        profile_color: asset.color || null,
        total_equity: (asset.current_mid_price ?? 0) * (125000 - index * 11000),
        cash_balance: (asset.current_mid_price ?? 0) * (22000 - index * 1200),
        change_pct: computeDailyPriceChangePct(asset.current_mid_price, asset.sparkline_candles),
        largest_position: {
          symbol: asset.symbol,
          value: (asset.current_mid_price ?? 0) * (86000 - index * 9000),
        },
        best_asset: {
          symbol: asset.symbol,
        },
        badges: index === 0 ? ["Whale", "On Fire"] : index === 1 ? ["Diamond Hands"] : [],
      }));
  const leaderboardLeader = homepageLeaderboard[0] || null;
  const topSubscribers = [...channels].sort((a, b) => (b.latest?.subscriber_count ?? 0) - (a.latest?.subscriber_count ?? 0))[0] || null;
  const topViews = [...channels].sort((a, b) => (b.latest?.view_count ?? 0) - (a.latest?.view_count ?? 0))[0] || null;
  const topVideos = [...channels].sort((a, b) => (b.latest?.video_count ?? 0) - (a.latest?.video_count ?? 0))[0] || null;
  const topUnderdogChannel = [...channels]
    .filter((channel) => channel.latest?.subscriber_count !== null)
    .sort((a, b) => (a.latest?.subscriber_count ?? 0) - (b.latest?.subscriber_count ?? 0))[0] || null;
  const marketTopPrice = [...assets].sort((a, b) => (b.current_mid_price ?? 0) - (a.current_mid_price ?? 0))[0] || null;
  const marketTopVolume = [...assets].sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))[0] || null;
  const marketTopMover = [...assets]
    .sort((a, b) => Math.abs(computeDailyPriceChangePct(b.current_mid_price, b.sparkline_candles) ?? 0) - Math.abs(computeDailyPriceChangePct(a.current_mid_price, a.sparkline_candles) ?? 0))[0] || null;
  const richPremiumRow = report?.largest_premiums?.[0] || null;
  const deepDiscountRow = report?.largest_discounts?.[0] || null;
  const richPremiumAsset = richPremiumRow ? assets.find((asset) => asset.symbol === richPremiumRow.symbol) || null : null;
  const deepDiscountAsset = deepDiscountRow ? assets.find((asset) => asset.symbol === deepDiscountRow.symbol) || null : null;
  const topSubscribersAsset = topSubscribers ? findAssetForChannel(topSubscribers, assets) : null;
  const topViewsAsset = topViews ? findAssetForChannel(topViews, assets) : null;
  const topVideosAsset = topVideos ? findAssetForChannel(topVideos, assets) : null;
  const topUnderdogChannelAsset = topUnderdogChannel ? findAssetForChannel(topUnderdogChannel, assets) : null;
  const leastSubscribers = useMemo(
    () => buildChannelMetricCard(channels, assets, (row) => row.latest?.subscriber_count ?? null, "min"),
    [assets, channels]
  );
  const leastViews = useMemo(
    () => buildChannelMetricCard(channels, assets, (row) => row.latest?.view_count ?? null, "min"),
    [assets, channels]
  );
  const leastVideos = useMemo(
    () => buildChannelMetricCard(channels, assets, (row) => row.latest?.video_count ?? null, "min"),
    [assets, channels]
  );
  const topViewsPerVideo = useMemo(
    () => buildChannelMetricCard(
      channels,
      assets,
      (row) => {
        const views = row.latest?.view_count ?? null;
        const videos = row.latest?.video_count ?? null;
        if (views === null || videos === null || videos <= 0) return null;
        return views / videos;
      },
      "max"
    ),
    [assets, channels]
  );
  const subscriberChartRows = useMemo(
    () => buildChannelChartRows(
      channels,
      assets,
      (row) => row.latest?.subscriber_count ?? null,
      (value) => fmtInteger(value),
      (row) => `${fmtInteger(row.latest?.video_count ?? null)} uploads`
    ),
    [assets, channels]
  );
  const viewChartRows = useMemo(
    () => buildChannelChartRows(
      channels,
      assets,
      (row) => row.latest?.view_count ?? null,
      (value) => fmtInteger(value),
      (row) => `${fmtInteger(row.latest?.subscriber_count ?? null)} subscribers`
    ),
    [assets, channels]
  );
  const streakChartRows = useMemo(() => {
    return channelOverviewRows
      .map((row) => {
        const streak = computeCurrentUploadStreak(row.series || []);
        const channel = channels.find((item) => item.channel.youtube_channel_id === row.channel.youtube_channel_id) || null;
        const asset = channel ? findAssetForChannel(channel, assets) : null;
        const latest = latestSeriesPoint(row.series || []);
        if (!channel || streak <= 0) return null;
        return {
          key: row.channel.youtube_channel_id,
          label: channel.channel.name || channel.channel.name_short || asset?.display_name || asset?.symbol || "—",
          iconSymbol: asset?.symbol || channel.channel.symbol || channel.channel.name.slice(0, 1) || "—",
          icon: asset?.icon ?? null,
          color: asset?.color ?? null,
          value: streak,
          valueLabel: `${streak} day${streak === 1 ? "" : "s"}`,
          meta: latest?.time ? `Last activity ${latest.time.slice(0, 10)}` : "Latest channel snapshot",
        } satisfies ChannelChartRow;
      })
      .filter((row): row is ChannelChartRow => Boolean(row))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [assets, channelOverviewRows, channels]);
  const allMarketIndex = useMemo(
    () => marketIndexes.find((index) => index.group === "all") || marketIndexes[0] || null,
    [marketIndexes]
  );
  const recentAllMarketSeries = useMemo(() => {
    if (!allMarketIndex) return [];
    const cutoffTime = getMonthsAgoDate(4).getTime();

    return allMarketIndex.series.filter((point) => {
      if (!point.bucket) return false;
      const timestamp = new Date(point.bucket).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoffTime;
    });
  }, [allMarketIndex]);
  const tapeSentence = richPremiumRow
    ? `${richPremiumRow.symbol} carries the richest premium at ${fmtPct(richPremiumRow.premium_pct)}, while ${marketTopMover?.symbol || "the tape"} leads today's move.`
    : `${marketTopMover?.symbol || "The tape"} is setting the pace across ${fmtInteger(assets.length)} tracked assets.`;

  useEffect(() => {
    void (async () => {
      const nextUser = await refreshSession();
      const results = await Promise.allSettled([
        refreshOverview(),
        fetchLivestreams(),
        fetchNews(),
        fetchChannels(),
        fetchLeaderboard(),
        apiFetch<OverviewRow[]>("/api/overview/timeseries?days=60&limit=120", { cache: "no-store" }),
      ]);

      const timeseriesResult = results[5];
      if (timeseriesResult?.status === "fulfilled") {
        setChannelOverviewRows(timeseriesResult.value || []);
        setChannelOverviewError(null);
      } else if (timeseriesResult?.status === "rejected") {
        setChannelOverviewRows([]);
        setChannelOverviewError(String((timeseriesResult.reason as Error)?.message || timeseriesResult.reason));
      }

      if (nextUser) {
        await fetchPortfolio();
      } else {
        clearPortfolio();
      }

      try {
        const articleResult = await apiFetch<Record<string, unknown>>("/api/articles?type=community&limit=3");
        setCommunityArticles(normalizeArticleListResponse(articleResult).items);
      } catch {
        setCommunityArticles([]);
      }
    })();
  }, [clearPortfolio, fetchChannels, fetchLeaderboard, fetchLivestreams, fetchNews, fetchPortfolio, refreshOverview, refreshSession]);

  useEffect(() => {
    if (marketIndexes.length || isLoadingIndex) return;
    void fetchMarketIndexes();
  }, [fetchMarketIndexes, isLoadingIndex, marketIndexes.length]);

  useEffect(() => {
    let cancelled = false;

    void apiFetch<SiteStats>("/api/stats")
      .then((result) => {
        if (!cancelled) {
          setSiteStats(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSiteStats(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const wsUrl = getSiteStatsWsUrl();
    if (!wsUrl || typeof window === "undefined") return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      socket = new WebSocket(wsUrl);

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as { type?: string; online_users?: number };
          if (message.type !== "online_count" || typeof message.online_users !== "number") return;
          setOnlineUsers(message.online_users);
        } catch {
          // ignore malformed websocket payloads
        }
      };

      socket.onclose = () => {
        socket = null;
        if (disposed) return;
        reconnectTimer = window.setTimeout(connect, 2000);
      };

      socket.onerror = () => {
        try {
          socket?.close();
        } catch {}
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      try {
        socket?.close();
      } catch {}
    };
  }, []);

  return (
    <SiteShell>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderBg}>
          <Image src="/hero-image-12.jpg" alt="" width={2500} height={1643} />
        </div>
        <div className={styles.heroCopy}>
          <span className={styles.heroEyebrow}>ogey?</span>
          <h1 className={styles.heroTitle}>
            <Image src="/android-chrome-512x512.png" alt="" width={512} height={512} />
            NASFAQ
          </h1>
          <p className={styles.heroText}>
            Home of numbers.
          </p>
          <div className={styles.heroActions}>
            <Link href="/finance/activity" className={styles.heroActionPrimary}>Open market desk</Link>
            <Link href="/finance/rankings" className={styles.heroAction}>View rankings</Link>
            <Link href="/market" className={styles.heroAction}>Read report</Link>
          </div>
        </div>
        <div className={styles.heroPanel}>
          <div className={styles.heroPanelTop}>
            <span>Session</span>
            <strong>{formatSessionDate(marketStatus?.current_market_date || report?.market_date)}</strong>
          </div>
          <div className={styles.liveStats}>
            <div className={styles.liveStat}>
              <div className={styles.liveStatValue}><MdPerson /> <strong>{fmtInteger(siteStats?.user_count ?? null)}</strong></div>
              <span>traders</span>
            </div>
            <div className={styles.liveStat}>
              <div className={styles.liveStatValue}><BsRecordCircle /> <strong>{fmtInteger(onlineUsers)}</strong></div>
              <span>online</span>
            </div>
            <div className={styles.liveStat}>
              <div className={styles.liveStatValue}><BsYoutube /> <strong>{fmtInteger(siteStats?.channel_count ?? null)}</strong></div>
              <span>channels</span>
            </div>
          </div>
        </div>
      </div>
      {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
      {isLoadingOverview ? <div className={styles.status}>Loading dashboard data…</div> : null}
      {marketStatus && !marketStatus.is_trading_open ? (
        <div className="statusMessage statusMessageWarn">
          <strong>Market closed.</strong> {marketStatus.trading_message || "Daily settlement is in progress."}
          {marketStatus.current_market_date ? ` Market date: ${marketStatus.current_market_date}.` : ""}
        </div>
      ) : null}
      {marketStatus?.last_cycle_error ? (
        <div className="statusMessage statusMessageWarn">
          <strong>Settlement warning.</strong> {marketStatus.last_cycle_error}
        </div>
      ) : null}

      <section className={styles.marketTape} aria-label="Market tape">
        <div className={styles.tapeLead}>
          <span>Daily tape</span>
          <strong>{tapeSentence}</strong>
        </div>
        <div className={styles.tapeStats}>
          <div className={styles.tapeStat}>
            <span>All Market</span>
            <strong>{fmtNumber(allMarketIndex?.summary?.index_value)}</strong>
          </div>
          <div className={styles.tapeStat}>
            <span>Breadth</span>
            <strong>{fmtInteger(allMarketIndex?.summary?.advancers)} / {fmtInteger(allMarketIndex?.summary?.decliners)}</strong>
          </div>
          <div className={styles.tapeStat}>
            <span>Top Mover</span>
            <strong>{marketTopMover?.symbol || "—"}</strong>
          </div>
          <div className={styles.tapeStat}>
            <span>Flow Leader</span>
            <strong>{marketTopVolume?.symbol || "—"}</strong>
          </div>
        </div>
      </section>

      <div className={styles.grid}>
        <div className={styles.leftColumn}>
          <NewsSection items={newsItems} error={newsError} />
          
          <section className={styles.dashboardSection}>
            <div className={styles.sectionHeader}>
              <div>
                <span className={styles.sectionEyebrow}>Finance surface</span>
                <h2 className={styles.title}>Market Pulse</h2>
                <p className={styles.copy}>A compact launchpad into pricing, rankings, and the latest settlement report.</p>
              </div>
              <div className={styles.sectionActions}>
                <Link href="/stocks" className={styles.sectionLink}>Stocks</Link>
                <Link href="/finance/rankings" className={styles.sectionLink}>Rankings</Link>
                <Link href="/market" className={styles.sectionLink}>Report</Link>
              </div>
            </div>
            <div className={styles.summaryHeroGrid}>
              <div className={styles.summaryHeroCard}>
                <span className={styles.walletLabel}>Highest Price</span>
                <strong className={styles.summaryHeroValue}>${fmtNumber(marketTopPrice?.current_mid_price ?? null)}</strong>
                <div className={styles.summaryHeroMeta}>
                  {renderAssetLabel(marketTopPrice)}
                  <span className={styles.positive}>{marketTopPrice?.symbol || "—"}</span>
                </div>
              </div>
              <div className={styles.summaryHeroCard}>
                <span className={styles.walletLabel}>Highest Flow</span>
                <strong className={styles.summaryHeroValueAlt}>{fmtNumber(marketTopVolume?.volume_24h ?? null)}</strong>
                <div className={styles.summaryHeroMeta}>
                  {renderAssetLabel(marketTopVolume)}
                  <span className={styles.neutral}>shares traded</span>
                </div>
              </div>
            </div>
            <div className={styles.channelSummaryGrid}>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Top Price</span>
                {renderAssetLabel(marketTopPrice, marketTopPrice?.symbol || "—")}
                <span>${fmtNumber(marketTopPrice?.current_mid_price ?? null)}</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Top Volume</span>
                {renderAssetLabel(marketTopVolume, marketTopVolume?.symbol || "—")}
                <span>{fmtNumber(marketTopVolume?.volume_24h ?? null)} shares</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Top Mover</span>
                {renderAssetLabel(marketTopMover, marketTopMover?.symbol || "—")}
                <span className={(computeDailyPriceChangePct(marketTopMover?.current_mid_price ?? null, marketTopMover?.sparkline_candles || []) ?? 0) >= 0 ? styles.positive : styles.negative}>
                  {marketTopMover ? fmtPct(computeDailyPriceChangePct(marketTopMover.current_mid_price, marketTopMover.sparkline_candles)) : "—"}
                </span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Rich Premium</span>
                {renderAssetLabel(richPremiumAsset || (richPremiumRow ? { symbol: richPremiumRow.symbol, display_name: richPremiumRow.display_name } : null), richPremiumRow?.symbol || "—")}
                <span className={richPremiumRow ? styles.positive : styles.neutral}>{fmtPct(richPremiumRow?.premium_pct)}</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Deep Discount</span>
                {renderAssetLabel(deepDiscountAsset || (deepDiscountRow ? { symbol: deepDiscountRow.symbol, display_name: deepDiscountRow.display_name } : null), deepDiscountRow?.symbol || "—")}
                <span className={deepDiscountRow ? styles.negative : styles.neutral}>{fmtPct(deepDiscountRow?.premium_pct)}</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Avg Move</span>
                <strong className={styles.summaryValueAccent}>
                  {assets.length
                    ? fmtPct(
                      assets.reduce((sum, asset) => sum + Math.abs(computeDailyPriceChangePct(asset.current_mid_price, asset.sparkline_candles) ?? 0), 0) / assets.length
                    )
                    : "—"}
                </strong>
                <span>Average absolute move across tracked assets</span>
              </div>
            </div>
            <div className={styles.marketIndexStrip}>
              <div className={styles.marketIndexChart}>
                <TrendChartCard
                  title="All Market Index"
                  subtitle={
                    allMarketIndex?.summary?.market_date
                      ? `${allMarketIndex.summary.market_date} · last 4 months`
                      : "Last 4 months"
                  }
                  series={[
                    {
                      name: "All Index",
                      color: "#7de7f2",
                      kind: "area",
                      values: recentAllMarketSeries.map((point) => ({ time: point.bucket, value: point.value })),
                    },
                  ]}
                />
              </div>
              <div className={styles.marketIndexStats} aria-label="All market index stats">
                <div className={styles.marketIndexStatCard}>
                  <span><FaGaugeHigh /></span>
                  <div>
                    <small>Level</small>
                    <strong>{fmtNumber(allMarketIndex?.summary?.index_value)}</strong>
                  </div>
                </div>
                <div className={styles.marketIndexStatCard}>
                  <span className={getToneClass(allMarketIndex?.summary?.total_return_pct)}><FaChartLine /></span>
                  <div>
                    <small>Range</small>
                    <strong className={getToneClass(allMarketIndex?.summary?.total_return_pct)}>
                      {fmtPct(allMarketIndex?.summary?.total_return_pct)}
                    </strong>
                  </div>
                </div>
                <div className={styles.marketIndexStatCard}>
                  <span><FaMoneyBillTrendUp /></span>
                  <div>
                    <small>Volume</small>
                    <strong>{fmtNumber(allMarketIndex?.summary?.total_volume_cash, "$")}</strong>
                  </div>
                </div>
                <div className={styles.marketIndexStatCard}>
                  <span className={getToneClass(allMarketIndex?.summary?.avg_premium_pct)}><HiSparkles /></span>
                  <div>
                    <small>Premium</small>
                    <strong className={getToneClass(allMarketIndex?.summary?.avg_premium_pct)}>
                      {fmtPct(allMarketIndex?.summary?.avg_premium_pct)}
                    </strong>
                  </div>
                </div>
                <div className={styles.marketIndexStatCard}>
                  <span className={getToneClass((allMarketIndex?.summary?.advancers ?? 0) - (allMarketIndex?.summary?.decliners ?? 0))}>
                    {(allMarketIndex?.summary?.day_return_pct ?? 0) >= 0 ? <FaArrowTrendUp /> : <FaArrowTrendDown />}
                  </span>
                  <div>
                    <small>Breadth</small>
                    <strong>
                      {fmtInteger(allMarketIndex?.summary?.advancers)} / {fmtInteger(allMarketIndex?.summary?.decliners)}
                    </strong>
                  </div>
                </div>
                <div className={styles.marketIndexStatCard}>
                  <span><FaRegCalendar /></span>
                  <div>
                    <small>Date</small>
                    <strong>{allMarketIndex?.summary?.market_date || (isLoadingIndex ? "Loading…" : "—")}</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>
          
          <section className={`${styles.dashboardSection} ${styles.creatorBoard}`}>
            <div className={styles.sectionHeader}>
              <div>
                <span className={styles.sectionEyebrow}>Creator market</span>
                <h2 className={styles.title}>YouTube Channel Board</h2>
                <p className={styles.copy}>Audience scale, lifetime reach, and upload pressure mapped back to tradable names.</p>
              </div>
            </div>
            <div className={styles.summaryHeroGrid}>
              <div className={styles.summaryHeroCard}>
                <span className={styles.walletLabel}>Leader by Subscribers</span>
                <strong className={styles.summaryHeroValue}>{fmtInteger(topSubscribers?.latest?.subscriber_count ?? null)}</strong>
                <div className={styles.summaryHeroMeta}>
                  {renderAssetLabel(
                    topSubscribersAsset
                      ? { ...topSubscribersAsset, display_name: topSubscribers?.channel.name || topSubscribersAsset.display_name }
                      : null,
                    topSubscribers?.channel.name || "—"
                  )}
                  <span className={styles.positive}>Audience scale leader</span>
                </div>
              </div>
              <div className={styles.summaryHeroCard}>
                <span className={styles.walletLabel}>Leader by Views</span>
                <strong className={styles.summaryHeroValueAlt}>{fmtInteger(topViews?.latest?.view_count ?? null)}</strong>
                <div className={styles.summaryHeroMeta}>
                  {renderAssetLabel(
                    topViewsAsset
                      ? { ...topViewsAsset, display_name: topViews?.channel.name || topViewsAsset.display_name }
                      : null,
                    topViews?.channel.name || "—"
                  )}
                  <span className={styles.neutral}>Total reach benchmark</span>
                </div>
              </div>
            </div>
            <div className={styles.channelSummaryGrid}>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Most Subscribers</span>
                {renderAssetLabel(
                  topSubscribersAsset
                    ? { ...topSubscribersAsset, display_name: topSubscribers?.channel.name || topSubscribersAsset.display_name }
                    : null,
                  topSubscribers?.channel.name || "—"
                )}
                <span>{fmtInteger(topSubscribers?.latest?.subscriber_count ?? null)}</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Most Views</span>
                {renderAssetLabel(
                  topViewsAsset
                    ? { ...topViewsAsset, display_name: topViews?.channel.name || topViewsAsset.display_name }
                    : null,
                  topViews?.channel.name || "—"
                )}
                <span>{fmtInteger(topViews?.latest?.view_count ?? null)}</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Least Subscribers</span>
                <ChannelMetricLabel card={leastSubscribers} fallback="—" />
                <span>{fmtInteger(leastSubscribers?.value ?? null)}</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Least Views</span>
                <ChannelMetricLabel card={leastViews} fallback="—" />
                <span>{fmtInteger(leastViews?.value ?? null)}</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Most Videos</span>
                {renderAssetLabel(
                  topVideosAsset
                    ? { ...topVideosAsset, display_name: topVideos?.channel.name || topVideosAsset.display_name }
                    : null,
                  topVideos?.channel.name || "—"
                )}
                <span>{fmtInteger(topVideos?.latest?.video_count ?? null)} uploads</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Top Underdog</span>
                {renderAssetLabel(
                  topUnderdogChannelAsset
                    ? { ...topUnderdogChannelAsset, display_name: topUnderdogChannel?.channel.name || topUnderdogChannelAsset.display_name }
                    : null,
                  topUnderdogChannel?.channel.name || "—"
                )}
                <span>{fmtInteger(topUnderdogChannel?.latest?.subscriber_count ?? null)} subscribers</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Least Videos</span>
                <ChannelMetricLabel card={leastVideos} fallback="—" />
                <span>{fmtInteger(leastVideos?.value ?? null)} uploads</span>
              </div>
              <div className={styles.summaryStatCard}>
                <span className={styles.walletLabel}>Best Views / Upload</span>
                <ChannelMetricLabel card={topViewsPerVideo} fallback="—" />
                <span>
                  {topViewsPerVideo ? `${fmtInteger(topViewsPerVideo.value)} views per upload` : "—"}
                </span>
              </div>
            </div>
            <div className={styles.channelChartsGrid}>
              <ChannelRankChart
                title="Top 5 by Subscribers"
                subtitle="Horizontal ranking from the latest channel snapshot."
                rows={subscriberChartRows}
              />
              <ChannelRankChart
                title="Top 5 by Views"
                subtitle="Lifetime view leaders with clean channel labels."
                rows={viewChartRows}
              />
            </div>
            <div className={styles.channelChartsGridSingle}>
              <ChannelRankChart
                title="Top Current Upload Streaks"
                subtitle="Consecutive days where video count increased in overview history."
                rows={streakChartRows}
              />
            </div>
            {channelOverviewError ? <div className={styles.sectionEmpty}>Channel history unavailable: {channelOverviewError}</div> : null}
          </section>
          
          <LivestreamSection items={livestreamItems} error={livestreamError} />
          <MarketReportSection report={report} assets={assets} />

          <div className={styles.lowerPageGrid}>
          <section className={`${styles.dashboardSection} ${styles.lowerPanel}`}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.title}>Leaderboard</h2>
                <p className={styles.copy}>A live preview of the richest portfolios on the exchange.</p>
              </div>
              <Link href="/leaderboard" className={styles.sectionLink}>View leaderboard</Link>
            </div>
            {leaderboardError && !leaderboardEntries.length ? <div className={styles.sectionEmpty}>Leaderboard unavailable: {leaderboardError}</div> : null}
            {leaderboardLeader ? (
              <div className={styles.rankHero}>
                <div className={styles.rankHeroLabel}>Top desk right now</div>
                <div className={styles.rankHeroValue}>{fmtNumber(leaderboardLeader.total_equity, "$")}</div>
                <div className={styles.rankHeroMeta}>
                  <span>#{leaderboardLeader.rank} {leaderboardLeader.label}</span>
                  <span className={(leaderboardLeader.change_pct ?? 0) >= 0 ? styles.positive : styles.negative}>
                    {leaderboardLeader.change_pct === null || leaderboardLeader.change_pct === undefined
                      ? "—"
                      : `${leaderboardLeader.change_pct > 0 ? "+" : ""}${fmtPct(leaderboardLeader.change_pct)}`}
                  </span>
                </div>
              </div>
            ) : null}
            <div className={styles.rankList}>
              {homepageLeaderboard.map((entry) => (
                <div key={entry.id} className={styles.rankRow}>
                  <div className={styles.rankBadge}>#{entry.rank}</div>
                  <div className={styles.rankMeta}>
                    <div className={styles.rankIdentity}>
                      <div
                        className={styles.rankAvatar}
                        style={entry.profile_color ? ({ "--rank-avatar-accent": entry.profile_color } as CSSProperties) : undefined}
                      >
                        {entry.profile_picture_url ? (
                          <img src={entry.profile_picture_url} alt="" className={styles.rankAvatarImage} />
                        ) : (
                          entry.label.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <strong>{entry.label}</strong>
                    </div>
                    <span>
                      {entry.largest_position
                        ? `Largest bag ${entry.largest_position.symbol} · ${fmtNumber(entry.largest_position.value, "$")}`
                        : entry.best_asset
                          ? `Best pick ${entry.best_asset.symbol}`
                          : "Portfolio preview"}
                    </span>
                    {entry.badges?.length ? (
                      <div className={styles.rankBadgeRow}>
                        {entry.badges.slice(0, 2).map((badge) => (
                          <span key={badge} className={styles.rankTag}>{badge}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.rankMetrics}>
                    <strong>{fmtNumber(entry.total_equity, "$")}</strong>
                    <span>{fmtNumber(entry.cash_balance, "$")} cash</span>
                    <span className={(entry.change_pct ?? 0) >= 0 ? styles.positive : styles.negative}>
                      {entry.change_pct === null || entry.change_pct === undefined ? "—" : `${entry.change_pct > 0 ? "+" : ""}${fmtPct(entry.change_pct)}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.rankPreviewFooter}>
              <span>Top 5 snapshot</span>
              <span>Open the full board for friends, rivals, podiums, and your exact rank.</span>
            </div>
          </section>

          <section className={styles.communityFloor}>
            <div className={styles.sectionHeader}>
              <div>
                <span className={styles.sectionEyebrow}>Community floor</span>
                <h2 className={styles.title}>Articles and Archive</h2>
                <p className={styles.copy}>Recent writeups and overflow headlines without stretching the home desk into a full archive.</p>
              </div>
              <div className={styles.sectionActions}>
                <Link href="/articles" className={styles.sectionLink}>Browse articles</Link>
                <Link href="/news" className={styles.sectionLink}>Full archive</Link>
              </div>
            </div>
            <div className={styles.communityGrid}>
              <div className={styles.communityPanel}>
                <div className={styles.miniHeader}>
                  <h3>Recent Community Articles</h3>
                  <span>{fmtInteger(communityArticles.length)} notes</span>
                </div>
                <div className={styles.articleGrid}>
                  {communityArticles.map((article) => (
                    <Link key={article.id} href={`/articles/${encodeURIComponent(article.slug)}`} className={styles.articleCard}>
                      <div className={styles.articleTopRow}>
                        <span className={styles.articleTag}>{article.tags[0] || "Article"}</span>
                        {article.related_assets[0] ? (
                          <AssetCoin
                            symbol={article.related_assets[0].symbol}
                            icon={article.related_assets[0].icon ?? null}
                            color={article.related_assets[0].color ?? null}
                            className={styles.articleIcon}
                          />
                        ) : null}
                      </div>
                      <strong className={styles.articleTitle}>{article.title}</strong>
                      <p className={styles.articleCopy}>{article.preview || article.subtitle || "Open the article to read the full writeup."}</p>
                    </Link>
                  ))}
                </div>
              </div>
              {homepageNewsLayout.overflowItems.length ? (
                <div className={styles.communityPanel}>
                  <div className={styles.miniHeader}>
                    <h3>More Recent News</h3>
                    <div className={styles.miniActions}>
                      <span>{fmtInteger(homepageNewsLayout.overflowItems.length)} headlines</span>
                      <Link href="/news">News archive</Link>
                    </div>
                  </div>
                  <CompactNewsGrid items={homepageNewsLayout.overflowItems} variant="twoColumn" />
                </div>
              ) : null}
            </div>
          </section>
          </div>

          <section className={styles.walletSection}>
            <div className={styles.walletHeader}>
              <div>
                <h2 className={styles.title}>Wallet Summary</h2>
                <p className={styles.copy}>
                  {user
                    ? ""
                    : "Sign in to load your balance, exposure, and live holdings on the home dashboard."}
                </p>
              </div>
              {featuredHoldings.length ? (
                <div className={styles.iconGrid} aria-hidden="true">
                  {featuredHoldings.map((holding) => {
                    const asset = assets.find((item) => item.symbol === holding.symbol);
                    return (
                      <AssetCoin
                        key={holding.asset_id}
                        symbol={holding.symbol}
                        icon={asset?.icon ?? null}
                        color={asset?.color ?? null}
                        className={styles.headerIcon}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>

            {!user ? (
              <div className={styles.walletEmpty}>
                <span>Account data is available after authentication.</span>
                <Link href="/login" className={styles.walletLink}>Login</Link>
              </div>
            ) : null}

            {user && isLoadingPortfolio ? <div className={styles.walletEmpty}>Loading wallet summary…</div> : null}
            {user && portfolioError ? <div className="statusMessage statusMessageError">Portfolio error: {portfolioError}</div> : null}

            {user && portfolio ? (
              <div className={styles.walletGrid}>
                <div className={styles.walletHeroCard}>
                  <span className={styles.walletEyebrow}>Net Account Value</span>
                  <strong className={styles.walletValue}>{fmtNumber(portfolio.total_equity)}</strong>
                  <div className={styles.walletSplit}>
                    <div className={styles.walletSplitItem}>
                      <span>Cash</span>
                      <strong>{fmtNumber(portfolio.cash_balance, "$")}</strong>
                    </div>
                    <div className={styles.walletSplitItem}>
                      <span>Invested</span>
                      <strong>{fmtNumber(portfolio.total_market_value, "$")}</strong>
                    </div>
                  </div>
                </div>

                <div className={styles.walletStats}>
                  <div className={styles.walletStatCard}>
                    <span className={styles.walletLabel}>Unrealized PnL</span>
                    <strong className={portfolio.total_unrealized_pnl >= 0 ? styles.positive : styles.negative}>
                      {fmtNumber(portfolio.total_unrealized_pnl, "$")}
                    </strong>
                  </div>
                  <div className={styles.walletStatCard}>
                    <span className={styles.walletLabel}>Open Positions</span>
                    <strong>{portfolio.holdings.length}</strong>
                  </div>
                  <div className={styles.walletStatCard}>
                    <span className={styles.walletLabel}>Largest Position</span>
                    <strong>{featuredHoldings[0]?.symbol || "—"}</strong>
                  </div>
                  <div className={styles.walletStatCard}>
                    <span className={styles.walletLabel}>Cash Weight</span>
                    <strong>
                      {portfolio.total_equity > 0 ? `${((portfolio.cash_balance / portfolio.total_equity) * 100).toFixed(1)}%` : "—"}
                    </strong>
                  </div>
                </div>

                <div className={styles.walletHoldingsCard}>
                  <div className={styles.walletHoldingsHeader}>
                    <h3 className={styles.walletSubheading}>Top Holdings</h3>
                  </div>

                  <div className={styles.walletHoldingsList}>
                    {featuredHoldings.length ? (
                      featuredHoldings.map((holding) => {
                        const asset = assets.find((item) => item.symbol === holding.symbol);
                        const weight = portfolio.total_market_value > 0
                          ? (holding.market_value / portfolio.total_market_value) * 100
                          : null;

                        return (
                          <div key={holding.asset_id} className={styles.walletHoldingRow}>
                            <div className={styles.walletHoldingMeta}>
                              <AssetCoin
                                symbol={holding.symbol}
                                icon={asset?.icon ?? null}
                                color={asset?.color ?? null}
                                className={styles.walletHoldingIcon}
                              />
                              <div>
                                <strong>{holding.symbol}</strong>
                                <span>{holding.display_name}</span>
                              </div>
                            </div>
                            <div className={styles.walletHoldingMetrics}>
                              <strong>{fmtNumber(holding.market_value)}</strong>
                              <span>{fmtNumber(holding.quantity)} shares</span>
                            </div>
                            <div className={styles.walletHoldingMetrics}>
                              <strong className={holding.unrealized_pnl >= 0 ? styles.positive : styles.negative}>
                                {fmtNumber(holding.unrealized_pnl)}
                              </strong>
                              <span>{weight === null ? "—" : `${weight.toFixed(1)}% portfolio`}</span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className={styles.walletEmpty}>No holdings in this account yet.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className={styles.rightColumn}>
          <MarketSidebar
            assets={assets}
            onSelectSymbol={setSelectedSymbol}
            compact
          />
        </div>
      </div>
    </SiteShell>
  );
}
