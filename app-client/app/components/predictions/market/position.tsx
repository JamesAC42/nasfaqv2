"use client";

import { useState, type CSSProperties } from "react";
import { centsFine, signedMoney, tone } from "@/app/components/predictions/market/shared";
import { cancelLimitOrder } from "@/app/lib/predictions/api";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { cents, money, outcomeColor, shares as fmtShares, timeAgo } from "@/app/lib/predictions/format";
import type { LimitOrder, PredictionMarketDetail } from "@/app/lib/predictions/types";
import styles from "@/app/components/predictions/market/market.module.scss";

const DUST = 0.0001;

/** Your shares per outcome with live value and P&L, sell shortcuts, and your limit orders. */
export function YourPosition({ market, onSell, onChanged }: { market: PredictionMarketDetail; onSell: (code: string) => void; onChanged: () => void }) {
  const mine = market.mine;
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!mine) return null;

  const byCode = new Map(market.outcomes.map((outcome) => [outcome.outcome_code, outcome]));
  const held = mine.positions.filter((position) => position.shares > DUST);
  const openOrders = mine.orders.filter((order) => order.status === "open");
  const closedOrders = mine.orders.filter((order) => order.status !== "open").slice(0, 4);
  const settled = market.status === "resolved" || market.status === "voided";
  const realized = mine.positions.reduce((sum, position) => sum + position.realized_pnl, 0);
  const traded = mine.positions.length > 0;
  if (!held.length && !mine.orders.length && !(settled && traded)) return null;

  const totals = held.reduce(
    (acc, position) => {
      const price = byCode.get(position.outcome_code)?.price ?? 0;
      acc.value += position.shares * price;
      acc.cost += position.shares * position.avg_price;
      return acc;
    },
    { value: 0, cost: 0 },
  );
  const open = market.status === "open";

  const cancel = async (order: LimitOrder) => {
    setBusy(order.id);
    setError(null);
    try {
      await cancelLimitOrder(market.slug, order.id);
      onChanged();
    } catch (reason) {
      setError(predictionErrorText(reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="pos-h">
      <div className={styles.sectionHead}>
        <h2 id="pos-h">Your position</h2>
        {held.length ? (
          <span className={styles.headStat}>
            {money(totals.value)} <em data-tone={tone(totals.value - totals.cost, 0.005)}>{signedMoney(totals.value - totals.cost)}</em>
          </span>
        ) : null}
      </div>

      {settled && traded && !held.length ? (
        <p className={styles.result} data-tone={tone(realized, 0.005)}>
          <small>{market.status === "voided" ? "Refunded" : "Your result"}</small>
          <b>{signedMoney(realized)}</b>
        </p>
      ) : null}

      {held.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Outcome</th>
                <th>Shares</th>
                <th className={styles.wide}>Avg</th>
                <th className={styles.wide}>Now</th>
                <th>Value</th>
                <th>P&amp;L</th>
                {open ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {held.map((position) => {
                const outcome = byCode.get(position.outcome_code);
                const price = outcome?.price ?? 0;
                const value = position.shares * price;
                const pnl = value - position.shares * position.avg_price;
                const pct = position.avg_price > 0 ? (price / position.avg_price - 1) * 100 : 0;
                return (
                  <tr key={position.outcome_id}>
                    <td>
                      <span className={styles.chip} style={{ "--oc": outcome ? outcomeColor(market, outcome) : "var(--dim)" } as CSSProperties}>
                        {outcome?.label ?? position.outcome_code}
                      </span>
                    </td>
                    <td>{fmtShares(position.shares)}</td>
                    <td className={styles.wide}>{centsFine(position.avg_price)}</td>
                    <td className={styles.wide}>{cents(price)}</td>
                    <td>{money(value)}</td>
                    <td data-tone={tone(pnl, 0.005)}>
                      {signedMoney(pnl)} <small>{pct >= 0 ? "+" : ""}{pct.toFixed(0)}%</small>
                    </td>
                    {open ? (
                      <td>
                        <button type="button" className={styles.miniBtn} onClick={() => onSell(position.outcome_code)}>
                          Sell
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={styles.fine}>
            Pays {held.map((position) => `${money(position.shares)} if ${byCode.get(position.outcome_code)?.label ?? position.outcome_code}`).join(" · ")}
          </p>
        </div>
      ) : null}

      {mine.orders.length ? (
        <div className={styles.orders}>
          <h3>Limit orders</h3>
          <ul>
            {[...openOrders, ...closedOrders].map((order) => {
              const outcome = market.outcomes.find((entry) => entry.id === order.outcome_id || entry.outcome_code === order.outcome_code);
              const isOpen = order.status === "open";
              return (
                <li key={order.id} data-closed={!isOpen || undefined}>
                  <span className={styles.chip} style={{ "--oc": outcome ? outcomeColor(market, outcome) : "var(--dim)" } as CSSProperties}>
                    {order.side === "buy" ? "Buy" : "Sell"} {outcome?.label ?? order.outcome_code}
                  </span>
                  <span className={styles.orderPrice}>
                    {order.side === "buy" ? "≤" : "≥"} {cents(order.limit_price)}
                  </span>
                  <span className={styles.orderInfo}>
                    {order.side === "buy" ? (
                      <>
                        {money(order.cash_budget, 0)} budget · {fmtShares(order.filled_shares)} filled
                        {isOpen ? <> · {money(order.cash_reserved)} left</> : null}
                      </>
                    ) : (
                      <>
                        {fmtShares(order.filled_shares)}/{fmtShares(order.shares_total)} sold{order.received_cash > 0 ? <> · {money(order.received_cash)}</> : null}
                      </>
                    )}
                  </span>
                  {isOpen ? (
                    <button type="button" className={styles.miniBtn} disabled={busy === order.id} onClick={() => cancel(order)}>
                      {busy === order.id ? "…" : "Cancel"}
                    </button>
                  ) : (
                    <span className={styles.orderStatus}>
                      {order.status} {timeAgo(order.created_at)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {error ? (
            <p className={styles.errorLine} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
