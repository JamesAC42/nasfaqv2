"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { VerificationRequiredNotice, userNeedsEmailVerification } from "@/app/components/common/verification-required-notice";
import { nextEvaluationAt, untilText } from "@/app/components/market/dividends-tab";
import { getMarketClock } from "@/app/lib/market-clock";
import { money, signedPct, toneOf } from "@/app/lib/time";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import { inFirstDays, useFirstDaysStore } from "@/app/stores/first-days-store";
import styles from "@/app/components/onboarding/first-days-card.module.scss";

// "Your first days": what to do after signing up, for accounts made since this shipped. Every tick
// comes from what the player has actually done (api/src/services/firstDays.js). It goes away when
// every step is done, when they hide it, or two weeks after sign-up.

const TICK_LABELS: Record<string, string> = { open: "Open", lunch: "Lunch", late: "Late", overnight: "Overnight" };

type Step = { key: string; title: string; done: boolean; body: ReactNode; action?: ReactNode };

/** `onPickOshi` opens the picker in place (the profile has it); `verifyNotice` is off where the page already shows one. */
export function FirstDaysCard({ onPickOshi, verifyNotice = true }: { onPickOshi?: () => void; verifyNotice?: boolean }) {
  const { user } = useAuth();
  const now = useNow();
  const data = useFirstDaysStore((state) => state.data);
  const loadedFor = useFirstDaysStore((state) => state.userId);
  const load = useFirstDaysStore((state) => state.load);
  const refresh = useFirstDaysStore((state) => state.refresh);
  const dismiss = useFirstDaysStore((state) => state.dismiss);
  const eligible = inFirstDays(user);

  useEffect(() => {
    if (user && eligible) void load(user.id);
  }, [eligible, load, user]);

  // What the player did on another page or tab shows when they come back to this one.
  useEffect(() => {
    if (!eligible) return;
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [eligible, refresh]);

  if (!user || !eligible || loadedFor !== user.id || !data?.active) return null;

  const clock = now ? getMarketClock(now) : null;
  const tickIn = clock ? `${clock.nextTick.label} in ${untilText(clock.secondsToNextTick * 1000)}` : null;
  const reviewIn = now ? untilText(nextEvaluationAt(now) - now) : null;
  const oshi = data.oshi ?? null;
  const fill = data.first_fill ?? null;
  const tick = data.first_tick ?? null;
  const review = data.first_review ?? null;

  const steps: Step[] = [
    {
      key: "oshi",
      title: "Pick your oshi",
      done: Boolean(oshi),
      body: oshi ? (
        <>
          Your oshi is <b>{oshi.name}</b>. Their mark follows your name, and the {oshi.symbol} shares you hold all week skip Saturday&apos;s share fee.
        </>
      ) : (
        "Your favorite talent. Their mark follows your name, and the shares of them you hold all week skip Saturday's share fee. It can change once every 30 days, so choose well."
      ),
      action: oshi ? null : onPickOshi ? (
        <button type="button" onClick={onPickOshi}>
          Pick one →
        </button>
      ) : (
        <Link href="/profile?edit=1">Pick one →</Link>
      ),
    },
    {
      key: "buy",
      title: "Buy your first shares",
      done: Boolean(fill),
      body: fill ? (
        <>
          Your first fill was <b>{fill.symbol}</b>. You own a piece of her now.
        </>
      ) : (
        "Every talent is a stock. Hit BUY and your order fills in the next batch, every 10 minutes."
      ),
      action: fill ? null : oshi ? <Link href={`/stocks/${encodeURIComponent(oshi.symbol)}`}>Buy {oshi.symbol} →</Link> : <Link href="/stocks">Browse stocks →</Link>,
    },
    {
      key: "tick",
      title: "Hold through a tick",
      done: Boolean(tick),
      body: tick ? (
        <>
          <b>{tick.symbol}</b> moved <b className={styles[toneOf(tick.move_pct)]}>{signedPct(tick.move_pct)}</b> at the {TICK_LABELS[tick.key] ?? tick.key} tick. Four a day pull every price toward
          its hidden fair value.
        </>
      ) : (
        <>
          At 09:00, 15:00, 21:00 and 03:00 ET every price is pulled toward a hidden fair value, set by the channel&apos;s views, subscribers and uploads.
          {tickIn ? <> Next: {tickIn}.</> : null}
        </>
      ),
      action: tick ? null : <Link href="/how-to-play#ticks">How ticks work →</Link>,
    },
    {
      key: "review",
      title: "Hold through Saturday",
      done: Boolean(review),
      body: review ? (
        review.net ? (
          <>
            Your first Dividend Review: <b className={styles[toneOf(review.net)]}>{review.net > 0 ? `+${money(review.net)} in dividends` : `${money(review.net)} in share fees`}</b>.
          </>
        ) : (
          "Your first Dividend Review: your stocks sat in the middle, so no dividend and no fee."
        )
      ) : (
        <>
          Saturday 00:00 ET{reviewIn ? ` (in ${reviewIn})` : ""}, the fastest-growing channels pay their holders a dividend and the slowest charge a fee. Your oshi
          never charges one on shares held all week.
        </>
      ),
      action: review ? null : <Link href="/market/dividends">Last week&apos;s review →</Link>,
    },
    {
      key: "cards",
      title: "Claim 5 free cards",
      done: Boolean(data.cards_claimed),
      body: data.cards_claimed ? "Claimed. Pull more, duel with them, or finish a unit set." : "A starter pack for the arcade, on the house: enough to play an Oshi Card Duel.",
      action: data.cards_claimed ? null : <Link href="/games/collection">Claim them →</Link>,
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  if (doneCount === steps.length) return null;
  const nextKey = steps.find((step) => !step.done)?.key;

  return (
    <section className={styles.card} aria-labelledby="first-days-title">
      <header className={styles.head}>
        <h2 id="first-days-title">Your first days</h2>
        <span className={styles.progress}>
          {doneCount} of {steps.length} done
        </span>
        <span className={styles.links}>
          <Link href="/how-to-play">How to play</Link>
          <Link href="/how-to-play#when-to-sell">When to sell?</Link>
        </span>
        <button type="button" className={styles.hide} onClick={() => void dismiss()}>
          Hide
        </button>
      </header>
      {verifyNotice && userNeedsEmailVerification(user) ? (
        <div className={styles.verify}>
          <VerificationRequiredNotice action="trade, play or chat" compact />
        </div>
      ) : null}
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={step.key} className={styles.step} data-done={step.done || undefined} data-next={step.key === nextKey || undefined}>
            <span className={styles.num} aria-hidden="true">
              {step.done ? "✓" : String(index + 1).padStart(2, "0")}
            </span>
            <div className={styles.text}>
              <h3>
                {step.title}
                {step.done ? <span className={styles.sr}> (done)</span> : null}
              </h3>
              <p>{step.body}</p>
              {step.action ? <span className={styles.action}>{step.action}</span> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
