"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  FaBolt,
  FaChartLine,
  FaCircleNodes,
  FaClock,
  FaMoneyBillTrendUp,
  FaSignal,
  FaUsers,
} from "react-icons/fa6";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtInteger, fmtNumber, fmtPct, toNumber } from "@/app/lib/format";
import { normalizeMarketHubResponse, normalizeMarketHubTrade } from "@/app/lib/normalizers";
import type { MarketAsset, MarketHubResponse, MarketHubTrade, MarketTradeEvent } from "@/app/lib/types";
import { getMarketWsUrl } from "@/app/lib/ws";
import styles from "@/app/components/pages/market-page.module.scss";
import shellStyles from "@/app/components/pages/page-shell.module.scss";

import tako from "@/public/tako.png";

const INITIAL_TRADE_LIMIT = 20;
const LIVE_TRADE_CAP = 40;
const RECONCILE_INTERVAL_MS = 60_000;
const HEARTBEAT_INDEX_START_DATE = "2025-10-06";

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

function toneClass(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (value > 0) return shellStyles.positive;
  if (value < 0) return shellStyles.negative;
  return "";
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
    current_premium_pct: event.quote.premium_pct,
    volume_24h: (asset.volume_24h ?? 0) + event.trade.quantity,
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
      top_premiums: patchAssets(current.leaders.top_premiums),
      top_discounts: patchAssets(current.leaders.top_discounts),
    },
    recent_trades: {
      ...current.recent_trades,
      items: mergeTrades(current.recent_trades.items, [event.trade]),
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
              premium_pct: toNumber((payload.quote as Record<string, unknown> | undefined)?.premium_pct),
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
        ]
      : [];

    for (const asset of assetLists) {
      if (!asset.symbol || map.has(asset.symbol)) continue;
      map.set(asset.symbol, { icon: asset.icon ?? null, color: asset.color ?? null });
    }

    return map;
  }, [hub]);

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
    return [...bySymbol.values()].sort((a, b) => b.count - a.count || b.cash - a.cash).slice(0, 5);
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

  return (
    <SiteShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.heroEyebrow}>
              <FaSignal />
              <span>Live game activity</span>
            </div>
            <h1 className={styles.heroTitle}>Market Heartbeat</h1>
            <p className={styles.heroText}>
              Live fills, trader pressure, hot symbols, and attention rotation across the NASFAQ game economy.
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
        {isLoading ? <div className={styles.loading}>Loading market activity…</div> : null}

        {hub ? (
          <>
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

            <section className={styles.hotPanel}>
              <div className={styles.sectionHead}>
                <div>
                  <h2 className={styles.sectionTitle}>Hot Symbols</h2>
                  <p className={styles.sectionCopy}>Most repeated names in the currently loaded live tape.</p>
                </div>
                <div className={styles.sectionMeta}><FaBolt /> Rotating now</div>
              </div>
              <HotSymbolStrip symbols={hotSymbols} assetMeta={assetMeta} />
            </section>

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

            <div className={styles.bottomGrid}>
              <section className={styles.panel}>
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
                          {trader.username.slice(0, 1).toUpperCase()}
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

              <section className={styles.panel}>
                <div className={styles.sectionHead}>
                  <div>
                    <h2 className={styles.sectionTitle}>Session Clock</h2>
                    <p className={styles.sectionCopy}>Runtime state and the current session timeline.</p>
                  </div>
                </div>
                <div className={styles.clockGrid}>
                  <div className={styles.clockCard}>
                    <span>Status</span>
                    <strong className={hub.status?.is_trading_open ? styles.positive : styles.negative}>{hub.status?.is_trading_open ? "Open" : "Closed"}</strong>
                    <p>{hub.status?.trading_message || "Trading session operating normally."}</p>
                  </div>
                  <div className={styles.clockCard}>
                    <span>Next settlement</span>
                    <strong>{hub.status?.next_scheduled_settlement_at ? fmtDate(hub.status.next_scheduled_settlement_at) : "—"}</strong>
                    <p>Scheduled market cycle checkpoint.</p>
                  </div>
                  <div className={styles.clockCard}>
                    <span>Daily report</span>
                    <strong>{hub.report?.market_date || "—"}</strong>
                    <p>Latest generated market summary date.</p>
                  </div>
                </div>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </SiteShell>
  );
}
