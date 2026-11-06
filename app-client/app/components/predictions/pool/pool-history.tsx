"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PredictionsFrame } from "@/app/components/predictions/shell/predictions-frame";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { money } from "@/app/lib/predictions/format";
import { fetchPoolHistory, multiplierText, poolHref, type PoolHistoryItem } from "@/app/lib/predictions/pools";
import { usePoolAccess } from "@/app/lib/predictions/use-pool-access";
import { useAuth } from "@/app/providers/auth-provider";
import styles from "@/app/components/predictions/pool/pool.module.scss";

const when = (at: string) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** /predictions/history: every finished pool, newest first, and "Pools I bet on" with your result. */
export function PoolHistory() {
  const { user } = useAuth();
  const access = usePoolAccess();
  const search = useSearchParams();
  const [mine, setMine] = useState(search.get("mine") === "1");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: PoolHistoryItem[]; page_count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (!access.visible) return;
    let alive = true;
    fetchPoolHistory({ q: query || undefined, mine, page })
      .then((result) => alive && (setData({ items: result.items, page_count: result.pagination.page_count }), setError(null)))
      .catch((reason) => alive && setError(predictionErrorText(reason)));
    return () => {
      alive = false;
    };
  }, [access.visible, query, mine, page]);

  if (access.loaded && !access.visible) {
    return (
      <PredictionsFrame kicker="Predictions" title="Pool history">
        <p className={styles.empty}>Nothing here yet.</p>
      </PredictionsFrame>
    );
  }

  return (
    <PredictionsFrame kicker="Pools" title="Pool history" blurb="Every finished pool: who won, what it paid, and who made the call.">
      <div className={styles.page}>
        <div className={styles.toolbar}>
          <input type="search" placeholder="Search pools" value={q} onChange={(event) => (setQ(event.target.value), setPage(1))} aria-label="Search pools" />
          {user ? (
            <div className={styles.tabs} role="group" aria-label="Which pools">
              <button type="button" aria-pressed={!mine} onClick={() => (setMine(false), setPage(1))}>
                All
              </button>
              <button type="button" aria-pressed={mine} onClick={() => (setMine(true), setPage(1))}>
                Pools I bet on
              </button>
            </div>
          ) : null}
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
        {data && !data.items.length ? <p className={styles.empty}>{mine ? "You haven't bet on a pool that's finished yet." : "No finished pools yet."}</p> : null}
        <ul className={styles.list}>
          {data?.items.map((item) => (
            <li key={item.id} className={styles.row}>
              <Link href={poolHref(item.slug)}>{item.title}</Link>
              <span className={styles.rowRight}>
                {item.mine ? (
                  <>
                    <span className={styles.net} data-tone={item.mine.net > 0 ? "up" : item.mine.net < 0 ? "down" : undefined}>
                      {item.mine.net > 0 ? "+" : ""}
                      {money(item.mine.net, 0)}
                    </span>
                    <small>you</small>
                  </>
                ) : (
                  <>
                    {money(item.pool_total, 0)}
                    <small>pool</small>
                  </>
                )}
              </span>
              <div className={styles.rowMeta}>
                {item.status === "voided" ? (
                  <span>
                    <b>Voided</b>
                    {item.note ? `: ${item.note}` : ""}
                  </span>
                ) : item.no_winner ? (
                  <span>
                    <b>{item.winner_label}</b> won; nobody had backed it, so every bet came back
                  </span>
                ) : (
                  <span>
                    <b>{item.winner_label}</b> won, paid {multiplierText(item.winner_multiplier)}
                  </span>
                )}
                {item.corrected ? <span>Corrected</span> : null}
                <span>{money(item.pool_total, 0)} pool</span>
                <span>
                  {item.bettors} {item.bettors === 1 ? "bettor" : "bettors"}
                </span>
                <span>{item.kind === "auto" ? "Auto pool" : item.bookie ? `Bookie ${item.bookie}` : "Pool"}</span>
                {item.mine ? <span>You put in {money(item.mine.staked, 0)}</span> : null}
                <time suppressHydrationWarning>{when(item.finished_at)}</time>
              </div>
            </li>
          ))}
        </ul>
        {data && data.page_count > 1 ? (
          <div className={styles.pager}>
            <button type="button" className={styles.secondary} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Newer
            </button>
            <button type="button" className={styles.secondary} disabled={page >= data.page_count} onClick={() => setPage(page + 1)}>
              Older
            </button>
          </div>
        ) : null}
      </div>
    </PredictionsFrame>
  );
}
