"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { PredictionsFrame, usePredictionCash } from "@/app/components/predictions/shell/predictions-frame";
import { cancelLimitOrder, fetchMarket, fetchPortfolio } from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { cents, money, outcomeColor, shares as fmtShares, STATUS_LABEL, timeAgo, timeLeft } from "@/app/lib/predictions/format";
import type { Fill, LimitOrder, Outcome, Portfolio, PortfolioPosition, SocketMessage } from "@/app/lib/predictions/types";
import { usePredictionFeed } from "@/app/lib/predictions/use-prediction-feed";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import { SceneArt } from "@/app/components/common/scene-art";
import styles from "@/app/components/predictions/portfolio/portfolio.module.scss";

type Flash = { dir: "up" | "down"; n: number };
type OutcomeLook = { color: string; asset: Outcome["asset"] };

const LIVE = new Set(["open", "closed", "resolving", "proposed", "disputed"]);
const lookKey = (marketId: number, code: string) => `${marketId}:${code}`;

/** Binary colours are fixed; multi outcomes need the market's outcomes (talent colours), fetched once. */
/** Looks straight from the portfolio rows (they carry market type and talent). */
function rowLooks(portfolio: Portfolio | null) {
  const map = new Map<string, OutcomeLook>();
  for (const row of portfolio ? [...portfolio.positions, ...portfolio.settled] : []) {
    if (/^(yes|no)$/.test(row.outcome_code) || !row.market_type) continue;
    const index = Number(row.outcome_code.replace(/^o/, "")) - 1;
    const asset = row.asset ?? null;
    map.set(lookKey(row.market_id, row.outcome_code), { color: outcomeColor({ market_type: row.market_type }, { outcome_code: row.outcome_code, asset, sort_order: Number.isFinite(index) ? index : 0 }), asset });
  }
  return map;
}

function fallbackLook(code: string): OutcomeLook {
  if (code === "yes" || code === "no") return { color: outcomeColor({ market_type: "binary" }, { outcome_code: code, asset: null, sort_order: 0 }), asset: null };
  const index = Number(code.replace(/^o/, "")) - 1;
  return { color: outcomeColor({ market_type: "multi" }, { outcome_code: code, asset: null, sort_order: Number.isFinite(index) ? index : 0 }), asset: null };
}

const pnlTone = (value: number) => (value > 0.004 ? styles.up : value < -0.004 ? styles.down : styles.flat);
const signedMoney = (value: number) => `${value > 0.004 ? "+" : ""}${money(value)}`;
const pnlPct = (pnl: number, cost: number) => (cost > 0.01 ? `${pnl >= 0 ? "+" : "−"}${Math.abs((pnl / cost) * 100).toFixed(Math.abs(pnl / cost) < 0.1 ? 1 : 0)}%` : "");

/** Moves positions to the prices in a live fill. */
function applyFill(portfolio: Portfolio, fill: Fill): Portfolio {
  const next = new Map(fill.prices.map((row) => [String(row.outcome_id), row.price]));
  let touched = false;
  const positions = portfolio.positions.map((row) => {
    const price = next.get(String(row.outcome_id));
    if (price === undefined || String(row.market_id) !== String(fill.market_id)) return row;
    touched = true;
    const value = Math.round(row.shares * price * 100) / 100;
    return { ...row, price, value, unrealized_pnl: Math.round(row.shares * (price - row.avg_price) * 100) / 100 };
  });
  if (!touched) return portfolio;
  return {
    ...portfolio,
    positions,
    totals: {
      ...portfolio.totals,
      value: positions.reduce((sum, row) => sum + row.value, 0),
      unrealized_pnl: positions.reduce((sum, row) => sum + row.unrealized_pnl, 0),
    },
  };
}

// ── Pieces ─────────────────────────────────────────────────────────────────
function OutcomeChip({ label, look }: { label: string; look: OutcomeLook }) {
  return (
    <span className={styles.outcome} style={{ "--oc": look.color } as CSSProperties}>
      {look.asset ? <Oshimark icon={look.asset.icon} symbol={look.asset.symbol} size={14} /> : <i aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}

function Left({ row }: { row: Pick<PortfolioPosition, "status" | "closes_at"> }) {
  const now = useNow();
  if (row.status !== "open") {
    return (
      <span className={styles.state} data-tone={row.status === "disputed" ? "warn" : row.status === "proposed" ? "blue" : undefined}>
        {STATUS_LABEL[row.status] ?? row.status}
      </span>
    );
  }
  const ms = now === null ? Infinity : new Date(row.closes_at).getTime() - now;
  return (
    <span className={styles.left} data-soon={(ms > 0 && ms < 3_600_000) || undefined} suppressHydrationWarning>
      {now === null ? "…" : timeLeft(row.closes_at, now)}
    </span>
  );
}

function SignInPrompt() {
  return (
    <div className={styles.signIn}>
      <p>
        <Link href="/login">Sign in</Link> or <Link href="/register">make an account</Link> to see your bets. Every account starts with cash to play with.
      </p>
      <Link href="/predictions" className={styles.floorLink}>
        Browse the floor →
      </Link>
    </div>
  );
}

function Totals({ portfolio }: { portfolio: Portfolio }) {
  const { totals } = portfolio;
  const cost = portfolio.positions.reduce((sum, row) => sum + row.cost, 0);
  return (
    <dl className={styles.totals}>
      <div>
        <dt>Value</dt>
        <dd>{money(totals.value)}</dd>
        <small>at current prices</small>
      </div>
      <div>
        <dt>Open P&amp;L</dt>
        <dd className={pnlTone(totals.unrealized_pnl)}>{signedMoney(totals.unrealized_pnl)}</dd>
        <small className={pnlTone(totals.unrealized_pnl)}>{pnlPct(totals.unrealized_pnl, cost) || "—"}</small>
      </div>
      <div>
        <dt>Realized P&amp;L</dt>
        <dd className={pnlTone(totals.realized_pnl)}>{signedMoney(totals.realized_pnl)}</dd>
        <small>all time</small>
      </div>
      <div>
        <dt>Cash in orders</dt>
        <dd>{money(totals.in_orders_cash)}</dd>
        <small>
          {portfolio.orders.length} resting {portfolio.orders.length === 1 ? "order" : "orders"}
        </small>
      </div>
    </dl>
  );
}

function Positions({ rows, looks, flashes }: { rows: PortfolioPosition[]; looks: Map<string, OutcomeLook>; flashes: Record<string, Flash> }) {
  if (!rows.length) {
    return (
      <div className={`${styles.empty} ${styles.emptyArt}`}>
        <SceneArt slot="predictions-portfolio-empty" width={200} className={styles.emptyPic} />
        <p>
          No open bets. <Link href="/predictions">Hit the floor</Link> and make a call.
        </p>
      </div>
    );
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Market</th>
          <th scope="col">Outcome</th>
          <th scope="col" className={styles.r}>
            Shares
          </th>
          <th scope="col" className={styles.r}>
            Avg
          </th>
          <th scope="col" className={styles.r}>
            Now
          </th>
          <th scope="col" className={styles.r}>
            Value
          </th>
          <th scope="col" className={styles.r}>
            P&amp;L
          </th>
          <th scope="col" className={styles.r}>
            Closes
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const look = looks.get(lookKey(row.market_id, row.outcome_code)) ?? fallbackLook(row.outcome_code);
          const flash = flashes[String(row.outcome_id)];
          return (
            <tr key={`${row.market_id}-${row.outcome_id}`}>
              <td className={styles.market} data-label="Market">
                <Link href={`/predictions/${encodeURIComponent(row.slug)}?outcome=${encodeURIComponent(row.outcome_code)}`}>{row.title}</Link>
                {row.kind === "auto" ? <span className={styles.auto}>Auto</span> : null}
              </td>
              <td data-label="Outcome">
                <OutcomeChip label={row.outcome_label} look={look} />
              </td>
              <td className={styles.r} data-label="Shares">
                {fmtShares(row.shares)}
                {row.shares_in_orders > 0.000001 ? <small className={styles.sub}>{fmtShares(row.shares_in_orders)} in orders</small> : null}
              </td>
              <td className={styles.r} data-label="Avg">
                {cents(row.avg_price)}
              </td>
              <td className={styles.r} data-label="Now">
                <span key={flash ? flash.n : 0} className={`${styles.price} ${flash ? (flash.dir === "up" ? styles.flashUp : styles.flashDown) : ""}`}>
                  {cents(row.price)}
                </span>
              </td>
              <td className={`${styles.r} ${styles.strong}`} data-label="Value">
                {money(row.value)}
              </td>
              <td className={`${styles.r} ${pnlTone(row.unrealized_pnl)}`} data-label="P&L">
                {signedMoney(row.unrealized_pnl)}
                <small className={styles.sub}>{pnlPct(row.unrealized_pnl, row.cost)}</small>
              </td>
              <td className={styles.r} data-label="Closes">
                <Left row={row} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Orders({ rows, looks, onCancelled }: { rows: LimitOrder[]; looks: Map<string, OutcomeLook>; onCancelled: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const now = useNow();

  const cancel = async (order: LimitOrder) => {
    if (!order.slug || busy !== null) return;
    setBusy(order.id);
    setErrors((current) => ({ ...current, [order.id]: "" }));
    try {
      await cancelLimitOrder(order.slug, order.id);
      onCancelled();
    } catch (error) {
      setErrors((current) => ({ ...current, [order.id]: predictionErrorText(error) }));
    } finally {
      setBusy(null);
    }
  };

  if (!rows.length) return <p className={styles.empty}>No resting orders. Set a limit on any market’s ticket and it waits here.</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Market</th>
          <th scope="col">Order</th>
          <th scope="col" className={styles.r}>
            Limit
          </th>
          <th scope="col" className={styles.r}>
            Size
          </th>
          <th scope="col" className={styles.r}>
            Filled
          </th>
          <th scope="col" className={styles.r}>
            Placed
          </th>
          <th scope="col" className={styles.r}>
            <span className={styles.hidden}>Cancel</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((order) => {
          const look = looks.get(lookKey(order.market_id, order.outcome_code ?? "")) ?? fallbackLook(order.outcome_code ?? "");
          const size = order.side === "buy" ? money(order.cash_budget) : `${fmtShares(order.shares_total)} sh`;
          const filled = order.side === "buy" ? (order.spent_cash > 0 ? money(order.spent_cash) : "—") : order.filled_shares > 0 ? `${fmtShares(order.filled_shares)} sh` : "—";
          return (
            <tr key={order.id}>
              <td className={styles.market} data-label="Market">
                {order.slug ? <Link href={`/predictions/${encodeURIComponent(order.slug)}`}>{order.title}</Link> : order.title}
              </td>
              <td data-label="Order">
                <span className={styles.side} data-side={order.side}>
                  {order.side === "buy" ? "Buy" : "Sell"}
                </span>{" "}
                <OutcomeChip label={order.outcome_label ?? order.outcome_code ?? ""} look={look} />
              </td>
              <td className={styles.r} data-label="Limit">
                {order.side === "buy" ? "≤ " : "≥ "}
                {cents(order.limit_price)}
              </td>
              <td className={styles.r} data-label="Size">
                {size}
              </td>
              <td className={styles.r} data-label="Filled">
                {filled}
              </td>
              <td className={styles.r} data-label="Placed" suppressHydrationWarning>
                {now === null ? "" : `${timeAgo(order.created_at, now)} ago`}
              </td>
              <td className={`${styles.r} ${styles.action}`}>
                <button type="button" className={styles.cancel} onClick={() => void cancel(order)} disabled={busy !== null} aria-label={`Cancel ${order.side} ${order.outcome_label} limit at ${cents(order.limit_price)} on ${order.title}`}>
                  {busy === order.id ? "Cancelling…" : "Cancel"}
                </button>
                {errors[order.id] ? (
                  <small className={styles.rowError} role="alert">
                    {errors[order.id]}
                  </small>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Settled({ rows, looks }: { rows: PortfolioPosition[]; looks: Map<string, OutcomeLook> }) {
  const now = useNow();
  if (!rows.length) return <p className={styles.empty}>Nothing settled yet. Your first call is coming.</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Market</th>
          <th scope="col">Your side</th>
          <th scope="col">Result</th>
          <th scope="col" className={styles.r}>
            Realized
          </th>
          <th scope="col" className={styles.r}>
            Settled
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const look = looks.get(lookKey(row.market_id, row.outcome_code)) ?? fallbackLook(row.outcome_code);
          const result = row.status === "voided" ? "voided" : row.won ? "won" : "lost";
          return (
            <tr key={`${row.market_id}-${row.outcome_id}`}>
              <td className={styles.market} data-label="Market">
                <Link href={`/predictions/${encodeURIComponent(row.slug)}`}>{row.title}</Link>
              </td>
              <td data-label="Your side">
                <OutcomeChip label={row.outcome_label} look={look} />
              </td>
              <td data-label="Result">
                <span className={styles.result} data-result={result}>
                  {result === "voided" ? "Voided · refunded" : result === "won" ? "Won" : "Lost"}
                </span>
              </td>
              <td className={`${styles.r} ${styles.strong} ${pnlTone(row.realized_pnl)}`} data-label="Realized">
                {signedMoney(row.realized_pnl)}
              </td>
              <td className={styles.r} data-label="Settled" suppressHydrationWarning>
                {row.settled_at && now !== null ? `${timeAgo(row.settled_at, now)} ago` : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export function PredictionsPortfolio() {
  const { user, initialized } = useAuth();
  const { refreshCash } = usePredictionCash();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looks, setLooks] = useState<Map<string, OutcomeLook>>(new Map());
  const [flashes, setFlashes] = useState<Record<string, Flash>>({});
  const fetched = useRef(new Set<string>());
  const current = useRef<Portfolio | null>(null);
  const flashCounter = useRef(0);
  const username = user?.username ?? null;

  const load = useCallback(async () => {
    try {
      const result = await fetchPortfolio();
      current.current = result;
      setPortfolio(result);
      setError(null);
    } catch (err) {
      setError(predictionErrorText(err));
    }
  }, []);

  useEffect(() => {
    if (!username) return;
    let alive = true;
    fetchPortfolio()
      .then((result) => {
        if (!alive) return;
        current.current = result;
        setPortfolio(result);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(predictionErrorText(err));
      });
    return () => {
      alive = false;
    };
  }, [username]);

  // Talent colours and oshimarks for multi outcomes: one detail fetch per market, once.
  useEffect(() => {
    if (!portfolio) return;
    // Positions carry their outcome's talent; only markets you hold nothing but an order in need a lookup.
    const held = new Set([...portfolio.positions, ...portfolio.settled].filter((row) => row.market_type).map((row) => row.slug));
    const slugs = new Map<string, number>();
    for (const row of [...portfolio.positions, ...portfolio.settled]) if (!/^(yes|no)$/.test(row.outcome_code) && !held.has(row.slug)) slugs.set(row.slug, row.market_id);
    for (const order of portfolio.orders) if (order.slug && order.outcome_code && !/^(yes|no)$/.test(order.outcome_code) && !held.has(order.slug)) slugs.set(order.slug, order.market_id);
    const todo = [...slugs.keys()].filter((slug) => !fetched.current.has(slug)).slice(0, 16);
    if (!todo.length) return;
    todo.forEach((slug) => fetched.current.add(slug));
    void Promise.allSettled(todo.map((slug) => fetchMarket(slug))).then((results) => {
      setLooks((prev) => {
        const next = new Map(prev);
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          const market = result.value.market;
          for (const outcome of market.outcomes) next.set(lookKey(market.id, outcome.outcome_code), { color: outcomeColor(market, outcome), asset: outcome.asset });
        }
        return next;
      });
    });
  }, [portfolio]);

  // Live: prices move with every trade; your own fills and status changes refetch.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void load();
    }, 700);
  }, [load]);
  useEffect(() => () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
  }, []);

  usePredictionFeed((message: SocketMessage) => {
    const book = current.current;
    if (!book) return;
    const inBook = (id: number | null) =>
      id !== null && (book.positions.some((row) => String(row.market_id) === String(id)) || book.orders.some((row) => String(row.market_id) === String(id)));
    if (message.type === "prediction.market.updated") {
      if (inBook(message.market_id)) scheduleRefetch();
      return;
    }
    if (message.type !== "prediction.trade") return;
    const fill = message.trade;
    const mine = (username && fill.username === username) || (fill.limit_order_id !== null && book.orders.some((order) => String(order.id) === String(fill.limit_order_id)));
    if (mine) scheduleRefetch();
    if (!book.positions.some((row) => String(row.market_id) === String(fill.market_id))) return;
    const moved: Record<string, Flash> = {};
    for (const row of book.positions) {
      if (String(row.market_id) !== String(fill.market_id)) continue;
      const price = fill.prices.find((p) => String(p.outcome_id) === String(row.outcome_id))?.price;
      if (price === undefined || Math.round(price * 100) === Math.round(row.price * 100)) continue;
      moved[String(row.outcome_id)] = { dir: price > row.price ? "up" : "down", n: ++flashCounter.current };
    }
    const next = applyFill(book, fill);
    current.current = next;
    setPortfolio(next);
    if (Object.keys(moved).length) setFlashes((prev) => ({ ...prev, ...moved }));
  });

  const onCancelled = useCallback(() => {
    void load();
    void refreshCash();
  }, [load, refreshCash]);

  const allLooks = useMemo(() => new Map([...rowLooks(portfolio), ...looks]), [portfolio, looks]);
  const blurb = useMemo(() => {
    if (!portfolio) return undefined;
    const markets = new Set(portfolio.positions.map((row) => row.market_id)).size;
    if (!portfolio.positions.length) return "No open bets right now. The floor's waiting.";
    return (
      <>
        <b>{portfolio.positions.length}</b> open {portfolio.positions.length === 1 ? "bet" : "bets"} across <b>{markets}</b> {markets === 1 ? "market" : "markets"}. Prices move live.
      </>
    );
  }, [portfolio]);

  const open = portfolio?.positions.filter((row) => LIVE.has(row.status)) ?? [];

  return (
    <PredictionsFrame kicker="Portfolio" title="My bets" blurb={user ? blurb : undefined} live={Boolean(user && portfolio?.positions.length)}>
      {!initialized && !user ? (
        <p className={styles.loading}>Loading…</p>
      ) : !user ? (
        <SignInPrompt />
      ) : !portfolio ? (
        error ? (
          <p className={styles.error} role="alert">
            {error}{" "}
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </p>
        ) : (
          <div className={styles.skeleton} aria-busy="true" />
        )
      ) : (
        <div className={styles.page}>
          <Totals portfolio={portfolio} />
          <section className={styles.section} aria-labelledby="open-head">
            <header className={styles.head}>
              <h2 id="open-head">Open positions</h2>
              <span>{open.length}</span>
            </header>
            <Positions rows={open} looks={allLooks} flashes={flashes} />
          </section>
          <section className={styles.section} aria-labelledby="orders-head">
            <header className={styles.head}>
              <h2 id="orders-head">Resting orders</h2>
              <span>{portfolio.orders.length}</span>
            </header>
            <Orders rows={portfolio.orders} looks={allLooks} onCancelled={onCancelled} />
          </section>
          <section className={styles.section} aria-labelledby="settled-head">
            <header className={styles.head}>
              <h2 id="settled-head">Settled</h2>
              <span>{portfolio.settled.length}</span>
            </header>
            <Settled rows={portfolio.settled} looks={allLooks} />
          </section>
        </div>
      )}
    </PredictionsFrame>
  );
}
