"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { etMoment, fetchIpos, ipoStage, listingDay, type IpoEvent } from "@/app/lib/ipo";
import { useNow } from "@/app/lib/use-now";
import styles from "@/app/components/market/ipo-banner.module.scss";

// IPOs that are coming or open, shared by the market tabs (one fetch a minute at most).
let cached: { at: number; events: IpoEvent[] } | null = null;
let inflight: Promise<IpoEvent[]> | null = null;

function loadIpos() {
  if (cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached.events);
  inflight ??= fetchIpos()
    .then((data) => {
      cached = { at: Date.now(), events: data.events };
      return data.events;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Announced or open IPOs (listed ones drop off). */
export function useUpcomingIpos() {
  const [events, setEvents] = useState<IpoEvent[]>(() => cached?.events.filter((event) => event.status === "announced" || event.status === "open") ?? []);
  useEffect(() => {
    let cancelled = false;
    loadIpos()
      .then((all) => !cancelled && setEvents(all.filter((event) => event.status === "announced" || event.status === "open")))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return events;
}

/** One line on the market floor while an IPO is coming or open. */
export function IpoBanner({ className }: { className?: string }) {
  const events = useUpcomingIpos();
  const now = useNow();
  const event = events.find((entry) => entry.window_open) ?? events[0];
  if (!event) return null;
  const stage = ipoStage(event, now ?? 0);
  const symbols = event.talents.map((talent) => talent.symbol).join(" · ");
  return (
    <Link href="/market/ipo" className={[styles.banner, className].filter(Boolean).join(" ")} data-open={event.window_open || undefined}>
      <span className={styles.tag}>
        <i aria-hidden="true" />
        IPO
      </span>
      <span className={styles.text}>
        <b>{event.title}</b> <span className={styles.symbols}>{symbols}</span>
      </span>
      <span className={styles.when} suppressHydrationWarning>
        {event.window_open ? `Subscriptions open · close ${etMoment(event.window_closes_at)}` : `${stage.label} · window opens ${etMoment(event.window_opens_at)} · lists ${listingDay(event.listing_date)}`}
      </span>
      <span className={styles.go} aria-hidden="true">
        →
      </span>
    </Link>
  );
}

/** For a ticker that isn't listed yet: where she is in her IPO, or the fallback text. */
export function ComingToMarketNote({ symbol, className, fallback }: { symbol: string; className?: string; fallback: string }) {
  const events = useUpcomingIpos();
  const event = events.find((entry) => entry.talents.some((talent) => talent.symbol === symbol));
  const talent = event?.talents.find((entry) => entry.symbol === symbol);
  if (!event || !talent) return <p className={className}>{fallback}</p>;
  return (
    <p className={className}>
      <b>{talent.name_english || talent.display_name}</b> is coming to market.{" "}
      {event.window_open ? `Subscriptions are open until ${etMoment(event.window_closes_at)}` : `Subscriptions open ${etMoment(event.window_opens_at)}`}, and {symbol} starts trading{" "}
      {listingDay(event.listing_date)} at 09:00 ET. <Link href={`/market/ipo#${symbol}`}>See the IPO →</Link>
    </p>
  );
}
