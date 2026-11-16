"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { cents, money, timeAgo } from "@/app/lib/predictions/format";
import { poolHref } from "@/app/lib/predictions/pools";
import { usePredictionFeedConnected } from "@/app/lib/predictions/use-prediction-feed";
import { useNow } from "@/app/lib/use-now";
import styles from "@/app/components/predictions/floor/floor.module.scss";

export const WHALE_CASH = 500;
/** Pool bets start at $1,000, so a whale there is a much bigger bet. */
const POOL_WHALE_CASH = 25_000;

export type TapeItem = {
  key: string;
  pricing?: "lmsr" | "pool";
  slug: string;
  title: string;
  outcome_code: string;
  outcome_label: string;
  color: string;
  side: "buy" | "sell";
  cash: number;
  avg_price: number;
  username: string | null;
  at: string;
  fresh?: boolean;
};

function Ago({ at }: { at: string }) {
  const now = useNow();
  return (
    <time dateTime={at} suppressHydrationWarning>
      {now === null ? "" : timeAgo(at, now)}
    </time>
  );
}

function Row({ item }: { item: TapeItem }) {
  const isPool = item.pricing === "pool";
  const whale = item.cash >= (isPool ? POOL_WHALE_CASH : WHALE_CASH);
  return (
    <li className={`${styles.tapeRow} ${item.fresh ? styles.fresh : ""}`} data-whale={whale || undefined}>
      <Link href={isPool ? poolHref(item.slug) : `/predictions/${encodeURIComponent(item.slug)}`} className={styles.tapeLink}>
        <span className={styles.tapeLine}>
          <span className={styles.tapeWho}>
            <b>{item.username ?? "A limit order"}</b> {isPool ? "bet" : item.side === "buy" ? "bought" : "sold"}{" "}
            <em style={{ "--oc": item.color } as CSSProperties}>{item.outcome_label}</em>
          </span>
          <span className={styles.tapeCash}>
            {whale ? <i className={styles.whale}>Whale</i> : null}
            {money(item.cash, item.cash >= 100 || Number.isInteger(item.cash) ? 0 : 2)}
          </span>
        </span>
        <span className={styles.tapeLine}>
          <span className={styles.tapeMarket}>
            {isPool ? item.title : `@ ${cents(item.avg_price)} · ${item.title}`}
          </span>
          <span className={styles.tapeAgo}>
            <Ago at={item.at} />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function LiveTape({ items, loading }: { items: TapeItem[] | null; loading: boolean }) {
  const connected = usePredictionFeedConnected();
  return (
    <section className={styles.tape} aria-label="Live bets">
      <header className={styles.sideHead}>
        <h2>
          <i className={styles.liveDot} data-on={connected || undefined} aria-hidden="true" />
          The tape
        </h2>
        <span className={styles.sideMeta}>{connected ? "live" : "reconnecting…"}</span>
      </header>
      {items === null || (loading && !items.length) ? (
        <p className={styles.sideEmpty}>Loading bets…</p>
      ) : items.length ? (
        <ol className={styles.tapeList}>
          {items.map((item) => (
            <Row key={item.key} item={item} />
          ))}
        </ol>
      ) : (
        <p className={styles.sideEmpty}>Quiet floor. Make the first bet.</p>
      )}
    </section>
  );
}
