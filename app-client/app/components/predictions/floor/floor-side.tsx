"use client";

import Link from "next/link";
import { InTheRed } from "@/app/components/predictions/pool/bet-slip";
import { money } from "@/app/lib/predictions/format";
import type { MyPools } from "@/app/lib/predictions/pools";
import type { Forecaster } from "@/app/lib/predictions/types";
import styles from "@/app/components/predictions/floor/floor.module.scss";

const tone = (value: number) => (value > 0.004 ? styles.up : value < -0.004 ? styles.down : styles.flat);
const signed = (value: number) => `${value > 0.004 ? "+" : ""}${money(value, Math.abs(value) >= 1000 ? 0 : 2)}`;

export function Forecasters({ rows }: { rows: Forecaster[] | null }) {
  return (
    <section className={styles.sideBlock} aria-labelledby="forecasters-head">
      <header className={styles.sideHead}>
        <h2 id="forecasters-head">Forecasters this week</h2>
        <span className={styles.sideMeta}>realized</span>
      </header>
      {rows === null ? (
        <p className={styles.sideEmpty}>Loading…</p>
      ) : rows.length ? (
        <ol className={styles.board}>
          {rows.map((row) => (
            <li key={row.username}>
              <span className={styles.rank} data-top={row.rank <= 3 || undefined}>
                {row.rank}
              </span>
              <Link href={`/profile/${encodeURIComponent(row.username)}`} className={styles.boardName}>
                {row.username}
              </Link>
              <span className={styles.boardMarkets}>
                {row.markets} {row.markets === 1 ? "pool" : "pools"}
              </span>
              <span className={`${styles.boardPnl} ${tone(row.pnl)}`}>{signed(row.pnl)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.sideEmpty}>Nobody’s cashed a call this week. Yet.</p>
      )}
    </section>
  );
}

export function MyBetsSummary({ signedIn, pools }: { signedIn: boolean; pools: MyPools | null | undefined }) {
  return (
    <section className={styles.sideBlock} aria-labelledby="mybets-head">
      <header className={styles.sideHead}>
        <h2 id="mybets-head">Your bets</h2>
        {signedIn ? (
          <Link href="/predictions/portfolio" className={styles.sideLink}>
            My bets →
          </Link>
        ) : null}
      </header>
      {!signedIn ? (
        <p className={styles.sidePrompt}>
          <Link href="/login">Sign in</Link> or <Link href="/register">make an account</Link> to bet. Every account starts with Credit.
        </p>
      ) : pools === undefined ? (
        <p className={styles.sideEmpty}>Loading…</p>
      ) : pools === null ? (
        <p className={styles.sideEmpty}>Couldn’t load your bets.</p>
      ) : (
        <>
          {pools.margin.in_red ? (
            <div className={styles.sideRed}>
              <InTheRed margin={pools.margin} compact />
            </div>
          ) : null}
          <dl className={styles.mine}>
            <div>
              <dt>In open pools</dt>
              <dd>{money(pools.totals.staked_open, 0)}</dd>
            </div>
            <div>
              <dt>Open pools</dt>
              <dd>{new Set(pools.open.map((row) => row.market_id)).size}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd className={tone(pools.totals.net_settled)}>{signed(pools.totals.net_settled)}</dd>
            </div>
            <div>
              <dt>{pools.margin.in_red ? "You owe" : "Margin line"}</dt>
              <dd>{money(pools.margin.in_red ? pools.margin.owed : pools.margin.available, 0)}</dd>
            </div>
          </dl>
          {pools.open.length === 0 ? <p className={styles.sideNote}>No open bets. Pick a card and make a call.</p> : null}
        </>
      )}
    </section>
  );
}

export function HowItWorks() {
  return (
    <section className={styles.sideBlock} aria-labelledby="how-head">
      <header className={styles.sideHead}>
        <h2 id="how-head">How it works</h2>
      </header>
      <ul className={styles.how}>
        <li>
          <b>Pools.</b> Everyone’s bets on a question go in one pot. When it’s called, the winners split the whole pot by how much they put in. No rake.
        </li>
        <li>
          <b>Odds move</b> with every bet until the pool closes. 3.00× means $1 pays $3 if it closed right then.
        </li>
        <li>
          <b>Raise, don’t withdraw.</b> Add to a bet any time it’s open; bets can’t be taken back.
        </li>
        <li>
          <b>Margin.</b> Out of Credit? Borrow up to 25% of your shares’ value. It never touches your cash, and until it’s paid back you can’t bet or spend Credit. Stocks stay open.
        </li>
        <li>
          <b>Calls are public.</b> Every result shows who made it and the source. <Link href="/predictions/history">See the history</Link>.
        </li>
      </ul>
    </section>
  );
}
