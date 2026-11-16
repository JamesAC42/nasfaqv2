"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Term } from "@/app/components/common/tip";
import { IPO_ROOKIE_DAYS, SHARES_PER_WINDOW, STARTER_CASH, TRADE_FEE } from "@/app/components/how-to-play/content";
import { etMoment, ipoWindow, type IpoEvent } from "@/app/lib/ipo";
import { ipoSteps, localMoment, rangeText } from "@/app/lib/ipo-guide.mjs";
import styles from "@/app/components/market/ipo-guide.module.scss";

// The IPO page's explanations: the three steps and where this IPO is in them, "How this IPO works",
// and the FAQ. Every number comes from the event (api/src/services/ipo.js) or the rule constants in
// how-to-play/content.ts.

const FEE = `${Math.round(TRADE_FEE * 100)}%`;

/** Facts about one IPO the copy needs, in the viewer's own time once the page is running. */
function useFacts(event: IpoEvent, now: number | null) {
  // Server render and hydration show ET; the viewer's zone only exists in the browser.
  const when = (value: string | Date) => (now === null ? etMoment(value) : localMoment(value));
  const listing = ipoWindow(event.listing_date, 0)?.closes ?? new Date(event.window_closes_at);
  const talents = event.talents;
  const symbols = talents.map((talent) => talent.symbol);
  return {
    opened: event.status !== "announced",
    count: talents.length,
    symbolList: symbols.length > 1 ? `${symbols.slice(0, -1).join(", ")} and ${symbols[symbols.length - 1]}` : (symbols[0] ?? ""),
    capRange: rangeText(talents.map((talent) => talent.player_cap)),
    offeredRange: rangeText(talents.map((talent) => talent.shares_offered)),
    oversubscribed: talents.filter((talent) => (talent.shares_offered ?? 0) > 0 && talent.subscribed_shares > (talent.shares_offered ?? 0)).length,
    opens: when(event.window_opens_at),
    closes: when(event.window_closes_at),
    lists: when(listing),
    /** When it actually listed (the 09:00 run, or an admin's "List now"). */
    listed: when(event.listed_at ?? listing),
    local: now !== null,
  };
}

// ── The three steps ──────────────────────────────────────────────────────

const STEP_TITLES = { subscribe: "Subscribe", allocate: "Window closes, shares handed out", trade: "Listing and trading" } as const;

/** Subscribe → window closes and shares are handed out → listing and trading, with where this IPO is now. */
export function IpoSteps({ event, now }: { event: IpoEvent; now: number | null }) {
  const facts = useFacts(event, now);
  // Before the clock starts (server render), the cached body's own reading of the window decides.
  const { phase, steps } = ipoSteps(event, now ?? (event.window_open ? 0 : Number.POSITIVE_INFINITY));
  const detail: Record<(typeof steps)[number]["key"], ReactNode> = {
    subscribe:
      phase === "upcoming" ? (
        <>Opens {facts.opens}. Ask for shares at the IPO price; the cost is held from your Cash.</>
      ) : phase === "subscribe" ? (
        <>Open until {facts.closes}. Change or withdraw any time before then.</>
      ) : (
        <>Closed {facts.closes}.</>
      ),
    allocate: <>{facts.closes}. Everyone gets what they asked for if it fits; if not, shares split in proportion, at least 1 each. Cash for shares you don’t get comes back.</>,
    trade:
      phase === "trading" ? (
        <>Listed {facts.listed}. It trades like any stock now.</>
      ) : (
        <>{facts.lists}, at the daily settlement. Each stock opens at its IPO price; trading starts with the first batch after.</>
      ),
  };
  return (
    <ol className={styles.steps} aria-label="IPO steps" suppressHydrationWarning>
      {steps.map((step, index) => (
        <li key={step.key} data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
          <span className={styles.stepNum} aria-hidden="true">
            {step.state === "done" ? "✓" : index + 1}
          </span>
          <div>
            <h3>
              {STEP_TITLES[step.key]}
              {step.state === "current" ? <em className={styles.now}>Now</em> : null}
              {step.state === "done" ? <span className={styles.sr}> (done)</span> : null}
            </h3>
            <p>{detail[step.key]}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── How this IPO works ───────────────────────────────────────────────────

function demandLine(oversubscribed: number, count: number) {
  if (!oversubscribed) return "Right now, everything asked for fits.";
  if (count === 1) return "Right now it’s oversubscribed.";
  if (oversubscribed === count) return `Right now all ${count} are oversubscribed.`;
  return `Right now ${oversubscribed} of ${count} ${oversubscribed === 1 ? "is" : "are"} oversubscribed.`;
}

/**
 * Plain-language rules for this IPO, with its own numbers. Open until the viewer has subscribed to
 * one of its talents; then it folds away (they can open it again). `known` is false while a signed-in
 * viewer's subscriptions are still loading, so it doesn't snap shut a moment after the page appears.
 */
export function IpoExplainer({ event, now, known }: { event: IpoEvent; now: number | null; known: boolean }) {
  const facts = useFacts(event, now);
  const subscribed = event.talents.some((talent) => talent.mine && talent.mine.status !== "cancelled");
  // The default is fixed the first time we know, so subscribing on this visit doesn't fold it away
  // under the viewer; after that, their own toggle wins.
  const [initial, setInitial] = useState<boolean | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  if (known && initial === null) setInitial(!subscribed);
  const shown = open ?? initial ?? true;

  return (
    <details
      className={styles.guide}
      open={shown}
      onToggle={(toggle) => {
        const next = (toggle.currentTarget as HTMLDetailsElement).open;
        if (next !== shown) setOpen(next);
      }}
    >
      <summary>
        <span className={styles.guideTitle}>How this IPO works</span>
        <span className={styles.guideAside}>{shown ? "Hide" : "Show"}</span>
        <i aria-hidden="true" />
      </summary>
      <div className={styles.blocks} suppressHydrationWarning>
        <section>
          <span className={styles.key}>The idea</span>
          <h3>What an IPO is</h3>
          <ul>
            <li>
              This IPO brings {facts.count} new talent{facts.count === 1 ? "" : "s"} to the market: {facts.symbolList}. Until they list, nobody can trade them.
            </li>
            <li>Subscribing is the one chance to buy before anyone else, at the IPO price.</li>
            <li>
              {facts.opened ? "The IPO price was set when the window opened:" : "The IPO price is set when the window opens:"} each talent’s fair value that day, less{" "}
              <b>{event.discount_pct}%</b>.
            </li>
          </ul>
        </section>
        <section>
          <span className={styles.key}>Your order</span>
          <h3>What subscribing does</h3>
          <ul>
            <li>Pick how many shares of each talent you want. The full cost, shares × IPO price, is taken from your Cash and held the moment you subscribe.</li>
            <li>
              Change the amount or withdraw any time until the window closes{facts.opened ? <>, {facts.closes}</> : null}. Asking for less, or withdrawing, gives the difference back
              right away.
            </li>
            {facts.capRange ? (
              <li>
                You can ask for up to <b>{facts.capRange} shares</b> of each talent ({event.player_cap_pct}% of its offering).
              </li>
            ) : (
              <li>You can ask for up to {event.player_cap_pct}% of each talent’s offering. The number of shares is set when the window opens.</li>
            )}
            <li>Cash only: Credit can’t pay for IPO shares. There’s no fee.</li>
          </ul>
        </section>
        <section>
          <span className={styles.key}>Allocation</span>
          <h3>How shares are handed out</h3>
          <ul>
            <li>
              {event.offering_pct}% of each talent’s starting max shares are on offer{facts.offeredRange ? <>: <b>{facts.offeredRange} shares</b> each</> : null}.
            </li>
            <li>When the window closes, if everything asked for fits, everyone gets all they asked for.</li>
            <li>
              If more is asked for than offered, everyone gets a share in proportion to their request, rounded down, and at least 1. Leftover shares go to the largest remainders. If
              more players ask than there are shares, the first to subscribe get 1 each.
            </li>
            <li>Cash for shares you don’t get comes back to your Cash at listing, and a notification tells you what you got.</li>
            {event.status === "open" && facts.count ? <li className={styles.live}>{demandLine(facts.oversubscribed, facts.count)}</li> : null}
          </ul>
        </section>
        <section>
          <span className={styles.key}>Listing</span>
          <h3>What happens at listing</h3>
          <ul>
            <li>
              <b suppressHydrationWarning>{facts.lists}</b>
              {facts.local ? " your time" : ""}: the daily settlement on listing day. Your shares land in your portfolio at the IPO price, and each stock opens at its IPO price.
            </li>
            <li>
              Then it trades like any stock: orders fill in <Term k="batch">10-minute batches</Term>, buys at the ask and sells at the bid (the <Term k="spread">spread</Term>), with a{" "}
              {FEE} <Term k="fee">fee</Term>. The four daily <Term k="tick">ticks</Term> pull the price toward fair value, starting with the Open tick that same hour.
            </li>
            <li>
              You can trade up to {SHARES_PER_WINDOW} shares per tick window. The IPO shares you get don’t count toward it.
            </li>
            <li>
              <Term k="rookie">Rookies</Term> pay no weekly dividend and charge no share fee for their first {IPO_ROOKIE_DAYS} days (four Saturday reviews), and their max shares
              don’t drop below what players hold.
            </li>
          </ul>
        </section>
        <section className={styles.expect}>
          <span className={styles.key}>Be ready</span>
          <h3>What to expect</h3>
          <ul>
            <li>
              The price can fall below the IPO price after listing. Fair value is repriced every morning, so by listing day it may sit further above the IPO price, or below it. The
              ticks pull toward it either way.
            </li>
            <li>Waiting to buy after listing costs more: you pay the ask plus the {FEE} fee, which at the opening price comes to more than the IPO price.</li>
            <li>Selling at the opening price gets the bid less the {FEE} fee, a little under the IPO price.</li>
          </ul>
        </section>
      </div>
      <p className={styles.more}>
        <Link href="/how-to-play#ipo">How to play: IPOs →</Link>
        <Link href="/how-to-play#trading">How trading works →</Link>
      </p>
    </details>
  );
}

// ── FAQ ──────────────────────────────────────────────────────────────────

/** What new players ask about an IPO, answered with this one's numbers. */
export function IpoFaq({ event, now, signedIn }: { event: IpoEvent; now: number | null; signedIn: boolean }) {
  const facts = useFacts(event, now);
  const items: Array<{ q: string; a: ReactNode }> = [
    {
      q: "Will I get all the shares I asked for?",
      a: (
        <>
          Only if everything asked for fits in the offering{facts.offeredRange ? ` (${facts.offeredRange} shares per talent)` : ""}. If more is asked for than offered, everyone
          gets a share in proportion to their request, rounded down, and at least 1. Leftover shares go to the largest remainders. While the window is open, your order shows about
          what you’d get if it closed now. That changes as others subscribe.
        </>
      ),
    },
    {
      q: "When do I get my cash back?",
      a: (
        <>
          Anything you withdraw, or take off your request, comes back to your Cash right away while the window is open. Cash for shares you don’t get comes back at listing,{" "}
          <span suppressHydrationWarning>{facts.lists}</span>
          {facts.local ? " your time" : ""}. If an IPO is ever called off, all of it comes back.
        </>
      ),
    },
    {
      q: "Can I sell right away?",
      a: (
        <>
          Yes, once it lists. Trading starts with the first batch after the 09:00 ET settlement on listing day. A sell fills at the bid, a little under the price, less the {FEE} fee.
          It counts toward your {SHARES_PER_WINDOW} shares per tick window; the IPO shares you got don’t.
        </>
      ),
    },
    {
      q: "Why can’t I subscribe for more?",
      a: (
        <>
          Two limits. One player can ask for at most {event.player_cap_pct}% of a talent’s offering{facts.capRange ? ` (${facts.capRange} shares)` : ""}, so nobody takes the whole
          IPO. And the full cost is held from your Cash up front, so you can only ask for what your Cash covers. Credit doesn’t count.
        </>
      ),
    },
    {
      q: "Does a new stock pay dividends?",
      a: (
        <>
          Not at first. For its first {IPO_ROOKIE_DAYS} days (four Saturday reviews) a new listing pays no dividend and charges no share fee, and its max shares don’t drop below what
          players hold. After that it’s ranked with every other stock.
        </>
      ),
    },
    {
      q: "What if I’m not signed in?",
      a: signedIn ? (
        <>
          You can see everything here without an account: the talents, their channels, the IPO price and the demand. Subscribing needs an account with a verified email, and new
          players start with ${STARTER_CASH.toLocaleString("en-US")} Cash.
        </>
      ) : (
        <>
          You can see everything here, but subscribing needs an account with a verified email. <Link href="/login">Sign in</Link>, or <Link href="/register">make an account</Link>{" "}
          and start with ${STARTER_CASH.toLocaleString("en-US")} Cash.
        </>
      ),
    },
  ];
  return (
    <section className={styles.faq} aria-labelledby="ipo-faq">
      <h2 id="ipo-faq">IPO questions</h2>
      <div className={styles.faqList}>
        {items.map((item) => (
          <details key={item.q} className={styles.faqItem}>
            <summary>
              <span>{item.q}</span>
              <i aria-hidden="true" />
            </summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
