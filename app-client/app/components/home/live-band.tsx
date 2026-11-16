"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import { formatCountdown, formatEtTime, getMarketClock } from "@/app/lib/market-clock";
import { money, timeAgo } from "@/app/lib/time";
import { useNow } from "@/app/lib/use-now";
import { onMarketEvent } from "@/app/stores/market-store";
import { useSiteStore } from "@/app/stores/site-store";
import styles from "@/app/components/home/live-band.module.scss";

// The front page's proof of life: what players did in the last day (api/src/services/activity.js),
// the newest of each kind with its real time, and when the next order batch lands. Real rows only:
// a kind with nothing in the window isn't shown, and a quiet hour says it's quiet.

type Totals = {
  players: number;
  trades: number;
  traders: number;
  blackjack_hands: number;
  blackjack_players: number;
  card_pulls: number;
  card_pullers: number;
  prediction_bets: number;
  prediction_players: number;
  last_hour: number;
  last_action_at: string | null;
};

type Latest =
  | { kind: "trade"; at: string; username: string; side: string; quantity: number; symbol: string }
  | { kind: "blackjack"; at: string; username: string; outcome: string; net: number; table: string }
  | { kind: "card"; at: string; username: string; rarity: string; name: string; symbol: string }
  | { kind: "prediction"; at: string; username: string; side: string; outcome: string; cash: number; title: string; slug: string; pricing?: "lmsr" | "pool" };

type Activity = { window_hours: number; totals: Totals; latest: Latest[] };

const POLL_MS = 60_000;

const count = (value: number) => value.toLocaleString("en-US");
const plural = (value: number, one: string, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`;

function line(item: Latest): { tag: string; href: string; text: string } {
  switch (item.kind) {
    case "trade":
      return { tag: "Trade", href: `/stocks/${encodeURIComponent(item.symbol)}`, text: `${item.side === "sell" ? "sold" : "bought"} ${count(item.quantity)} ${item.symbol}` };
    case "blackjack": {
      const where = `at the ${item.table}`;
      const text =
        item.outcome === "blackjack"
          ? `hit blackjack ${where}, +${money(item.net)}`
          : item.outcome === "win"
            ? `won ${money(item.net)} ${where}`
            : item.outcome === "push"
              ? `pushed ${where}`
              : `lost ${money(Math.abs(item.net))} ${where}`;
      return { tag: "Blackjack", href: "/games/blackjack", text };
    }
    case "card":
      return { tag: "Gacha", href: "/games/cards", text: `pulled ${item.name} ${item.rarity}` };
    case "prediction":
      return {
        tag: "Prediction",
        href: item.pricing === "pool" ? `/predictions/pools/${encodeURIComponent(item.slug)}` : `/predictions/${encodeURIComponent(item.slug)}`,
        text: `${item.side === "sell" ? "sold" : "bet"} ${money(item.cash)} ${item.side === "sell" ? "of" : "on"} ${item.outcome} · ${item.title}`,
      };
  }
}

export function LiveBand() {
  const [data, setData] = useState<Activity | null>(null);
  const online = useSiteStore((state) => state.online);
  const now = useNow();
  const pending = useRef<number | null>(null);

  const fetchActivity = useCallback(() => {
    apiFetch<Activity>("/api/overview/activity")
      .then((result) => (result?.totals ? setData(result) : null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchActivity();
    const poll = () => document.visibilityState === "visible" && fetchActivity();
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    // A batch just landed: read again once the API's 30-second cache has had a moment.
    const off = onMarketEvent((payload) => {
      if (payload.type !== "market.trade_fills" && payload.type !== "market.trade_fill") return;
      if (pending.current !== null) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        fetchActivity();
      }, 5_000);
    });
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      if (pending.current !== null) window.clearTimeout(pending.current);
      off();
    };
  }, [fetchActivity]);

  if (!data || data.totals.players === 0) return null;
  const { totals } = data;
  const lastAt = totals.last_action_at ? Date.parse(totals.last_action_at) : NaN;
  // Nothing in the last hour (the API counts it; the band reads again every minute).
  const quiet = totals.last_hour === 0;
  const clock = now ? getMarketClock(now) : null;
  const tallies = [
    totals.trades ? { key: "trades", text: `${plural(totals.trades, "trade")} by ${plural(totals.traders, "player")}`, href: "/market/activity" } : null,
    totals.blackjack_hands ? { key: "blackjack", text: `${plural(totals.blackjack_hands, "blackjack hand")}`, href: "/games/blackjack" } : null,
    totals.card_pulls ? { key: "cards", text: `${plural(totals.card_pulls, "card pull")}`, href: "/games/cards" } : null,
    totals.prediction_bets ? { key: "predictions", text: `${plural(totals.prediction_bets, "prediction bet")}`, href: "/predictions" } : null,
  ].filter((entry): entry is { key: string; text: string; href: string } => entry !== null);

  return (
    <section className={styles.band} aria-labelledby="live-band-title">
      <header className={styles.head}>
        <h2 id="live-band-title" data-quiet={quiet || undefined}>
          {quiet ? "Quiet right now" : "Live on NASFAQ"}
        </h2>
        <span className={styles.sub} suppressHydrationWarning>
          {quiet && Number.isFinite(lastAt) ? `Last action ${timeAgo(totals.last_action_at, now ?? undefined)}. ` : ""}
          {plural(totals.players, "player")} in the last {data.window_hours} hours
          {online !== null && online > 1 ? ` · ${count(online)} online now` : ""}
        </span>
        {clock ? (
          <span className={styles.batch} suppressHydrationWarning>
            Next order batch {formatEtTime(clock.nextBatchAt)} ET · <b>{formatCountdown(clock.secondsToNextBatch, { withHours: false })}</b>
          </span>
        ) : null}
      </header>
      {tallies.length ? (
        <ul className={styles.tallies}>
          {tallies.map((entry) => (
            <li key={entry.key}>
              <Link href={entry.href} prefetch={false}>
                {entry.text}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {data.latest.length ? (
        <ol className={styles.latest} aria-label="Latest">
          {data.latest.slice(0, 4).map((item) => {
            const { tag, href, text } = line(item);
            return (
              <li key={item.kind}>
                <Link href={href} prefetch={false} className={styles.row}>
                  <i className={styles.tag} data-kind={item.kind}>
                    {tag}
                  </i>
                  <span className={styles.text}>
                    <b>{item.username}</b> {text}
                  </span>
                  <time className={styles.when} dateTime={item.at} suppressHydrationWarning>
                    {timeAgo(item.at, now ?? undefined)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : null}
      <Link href="/market/activity" className={styles.all} prefetch={false}>
        All market activity →
      </Link>
    </section>
  );
}
