"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { Countdown } from "@/app/components/predictions/floor/market-card";
import { Comments } from "@/app/components/predictions/market/comments";
import { useCompact } from "@/app/components/predictions/market/shared";
import { BetSlip } from "@/app/components/predictions/pool/bet-slip";
import { PoolActions } from "@/app/components/predictions/pool/pool-actions";
import { PredictionsFrame, usePredictionCash } from "@/app/components/predictions/shell/predictions-frame";
import { predictionErrorText } from "@/app/lib/predictions/errors";
import { compactMoney, money, outcomeColor, percent, timeAgo } from "@/app/lib/predictions/format";
import { fetchPool, multiplierText, type PoolDetail, type PoolOption } from "@/app/lib/predictions/pools";
import type { PredictionMarketDetail } from "@/app/lib/predictions/types";
import { usePredictionFeed } from "@/app/lib/predictions/use-prediction-feed";
import { useNow } from "@/app/lib/use-now";
import styles from "@/app/components/predictions/pool/pool.module.scss";

const LOCK_TEXT: Record<string, string> = {
  stream_started: "The stream has started, so betting is shut.",
  stream_starting: "The stream starts soon, so betting is shut.",
  tick_landed: "The tick has landed, so betting is shut.",
  template_off: "This auto pool is paused.",
};

/**
 * The market thread takes a market; a stake in a pool is the skin in it that lets you post (the API
 * counts stakes too), and a new stake reloads the thread.
 */
function asCommentsMarket(pool: PoolDetail): PredictionMarketDetail {
  const positions = (pool.mine?.stakes ?? []).map((stake) => ({ outcome_id: stake.outcome_id, outcome_code: "", shares: stake.stake, avg_price: 0, net_cost: stake.stake, realized_pnl: 0 }));
  return { ...(pool as unknown as PredictionMarketDetail), mine: pool.mine ? { cash_balance: pool.mine.wallet.spendable, positions, orders: [] } : undefined };
}

/** /predictions/pools/[slug]: one pool. Options with live odds, the bet slip, and its record. */
export function PoolPage({ slug }: { slug: string }) {
  const search = useSearchParams();
  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(search.get("option"));
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const { refreshCash } = usePredictionCash();
  const compact = useCompact();

  const seq = useRef(0);
  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const { pool: next } = await fetchPool(slug);
      if (mine !== seq.current) return;
      setPool(next);
      setLoadError(null);
    } catch (reason) {
      if (mine === seq.current) setLoadError(predictionErrorText(reason));
    }
  }, [slug]);

  useEffect(() => {
    let alive = true;
    const mine = ++seq.current;
    fetchPool(slug)
      .then(({ pool: next }) => {
        if (!alive || mine !== seq.current) return;
        setPool(next);
        setLoadError(null);
      })
      .catch((reason) => alive && mine === seq.current && setLoadError(predictionErrorText(reason)));
    return () => {
      alive = false;
    };
  }, [slug]);

  // A bet anywhere on the pool moves everyone's odds: refetch once per burst.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refetch(), 500);
  }, [refetch]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  usePredictionFeed(
    (message) => {
      if (message.type === "prediction.market.updated" && message.slug === slug) soon();
    },
    soon,
  );

  if (!pool) {
    return (
      <PredictionsFrame kicker="Pool" title={loadError ? "Pool not found" : "Loading…"} bare={false}>
        {loadError ? (
          <p className={styles.empty}>
            {loadError} <Link href="/predictions">Back to the floor</Link>
          </p>
        ) : (
          <div className={styles.skeleton} aria-busy="true" />
        )}
      </PredictionsFrame>
    );
  }

  const choice = pool.options.find((option) => option.outcome_code === picked) ?? null;
  const myStake = (option: PoolOption) => pool.mine?.stakes.find((stake) => stake.outcome_id === option.id) ?? null;
  const settled = pool.status === "resolved" || pool.status === "voided";
  const ranked = settled ? [...pool.options].sort((a, b) => Number(b.is_winner) - Number(a.is_winner)) : pool.options;
  const afterChange = () => {
    void refetch();
    void refreshCash();
  };
  const slip = <BetSlip pool={pool} choice={choice} onPick={setPicked} onPlaced={afterChange} />;

  return (
    <PredictionsFrame kicker="Pool" title={pool.title} bare>
      <div className={styles.page}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <Link href="/predictions">Floor</Link>
          <span aria-hidden="true">/</span>
          <Link href="/predictions/history">Pools</Link>
          {pool.category ? (
            <>
              <span aria-hidden="true">/</span>
              <span>{pool.category.display_name}</span>
            </>
          ) : null}
        </nav>
        <div className={styles.layout}>
          <div className={styles.main}>
            <Header pool={pool} />
            <Result pool={pool} />
            <section className={styles.section} aria-label="Options">
              <div className={styles.sectionHead}>
                <h2>{settled ? "How it ended" : "Options"}</h2>
                <span className={styles.hint}>{pool.betting_open ? "Pays per $1 if it wins, if the pool closed now" : `${pool.options.length} options`}</span>
              </div>
              <ul className={styles.options}>
                {ranked.map((option) => {
                  const color = outcomeColor(pool, option);
                  const share = pool.pool_total > 0 ? option.pool_stake / pool.pool_total : 0;
                  const stake = myStake(option);
                  const open = Boolean(expanded[option.id]);
                  return (
                    <li key={option.id} className={styles.option} style={{ "--oc": color } as CSSProperties} data-picked={picked === option.outcome_code || undefined} data-winner={settled && option.is_winner ? "true" : undefined}>
                      <button
                        type="button"
                        className={styles.optionMain}
                        disabled={!pool.can?.bet}
                        onClick={() => setPicked(option.outcome_code)}
                        aria-pressed={picked === option.outcome_code}
                        aria-label={`${option.label}: ${money(option.pool_stake, 0)} on it, pays ${multiplierText(option.multiplier)}`}
                      >
                        <span className={styles.optionFill} style={{ width: `${Math.max(share * 100, option.pool_stake > 0 ? 1.5 : 0)}%` }} aria-hidden="true" />
                        <span className={styles.optionLabel}>
                          {option.asset ? <Oshimark icon={option.asset.icon} symbol={option.asset.symbol} size={18} /> : <i className={styles.dot} aria-hidden="true" />}
                          <span>{option.label}</span>
                          {settled && option.is_winner ? <em className={styles.won}>won</em> : null}
                        </span>
                        <span className={styles.optionNums}>
                          <span className={styles.optionStake}>
                            {money(option.pool_stake, 0)}
                            <small>{percent(share)}</small>
                          </span>
                          <b className={styles.multiplier}>{multiplierText(option.multiplier)}</b>
                        </span>
                      </button>
                      <div className={styles.optionFoot}>
                        {stake ? (
                          <span className={styles.mine}>
                            You: {money(stake.stake, 0)}
                            {stake.payout !== null ? <> · paid {money(stake.payout, 0)}</> : option.multiplier ? <> · pays {money(stake.stake * option.multiplier, 0)} now</> : null}
                          </span>
                        ) : null}
                        {option.bettors.length ? (
                          <button type="button" className={styles.bettorsToggle} onClick={() => setExpanded((prev) => ({ ...prev, [option.id]: !open }))} aria-expanded={open}>
                            {option.bettors.length} {option.bettors.length === 1 ? "bettor" : "bettors"} {open ? "▴" : "▾"}
                          </button>
                        ) : (
                          <span className={styles.nobody}>No bets yet</span>
                        )}
                      </div>
                      {open ? (
                        <ul className={styles.bettors}>
                          {option.bettors.map((bettor) => (
                            <li key={bettor.username}>
                              <Link href={`/profile/${encodeURIComponent(bettor.username)}`} style={{ color: bettor.profile_color || undefined }}>
                                {bettor.username}
                              </Link>
                              <span>{money(bettor.stake, 0)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
            {compact ? <div className={styles.slipInline}>{slip}</div> : null}
            <PoolActions pool={pool} onChanged={afterChange} />
            <Record pool={pool} />
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2>Rules</h2>
              </div>
              {pool.description ? <p className={styles.prose}>{pool.description}</p> : null}
              <p className={styles.prose}>{pool.rules_text}</p>
              <p className={styles.small}>
                Winners split the whole pool in proportion to what they put in. There’s no rake. If nobody backed the winner, every bet comes back. Bets can be raised but not withdrawn.
              </p>
            </section>
            <Bets pool={pool} />
            <Comments market={asCommentsMarket(pool)} />
          </div>
          {!compact ? (
            <aside className={styles.aside} aria-label="Bet slip">
              <div className={styles.sticky}>{slip}</div>
            </aside>
          ) : null}
        </div>
      </div>
    </PredictionsFrame>
  );
}

function Header({ pool }: { pool: PoolDetail }) {
  const now = useNow();
  const open = pool.status === "open";
  return (
    <header className={styles.header}>
      <span className={styles.kicker}>
        {open && pool.betting_open ? <i aria-hidden="true" /> : null}
        {pool.kind === "auto" ? "Auto pool" : "Pool"}
        {pool.bookie ? (
          <>
            {" "}
            · bookie <Link href={`/profile/${encodeURIComponent(pool.bookie.username)}`}>{pool.bookie.username}</Link>
          </>
        ) : null}
      </span>
      <h1>{pool.title}</h1>
      {pool.subtitle ? <p className={styles.subtitle}>{pool.subtitle}</p> : null}
      <dl className={styles.stats}>
        <div>
          <dt>Pool</dt>
          <dd>{money(pool.pool_total, 0)}</dd>
        </div>
        <div>
          <dt>Bettors</dt>
          <dd>{pool.bettors_count}</dd>
        </div>
        <div>
          <dt>Min bet</dt>
          <dd>{compactMoney(pool.min_bet)}</dd>
        </div>
        <div>
          <dt>{open ? "Closes in" : pool.status === "voided" ? "Voided" : pool.status === "resolved" ? "Resolved" : "Status"}</dt>
          <dd>
            {open ? (
              <Countdown to={pool.closes_at} />
            ) : pool.status === "resolved" || pool.status === "voided" ? (
              <span suppressHydrationWarning>{now === null ? "…" : `${timeAgo((pool.voided_at || pool.resolved_at) as string, now)} ago`}</span>
            ) : (
              "Waiting for the call"
            )}
          </dd>
        </div>
      </dl>
      {open && !pool.betting_open && pool.betting_lock ? <p className={styles.lock}>{LOCK_TEXT[pool.betting_lock] ?? "Betting is shut on this pool."}</p> : null}
    </header>
  );
}

function Result({ pool }: { pool: PoolDetail }) {
  const last = pool.record.at(-1);
  if (pool.status === "voided") {
    return (
      <div className={styles.result} data-tone="void">
        <small>Voided</small>
        <strong>Every bet went back where it came from</strong>
        {last?.note ? <p>{last.note}</p> : null}
      </div>
    );
  }
  if (pool.status !== "resolved") return null;
  const winner = pool.options.find((option) => option.is_winner);
  if (!winner) return null;
  const color = outcomeColor(pool, winner);
  return (
    <div className={styles.result} style={{ "--oc": color } as CSSProperties}>
      <small>{last?.action === "corrected" ? "Corrected result" : "Resolved"}</small>
      <strong>
        {winner.asset ? <Oshimark icon={winner.asset.icon} symbol={winner.asset.symbol} size={22} /> : null}
        {winner.label}
      </strong>
      <p>
        {last?.no_winner_refund
          ? "Nobody had backed it, so every bet came back."
          : `Paid ${multiplierText(winner.multiplier)}: ${money(pool.pool_total, 0)} split among ${winner.bettors.length} ${winner.bettors.length === 1 ? "bettor" : "bettors"}.`}
      </p>
    </div>
  );
}

const ACTION_LABEL = { resolved: "Resolved", corrected: "Corrected", voided: "Voided" } as const;

/** The pool's public record: every call, correction and void, with who and the source. */
function Record({ pool }: { pool: PoolDetail }) {
  if (!pool.record.length) return null;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>Record</h2>
        {pool.correction_until && pool.status === "resolved" ? (
          <span className={styles.hint} suppressHydrationWarning>
            Staff can correct it until {new Date(pool.correction_until).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </span>
        ) : null}
      </div>
      <ol className={styles.record}>
        {pool.record.map((entry) => (
          <li key={entry.id} data-action={entry.action}>
            <div className={styles.recordHead}>
              <b>{ACTION_LABEL[entry.action]}</b>
              {entry.action === "voided" ? null : <span>{entry.outcome_label}</span>}
              {entry.previous_label && entry.action === "corrected" ? <span className={styles.was}>was {entry.previous_label}</span> : null}
              <time suppressHydrationWarning>{new Date(entry.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
            </div>
            <p>
              {entry.automatic ? "Called automatically from NASFAQ data" : `By ${entry.actor?.username ?? "staff"}`}
              {entry.note ? `: ${entry.note}` : "."}
            </p>
            {entry.source_url ? (
              <a href={entry.source_url} target="_blank" rel="noopener noreferrer nofollow" className={styles.source}>
                Source ↗
              </a>
            ) : null}
            <p className={styles.small}>
              {money(entry.pool_total, 0)} pool
              {entry.paid_out > 0 ? ` · ${money(entry.paid_out, 0)} paid out` : ""}
              {entry.refunded > 0 ? ` · ${money(entry.refunded, 0)} refunded` : ""}
              {entry.clawed_back > 0 ? ` · ${money(entry.clawed_back, 0)} in earlier payouts taken back` : ""}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Bets({ pool }: { pool: PoolDetail }) {
  const now = useNow();
  if (!pool.bets.length) return null;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>Recent bets</h2>
      </div>
      <ul className={styles.feed}>
        {pool.bets.map((entry) => (
          <li key={entry.id}>
            <Link href={`/profile/${encodeURIComponent(entry.username)}`} style={{ color: entry.profile_color || undefined }}>
              {entry.username}
            </Link>
            <span>
              {entry.raise ? "raised" : "bet"} <b>{money(entry.amount, 0)}</b> on {entry.outcome_label}
            </span>
            <time suppressHydrationWarning>{now === null ? "" : timeAgo(entry.at, now)}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
