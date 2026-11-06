"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { untilText } from "@/app/components/market/dividends-tab";
import { apiFetch } from "@/app/lib/api";
import { MARKET_TIME_ZONE } from "@/app/lib/market-clock";
import { money } from "@/app/lib/time";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/home/checkin-card.module.scss";

// The daily check-in (api/src/services/checkins.js): Credit once a day, more for every day of the
// trade streak through yesterday, up to the max. It resets at 00:00 UTC, the day trade streaks count in.

export type Checkin = {
  eligible: boolean;
  day: string;
  resets_at: string;
  claimed: { reward: number; streak_days: number; claimed_at: string } | null;
  reward: number;
  streak: { current: number; through_yesterday: number; traded_today: boolean; last_trade_day: string | null };
  tomorrow: { if_trade: number; if_skip: number | null };
  schedule: { base: number; per_streak_day: number; max: number; max_streak_days: number };
  credit_balance?: number;
};

const credit = (value: number) => `+${money(value).replace(".00", "")}`;

/** "19:00 ET": when the day turns over, in market time. */
function resetClock(iso: string) {
  return `${new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: MARKET_TIME_ZONE })} ET`;
}

export function CheckinCard() {
  const { user } = useAuth();
  const now = useNow();
  const [data, setData] = useState<Checkin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justClaimed, setJustClaimed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<Checkin>("/api/market/me/checkin", { cache: "no-store" }));
    } catch {
      /* keep what we had */
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setData(null);
      return;
    }
    void load();
    // A trade on another page (or a new day) shows when the player comes back.
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, user]);

  // Past the reset: read the new day.
  const resetsAt = data ? Date.parse(data.resets_at) : NaN;
  const pastReset = Boolean(now && Number.isFinite(resetsAt) && now >= resetsAt);
  useEffect(() => {
    if (pastReset) void load();
  }, [load, pastReset]);

  if (!user || !data) return null;

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      setData(await apiFetch<Checkin>("/api/market/me/checkin", { method: "POST", body: "{}" }));
      setJustClaimed(true);
      void useProfileStore.getState().fetchPortfolio();
    } catch (reason) {
      const body = (reason as { body?: Record<string, unknown> | null })?.body ?? null;
      if (body?.error === "already_checked_in" && body.checkin) setData(body.checkin as Checkin);
      else setError(String((reason as Error)?.message || reason));
    } finally {
      setBusy(false);
    }
  };

  const { schedule, streak, tomorrow, claimed } = data;
  const today = claimed ? claimed.reward : data.reward;
  const steps = Array.from({ length: schedule.max_streak_days + 1 }, (_, days) => Math.min(schedule.max, schedule.base + schedule.per_streak_day * days));
  const todayStep = Math.min(claimed ? claimed.streak_days : streak.through_yesterday, schedule.max_streak_days);
  const tomorrowStep = Math.min(streak.traded_today ? streak.current : streak.through_yesterday + 1, schedule.max_streak_days);
  const resetIn = now && Number.isFinite(resetsAt) ? untilText(resetsAt - now) : null;

  return (
    <section className={styles.card} aria-labelledby="checkin-title" data-claimed={claimed ? "" : undefined}>
      <div className={styles.main}>
        <div className={styles.head}>
          <h2 id="checkin-title">Daily check-in</h2>
          <span className={styles.streak}>
            {streak.current > 0 ? `${streak.current}-day trade streak` : "no trade streak yet"}
          </span>
        </div>
        {claimed ? (
          <p className={styles.done} aria-live="polite">
            <span className={styles.tick} aria-hidden="true">
              ✓
            </span>
            {justClaimed ? "Checked in: " : "Checked in today: "}
            <b>{credit(claimed.reward)} Credit</b>
          </p>
        ) : data.eligible ? (
          <button type="button" className={styles.claim} disabled={busy} onClick={() => void claim()}>
            {busy ? "Checking in…" : `Check in · ${credit(today)} Credit`}
          </button>
        ) : (
          <p className={styles.locked}>
            <Link href="/profile">Verify your email</Link> to check in. Every day pays Credit, more the longer you trade in a row.
          </p>
        )}
        {error ? (
          <p className={styles.err} role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className={styles.side}>
        <p className={styles.tomorrow}>
          <span className={styles.label}>Tomorrow</span>
          {streak.traded_today ? (
            <>
              <b>{credit(tomorrow.if_trade)}</b> locked in by today&apos;s trade.
            </>
          ) : (
            <>
              <b>{credit(tomorrow.if_trade)}</b> if you trade today{tomorrow.if_skip !== null ? <>, {credit(tomorrow.if_skip)} if you don&apos;t</> : null}.{" "}
              <Link href="/stocks" className={styles.trade}>
                Trade now →
              </Link>
            </>
          )}
        </p>
        <ol className={styles.ladder} aria-label={`Check-in Credit by trade streak: ${steps.map((value, days) => `${days} days ${money(value)}`).join(", ")}`}>
          {steps.map((value, days) => (
            <li key={days} data-today={days === todayStep || undefined} data-tomorrow={days === tomorrowStep && tomorrowStep !== todayStep ? "" : undefined}>
              <b>{value}</b>
              <small>{days === schedule.max_streak_days ? `${days}d+` : `${days}d`}</small>
            </li>
          ))}
        </ol>
        <p className={styles.fine} suppressHydrationWarning>
          {money(schedule.base).replace(".00", "")} Credit, plus {money(schedule.per_streak_day).replace(".00", "")} for every day in a row you&apos;ve traded, up to{" "}
          {money(schedule.max).replace(".00", "")}. A new day starts at {resetClock(data.resets_at)}
          {resetIn ? ` (in ${resetIn})` : ""}.
        </p>
      </div>
    </section>
  );
}
