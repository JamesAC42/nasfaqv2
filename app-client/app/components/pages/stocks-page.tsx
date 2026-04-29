"use client";

import { createPortal } from "react-dom";
import { startTransition, useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FaArrowTrendDown, FaArrowTrendUp, FaBookmark, FaCartShopping, FaChartLine, FaChartSimple, FaCoins, FaFloppyDisk, FaGrip, FaMagnifyingGlass, FaPlus, FaSliders, FaTable, FaXmark } from "react-icons/fa6";
import { HiMiniArrowSmallDown, HiMiniArrowSmallUp, HiOutlineArrowsUpDown } from "react-icons/hi2";
import { SparklineChart } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { OptionPicker } from "@/app/components/common/option-picker";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { computeDailyVolumeChange } from "@/app/lib/market-metrics";
import { fmtDate, fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import type { MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import shellStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/stocks-page.module.scss";
import detailStyles from "@/app/components/pages/stock-detail-page.module.scss";

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
  | "fair"
  | "medium"
  | "premium"
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
type PresetKind = "all" | "movers" | "volume" | "premium" | "discount" | "custom";
type ArchiveViewMode = "table" | "cards";
type CardGraphMetric = "price" | "volume" | "subscribers" | "views" | "videos";
type TradeSide = "buy" | "sell";

const QUICK_TRADE_CLOSE_ANIMATION_MS = 170;

type CardGraphPoint = {
  time: string;
  value: number;
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
  { id: "premium", name: "Premium Watch", description: "Richest pricing" },
  { id: "discount", name: "Discount Watch", description: "Cheapest gaps" },
];

const CARD_GRAPH_OPTIONS: Array<{ value: CardGraphMetric; label: string }> = [
  { value: "price", label: "Price" },
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
  { value: "fair:desc", label: "Fair value high-low" },
  { value: "fair:asc", label: "Fair value low-high" },
  { value: "medium:desc", label: "Medium price high-low" },
  { value: "medium:asc", label: "Medium price low-high" },
  { value: "premium:desc", label: "Premium high-low" },
  { value: "premium:asc", label: "Premium low-high" },
  { value: "settlementMove:desc", label: "Settlement move high-low" },
  { value: "settlementMove:asc", label: "Settlement move low-high" },
  { value: "move24h:desc", label: "24H move high-low" },
  { value: "move24h:asc", label: "24H move low-high" },
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
  { key: "fair", label: "Fair" },
  { key: "medium", label: "Medium" },
  { key: "premium", label: "Premium" },
  { key: "settlementMove", label: "Settlement Move" },
  { key: "move24h", label: "24H Move" },
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

function computeSettlementMovePct(asset: MarketAsset) {
  return computeChangePct(asset.current_mid_price, asset.pre_settlement_mid_price);
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
  const imageSrc =
    result.side === "buy"
      ? pickRandomItem(TRADE_CONFIRMATION_BUY_IMAGES)
      : (realizedPnl ?? 0) >= 0
        ? pickRandomItem(TRADE_CONFIRMATION_SELL_GAIN_IMAGES)
        : pickRandomItem(TRADE_CONFIRMATION_SELL_LOSS_IMAGES);

  return {
    mode: isQueued ? "queued" : "filled",
    orderId: result.order_id ?? null,
    side: result.side,
    symbol: result.symbol,
    requestedQuantity: result.requested_quantity ?? filledQuantity,
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
    imageSrc,
  };
}

function buildChannelMetricsMap(rows: OverviewRow[]) {
  const result = new Map<string, ChannelMetrics>();

  for (const row of rows) {
    const latest = pickLatestPoint(row.series || []);
    const latestTs = toTimestamp(latest?.time);
    const prior24h = latestTs === null ? null : pickPointAtOrBefore(row.series || [], latestTs - 24 * 60 * 60 * 1000);

    result.set(row.channel.youtube_channel_id, {
      subscribers: latest?.subscriber_count ?? null,
      subscriberChangePct24h: computeChangePct(latest?.subscriber_count ?? null, prior24h?.subscriber_count ?? null),
      views: latest?.view_count ?? null,
      viewChangePct24h: computeChangePct(latest?.view_count ?? null, prior24h?.view_count ?? null),
      videos: latest?.video_count ?? null,
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

function buildLinePoints(points: CardGraphPoint[]) {
  const clean = points.filter((point) => Number.isFinite(point.value));
  if (!clean.length) return "";
  const min = Math.min(...clean.map((point) => point.value));
  const max = Math.max(...clean.map((point) => point.value));
  const range = max - min || 1;
  return clean
    .map((point, index) => {
      const x = clean.length === 1 ? 100 : (index / (clean.length - 1)) * 100;
      const y = 86 - ((point.value - min) / range) * 70;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function StockArchiveCardGraph({ points, tone }: { points: CardGraphPoint[]; tone: "positive" | "negative" }) {
  const linePoints = buildLinePoints(points);

  if (!linePoints) {
    return <div className={styles.cardGraphEmpty}>No graph data</div>;
  }

  const areaPoints = `0,96 ${linePoints} 100,96`;
  return (
    <svg className={styles.cardGraphSvg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon className={tone === "negative" ? styles.cardGraphAreaNegative : styles.cardGraphAreaPositive} points={areaPoints} />
      <polyline className={tone === "negative" ? styles.cardGraphLineNegative : styles.cardGraphLinePositive} points={linePoints} />
    </svg>
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
  const [quickTradeSymbol, setQuickTradeSymbol] = useState("");
  const [quickTradeSide, setQuickTradeSide] = useState<TradeSide>("buy");
  const [quickTradeQuantity, setQuickTradeQuantity] = useState("10");
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
          const settlementMovePct = computeSettlementMovePct(asset);

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
              fair: asset.current_fair_value,
              medium: asset.current_bid_price,
              premium: asset.current_premium_pct,
              settlementMove: settlementMovePct,
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
    const byPremium = [...rows].sort((a, b) => (b.asset.current_premium_pct ?? Number.NEGATIVE_INFINITY) - (a.asset.current_premium_pct ?? Number.NEGATIVE_INFINITY))[0];
    const byDiscount = [...rows].sort((a, b) => (a.asset.current_premium_pct ?? Number.POSITIVE_INFINITY) - (b.asset.current_premium_pct ?? Number.POSITIVE_INFINITY))[0];
    return [
      { id: "move", label: "Top move", row: byMove, value: formatSignedPct(byMove?.asset.move_24h_pct) },
      { id: "volume", label: "Volume leader", row: byVolume, value: fmtNumber(byVolume?.asset.volume_24h) },
      { id: "premium", label: "Rich premium", row: byPremium, value: fmtPct(byPremium?.asset.current_premium_pct) },
      { id: "discount", label: "Deep discount", row: byDiscount, value: fmtPct(byDiscount?.asset.current_premium_pct) },
    ];
  }, [rows]);

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
    if (view === "premium") {
      setSortKey("premium");
      setSortDirection("desc");
    }
    if (view === "discount") {
      setSortKey("premium");
      setSortDirection("asc");
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
    if (metric === "price" || metric === "volume") {
      return row.asset.sparkline_candles
        .slice(-90)
        .map((item) => ({
          time: item.bucket,
          value: metric === "volume" ? item.volume_shares : item.close_mark ?? item.close,
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
        value: metric === "subscribers"
          ? item.subscriber_count
          : metric === "views"
            ? item.view_count
            : item.video_count,
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
    setQuickTradeFailureNotice(null);
    setTradeConfirmation(null);
    setIsTradeConfirmationClosing(false);
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
              <span>{advancingCount} advancing / {decliningCount} declining</span>
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
              <span>{card.label}</span>
              {card.row ? (
                <>
                  <strong>{card.row.asset.symbol}</strong>
                  <em>{card.row.asset.display_name}</em>
                  <b>{card.value}</b>
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
              <span className={styles.fieldLabel}>24H price change</span>
              <OptionPicker
                value={priceMoveFilter}
                options={priceMoveOptions}
                onChange={(nextValue) => {
                  startTransition(() => setPriceMoveFilter(nextValue as PriceMoveFilter));
                }}
                placeholder="All moves"
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
                <label className={styles.metricSelect}>
                  <FaChartSimple aria-hidden="true" />
                  <span>Graph</span>
                  <select
                    value={cardGraphMetric}
                    onChange={(event) => setCardGraphMetric(event.target.value as CardGraphMetric)}
                  >
                    {CARD_GRAPH_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
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
                  const settlementMovePct = row.sortValues.settlementMove as number | null;
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
                      <td>{formatPrice(asset.current_fair_value)}</td>
                      <td>{formatPrice(asset.current_bid_price)}</td>
                      <td>{fmtPct(asset.current_premium_pct)}</td>
                      <td className={(settlementMovePct ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(settlementMovePct)}
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

          <div className={`${styles.cardList} ${archiveViewMode === "cards" ? styles.cardListArchive : ""}`.trim()}>
            {sortedRows.map((row) => {
              const { asset, channelMetrics, isSelected, volumeChangePct } = row;
              const priceTone = (asset.move_24h_pct ?? 0) > 0 ? "positive" : (asset.move_24h_pct ?? 0) < 0 ? "negative" : undefined;
              const graphTone = (asset.move_24h_pct ?? 0) < 0 ? "negative" : "positive";
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
                    <StockArchiveCardGraph points={cardGraphPoints} tone={graphTone} />
                  </div>

                  <dl className={styles.dataGrid}>
                    <DataItem label="Fair" value={formatPrice(asset.current_fair_value)} />
                    <DataItem label="Medium" value={formatPrice(asset.current_bid_price)} />
                    <DataItem label="Premium" value={fmtPct(asset.current_premium_pct)} />
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

          {!sortedRows.length ? <div className={styles.empty}>No stocks matched the current filters.</div> : null}
        </section>

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
            const isPositiveTradeTheme = isQueued || tradeConfirmation.side === "buy" || (tradeConfirmation.realizedPnl ?? 0) >= 0;
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
                            onChange={(event) => setQuickTradeQuantity(event.target.value)}
                          />
                        </label>

                        <div className={detailStyles.tradePresets}>
                          {["10", "25", "50", "100"].map((preset) => (
                            <button key={preset} type="button" className={detailStyles.presetButton} onClick={() => setQuickTradeQuantity(preset)}>
                              {preset}
                            </button>
                          ))}
                        </div>

                        <div className={detailStyles.tradeSummary}>
                          <div><span>Mid</span><strong>{formatPrice(quickTradeAsset.current_mid_price)}</strong></div>
                          <div><span>Bid / Ask</span><strong>{formatPrice(quickTradeAsset.current_bid_price)} / {formatPrice(quickTradeAsset.current_ask_price)}</strong></div>
                          <div><span>Premium</span><strong>{fmtPct(quickTradeAsset.current_premium_pct)}</strong></div>
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
