"use client";

import Link from "next/link";
import { money } from "@/app/lib/predictions/format";
import type { Forecaster, Portfolio } from "@/app/lib/predictions/types";
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
              <span className={styles.boardMarkets}>{row.markets} mkts</span>
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

export function MyBetsSummary({ signedIn, portfolio }: { signedIn: boolean; portfolio: Portfolio | null | undefined }) {
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
      ) : portfolio === undefined ? (
        <p className={styles.sideEmpty}>Loading…</p>
      ) : portfolio === null ? (
        <p className={styles.sideEmpty}>Couldn’t load your bets.</p>
      ) : (
        <>
          <dl className={styles.mine}>
            <div>
              <dt>Riding</dt>
              <dd>{money(portfolio.totals.value, 0)}</dd>
            </div>
            <div>
              <dt>Open P&amp;L</dt>
              <dd className={tone(portfolio.totals.unrealized_pnl)}>{signed(portfolio.totals.unrealized_pnl)}</dd>
            </div>
            <div>
              <dt>Positions</dt>
              <dd>{new Set(portfolio.positions.map((row) => row.market_id)).size}</dd>
            </div>
            <div>
              <dt>Orders</dt>
              <dd>{portfolio.orders.length}</dd>
            </div>
          </dl>
          {portfolio.positions.length === 0 ? <p className={styles.sideNote}>No open bets. Pick a card and make a call.</p> : null}
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
          <b>Instant fills.</b> The house always quotes a price. No waiting for a counterparty.
        </li>
        <li>
          <b>Price = chance.</b> Up at 62¢ means the floor thinks 62%.
        </li>
        <li>
          <b>$1 a share</b> if you’re right, $0 if you’re not. Sell any time before close.
        </li>
        <li>
          <b>Auto markets</b> open all day on every tick and live stream, and settle themselves.
        </li>
        <li>
          <b>Calls are public.</b> Every result gets a dispute window. Think it’s wrong? Say so.
        </li>
      </ul>
    </section>
  );
}
