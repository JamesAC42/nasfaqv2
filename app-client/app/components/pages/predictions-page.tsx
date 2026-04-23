"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FaArrowTrendUp, FaClock, FaScaleBalanced, FaShieldHalved } from "react-icons/fa6";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import {
  normalizePredictionCandlesResponse,
  normalizePredictionMarketDetailResponse,
  normalizePredictionMarketListResponse,
  normalizePredictionOpenOrdersResponse,
  normalizePredictionOrderBookResponse,
  normalizePredictionTradeResponse,
} from "@/app/lib/normalizers";
import type {
  PredictionCandlePoint,
  PredictionMarket,
  PredictionMarketScope,
  PredictionOpenOrder,
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
  openOrders: PredictionOpenOrder[];
};

type CreateFormState = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  rules_text: string;
  resolution_source_text: string;
  visibility: "public" | "private" | "unlisted";
  opens_at: string;
  closes_at: string;
  resolves_after: string;
};

type OrderFormState = {
  outcome: "yes" | "no";
  side: "buy" | "sell";
  price: string;
  quantity: string;
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
] as const;

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

function bestPrice(levels: Array<{ price: number; quantity: number }>) {
  return levels[0]?.price ?? null;
}

function spreadLabel(bestBid: number | null, bestAsk: number | null) {
  if (bestBid === null || bestAsk === null) return "—";
  return centsLabel(bestAsk - bestBid);
}

function buildMarketHref(slug: string) {
  const params = new URLSearchParams();
  params.set("market", slug);
  return `/predictions?${params.toString()}`;
}

function datetimeLocalFromDate(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function createDefaultFormState(): CreateFormState {
  const now = new Date();
  const opensAt = new Date(now.getTime() + 15 * 60 * 1000);
  const closesAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const resolvesAfter = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  return {
    slug: "",
    title: "",
    subtitle: "",
    description: "",
    rules_text: "",
    resolution_source_text: "",
    visibility: "public",
    opens_at: datetimeLocalFromDate(opensAt),
    closes_at: datetimeLocalFromDate(closesAt),
    resolves_after: datetimeLocalFromDate(resolvesAfter),
  };
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
          <div key={`${tone}-${level.price}-${level.quantity}`} className={styles.bookRow}>
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

function OpenOrdersList({
  orders,
  onCancel,
  busyOrderId,
  actionsDisabled = false,
}: {
  orders: PredictionOpenOrder[];
  onCancel: (orderId: number) => Promise<void>;
  busyOrderId: number | null;
  actionsDisabled?: boolean;
}) {
  return (
    <div className={styles.tradeList}>
      {orders.length ? orders.map((order) => (
        <article key={order.id} className={styles.tradeRow}>
          <div className={styles.tradeTop}>
            <div>
              <strong>{order.outcome_label} · {order.side.toUpperCase()}</strong>
              <div className={styles.tradeMeta}>Placed {fmtDate(order.created_at)}</div>
            </div>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void onCancel(order.id)}
              disabled={actionsDisabled || busyOrderId === order.id}
            >
              {busyOrderId === order.id ? "Cancelling…" : "Cancel"}
            </button>
          </div>
          <div className={styles.tradeGrid}>
            <div>
              <span>Limit</span>
              <strong>{centsLabel(order.price)}</strong>
            </div>
            <div>
              <span>Open</span>
              <strong>{fmtInteger(order.open_quantity)} sh</strong>
            </div>
            <div>
              <span>Filled</span>
              <strong>{fmtInteger(order.matched_quantity)} sh</strong>
            </div>
            <div>
              <span>Cash reserved</span>
              <strong>{fmtNumber(order.cash_reserved, "$")}</strong>
            </div>
          </div>
        </article>
      )) : <div className={styles.empty}>No open orders for this market.</div>}
    </div>
  );
}

export function PredictionsPage() {
  const { user } = useAuth();
  const router = useRouter();
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
  const [reloadToken, setReloadToken] = useState(0);
  const [createForm, setCreateForm] = useState<CreateFormState>(() => createDefaultFormState());
  const [createBusy, setCreateBusy] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [orderForm, setOrderForm] = useState<OrderFormState>({ outcome: "yes", side: "buy", price: "0.55", quantity: "10" });
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderMessage, setOrderMessage] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [actionBusy, setActionBusy] = useState<"submit" | "approve" | "reject" | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelBusyOrderId, setCancelBusyOrderId] = useState<number | null>(null);

  const canShowMine = Boolean(user);
  const canShowReviewQueue = Boolean(user?.is_admin || user?.can_approve_prediction_markets);
  const canCreateMarket = Boolean(user?.is_admin || user?.can_create_prediction_markets);

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
  }, [reloadToken, scope, statusFilter]);

  const selectedSlug = selectedSlugParam || markets[0]?.slug || null;

  useEffect(() => {
    if (!selectedSlug) {
      setDetail(null);
      setDetailError(null);
      setIsLoadingDetail(false);
      return;
    }

    const slug = selectedSlug;
    let cancelled = false;
    setIsLoadingDetail(true);
    setDetailError(null);

    async function loadDetail() {
      try {
        const requests: Array<Promise<Record<string, unknown>>> = [
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}`, { cache: "no-store" }),
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/orderbook`, { cache: "no-store" }),
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/trades?limit=12`, { cache: "no-store" }),
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/candles?interval=1h&outcome=yes&limit=120`, { cache: "no-store" }),
          apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/candles?interval=1h&outcome=no&limit=120`, { cache: "no-store" }),
        ];

        if (user) {
          requests.push(apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(slug)}/orders/mine`, { cache: "no-store" }));
        }

        const results = await Promise.all(requests);
        if (cancelled) return;

        const market = normalizePredictionMarketDetailResponse(results[0]).market;
        const orderbook = normalizePredictionOrderBookResponse(results[1]).orderbook;
        const trades = normalizePredictionTradeResponse(results[2]).trades;
        const yesCandles = normalizePredictionCandlesResponse(results[3]).candles;
        const noCandles = normalizePredictionCandlesResponse(results[4]).candles;
        const openOrders = user && results[5] ? normalizePredictionOpenOrdersResponse(results[5]).orders : [];

        setDetail({ market, orderbook, trades, yesCandles, noCandles, openOrders });
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
  }, [reloadToken, selectedSlug, user]);

  const probabilitySeries = useMemo(() => {
    if (!detail) return [];
    return [
      {
        name: "Yes",
        color: "#10b981",
        kind: "area" as const,
        values: detail.yesCandles.map((candle) => ({ time: candle.bucket, value: candle.close })),
      },
      {
        name: "No",
        color: "#ef4444",
        kind: "line" as const,
        values: detail.noCandles.map((candle) => ({ time: candle.bucket, value: candle.close })),
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

  async function refreshAll() {
    setReloadToken((current) => current + 1);
  }

  async function handleCreateMarket(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (userNeedsEmailVerification(user)) {
      setCreateError("Verify your email before you can create prediction markets.");
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    setCreateMessage(null);
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/prediction-markets", {
        method: "POST",
        body: JSON.stringify({
          ...createForm,
          opens_at: new Date(createForm.opens_at).toISOString(),
          closes_at: new Date(createForm.closes_at).toISOString(),
          resolves_after: createForm.resolves_after ? new Date(createForm.resolves_after).toISOString() : null,
        }),
      });
      const market = normalizePredictionMarketDetailResponse(result).market;
      setCreateMessage(`Draft created: ${market.slug}`);
      setCreateForm(createDefaultFormState());
      if (scope !== "mine" && canShowMine) setScope("mine");
      router.push(buildMarketHref(market.slug));
      await refreshAll();
    } catch (error) {
      setCreateError(String((error as Error).message || error));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleLifecycleAction(kind: "submit" | "approve" | "reject") {
    if (!detail) return;
    if (kind === "submit" && userNeedsEmailVerification(user)) {
      setActionError("Verify your email before you can submit prediction markets for approval.");
      return;
    }
    setActionBusy(kind);
    setActionError(null);
    setActionMessage(null);
    try {
      let path = "";
      let body: Record<string, unknown> | undefined;
      if (kind === "submit") path = `/api/prediction-markets/${detail.market.id}/submit`;
      if (kind === "approve") path = `/api/prediction-markets/${detail.market.id}/approve`;
      if (kind === "reject") {
        path = `/api/prediction-markets/${detail.market.id}/reject`;
        body = { reason: reviewReason };
      }
      await apiFetch<Record<string, unknown>>(path, {
        method: "POST",
        body: JSON.stringify(body || {}),
      });
      setActionMessage(kind === "submit" ? "Market submitted for approval." : kind === "approve" ? "Market approved." : "Market rejected.");
      if (kind === "reject") setReviewReason("");
      await refreshAll();
    } catch (error) {
      setActionError(String((error as Error).message || error));
    } finally {
      setActionBusy(null);
    }
  }

  async function handlePlaceOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    if (userNeedsEmailVerification(user)) {
      setOrderError("Verify your email before you can trade prediction markets.");
      return;
    }
    setOrderBusy(true);
    setOrderError(null);
    setOrderMessage(null);
    try {
      const result = await apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(detail.market.slug)}/orders`, {
        method: "POST",
        body: JSON.stringify({
          outcome: orderForm.outcome,
          side: orderForm.side,
          price: Number(orderForm.price),
          quantity: Number(orderForm.quantity),
        }),
      });
      const orderId = Number((result as Record<string, unknown>).order_id || 0);
      setOrderMessage(orderId ? `Order placed: #${orderId}` : "Order placed.");
      await refreshAll();
    } catch (error) {
      setOrderError(String((error as Error).message || error));
    } finally {
      setOrderBusy(false);
    }
  }

  async function handleCancelOrder(orderId: number) {
    if (!detail) return;
    if (userNeedsEmailVerification(user)) {
      setOrderError("Verify your email before you can cancel prediction market orders.");
      return;
    }
    setCancelBusyOrderId(orderId);
    setOrderError(null);
    setOrderMessage(null);
    try {
      const result = await apiFetch<Record<string, unknown>>(`/api/prediction-markets/${encodeURIComponent(detail.market.slug)}/orders/${orderId}`, {
        method: "DELETE",
      });
      const refundedCash = Number((result as Record<string, unknown>).refunded_cash || 0);
      setOrderMessage(`Order cancelled. Refunded ${fmtNumber(refundedCash, "$")}.`);
      await refreshAll();
    } catch (error) {
      setOrderError(String((error as Error).message || error));
    } finally {
      setCancelBusyOrderId(null);
    }
  }

  const canSubmit = Boolean(detail?.market.viewer_permissions?.can_submit_for_approval);
  const canApprove = Boolean(detail?.market.viewer_permissions?.can_approve);
  const needsVerification = userNeedsEmailVerification(user);
  const canTrade = Boolean(user && !needsVerification && detail?.market.status === "open" && detail.market.trading_status === "open");

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <div className={styles.heroTop}>
            <div>
              <div className={styles.eyebrow}>Community Prediction Markets</div>
              <h1 className={styles.title}>Binary event markets with creator controls, reviewer actions, and live YES/NO books.</h1>
              <p className={styles.copy}>
                This slice adds the first interactive workflow: privileged users can draft markets, submit them into review,
                approvers can approve or reject, and traders can place and cancel resting limit orders directly from the market page.
              </p>
            </div>
            <div className={styles.heroActions}>
              <div className={styles.heroPill}><FaShieldHalved /> {canCreateMarket ? "Creator access enabled" : "Read-only access"}</div>
              <div className={styles.heroPill}><FaScaleBalanced /> {canShowReviewQueue ? "Approval actions unlocked" : "Public market view"}</div>
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

        {canCreateMarket ? (
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>Create market</h2>
                <p className={styles.panelCopy}>Privileged users can draft new binary contracts here. Drafts can then be submitted into the review queue.</p>
              </div>
            </div>
            {createError ? <div className="statusMessage statusMessageError">{createError}</div> : null}
            {createMessage ? <div className="statusMessage statusMessageSuccess">{createMessage}</div> : null}
            {needsVerification ? <VerificationRequiredNotice action="create prediction markets" /> : null}
            <form className={styles.formGrid} onSubmit={handleCreateMarket}>
              <label className={styles.field}>
                <span>Title</span>
                <input className={styles.input} value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} required />
              </label>
              <label className={styles.field}>
                <span>Slug</span>
                <input className={styles.input} value={createForm.slug} onChange={(event) => setCreateForm((current) => ({ ...current, slug: event.target.value }))} placeholder="optional-auto-from-title" />
              </label>
              <label className={styles.field}>
                <span>Subtitle</span>
                <input className={styles.input} value={createForm.subtitle} onChange={(event) => setCreateForm((current) => ({ ...current, subtitle: event.target.value }))} />
              </label>
              <label className={styles.field}>
                <span>Visibility</span>
                <select className={styles.select} value={createForm.visibility} onChange={(event) => setCreateForm((current) => ({ ...current, visibility: event.target.value as CreateFormState["visibility"] }))}>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                </select>
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>Description</span>
                <textarea className={styles.textarea} value={createForm.description} onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))} rows={3} />
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>Rules</span>
                <textarea className={styles.textarea} value={createForm.rules_text} onChange={(event) => setCreateForm((current) => ({ ...current, rules_text: event.target.value }))} rows={4} required />
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span>Resolution source</span>
                <textarea className={styles.textarea} value={createForm.resolution_source_text} onChange={(event) => setCreateForm((current) => ({ ...current, resolution_source_text: event.target.value }))} rows={3} required />
              </label>
              <label className={styles.field}>
                <span>Opens at</span>
                <input className={styles.input} type="datetime-local" value={createForm.opens_at} onChange={(event) => setCreateForm((current) => ({ ...current, opens_at: event.target.value }))} required />
              </label>
              <label className={styles.field}>
                <span>Closes at</span>
                <input className={styles.input} type="datetime-local" value={createForm.closes_at} onChange={(event) => setCreateForm((current) => ({ ...current, closes_at: event.target.value }))} required />
              </label>
              <label className={styles.field}>
                <span>Resolves after</span>
                <input className={styles.input} type="datetime-local" value={createForm.resolves_after} onChange={(event) => setCreateForm((current) => ({ ...current, resolves_after: event.target.value }))} required />
              </label>
              <div className={styles.formActions}>
                <button type="submit" className={styles.primaryButton} disabled={createBusy || needsVerification}>
                  {createBusy ? "Creating…" : "Create draft market"}
                </button>
              </div>
            </form>
          </section>
        ) : null}

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
                <div className={styles.empty}>Select a market to inspect probability history, depth, open orders, and recent trades.</div>
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

                    {(canSubmit || canApprove) ? (
                      <div className={styles.actionRail}>
                        {actionError ? <div className="statusMessage statusMessageError">{actionError}</div> : null}
                        {actionMessage ? <div className="statusMessage statusMessageSuccess">{actionMessage}</div> : null}
                        <div className={styles.actionButtons}>
                          {canSubmit ? (
                            <button type="button" className={styles.primaryButton} disabled={actionBusy !== null || needsVerification} onClick={() => void handleLifecycleAction("submit")}>
                              {actionBusy === "submit" ? "Submitting…" : "Submit for approval"}
                            </button>
                          ) : null}
                          {canApprove ? (
                            <>
                              <button type="button" className={styles.primaryButton} disabled={actionBusy !== null} onClick={() => void handleLifecycleAction("approve")}>
                                {actionBusy === "approve" ? "Approving…" : "Approve market"}
                              </button>
                              <input
                                className={styles.inlineInput}
                                value={reviewReason}
                                onChange={(event) => setReviewReason(event.target.value)}
                                placeholder="Optional rejection reason"
                              />
                              <button type="button" className={styles.secondaryButton} disabled={actionBusy !== null} onClick={() => void handleLifecycleAction("reject")}>
                                {actionBusy === "reject" ? "Rejecting…" : "Reject"}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
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

                {user ? (
                  <section className={styles.panel}>
                    <div className={styles.panelHead}>
                      <div>
                        <h2 className={styles.panelTitle}>Trade</h2>
                        <p className={styles.panelCopy}>Place a resting limit order against the canonical YES/NO book.</p>
                      </div>
                    </div>
                    {orderError ? <div className="statusMessage statusMessageError">{orderError}</div> : null}
                    {orderMessage ? <div className="statusMessage statusMessageSuccess">{orderMessage}</div> : null}
                    {needsVerification ? <VerificationRequiredNotice action="trade prediction markets" /> : null}
                    <form className={styles.tradeForm} onSubmit={handlePlaceOrder}>
                      <label className={styles.field}>
                        <span>Outcome</span>
                        <select className={styles.select} value={orderForm.outcome} onChange={(event) => setOrderForm((current) => ({ ...current, outcome: event.target.value as OrderFormState["outcome"] }))}>
                          <option value="yes">YES</option>
                          <option value="no">NO</option>
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span>Side</span>
                        <select className={styles.select} value={orderForm.side} onChange={(event) => setOrderForm((current) => ({ ...current, side: event.target.value as OrderFormState["side"] }))}>
                          <option value="buy">Buy</option>
                          <option value="sell">Sell</option>
                        </select>
                      </label>
                      <label className={styles.field}>
                        <span>Price</span>
                        <input className={styles.input} type="number" min="0.01" max="0.99" step="0.01" value={orderForm.price} onChange={(event) => setOrderForm((current) => ({ ...current, price: event.target.value }))} required />
                      </label>
                      <label className={styles.field}>
                        <span>Quantity</span>
                        <input className={styles.input} type="number" min="1" step="1" value={orderForm.quantity} onChange={(event) => setOrderForm((current) => ({ ...current, quantity: event.target.value }))} required />
                      </label>
                      <div className={styles.formActions}>
                        <button type="submit" className={styles.primaryButton} disabled={orderBusy || !canTrade}>
                          {orderBusy ? "Placing…" : canTrade ? "Place order" : "Trading unavailable"}
                        </button>
                      </div>
                    </form>
                  </section>
                ) : null}

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

                {user ? (
                  <section className={styles.panel}>
                    <div className={styles.panelHead}>
                      <div>
                        <h2 className={styles.panelTitle}>My open orders</h2>
                        <p className={styles.panelCopy}>Resting orders you can currently cancel from this market.</p>
                      </div>
                    </div>
                    <OpenOrdersList orders={detail.openOrders} onCancel={handleCancelOrder} busyOrderId={cancelBusyOrderId} actionsDisabled={needsVerification} />
                  </section>
                ) : null}

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
