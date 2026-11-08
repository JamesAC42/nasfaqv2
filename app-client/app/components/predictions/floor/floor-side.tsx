"use client";

import Link from "next/link";
import { money } from "@/app/lib/predictions/format";
import type { Forecaster, Portfolio } from "@/app/lib/predictions/types";
import { usePoolAccess } from "@/app/lib/predictions/use-pool-access";
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
  // Pools (docs/design/predictions-pools.md), once the prediction-pools flag shows them.
  const pools = usePoolAccess();
  return (
    <section className={styles.sideBlock} aria-labelledby="how-head">
      <header className={styles.sideHead}>
        <h2 id="how-head">How it works</h2>
      </header>
      {pools.visible ? (
        <ul className={styles.how}>
          <li>
            <b>Pools.</b> Everyone’s bets on a question go in one pot. When the bookie calls it, the winners split the whole pot by how much they put in. No rake.
          </li>
          <li>
            <b>Odds move</b> with every bet until the pool closes. 3.00× means $1 pays $3 if it closed now.
          </li>
          <li>
            <b>Raise, don’t withdraw.</b> Add to a bet any time it’s open; bets can’t be taken back.
          </li>
          <li>
            <b>Margin.</b> Out of Credit and Cash? Borrow up to 25% of your shares’ value. Until it’s paid back you can’t spend; winnings pay it first.
          </li>
          <li>
            <b>Calls are public.</b> Every result shows who made it and the source. <Link href="/predictions/history">See the history</Link>.
          </li>
        </ul>
      ) : null}
      <ul className={styles.how} hidden={pools.visible}>
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
          <b>Auto markets</b> open on the Lunch tick and a few scheduled streams, close before the result can be known, and settle themselves.
        </li>
        <li>
          <b>Calls are public.</b> Every result gets a dispute window. Think it’s wrong? Say so.
        </li>
      </ul>
    </section>
  );
}
