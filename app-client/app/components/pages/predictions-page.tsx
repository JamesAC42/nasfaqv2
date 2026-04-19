"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FaArrowTrendUp, FaClock, FaScaleBalanced, FaShieldHalved } from "react-icons/fa6";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import {
  normalizePredictionCandlesResponse,
  normalizePredictionMarketDetailResponse,
  normalizePredictionMarketListResponse,
  normalizePredictionOrderBookResponse,
  normalizePredictionTradeResponse,
} from "@/app/lib/normalizers";
import type {
  PredictionCandlePoint,
  PredictionMarket,
  PredictionMarketScope,
  PredictionOrderBook,
  PredictionTrade,
} from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/pages/predictions-page.module.scss";

type DetailBundle = {
  market: PredictionMarket;
  orderbook: PredictionOrderBook;
  trades: PredictionTrade[];
  yesCandles: PredictionCandlePoint[];
  noCandles: PredictionCandlePoint[];
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
] as const;

function probabilityLabel(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return fmtPct(value);
}

function centsLabel(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}c`;
}

function relativeCloseLabel(value: string | null | undefined) {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  const diffMs = timestamp - Date.now();
  const diffHours = Math.round(diffMs / (60 * 60 * 1000));
  if (Math.abs(diffHours) < 24) {
    if (diffHours > 0) return `Closes in ${diffHours}h`;
    if (diffHours < 0) return `Closed ${Math.abs(diffHours)}h ago`;
  }
  return fmtDate(value);
}

function formatStatusLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replace(/_/g, " ");
}

function statusClassName(status: string) {
  switch (status) {
    case "open":
      return styles.statusOpen;
    case "pending_approval":
      return styles.statusPending;
    case "draft":
      return styles.statusDraft;
    case "closed":
      return styles.statusClosed;
    case "resolved":
      return styles.statusResolved;
    case "voided":
      return styles.statusVoided;
    case "rejected":
      return styles.statusRejected;
    default:
      return styles.statusClosed;
  }
}

function buildMarketHref(slug: string) {
  const params = new URLSearchParams();
  params.set("market", slug);
  return `/predictions?${params.toString()}`;
}

function bestPrice(levels: Array<{ price: number; quantity: number }>) {
  return levels[0]?.price ?? null;
}

function spreadLabel(bestBid: number | null, bestAsk: number | null) {
  if (bestBid === null || bestAsk === null) return "—";
  return centsLabel(bestAsk - bestBid);
}

function ScopeControls({
  scope,
  onChange,
  canShowMine,
  canShowReviewQueue,
}: {
  scope: PredictionMarketScope;
  onChange: (scope: PredictionMarketScope) => void;
  canShowMine: boolean;
  canShowReviewQueue: boolean;
}) {
  const items: Array<{ value: PredictionMarketScope; label: string }> = [{ value: "public", label: "Public" }];
  if (canShowMine) items.push({ value: "mine", label: "My markets" });
  if (canShowReviewQueue) items.push({ value: "review_queue", label: "Review queue" });

  return (
    <div className={styles.pillGroup}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`${styles.pillButton} ${scope === item.value ? styles.pillButtonActive : ""}`.trim()}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function OrderBookColumn({
  title,
  levels,
  tone,
}: {
  title: string;
  levels: Array<{ price: number; quantity: number }>;
  tone: "buy" | "sell";
}) {
  return (
    <div className={styles.bookColumn}>
      <h4>{title}</h4>
      <div className={styles.bookRows}>
        {levels.length ? levels.map((level) => (
          <div key={`${tone}-${level.price}`} className={styles.bookRow}>
            <span className={tone === "buy" ? styles.bookPriceBuy : styles.bookPriceSell}>{centsLabel(level.price)}</span>
            <span>{fmtInteger(level.quantity)} sh</span>
          </div>
        )) : <div className={styles.empty}>No resting liquidity.</div>}
      </div>
    </div>
  );
}

function TradeList({ trades }: { trades: PredictionTrade[] }) {
  return (
    <div className={styles.tradeList}>
      {trades.length ? trades.map((trade) => (
        <article key={trade.id} className={styles.tradeRow}>
          <div className={styles.tradeTop}>
            <div>
              <strong>{trade.trade_kind.toUpperCase()} · {trade.outcome_label}</strong>
              <div className={styles.tradeMeta}>
                {trade.maker_username || "maker"} vs {trade.taker_username || "taker"} · {fmtDate(trade.matched_at)}
              </div>
            </div>
            <span className={`${styles.statusBadge} ${styles.kindBadge}`}>{trade.maker_side || "—"} / {trade.taker_side || "—"}</span>
          </div>
          <div className={styles.tradeGrid}>
            <div>
              <span>Price</span>
              <strong>{centsLabel(trade.price)}</strong>
            </div>
            <div>
              <span>Probability</span>
              <strong>{probabilityLabel(trade.price)}</strong>
            </div>
            <div>
              <span>Quantity</span>
              <strong>{fmtInteger(trade.quantity)} sh</strong>
            </div>
            <div>
              <span>Notional</span>
              <strong>{fmtNumber(trade.notional_cash, "$")}</strong>
            </div>
          </div>
        </article>
      )) : <div className={styles.empty}>No fills yet for this market.</div>}
    </div>
  );
}

export function PredictionsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const selectedSlugParam = searchParams.get("market");
  const [scope, setScope] = useState<PredictionMarketScope>("public");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailBundle | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const canShowMine = Boolean(user);
  const canShowReviewQueue = Boolean(user?.is_admin || user?.can_approve_prediction_markets);

  useEffect(() => {
    if (scope === "mine" && !canShowMine) {
      setScope("public");
      return;
    }
    if (scope === "review_queue" && !canShowReviewQueue) {
      setScope("public");
    }
  }, [canShowMine, canShowReviewQueue, scope]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingList(true);
    setListError(null);

    async function loadMarkets() {
      try {
        const params = new URLSearchParams();
        params.set("scope", scope);
        params.set("limit", "40");
        if (statusFilter !== "all") params.set("status", statusFilter);
        const result = await apiFetch<Record<string, unknown>>(`/api/prediction-markets?${params.toString()}`, { cache: "no-store" });
        if (cancelled) return;
        const normalized = normalizePredictionMarketListResponse(result);
        setMarkets(normalized.items);
        setListTotal(normalized.pagination.total);
      } catch (error) {
        if (cancelled) return;
        setMarkets([]);
        setListTotal(0);
        setListError(String((error as Error).message || error));
      } finally {
        if (!cancelled) setIsLoadingList(false);
      }
    }

    void loadMarkets();
    return () => {
      cancelled = true;
    };
  }, [scope, statusFilter]);

  const selectedSlug = selectedSlugParam || markets[0]?.slug || null;

  useEffect(() => {
    if (!selectedSlug) {
      setDetail(null);
      setDetailError(null);
      setIsLoadingDetail(false);
      return;
    }

    const selectedSlugValue: string = selectedSlug;

    let cancelled = false;
    setIsLoadingDetail(true);
    setDetailError(null);

    async function loadDetail() {
      try {
        const [marketResult, orderbookResult, tradesResult, yesCandlesResult, noCandlesResult] = await Promise.all([
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(selectedSlugValue)}`, { cache: "no-store" }),
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(selectedSlugValue)}/orderbook`, { cache: "no-store" }),
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(selectedSlugValue)}/trades?limit=12`, { cache: "no-store" }),
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(selectedSlugValue)}/candles?interval=1h&outcome=yes&limit=120`, { cache: "no-store" }),
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(selectedSlugValue)}/candles?interval=1h&outcome=no&limit=120`, { cache: "no-store" }),
        ]);

        if (cancelled) return;

        const market = normalizePredictionMarketDetailResponse(marketResult).market;
        const orderbook = normalizePredictionOrderBookResponse(orderbookResult).orderbook;
        const trades = normalizePredictionTradeResponse(tradesResult).trades;
        const yesCandles = normalizePredictionCandlesResponse(yesCandlesResult).candles;
        const noCandles = normalizePredictionCandlesResponse(noCandlesResult).candles;

        setDetail({ market, orderbook, trades, yesCandles, noCandles });
      } catch (error) {
        if (cancelled) return;
        setDetail(null);
        setDetailError(String((error as Error).message || error));
      } finally {
        if (!cancelled) setIsLoadingDetail(false);
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedSlug]);

  const probabilitySeries = useMemo(() => {
    if (!detail) return [];
    return [
      {
        name: "Yes",
        color: "#10b981",
        kind: "area" as const,
        values: detail.yesCandles.map((candle) => ({
          time: candle.bucket,
          value: candle.close,
        })),
      },
      {
        name: "No",
        color: "#ef4444",
        kind: "line" as const,
        values: detail.noCandles.map((candle) => ({
          time: candle.bucket,
          value: candle.close,
        })),
      },
    ];
  }, [detail]);

  const marketCounts = useMemo(() => ({
    open: markets.filter((market) => market.status === "open").length,
    pending: markets.filter((market) => market.status === "pending_approval").length,
    resolved: markets.filter((market) => market.status === "resolved").length,
  }), [markets]);

  const selectedBestBid = detail ? bestPrice(detail.orderbook.yes.buy) : null;
  const selectedBestAsk = detail ? bestPrice(detail.orderbook.yes.sell) : null;

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <div className={styles.heroTop}>
            <div>
              <div className={styles.eyebrow}>Community Prediction Markets</div>
              <h1 className={styles.title}>Binary markets for future outcomes, with probability history and canonical YES/NO books.</h1>
              <p className={styles.copy}>
                This first frontend slice is read-only. It exposes the market list, reviewer-only visibility, live probability curves,
                complementary YES/NO depth, and the trade tape that sits on top of the canonical backend model.
              </p>
            </div>
            <div className={styles.heroActions}>
              <div className={styles.heroPill}><FaShieldHalved /> {user?.can_create_prediction_markets ? "Market creator access enabled" : "Read-only access"}</div>
              <div className={styles.heroPill}><FaScaleBalanced /> {canShowReviewQueue ? "Approval tools unlocked" : "Public market view"}</div>
            </div>
          </div>

          <div className={styles.metricStrip}>
            <div className={styles.metricCard}>
              <span>Visible markets</span>
              <strong>{fmtInteger(listTotal)}</strong>
            </div>
            <div className={styles.metricCard}>
              <span>Open now</span>
              <strong>{fmtInteger(marketCounts.open)}</strong>
            </div>
            <div className={styles.metricCard}>
              <span>Pending approval</span>
              <strong>{fmtInteger(marketCounts.pending)}</strong>
            </div>
            <div className={styles.metricCard}>
              <span>Resolved</span>
              <strong>{fmtInteger(marketCounts.resolved)}</strong>
            </div>
          </div>
        </section>

        <section className={styles.controls}>
          <div className={styles.controlGroup}>
            <span className={styles.label}>Scope</span>
            <ScopeControls scope={scope} onChange={setScope} canShowMine={canShowMine} canShowReviewQueue={canShowReviewQueue} />
          </div>
          <div className={styles.controlGroup}>
            <label className={styles.label} htmlFor="prediction-status-filter">Status</label>
            <select
              id="prediction-status-filter"
              className={styles.select}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </section>

        <div className={styles.layout}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>Market directory</h2>
                <p className={styles.panelCopy}>
                  {scope === "public" ? "Tradable public listings." : scope === "mine" ? "Markets you created." : "Markets waiting on approval."}
                </p>
              </div>
              <div className={styles.countPill}>{fmtInteger(listTotal)} total</div>
            </div>

            {listError ? <div className={styles.error}>Prediction market list unavailable: {listError}</div> : null}
            {isLoadingList ? <div className={styles.loading}>Loading prediction markets…</div> : null}

            <div className={styles.marketList}>
              {!isLoadingList && !markets.length && !listError ? <div className={styles.empty}>No markets in this slice yet.</div> : null}
              {markets.map((market) => (
                <Link
                  key={market.slug}
                  href={buildMarketHref(market.slug)}
                  className={`${styles.marketCard} ${market.slug === selectedSlug ? styles.marketCardActive : ""}`.trim()}
                >
                  <div className={styles.marketCardTop}>
                    <div>
                      <span className={styles.marketCardTitle}>{market.title}</span>
                      {market.subtitle ? <p className={styles.marketCardSubtitle}>{market.subtitle}</p> : null}
                    </div>
                    <span className={`${styles.statusBadge} ${statusClassName(market.status)}`}>{formatStatusLabel(market.status)}</span>
                  </div>
                  <div className={styles.marketCardMeta}>
                    <span className={styles.visibilityBadge}>{market.visibility}</span>
                    <span className={styles.kindBadge}>{market.market_type}</span>
                    {market.category?.display_name ? <span className={styles.kindBadge}>{market.category.display_name}</span> : null}
                  </div>
                  <div className={styles.marketCardStats}>
                    <div className={styles.miniStat}>
                      <span>Yes probability</span>
                      <strong>{probabilityLabel(market.last_traded_probability)}</strong>
                    </div>
                    <div className={styles.miniStat}>
                      <span>Volume</span>
                      <strong>{fmtNumber(market.total_volume_cash, "$")}</strong>
                    </div>
                    <div className={styles.miniStat}>
                      <span>Close</span>
                      <strong>{relativeCloseLabel(market.closes_at)}</strong>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <div className={styles.detailStack}>
            {detailError ? <div className={styles.error}>Prediction market detail unavailable: {detailError}</div> : null}
            {isLoadingDetail ? <div className={styles.panel}><div className={styles.loading}>Loading market detail…</div></div> : null}
            {!isLoadingDetail && !detail && !detailError ? (
              <section className={styles.panel}>
                <div className={styles.empty}>Select a market to inspect probability history, depth, and recent trades.</div>
              </section>
            ) : null}

            {detail ? (
              <>
                <section className={styles.panel}>
                  <div className={styles.detailHero}>
                    <div className={styles.detailHeroTop}>
                      <div>
                        <div className={styles.statusRow}>
                          <span className={`${styles.statusBadge} ${statusClassName(detail.market.status)}`}>{formatStatusLabel(detail.market.status)}</span>
                          <span className={styles.visibilityBadge}>{detail.market.visibility}</span>
                          <span className={styles.kindBadge}>{detail.market.market_type}</span>
                        </div>
                        <h2 className={styles.detailTitle}>{detail.market.title}</h2>
                        {detail.market.subtitle ? <p className={styles.detailSubtitle}>{detail.market.subtitle}</p> : null}
                      </div>
                      <div className={styles.detailProbability}>
                        <span>Current YES probability</span>
                        <strong>{probabilityLabel(detail.market.last_traded_probability)}</strong>
                      </div>
                    </div>

                    <div className={styles.statGrid}>
                      <div className={styles.detailStat}>
                        <span>Last traded price</span>
                        <strong>{centsLabel(detail.market.last_traded_probability)}</strong>
                      </div>
                      <div className={styles.detailStat}>
                        <span>Best YES spread</span>
                        <strong>{spreadLabel(selectedBestBid, selectedBestAsk)}</strong>
                      </div>
                      <div className={styles.detailStat}>
                        <span>Open interest</span>
                        <strong>{fmtInteger(detail.market.open_interest_shares)} shares</strong>
                      </div>
                      <div className={styles.detailStat}>
                        <span>Total volume</span>
                        <strong>{fmtNumber(detail.market.total_volume_cash, "$")}</strong>
                      </div>
                    </div>
                  </div>
                </section>

                <TrendChartCard
                  title="Probability history"
                  subtitle="YES and NO remain complementary in the canonical binary model."
                  series={probabilitySeries}
                />

                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2 className={styles.panelTitle}>Market brief</h2>
                      <p className={styles.panelCopy}>Lifecycle timing, permissions, and resolution instructions for this contract.</p>
                    </div>
                  </div>

                  <div className={styles.statGrid}>
                    <div className={styles.detailStat}>
                      <span><FaClock /> Opens</span>
                      <strong>{fmtDate(detail.market.opens_at)}</strong>
                    </div>
                    <div className={styles.detailStat}>
                      <span><FaClock /> Closes</span>
                      <strong>{fmtDate(detail.market.closes_at)}</strong>
                    </div>
                    <div className={styles.detailStat}>
                      <span><FaArrowTrendUp /> Last trade</span>
                      <strong>{detail.market.last_trade_at ? fmtDate(detail.market.last_trade_at) : "No fills yet"}</strong>
                    </div>
                    <div className={styles.detailStat}>
                      <span>Creator</span>
                      <strong>{detail.market.creator?.username || "Unknown"}</strong>
                    </div>
                  </div>

                  <div className={styles.doubleGrid}>
                    <div className={styles.infoBlock}>
                      <h3>Rules</h3>
                      <p>{detail.market.rules_text || "No rules text provided yet."}</p>
                    </div>
                    <div className={styles.infoBlock}>
                      <h3>Resolution source</h3>
                      <p>{detail.market.resolution_source_text || "No resolution source provided yet."}</p>
                    </div>
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2 className={styles.panelTitle}>Order book</h2>
                      <p className={styles.panelCopy}>Displayed as complementary YES and NO ladders derived from the same canonical market state.</p>
                    </div>
                  </div>

                  <div className={styles.orderbookGrid}>
                    <article className={styles.bookCard}>
                      <div className={styles.bookHeader}>
                        <h3>YES</h3>
                        <span className={styles.countPill}>Best bid {centsLabel(bestPrice(detail.orderbook.yes.buy))} · Best ask {centsLabel(bestPrice(detail.orderbook.yes.sell))}</span>
                      </div>
                      <div className={styles.bookColumns}>
                        <OrderBookColumn title="Bids" levels={detail.orderbook.yes.buy} tone="buy" />
                        <OrderBookColumn title="Asks" levels={detail.orderbook.yes.sell} tone="sell" />
                      </div>
                    </article>

                    <article className={styles.bookCard}>
                      <div className={styles.bookHeader}>
                        <h3>NO</h3>
                        <span className={styles.countPill}>Best bid {centsLabel(bestPrice(detail.orderbook.no.buy))} · Best ask {centsLabel(bestPrice(detail.orderbook.no.sell))}</span>
                      </div>
                      <div className={styles.bookColumns}>
                        <OrderBookColumn title="Bids" levels={detail.orderbook.no.buy} tone="buy" />
                        <OrderBookColumn title="Asks" levels={detail.orderbook.no.sell} tone="sell" />
                      </div>
                    </article>
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2 className={styles.panelTitle}>Trade tape</h2>
                      <p className={styles.panelCopy}>Recent secondary, mint, and redeem fills for the selected market.</p>
                    </div>
                  </div>
                  <TradeList trades={detail.trades} />
                </section>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
