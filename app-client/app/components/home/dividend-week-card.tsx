"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { Term } from "@/app/components/common/tip";
import { untilText } from "@/app/components/market/dividends-tab";
import { apiFetch } from "@/app/lib/api";
import { useFeature } from "@/app/lib/features";
import { money, toneOf } from "@/app/lib/time";
import type { MyDividendSummary } from "@/app/lib/types";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/home/dividend-week-card.module.scss";

// What the Saturday review did to you, on the front page (the dividend-spotlight flag): your week for
// a few days after a review, and a countdown over the last three days before the next. A player the
// review didn't touch and who holds nothing sees neither. Hiding one lasts until the next review, in
// this browser. Oshi protection's figure only comes with its own flag (the API drops it otherwise).

const WEEK_KEY = "nasfaq.dividendWeek.hidden";
const COUNTDOWN_KEY = "nasfaq.dividendCountdown.hidden";
const COUNTDOWN_MS = 3 * 86_400_000;

function readHidden(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeHidden(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* it comes back on the next visit, which is fine */
  }
}

const signed = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;

function reviewDay(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
}

export function DividendWeekCard() {
  const { user } = useAuth();
  const enabled = useFeature("dividend-spotlight");
  const now = useNow();
  const assets = useMarketStore((state) => state.assets);
  const [data, setData] = useState<MyDividendSummary | null>(null);
  const [hidden, setHidden] = useState<{ week: string | null; countdown: string | null }>({ week: null, countdown: null });

  const load = useCallback(
    () =>
      apiFetch<MyDividendSummary>("/api/market/me/dividend-week", { cache: "no-store" })
        .then((result) => {
          setHidden({ week: readHidden(WEEK_KEY), countdown: readHidden(COUNTDOWN_KEY) });
          setData(result);
        })
        .catch(() => {
          /* keep what we had */
        }),
    []
  );

  useEffect(() => {
    if (!user || !enabled) return;
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, load, user]);

  // The countdown ran out, so the review is running: read the result when it lands, with each tab on
  // its own schedule so they don't all ask at once. A new date for the next review ends this.
  const nextAt = data ? Date.parse(data.next_review_at) : NaN;
  const reviewing = Boolean(now && Number.isFinite(nextAt) && now >= nextAt);
  useEffect(() => {
    if (!reviewing || !enabled) return;
    const timer = setInterval(() => void load(), 20_000 + Math.random() * 10_000);
    return () => clearInterval(timer);
  }, [enabled, load, reviewing]);

  if (!user || !enabled || !data || !now) return null;

  const until = untilText(nextAt - now);
  const week = data.week && now < Date.parse(data.week.show_until) && hidden.week !== data.week.eval_date ? data.week : null;

  if (week) {
    const saved = week.oshi_waived ?? 0;
    const hide = () => {
      writeHidden(WEEK_KEY, week.eval_date);
      setHidden((current) => ({ ...current, week: week.eval_date }));
    };
    return (
      <section className={styles.card} aria-labelledby="dividend-week-title">
        <button type="button" className={styles.close} aria-label="Hide your week until the next review" title="Hide until the next review" onClick={hide}>
          ×
        </button>
        <div className={styles.main}>
          <h2 id="dividend-week-title">Your week</h2>
          <span className={styles.kick}>
            <Term k="evaluation">DIVIDEND REVIEW</Term> · {reviewDay(week.eval_date)}
          </span>
          <b className={`${styles.net} ${styles[toneOf(week.net)]}`}>{signed(week.net)}</b>
          <span className={styles.verdict}>{week.net > 0 ? "DIVS landed" : week.net < 0 ? "Share fees hit" : saved ? "Your oshi skipped the fee" : "It came out even"}</span>
        </div>
        <div className={styles.side}>
          <div className={styles.stats}>
            <div>
              <span className={styles.label}>Dividends</span>
              <b className={week.dividends ? styles.up : styles.flat}>{money(week.dividends)}</b>
              <small>as Credit</small>
            </div>
            <div>
              <span className={styles.label}>Share fees</span>
              <b className={week.fees ? styles.down : styles.flat}>{money(week.fees)}</b>
              <small>Credit first, then cash</small>
            </div>
            {saved ? (
              <div>
                <span className={styles.label}>Oshi saved</span>
                <b className={styles.saved}>{money(saved)}</b>
                <small>fee never charged</small>
              </div>
            ) : null}
            {week.rank ? (
              <div>
                <span className={styles.label}>This week</span>
                <b>#{week.rank.toLocaleString("en-US")}</b>
                <small>of {week.players.toLocaleString("en-US")} players</small>
              </div>
            ) : null}
          </div>
          <ul className={styles.moves} aria-label="Your biggest moves">
            {week.highlights.map((line) => (
              <li key={line.symbol}>
                <Link href={`/stocks/${encodeURIComponent(line.symbol)}`} prefetch={false} className={styles.stock} data-peek-stock={line.symbol}>
                  <Oshimark icon={assets.find((asset) => asset.symbol === line.symbol)?.icon} symbol={line.symbol} size={14} />
                  {line.symbol}
                </Link>
                <b className={line.amount ? styles[toneOf(line.amount)] : styles.saved}>{line.amount ? signed(line.amount) : `${money(line.oshi_waived ?? 0)} saved`}</b>
              </li>
            ))}
            {week.stocks > week.highlights.length ? <li className={styles.more}>+{week.stocks - week.highlights.length} more</li> : null}
          </ul>
          <div className={styles.actions}>
            <Link href="/market/dividends" className={styles.primary}>
              See the breakdown →
            </Link>
            <Link href="/leaderboard?tab=dividends">Dividends leaderboard →</Link>
            <span className={styles.next} suppressHydrationWarning>
              Next review <b>{reviewing ? "now" : `in ${until}`}</b>
            </span>
          </div>
        </div>
      </section>
    );
  }

  if (!data.holds_stocks || nextAt - now > COUNTDOWN_MS || hidden.countdown === data.next_review_at) return null;

  const hide = () => {
    writeHidden(COUNTDOWN_KEY, data.next_review_at);
    setHidden((current) => ({ ...current, countdown: data.next_review_at }));
  };
  return (
    <section className={styles.strip} aria-labelledby="dividend-countdown-title">
      <h2 id="dividend-countdown-title">Next dividend review</h2>
      <b className={styles.clock} suppressHydrationWarning>
        {reviewing ? "Now" : until}
      </b>
      <p>{reviewing ? "The review is running. Your week lands here in a minute." : "Saturday 00:00 ET. Whatever you hold then pays a dividend or charges a share fee."}</p>
      <Link href="/market/dividends">What paid last time →</Link>
      <button type="button" className={styles.close} aria-label="Hide the countdown until the next review" title="Hide until the next review" onClick={hide}>
        ×
      </button>
    </section>
  );
}
