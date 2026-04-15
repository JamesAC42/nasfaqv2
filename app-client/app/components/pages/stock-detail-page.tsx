"use client";

import Link from "next/link";
import { FormEvent, Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import {
  CandleChartCard,
  RankedBarChartCard,
  SuperchatHeatmapCard,
  SuperchatHistogramCard,
  TrendChartCard,
  VolumeChartCard,
} from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { MarketSidebar } from "@/app/components/common/market-sidebar";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { createChannelChartTheme } from "@/app/lib/chart-theme";
import { getUsableChannelColor, normalizeHexColor } from "@/app/lib/color";
import { fmtDate, fmtDurationSeconds, fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { normalizeArticleListResponse, normalizeAssetSuperchatSummary, normalizeAssetSuperchatTimeseries, normalizeLivestreams } from "@/app/lib/normalizers";
import { getBucketWsUrl } from "@/app/lib/ws";
import type {
  ArticleSummary,
  AssetSuperchatSummaryBundle,
  AssetSuperchatTimeseriesBundle,
  ChannelOverviewRow,
  LivestreamItem,
  MarketAsset,
  PortfolioHolding,
} from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useChannelStore } from "@/app/stores/channel-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import shellStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/stock-detail-page.module.scss";
import { BsArrowDown, BsArrowUp, BsYoutube } from "react-icons/bs";
import { GoLinkExternal } from "react-icons/go";
import { FaArrowTrendDown, FaArrowTrendUp, FaChartColumn, FaDollarSign, FaEye, FaUsers, FaVideo, FaYenSign } from "react-icons/fa6";

const DETAIL_CHART_START_DATE = "2025-10-09";
const TRADE_CONFIRMATION_ANIMATION_MS = 280;
const TRADE_CONFIRMATION_BUY_IMAGES = [
  "/emojis/azki.jpg",
  "/emojis/nenethinking.jpg",
  "/emojis/polkaglove.jpg",
  "/emojis/watamehat.png",
] as const;
const TRADE_CONFIRMATION_SELL_LOSS_IMAGES = [
  "/emojis/ina.png",
  "/emojis/kroniiok.jpg",
  "/emojis/marineomg.jpg",
  "/emojis/miotired.jpg",
  "/emojis/ogey.jpg",
  "/emojis/pekorasad.jpg",
  "/emojis/suiseigun.jpg",
] as const;
const TRADE_CONFIRMATION_SELL_GAIN_IMAGES = [
  "/emojis/amemoney.jpg",
  "/emojis/fubukidab.jpg",
  "/emojis/kaijiwin.jpg",
  "/emojis/mikomoney.png",
  "/emojis/moriwine.jpg",
  "/emojis/pekoraboing.png",
] as const;
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
const DESCRIPTION_URL_PATTERN = /((https?:\/\/|www\.)[^\s<]+)/gi;

type LiveSessionResponse = {
  session: {
    video_id: string;
    youtube_channel_id: string;
    status: "upcoming" | "live" | "ended";
    video_title: string | null;
    thumbnail_url: string | null;
    scheduled_start_at: string | null;
    actual_start_at: string | null;
    ended_at: string | null;
    total_views: number | null;
    avg_concurrent_viewers: number | null;
    max_concurrent_viewers: number | null;
    duration_seconds: number | null;
    channel_name: string;
    channel_icon: string | null;
    channel_color: string | null;
  } | null;
};

type ViewerBucket = {
  bucket_start: string;
  bucket_end: string;
  duration_seconds: number;
  avg_viewers: number | null;
  max_viewers: number | null;
};

type BucketUpdate = {
  video_id: string;
  bucket_start: string;
  bucket_end: string;
  avg_viewers?: number | string | null;
  max_viewers?: number | string | null;
};

type TradeExecutionResult = {
  filled_quantity: number;
  executed_price: number;
  fee: number;
  total_cost?: number | null;
  total_proceeds?: number | null;
  cost_basis_sold?: number | null;
  realized_pnl?: number | null;
  side: "buy" | "sell";
  symbol: string;
  updated_holdings?: {
    quantity: number;
    avg_cost_basis: number;
  } | null;
  updated_cash_balance?: number | null;
  filled_at?: string | null;
};

type TradeConfirmation = {
  side: "buy" | "sell";
  symbol: string;
  filledQuantity: number;
  executedPrice: number;
  fee: number;
  grossValue: number;
  netCashImpact: number;
  totalCost: number | null;
  totalProceeds: number | null;
  costBasisSold: number | null;
  previousQuantity: number;
  previousAvgCost: number;
  nextQuantity: number;
  nextAvgCost: number;
  nextCashBalance: number | null;
  currentMidPrice: number | null;
  filledAt: string | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  imageSrc: string;
};

type HeroStat = {
  label: string;
  value: string;
  accent: boolean;
  tone?: "up" | "down";
  meta?: string;
};

type AssetSuperchatRank = {
  symbol: string;
  youtube_channel_id: string;
  range: string;
  total_in_yen: number | null;
  rank: number | null;
};

type RankSpotlight = {
  label: string;
  rank: number | null;
  value: string;
  icon: ReactNode;
};

type TradeFailureNotice = {
  title: string;
  message: string;
};

function pickRandomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSignedPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${fmtPct(value)}`;
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value), "$")}`;
}

function formatSignedNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value))}`;
}

function findAssetForChannel(channel: ChannelOverviewRow, assets: MarketAsset[]) {
  const channelId = channel.channel.youtube_channel_id?.trim();
  if (channelId) {
    const byChannelId = assets.find((asset) => asset.youtube_channel_id?.trim() === channelId) || null;
    if (byChannelId) return byChannelId;
  }

  const symbol = channel.channel.symbol?.trim().toUpperCase();
  if (symbol) {
    return assets.find((asset) => asset.symbol?.trim().toUpperCase() === symbol) || null;
  }

  return null;
}

function buildRankMap<T extends { key: string; value: number }>(items: T[]) {
  return new Map(
    [...items]
      .sort((a, b) => (b.value - a.value) || a.key.localeCompare(b.key))
      .map((item, index) => [item.key, index + 1] as const)
  );
}

function splitHeadline(headline: string) {
  const trimmed = headline.trim();
  if (!trimmed) return { title: "", subhead: null as string | null };

  const sentenceBreak = trimmed.match(/^(.{1,200}?[.!?])(?:\s+)(.+)$/);
  if (sentenceBreak) {
    return {
      title: sentenceBreak[1].trim(),
      subhead: sentenceBreak[2].trim() || null,
    };
  }

  if (trimmed.length <= 200) {
    return { title: trimmed, subhead: null as string | null };
  }

  const slice = trimmed.slice(0, 200);
  const naturalBreak = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf(": "),
    slice.lastIndexOf("; "),
    slice.lastIndexOf(", "),
    slice.lastIndexOf(" - "),
    slice.lastIndexOf(" ")
  );

  if (naturalBreak > 40) {
    return {
      title: slice.slice(0, naturalBreak + 1).trim(),
      subhead: trimmed.slice(naturalBreak + 1).trim() || null,
    };
  }

  return {
    title: slice.trim(),
    subhead: trimmed.slice(200).trim() || null,
  };
}

function computePriceDelta(value: number | null | undefined, movePct: number | null | undefined) {
  if (
    value === null ||
    value === undefined ||
    movePct === null ||
    movePct === undefined ||
    Number.isNaN(value) ||
    Number.isNaN(movePct) ||
    movePct <= -1
  ) {
    return null;
  }

  const previous = value / (1 + movePct);
  if (!Number.isFinite(previous)) return null;
  return value - previous;
}

function getTradeFailureNotice(errorCode: string, side: "buy" | "sell", symbol: string) {
  switch (errorCode) {
    case "insufficient_cash":
      return {
        title: "Not enough cash",
        message: `You do not have enough cash available to buy ${symbol}. Reduce the share count or add funds to your account balance.`,
      };
    case "insufficient_holdings":
      return {
        title: "Not enough shares",
        message: `You tried to sell more ${symbol} shares than you currently own. Lower the order size and try again.`,
      };
    case "market_closed":
      return {
        title: "Market is closed",
        message: "Trading is unavailable right now. Wait for the market to reopen, then submit the order again.",
      };
    case "invalid_quantity":
      return {
        title: "Invalid order size",
        message: `Enter a valid number of ${symbol} shares before submitting this ${side} order.`,
      };
    default:
      return {
        title: "Trade failed",
        message: `This ${side} order for ${symbol} could not be completed. Please try again.`,
      };
  }
}

function buildTradeConfirmation(args: {
  result: TradeExecutionResult;
  currentMidPrice: number | null | undefined;
  previousHolding: PortfolioHolding | null;
}): TradeConfirmation {
  const { result, currentMidPrice, previousHolding } = args;
  const previousQuantity = previousHolding?.quantity ?? 0;
  const previousAvgCost = previousHolding?.avg_cost_basis ?? 0;
  const grossValue = result.filled_quantity * result.executed_price;
  const nextQuantity = result.updated_holdings?.quantity ?? (result.side === "buy" ? previousQuantity + result.filled_quantity : previousQuantity - result.filled_quantity);
  const nextAvgCost = result.updated_holdings?.avg_cost_basis ?? (nextQuantity > 0 ? previousAvgCost : 0);
  const totalCost = result.total_cost ?? (result.side === "buy" ? grossValue + result.fee : null);
  const totalProceeds = result.total_proceeds ?? (result.side === "sell" ? grossValue - result.fee : null);
  const costBasisSold = result.cost_basis_sold ?? (result.side === "sell" ? previousAvgCost * result.filled_quantity : null);
  const netCashImpact = result.side === "buy" ? -(totalCost ?? (grossValue + result.fee)) : (totalProceeds ?? (grossValue - result.fee));
  const realizedPnl =
    result.side === "sell"
      ? (result.realized_pnl ?? ((totalProceeds ?? (grossValue - result.fee)) - (costBasisSold ?? 0)))
      : null;
  const unrealizedPnl =
    currentMidPrice !== null && currentMidPrice !== undefined && nextQuantity > 0
      ? nextQuantity * (currentMidPrice - nextAvgCost)
      : null;
  const imageSrc =
    result.side === "buy"
      ? pickRandomItem(TRADE_CONFIRMATION_BUY_IMAGES)
      : (realizedPnl ?? 0) >= 0
        ? pickRandomItem(TRADE_CONFIRMATION_SELL_GAIN_IMAGES)
        : pickRandomItem(TRADE_CONFIRMATION_SELL_LOSS_IMAGES);

  return {
    side: result.side,
    symbol: result.symbol,
    filledQuantity: result.filled_quantity,
    executedPrice: result.executed_price,
    fee: result.fee,
    grossValue,
    netCashImpact,
    totalCost,
    totalProceeds,
    costBasisSold,
    previousQuantity,
    previousAvgCost,
    nextQuantity,
    nextAvgCost,
    nextCashBalance: result.updated_cash_balance ?? null,
    currentMidPrice: currentMidPrice ?? null,
    filledAt: result.filled_at ?? null,
    realizedPnl,
    unrealizedPnl,
    imageSrc,
  };
}

function formatCurrencyLabel(currencyCode: string) {
  return currencyCode.trim().toUpperCase();
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

function toChartTime(value: string): Time | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000) as Time;
}

type ChartPoint = { time: Time; value: number };

function smoothSeriesData(points: ChartPoint[]) {
  if (points.length < 3) return points;

  const smoothed: ChartPoint[] = [];
  const segments = 6;

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];

    if (index === 0) {
      smoothed.push(p1);
    }

    for (let step = 1; step < segments; step += 1) {
      const t = step / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      const value =
        0.5 *
        ((2 * p1.value) +
          (-p0.value + p2.value) * t +
          (2 * p0.value - 5 * p1.value + 4 * p2.value - p3.value) * t2 +
          (-p0.value + 3 * p1.value - 3 * p2.value + p3.value) * t3);
      const rawTime = Number(p1.time) + (Number(p2.time) - Number(p1.time)) * t;
      const roundedTime = Math.round(rawTime);
      const previousTime = Number(smoothed[smoothed.length - 1]?.time ?? 0);
      const nextTime = (roundedTime > previousTime ? roundedTime : previousTime + 1) as Time;

      smoothed.push({
        time: nextTime,
        value: Math.max(0, value),
      });
    }

    smoothed.push(p2);
  }

  return smoothed;
}

function mergeBucketsByStart(prev: ViewerBucket[], incoming: ViewerBucket[]) {
  if (!prev.length) return incoming;
  if (!incoming.length) return prev;
  const byStart = new Map(prev.map((item) => [item.bucket_start, item]));
  for (const bucket of incoming) {
    const existing = byStart.get(bucket.bucket_start);
    byStart.set(bucket.bucket_start, existing ? { ...existing, ...bucket } : bucket);
  }
  return [...byStart.values()].sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
}

function resolveChartFontFamily() {
  if (typeof window !== "undefined") {
    const computed = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    if (computed) return computed;
  }
  return "'Nasfaq Mono', 'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace";
}

function resolveCssVar(name: string, fallback: string) {
  if (typeof window !== "undefined") {
    const computed = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (computed) return computed;
  }
  return fallback;
}

function LiveViewerChart({ buckets, accentColor }: { buckets: ViewerBucket[]; accentColor: string }) {
  const chartRef = useRef<IChartApi | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const avgSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const maxSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const { theme: colorMode } = useTheme();
  const channelChartTheme = useMemo(() => createChannelChartTheme(accentColor), [accentColor]);
  const maxLineColor = useMemo(
    () => getUsableChannelColor(accentColor, colorMode) || accentColor,
    [accentColor, colorMode]
  );
  const avgLineColor = useMemo(
    () =>
      getUsableChannelColor(
        channelChartTheme.baseMuted,
        colorMode,
        colorMode === "light" ? { maxLightLuminance: 0.34 } : undefined
      ) || channelChartTheme.baseMuted,
    [channelChartTheme.baseMuted, colorMode]
  );

  const avgData = useMemo(() => {
    const points = buckets
      .map((bucket) => {
        const time = toChartTime(bucket.bucket_end);
        if (!time || bucket.avg_viewers === null) return null;
        return { time, value: bucket.avg_viewers };
      })
      .filter(Boolean) as ChartPoint[];
    return smoothSeriesData(points);
  }, [buckets]);

  const maxData = useMemo(() => {
    const points = buckets
      .map((bucket) => {
        const time = toChartTime(bucket.bucket_end);
        if (!time || bucket.max_viewers === null) return null;
        return { time, value: bucket.max_viewers };
      })
      .filter(Boolean) as ChartPoint[];
    return smoothSeriesData(points);
  }, [buckets]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 250,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: resolveCssVar("--text", channelChartTheme.text),
        fontFamily: resolveChartFontFamily(),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: channelChartTheme.grid },
        horzLines: { color: channelChartTheme.grid },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderVisible: false,
      },
      crosshair: {
        vertLine: { color: channelChartTheme.crosshairSoft, width: 1 },
        horzLine: { color: channelChartTheme.crosshairSoft, width: 1 },
      },
    });

    const avgSeries = chart.addSeries(LineSeries, {
      color: avgLineColor,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    const maxSeries = chart.addSeries(LineSeries, {
      color: maxLineColor,
      lineWidth: 3,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    avgSeriesRef.current = avgSeries;
    maxSeriesRef.current = maxSeries;

    return () => {
      chartRef.current = null;
      avgSeriesRef.current = null;
      maxSeriesRef.current = null;
      chart.remove();
    };
  }, [avgLineColor, channelChartTheme.crosshairSoft, channelChartTheme.grid, channelChartTheme.text, maxLineColor]);

  useEffect(() => {
    if (!avgSeriesRef.current || !maxSeriesRef.current) return;
    avgSeriesRef.current.applyOptions({ color: avgLineColor });
    maxSeriesRef.current.applyOptions({ color: maxLineColor });
  }, [avgLineColor, maxLineColor]);

  useEffect(() => {
    if (!avgSeriesRef.current || !maxSeriesRef.current || !chartRef.current) return;
    avgSeriesRef.current.setData(avgData);
    maxSeriesRef.current.setData(maxData);
    chartRef.current.timeScale().fitContent();
  }, [avgData, avgLineColor, maxData, maxLineColor]);

  return buckets.length
    ? <div ref={containerRef} className={styles.liveChartCanvas} />
    : <div className={styles.liveChartEmpty}>No viewer buckets yet.</div>;
}

function renderSkeletonLines(count: number, className?: string) {
  return Array.from({ length: count }, (_, index) => (
    <span
      key={`skeleton:${index}`}
      className={[styles.skeletonBlock, styles.skeletonLine, className || ""].filter(Boolean).join(" ")}
      aria-hidden="true"
    />
  ));
}

function normalizeDescriptionHref(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function renderDescriptionContent(text: string) {
  return text.split(/\r?\n/).map((line, lineIndex, lines) => {
    const matches = Array.from(line.matchAll(DESCRIPTION_URL_PATTERN));
    let cursor = 0;

    return (
      <Fragment key={`description-line:${lineIndex}`}>
        {matches.map((match, matchIndex) => {
          const url = match[0];
          const start = match.index ?? 0;
          const prefix = line.slice(cursor, start);
          cursor = start + url.length;

          return (
            <Fragment key={`description-link:${lineIndex}:${matchIndex}`}>
              {prefix}
              <a href={normalizeDescriptionHref(url)} target="_blank" rel="noreferrer" className={styles.heroDescriptionLink}>
                {url}
              </a>
            </Fragment>
          );
        })}
        {line.slice(cursor)}
        {lineIndex < lines.length - 1 ? "\n" : null}
      </Fragment>
    );
  });
}

function LiveDurationValue({
  actualStartAt,
  durationSeconds,
}: {
  actualStartAt: string | null | undefined;
  durationSeconds: number | null | undefined;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!actualStartAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [actualStartAt]);

  const liveDurationSeconds = actualStartAt
    ? Math.max(0, Math.floor((nowMs - new Date(actualStartAt).getTime()) / 1000))
    : durationSeconds ?? null;

  return <strong>{fmtDurationSeconds(liveDurationSeconds)}</strong>;
}

export function StockDetailPage({ symbol }: { symbol: string }) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const { theme: colorMode } = useTheme();
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
  const channels = useChannelStore((state) => state.channels);
  const fetchChannels = useChannelStore((state) => state.fetchChannels);
  const channelError = useChannelStore((state) => state.error);
  const portfolio = useProfileStore((state) => state.portfolio);
  const isLoadingPortfolio = useProfileStore((state) => state.isLoadingPortfolio);
  const portfolioError = useProfileStore((state) => state.portfolioError);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const clearPortfolio = useProfileStore((state) => state.clearPortfolio);
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeQuantity, setTradeQuantity] = useState("10");
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [tradeFailureNotice, setTradeFailureNotice] = useState<TradeFailureNotice | null>(null);
  const [tradeConfirmation, setTradeConfirmation] = useState<TradeConfirmation | null>(null);
  const [isTradeConfirmationClosing, setIsTradeConfirmationClosing] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [channelStreams, setChannelStreams] = useState<{ live: LivestreamItem[]; upcoming: LivestreamItem[] }>({
    live: [],
    upcoming: [],
  });
  const [livestreamError, setLivestreamError] = useState<string | null>(null);
  const [isLoadingLivestreams, setIsLoadingLivestreams] = useState(false);
  const [liveSession, setLiveSession] = useState<LiveSessionResponse["session"]>(null);
  const [liveBuckets, setLiveBuckets] = useState<ViewerBucket[]>([]);
  const [liveSessionError, setLiveSessionError] = useState<string | null>(null);
  const [isLoadingLiveSession, setIsLoadingLiveSession] = useState(false);
  const [superchatSummary, setSuperchatSummary] = useState<AssetSuperchatSummaryBundle | null>(null);
  const [superchatRank, setSuperchatRank] = useState<AssetSuperchatRank | null>(null);
  const [superchatError, setSuperchatError] = useState<string | null>(null);
  const [isLoadingSuperchats, setIsLoadingSuperchats] = useState(false);
  const [superchatTimeseriesRange, setSuperchatTimeseriesRange] = useState<(typeof SUPERCHAT_TIMESERIES_OPTIONS)[number]["value"]>("7d");
  const [superchatTimeseries, setSuperchatTimeseries] = useState<AssetSuperchatTimeseriesBundle | null>(null);
  const [relatedArticles, setRelatedArticles] = useState<ArticleSummary[]>([]);
  const [superchatTimeseriesError, setSuperchatTimeseriesError] = useState<string | null>(null);
  const [isLoadingSuperchatTimeseries, setIsLoadingSuperchatTimeseries] = useState(false);
  const [deferredReadySymbol, setDeferredReadySymbol] = useState<string | null>(null);
  const tradeConfirmationCloseTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  useEffect(() => {
    if (!tradeConfirmation && !isTradeConfirmationClosing) return;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTradeConfirmation();
      }
    };

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTradeConfirmationClosing, tradeConfirmation]);

  useEffect(() => () => {
    if (tradeConfirmationCloseTimerRef.current !== null) {
      globalThis.clearTimeout(tradeConfirmationCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    void refreshOverview();
    void fetchChannels();
  }, [fetchChannels, refreshOverview, refreshSession]);

  useEffect(() => {
    if (user) {
      void fetchPortfolio();
      return;
    }
    clearPortfolio();
  }, [clearPortfolio, fetchPortfolio, user]);

  useEffect(() => {
    setSelectedSymbol(normalizedSymbol);
    void fetchAssetDetail(normalizedSymbol);
  }, [fetchAssetDetail, normalizedSymbol, setSelectedSymbol]);

  useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [normalizedSymbol]);

  useEffect(() => {
    setDeferredReadySymbol(null);

    if (typeof window === "undefined") {
      setDeferredReadySymbol(normalizedSymbol);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    let idleId: number | null = null;
    const complete = () => {
      if (!cancelled) {
        setDeferredReadySymbol(normalizedSymbol);
      }
    };

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(complete, { timeout: 250 }) as unknown as number;
    } else {
      timeoutId = globalThis.setTimeout(complete, 80);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, [normalizedSymbol]);

  const selectedAsset = useMemo(
    () => assets.find((item) => item.symbol.toUpperCase() === normalizedSymbol) || null,
    [assets, normalizedSymbol]
  );
  const selectedChannel = useMemo(() => {
    if (selectedAsset?.youtube_channel_id) {
      const byId = channels.find((item) => item.channel.youtube_channel_id === selectedAsset.youtube_channel_id) || null;
      if (byId) return byId;
    }

    return channels.find((item) => item.channel.symbol?.trim().toUpperCase() === normalizedSymbol) || null;
  }, [channels, normalizedSymbol, selectedAsset?.youtube_channel_id]);
  const selectedHolding = useMemo(
    () => portfolio?.holdings.find((holding) => holding.symbol.toUpperCase() === normalizedSymbol) || null,
    [normalizedSymbol, portfolio?.holdings]
  );
  const ownedShares = selectedHolding?.quantity ?? 0;
  const estimatedPositionValue = selectedHolding?.market_value ?? ((selectedAsset?.current_mid_price ?? 0) * ownedShares);
  const themeSafeAssetColor = useMemo(
    () => getUsableChannelColor(selectedAsset?.color, colorMode) || selectedAsset?.color || null,
    [colorMode, selectedAsset?.color]
  );
  const chartTheme = useMemo(() => createChannelChartTheme(themeSafeAssetColor), [themeSafeAssetColor]);
  const chartPalette = chartTheme.categorical;
  const channelProfileImage = selectedChannel?.channel.channel_asset_icon_url?.trim() || null;
  const channelBannerImage = selectedChannel?.channel.channel_asset_banner_url?.trim() || null;

  useEffect(() => {
    const channelId = selectedAsset?.youtube_channel_id?.trim() || "";
    if (!channelId) {
      setChannelStreams({ live: [], upcoming: [] });
      setLivestreamError(null);
      setIsLoadingLivestreams(false);
      setSuperchatSummary(null);
      setSuperchatRank(null);
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
      } catch (nextError) {
        if (cancelled) return;
        setChannelStreams({ live: [], upcoming: [] });
        setLivestreamError(String((nextError as Error).message || nextError));
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
        const [summaryResult, rankResult] = await Promise.all([
          apiFetch<Record<string, unknown>>(
            `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/superchats?range=7d`
          ),
          apiFetch<AssetSuperchatRank>(
            `/api/market/assets/${encodeURIComponent(normalizedSymbol)}/superchat-rank?range=7d`
          ),
        ]);
        if (cancelled) return;
        setSuperchatSummary(normalizeAssetSuperchatSummary(summaryResult));
        setSuperchatRank({
          symbol: String(rankResult.symbol || normalizedSymbol),
          youtube_channel_id: String(rankResult.youtube_channel_id || channelId),
          range: String(rankResult.range || "7d"),
          total_in_yen: toNumber(rankResult.total_in_yen),
          rank: toNumber(rankResult.rank),
        });
      } catch (nextError) {
        if (cancelled) return;
        setSuperchatSummary(null);
        setSuperchatRank(null);
        setSuperchatError(String((nextError as Error).message || nextError));
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
  }, [normalizedSymbol, selectedAsset?.youtube_channel_id]);

  useEffect(() => {
    const channelId = selectedAsset?.youtube_channel_id?.trim() || "";
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
      } catch (nextError) {
        if (cancelled) return;
        setSuperchatTimeseries(null);
        setSuperchatTimeseriesError(String((nextError as Error).message || nextError));
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
  }, [normalizedSymbol, selectedAsset?.youtube_channel_id, superchatTimeseriesRange]);

  useEffect(() => {
    const activeLiveId = channelStreams.live[0]?.id;
    if (!activeLiveId) {
      setLiveSession(null);
      setLiveBuckets([]);
      setLiveSessionError(null);
      setIsLoadingLiveSession(false);
      return;
    }

    let cancelled = false;

    async function fetchLiveSession() {
      setIsLoadingLiveSession(true);
      setLiveSessionError(null);

      try {
        const [sessionResult, bucketsResult] = await Promise.all([
          apiFetch<LiveSessionResponse>(`/api/livestreams/${encodeURIComponent(activeLiveId)}`),
          apiFetch<{ buckets: ViewerBucket[] }>(`/api/livestreams/${encodeURIComponent(activeLiveId)}/buckets`),
        ]);
        if (cancelled) return;

        setLiveSession(sessionResult.session);
        setLiveBuckets(
          (bucketsResult.buckets || []).map((bucket) => ({
            ...bucket,
            avg_viewers: toNumber(bucket.avg_viewers),
            max_viewers: toNumber(bucket.max_viewers),
          }))
        );
      } catch (nextError) {
        if (cancelled) return;
        setLiveSession(null);
        setLiveBuckets([]);
        setLiveSessionError(String((nextError as Error).message || nextError));
      } finally {
        if (!cancelled) {
          setIsLoadingLiveSession(false);
        }
      }
    }

    void fetchLiveSession();
    return () => {
      cancelled = true;
    };
  }, [channelStreams.live]);

  useEffect(() => {
    const activeLiveId = channelStreams.live[0]?.id;
    if (!activeLiveId) return;

    const wsUrl = getBucketWsUrl();
    if (!wsUrl) return;

    let closed = false;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      attempt += 1;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, Math.min(15_000, 1_000 * Math.max(1, attempt)));
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {}
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as BucketUpdate;
          if (message.video_id !== activeLiveId || !message.bucket_start) return;

          setLiveBuckets((current) =>
            mergeBucketsByStart(current, [
              {
                bucket_start: message.bucket_start,
                bucket_end: message.bucket_end,
                duration_seconds: Math.max(
                  1,
                  Math.floor((new Date(message.bucket_end).getTime() - new Date(message.bucket_start).getTime()) / 1000)
                ),
                avg_viewers: toNumber(message.avg_viewers),
                max_viewers: toNumber(message.max_viewers),
              },
            ])
          );
        } catch {}
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {}
    };
  }, [channelStreams.live]);

  useEffect(() => {
    let cancelled = false;
    async function loadRelatedArticles() {
      if (!selectedAsset?.symbol) {
        setRelatedArticles([]);
        return;
      }
      try {
        const result = await apiFetch<Record<string, unknown>>(`/api/articles?asset=${encodeURIComponent(selectedAsset.symbol)}&limit=3`);
        if (!cancelled) {
          setRelatedArticles(normalizeArticleListResponse(result).items);
        }
      } catch {
        if (!cancelled) {
          setRelatedArticles([]);
        }
      }
    }

    void loadRelatedArticles();
    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.symbol]);

  async function refreshAll() {
    await refreshOverview();
    await fetchChannels();
    if (selectedAsset?.symbol) {
      await fetchAssetDetail(selectedAsset.symbol);
    }
    if (user) {
      await fetchPortfolio();
    }
  }

  function closeTradeConfirmation() {
    if (!tradeConfirmation || isTradeConfirmationClosing) return;
    setIsTradeConfirmationClosing(true);
    if (tradeConfirmationCloseTimerRef.current !== null) {
      globalThis.clearTimeout(tradeConfirmationCloseTimerRef.current);
    }
    tradeConfirmationCloseTimerRef.current = globalThis.setTimeout(() => {
      setTradeConfirmation(null);
      setIsTradeConfirmationClosing(false);
      tradeConfirmationCloseTimerRef.current = null;
    }, TRADE_CONFIRMATION_ANIMATION_MS);
  }

  async function handleTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAsset) return;
    if (marketStatus && !marketStatus.is_trading_open) {
      setTradeError("market_closed");
      setTradeFailureNotice({
        title: "Market is closed",
        message: marketStatus.trading_message || "Trading is unavailable right now. Wait for the market to reopen, then submit the order again.",
      });
      setTradeConfirmation(null);
      setIsTradeConfirmationClosing(false);
      return;
    }

    setTradeError(null);
    setTradeFailureNotice(null);
    if (tradeConfirmationCloseTimerRef.current !== null) {
      globalThis.clearTimeout(tradeConfirmationCloseTimerRef.current);
      tradeConfirmationCloseTimerRef.current = null;
    }
    setTradeConfirmation(null);
    setIsTradeConfirmationClosing(false);

    try {
      const previousHolding = selectedHolding;
      const result = await apiFetch<TradeExecutionResult>(`/api/market/orders/${tradeSide}`, {
        method: "POST",
        body: JSON.stringify({ symbol: selectedAsset.symbol, quantity: Number(tradeQuantity) }),
      });

      setTradeConfirmation(
        buildTradeConfirmation({
          result,
          currentMidPrice: selectedAsset.current_mid_price,
          previousHolding,
        })
      );
      setIsTradeConfirmationClosing(false);
      await refreshAll();
    } catch (nextError) {
      const errorCode = String((nextError as Error).message || nextError);
      setTradeError(errorCode);
      setTradeFailureNotice(getTradeFailureNotice(errorCode, tradeSide, selectedAsset.symbol));
    }
  }

  function renderStreamItem(stream: LivestreamItem, label: "Live" | "Upcoming") {
    return (
      <Link
        key={stream.id}
        href={stream.url || "/livestreams"}
        className={shellStyles.streamItem}
        target={stream.url ? "_blank" : undefined}
        rel={stream.url ? "noreferrer" : undefined}
      >
        {stream.thumbnail_url ? (
          <img src={stream.thumbnail_url} alt="" className={shellStyles.streamThumb} />
        ) : (
          <div className={shellStyles.streamThumbFallback} />
        )}
        <div className={shellStyles.streamBody}>
          <div className={shellStyles.streamTitle}>{stream.title}</div>
          <div className={shellStyles.streamMeta}>{stream.creator}</div>
          <div className={shellStyles.streamMeta}>
            {label === "Live" ? (
              <>
                <span className={shellStyles.livePill}>LIVE</span>
                <span>{fmtNumber(stream.viewer_count)} viewers</span>
                {stream.started_at ? <span>Started {fmtDate(stream.started_at)}</span> : null}
              </>
            ) : (
              <>
                <span className={shellStyles.upcomingPill}>UPCOMING</span>
                <span>{stream.started_at ? fmtDate(stream.started_at) : "Scheduled time unavailable"}</span>
              </>
            )}
          </div>
        </div>
      </Link>
    );
  }

  const heroStyle = useMemo(() => {
    const accent = selectedAsset?.color || "#f59e0b";
    const surfaceImage = channelBannerImage || channelProfileImage;
    const escapedSurfaceImage = surfaceImage ? surfaceImage.replace(/["\\]/g, "\\$&") : null;
    return ({
      "--hero-accent": accent,
      "--hero-surface-image": escapedSurfaceImage ? `url("${escapedSurfaceImage}")` : "none",
    } as CSSProperties);
  }, [channelBannerImage, channelProfileImage, selectedAsset?.color]);

  const channelDescription = selectedChannel?.channel.youtube_channel_description?.trim() || "Channel profile metadata will appear here once the market overview cache resolves.";
  const canExpandDescription = channelDescription.split(/\r?\n/).length > 4 || channelDescription.length > 280;
  const marketClosedMessage = marketStatus?.trading_message || "Trading is temporarily unavailable while the market settles.";
  const tradingOpen = marketStatus?.is_trading_open ?? true;
  const liveAccentColor = normalizeHexColor(liveSession?.channel_color || selectedAsset?.color) || "#ff5c7a";
  const liveViewerChartTheme = useMemo(() => createChannelChartTheme(liveAccentColor), [liveAccentColor]);
  const liveAvgLegendColor = useMemo(
    () =>
      getUsableChannelColor(
        liveViewerChartTheme.baseMuted,
        colorMode,
        colorMode === "light" ? { maxLightLuminance: 0.34 } : undefined
      ) || liveViewerChartTheme.baseMuted,
    [colorMode, liveViewerChartTheme.baseMuted]
  );
  const liveMaxLegendColor = useMemo(
    () => getUsableChannelColor(liveAccentColor, colorMode) || liveAccentColor,
    [colorMode, liveAccentColor]
  );
  const activeLiveStream = channelStreams.live[0] || null;
  const latestLiveBucket = liveBuckets.at(-1) || null;
  const liveCurrentViewers = latestLiveBucket?.max_viewers ?? activeLiveStream?.viewer_count ?? liveSession?.max_concurrent_viewers ?? null;
  const numericTradeQuantity = Number(tradeQuantity) || 0;
  const estimatedTradeNotional = (selectedAsset?.current_mid_price ?? 0) * Math.max(numericTradeQuantity, 0);
  const chartStartTs = toTimestamp(DETAIL_CHART_START_DATE);
  const showDeferredSections = deferredReadySymbol === normalizedSymbol;
  const filteredDailyCandles = useMemo(() => (
    !showDeferredSections ? [] : detail?.daily_candles.filter((item) => {
      const ts = toTimestamp(item.bucket);
      return chartStartTs !== null && ts !== null && ts >= chartStartTs;
    }) || []
  ), [chartStartTs, detail?.daily_candles, showDeferredSections]);
  const filteredStats = useMemo(() => (
    !showDeferredSections ? [] : detail?.stats.filter((item) => {
      const ts = toTimestamp(item.snapshot_date);
      return chartStartTs !== null && ts !== null && ts >= chartStartTs;
    }) || []
  ), [chartStartTs, detail?.stats, showDeferredSections]);
  const sameUnitAssets = useMemo(() => {
    if (!selectedAsset?.unit) return [];
    return assets
      .filter((asset) => asset.unit === selectedAsset.unit && asset.symbol !== selectedAsset.symbol)
      .sort((a, b) => (b.current_mid_price ?? 0) - (a.current_mid_price ?? 0))
      .slice(0, 6);
  }, [assets, selectedAsset?.symbol, selectedAsset?.unit]);
  const relatedCommunityArticles = useMemo(
    () => relatedArticles.filter((article) => !article.is_news),
    [relatedArticles]
  );
  const relatedNewsItems = useMemo(
    () => relatedArticles.filter((article) => article.is_news),
    [relatedArticles]
  );
  const mockComments = useMemo(() => {
    const displayName = selectedChannel?.channel.name || selectedAsset?.display_name || normalizedSymbol;
    return [
      {
        id: `${normalizedSymbol}-comment-1`,
        author: "AquaDesk",
        age: "2h ago",
        tone: "Bullish",
        body: `Mock board post: ${displayName} has the kind of schedule consistency that usually matters more than one noisy session.`,
      },
      {
        id: `${normalizedSymbol}-comment-2`,
        author: "ValueClipper",
        age: "5h ago",
        tone: "Neutral",
        body: "Mock board post: waiting for the next upload and a cleaner premium reset before adding more size.",
      },
      {
        id: `${normalizedSymbol}-comment-3`,
        author: "LateNightTape",
        age: "1d ago",
        tone: "Bearish",
        body: "Mock board post: strong channel, but the tape may need a better entry after the recent squeeze.",
      },
    ];
  }, [normalizedSymbol, selectedAsset?.display_name, selectedChannel?.channel.name]);
  const currentMidPrice = fmtNumber(selectedAsset?.current_mid_price, "$");
  const current24hMove = formatSignedPct(selectedAsset?.move_24h_pct);
  const isPositive = selectedAsset?.move_24h_pct !== null && selectedAsset?.move_24h_pct !== undefined && selectedAsset?.move_24h_pct >= 0;
  
  const heroPrimaryStats: HeroStat[] = [
    { label: "Mid Price", value: currentMidPrice, accent: false },
    { label: "24H Move", value: current24hMove, accent: isPositive, tone: isPositive ? "up" : "down" },
    { label: "Fair Value", value: fmtNumber(selectedAsset?.current_fair_value, "$"), accent: false },
    { label: "24H Volume", value: fmtNumber(selectedAsset?.volume_24h), meta: "shares", accent: false },
  ];
  const heroMetaStats: HeroStat[] = [
    { label: "Subscribers", value: fmtInteger(selectedChannel?.latest?.subscriber_count ?? null), accent: false },
    { label: "Views", value: fmtInteger(selectedChannel?.latest?.view_count ?? null), accent: false },
    { label: "Videos", value: fmtInteger(selectedChannel?.latest?.video_count ?? null), accent: false },
    { label: "Unit", value: selectedAsset?.unit || selectedChannel?.channel.unit || "—", accent: false },
  ];
  const subscriberRankMap = useMemo(
    () =>
      buildRankMap(
        channels
          .map((channel) => {
            const asset = findAssetForChannel(channel, assets);
            const value = channel.latest?.subscriber_count ?? null;
            if (!asset || value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets, channels]
  );
  const viewRankMap = useMemo(
    () =>
      buildRankMap(
        channels
          .map((channel) => {
            const asset = findAssetForChannel(channel, assets);
            const value = channel.latest?.view_count ?? null;
            if (!asset || value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets, channels]
  );
  const videoRankMap = useMemo(
    () =>
      buildRankMap(
        channels
          .map((channel) => {
            const asset = findAssetForChannel(channel, assets);
            const value = channel.latest?.video_count ?? null;
            if (!asset || value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets, channels]
  );
  const priceRankMap = useMemo(
    () =>
      buildRankMap(
        assets
          .map((asset) => {
            const value = asset.current_mid_price ?? null;
            if (value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets]
  );
  const volumeRankMap = useMemo(
    () =>
      buildRankMap(
        assets
          .map((asset) => {
            const value = asset.volume_24h ?? null;
            if (value === null || !Number.isFinite(value)) return null;
            return { key: asset.symbol.toUpperCase(), value };
          })
          .filter((item): item is { key: string; value: number } => Boolean(item))
      ),
    [assets]
  );
  const isAssetLoading = isLoadingOverview || isLoadingDetail;
  const showHeroSkeleton = isAssetLoading && !selectedAsset;

  const superchatLineSeries = useMemo(() => {
    if (!showDeferredSections || !superchatTimeseries) return [];

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
  }, [chartPalette, chartTheme.complement, showDeferredSections, superchatTimeseries]);

  const sortedSuperchatCurrencies = useMemo(
    () => (superchatSummary ? [...superchatSummary.currencies].sort((a, b) => (b.total_in_yen || 0) - (a.total_in_yen || 0)) : []),
    [superchatSummary]
  );
  const totalSuperchatYen = useMemo(
    () => sortedSuperchatCurrencies.reduce((sum, item) => sum + (item.total_in_yen || 0), 0),
    [sortedSuperchatCurrencies]
  );
  const totalSuperchatCount = useMemo(
    () => sortedSuperchatCurrencies.reduce((sum, item) => sum + (item.donation_count || 0), 0),
    [sortedSuperchatCurrencies]
  );
  const topCurrency = sortedSuperchatCurrencies[0] || null;
  const averageDonationYen = totalSuperchatCount > 0 ? totalSuperchatYen / totalSuperchatCount : 0;
  const activeCurrencyCount = useMemo(
    () => sortedSuperchatCurrencies.filter((item) => (item.total_in_yen || 0) > 0).length,
    [sortedSuperchatCurrencies]
  );
  const rankSpotlights: RankSpotlight[] = useMemo(() => {
    const symbolKey = normalizedSymbol.toUpperCase();
    return [
      {
        label: "Subscribers",
        rank: subscriberRankMap.get(symbolKey) ?? null,
        value: fmtInteger(selectedChannel?.latest?.subscriber_count ?? null),
        icon: <FaUsers aria-hidden="true" />,
      },
      {
        label: "Views",
        rank: viewRankMap.get(symbolKey) ?? null,
        value: fmtInteger(selectedChannel?.latest?.view_count ?? null),
        icon: <FaEye aria-hidden="true" />,
      },
      {
        label: "Weekly Yen Superchat",
        rank: superchatRank?.rank ?? null,
        value: `¥${fmtInteger(superchatRank?.total_in_yen ?? totalSuperchatYen)}`,
        icon: <FaYenSign aria-hidden="true" />,
      },
      {
        label: "Price",
        rank: priceRankMap.get(symbolKey) ?? null,
        value: fmtNumber(selectedAsset?.current_mid_price, "$"),
        icon: <FaDollarSign aria-hidden="true" />,
      },
      {
        label: "Volume",
        rank: volumeRankMap.get(symbolKey) ?? null,
        value: fmtNumber(selectedAsset?.volume_24h),
        icon: <FaChartColumn aria-hidden="true" />,
      },
      {
        label: "Videos",
        rank: videoRankMap.get(symbolKey) ?? null,
        value: fmtInteger(selectedChannel?.latest?.video_count ?? null),
        icon: <FaVideo aria-hidden="true" />,
      },
    ];
  }, [
    normalizedSymbol,
    priceRankMap,
    selectedAsset?.current_mid_price,
    selectedAsset?.volume_24h,
    selectedChannel?.latest?.subscriber_count,
    selectedChannel?.latest?.video_count,
    subscriberRankMap,
    superchatRank?.rank,
    superchatRank?.total_in_yen,
    totalSuperchatYen,
    videoRankMap,
    viewRankMap,
    volumeRankMap,
  ]);

  const superchatHeatmap = useMemo(() => {
    if (!showDeferredSections || !superchatTimeseries) {
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
  }, [showDeferredSections, superchatTimeseries]);

  if (!selectedAsset && !isLoadingOverview) {
    return (
      <SiteShell>
        <div className={styles.pageLayout}>
          <div className={styles.sidebarRail}>
            <MarketSidebar
              assets={assets}
              onSelectSymbol={setSelectedSymbol}
              showSparklines={false}
              compact
              showTopMovers={false}
              showVolumeLeaders={false}
            />
          </div>
          <div className={styles.contentRail}>
            <section className={styles.emptyState}>
              <h1 className={styles.emptyTitle}>Unknown asset</h1>
              <p className={styles.emptyCopy}>No stock matched `{normalizedSymbol}` in the current market cache.</p>
            </section>
          </div>
          <div className={styles.sidebarRailRight}>
            <MarketSidebar
              assets={assets}
              onSelectSymbol={setSelectedSymbol}
              showSparklines={false}
              compact
              showSearch={false}
              showRecentViews={false}
              showMostViewed={false}
            />
          </div>
        </div>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      <div className={styles.pageLayout}>
        <div className={styles.sidebarRail}>
          <MarketSidebar
            assets={assets}
            onSelectSymbol={setSelectedSymbol}
            showSparklines={false}
            compact
            showTopMovers={false}
            showVolumeLeaders={false}
          />
        </div>

        <div className={styles.contentRail}>
          {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
          {channelError ? <div className="statusMessage statusMessageWarn">Channel metadata warning: {channelError}</div> : null}
          {portfolioError && user ? <div className="statusMessage statusMessageWarn">Portfolio warning: {portfolioError}</div> : null}
          <section className={styles.hero} style={heroStyle}>
            <div className={styles.heroOverlay}>

              <div className={styles.heroPrice}>
                <strong className={styles.heroPriceValue}>{currentMidPrice}</strong>
                <div className={`${styles.heroPriceChange} ${isPositive ? styles.up : styles.down}`}>
                  <div className={styles.heroPriceChangeIcon}>
                    {isPositive ? <FaArrowTrendUp /> : <FaArrowTrendDown />}
                  </div>
                  <span className={styles.heroPriceChangeValue}>{current24hMove}</span>
                </div>
              </div>
              <div className={styles.heroIdentity}>
                {channelProfileImage ? (
                  <img 
                    src={channelProfileImage}
                    alt=""
                    className={styles.channelAvatar} />
                ) : (
                  <AssetCoin
                    symbol={selectedAsset?.symbol || normalizedSymbol}
                    icon={selectedAsset?.icon ?? null}
                    color={selectedAsset?.color ?? null}
                    className={styles.assetAvatar}
                  />
                )}
                <div className={styles.heroCopy}>
                  <div className={styles.heroEyebrowRow}>
                    {selectedAsset?.unit ? <span className={styles.heroPill}>{selectedAsset.unit}</span> : null}
                    {showHeroSkeleton ? <span className={`${styles.heroPill} ${styles.skeletonBlock} ${styles.heroPillSkeleton}`} aria-hidden="true" /> : null}
                  </div>
                  <h1 className={styles.heroTitle}>
                    {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.heroTitleSkeleton}`} aria-hidden="true" /> : (selectedAsset?.display_name || selectedChannel?.channel.name || normalizedSymbol)}
                    <span className={styles.heroSymbol}>${selectedAsset?.symbol || normalizedSymbol}</span>
                    {selectedChannel?.channel.youtube_channel_id ? (
                      <Link
                        href={`https://www.youtube.com/channel/${encodeURIComponent(selectedChannel.channel.youtube_channel_id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.heroLink}
                      >
                        YouTube Channel
                        <GoLinkExternal />
                      </Link>
                    ) : null}
                  </h1>
                </div>
              </div>

              <div className={styles.heroDescriptionBlock}>
                {showHeroSkeleton ? (
                  <div className={styles.heroDescriptionSkeletonWrap}>
                    {renderSkeletonLines(3, styles.heroDescriptionSkeleton)}
                  </div>
                ) : (
                  <>
                    <pre
                      className={[
                        styles.heroDescription,
                        !isDescriptionExpanded && canExpandDescription ? styles.heroDescriptionCollapsed : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {renderDescriptionContent(channelDescription)}
                    </pre>
                    {canExpandDescription ? (
                      <button
                        type="button"
                        className={styles.heroDescriptionToggle}
                        onClick={() => setIsDescriptionExpanded((current) => !current)}
                      >
                        {isDescriptionExpanded ? "Show less" : "Show more"}
                      </button>
                    ) : null}
                  </>
                )}
              </div>

              <div className={styles.heroMarketGrid}>
                <div className={styles.heroChartFrame}>
                  <div className={styles.heroChartSlot}>
                    <CandleChartCard
                      title="24H Market"
                      subtitle="Hourly candles from executed trades"
                      candles={detail?.intraday_candles || []}
                      theme={chartTheme}
                      height={320}
                      compact
                      candlePalette="market"
                      fillHeight
                      bare
                      surfaceStyle={{
                        backgroundColor: "#07111d",
                        backgroundImage: "linear-gradient(180deg, rgba(24, 36, 54, 0.98), rgba(8, 12, 20, 0.96))",
                        borderColor: "color-mix(in srgb, var(--hero-accent) 34%, rgba(255, 255, 255, 0.16))",
                      }}
                      className={styles.heroChartCard}
                    />
                  </div>
                </div>
                <div className={styles.quickStatsGrid}>
                  {heroPrimaryStats.map((item) => (
                    <div key={item.label} className={styles.quickStatCard}>
                      <span className={styles.quickStatLabel}>{item.label}</span>
                      <strong
                        className={[
                          styles.quickStatValue,
                          item.accent && item.tone === "up" ? styles.valueUp : "",
                          item.accent && item.tone === "down" ? styles.valueDown : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.quickStatValueSkeleton}`} aria-hidden="true" /> : item.value}
                      </strong>
                      {item.meta ? (
                        <span className={styles.quickStatMeta}>
                          {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.quickStatMetaSkeleton}`} aria-hidden="true" /> : item.meta}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.heroMetaGrid}>
                {heroMetaStats.map((item) => (
                  <div key={item.label} className={styles.quickStatCard}>
                    <span className={styles.quickStatLabel}>
                      {item.label === "Subscribers" || item.label === "Views" || item.label === "Videos" ? <BsYoutube className={styles.quickStatLabelIcon} aria-hidden="true" /> : null}
                      {item.label}
                    </span>
                    <strong
                      className={[
                        styles.quickStatValue,
                        item.accent && item.tone === "up" ? styles.valueUp : "",
                        item.accent && item.tone === "down" ? styles.valueDown : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.quickStatValueSkeleton}`} aria-hidden="true" /> : item.value}
                    </strong>
                    {item.meta ? (
                      <span className={styles.quickStatMeta}>
                        {showHeroSkeleton ? <span className={`${styles.skeletonBlock} ${styles.quickStatMetaSkeleton}`} aria-hidden="true" /> : item.meta}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.rankSection}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Ranking Snapshot</h2>
                <p className={styles.sectionCopy}>Current placement across the market for channel size, weekly superchats, and trading activity.</p>
              </div>
            </div>
            <div className={styles.rankSpotlightGrid}>
              {rankSpotlights.map((item) => (
                <div key={item.label} className={styles.rankSpotlightCard}>
                  <strong className={styles.rankSpotlightValue}>
                    {item.rank !== null && Number.isFinite(item.rank) ? `#${item.rank}` : "—"}
                  </strong>
                  <span className={styles.rankSpotlightLabel}>
                    <span className={styles.rankSpotlightIcon}>{item.icon}</span>
                    {item.label}
                  </span>
                  <span className={styles.rankSpotlightMeta}>{item.value}</span>
                </div>
              ))}
            </div>
          </section>

          {activeLiveStream ? (
            <section className={styles.liveNowCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Live Now</h2>
                  <p className={styles.sectionCopy}>Current stream snapshot with the same viewer curve shown in the livestream popup.</p>
                </div>
                <Link
                  href={activeLiveStream.url || `https://www.youtube.com/watch?v=${encodeURIComponent(activeLiveStream.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.liveWatchLink}
                >
                  Watch stream
                </Link>
              </div>

              {liveSessionError ? <div className="statusMessage statusMessageWarn">Live session warning: {liveSessionError}</div> : null}

              <div className={styles.liveNowGrid}>
                <div className={styles.liveInfoColumn}>
                  {activeLiveStream.thumbnail_url ? (
                    <img src={activeLiveStream.thumbnail_url} alt="" className={styles.liveThumb} />
                  ) : (
                    <div className={styles.liveThumbFallback} />
                  )}
                  <div className={styles.liveMetaStack}>
                    <div className={styles.livePillRow}>
                      <span className={styles.liveNowPill}>LIVE</span>
                      <span className={styles.liveViewers}>{fmtInteger(liveCurrentViewers)} watching</span>
                    </div>
                    <strong className={styles.liveTitle}>{liveSession?.video_title || activeLiveStream.title}</strong>
                    <div className={styles.liveMetaGrid}>
                      <div className={styles.liveMetaCard}>
                        <span>Started</span>
                        <strong>{fmtDate(liveSession?.actual_start_at || activeLiveStream.started_at)}</strong>
                      </div>
                      <div className={styles.liveMetaCard}>
                        <span>Duration</span>
                        <LiveDurationValue
                          actualStartAt={liveSession?.actual_start_at || activeLiveStream.started_at}
                          durationSeconds={liveSession?.duration_seconds}
                        />
                      </div>
                      <div className={styles.liveMetaCard}>
                        <span>Avg Viewers</span>
                        <strong>{fmtInteger(latestLiveBucket?.avg_viewers ?? liveSession?.avg_concurrent_viewers ?? null)}</strong>
                      </div>
                      <div className={styles.liveMetaCard}>
                        <span>Peak Viewers</span>
                        <strong>{fmtInteger(latestLiveBucket?.max_viewers ?? liveSession?.max_concurrent_viewers ?? null)}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.liveChartColumn}>
                  <div className={styles.liveChartHeader}>
                    <strong>Viewers Over Time</strong>
                    <div className={styles.liveLegend}>
                      <span className={styles.liveLegendItem} style={{ "--legend-color": liveAvgLegendColor } as CSSProperties}>
                        Avg viewers
                      </span>
                      <span className={styles.liveLegendItem} style={{ "--legend-color": liveMaxLegendColor } as CSSProperties}>
                        Max viewers
                      </span>
                    </div>
                  </div>

                  {isLoadingLiveSession ? (
                    <div className={styles.liveChartLoading}>Loading live viewer buckets…</div>
                  ) : (
                    <LiveViewerChart buckets={liveBuckets} accentColor={liveAccentColor} />
                  )}
                </div>
              </div>
            </section>
          ) : null}

          <div className={styles.topGrid}>
            <div className={styles.primaryColumn}>
              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Community Articles</h2>
                    <p className={styles.sectionCopy}>Published articles already associated with this asset.</p>
                  </div>
                  <Link href="/articles" className={styles.inlineLink}>Browse articles</Link>
                </div>
                {relatedCommunityArticles.length ? (
                  <div className={styles.articleList}>
                    {relatedCommunityArticles.map((article) => (
                      <Link key={article.id} href={`/articles/${encodeURIComponent(article.slug)}`} className={styles.articleCard}>
                        <div className={styles.articleTopRow}>
                          <span className={styles.articleTag}>{article.tags[0] || "Article"}</span>
                          <span className={styles.articleAuthor}>{article.author?.username || "Imported"}</span>
                        </div>
                        <strong className={styles.articleTitle}>{article.title}</strong>
                        <p className={styles.articleCopy}>{article.preview || article.subtitle || "Open the article to read the full writeup."}</p>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className={styles.mockEmpty}>No community articles are associated with this asset yet.</div>
                )}
              </section>

              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>News Items</h2>
                    <p className={styles.sectionCopy}>Imported news coverage associated with this asset.</p>
                  </div>
                  <Link href="/news" className={styles.inlineLink}>Browse news</Link>
                </div>
                {relatedNewsItems.length ? (
                  <div className={styles.articleList}>
                    {relatedNewsItems.map((article) => (
                      (() => {
                        const heading = splitHeadline(article.title);
                        return (
                          <Link key={article.id} href={`/articles/${encodeURIComponent(article.slug)}`} className={styles.articleCard}>
                            <div className={styles.articleTopRow}>
                              <span className={styles.articleTag}>{article.tags[0] || (article.is_news ? "News" : "Article")}</span>
                              <span className={styles.articleAuthor}>{article.author?.username || "Imported"}</span>
                            </div>
                            <strong className={styles.articleTitle}>{heading.title}</strong>
                            <p className={styles.articleCopy}>{heading.subhead || article.preview || article.subtitle || "Open the article to read the full writeup."}</p>
                          </Link>
                        );
                      })()
                    ))}
                  </div>
                ) : (
                  <div className={styles.mockEmpty}>No news items are associated with this asset yet.</div>
                )}
              </section>

              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Other members of {selectedAsset?.unit || "this unit"}</h2>
                  </div>
                </div>
                {sameUnitAssets.length ? (
                  <div className={styles.sameUnitGrid}>
                    {sameUnitAssets.map((asset) => (
                      (() => {
                        const deltaValue = computePriceDelta(asset.current_mid_price, asset.move_24h_pct);
                        const isPositiveDelta = (deltaValue ?? 0) >= 0;
                        return (
                          <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.sameUnitCard}>
                            <div className={styles.sameUnitIdentity}>
                              <AssetCoin symbol={asset.symbol} icon={asset.icon ?? null} color={asset.color ?? null} className={styles.sameUnitIcon} />
                              <div>
                                <strong>{asset.symbol}</strong>
                                <span>{asset.display_name}</span>
                              </div>
                            </div>
                            <div className={styles.sameUnitMetrics}>
                              <strong>{fmtNumber(asset.current_mid_price, "$")}</strong>
                              <span className={isPositiveDelta ? styles.valueUp : styles.valueDown}>
                                {formatSignedCurrency(deltaValue)}
                                {isPositiveDelta ? <FaArrowTrendUp aria-hidden="true" /> : <FaArrowTrendDown aria-hidden="true" />}
                              </span>
                            </div>
                          </Link>
                        );
                      })()
                    ))}
                  </div>
                ) : (
                  <div className={styles.mockEmpty}>No other active channels share this unit right now.</div>
                )}
              </section>

            </div>

            <div className={styles.tradeColumn}>
              <section className={styles.tradePanel}>
                <div className={styles.tradePanelContent}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2 className={styles.sectionTitle}>Trade {selectedAsset?.symbol || normalizedSymbol}</h2>
                      <p className={styles.sectionCopy}>A tighter order ticket with account context relevant to this position.</p>
                    </div>
                  </div>

                  {!user ? (
                    <div className={styles.authCta}>
                      <span>Sign in to trade and load your portfolio context.</span>
                      <div className={styles.authLinks}>
                        <Link href="/login">Login</Link>
                        <Link href="/register">Register</Link>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={styles.portfolioGrid}>
                        <div className={styles.portfolioStat}>
                          <span>Cash</span>
                          <strong>{isLoadingPortfolio ? "Loading…" : fmtNumber(portfolio?.cash_balance ?? null, "$")}</strong>
                        </div>
                        <div className={styles.portfolioStat}>
                          <span>Shares Owned</span>
                          <strong>{isLoadingPortfolio ? "Loading…" : fmtNumber(ownedShares)}</strong>
                        </div>
                        <div className={styles.portfolioStat}>
                          <span>Position Value</span>
                          <strong>{isLoadingPortfolio ? "Loading…" : fmtNumber(estimatedPositionValue, "$")}</strong>
                        </div>
                        <div className={styles.portfolioStat}>
                          <span>Avg Cost</span>
                          <strong>{isLoadingPortfolio ? "Loading…" : fmtNumber(selectedHolding?.avg_cost_basis ?? null, "$")}</strong>
                        </div>
                        <div className={styles.portfolioStat}>
                          <span>Unrealized PnL</span>
                          <strong className={(selectedHolding?.unrealized_pnl ?? 0) >= 0 ? styles.valueUp : styles.valueDown}>
                            {isLoadingPortfolio ? "Loading…" : formatSignedCurrency(selectedHolding?.unrealized_pnl ?? null)}
                          </strong>
                        </div>
                        <div className={styles.portfolioStat}>
                          <span>Order Value</span>
                          <strong>{fmtNumber(estimatedTradeNotional, "$")}</strong>
                        </div>
                      </div>

                      <form className={styles.tradeForm} onSubmit={(event) => void handleTrade(event)}>
                        <div className={styles.sideToggle}>
                          <button
                            type="button"
                            className={tradeSide === "buy" ? styles.sideToggleActiveBuy : styles.sideToggleButton}
                            onClick={() => setTradeSide("buy")}
                          >
                            Buy
                          </button>
                          <button
                            type="button"
                            className={tradeSide === "sell" ? styles.sideToggleActiveSell : styles.sideToggleButton}
                            onClick={() => setTradeSide("sell")}
                          >
                            Sell
                          </button>
                        </div>

                        <label className={styles.tradeField}>
                          <span>Quantity</span>
                          <input
                            className={styles.tradeInput}
                            value={tradeQuantity}
                            inputMode="decimal"
                            disabled={!tradingOpen}
                            onChange={(event) => setTradeQuantity(event.target.value)}
                          />
                        </label>

                        <div className={styles.tradePresets}>
                          {["10", "25", "50", "100"].map((preset) => (
                            <button key={preset} type="button" className={styles.presetButton} onClick={() => setTradeQuantity(preset)}>
                              {preset}
                            </button>
                          ))}
                        </div>

                        <div className={styles.tradeSummary}>
                          <div>
                            <span>Mid</span>
                            <strong>{fmtNumber(selectedAsset?.current_mid_price, "$")}</strong>
                          </div>
                          <div>
                            <span>Bid / Ask</span>
                            <strong>{fmtNumber(selectedAsset?.current_bid_price, "$")} / {fmtNumber(selectedAsset?.current_ask_price, "$")}</strong>
                          </div>
                          <div>
                            <span>Premium</span>
                            <strong>{fmtPct(selectedAsset?.current_premium_pct)}</strong>
                          </div>
                        </div>

                        <button type="submit" className={tradeSide === "buy" ? styles.tradeSubmitBuy : styles.tradeSubmitSell} disabled={!tradingOpen}>
                          {tradingOpen ? `${tradeSide === "buy" ? "Submit Buy" : "Submit Sell"} Order` : "Market Closed"}
                        </button>
                      </form>

                      {!tradingOpen ? (
                        <div className="statusMessage statusMessageWarn">
                          <strong>Trading paused.</strong> {marketClosedMessage}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </section>
            </div>
          </div>

          <section className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Channel Board</h2>
                <p className={styles.sectionCopy}>UI mockup for a future per-channel discussion board.</p>
              </div>
              <span className={styles.mockBadge}>Mockup</span>
            </div>
            <div className={styles.commentComposer}>
              <textarea
                className={styles.commentInput}
                placeholder={`What is your current read on ${selectedAsset?.symbol || normalizedSymbol}?`}
                disabled
              />
              <div className={styles.commentComposerFooter}>
                <span>Posting disabled until channel comments are backed by a table.</span>
                <button type="button" className={styles.commentButton} disabled>Post Comment</button>
              </div>
            </div>
            <div className={styles.commentList}>
              {mockComments.map((comment) => (
                <article key={comment.id} className={styles.commentCard}>
                  <div className={styles.commentHeader}>
                    <div>
                      <strong>{comment.author}</strong>
                      <span>{comment.age}</span>
                    </div>
                    <span className={styles.commentTone}>{comment.tone}</span>
                  </div>
                  <p>{comment.body}</p>
                </article>
              ))}
            </div>
          </section>

          {showDeferredSections ? (
            <>
              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Market Graphs</h2>
                    <p className={styles.sectionCopy}>Price, fundamentals, and channel growth curves in one deck.</p>
                  </div>
                </div>
                <div className={styles.chartGrid}>
                  <div className={styles.chartGridWide}>
                    <CandleChartCard title="24H Market" subtitle="Hourly candles from executed trades" candles={detail?.intraday_candles || []} theme={chartTheme} candlePalette="market" />
                  </div>
                  <CandleChartCard title="1Y Daily Price" subtitle="Daily candles with mark-close overlay" candles={filteredDailyCandles} showMarkClose theme={chartTheme} />
                  <VolumeChartCard title="1Y Daily Volume" subtitle="Settled daily coin volume in shares" candles={filteredDailyCandles} theme={chartTheme} />
                  <TrendChartCard
                    title="Fundamental Signal"
                    subtitle="Smoothed anchor with raw signal overlay"
                    theme={chartTheme}
                    series={[
                      {
                        name: "Smoothed",
                        color: chartTheme.baseDeep,
                        kind: "area",
                        values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.fundamental_value_smoothed })),
                      },
                      {
                        name: "Raw",
                        color: chartTheme.baseMuted,
                        kind: "line",
                        values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.fundamental_value_raw })),
                      },
                    ]}
                  />
                  <TrendChartCard
                    title="Subscribers"
                    subtitle="One-year audience trajectory"
                    theme={chartTheme}
                    series={[
                      {
                        name: "Subscribers",
                        color: chartTheme.base,
                        kind: "area",
                        values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.subscriber_count })),
                      },
                    ]}
                  />
                  <TrendChartCard
                    title="Views"
                    subtitle="Cumulative channel views"
                    theme={chartTheme}
                    series={[
                      {
                        name: "Views",
                        color: chartTheme.complement,
                        kind: "area",
                        values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.view_count })),
                      },
                    ]}
                  />
                  <TrendChartCard
                    title="Video Count"
                    subtitle="Published video total over time"
                    theme={chartTheme}
                    series={[
                      {
                        name: "Videos",
                        color: chartTheme.complementSoft,
                        kind: "area",
                        values: filteredStats.map((item) => ({ time: item.snapshot_date, value: item.video_count })),
                      },
                    ]}
                  />
                </div>
              </section>

              <div className={styles.utilityGrid}>
                <section className={styles.sectionCard}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2 className={styles.sectionTitle}>Treasury</h2>
                      <p className={styles.sectionCopy}>Supply structure and emission snapshot for the asset.</p>
                    </div>
                  </div>
                  <div className={styles.infoGrid}>
                    <div className={styles.infoCard}><span>Circulating</span><strong>{fmtNumber(detail?.treasury?.circulating_supply)}</strong></div>
                    <div className={styles.infoCard}><span>Treasury</span><strong>{fmtNumber(detail?.treasury?.treasury_supply)}</strong></div>
                    <div className={styles.infoCard}><span>Max Supply</span><strong>{fmtNumber(detail?.treasury?.max_supply)}</strong></div>
                    <div className={styles.infoCard}><span>Daily Emission</span><strong>{fmtNumber(detail?.treasury?.current_daily_emission)}</strong></div>
                    <div className={styles.infoCard}><span>Premium</span><strong>{fmtPct(detail?.treasury?.current_premium_pct)}</strong></div>
                    <div className={styles.infoCard}><span>Snapshot Date</span><strong>{selectedAsset?.latest_snapshot_date || "—"}</strong></div>
                  </div>
                </section>

                <section className={styles.sectionCard}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2 className={styles.sectionTitle}>Recent Trades</h2>
                      <p className={styles.sectionCopy}>Last fills for this symbol from the market feed.</p>
                    </div>
                  </div>
                  <div className={styles.tradeTape}>
                    {(detail?.trades || []).length ? (
                      (detail?.trades || []).map((trade) => (
                        <article key={trade.id} className={styles.tradeTapeRow}>
                          <div className={styles.tradeAsset}>
                            <AssetCoin
                              symbol={selectedAsset?.symbol || normalizedSymbol}
                              icon={selectedAsset?.icon ?? null}
                              color={selectedAsset?.color ?? null}
                              className={styles.inlineAssetIcon}
                              shape="circle"
                            />
                            <div className={styles.tradeAssetCopy}>
                              <strong className={styles.tradeAssetLink}>{selectedAsset?.symbol || normalizedSymbol}</strong>
                              <span>{fmtDate(trade.ts)}</span>
                            </div>
                          </div>
                          <div>
                            <span className={[styles.sideBadge, trade.side.toLowerCase() === "buy" ? styles.sideBadgeBuy : styles.sideBadgeSell].join(" ")}>
                              {trade.side.toUpperCase()}
                            </span>
                          </div>
                          <div className={styles.tradeMetrics}>
                            <strong className={styles.numericValue}>{fmtNumber(trade.quantity)} @ {fmtNumber(trade.price, "$")}</strong>
                            <span className={styles.numericValue}>Gross {fmtNumber(trade.gross_cash, "$")}</span>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className={styles.mockEmpty}>No recent trades were returned for this symbol.</div>
                    )}
                  </div>
                </section>
              </div>

              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Livestreams</h2>
                    <p className={styles.sectionCopy}>Current live and scheduled streams for this channel.</p>
                  </div>
                </div>

                {livestreamError ? <div className="statusMessage statusMessageError">Livestream error: {livestreamError}</div> : null}
                {isLoadingLivestreams ? <div className={shellStyles.empty}>Loading livestreams…</div> : null}
                {!isLoadingLivestreams && !livestreamError && channelStreams.live.length === 0 && channelStreams.upcoming.length === 0 ? (
                  <div className={shellStyles.empty}>No live or upcoming streams for this channel.</div>
                ) : null}

                {channelStreams.live.length > 0 ? (
                  <div className={shellStyles.streamSection}>
                    <h3 className={shellStyles.sectionLabel}>Live Now</h3>
                    <div className={shellStyles.streamList}>
                      {channelStreams.live.map((stream) => renderStreamItem(stream, "Live"))}
                    </div>
                  </div>
                ) : null}

                {channelStreams.upcoming.length > 0 ? (
                  <div className={shellStyles.streamSection}>
                    <h3 className={shellStyles.sectionLabel}>Upcoming</h3>
                    <div className={shellStyles.streamList}>
                      {channelStreams.upcoming.map((stream) => renderStreamItem(stream, "Upcoming"))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className={styles.sectionCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 className={styles.sectionTitle}>Superchats</h2>
                    <p className={styles.sectionCopy}>Weekly summary and time-series breakdowns by currency.</p>
                    {superchatSummary?.week_start && superchatSummary?.week_end ? (
                      <p className={styles.sectionMeta}>
                        Window: {fmtDate(superchatSummary.week_start)} to {fmtDate(superchatSummary.week_end)}
                      </p>
                    ) : null}
                  </div>
                </div>

                {superchatError ? <div className="statusMessage statusMessageError">Superchat error: {superchatError}</div> : null}
                {isLoadingSuperchats ? <div className={shellStyles.empty}>Loading superchat summary…</div> : null}
                {!isLoadingSuperchats && !superchatError && (!superchatSummary || superchatSummary.currencies.length === 0) ? (
                  <div className={shellStyles.empty}>No superchat currency totals for this channel in the past week.</div>
                ) : null}

                {superchatSummary && superchatSummary.currencies.length > 0 ? (
                  <>
                    <div className={shellStyles.grid}>
                      <div className={shellStyles.card}>
                        <div className={shellStyles.eyebrow}>Weekly Yen</div>
                        <div className={shellStyles.cardTitle}>¥{fmtInteger(totalSuperchatYen)}</div>
                        <div className={shellStyles.meta}>Across all currencies in the current 7-day window.</div>
                      </div>
                      <div className={shellStyles.card}>
                        <div className={shellStyles.eyebrow}>Donation Count</div>
                        <div className={shellStyles.cardTitle}>{fmtInteger(totalSuperchatCount)}</div>
                        <div className={shellStyles.meta}>Average ticket size ¥{fmtInteger(averageDonationYen)}.</div>
                      </div>
                      <div className={shellStyles.card}>
                        <div className={shellStyles.eyebrow}>Leading Currency</div>
                        <div className={shellStyles.cardTitle}>{topCurrency ? formatCurrencyLabelWithFlag(topCurrency.currency_name) : "—"}</div>
                        <div className={shellStyles.meta}>
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

                    <div className={shellStyles.superchatChartGrid}>
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

                <div className={shellStyles.superchatSubsection}>
                  <div className={shellStyles.superchatToolbar}>
                    <h3 className={shellStyles.sectionLabel}>Totals Over Time</h3>
                    <div className={shellStyles.rangeSelector}>
                      {SUPERCHAT_TIMESERIES_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={option.value === superchatTimeseriesRange ? shellStyles.rangeChipActive : shellStyles.rangeChip}
                          onClick={() => setSuperchatTimeseriesRange(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {superchatTimeseries?.start_date && superchatTimeseries?.end_date ? (
                    <p className={styles.sectionMeta}>
                      Window: {fmtDate(superchatTimeseries.start_date)} to {fmtDate(superchatTimeseries.end_date)}
                    </p>
                  ) : null}

                  {superchatTimeseriesError ? (
                    <div className="statusMessage statusMessageError">Superchat timeseries error: {superchatTimeseriesError}</div>
                  ) : null}
                  {isLoadingSuperchatTimeseries ? <div className={shellStyles.empty}>Loading superchat timeseries…</div> : null}
                  {!isLoadingSuperchatTimeseries && !superchatTimeseriesError && superchatLineSeries.length === 0 ? (
                    <div className={shellStyles.empty}>No superchat timeseries data for this range.</div>
                  ) : null}

                  {superchatLineSeries.length > 0 ? (
                    <div className={shellStyles.superchatChartGrid}>
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
            </>
          ) : (
            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>Market Data</h2>
                  <p className={styles.sectionCopy}>Rendering charts, tape, and superchat analytics after the route settles.</p>
                </div>
              </div>
              <div className={shellStyles.empty}>Loading deferred market panels…</div>
            </section>
          )}
        </div>

        <div className={styles.sidebarRailRight}>
          <MarketSidebar
            assets={assets}
            onSelectSymbol={setSelectedSymbol}
            showSparklines={false}
            compact
            showSearch={false}
            showRecentViews={false}
            showMostViewed={false}
          />
        </div>
      </div>

      {tradeConfirmation ? (
        (() => {
          const isPositiveTradeTheme = tradeConfirmation.side === "buy" || (tradeConfirmation.realizedPnl ?? 0) >= 0;
          return (
        <div
          className={[
            styles.tradeConfirmationOverlay,
            isTradeConfirmationClosing ? styles.tradeConfirmationOverlayClosing : "",
          ].filter(Boolean).join(" ")}
          onClick={closeTradeConfirmation}
        >
            <div
              className={[
                styles.tradeConfirmationFrame,
                isPositiveTradeTheme ? styles.tradeConfirmationFrameBuy : styles.tradeConfirmationFrameSell,
              ].join(" ")}
            >
              <div
                className={[
                  styles.tradeConfirmationModal,
                  isPositiveTradeTheme ? styles.tradeConfirmationModalBuy : styles.tradeConfirmationModalSell,
                  isTradeConfirmationClosing ? styles.tradeConfirmationModalClosing : "",
                ].filter(Boolean).join(" ")}
                role="dialog"
                aria-modal="true"
                aria-labelledby="trade-confirmation-title"
                onClick={(event) => event.stopPropagation()}
              >
            <div
              className={[
                styles.tradeConfirmationHero,
                isPositiveTradeTheme ? styles.tradeConfirmationHeroBuy : styles.tradeConfirmationHeroSell,
              ].join(" ")}
            >
              <div>
                <span className={styles.tradeConfirmationEyebrow}>
                  {tradeConfirmation.side === "buy" ? "Buy Filled" : "Sell Filled"}
                </span>
                <h2 id="trade-confirmation-title" className={styles.tradeConfirmationTitle}>
                  {tradeConfirmation.side === "buy"
                    ? "Position updated"
                    : (tradeConfirmation.realizedPnl ?? 0) >= 0
                      ? `Nice! Capital gains = ${fmtNumber(tradeConfirmation.realizedPnl, "$")}`
                      : `Tough break. Capital loss = ${fmtNumber(Math.abs(tradeConfirmation.realizedPnl ?? 0), "$")}`}
                </h2>
                <div className={styles.tradeConfirmationSubheader}>
                  <AssetCoin
                    symbol={tradeConfirmation.symbol}
                    icon={selectedAsset?.icon ?? null}
                    color={selectedAsset?.color ?? null}
                    className={styles.tradeConfirmationTickerIcon}
                  />
                  <p className={styles.tradeConfirmationCopy}>
                    <strong className={styles.tradeConfirmationTicker}>${tradeConfirmation.symbol}</strong>
                    <span>
                      {fmtNumber(tradeConfirmation.filledQuantity)} shares executed at {fmtNumber(tradeConfirmation.executedPrice, "$")} per share.
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={styles.tradeConfirmationClose}
                onClick={closeTradeConfirmation}
                aria-label="Close trade confirmation"
              >
                ×
              </button>
            </div>

            <div className={styles.tradeConfirmationBody}>
              <div className={styles.tradeConfirmationLayout}>
                <div className={styles.tradeConfirmationImageSlot}>
                  <img
                    src={tradeConfirmation.imageSrc}
                    alt="Moona illustration"
                    className={styles.tradeConfirmationImage}
                  />
                </div>

                <div className={styles.tradeConfirmationContent}>
                  <div className={styles.tradeConfirmationGrid}>
                    <div className={styles.tradeConfirmationCard}>
                      <span>{tradeConfirmation.side === "buy" ? "Total Cost" : "Gross Value"}</span>
                      <strong>{fmtNumber(tradeConfirmation.side === "buy" ? tradeConfirmation.totalCost : tradeConfirmation.grossValue, "$")}</strong>
                    </div>
                    <div className={styles.tradeConfirmationCard}>
                      <span>Fee</span>
                      <strong>{fmtNumber(tradeConfirmation.fee, "$")}</strong>
                    </div>
                    <div className={styles.tradeConfirmationCard}>
                      <span>{tradeConfirmation.side === "buy" ? "Cash Change" : "Net Proceeds"}</span>
                      <strong className={tradeConfirmation.netCashImpact >= 0 ? styles.valueUp : styles.valueDown}>
                        {formatSignedCurrency(tradeConfirmation.netCashImpact)}
                      </strong>
                    </div>
                    <div className={styles.tradeConfirmationCard}>
                      <span>New Cash Balance</span>
                      <strong>{fmtNumber(tradeConfirmation.nextCashBalance, "$")}</strong>
                    </div>
                  </div>

                  <div className={styles.tradeConfirmationColumns}>
                    <section className={styles.tradeConfirmationSection}>
                      <h3>Position</h3>
                      <div className={styles.tradeConfirmationMetricList}>
                        <div className={styles.tradeConfirmationMetric}>
                          <span>Shares owned</span>
                          <strong>{fmtNumber(tradeConfirmation.previousQuantity)} → {fmtNumber(tradeConfirmation.nextQuantity)}</strong>
                        </div>
                        <div className={styles.tradeConfirmationMetric}>
                          <span>Average cost</span>
                          <strong>{fmtNumber(tradeConfirmation.previousAvgCost, "$")} → {fmtNumber(tradeConfirmation.nextAvgCost, "$")}</strong>
                        </div>
                        <div className={styles.tradeConfirmationMetric}>
                          <span>Marked at</span>
                          <strong>{fmtNumber(tradeConfirmation.currentMidPrice, "$")}</strong>
                        </div>
                        <div className={styles.tradeConfirmationMetric}>
                          <span>{tradeConfirmation.side === "buy" ? "Estimated unrealized P/L" : "Actual realized P/L"}</span>
                          <strong
                            className={((tradeConfirmation.side === "buy" ? tradeConfirmation.unrealizedPnl : tradeConfirmation.realizedPnl) ?? 0) >= 0 ? styles.valueUp : styles.valueDown}
                          >
                            {formatSignedCurrency(tradeConfirmation.side === "buy" ? tradeConfirmation.unrealizedPnl : tradeConfirmation.realizedPnl)}
                          </strong>
                        </div>
                      </div>
                    </section>

                    <section className={styles.tradeConfirmationSection}>
                      <h3>{tradeConfirmation.side === "buy" ? "What changed" : "Remaining position"}</h3>
                      <div className={styles.tradeConfirmationMetricList}>
                        {tradeConfirmation.side === "buy" ? (
                          <>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Shares added</span>
                              <strong className={styles.valueUp}>+{fmtNumber(tradeConfirmation.filledQuantity)}</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>New weighted average</span>
                              <strong>{fmtNumber(tradeConfirmation.nextAvgCost, "$")}</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Fill time</span>
                              <strong>{fmtDate(tradeConfirmation.filledAt)}</strong>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Cost basis sold</span>
                              <strong>{fmtNumber(tradeConfirmation.costBasisSold, "$")}</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Shares remaining</span>
                              <strong>{fmtNumber(tradeConfirmation.nextQuantity)}</strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Remaining unrealized P/L</span>
                              <strong className={(tradeConfirmation.unrealizedPnl ?? 0) >= 0 ? styles.valueUp : styles.valueDown}>
                                {formatSignedCurrency(tradeConfirmation.unrealizedPnl)}
                              </strong>
                            </div>
                            <div className={styles.tradeConfirmationMetric}>
                              <span>Fill time</span>
                              <strong>{fmtDate(tradeConfirmation.filledAt)}</strong>
                            </div>
                          </>
                        )}
                      </div>
                    </section>
                  </div>

                  <div className={styles.tradeConfirmationActions}>
                    <button type="button" className={styles.tradeConfirmationPrimary} onClick={closeTradeConfirmation}>
                      Back to chart
                    </button>
                  </div>
                </div>
              </div>
            </div>
              </div>
            </div>
        </div>
          );
        })()
      ) : null}
      {tradeFailureNotice ? (
        <div className={styles.tradeFailureOverlay} onClick={() => setTradeFailureNotice(null)}>
          <div className={styles.tradeFailureModal} role="alertdialog" aria-modal="true" aria-labelledby="trade-failure-title" onClick={(event) => event.stopPropagation()}>
            <div className={styles.tradeFailureHeader}>
              <h2 id="trade-failure-title" className={styles.tradeFailureTitle}>{tradeFailureNotice.title}</h2>
              <button
                type="button"
                className={styles.tradeConfirmationClose}
                onClick={() => setTradeFailureNotice(null)}
                aria-label="Close trade failure notice"
              >
                ×
              </button>
            </div>
            <div className={styles.tradeFailureBody}>
              <p className={styles.tradeFailureCopy}>{tradeFailureNotice.message}</p>
              <div className={styles.tradeConfirmationActions}>
                <button type="button" className={styles.tradeFailurePrimary} onClick={() => setTradeFailureNotice(null)}>
                  Back to order ticket
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </SiteShell>
  );
}
