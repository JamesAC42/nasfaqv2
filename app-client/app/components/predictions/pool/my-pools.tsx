"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { InTheRed } from "@/app/components/predictions/pool/bet-slip";
import { Countdown } from "@/app/components/predictions/floor/market-card";
import { money } from "@/app/lib/predictions/format";
import { fetchMyPools, poolHref, type MyPools } from "@/app/lib/predictions/pools";
import { usePoolAccess } from "@/app/lib/predictions/use-pool-access";
import { usePredictionFeed } from "@/app/lib/predictions/use-prediction-feed";
import styles from "@/app/components/predictions/pool/pool.module.scss";

const MARGIN_REASON: Record<string, string> = {
  margin_account_too_new: "Margin opens once your account is 7 days old.",
  email_verification_required: "Verify your email to use margin.",
  account_suspended: "Margin is off while your account is suspended.",
  no_shares: "Margin is backed by shares: hold some to get a line.",
};

/** "My bets" for pools: stakes in pools still running, results, and margin. */
export function MyPoolsSection() {
  const access = usePoolAccess();
  const [data, setData] = useState<MyPools | null>(null);

  const load = useCallback(() => {
    fetchMyPools()
      .then(setData)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (access.visible) load();
  }, [access.visible, load]);
  usePredictionFeed(
    (message) => {
      if (message.type === "prediction.market.updated" && data?.open.some((row) => row.market_id === message.market_id)) load();
    },
    load,
  );

  if (!access.visible || !data) return null;
  const { margin } = data;
  return (
    <section className={styles.section} aria-labelledby="pools-head">
      <div className={styles.sectionHead}>
        <h2 id="pools-head">Pools</h2>
        <span className={styles.hint}>
          {money(data.totals.staked_open, 0)} in open pools · {data.totals.net_settled >= 0 ? "+" : ""}
          {money(data.totals.net_settled, 0)} on finished ones · <Link href="/predictions/history?mine=1">history</Link>
        </span>
      </div>
      {margin.in_red ? (
        <InTheRed margin={margin} />
      ) : (
        <p className={styles.small}>
          {margin.available > 0
            ? `Margin line: ${money(margin.line, 0)} (${Math.round(margin.line_share * 100)}% of your ${money(margin.share_value, 0)} in shares, up to ${money(margin.line_max, 0)}). A pool bet can borrow up to that once your Credit and Cash run out.`
            : (MARGIN_REASON[margin.reason ?? ""] ?? "No margin line right now.")}
        </p>
      )}
      {data.new_account ? (
        <p className={styles.small}>
          New accounts: {money(data.new_account.staked, 0)} of {money(data.new_account.cap, 0)} in open pools for your first 7 days.
        </p>
      ) : null}
      {data.open.length ? (
        <ul className={styles.list}>
          {data.open.map((row) => (
            <li key={`${row.market_id}:${row.outcome_id}`} className={styles.row}>
              <Link href={poolHref(row.slug)}>{row.title}</Link>
              <span className={styles.rowRight}>{money(row.stake, 0)}</span>
              <div className={styles.rowMeta}>
                <span>
                  On <b>{row.outcome_label}</b>
                </span>
                {row.payout_if_wins !== null ? <span>Pays {money(row.payout_if_wins, 0)} if it wins now</span> : null}
                {row.borrowed > 0 ? <span>{money(row.borrowed, 0)} on margin</span> : null}
                {row.status === "open" ? (
                  <span>
                    closes in <Countdown to={row.closes_at} />
                  </span>
                ) : (
                  <span>Waiting for the call</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.small}>
          No open pool bets. <Link href="/predictions">Find a pool</Link>
        </p>
      )}
      {data.settled.length ? (
        <ul className={styles.list}>
          {data.settled.slice(0, 8).map((row) => {
            const net = (row.payout ?? 0) - row.stake;
            return (
              <li key={`${row.market_id}:${row.outcome_id}`} className={styles.row}>
                <Link href={poolHref(row.slug)}>{row.title}</Link>
                <span className={styles.net} data-tone={net > 0 ? "up" : net < 0 ? "down" : undefined}>
                  {net > 0 ? "+" : ""}
                  {money(net, 0)}
                </span>
                <div className={styles.rowMeta}>
                  <span>
                    {row.status === "voided" ? "Voided, money back" : row.won ? "Won" : row.payout && row.payout >= row.stake ? "Refunded" : "Lost"} on <b>{row.outcome_label}</b>
                  </span>
                  <span>Staked {money(row.stake, 0)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
