"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  FaBolt,
  FaChartLine,
  FaCircleNodes,
  FaClock,
  FaArrowTrendDown,
  FaArrowTrendUp,
  FaFire,
  FaMoneyBillTrendUp,
  FaSignal,
  FaUsers,
} from "react-icons/fa6";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtInteger, fmtNumber, fmtPct, toNumber } from "@/app/lib/format";
import { normalizeMarketAdjustmentSummary, normalizeMarketHubResponse, normalizeMarketHubTrade, normalizeMarketLiveOrderSummary } from "@/app/lib/normalizers";
import type { MarketAdjustmentOutcome, MarketAdjustmentSummary, MarketAsset, MarketHubResponse, MarketHubTrade, MarketTradeEvent } from "@/app/lib/types";
import { getMarketWsUrl } from "@/app/lib/ws";
import styles from "@/app/components/pages/market-page.module.scss";
import shellStyles from "@/app/components/pages/page-shell.module.scss";

import fubogki from "@/public/fubogki.png";
import kronie from "@/public/kronie.png";
import smugKorone from "@/public/smugkorone.png";
import tako from "@/public/tako.png";

const INITIAL_TRADE_LIMIT = 20;
const LIVE_TRADE_CAP = 40;
const RECONCILE_INTERVAL_MS = 60_000;
const HEARTBEAT_INDEX_START_DATE = "2025-10-06";
const TICK_INTERVAL_ORDER = ["open", "lunch", "late", "overnight"] as const;
const ADJUSTMENT_SUMMARY_RECENT_LIMIT = 500;
const ADJUSTMENT_MOVEMENT_PREVIEW_COUNT = 10;
const CLOCK_ZONES = [
  { label: "New York / East", zone: "America/New_York" },
  { label: "US West", zone: "America/Los_Angeles" },
  { label: "Japan", zone: "Asia/Tokyo" },
  { label: "Indonesia", zone: "Asia/Jakarta" },
  { label: "Austria", zone: "Europe/Vienna" },
  { label: "Australia", zone: "Australia/Sydney" },
  { label: "UK", zone: "Europe/London" },
] as const;
const TIMELINE_LABEL_PROGRESS: Record<(typeof TICK_INTERVAL_ORDER)[number], number> = {
  overnight: 12.5,
  open: 37.5,
  lunch: 62.5,
  late: 87.5,
};

function formatSignedPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${fmtPct(value)}`;
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  const diffMs = Date.now() - timestamp;
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSeconds < 10) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatCountdown(ms: number | null) {
  if (ms === null) return "No tick scheduled";
  if (ms <= 0) return "Due now";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatIntervalLabel(value: string | null | undefined) {
  switch (value) {
    case "open":
      return "Open";
    case "lunch":
      return "Lunch";
    case "late":
      return "Late";
    case "overnight":
      return "Overnight";
    default:
      return value || "N/A";
  }
}

function formatEt(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function getZoneClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const hour = Number(parts.hour || 0) % 24;
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  return {
    hour,
    minute,
    second,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    hourDeg: ((hour % 12) + minute / 60) * 30,
    minuteDeg: (minute + second / 60) * 6,
    secondDeg: second * 6,
  };
}

function toneClass(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (value > 0) return shellStyles.positive;
  if (value < 0) return shellStyles.negative;
  return "";
}

function timelineZPosition(progress: number): CSSProperties {
  const distance = Math.max(0, Math.min(100, progress)) * 3.82;
  let x = 0;
  let y = 0;

  if (distance <= 100) {
    x = distance;
  } else if (distance <= 150) {
    x = 100;
    y = distance - 100;
  } else if (distance <= 250) {
    x = 250 - distance;
    y = 50;
  } else if (distance <= 300) {
    y = distance - 250;
  } else {
    x = distance - 300;
    y = 100;
  }

  return {
    left: `${x}%`,
    top: `${y}%`,
  };
}

function isLastAdjustmentOutcome(item: MarketAdjustmentOutcome, lastTick: MarketAdjustmentSummary["last_tick"]) {
  if (!lastTick) return true;
  if (item.market_date && lastTick.market_date && item.market_date !== lastTick.market_date) return false;
  if (item.interval_key !== lastTick.interval_key) return false;
  if (lastTick.scheduled_at && item.scheduled_at && item.scheduled_at !== lastTick.scheduled_at) return false;
  return true;
}

function DailyTickTimelineCanvas({ progress }: { progress: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = window.devicePixelRatio || 1;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    };

    const markerPoint = () => {
      const distance = Math.max(0, Math.min(100, progressRef.current)) * 3.82;
      const lineInset = 3;
      const canvasBleed = 20;
      const trackLeft = canvasBleed + lineInset;
      const trackRight = width - canvasBleed - lineInset;
      const trackTop = canvasBleed + lineInset;
      const trackMiddle = canvasBleed + (height - canvasBleed * 2) * 0.5 + lineInset;
      const trackBottom = height - canvasBleed - lineInset;
      const trackBottomEnd = canvasBleed + (width - canvasBleed * 2) * 0.82;
      const drawableWidth = Math.max(1, trackRight - trackLeft);

      if (distance <= 100) return { x: trackLeft + (distance / 100) * drawableWidth, y: trackTop };
      if (distance <= 150) return { x: trackRight, y: trackTop + ((distance - 100) / 50) * (trackMiddle - trackTop) };
      if (distance <= 250) return { x: trackLeft + ((250 - distance) / 100) * drawableWidth, y: trackMiddle };
      if (distance <= 300) return { x: trackLeft, y: trackMiddle + ((distance - 250) / 50) * (trackBottom - trackMiddle) };
      return { x: trackLeft + ((distance - 300) / 82) * (trackBottomEnd - trackLeft), y: trackBottom };
    };

    const draw = (time = 0) => {
      const context = canvas.getContext("2d");
      if (!context || width <= 0 || height <= 0) {
        frame = window.requestAnimationFrame(draw);
        return;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineWidth = 6;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "rgba(123, 168, 184, 0.28)";
      context.beginPath();
      const canvasBleed = 20;
      const trackLeft = canvasBleed + 3;
      const trackRight = width - canvasBleed - 3;
      const trackTop = canvasBleed + 3;
      const trackMiddle = canvasBleed + (height - canvasBleed * 2) * 0.5 + 3;
      const trackBottom = height - canvasBleed - 3;
      context.moveTo(trackLeft, trackTop);
      context.lineTo(trackRight, trackTop);
      context.lineTo(trackRight, trackMiddle);
      context.lineTo(trackLeft, trackMiddle);
      context.lineTo(trackLeft, trackBottom);
      context.lineTo(canvasBleed + (width - canvasBleed * 2) * 0.82, trackBottom);
      context.stroke();

      const pulse = media.matches ? 0 : (Math.sin(time / 280) + 1) / 2;
      const point = markerPoint();
      context.shadowColor = "rgba(36, 229, 137, 0.48)";
      context.shadowBlur = 13 + pulse * 8;
      context.fillStyle = "#071822";
      context.strokeStyle = "#24e589";
      context.lineWidth = 3;
      context.beginPath();
      context.arc(point.x, point.y, 9, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.shadowBlur = 0;
      context.fillStyle = "rgba(36, 229, 137, 0.2)";
      context.beginPath();
      context.arc(point.x, point.y, 14 + pulse * 4, 0, Math.PI * 2);
      context.fill();

      frame = window.requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    frame = window.requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.timelineCanvas} aria-hidden="true" />;
}

function mergeTrades(current: MarketHubTrade[], incoming: MarketHubTrade[], cap = LIVE_TRADE_CAP) {
  const seen = new Set<number>();
  const merged: MarketHubTrade[] = [];

  for (const trade of [...incoming, ...current]) {
    if (!trade?.id || seen.has(trade.id)) continue;
    seen.add(trade.id);
    merged.push(trade);
    if (merged.length >= cap) break;
  }

  return merged;
}

function patchAsset(asset: MarketAsset, event: MarketTradeEvent): MarketAsset {
  if (asset.symbol !== event.quote.symbol) return asset;
  return {
    ...asset,
    current_mid_price: event.quote.mid_price,
    current_bid_price: event.quote.bid_price,
    current_ask_price: event.quote.ask_price,
    current_premium_pct: null,
    volume_24h: (asset.volume_24h ?? 0) + event.trade.quantity,
  };
}

function patchAssetFromQuote(asset: MarketAsset, quote: Record<string, unknown>): MarketAsset {
  const symbol = String(quote.symbol || "").toUpperCase();
  if (!symbol || asset.symbol !== symbol) return asset;
  return {
    ...asset,
    current_mid_price: toNumber(quote.mid_price),
    current_bid_price: toNumber(quote.bid_price),
    current_ask_price: toNumber(quote.ask_price),
    current_premium_pct: null,
  };
}

function patchHubWithEvent(current: MarketHubResponse, event: MarketTradeEvent): MarketHubResponse {
  const patchAssets = (assets: MarketAsset[]) => assets.map((asset) => patchAsset(asset, event));

  return {
    ...current,
    status: current.status
      ? {
          ...current.status,
          current_market_date: event.market_status.current_market_date || current.status.current_market_date,
          last_settlement_market_date: event.market_status.last_settlement_market_date || current.status.last_settlement_market_date,
          is_trading_open: event.market_status.is_trading_open,
        }
      : current.status,
    leaders: {
      ...current.leaders,
      top_price: patchAssets(current.leaders.top_price),
      top_volume: patchAssets(current.leaders.top_volume),
      top_movers: patchAssets(current.leaders.top_movers),
      top_losers: patchAssets(current.leaders.top_losers),
      top_premiums: [],
      top_discounts: [],
    },
    recent_trades: {
      ...current.recent_trades,
      items: mergeTrades(current.recent_trades.items, [event.trade]),
    },
  };
}

function patchHubWithQuotes(current: MarketHubResponse, quotes: Array<Record<string, unknown>>): MarketHubResponse {
  const patchAssets = (assets: MarketAsset[]) => assets.map((asset) => {
    const quote = quotes.find((item) => String(item.symbol || "").toUpperCase() === asset.symbol.toUpperCase());
    return quote ? patchAssetFromQuote(asset, quote) : asset;
  });

  return {
    ...current,
    leaders: {
      ...current.leaders,
      top_price: patchAssets(current.leaders.top_price),
      top_volume: patchAssets(current.leaders.top_volume),
      top_movers: patchAssets(current.leaders.top_movers),
      top_losers: patchAssets(current.leaders.top_losers),
      top_premiums: [],
      top_discounts: [],
    },
  };
}

function StatCard({
  label,
  value,
  meta,
  icon,
}: {
  label: string;
  value: string;
  meta: string;
  icon: ReactNode;
}) {
  return (
    <article className={styles.statCard}>
      <div className={styles.statLabel}>
        <span className={styles.statIcon}>{icon}</span>
        <span>{label}</span>
      </div>
      <strong className={styles.statValue}>{value}</strong>
      <span className={styles.statMeta}>{meta}</span>
    </article>
  );
}

function ActivityGauge({
  score,
  label,
  meta,
}: {
  score: number;
  label: string;
  meta: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <div className={styles.activityGauge}>
      <div className={styles.gaugeRing} style={{ "--gauge-value": `${clamped}%` } as CSSProperties}>
        <strong>{Math.round(clamped)}</strong>
        <span>pulse</span>
      </div>
      <div>
        <span className={styles.microLabel}>{label}</span>
        <p>{meta}</p>
      </div>
    </div>
  );
}

function FlowPressure({
  buyCount,
  sellCount,
}: {
  buyCount: number;
  sellCount: number;
}) {
  const total = buyCount + sellCount;
  const buyPct = total > 0 ? (buyCount / total) * 100 : 50;

  return (
    <div className={styles.flowPressure}>
      <div className={styles.flowPressureHead}>
        <span><FaCircleNodes /> Tape pressure</span>
        <strong>{fmtInteger(total)} recent fills</strong>
      </div>
      <div className={styles.pressureTrack}>
        <i style={{ width: `${buyPct}%` }} />
      </div>
      <div className={styles.pressureLegend}>
        <span className={styles.positive}>Buy {fmtInteger(buyCount)}</span>
        <span className={styles.negative}>Sell {fmtInteger(sellCount)}</span>
      </div>
    </div>
  );
}

function HotSymbolStrip({
  symbols,
  assetMeta,
}: {
  symbols: Array<{ symbol: string; count: number; cash: number }>;
  assetMeta: Map<string, { icon: string | null; color: string | null }>;
}) {
  return (
    <div className={styles.hotStrip}>
      {symbols.length ? symbols.map((item) => {
        const meta = assetMeta.get(item.symbol);
        return (
          <Link key={item.symbol} href={`/stocks/${encodeURIComponent(item.symbol)}`} className={styles.hotSymbol}>
            <AssetCoin symbol={item.symbol} icon={meta?.icon ?? null} color={meta?.color ?? null} className={styles.hotIcon} />
            <span>
              <strong>{item.symbol}</strong>
              <em>{fmtInteger(item.count)} prints · {fmtNumber(item.cash, "$")}</em>
            </span>
          </Link>
        );
      }) : <div className={styles.empty}>No hot symbols yet.</div>}
    </div>
  );
}

function PendingLiveOrders({
  hub,
  now,
}: {
  hub: MarketHubResponse;
  now: Date;
}) {
  const summary = hub.activity.live_orders;
  const total = summary.pending_count;
  const buyPct = total > 0 ? (summary.pending_buy_count / total) * 100 : 50;
  const batchMs = useMemo(() => {
    if (!summary.next_execute_after) return null;
    const timestamp = new Date(summary.next_execute_after).getTime();
    if (Number.isNaN(timestamp)) return null;
    return timestamp - now.getTime();
  }, [now, summary.next_execute_after]);

  return (
    <section className={styles.liveOrderPanel}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Live Order Queue</h2>
          <p className={styles.sectionCopy}>
            Pending manual orders queued for the next 10-minute execution tick.
          </p>
        </div>
        <div className={styles.sectionMeta}>
          <FaClock />
          <span>{summary.next_execute_after ? formatEt(summary.next_execute_after) : "No tick queued"}</span>
        </div>
      </div>

      <div className={styles.liveOrderSummaryGrid}>
        <div className={styles.liveOrderTotal}>
          <span className={styles.microLabel}>Next batch in</span>
          <strong>{formatCountdown(batchMs)}</strong>
          <p>{summary.next_execute_after ? `Execution window starts ${formatEt(summary.next_execute_after)}` : "Waiting for queued orders"}</p>
        </div>
        <div className={styles.liveOrderTotal}>
          <span className={styles.microLabel}>Next tick orders</span>
          <strong>{fmtInteger(total)}</strong>
          <p>{fmtInteger(summary.pending_buy_quantity)} buy shares · {fmtInteger(summary.pending_sell_quantity)} sell shares</p>
        </div>
        <div className={styles.liveOrderPressure}>
          <div className={styles.pressureTrack}>
            <i style={{ width: `${buyPct}%` }} />
          </div>
          <div className={styles.pressureLegend}>
            <span className={styles.positive}>Buy {fmtInteger(summary.pending_buy_count)}</span>
            <span className={styles.negative}>Sell {fmtInteger(summary.pending_sell_count)}</span>
          </div>
        </div>
      </div>

      <div className={styles.liveOrderAssetList}>
        {summary.assets.length ? summary.assets.map((asset) => (
          <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.liveOrderAssetRow}>
            <div className={styles.assetMain}>
              <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.assetIcon} shape="circle" />
              <div>
                <strong>{asset.symbol}</strong>
                <span>{asset.display_name}</span>
              </div>
            </div>
            <div className={styles.assetMetric}>
              <strong>{fmtInteger(asset.pending_count)} orders</strong>
              <span>{fmtInteger(asset.pending_buy_count)} buy / {fmtInteger(asset.pending_sell_count)} sell</span>
            </div>
          </Link>
        )) : <div className={styles.empty}>No live orders are waiting for the next tick.</div>}
      </div>
    </section>
  );
}

function ActiveTraderPanel({ hub }: { hub: MarketHubResponse }) {
  return (
    <section className={`${styles.panel} ${styles.activeTraderPanel}`}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Most Active Traders</h2>
          <p className={styles.sectionCopy}>Top accounts by trade count over the last 24 hours.</p>
        </div>
      </div>
      <div className={styles.traderList}>
        {hub.activity.most_active_traders_24h.length ? hub.activity.most_active_traders_24h.map((trader) => (
          <Link key={trader.user_id} href={`/profile/${encodeURIComponent(trader.username)}`} className={styles.traderRow}>
            <div className={styles.traderIdentity}>
              <span
                className={styles.traderBadge}
                style={trader.profile_color ? { backgroundColor: trader.profile_color } : undefined}
              >
                {trader.profile_picture_url ? (
                  <img src={trader.profile_picture_url} alt="" className={styles.traderBadgeImage} />
                ) : (
                  trader.username.slice(0, 1).toUpperCase()
                )}
              </span>
              <div>
                <strong>{trader.username}</strong>
                <span>{fmtInteger(trader.distinct_assets)} assets · {formatRelativeTime(trader.latest_trade_at)}</span>
              </div>
            </div>
            <div className={styles.traderMetrics}>
              <strong>{fmtInteger(trader.trade_count)} trades</strong>
              <span>{fmtNumber(trader.volume_cash, "$")}</span>
            </div>
          </Link>
        )) : <div className={styles.empty}>No active traders yet.</div>}
      </div>
    </section>
  );
}

function AnalogClock({
  label,
  zone,
  now,
  large = false,
}: {
  label: string;
  zone: string;
  now: Date;
  large?: boolean;
}) {
  const clock = getZoneClock(now, zone);
  return (
    <div className={`${styles.analogClock} ${large ? styles.analogClockLarge : ""}`.trim()}>
      <div
        className={styles.clockFace}
        style={{
          "--hour-deg": `${clock.hourDeg}deg`,
          "--minute-deg": `${clock.minuteDeg}deg`,
          "--second-deg": `${clock.secondDeg}deg`,
        } as CSSProperties}
        aria-hidden="true"
      >
        <i className={styles.hourHand} />
        <i className={styles.minuteHand} />
        <i className={styles.secondHand} />
      </div>
      <div>
        <strong>{label}</strong>
        <span>{clock.label}</span>
      </div>
    </div>
  );
}

function ActivityInsightRail({
  hub,
  activityScore,
}: {
  hub: MarketHubResponse;
  activityScore: number;
}) {
  const fiveMinute = hub.activity.windows["5m"];
  const oneHour = hub.activity.windows["1h"];
  const topTrader = hub.activity.most_active_traders_24h[0] || null;
  const topMover = hub.leaders.top_movers[0] || null;
  const topLoser = hub.leaders.top_losers[0] || null;

  const lines = [
    `${fmtInteger(fiveMinute.trade_count)} trades printed in the last 5 minutes, tracking at ${Math.round(activityScore)} pulse intensity.`,
    `${fmtNumber(oneHour.volume_cash, "$")} changed hands over the last hour across ${fmtInteger(oneHour.asset_count)} assets.`,
    topTrader ? `${topTrader.username} is driving the board with ${fmtInteger(topTrader.trade_count)} trades over 24 hours.` : null,
    topMover && topLoser ? `${topMover.symbol} leads momentum at ${formatSignedPct(topMover.move_24h_pct)} while ${topLoser.symbol} is under pressure at ${formatSignedPct(topLoser.move_24h_pct)}.` : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <section className={styles.insightRail}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Live Read</h2>
          <p className={styles.sectionCopy}>Derived from the hub snapshot plus recent websocket fills.</p>
        </div>
      </div>
      <div className={styles.insightList}>
        {lines.map((line) => (
          <div key={line} className={styles.insightItem}>
            <FaSignal />
            <p>{line}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AssetLeaderList({
  title,
  subtitle,
  assets,
  metric,
}: {
  title: string;
  subtitle: string;
  assets: MarketAsset[];
  metric: (asset: MarketAsset) => ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          <p className={styles.sectionCopy}>{subtitle}</p>
        </div>
      </div>
      <div className={styles.assetList}>
        {assets.length ? assets.map((asset) => (
          <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.assetRow}>
            <div className={styles.assetMain}>
              <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.assetIcon} shape="circle" />
              <div>
                <strong>{asset.symbol}</strong>
                <span>{asset.display_name}</span>
              </div>
            </div>
            <div className={styles.assetMetric}>{metric(asset)}</div>
          </Link>
        )) : <div className={styles.empty}>No assets in this slice yet.</div>}
      </div>
    </section>
  );
}

function TradeTape({
  trades,
  assetMeta,
}: {
  trades: MarketHubTrade[];
  assetMeta: Map<string, { icon: string | null; color: string | null }>;
}) {
  return (
    <div className={styles.tradeTape}>
      {trades.length ? trades.map((trade) => {
        const isBuy = trade.side.toLowerCase() === "buy";
        const meta = assetMeta.get(trade.symbol);

        return (
          <article key={trade.id} className={styles.tradeRow}>
            <div className={styles.tradeIdentity}>
              <AssetCoin symbol={trade.symbol} icon={meta?.icon ?? null} color={meta?.color ?? null} className={styles.assetIcon} shape="circle" />
              <div className={styles.tradeCopy}>
                <div className={styles.tradeHeadline}>
                  <Link href={`/stocks/${encodeURIComponent(trade.symbol)}`} className={styles.inlineLink}>{trade.symbol}</Link>
                  <span className={`${styles.sidePill} ${isBuy ? styles.sideBuy : styles.sideSell}`}>{trade.side.toUpperCase()}</span>
                  {trade.username ? (
                    <Link href={`/profile/${encodeURIComponent(trade.username)}`} className={styles.inlineLink}>
                      {trade.username}
                    </Link>
                  ) : (
                    <span>Trader</span>
                  )}
                </div>
                <span className={styles.tradeMeta}>{trade.display_name} · {formatRelativeTime(trade.ts)} · {fmtDate(trade.ts)}</span>
              </div>
            </div>
            <div className={styles.tradeNumbers}>
              <strong>{fmtNumber(trade.quantity)} @ {fmtNumber(trade.price, "$")}</strong>
              <span>Gross {fmtNumber(trade.gross_cash, "$")}</span>
            </div>
            <span className={`${styles.tradeRail} ${isBuy ? styles.tradeRailBuy : styles.tradeRailSell}`} aria-hidden="true" />
          </article>
        );
      }) : <div className={styles.empty}>No trade prints yet.</div>}
    </div>
  );
}

export function MarketPage() {
  const [hub, setHub] = useState<MarketHubResponse | null>(null);
  const [trades, setTrades] = useState<MarketHubTrade[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">("closed");
  const [lastLiveAt, setLastLiveAt] = useState<string | null>(null);
  const [adjustmentSummary, setAdjustmentSummary] = useState<MarketAdjustmentSummary | null>(null);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const [showAllAdjustmentMovers, setShowAllAdjustmentMovers] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [tickToast, setTickToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHub() {
      try {
        const result = await apiFetch<Record<string, unknown>>(`/api/market/hub?trade_limit=${INITIAL_TRADE_LIMIT}`, { cache: "no-store" });
        if (cancelled) return;
        const normalized = normalizeMarketHubResponse(result);
        setHub(normalized);
        setTrades(normalized.recent_trades.items);
        setNextCursor(normalized.recent_trades.next_cursor);
        setError(null);
      } catch (nextError) {
        if (!cancelled) {
          setError(String((nextError as Error).message || nextError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadHub();
    const timer = window.setInterval(() => {
      void loadHub();
    }, RECONCILE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAdjustmentSummary() {
      try {
        const result = await apiFetch<Record<string, unknown>>(`/api/market/adjustments/summary?recent_limit=${ADJUSTMENT_SUMMARY_RECENT_LIMIT}`, { cache: "no-store" });
        if (!cancelled) {
          setAdjustmentSummary(normalizeMarketAdjustmentSummary(result));
          setAdjustmentError(null);
        }
      } catch (nextError) {
        if (!cancelled) setAdjustmentError(String((nextError as Error).message || nextError));
      }
    }
    void loadAdjustmentSummary();
    const timer = window.setInterval(() => void loadAdjustmentSummary(), RECONCILE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!tickToast) return;
    const timer = window.setTimeout(() => setTickToast(null), 5200);
    return () => window.clearTimeout(timer);
  }, [tickToast]);

  useEffect(() => {
    const wsUrl = getMarketWsUrl();
    if (!wsUrl || typeof window === "undefined") return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      setWsStatus("connecting");
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setWsStatus("open");
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || "")) as Record<string, unknown>;
          const refreshLiveOrderSummary = () => {
            void apiFetch<Record<string, unknown>>("/api/market/live-orders/summary?limit=8", { cache: "no-store" })
              .then((result) => {
                const liveOrders = normalizeMarketLiveOrderSummary(result);
                setHub((current) => current ? {
                  ...current,
                  activity: {
                    ...current.activity,
                    live_orders: liveOrders,
                  },
                } : current);
              })
              .catch(() => {});
          };

          if (payload.type === "market.adjustments_applied") {
            const quotes = Array.isArray(payload.quotes) ? payload.quotes as Array<Record<string, unknown>> : [];
            setHub((current) => current ? patchHubWithQuotes(current, quotes) : current);
            setTickToast(
              `${formatIntervalLabel(String(payload.interval_key || ""))} tick applied to ${fmtInteger(Number(payload.applied_count || quotes.length || 0))} assets`
            );
            void apiFetch<Record<string, unknown>>(`/api/market/adjustments/summary?recent_limit=${ADJUSTMENT_SUMMARY_RECENT_LIMIT}`, { cache: "no-store" })
              .then((result) => setAdjustmentSummary(normalizeMarketAdjustmentSummary(result)))
              .catch(() => {});
            return;
          }

          if (payload.type === "market.live_order_queued") {
            setTickToast("Live order queued for the next 10-minute execution tick");
            refreshLiveOrderSummary();
            return;
          }

          if (payload.type === "market.live_order_rejected") {
            setTickToast("A live order was rejected during batch execution");
            refreshLiveOrderSummary();
            return;
          }

          if (payload.type !== "market.trade_fill") return;
          const normalizedTrade = normalizeMarketHubTrade(payload.trade as Record<string, unknown>);
          const marketEvent = {
            type: "market.trade_fill",
            trade: normalizedTrade,
            quote: {
              asset_id: Number((payload.quote as Record<string, unknown> | undefined)?.asset_id || 0),
              symbol: String((payload.quote as Record<string, unknown> | undefined)?.symbol || ""),
              display_name: String((payload.quote as Record<string, unknown> | undefined)?.display_name || ""),
              mid_price: toNumber((payload.quote as Record<string, unknown> | undefined)?.mid_price),
              bid_price: toNumber((payload.quote as Record<string, unknown> | undefined)?.bid_price),
              ask_price: toNumber((payload.quote as Record<string, unknown> | undefined)?.ask_price),
              premium_pct: null,
              updated_at: (payload.quote as Record<string, unknown> | undefined)?.updated_at ? String((payload.quote as Record<string, unknown>).updated_at) : null,
            },
            market_status: {
              current_market_date: (payload.market_status as Record<string, unknown> | undefined)?.current_market_date
                ? String((payload.market_status as Record<string, unknown>).current_market_date)
                : null,
              last_settlement_market_date: (payload.market_status as Record<string, unknown> | undefined)?.last_settlement_market_date
                ? String((payload.market_status as Record<string, unknown>).last_settlement_market_date)
                : null,
              is_trading_open: Boolean((payload.market_status as Record<string, unknown> | undefined)?.is_trading_open),
            },
          } as MarketTradeEvent;

          setTrades((current) => mergeTrades(current, [normalizedTrade]));
          setHub((current) => current ? patchHubWithEvent(current, marketEvent) : current);
          setLastLiveAt(normalizedTrade.ts);
          refreshLiveOrderSummary();
        } catch {
          // Ignore malformed payloads.
        }
      };

      socket.onclose = () => {
        socket = null;
        setWsStatus("closed");
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

  async function handleLoadMore() {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const result = await apiFetch<{ items: Array<Record<string, unknown>>; next_cursor: string | null }>(
        `/api/market/trades?limit=20&cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" }
      );

      const incoming = result.items.map(normalizeMarketHubTrade);
      setTrades((current) => mergeTrades(current, incoming, current.length + incoming.length));
      setNextCursor(result.next_cursor);
    } catch (nextError) {
      setError(String((nextError as Error).message || nextError));
    } finally {
      setIsLoadingMore(false);
    }
  }

  const allMarketIndex = useMemo(
    () => hub?.indexes.find((index) => index.group === "all") || hub?.indexes[0] || null,
    [hub]
  );

  const assetMeta = useMemo(() => {
    const map = new Map<string, { icon: string | null; color: string | null }>();
    const assetLists = hub
      ? [
          ...hub.leaders.top_price,
          ...hub.leaders.top_volume,
          ...hub.leaders.top_movers,
          ...hub.leaders.top_losers,
          ...hub.leaders.top_premiums,
          ...hub.leaders.top_discounts,
          ...trades,
        ]
      : [];

    for (const asset of assetLists) {
      if (!asset.symbol || map.has(asset.symbol)) continue;
      map.set(asset.symbol, { icon: asset.icon ?? null, color: asset.color ?? null });
    }

    return map;
  }, [hub, trades]);

  const indexSeries = useMemo(() => {
    if (!allMarketIndex) return [];
    return [
      {
        name: "All Market",
        color: "#5fdeec",
        kind: "area" as const,
        values: allMarketIndex.series
          .filter((point) => point.bucket >= HEARTBEAT_INDEX_START_DATE)
          .map((point) => ({ time: point.bucket, value: point.value })),
      },
    ];
  }, [allMarketIndex]);

  const tradePressure = useMemo(() => {
    return trades.reduce(
      (acc, trade) => {
        if (trade.side.toLowerCase() === "buy") acc.buyCount += 1;
        if (trade.side.toLowerCase() === "sell") acc.sellCount += 1;
        return acc;
      },
      { buyCount: 0, sellCount: 0 }
    );
  }, [trades]);

  const hotSymbols = useMemo(() => {
    const bySymbol = new Map<string, { symbol: string; count: number; cash: number }>();
    for (const trade of trades) {
      const current = bySymbol.get(trade.symbol) || { symbol: trade.symbol, count: 0, cash: 0 };
      current.count += 1;
      current.cash += trade.gross_cash;
      bySymbol.set(trade.symbol, current);
    }
    return [...bySymbol.values()].sort((a, b) => b.count - a.count || b.cash - a.cash).slice(0, 16);
  }, [trades]);

  const activityScore = useMemo(() => {
    if (!hub) return 0;
    const fiveMinuteTrades = hub.activity.windows["5m"].trade_count;
    const hourlyPace = Math.max(1, hub.activity.windows["1h"].trade_count / 12);
    const paceScore = Math.min(52, (fiveMinuteTrades / hourlyPace) * 28);
    const traderScore = Math.min(24, hub.activity.windows["5m"].trader_count * 4);
    const assetScore = Math.min(24, hub.activity.windows["5m"].asset_count * 3);
    return Math.max(0, Math.min(100, paceScore + traderScore + assetScore));
  }, [hub]);

  const nextTickMs = useMemo(() => {
    if (!adjustmentSummary?.next_tick?.scheduled_at) return null;
    const timestamp = new Date(adjustmentSummary.next_tick.scheduled_at).getTime();
    if (Number.isNaN(timestamp)) return null;
    return timestamp - now.getTime();
  }, [adjustmentSummary, now]);

  const adjustmentMovementColumns = useMemo(() => {
    const feed = adjustmentSummary?.feed || [];
    const appliedMovers = feed.filter((item) => item.status !== "skipped" && item.move_pct !== null && item.move_pct !== undefined);
    const lastTickMovers = appliedMovers.filter((item) => isLastAdjustmentOutcome(item, adjustmentSummary?.last_tick || null));
    const source = lastTickMovers.length ? lastTickMovers : appliedMovers;

    return {
      positive: source
        .filter((item) => (item.move_pct ?? 0) > 0)
        .sort((a, b) => (b.move_pct ?? 0) - (a.move_pct ?? 0)),
      negative: source
        .filter((item) => (item.move_pct ?? 0) < 0)
        .sort((a, b) => (a.move_pct ?? 0) - (b.move_pct ?? 0)),
      sourceCount: source.length,
    };
  }, [adjustmentSummary]);

  const hasHiddenAdjustmentMovers =
    adjustmentMovementColumns.positive.length > ADJUSTMENT_MOVEMENT_PREVIEW_COUNT ||
    adjustmentMovementColumns.negative.length > ADJUSTMENT_MOVEMENT_PREVIEW_COUNT;
  const visiblePositiveAdjustmentMovers = showAllAdjustmentMovers
    ? adjustmentMovementColumns.positive
    : adjustmentMovementColumns.positive.slice(0, ADJUSTMENT_MOVEMENT_PREVIEW_COUNT);
  const visibleNegativeAdjustmentMovers = showAllAdjustmentMovers
    ? adjustmentMovementColumns.negative
    : adjustmentMovementColumns.negative.slice(0, ADJUSTMENT_MOVEMENT_PREVIEW_COUNT);

  const dailyTimelineProgress = useMemo(() => {
    const eastern = getZoneClock(now, "America/New_York");
    return ((eastern.hour * 60 + eastern.minute) / 1440) * 100;
  }, [now]);

  return (
    <SiteShell>
      <div className={styles.page}>
        {tickToast ? <div className={styles.tickToast}><FaSignal /> {tickToast}</div> : null}
        <section className={styles.hero}>
          <Image
            src="/market-heartbeat-floor-hero.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className={styles.heroImage}
            aria-hidden="true"
          />
          <div className={styles.heroCopy}>
            <div className={styles.heroEyebrow}>
              <FaSignal />
              <span>Live game activity</span>
            </div>
            <h1 className={styles.heroTitle}>Market Heartbeat</h1>
            <p className={styles.heroText}>
              See what players are trading right now.
            </p>
          </div>
          <div className={styles.heroStatus}>
            <div className={styles.connectionRow}>
              <span className={`${styles.connectionDot} ${wsStatus === "open" ? styles.connectionOpen : wsStatus === "connecting" ? styles.connectionConnecting : styles.connectionClosed}`} />
              <strong>{wsStatus === "open" ? "Live feed connected" : wsStatus === "connecting" ? "Connecting live feed" : "Live feed offline"}</strong>
            </div>
            <span className={styles.heroMeta}>
              {hub?.status?.is_trading_open ? "Trading open" : "Trading paused"}
              {hub?.status?.current_market_date ? ` · market date ${hub.status.current_market_date}` : ""}
              {lastLiveAt ? ` · last print ${formatRelativeTime(lastLiveAt)}` : ""}
            </span>
          </div>
        </section>

        {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
        {adjustmentError ? <div className="statusMessage">Adjustment overlay unavailable: {adjustmentError}</div> : null}
        {isLoading ? <div className={styles.loading}>Loading market activity…</div> : null}

        {hub ? (
          <>
            <section className={styles.adjustmentClockDeck}>
              <div className={styles.countdownPanel}>
                <span className={styles.microLabel}>Next adjustment tick</span>
                <strong>{formatCountdown(nextTickMs)}</strong>
                <p>
                  {adjustmentSummary?.next_tick
                    ? `${formatIntervalLabel(adjustmentSummary.next_tick.interval_key)} · ${formatEt(adjustmentSummary.next_tick.scheduled_at)} · ${fmtInteger(adjustmentSummary.next_tick.asset_count)} assets`
                    : "Waiting for generated intervals"}
                </p>
                <div className={styles.tickRules}>
                  <span>4 ticks per market day</span>
                  <span>Each coin moves toward a hidden target</span>
                  <span>Tick strength stays secret until after it lands</span>
                </div>
                <div className={styles.countdownSessionRows}>
                  <div className={styles.countdownSessionRow}>
                    <span>Status</span>
                    <strong className={hub.status?.is_trading_open ? styles.positive : styles.negative}>{hub.status?.is_trading_open ? "Open" : "Closed"}</strong>
                    <em>{hub.status?.trading_message || "Trading session operating normally."}</em>
                  </div>
                  <div className={styles.countdownSessionRow}>
                    <span>Next settlement</span>
                    <strong>{hub.status?.next_scheduled_settlement_at ? fmtDate(hub.status.next_scheduled_settlement_at) : "—"}</strong>
                    <em>Scheduled market cycle checkpoint.</em>
                  </div>
                  <div className={styles.countdownSessionRow}>
                    <span>Daily report</span>
                    <strong>{hub.report?.market_date || "—"}</strong>
                    <em>Latest generated market summary date.</em>
                  </div>
                </div>
              </div>
              <div className={styles.clockWall}>
                <AnalogClock label={CLOCK_ZONES[0].label} zone={CLOCK_ZONES[0].zone} now={now} large />
                <div className={styles.smallClockGrid}>
                  {CLOCK_ZONES.slice(1).map((clock) => (
                    <AnalogClock key={clock.zone} label={clock.label} zone={clock.zone} now={now} />
                  ))}
                </div>
              </div>
              <div className={styles.tickTimeline}>
                <div className={styles.tickTimelineHead}>
                  <span className={styles.microLabel}>Daily tick timeline</span>
                  <strong>{Math.round(dailyTimelineProgress)}%</strong>
                </div>
                <div className={styles.timelineTrack}>
                  <DailyTickTimelineCanvas progress={dailyTimelineProgress} />
                  {TICK_INTERVAL_ORDER.map((key) => (
                    <span key={key} className={styles.timelineTick} style={timelineZPosition(TIMELINE_LABEL_PROGRESS[key])}>
                      <span className={styles.timelineTickText}>{formatIntervalLabel(key)}</span>
                    </span>
                  ))}
                </div>
                <Image src={kronie} alt="" className={styles.tickTimelineMascot} width={337} height={405} />
              </div>
            </section>

            <section className={styles.controlDeck}>
              <div className={styles.pulsePanel}>
                <ActivityGauge
                  score={activityScore}
                  label="Activity intensity"
                  meta={`${fmtInteger(hub.activity.windows["5m"].trade_count)} trades · ${fmtInteger(hub.activity.windows["5m"].trader_count)} traders in 5m`}
                />
                <FlowPressure buyCount={tradePressure.buyCount} sellCount={tradePressure.sellCount} />
              </div>
              <StatCard label="1 Hour Flow" value={fmtNumber(hub.activity.windows["1h"].volume_cash, "$")} meta={`${fmtInteger(hub.activity.windows["1h"].trade_count)} trades`} icon={<FaMoneyBillTrendUp />} />
              <StatCard label="24 Hour Crowd" value={fmtInteger(hub.activity.windows["24h"].trader_count)} meta={`${fmtInteger(hub.activity.windows["24h"].asset_count)} assets touched`} icon={<FaUsers />} />
              <StatCard label="Market Breadth" value={`${fmtInteger(allMarketIndex?.summary?.advancers)} / ${fmtInteger(allMarketIndex?.summary?.decliners)}`} meta={`${fmtInteger(allMarketIndex?.summary?.constituent_count)} tracked`} icon={<FaChartLine />} />
            </section>

            <div className={styles.liveActivityRow}>
              <PendingLiveOrders hub={hub} now={now} />
              <ActiveTraderPanel hub={hub} />
            </div>

            <div className={styles.hotSymbolsRow}>
              <section className={styles.hotPanel}>
                <div className={styles.sectionHead}>
                  <div>
                    <h2 className={`${styles.sectionTitle} ${styles.hotTitle}`}><FaFire aria-hidden="true" /> Hot Symbols</h2>
                    <p className={styles.sectionCopy}>Most repeated names in the currently loaded live tape.</p>
                  </div>
                  <div className={styles.sectionMeta}><FaBolt /> Rotating now</div>
                </div>

                <HotSymbolStrip symbols={hotSymbols} assetMeta={assetMeta} />
              </section>

              <div className={styles.hotMascotSlot}>
                <Image src={smugKorone} alt="" className={styles.hotMascotImage} width={320} height={320} />
              </div>
            </div>

            <div className={styles.mainGrid}>
              <section className={`${styles.panel} ${styles.chartPanel}`}>
                <div className={styles.sectionHead}>
                  <div>
                    <h2 className={styles.sectionTitle}>Heartbeat Index</h2>
                    <p className={styles.sectionCopy}>
                      {allMarketIndex?.summary?.market_date ? `${allMarketIndex.summary.market_date} · ` : ""}
                      broad index action and current breadth
                    </p>
                  </div>
                  <Link href="/indexes" className={styles.sectionMetaLink}>
                    <FaChartLine />
                    <span>Open indexes</span>
                  </Link>
                </div>
                <TrendChartCard
                  title="All Market Index"
                  subtitle="Recent index path"
                  series={indexSeries}
                  bare
                />
              </section>

              <section className={`${styles.panel} ${styles.tapePanel}`}>
                <div className={styles.sectionHead}>
                  <div>
                    <h2 className={styles.sectionTitle}>Live Trade Tape</h2>
                    <p className={styles.sectionCopy}>Recent fills across the entire market, newest first.</p>
                  </div>
                  <div className={styles.sectionMeta}>
                    <FaClock />
                    <span>{fmtInteger(trades.length)} prints loaded</span>
                  </div>
                </div>
                <TradeTape trades={trades} assetMeta={assetMeta} />
                <div className={styles.actionsRow}>
                  <button type="button" className={styles.loadMoreButton} disabled={!nextCursor || isLoadingMore} onClick={() => void handleLoadMore()}>
                    {isLoadingMore ? "Loading…" : nextCursor ? "Load Older Trades" : "No More Trades"}
                  </button>
                </div>
              </section>
            </div>

            <section className={styles.adjustmentFeedPanel}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Adjustment Feed</h2>
                  <p className={styles.sectionCopy}>Largest up and down moves from the last adjustment tick.</p>
                </div>
                <div className={styles.sectionMeta}>
                  <FaClock />
                  <span>{fmtInteger(adjustmentMovementColumns.sourceCount)} movements</span>
                </div>
              </div>
              <div className={styles.adjustmentFeedBody}>
                <div className={styles.adjustmentMovementGrid}>
                  <div className={styles.adjustmentMovementColumn}>
                    <div className={styles.adjustmentMovementHead}>
                      <span>Upward moves</span>
                      <b className={styles.positive}>{fmtInteger(adjustmentMovementColumns.positive.length)}</b>
                    </div>
                    <div className={styles.adjustmentMovementList}>
                      {visiblePositiveAdjustmentMovers.length ? visiblePositiveAdjustmentMovers.map((item) => (
                        <Link key={`positive-${item.id}-${item.symbol}`} href={`/stocks/${encodeURIComponent(item.symbol)}`} className={styles.adjustmentFeedRow}>
                          <AssetCoin symbol={item.symbol} icon={item.icon ?? null} color={item.color ?? null} className={styles.assetIcon} shape="circle" />
                          <span>
                            <strong>{item.symbol} {formatIntervalLabel(item.interval_key)}</strong>
                            <em>{formatRelativeTime(item.applied_at || item.scheduled_at)}</em>
                          </span>
                          <span className={styles.adjustmentMetric}>
                            <em>{fmtNumber(item.price_after ?? item.price_before, "$")}</em>
                            <b className={styles.positive}><FaArrowTrendUp aria-hidden="true" /> +{fmtPct(item.move_pct)}</b>
                          </span>
                        </Link>
                      )) : <div className={styles.empty}>No upward moves in the last adjustment.</div>}
                    </div>
                  </div>
                  <div className={styles.adjustmentMovementColumn}>
                    <div className={styles.adjustmentMovementHead}>
                      <span>Downward moves</span>
                      <b className={styles.negative}>{fmtInteger(adjustmentMovementColumns.negative.length)}</b>
                    </div>
                    <div className={styles.adjustmentMovementList}>
                      {visibleNegativeAdjustmentMovers.length ? visibleNegativeAdjustmentMovers.map((item) => (
                        <Link key={`negative-${item.id}-${item.symbol}`} href={`/stocks/${encodeURIComponent(item.symbol)}`} className={styles.adjustmentFeedRow}>
                          <AssetCoin symbol={item.symbol} icon={item.icon ?? null} color={item.color ?? null} className={styles.assetIcon} shape="circle" />
                          <span>
                            <strong>{item.symbol} {formatIntervalLabel(item.interval_key)}</strong>
                            <em>{formatRelativeTime(item.applied_at || item.scheduled_at)}</em>
                          </span>
                          <span className={styles.adjustmentMetric}>
                            <em>{fmtNumber(item.price_after ?? item.price_before, "$")}</em>
                            <b className={styles.negative}><FaArrowTrendDown aria-hidden="true" /> {fmtPct(item.move_pct)}</b>
                          </span>
                        </Link>
                      )) : <div className={styles.empty}>No downward moves in the last adjustment.</div>}
                    </div>
                  </div>
                  {hasHiddenAdjustmentMovers ? (
                    <button type="button" className={styles.adjustmentExpandButton} onClick={() => setShowAllAdjustmentMovers((current) => !current)}>
                      {showAllAdjustmentMovers ? "Show top 10 each" : "Show all coins"}
                    </button>
                  ) : null}
                </div>
                <div className={styles.adjustmentFeedImage}>
                  <Image src={fubogki} alt="" width={192} height={192} />
                </div>
              </div>
            </section>

            <div className={styles.intelGrid}>
              <ActivityInsightRail hub={hub} activityScore={activityScore} />

              <AssetLeaderList
                title="Fastest Movers"
                subtitle="Names with the biggest positive 24H move."
                assets={hub.leaders.top_movers}
                metric={(asset) => <span className={toneClass(asset.move_24h_pct)}>{formatSignedPct(asset.move_24h_pct)}</span>}
              />

              <AssetLeaderList
                title="Pressure Board"
                subtitle="Names under the heaviest 24H pressure."
                assets={hub.leaders.top_losers}
                metric={(asset) => <span className={toneClass(asset.move_24h_pct)}>{formatSignedPct(asset.move_24h_pct)}</span>}
              />

              <AssetLeaderList
                title="Flow Leaders"
                subtitle="Most heavily traded by 24H share volume."
                assets={hub.leaders.top_volume}
                metric={(asset) => <span>{fmtInteger(asset.volume_24h)} sh</span>}
              />

              <section className={styles.panel}>
                <div className={styles.sectionHead}>
                  <div>
                    <h2 className={styles.sectionTitle}>Volume Momentum</h2>
                    <p className={styles.sectionCopy}>Names seeing the biggest recent acceleration in flow.</p>
                  </div>
                </div>
                <div className={styles.assetList}>
                  {hub.leaders.volume_winners.length ? hub.leaders.volume_winners.map((asset) => (
                    <Link key={asset.symbol} href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.assetRow}>
                      <div className={styles.assetMain}>
                        <AssetCoin symbol={asset.symbol} icon={assetMeta.get(asset.symbol)?.icon ?? null} color={assetMeta.get(asset.symbol)?.color ?? null} className={styles.assetIcon} shape="circle" />
                        <div>
                          <strong>{asset.symbol}</strong>
                          <span>{asset.display_name}</span>
                        </div>
                      </div>
                      <div className={styles.assetMetric}>
                        <strong>{fmtInteger(asset.volume_shares)} sh</strong>
                        <span className={toneClass(asset.volume_change_pct)}>{formatSignedPct(asset.volume_change_pct)}</span>
                      </div>
                    </Link>
                  )) : <div className={styles.empty}>No momentum leaders yet.</div>}
                </div>
              </section>

              <div className={styles.takoContainer}>  
                <Image src={tako} alt="Tako" width={680} height={383} />
              </div>
            </div>

          </>
        ) : null}
      </div>
    </SiteShell>
  );
}
