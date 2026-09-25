"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { cents, money, timeAgo } from "@/app/lib/predictions/format";
import { usePredictionFeedConnected } from "@/app/lib/predictions/use-prediction-feed";
import { useNow } from "@/app/lib/use-now";
import styles from "@/app/components/predictions/floor/floor.module.scss";

export const WHALE_CASH = 500;

export type TapeItem = {
  key: string;
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
  const whale = item.cash >= WHALE_CASH;
  return (
    <li className={`${styles.tapeRow} ${item.fresh ? styles.fresh : ""}`} data-whale={whale || undefined}>
      <Link href={`/predictions/${encodeURIComponent(item.slug)}`} className={styles.tapeLink}>
        <span className={styles.tapeLine}>
          <span className={styles.tapeWho}>
            <b>{item.username ?? "A limit order"}</b> {item.side === "buy" ? "bought" : "sold"}{" "}
            <em style={{ "--oc": item.color } as CSSProperties}>{item.outcome_label}</em>
          </span>
          <span className={styles.tapeCash}>
            {whale ? <i className={styles.whale}>Whale</i> : null}
            {money(item.cash, item.cash >= 100 || Number.isInteger(item.cash) ? 0 : 2)}
          </span>
        </span>
        <span className={styles.tapeLine}>
          <span className={styles.tapeMarket}>
            @ {cents(item.avg_price)} · {item.title}
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
    <section className={styles.tape} aria-label="Live trades">
      <header className={styles.sideHead}>
        <h2>
          <i className={styles.liveDot} data-on={connected || undefined} aria-hidden="true" />
          The tape
        </h2>
        <span className={styles.sideMeta}>{connected ? "live" : "reconnecting…"}</span>
      </header>
      {items === null || (loading && !items.length) ? (
        <p className={styles.sideEmpty}>Loading trades…</p>
      ) : items.length ? (
        <ol className={styles.tapeList}>
          {items.map((item) => (
            <Row key={item.key} item={item} />
          ))}
        </ol>
      ) : (
        <p className={styles.sideEmpty}>Quiet floor. Make the first trade.</p>
      )}
    </section>
  );
}
