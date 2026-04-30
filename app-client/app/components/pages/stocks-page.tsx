"use client";

import { createPortal } from "react-dom";
import { startTransition, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FaArrowTrendDown, FaArrowTrendUp, FaBookmark, FaCartShopping, FaChartLine, FaChartSimple, FaCoins, FaFloppyDisk, FaGrip, FaMagnifyingGlass, FaPlus, FaSliders, FaTable, FaXmark } from "react-icons/fa6";
import { HiMiniArrowSmallDown, HiMiniArrowSmallUp, HiOutlineArrowsUpDown } from "react-icons/hi2";
import { CandleChartCard, SparklineChart, TrendChartCard, VolumeChartCard } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { OptionPicker } from "@/app/components/common/option-picker";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { createChannelChartTheme } from "@/app/lib/chart-theme";
import { getUsableChannelColor } from "@/app/lib/color";
import { computeDailyVolumeChange } from "@/app/lib/market-metrics";
import { fmtDate, fmtInteger, fmtNumber } from "@/app/lib/format";
import { normalizeCandles } from "@/app/lib/normalizers";
import type { CandlePoint, MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import shellStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/stocks-page.module.scss";
import detailStyles from "@/app/components/pages/stock-detail-page.module.scss";

type OverviewTimeSeriesPoint = {
  time: string;
  youtube_channel_id?: string | null;
  subscriber_count: number | string | null;
  view_count: number | string | null;
  video_count: number | string | null;
};

type OverviewRow = {
  channel: {
    youtube_channel_id: string;
  };
  series: OverviewTimeSeriesPoint[];
};

type ChannelMetrics = {
  subscribers: number | null;
  subscriberChangePct24h: number | null;
  views: number | null;
  viewChangePct24h: number | null;
  videos: number | null;
};

type SortKey =
  | "symbol"
  | "name"
  | "unit"
  | "mid"
  | "medium"
  | "settlementMove"
  | "move24h"
  | "volume24h"
  | "volumeChange"
  | "subscribers"
  | "subscriberChange"
  | "views"
  | "viewChange"
  | "videos";

type SortDirection = "asc" | "desc";
type PriceMoveFilter = "all" | "positive" | "negative";
type VolumeChangeFilter = "all" | "positive" | "negative";
type PresetKind = "all" | "movers" | "volume" | "custom";
type ArchiveViewMode = "table" | "cards";
type CardGraphMetric = "price" | "candles24h" | "volume" | "subscribers" | "views" | "videos";
type TradeSide = "buy" | "sell";

const QUICK_TRADE_CLOSE_ANIMATION_MS = 170;
const TRADE_QUANTITY_PRESETS = ["1", "10", "25", "50", "100"] as const;

type CardGraphPoint = {
  time: string;
  value: number | null;
};

type SavedStockView = {
  id: string;
  name: string;
  unitFilter: string;
  priceMoveFilter: PriceMoveFilter;
  volumeChangeFilter: VolumeChangeFilter;
  searchQuery: string;
  selectedSymbols: string[];
  sortKey: SortKey;
  sortDirection: SortDirection;
};

type TradeExecutionResult = {
  order_id?: number | string;
  status?: "pending" | "filled" | "cancelled" | "rejected";
  order_type?: "market" | "live_market";
  requested_quantity?: number;
  execute_after?: string | null;
  interval_limit?: number;
  indicative_price?: number;
  filled_quantity?: number;
  executed_price?: number;
  fee?: number;
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
  mode: "filled" | "queued";
  orderId: number | string | null;
  side: "buy" | "sell";
  symbol: string;
  requestedQuantity: number;
  executeAfter: string | null;
  intervalLimit: number | null;
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
  themePnl: number | null;
  imageSrc: string;
};

type TradeFailureNotice = {
  title: string;
  message: string;
};

type DerivedStockRow = {
  asset: MarketAsset;
  channelMetrics: ChannelMetrics | undefined;
  volumeChangePct: number | null;
  href: string;
  isSelected: boolean;
  sortValues: Record<SortKey, number | string | null>;
};

const stringCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const SAVED_STOCK_VIEWS_KEY = "nasfaq.stockViews";

const BUILT_IN_VIEWS: Array<{ id: PresetKind; name: string; description: string }> = [
  { id: "all", name: "All Stocks", description: "Full archive" },
  { id: "movers", name: "Top Movers", description: "Green tape first" },
  { id: "volume", name: "High Volume", description: "Most active names" },
];

const CARD_GRAPH_OPTIONS: Array<{ value: CardGraphMetric; label: string }> = [
  { value: "price", label: "Price" },
  { value: "candles24h", label: "24H Candles" },
  { value: "volume", label: "Volume" },
  { value: "subscribers", label: "Subscribers" },
  { value: "views", label: "Views" },
  { value: "videos", label: "Videos" },
];

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

const MOBILE_SORT_OPTIONS: Array<{ value: `${SortKey}:${SortDirection}`; label: string }> = [
  { value: "symbol:asc", label: "Symbol A-Z" },
  { value: "symbol:desc", label: "Symbol Z-A" },
  { value: "name:asc", label: "Name A-Z" },
  { value: "name:desc", label: "Name Z-A" },
  { value: "unit:asc", label: "Unit A-Z" },
  { value: "unit:desc", label: "Unit Z-A" },
  { value: "mid:desc", label: "Mid price high-low" },
  { value: "mid:asc", label: "Mid price low-high" },
  { value: "medium:desc", label: "Medium price high-low" },
  { value: "medium:asc", label: "Medium price low-high" },
  { value: "settlementMove:desc", label: "Adjustment move high-low" },
  { value: "settlementMove:asc", label: "Adjustment move low-high" },
  { value: "move24h:desc", label: "Today move high-low" },
  { value: "move24h:asc", label: "Today move low-high" },
  { value: "volume24h:desc", label: "24H volume high-low" },
  { value: "volume24h:asc", label: "24H volume low-high" },
  { value: "volumeChange:desc", label: "Volume change high-low" },
  { value: "volumeChange:asc", label: "Volume change low-high" },
  { value: "subscribers:desc", label: "Subscribers high-low" },
  { value: "subscribers:asc", label: "Subscribers low-high" },
  { value: "subscriberChange:desc", label: "Subscriber change high-low" },
  { value: "subscriberChange:asc", label: "Subscriber change low-high" },
  { value: "views:desc", label: "Views high-low" },
  { value: "views:asc", label: "Views low-high" },
  { value: "viewChange:desc", label: "View change high-low" },
  { value: "viewChange:asc", label: "View change low-high" },
  { value: "videos:desc", label: "Videos high-low" },
  { value: "videos:asc", label: "Videos low-high" },
];

const SORTABLE_COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "symbol", label: "Symbol" },
  { key: "name", label: "Name" },
  { key: "unit", label: "Unit" },
  { key: "mid", label: "Mid" },
  { key: "medium", label: "Medium" },
  { key: "settlementMove", label: "Adjustment Move" },
  { key: "move24h", label: "Today Move" },
  { key: "volume24h", label: "24H Volume" },
  { key: "volumeChange", label: "Volume Change" },
  { key: "subscribers", label: "Subscribers" },
  { key: "subscriberChange", label: "24H % Subscriber Change" },
  { key: "views", label: "Views" },
  { key: "viewChange", label: "24H % View Change" },
  { key: "videos", label: "Videos" },
];

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${fmtNumber(value)}`;
}

function formatSignedPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function pickLatestPoint(series: OverviewTimeSeriesPoint[]) {
  return [...series]
    .filter((point) => toTimestamp(point.time) !== null)
    .sort((a, b) => (toTimestamp(a.time) ?? 0) - (toTimestamp(b.time) ?? 0))
    .at(-1) || null;
}

function pickPointAtOrBefore(series: OverviewTimeSeriesPoint[], targetMs: number) {
  return [...series]
    .filter((point) => {
      const ts = toTimestamp(point.time);
      return ts !== null && ts <= targetMs;
    })
    .sort((a, b) => (toTimestamp(a.time) ?? 0) - (toTimestamp(b.time) ?? 0))
    .at(-1) || null;
}

function computeChangePct(current: number | null, previous: number | null) {
  if (
    current === null ||
    previous === null ||
    Number.isNaN(current) ||
    Number.isNaN(previous) ||
    previous === 0
  ) {
    return null;
  }
  return (current - previous) / previous;
}

function toFiniteNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeAdjustmentMovePct(asset: MarketAsset) {
  return computeChangePct(asset.current_mid_price, asset.latest_adjustment?.price_after ?? null);
}

function getTradeFailureNotice(errorCode: string, side: TradeSide, symbol: string): TradeFailureNotice {
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
    case "live_order_limit_exceeded":
      return {
        title: "Live order limit reached",
        message: "You have already submitted the maximum number of live orders for this market interval.",
      };
    default:
      return {
        title: "Trade failed",
        message: `This ${side} order for ${symbol} could not be completed. Please try again.`,
      };
  }
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function readSavedStockViews() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_STOCK_VIEWS_KEY) || "[]") as SavedStockView[];
    return Array.isArray(parsed)
      ? parsed
        .filter((view) => view?.id && view?.name)
        .map((view) => ({
          ...view,
          unitFilter: view.unitFilter || "all",
          priceMoveFilter: view.priceMoveFilter || "all",
          volumeChangeFilter: view.volumeChangeFilter || "all",
          searchQuery: view.searchQuery || "",
          selectedSymbols: Array.isArray(view.selectedSymbols) ? view.selectedSymbols : [],
          sortKey: view.sortKey || "symbol",
          sortDirection: view.sortDirection || "asc",
        }))
      : [];
  } catch {
    return [];
  }
}

function writeSavedStockViews(views: SavedStockView[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAVED_STOCK_VIEWS_KEY, JSON.stringify(views));
  window.dispatchEvent(new Event("nasfaq-stock-views-change"));
}

function subscribeSavedStockViews(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("nasfaq-stock-views-change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("nasfaq-stock-views-change", onStoreChange);
  };
}

function getSavedStockViewsSnapshot() {
  return JSON.stringify(readSavedStockViews());
}

function getServerSavedStockViewsSnapshot() {
  return "[]";
}

function pickRandomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : "-"}${fmtNumber(Math.abs(value), "$")}`;
}

function buildTradeConfirmation(args: {
  result: TradeExecutionResult;
  currentMidPrice: number | null | undefined;
  previousHolding: { quantity: number; avg_cost_basis: number } | null;
}): TradeConfirmation {
  const { result, currentMidPrice, previousHolding } = args;
  const previousQuantity = previousHolding?.quantity ?? 0;
  const previousAvgCost = previousHolding?.avg_cost_basis ?? 0;
  const isQueued = result.order_type === "live_market" && result.status === "pending";
  const filledQuantity = result.filled_quantity ?? 0;
  const executedPrice = result.executed_price ?? (result.indicative_price ?? 0);
  const fee = result.fee ?? 0;
  const grossValue = filledQuantity * executedPrice;
  const requestedQuantity = result.requested_quantity ?? filledQuantity;
  const nextQuantity = result.updated_holdings?.quantity ?? (result.side === "buy" ? previousQuantity + filledQuantity : previousQuantity - filledQuantity);
  const nextAvgCost = result.updated_holdings?.avg_cost_basis ?? (nextQuantity > 0 ? previousAvgCost : 0);
  const totalCost = result.total_cost ?? (result.side === "buy" ? grossValue + fee : null);
  const totalProceeds = result.total_proceeds ?? (result.side === "sell" ? grossValue - fee : null);
  const costBasisSold = result.cost_basis_sold ?? (result.side === "sell" ? previousAvgCost * filledQuantity : null);
  const netCashImpact = result.side === "buy" ? -(totalCost ?? (grossValue + fee)) : (totalProceeds ?? (grossValue - fee));
  const realizedPnl =
    result.side === "sell"
      ? (result.realized_pnl ?? ((totalProceeds ?? (grossValue - fee)) - (costBasisSold ?? 0)))
      : null;
  const unrealizedPnl =
    currentMidPrice !== null && currentMidPrice !== undefined && nextQuantity > 0
      ? nextQuantity * (currentMidPrice - nextAvgCost)
      : null;
  const expectedSellPnl =
    result.side === "sell" && isQueued
      ? (requestedQuantity * executedPrice) - fee - (previousAvgCost * requestedQuantity)
      : null;
  const themePnl = result.side === "sell" ? (expectedSellPnl ?? realizedPnl) : null;
  const imageSrc =
    result.side === "buy"
      ? pickRandomItem(TRADE_CONFIRMATION_BUY_IMAGES)
      : (themePnl ?? 0) >= 0
        ? pickRandomItem(TRADE_CONFIRMATION_SELL_GAIN_IMAGES)
        : pickRandomItem(TRADE_CONFIRMATION_SELL_LOSS_IMAGES);

  return {
    mode: isQueued ? "queued" : "filled",
    orderId: result.order_id ?? null,
    side: result.side,
    symbol: result.symbol,
    requestedQuantity,
    executeAfter: result.execute_after ?? null,
    intervalLimit: result.interval_limit ?? null,
    filledQuantity,
    executedPrice,
    fee,
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
    themePnl,
    imageSrc,
  };
}

function buildChannelMetricsMap(rows: OverviewRow[]) {
  const result = new Map<string, ChannelMetrics>();

  for (const row of rows) {
    const latest = pickLatestPoint(row.series || []);
    const latestTs = toTimestamp(latest?.time);
    const prior24h = latestTs === null ? null : pickPointAtOrBefore(row.series || [], latestTs - 24 * 60 * 60 * 1000);
    const latestSubscribers = toFiniteNumber(latest?.subscriber_count);
    const latestViews = toFiniteNumber(latest?.view_count);
    const latestVideos = toFiniteNumber(latest?.video_count);
    const priorSubscribers = toFiniteNumber(prior24h?.subscriber_count);
    const priorViews = toFiniteNumber(prior24h?.view_count);

    result.set(row.channel.youtube_channel_id, {
      subscribers: latestSubscribers,
      subscriberChangePct24h: computeChangePct(latestSubscribers, priorSubscribers),
      views: latestViews,
      viewChangePct24h: computeChangePct(latestViews, priorViews),
      videos: latestVideos,
    });
  }

  return result;
}

function SparklineCell({ asset, mode = "price" }: { asset: MarketAsset; mode?: CardGraphMetric }) {
  return (
    <div className={shellStyles.sparklineCell}>
      <SparklineChart candles={asset.sparkline_candles} mode={mode === "volume" ? "volume" : "price"} />
    </div>
  );
}

function StockArchiveCardGraph({
  asset,
  metric,
  points,
  intradayCandles,
  isLoadingIntradayCandles,
  intradayCandlesError,
}: {
  asset: MarketAsset;
  metric: CardGraphMetric;
  points: CardGraphPoint[];
  intradayCandles?: CandlePoint[];
  isLoadingIntradayCandles?: boolean;
  intradayCandlesError?: string | null;
}) {
  const { theme: colorMode } = useTheme();
  const themeSafeAssetColor = useMemo(
    () => getUsableChannelColor(asset.color, colorMode) || asset.color || null,
    [asset.color, colorMode]
  );
  const chartTheme = useMemo(() => createChannelChartTheme(themeSafeAssetColor), [themeSafeAssetColor]);
  const compactChartClassName = styles.cardDetailChart;

  if (metric === "price") {
    return (
      <CandleChartCard
        title="Price"
        subtitle="Recent market curve"
        candles={asset.sparkline_candles.slice(-90)}
        chartType="line"
        theme={chartTheme}
        height={170}
        compact
        className={compactChartClassName}
        bare
      />
    );
  }

  if (metric === "candles24h") {
    return (
      <CandleChartCard
        title="24H Market"
        subtitle={
          isLoadingIntradayCandles
            ? "Loading 1H candles"
            : intradayCandlesError
              ? "24H candles unavailable"
              : "1H candles from trades and adjustment ticks"
        }
        candles={intradayCandles || []}
        theme={chartTheme}
        height={170}
        compact
        candlePalette="market"
        className={compactChartClassName}
        bare
      />
    );
  }

  if (metric === "volume") {
    return (
      <VolumeChartCard
        title="Volume"
        subtitle="Recent settled shares"
        candles={asset.sparkline_candles.slice(-90)}
        theme={chartTheme}
        height={170}
        compact
        className={compactChartClassName}
        bare
      />
    );
  }

  const metricMeta = {
    subscribers: {
      title: "Subscribers",
      subtitle: "Audience trajectory",
      name: "Subscribers",
      color: chartTheme.base,
    },
    views: {
      title: "Views",
      subtitle: "Cumulative channel views",
      name: "Views",
      color: chartTheme.complement,
    },
    videos: {
      title: "Video Count",
      subtitle: "Published video total",
      name: "Videos",
      color: chartTheme.complementSoft,
    },
  }[metric];

  return (
    <TrendChartCard
      title={metricMeta.title}
      subtitle={metricMeta.subtitle}
      theme={chartTheme}
      height={170}
      compact
      className={compactChartClassName}
      bare
      series={[
        {
          name: metricMeta.name,
          color: metricMeta.color,
          kind: "area",
          values: points,
        },
      ]}
    />
  );
}

function compareNullableNumbers(a: number | null | undefined, b: number | null | undefined) {
  const left = a ?? Number.NEGATIVE_INFINITY;
  const right = b ?? Number.NEGATIVE_INFINITY;
  return left - right;
}

function compareStrings(a: string | null | undefined, b: string | null | undefined) {
  return stringCollator.compare(String(a || ""), String(b || ""));
}

function sortRows(rows: DerivedStockRow[], key: SortKey, direction: SortDirection) {
  const directionFactor = direction === "asc" ? 1 : -1;

  const sorted = [...rows].sort((a, b) => {
    const left = a.sortValues[key];
    const right = b.sortValues[key];
    const baseComparison = typeof left === "string" || typeof right === "string"
      ? compareStrings(String(left ?? ""), String(right ?? ""))
      : compareNullableNumbers(left as number | null | undefined, right as number | null | undefined);

    if (baseComparison !== 0) {
      return baseComparison * directionFactor;
    }

    return stringCollator.compare(a.asset.symbol, b.asset.symbol);
  });

  return sorted;
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return <HiOutlineArrowsUpDown className={styles.sortHint} aria-hidden="true" />;
  }

  return direction === "asc"
    ? <HiMiniArrowSmallUp className={styles.sortHint} aria-hidden="true" />
    : <HiMiniArrowSmallDown className={styles.sortHint} aria-hidden="true" />;
}

function DataItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className={styles.dataItem}>
      <dt className={styles.dataLabel}>{label}</dt>
      <dd
        className={[
          styles.dataValue,
          tone === "positive" ? shellStyles.positive : "",
          tone === "negative" ? shellStyles.negative : "",
        ].filter(Boolean).join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function StockMetric({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className={styles.stockMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{meta}</em>
    </div>
  );
}

export function StocksPage() {
  const router = useRouter();
  const { user } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol);
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const error = useMarketStore((state) => state.error);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const fetchPortfolioOrders = useProfileStore((state) => state.fetchPortfolioOrders);
  const [overviewRows, setOverviewRows] = useState<OverviewRow[]>([]);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [unitFilter, setUnitFilter] = useState("all");
  const [priceMoveFilter, setPriceMoveFilter] = useState<PriceMoveFilter>("all");
  const [volumeChangeFilter, setVolumeChangeFilter] = useState<VolumeChangeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const savedViewsSnapshot = useSyncExternalStore(
    subscribeSavedStockViews,
    getSavedStockViewsSnapshot,
    getServerSavedStockViewsSnapshot
  );
  const savedViews = useMemo(() => JSON.parse(savedViewsSnapshot) as SavedStockView[], [savedViewsSnapshot]);
  const [viewNameDraft, setViewNameDraft] = useState("");
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [viewStockFilterSymbols, setViewStockFilterSymbols] = useState<string[]>([]);
  const [activeViewName, setActiveViewName] = useState("");
  const [archiveViewMode, setArchiveViewMode] = useState<ArchiveViewMode>("table");
  const [cardGraphMetric, setCardGraphMetric] = useState<CardGraphMetric>("price");
  const [intradayCandlesBySymbol, setIntradayCandlesBySymbol] = useState<Record<string, CandlePoint[]>>({});
  const [intradayLoadingBySymbol, setIntradayLoadingBySymbol] = useState<Record<string, boolean>>({});
  const [intradayErrorsBySymbol, setIntradayErrorsBySymbol] = useState<Record<string, string | null>>({});
  const intradayCandlesBySymbolRef = useRef(intradayCandlesBySymbol);
  const intradayLoadingBySymbolRef = useRef(intradayLoadingBySymbol);
  const [quickTradeSymbol, setQuickTradeSymbol] = useState("");
  const [quickTradeSide, setQuickTradeSide] = useState<TradeSide>("buy");
  const [quickTradeQuantity, setQuickTradeQuantity] = useState("10");
  const [lastQuickTradeQuantityPreset, setLastQuickTradeQuantityPreset] = useState<string | null>(null);
  const [quickTradeFailureNotice, setQuickTradeFailureNotice] = useState<TradeFailureNotice | null>(null);
  const [isQuickTradeClosing, setIsQuickTradeClosing] = useState(false);
  const [tradeConfirmation, setTradeConfirmation] = useState<TradeConfirmation | null>(null);
  const [isTradeConfirmationClosing, setIsTradeConfirmationClosing] = useState(false);
  const [isQuickTradeSubmitting, setIsQuickTradeSubmitting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [, timeseriesResult] = await Promise.allSettled([
        refreshOverview(),
        apiFetch<OverviewRow[]>("/api/overview/timeseries?days=90&limit=200", { cache: "no-store" }),
      ]);

      if (cancelled) return;

      if (timeseriesResult.status === "fulfilled") {
        setOverviewRows(timeseriesResult.value || []);
        setChannelError(null);
      } else {
        setOverviewRows([]);
        setChannelError(String((timeseriesResult.reason as Error)?.message || timeseriesResult.reason));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshOverview]);

  useEffect(() => {
    if (!user) return;
    void fetchPortfolio();
  }, [fetchPortfolio, user]);

  const channelMetricsById = useMemo(() => buildChannelMetricsMap(overviewRows), [overviewRows]);
  const channelSeriesById = useMemo(() => {
    const result = new Map<string, OverviewTimeSeriesPoint[]>();
    for (const row of overviewRows) {
      const channel = row.channel as {
        youtube_channel_id?: string | null;
        symbol?: string | null;
      };
      if (channel.youtube_channel_id) {
        result.set(channel.youtube_channel_id, row.series || []);
      }
      if (channel.symbol) {
        result.set(channel.symbol.toUpperCase(), row.series || []);
      }
      for (const point of row.series || []) {
        if (point.youtube_channel_id) {
          result.set(point.youtube_channel_id, row.series || []);
          break;
        }
      }
    }
    return result;
  }, [overviewRows]);
  const unitOptions = useMemo(
    () => [
      { value: "all", label: "All units" },
      ...Array.from(new Set(assets.map((asset) => asset.unit).filter((value): value is string => Boolean(value))))
        .sort((a, b) => a.localeCompare(b))
        .map((option) => ({ value: option, label: option })),
    ],
    [assets]
  );
  const priceMoveOptions = useMemo(
    () => [
      { value: "all", label: "All moves" },
      { value: "positive", label: "Positive only" },
      { value: "negative", label: "Negative only" },
    ],
    []
  );
  const volumeChangeOptions = useMemo(
    () => [
      { value: "all", label: "All volume trends" },
      { value: "positive", label: "Rising volume" },
      { value: "negative", label: "Falling volume" },
    ],
    []
  );
  const mobileSortOptions = useMemo(
    () => MOBILE_SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    []
  );

  const rows = useMemo<DerivedStockRow[]>(
    () =>
      assets.map((asset) => ({
        ...(() => {
          const channelMetrics = channelMetricsById.get(asset.youtube_channel_id);
          const volumeChangePct = computeDailyVolumeChange(asset.volume_24h, asset.sparkline_candles).pct;
          const adjustmentMovePct = computeAdjustmentMovePct(asset);

          return {
            asset,
            channelMetrics,
            volumeChangePct,
            href: `/stocks/${encodeURIComponent(asset.symbol)}`,
            isSelected: asset.symbol === selectedSymbol,
            sortValues: {
              symbol: asset.symbol,
              name: asset.display_name,
              unit: asset.unit ?? "",
              mid: asset.current_mid_price,
              medium: asset.current_bid_price,
              settlementMove: adjustmentMovePct,
              move24h: asset.move_24h_pct,
              volume24h: asset.volume_24h,
              volumeChange: volumeChangePct,
              subscribers: channelMetrics?.subscribers ?? null,
              subscriberChange: channelMetrics?.subscriberChangePct24h ?? null,
              views: channelMetrics?.views ?? null,
              viewChange: channelMetrics?.viewChangePct24h ?? null,
              videos: channelMetrics?.videos ?? null,
            },
          };
        })(),
      })),
    [assets, channelMetricsById, selectedSymbol]
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = normalizeSearchValue(searchQuery);
    return rows.filter((row) => {
      const matchesUnit = unitFilter === "all" || row.asset.unit === unitFilter;
      const matchesViewStockSet = !viewStockFilterSymbols.length || viewStockFilterSymbols.includes(row.asset.symbol);
      const matchesSearch = !normalizedSearch || [
        row.asset.symbol,
        row.asset.display_name,
        row.asset.unit || "",
      ].some((value) => normalizeSearchValue(value).includes(normalizedSearch));
      const move = row.asset.move_24h_pct;
      const volumeChange = row.volumeChangePct;
      const matchesPriceMove =
        priceMoveFilter === "all" ||
        (priceMoveFilter === "positive" ? (move ?? 0) > 0 : (move ?? 0) < 0);
      const matchesVolumeChange =
        volumeChangeFilter === "all" ||
        (volumeChangeFilter === "positive" ? (volumeChange ?? 0) > 0 : (volumeChange ?? 0) < 0);

      return matchesViewStockSet && matchesSearch && matchesUnit && matchesPriceMove && matchesVolumeChange;
    });
  }, [priceMoveFilter, rows, searchQuery, unitFilter, viewStockFilterSymbols, volumeChangeFilter]);

  const sortedRows = useMemo(() => sortRows(filteredRows, sortKey, sortDirection), [filteredRows, sortDirection, sortKey]);
  const sortedRowSymbols = useMemo(() => sortedRows.map((row) => row.asset.symbol), [sortedRows]);
  const sortedRowSymbolsKey = useMemo(() => sortedRowSymbols.join("\u0000"), [sortedRowSymbols]);
  const advancingCount = useMemo(() => rows.filter((row) => (row.asset.move_24h_pct ?? 0) > 0).length, [rows]);
  const decliningCount = useMemo(() => rows.filter((row) => (row.asset.move_24h_pct ?? 0) < 0).length, [rows]);
  const totalVolume = useMemo(() => rows.reduce((sum, row) => sum + (row.asset.volume_24h ?? 0), 0), [rows]);
  const compareRows = useMemo(
    () => compareSymbols
      .map((symbol) => rows.find((row) => row.asset.symbol === symbol))
      .filter((row): row is DerivedStockRow => Boolean(row)),
    [compareSymbols, rows]
  );
  const quickTradeAsset = useMemo(
    () => assets.find((asset) => asset.symbol === quickTradeSymbol) || null,
    [assets, quickTradeSymbol]
  );
  const quickTradeHolding = useMemo(
    () => portfolio?.holdings.find((holding) => holding.symbol === quickTradeSymbol) || null,
    [portfolio?.holdings, quickTradeSymbol]
  );
  const quickTradeEstimatedNotional = (quickTradeAsset?.current_mid_price ?? 0) * Math.max(Number(quickTradeQuantity) || 0, 0);
  const tradingOpen = marketStatus?.is_trading_open ?? true;
  const needsVerification = userNeedsEmailVerification(user);
  const discoveryCards = useMemo(() => {
    const byMove = [...rows].sort((a, b) => (b.asset.move_24h_pct ?? Number.NEGATIVE_INFINITY) - (a.asset.move_24h_pct ?? Number.NEGATIVE_INFINITY))[0];
    const byVolume = [...rows].sort((a, b) => (b.asset.volume_24h ?? Number.NEGATIVE_INFINITY) - (a.asset.volume_24h ?? Number.NEGATIVE_INFINITY))[0];
    return [
      { id: "move", label: "Top today move", row: byMove, value: formatSignedPct(byMove?.asset.move_24h_pct) },
      { id: "volume", label: "Volume leader", row: byVolume, value: fmtNumber(byVolume?.asset.volume_24h) },
    ];
  }, [rows]);

  useEffect(() => {
    intradayCandlesBySymbolRef.current = intradayCandlesBySymbol;
  }, [intradayCandlesBySymbol]);

  useEffect(() => {
    intradayLoadingBySymbolRef.current = intradayLoadingBySymbol;
  }, [intradayLoadingBySymbol]);

  useEffect(() => {
    if (archiveViewMode !== "cards" || cardGraphMetric !== "candles24h") return;

    const missingSymbols = sortedRowSymbols.filter((symbol) => (
      intradayCandlesBySymbolRef.current[symbol] === undefined &&
      !intradayLoadingBySymbolRef.current[symbol]
    ));
    if (!missingSymbols.length) return;

    let cancelled = false;
    setIntradayLoadingBySymbol((current) => {
      const next = { ...current };
      for (const symbol of missingSymbols) next[symbol] = true;
      return next;
    });

    let nextIndex = 0;
    async function loadNext() {
      while (!cancelled && nextIndex < missingSymbols.length) {
        const symbol = missingSymbols[nextIndex];
        nextIndex += 1;
        try {
          const result = await apiFetch<{ candles: Array<Record<string, unknown>> }>(
            `/api/market/assets/${encodeURIComponent(symbol)}/candles?interval=1h&range=24h`,
            { cache: "no-store" }
          );
          if (cancelled) return;
          setIntradayCandlesBySymbol((current) => ({
            ...current,
            [symbol]: normalizeCandles(result.candles || []),
          }));
          setIntradayErrorsBySymbol((current) => ({ ...current, [symbol]: null }));
        } catch (nextError) {
          if (cancelled) return;
          setIntradayCandlesBySymbol((current) => ({ ...current, [symbol]: [] }));
          setIntradayErrorsBySymbol((current) => ({
            ...current,
            [symbol]: String((nextError as Error).message || nextError),
          }));
        } finally {
          if (!cancelled) {
            setIntradayLoadingBySymbol((current) => ({ ...current, [symbol]: false }));
          }
        }
      }
    }

    const workerCount = Math.min(6, missingSymbols.length);
    for (let index = 0; index < workerCount; index += 1) {
      void loadNext();
    }

    return () => {
      cancelled = true;
    };
  }, [archiveViewMode, cardGraphMetric, sortedRowSymbols, sortedRowSymbolsKey]);

  function openRow(row: DerivedStockRow) {
    setSelectedSymbol(row.asset.symbol);
    router.push(row.href);
  }

  function toggleDesktopSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "symbol" || nextKey === "name" || nextKey === "unit" ? "asc" : "desc");
  }

  function resetFilters() {
    setUnitFilter("all");
    setPriceMoveFilter("all");
    setVolumeChangeFilter("all");
    setSearchQuery("");
    setViewStockFilterSymbols([]);
    setActiveViewName("");
    setSortKey("symbol");
    setSortDirection("asc");
  }

  function applyBuiltInView(view: PresetKind) {
    resetFilters();
    if (view === "movers") {
      setPriceMoveFilter("positive");
      setSortKey("move24h");
      setSortDirection("desc");
    }
    if (view === "volume") {
      setSortKey("volume24h");
      setSortDirection("desc");
    }
  }

  function applySavedView(view: SavedStockView) {
    setUnitFilter(view.unitFilter);
    setPriceMoveFilter(view.priceMoveFilter);
    setVolumeChangeFilter(view.volumeChangeFilter);
    setSearchQuery(view.searchQuery);
    setViewStockFilterSymbols(view.selectedSymbols);
    setActiveViewName(view.name);
    setSortKey(view.sortKey);
    setSortDirection(view.sortDirection);
  }

  function saveCurrentView() {
    const name = viewNameDraft.trim();
    if (!name) return;
    const nextView: SavedStockView = {
      id: `${Date.now()}`,
      name,
      unitFilter,
      priceMoveFilter,
      volumeChangeFilter,
      searchQuery,
      selectedSymbols: compareSymbols,
      sortKey,
      sortDirection,
    };
    const nextViews = [nextView, ...savedViews].slice(0, 8);
    writeSavedStockViews(nextViews);
    setViewStockFilterSymbols(compareSymbols);
    setActiveViewName(name);
    setCompareSymbols([]);
    setViewNameDraft("");
  }

  function removeSavedView(id: string) {
    const nextViews = savedViews.filter((view) => view.id !== id);
    writeSavedStockViews(nextViews);
  }

  function toggleCompare(symbol: string) {
    setCompareSymbols((current) => (
      current.includes(symbol)
        ? current.filter((item) => item !== symbol)
        : [...current, symbol]
    ));
  }

  function selectAllVisibleRows() {
    if (!sortedRows.length) return;
    const visibleSymbols = sortedRows.map((row) => row.asset.symbol);
    setCompareSymbols((current) => {
      const nextSymbols = new Set(current);
      visibleSymbols.forEach((symbol) => nextSymbols.add(symbol));
      return Array.from(nextSymbols);
    });
  }

  function clearSavedViewFilter() {
    setViewStockFilterSymbols([]);
    setActiveViewName("");
  }

  function getCardGraphPoints(row: DerivedStockRow, metric: CardGraphMetric) {
    if (metric === "candles24h") {
      return [];
    }

    if (metric === "price" || metric === "volume") {
      return row.asset.sparkline_candles
        .slice(-90)
        .map((item) => ({
          time: item.bucket,
          value: toFiniteNumber(metric === "volume" ? item.volume_shares : item.close_mark ?? item.close),
        }))
        .filter((point): point is CardGraphPoint => (
          point.value !== null &&
          point.value !== undefined &&
          Number.isFinite(point.value)
        ));
    }

    const series = channelSeriesById.get(row.asset.youtube_channel_id) || channelSeriesById.get(row.asset.symbol.toUpperCase()) || [];
    return series
      .slice(-90)
      .map((item) => ({
        time: item.time,
        value: toFiniteNumber(metric === "subscribers"
          ? item.subscriber_count
          : metric === "views"
            ? item.view_count
            : item.video_count),
      }))
      .filter((point): point is CardGraphPoint => (
        point.value !== null &&
        point.value !== undefined &&
        Number.isFinite(point.value)
      ));
  }

  function openQuickTrade(asset: MarketAsset) {
    setQuickTradeSymbol(asset.symbol);
    setIsQuickTradeClosing(false);
    setQuickTradeSide("buy");
    setQuickTradeQuantity("10");
    setLastQuickTradeQuantityPreset(null);
    setQuickTradeFailureNotice(null);
    setTradeConfirmation(null);
    setIsTradeConfirmationClosing(false);
  }

  function applyQuickTradeQuantityPreset(preset: string) {
    if (lastQuickTradeQuantityPreset === preset) {
      setQuickTradeQuantity((current) => String((Number(current) || 0) + Number(preset)));
    } else {
      setQuickTradeQuantity(preset);
    }
    setLastQuickTradeQuantityPreset(preset);
  }

  function closeQuickTrade() {
    if (!quickTradeSymbol || isQuickTradeClosing) return;
    setIsQuickTradeClosing(true);
    globalThis.setTimeout(() => {
      setQuickTradeSymbol("");
      setIsQuickTradeClosing(false);
    }, QUICK_TRADE_CLOSE_ANIMATION_MS);
  }

  function closeTradeConfirmation() {
    if (!tradeConfirmation || isTradeConfirmationClosing) return;
    setIsTradeConfirmationClosing(true);
    globalThis.setTimeout(() => {
      setTradeConfirmation(null);
      setIsTradeConfirmationClosing(false);
      closeQuickTrade();
    }, TRADE_CONFIRMATION_ANIMATION_MS);
  }

  async function handleQuickTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickTradeAsset) return;
    if (!user) {
      setQuickTradeFailureNotice({
        title: "Sign in required",
        message: "Sign in to trade and manage your portfolio.",
      });
      return;
    }
    if (needsVerification) {
      setQuickTradeFailureNotice({
        title: "Email verification required",
        message: "Verify your email before you can trade.",
      });
      return;
    }
    if (!tradingOpen) {
      setQuickTradeFailureNotice({
        title: "Market is closed",
        message: marketStatus?.trading_message || "Trading is unavailable right now. Wait for the market to reopen, then submit the order again.",
      });
      return;
    }

    setIsQuickTradeSubmitting(true);
    setQuickTradeFailureNotice(null);
    setTradeConfirmation(null);
    setIsTradeConfirmationClosing(false);
    try {
      const previousHolding = quickTradeHolding;
      const result = await apiFetch<TradeExecutionResult>(`/api/market/orders/${quickTradeSide}`, {
        method: "POST",
        body: JSON.stringify({ symbol: quickTradeAsset.symbol, quantity: Number(quickTradeQuantity) }),
      });
      setTradeConfirmation(
        buildTradeConfirmation({
          result,
          currentMidPrice: quickTradeAsset.current_mid_price,
          previousHolding,
        })
      );
      await Promise.all([refreshOverview(), fetchPortfolio(), fetchPortfolioOrders()]);
    } catch (error) {
      const errorCode = String((error as Error).message || error);
      setQuickTradeFailureNotice(getTradeFailureNotice(errorCode, quickTradeSide, quickTradeAsset.symbol));
    } finally {
      setIsQuickTradeSubmitting(false);
    }
  }

  return (
    <SiteShell>
      <div className={`${shellStyles.stack} ${styles.stocksPage}`.trim()}>
        <section className={styles.hero}>
          <Image
            src="/stocks-archive-hero.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className={styles.heroImage}
            aria-hidden="true"
          />
          <div className={styles.heroCopy}>
            <div className={styles.heroEyebrow}>
              <FaCoins aria-hidden="true" />
              Market desk
            </div>
            <h1 className={styles.title}>Stocks</h1>
            <p className={styles.heroText}>Search, screen, compare, and save custom market views across every NASFAQ asset.</p>
            <label className={styles.heroSearch}>
              <FaMagnifyingGlass aria-hidden="true" />
              <input
                value={searchQuery}
                onChange={(event) => startTransition(() => setSearchQuery(event.target.value))}
                placeholder="Search symbols, names, or units"
              />
            </label>
            <div className={styles.heroMeta}>
              <span>{rows.length ? `Showing ${sortedRows.length} of ${rows.length} assets` : isLoadingOverview ? "Loading assets..." : "No assets loaded"}</span>
              <span>{advancingCount} up today / {decliningCount} down today</span>
              <span>{viewStockFilterSymbols.length ? `${viewStockFilterSymbols.length} in active view` : `${compareSymbols.length} selected`}</span>
            </div>
          </div>
          <div className={styles.heroMetrics}>
            <StockMetric label="Assets" value={fmtInteger(rows.length)} meta={`${fmtInteger(sortedRows.length)} visible`} />
            <StockMetric label="Advancers" value={fmtInteger(advancingCount)} meta={`${fmtInteger(decliningCount)} decliners`} />
            <StockMetric label="Volume" value={fmtNumber(totalVolume)} meta="24H total" />
          </div>
        </section>

        {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
        {channelError ? <div className="statusMessage statusMessageError">Channel request error: {channelError}</div> : null}
        {isLoadingOverview ? <div className={shellStyles.panel}>Loading stock data…</div> : null}

        <section className={styles.viewsPanel}>
          <div className={styles.filtersHeader}>
            <div>
              <h2 className={styles.sectionTitle}><FaBookmark aria-hidden="true" /> Views</h2>
              <p className={styles.sectionCopy}>Jump into built-in screeners or save the current search, filters, sort, and selected stock set.</p>
            </div>
            <div className={styles.saveViewControl}>
              <input value={viewNameDraft} onChange={(event) => setViewNameDraft(event.target.value)} placeholder="Name current view" />
              <button type="button" className={styles.resetButton} onClick={saveCurrentView} disabled={!viewNameDraft.trim()}>
                <FaFloppyDisk aria-hidden="true" />
                Save
              </button>
            </div>
          </div>
          <div className={styles.viewStrip}>
            {BUILT_IN_VIEWS.map((view) => (
              <button key={view.id} type="button" className={styles.viewChip} onClick={() => applyBuiltInView(view.id)}>
                <strong>{view.name}</strong>
                <span>{view.description}</span>
              </button>
            ))}
            {savedViews.map((view) => (
              <div key={view.id} className={`${styles.viewChip} ${styles.viewChipSaved}`}>
                <button type="button" className={styles.viewChipMain} onClick={() => applySavedView(view)}>
                  <strong>{view.name}</strong>
                  <span>{view.selectedSymbols.length ? `${view.selectedSymbols.length} stocks` : "Filter view"}</span>
                </button>
                <button
                  type="button"
                  className={styles.removeView}
                  onClick={() => removeSavedView(view.id)}
                  aria-label={`Remove ${view.name}`}
                >
                  <FaXmark aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.discoveryGrid}>
          {discoveryCards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={styles.discoveryCard}
              onClick={() => {
                if (card.row) openRow(card.row);
              }}
              disabled={!card.row}
            >
              {card.row ? (
                <>
                  <AssetCoin symbol={card.row.asset.symbol} icon={card.row.asset.icon} color={card.row.asset.color} />
                  <span>
                    <em>{card.label}</em>
                    <strong>{card.row.asset.symbol}</strong>
                    <small>{card.row.asset.display_name}</small>
                    <b>{card.value}</b>
                  </span>
                </>
              ) : <strong>—</strong>}
            </button>
          ))}
        </section>

        <section className={styles.filtersPanel}>
          <div className={styles.filtersHeader}>
            <div>
              <h2 className={styles.sectionTitle}><FaSliders aria-hidden="true" /> Screener</h2>
              <p className={styles.sectionCopy}>Refine the archive by search, unit, price action, volume trend, and sort order.</p>
            </div>
            <button
              type="button"
              className={styles.resetButton}
              onClick={resetFilters}
            >
              Reset filters
            </button>
          </div>

          <div className={styles.filtersGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Search</span>
              <input
                className={styles.textInput}
                value={searchQuery}
                onChange={(event) => startTransition(() => setSearchQuery(event.target.value))}
                placeholder="Symbol, name, or unit"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Unit</span>
              <OptionPicker
                value={unitFilter}
                options={unitOptions}
                onChange={(nextValue) => {
                  startTransition(() => setUnitFilter(nextValue));
                }}
                placeholder="All units"
                searchable
                searchPlaceholder="Search units"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Today price change</span>
              <OptionPicker
                value={priceMoveFilter}
                options={priceMoveOptions}
                onChange={(nextValue) => {
                  startTransition(() => setPriceMoveFilter(nextValue as PriceMoveFilter));
                }}
                placeholder="All today moves"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Volume change</span>
              <OptionPicker
                value={volumeChangeFilter}
                options={volumeChangeOptions}
                onChange={(nextValue) => {
                  startTransition(() => setVolumeChangeFilter(nextValue as VolumeChangeFilter));
                }}
                placeholder="All volume trends"
              />
            </label>

            <label className={`${styles.field} ${styles.mobileSortField}`}>
              <span className={styles.fieldLabel}>Sort</span>
              <OptionPicker
                value={`${sortKey}:${sortDirection}`}
                options={mobileSortOptions}
                onChange={(nextValue) => {
                  const [nextKey, nextDirection] = nextValue.split(":") as [SortKey, SortDirection];
                  startTransition(() => {
                    setSortKey(nextKey);
                    setSortDirection(nextDirection);
                  });
                }}
                placeholder="Select sort"
                searchable
                searchPlaceholder="Search sort options"
              />
            </label>
          </div>

          <div className={styles.resultsMeta}>
            Showing {sortedRows.length} of {rows.length} coins
          </div>
          {activeViewName ? (
            <div className={styles.activeViewBar}>
              <span>Active view: <strong>{activeViewName}</strong></span>
              {viewStockFilterSymbols.length ? <span>{viewStockFilterSymbols.length} saved stocks</span> : null}
              <button type="button" onClick={clearSavedViewFilter}>Clear stock set</button>
            </div>
          ) : null}
        </section>

        <section className={styles.tablePanel}>
          <div className={styles.feedHeader}>
            <div>
              <h2 className={styles.sectionTitle}><FaChartLine aria-hidden="true" /> Stock tape</h2>
              <p className={styles.sectionCopy}>Sortable market rows with pricing, creator metrics, and movement.</p>
            </div>
            <div className={styles.feedActions}>
              <button
                type="button"
                className={styles.selectAllButton}
                onClick={selectAllVisibleRows}
                disabled={!sortedRows.length}
              >
                <FaPlus aria-hidden="true" />
                Select All
              </button>
              <div className={styles.viewToggle} aria-label="Archive display mode">
                <button
                  type="button"
                  className={`${styles.toggleButton} ${archiveViewMode === "table" ? styles.toggleButtonActive : ""}`.trim()}
                  onClick={() => setArchiveViewMode("table")}
                  aria-pressed={archiveViewMode === "table"}
                >
                  <FaTable aria-hidden="true" />
                  Table
                </button>
                <button
                  type="button"
                  className={`${styles.toggleButton} ${archiveViewMode === "cards" ? styles.toggleButtonActive : ""}`.trim()}
                  onClick={() => setArchiveViewMode("cards")}
                  aria-pressed={archiveViewMode === "cards"}
                >
                  <FaGrip aria-hidden="true" />
                  Cards
                </button>
              </div>
              {archiveViewMode === "cards" ? (
                <div className={styles.metricSelect}>
                  <FaChartSimple aria-hidden="true" />
                  <span>Graph</span>
                  <OptionPicker
                    value={cardGraphMetric}
                    options={CARD_GRAPH_OPTIONS}
                    onChange={(nextValue) => setCardGraphMetric(nextValue as CardGraphMetric)}
                    placeholder="Select graph"
                  />
                </div>
              ) : null}
              <div className={styles.resultsMeta}>{sortedRows.length} visible</div>
            </div>
          </div>
          <div className={`${shellStyles.tableWrap} ${styles.desktopTable} ${archiveViewMode === "cards" ? styles.desktopTableHidden : ""}`.trim()}>
            <table className={`${shellStyles.stockTable} ${styles.stockTableCompact}`}>
              <thead>
                <tr>
                  <th>Compare</th>
                  <th>Trade</th>
                  <th>Queue</th>
                  <th>Icon</th>
                  {SORTABLE_COLUMNS.slice(0, 3).map((column) => (
                    <th key={column.key}>
                      <button type="button" className={styles.sortButton} onClick={() => toggleDesktopSort(column.key)}>
                        <span>{column.label}</span>
                        <SortIndicator active={sortKey === column.key} direction={sortDirection} />
                      </button>
                    </th>
                  ))}
                  <th>Trend</th>
                  {SORTABLE_COLUMNS.slice(3).map((column) => (
                    <th key={column.key}>
                      <button type="button" className={styles.sortButton} onClick={() => toggleDesktopSort(column.key)}>
                        <span>{column.label}</span>
                        <SortIndicator active={sortKey === column.key} direction={sortDirection} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const { asset, channelMetrics, isSelected } = row;
                  const adjustmentMovePct = row.sortValues.settlementMove as number | null;
                  return (
                    <tr
                      key={asset.symbol}
                      className={`${shellStyles.stockRow} ${isSelected ? shellStyles.stockRowSelected : ""}`}
                      onClick={() => openRow(row)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        openRow(row);
                      }}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${asset.symbol} detail page`}
                    >
                      <td onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className={`${styles.compareButton} ${compareSymbols.includes(asset.symbol) ? styles.compareButtonActive : ""}`.trim()}
                          onClick={() => toggleCompare(asset.symbol)}
                          aria-pressed={compareSymbols.includes(asset.symbol)}
                        >
                          <FaPlus aria-hidden="true" />
                        </button>
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className={styles.quickTradeButton}
                          onClick={() => openQuickTrade(asset)}
                          aria-label={`Quick trade ${asset.symbol}`}
                        >
                          <FaCartShopping aria-hidden="true" />
                        </button>
                      </td>
                      <td>
                        <span className={styles.queueMini}>
                          <strong>{fmtNumber(asset.pending_live_order_count ?? 0)}</strong>
                          <em>{fmtNumber(asset.pending_live_buy_count ?? 0)}B / {fmtNumber(asset.pending_live_sell_count ?? 0)}S</em>
                        </span>
                      </td>
                      <td>
                        <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} />
                      </td>
                      <td className={shellStyles.symbolCell}>{asset.symbol}</td>
                      <td>{asset.display_name}</td>
                      <td>{asset.unit || "—"}</td>
                      <td>
                        <SparklineCell asset={asset} />
                      </td>
                      <td>{formatPrice(asset.current_mid_price)}</td>
                      <td>{formatPrice(asset.current_bid_price)}</td>
                      <td className={(adjustmentMovePct ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(adjustmentMovePct)}
                      </td>
                      <td className={(asset.move_24h_pct ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(asset.move_24h_pct)}
                      </td>
                      <td>{fmtNumber(asset.volume_24h)}</td>
                      <td className={(row.volumeChangePct ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(row.volumeChangePct)}
                      </td>
                      <td>{fmtInteger(channelMetrics?.subscribers)}</td>
                      <td className={(channelMetrics?.subscriberChangePct24h ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(channelMetrics?.subscriberChangePct24h)}
                      </td>
                      <td>{fmtInteger(channelMetrics?.views)}</td>
                      <td className={(channelMetrics?.viewChangePct24h ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(channelMetrics?.viewChangePct24h)}
                      </td>
                      <td>{fmtInteger(channelMetrics?.videos)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {archiveViewMode === "cards" ? (
            <div className={`${styles.cardList} ${styles.cardListArchive}`.trim()}>
              {sortedRows.map((row) => {
                const { asset, channelMetrics, isSelected, volumeChangePct } = row;
                const priceTone = (asset.move_24h_pct ?? 0) > 0 ? "positive" : (asset.move_24h_pct ?? 0) < 0 ? "negative" : undefined;
                const cardGraphPoints = getCardGraphPoints(row, cardGraphMetric);
                const volumeTone = (volumeChangePct ?? 0) > 0 ? "positive" : (volumeChangePct ?? 0) < 0 ? "negative" : undefined;
                const subscriberTone =
                  (channelMetrics?.subscriberChangePct24h ?? 0) > 0
                    ? "positive"
                    : (channelMetrics?.subscriberChangePct24h ?? 0) < 0
                      ? "negative"
                      : undefined;
                const viewTone =
                  (channelMetrics?.viewChangePct24h ?? 0) > 0
                    ? "positive"
                    : (channelMetrics?.viewChangePct24h ?? 0) < 0
                      ? "negative"
                      : undefined;

                return (
                  <article
                    key={asset.symbol}
                    className={`${styles.stockCard} ${isSelected ? styles.stockCardSelected : ""}`}
                    onClick={() => openRow(row)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openRow(row);
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open ${asset.symbol} detail page`}
                  >
                    <div className={styles.cardHeader}>
                      <div className={styles.cardIdentity}>
                        <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} />
                        <div className={styles.cardIdentityText}>
                          <div className={styles.cardSymbolRow}>
                            <strong className={styles.cardSymbol}>{asset.symbol}</strong>
                            <span className={styles.cardUnit}>{asset.unit || "—"}</span>
                          </div>
                          <div className={styles.cardName}>{asset.display_name}</div>
                        </div>
                      </div>
                      <div className={styles.cardActionRow}>
                        <button
                          type="button"
                          className={`${styles.compareButton} ${compareSymbols.includes(asset.symbol) ? styles.compareButtonActive : ""}`.trim()}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleCompare(asset.symbol);
                          }}
                          aria-pressed={compareSymbols.includes(asset.symbol)}
                        >
                          <FaPlus aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={styles.quickTradeButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            openQuickTrade(asset);
                          }}
                          aria-label={`Quick trade ${asset.symbol}`}
                        >
                          <FaCartShopping aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div className={styles.cardMarketHero}>
                      <strong className={styles.cardPrice}>{formatPrice(asset.current_mid_price)}</strong>
                      <span
                        className={[
                          styles.cardDelta,
                          priceTone === "positive" ? shellStyles.positive : "",
                          priceTone === "negative" ? shellStyles.negative : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {(asset.move_24h_pct ?? 0) >= 0 ? <FaArrowTrendUp aria-hidden="true" /> : <FaArrowTrendDown aria-hidden="true" />}
                        {formatSignedPct(asset.move_24h_pct)}
                      </span>
                    </div>

                    <div className={styles.cardSparkline}>
                      <StockArchiveCardGraph
                        asset={asset}
                        metric={cardGraphMetric}
                        points={cardGraphPoints}
                        intradayCandles={intradayCandlesBySymbol[asset.symbol]}
                        isLoadingIntradayCandles={intradayLoadingBySymbol[asset.symbol]}
                        intradayCandlesError={intradayErrorsBySymbol[asset.symbol]}
                      />
                    </div>

                    <dl className={styles.dataGrid}>
                      <DataItem label="Medium" value={formatPrice(asset.current_bid_price)} />
                      <DataItem label="Next Tick Queue" value={`${fmtNumber(asset.pending_live_order_count ?? 0)} (${fmtNumber(asset.pending_live_buy_count ?? 0)}B / ${fmtNumber(asset.pending_live_sell_count ?? 0)}S)`} />
                      <DataItem label="24H Volume" value={fmtNumber(asset.volume_24h)} />
                      <DataItem label="Volume Change" value={formatSignedPct(volumeChangePct)} tone={volumeTone} />
                      <DataItem label="Subscribers" value={fmtInteger(channelMetrics?.subscribers)} />
                      <DataItem label="24H Sub Change" value={formatSignedPct(channelMetrics?.subscriberChangePct24h)} tone={subscriberTone} />
                      <DataItem label="Views" value={fmtInteger(channelMetrics?.views)} />
                      <DataItem label="24H View Change" value={formatSignedPct(channelMetrics?.viewChangePct24h)} tone={viewTone} />
                      <DataItem label="Videos" value={fmtInteger(channelMetrics?.videos)} />
                    </dl>
                  </article>
                );
              })}
            </div>
          ) : null}

          {!sortedRows.length ? <div className={styles.empty}>No stocks matched the current filters.</div> : null}

        </section>

        <div className={styles.tableFooterMascot}>
          <Image src="/tako.png" alt="" width={300} height={300} />
        </div>

        {compareRows.length ? (
          <section className={styles.compareTray}>
            <div className={styles.compareHeader}>
              <div>
                <h2 className={styles.sectionTitle}>View Builder</h2>
                <p className={styles.sectionCopy}>Selected stocks become the saved stock set for the next custom view.</p>
              </div>
              <button type="button" className={styles.resetButton} onClick={() => setCompareSymbols([])}>Clear</button>
            </div>
            <div className={styles.compareGrid}>
              {compareRows.map((row) => (
                <article key={row.asset.symbol} className={styles.compareCard}>
                  <div className={styles.cardIdentity}>
                    <AssetCoin symbol={row.asset.symbol} icon={row.asset.icon} color={row.asset.color} />
                    <div className={styles.cardIdentityText}>
                      <strong>{row.asset.symbol}</strong>
                      <span>{row.asset.display_name}</span>
                    </div>
                  </div>
                  <span className={styles.comparePrice}>{formatPrice(row.asset.current_mid_price)}</span>
                  <button type="button" className={styles.removeCompare} onClick={() => toggleCompare(row.asset.symbol)} aria-label={`Remove ${row.asset.symbol}`}>
                    <FaXmark aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {tradeConfirmation && typeof document !== "undefined"
          ? createPortal(
              (() => {
            const confirmationAsset = assets.find((asset) => asset.symbol === tradeConfirmation.symbol) || quickTradeAsset;
            const isQueued = tradeConfirmation.mode === "queued";
            const isPositiveTradeTheme = tradeConfirmation.side === "buy" || (tradeConfirmation.themePnl ?? tradeConfirmation.realizedPnl ?? 0) >= 0;
            return (
              <div
                className={[
                  detailStyles.tradeConfirmationOverlay,
                  isTradeConfirmationClosing ? detailStyles.tradeConfirmationOverlayClosing : "",
                ].filter(Boolean).join(" ")}
                onClick={closeTradeConfirmation}
              >
                <div
                  className={[
                    detailStyles.tradeConfirmationFrame,
                    isPositiveTradeTheme ? detailStyles.tradeConfirmationFrameBuy : detailStyles.tradeConfirmationFrameSell,
                  ].join(" ")}
                >
                  <div
                    className={[
                      detailStyles.tradeConfirmationModal,
                      isPositiveTradeTheme ? detailStyles.tradeConfirmationModalBuy : detailStyles.tradeConfirmationModalSell,
                      isTradeConfirmationClosing ? detailStyles.tradeConfirmationModalClosing : "",
                    ].filter(Boolean).join(" ")}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="trade-confirmation-title"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div
                      className={[
                        detailStyles.tradeConfirmationHero,
                        isPositiveTradeTheme ? detailStyles.tradeConfirmationHeroBuy : detailStyles.tradeConfirmationHeroSell,
                      ].join(" ")}
                    >
                      <div>
                        <span className={detailStyles.tradeConfirmationEyebrow}>
                          {isQueued ? "Live Order Queued" : tradeConfirmation.side === "buy" ? "Buy Filled" : "Sell Filled"}
                        </span>
                        <h2 id="trade-confirmation-title" className={detailStyles.tradeConfirmationTitle}>
                          {isQueued
                            ? "Order queued for next tick"
                            : tradeConfirmation.side === "buy"
                            ? "Position updated"
                            : (tradeConfirmation.realizedPnl ?? 0) >= 0
                              ? `Nice! Capital gains = ${fmtNumber(tradeConfirmation.realizedPnl, "$")}`
                              : `Tough break. Capital loss = ${fmtNumber(Math.abs(tradeConfirmation.realizedPnl ?? 0), "$")}`}
                        </h2>
                        <div className={detailStyles.tradeConfirmationSubheader}>
                          <AssetCoin
                            symbol={tradeConfirmation.symbol}
                            icon={confirmationAsset?.icon ?? null}
                            color={confirmationAsset?.color ?? null}
                            className={detailStyles.tradeConfirmationTickerIcon}
                          />
                          <p className={detailStyles.tradeConfirmationCopy}>
                            <strong className={detailStyles.tradeConfirmationTicker}>${tradeConfirmation.symbol}</strong>
                            <span>
                              {isQueued
                                ? `${fmtNumber(tradeConfirmation.requestedQuantity)} shares will execute on the next 10-minute tick.`
                                : `${fmtNumber(tradeConfirmation.filledQuantity)} shares executed at ${fmtNumber(tradeConfirmation.executedPrice, "$")} per share.`}
                            </span>
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={detailStyles.tradeConfirmationClose}
                        onClick={closeTradeConfirmation}
                        aria-label="Close trade confirmation"
                      >
                        ×
                      </button>
                    </div>

                    <div className={detailStyles.tradeConfirmationBody}>
                      <div className={detailStyles.tradeConfirmationLayout}>
                        <div className={detailStyles.tradeConfirmationImageSlot}>
                          <Image
                            src={tradeConfirmation.imageSrc}
                            alt="Trade confirmation illustration"
                            width={320}
                            height={320}
                            unoptimized
                            className={detailStyles.tradeConfirmationImage}
                          />
                        </div>

                        <div className={detailStyles.tradeConfirmationContent}>
                          <div className={detailStyles.tradeConfirmationGrid}>
                            <div className={detailStyles.tradeConfirmationCard}>
                              <span>{isQueued ? "Requested Shares" : tradeConfirmation.side === "buy" ? "Total Cost" : "Gross Value"}</span>
                              <strong>{isQueued ? fmtNumber(tradeConfirmation.requestedQuantity) : fmtNumber(tradeConfirmation.side === "buy" ? tradeConfirmation.totalCost : tradeConfirmation.grossValue, "$")}</strong>
                            </div>
                            <div className={detailStyles.tradeConfirmationCard}>
                              <span>{isQueued ? "Order ID" : "Fee"}</span>
                              <strong>{isQueued ? `#${tradeConfirmation.orderId || "new"}` : fmtNumber(tradeConfirmation.fee, "$")}</strong>
                            </div>
                            <div className={detailStyles.tradeConfirmationCard}>
                              <span>{isQueued ? "Executes Around" : tradeConfirmation.side === "buy" ? "Cash Change" : "Net Proceeds"}</span>
                              <strong className={isQueued || tradeConfirmation.netCashImpact >= 0 ? detailStyles.valueUp : detailStyles.valueDown}>
                                {isQueued ? fmtDate(tradeConfirmation.executeAfter) : formatSignedCurrency(tradeConfirmation.netCashImpact)}
                              </strong>
                            </div>
                            <div className={detailStyles.tradeConfirmationCard}>
                              <span>{isQueued ? "Interval Limit" : "New Cash Balance"}</span>
                              <strong>{isQueued ? `${fmtNumber(tradeConfirmation.intervalLimit)} orders` : fmtNumber(tradeConfirmation.nextCashBalance, "$")}</strong>
                            </div>
                          </div>

                          <div className={detailStyles.tradeConfirmationColumns}>
                            <section className={detailStyles.tradeConfirmationSection}>
                              <h3>Position</h3>
                              <div className={detailStyles.tradeConfirmationMetricList}>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Shares owned</span>
                                  <strong>{fmtNumber(tradeConfirmation.previousQuantity)} → {fmtNumber(tradeConfirmation.nextQuantity)}</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Average cost</span>
                                  <strong>{fmtNumber(tradeConfirmation.previousAvgCost, "$")} → {fmtNumber(tradeConfirmation.nextAvgCost, "$")}</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Marked at</span>
                                  <strong>{fmtNumber(tradeConfirmation.currentMidPrice, "$")}</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>{tradeConfirmation.side === "buy" ? "Estimated unrealized P/L" : "Actual realized P/L"}</span>
                                  <strong className={((tradeConfirmation.side === "buy" ? tradeConfirmation.unrealizedPnl : tradeConfirmation.realizedPnl) ?? 0) >= 0 ? detailStyles.valueUp : detailStyles.valueDown}>
                                    {formatSignedCurrency(tradeConfirmation.side === "buy" ? tradeConfirmation.unrealizedPnl : tradeConfirmation.realizedPnl)}
                                  </strong>
                                </div>
                              </div>
                            </section>

                            <section className={detailStyles.tradeConfirmationSection}>
                          <h3>{tradeConfirmation.side === "buy" ? "What changed" : "Remaining position"}</h3>
                          <div className={detailStyles.tradeConfirmationMetricList}>
                            {isQueued ? (
                              <>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Side</span>
                                  <strong className={tradeConfirmation.side === "buy" ? detailStyles.valueUp : detailStyles.valueDown}>{tradeConfirmation.side.toUpperCase()}</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Execution rule</span>
                                  <strong>Next 10-minute tick</strong>
                                </div>
                                <div className={detailStyles.tradeConfirmationMetric}>
                                  <span>Fill check</span>
                                  <strong>Cash, holdings, and quote rechecked at execution</strong>
                                </div>
                              </>
                            ) : tradeConfirmation.side === "buy" ? (
                                  <>
                                    <div className={detailStyles.tradeConfirmationMetric}>
                                      <span>Shares added</span>
                                      <strong className={detailStyles.valueUp}>+{fmtNumber(tradeConfirmation.filledQuantity)}</strong>
                                    </div>
                                    <div className={detailStyles.tradeConfirmationMetric}>
                                      <span>New weighted average</span>
                                      <strong>{fmtNumber(tradeConfirmation.nextAvgCost, "$")}</strong>
                                    </div>
                                    <div className={detailStyles.tradeConfirmationMetric}>
                                      <span>Fill time</span>
                                      <strong>{fmtDate(tradeConfirmation.filledAt)}</strong>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className={detailStyles.tradeConfirmationMetric}>
                                      <span>Cost basis sold</span>
                                      <strong>{fmtNumber(tradeConfirmation.costBasisSold, "$")}</strong>
                                    </div>
                                    <div className={detailStyles.tradeConfirmationMetric}>
                                      <span>Shares remaining</span>
                                      <strong>{fmtNumber(tradeConfirmation.nextQuantity)}</strong>
                                    </div>
                                    <div className={detailStyles.tradeConfirmationMetric}>
                                      <span>Remaining unrealized P/L</span>
                                      <strong className={(tradeConfirmation.unrealizedPnl ?? 0) >= 0 ? detailStyles.valueUp : detailStyles.valueDown}>
                                        {formatSignedCurrency(tradeConfirmation.unrealizedPnl)}
                                      </strong>
                                    </div>
                                    <div className={detailStyles.tradeConfirmationMetric}>
                                      <span>Fill time</span>
                                      <strong>{fmtDate(tradeConfirmation.filledAt)}</strong>
                                    </div>
                                  </>
                                )}
                              </div>
                            </section>
                          </div>

                          <div className={detailStyles.tradeConfirmationActions}>
                            <button type="button" className={detailStyles.tradeConfirmationPrimary} onClick={closeTradeConfirmation}>
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
              })(),
              document.body,
            )
          : null}

        {quickTradeAsset ? (
          <div className={`${styles.quickTradeBackdrop} ${isQuickTradeClosing ? styles.quickTradeBackdropClosing : ""}`.trim()} onClick={closeQuickTrade}>
            <div
              className={`${styles.quickTradeMascot} ${isQuickTradeClosing ? styles.quickTradeMascotClosing : ""}`.trim()}
              aria-hidden="true"
            >
              <Image src="/suisus.png" alt="" fill sizes="11rem" priority={false} />
            </div>
            <aside className={`${styles.quickTradeDrawer} ${isQuickTradeClosing ? styles.quickTradeDrawerClosing : ""}`.trim()} aria-label={`Quick trade ${quickTradeAsset.symbol}`} onClick={(event) => event.stopPropagation()}>
              <div className={styles.quickTradeCloseRow}>
                <button type="button" className={styles.drawerClose} onClick={closeQuickTrade} aria-label="Close quick trade">
                  <FaXmark aria-hidden="true" />
                </button>
              </div>
              <section className={styles.quickTradePanel}>
                <div className={detailStyles.tradePanelContent}>
                  <div className={detailStyles.sectionHeader}>
                    <div className={styles.quickTradeTitleGroup}>
                      <AssetCoin
                        symbol={quickTradeAsset.symbol}
                        icon={quickTradeAsset.icon ?? null}
                        color={quickTradeAsset.color ?? null}
                        className={styles.quickTradeHeaderCoin}
                        shape="circle"
                      />
                      <div>
                        <h2 className={detailStyles.sectionTitle}>Trade {quickTradeAsset.symbol}</h2>
                      </div>
                    </div>
                  </div>

                  {!user ? (
                    <div className={detailStyles.emptyState}>Sign in to trade and load your portfolio context.</div>
                  ) : (
                    <>
                      <div className={`${detailStyles.statGrid} ${detailStyles.portfolioGrid}`}>
                        <div className={detailStyles.infoCard}><span>Cash</span><strong>{fmtNumber(portfolio?.cash_balance ?? null, "$")}</strong></div>
                        <div className={detailStyles.infoCard}><span>Shares owned</span><strong>{fmtNumber(quickTradeHolding?.quantity ?? 0)}</strong></div>
                        <div className={detailStyles.infoCard}><span>Position value</span><strong>{fmtNumber(quickTradeHolding?.market_value ?? 0, "$")}</strong></div>
                        <div className={detailStyles.infoCard}><span>Avg cost</span><strong>{fmtNumber(quickTradeHolding?.avg_cost_basis ?? 0, "$")}</strong></div>
                        <div className={detailStyles.infoCard}><span>Unrealized PNL</span><strong>{formatSignedCurrency(quickTradeHolding?.unrealized_pnl ?? 0)}</strong></div>
                        <div className={detailStyles.infoCard}><span>Order value</span><strong>{fmtNumber(quickTradeEstimatedNotional, "$")}</strong></div>
                      </div>

                      {needsVerification ? <VerificationRequiredNotice action="trade" /> : null}

                      <form className={detailStyles.tradeForm} onSubmit={(event) => void handleQuickTrade(event)}>
                        <div className={detailStyles.sideToggle}>
                          <button
                            type="button"
                            className={quickTradeSide === "buy" ? detailStyles.sideToggleActiveBuy : detailStyles.sideToggleButton}
                            onClick={() => setQuickTradeSide("buy")}
                          >
                            Buy
                          </button>
                          <button
                            type="button"
                            className={quickTradeSide === "sell" ? detailStyles.sideToggleActiveSell : detailStyles.sideToggleButton}
                            onClick={() => setQuickTradeSide("sell")}
                          >
                            Sell
                          </button>
                        </div>

                        <label className={detailStyles.tradeField}>
                          <span>Quantity</span>
                          <input
                            className={detailStyles.tradeInput}
                            value={quickTradeQuantity}
                            inputMode="decimal"
                            disabled={!tradingOpen || isQuickTradeSubmitting}
                            onChange={(event) => {
                              setQuickTradeQuantity(event.target.value);
                              setLastQuickTradeQuantityPreset(null);
                            }}
                          />
                        </label>

                        <div className={detailStyles.tradePresets}>
                          {TRADE_QUANTITY_PRESETS.map((preset) => (
                            <button key={preset} type="button" className={detailStyles.presetButton} onClick={() => applyQuickTradeQuantityPreset(preset)}>
                              {preset}
                            </button>
                          ))}
                        </div>

                        <div className={detailStyles.tradeSummary}>
                          <div><span>Mid</span><strong>{formatPrice(quickTradeAsset.current_mid_price)}</strong></div>
                          <div><span>Bid / Ask</span><strong>{formatPrice(quickTradeAsset.current_bid_price)} / {formatPrice(quickTradeAsset.current_ask_price)}</strong></div>
                          <div><span>Volume</span><strong>{fmtNumber(quickTradeAsset.volume_24h)}</strong></div>
                        </div>

                        <div className={detailStyles.liveOrderQueue}>
                          <div>
                            <span>Next Tick Queue</span>
                            <strong>{fmtNumber(quickTradeAsset.pending_live_order_count ?? 0)}</strong>
                          </div>
                          <div>
                            <span>Buy Orders</span>
                            <strong className={detailStyles.valueUp}>{fmtNumber(quickTradeAsset.pending_live_buy_count ?? 0)}</strong>
                          </div>
                          <div>
                            <span>Sell Orders</span>
                            <strong className={detailStyles.valueDown}>{fmtNumber(quickTradeAsset.pending_live_sell_count ?? 0)}</strong>
                          </div>
                          <p>
                            {quickTradeAsset.next_live_order_execute_after
                              ? `Queued live orders execute around ${fmtDate(quickTradeAsset.next_live_order_execute_after)}.`
                              : "No live orders are queued for this asset right now."}
                          </p>
                        </div>

                        <button
                          type="submit"
                          className={quickTradeSide === "buy" ? detailStyles.tradeSubmitBuy : detailStyles.tradeSubmitSell}
                          disabled={!user || needsVerification || !tradingOpen || isQuickTradeSubmitting}
                        >
                          {isQuickTradeSubmitting ? "Submitting..." : tradingOpen ? `${quickTradeSide === "buy" ? "Submit Buy" : "Submit Sell"} Order` : "Market Closed"}
                        </button>
                      </form>

                      {!tradingOpen ? (
                        <div className="statusMessage statusMessageWarn">
                          <strong>Trading paused.</strong> {marketStatus?.trading_message || "Trading is temporarily unavailable while the market settles."}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </section>
            </aside>
          </div>
        ) : null}
        {quickTradeFailureNotice ? (
          <div className={detailStyles.tradeFailureOverlay} onClick={() => setQuickTradeFailureNotice(null)}>
            <div
              className={detailStyles.tradeFailureModal}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="quick-trade-failure-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className={detailStyles.tradeFailureHeader}>
                <h2 id="quick-trade-failure-title" className={detailStyles.tradeFailureTitle}>{quickTradeFailureNotice.title}</h2>
                <button
                  type="button"
                  className={detailStyles.tradeConfirmationClose}
                  onClick={() => setQuickTradeFailureNotice(null)}
                  aria-label="Close trade failure notice"
                >
                  ×
                </button>
              </div>
              <div className={detailStyles.tradeFailureBody}>
                <p className={detailStyles.tradeFailureCopy}>{quickTradeFailureNotice.message}</p>
                <div className={detailStyles.tradeConfirmationActions}>
                  <button type="button" className={detailStyles.tradeFailurePrimary} onClick={() => setQuickTradeFailureNotice(null)}>
                    Back to order ticket
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </SiteShell>
  );
}
