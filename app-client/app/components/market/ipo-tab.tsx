"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { Sparkline } from "@/app/components/common/sparkline";
import { getIconUrl } from "@/app/lib/normalizers";
import { formatCountdown } from "@/app/lib/market-clock";
import { unitLabel } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { money } from "@/app/lib/time";
import { useNow } from "@/app/lib/use-now";
import {
  cancelIpoSubscription,
  compactCount,
  etMoment,
  fetchIpos,
  ipoErrorText,
  ipoStage,
  listingDay,
  subscribeIpo,
  type IpoEvent,
  type IpoTalent,
} from "@/app/lib/ipo";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/market/ipo-tab.module.scss";

const POLL_MS = 30_000;

/** Ticks while a window counts down; 1s precision only matters in the last hour. */
function Countdown({ at, now }: { at: string; now: number | null }) {
  if (now === null) return <>—</>;
  const seconds = Math.max(0, Math.round((Date.parse(at) - now) / 1000));
  if (seconds > 86_400 * 2) return <>{Math.floor(seconds / 86_400)}d {Math.floor((seconds % 86_400) / 3600)}h</>;
  return <>{formatCountdown(seconds, { withHours: true })}</>;
}

/** Her oshimark next to the ticker; a new talent's SVG may not be uploaded yet, so a miss shows the letter. */
function IpoMark({ talent, size = 16 }: { talent: IpoTalent; size?: number }) {
  const [missing, setMissing] = useState(false);
  const url = getIconUrl(talent.icon);
  if (!url || missing) return <Oshimark icon={null} symbol={talent.symbol} size={size} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} width={size} height={size} alt="" aria-hidden="true" className={styles.mark} onError={() => setMissing(true)} draggable={false} />;
}

function ChannelNumbers({ talent }: { talent: IpoTalent }) {
  const { channel, series } = talent;
  const subs = series.map((day) => day.subscribers ?? NaN);
  return (
    <div className={styles.channel}>
      <dl className={styles.numbers}>
        <div>
          <dt>Subscribers</dt>
          <dd>{compactCount(channel.latest?.subscribers)}</dd>
          {channel.week ? <small className={channel.week.subscribers >= 0 ? styles.up : styles.down}>{channel.week.subscribers >= 0 ? "+" : ""}{compactCount(channel.week.subscribers)} in {channel.week.days}d</small> : <small>first day</small>}
        </div>
        <div>
          <dt>Views</dt>
          <dd>{compactCount(channel.latest?.views)}</dd>
          {channel.week ? <small>+{compactCount(channel.week.views)} in {channel.week.days}d</small> : <small>&nbsp;</small>}
        </div>
        <div>
          <dt>Videos</dt>
          <dd>{compactCount(channel.latest?.videos)}</dd>
          {channel.week ? <small>+{channel.week.videos} in {channel.week.days}d</small> : <small>&nbsp;</small>}
        </div>
      </dl>
      <div className={styles.spark}>
        <Sparkline values={subs} tone="blue" fill dot width={120} height={34} className={styles.sparkSvg} />
        <small>{channel.days_tracked ? `Tracked ${channel.days_tracked} day${channel.days_tracked === 1 ? "" : "s"} · since ${listingDay(channel.tracked_since || "")}` : "Tracking starts with tonight's scrape"}</small>
      </div>
    </div>
  );
}

function SubscribeBox({ event, talent, onChanged }: { event: IpoEvent; talent: IpoTalent; onChanged: () => void }) {
  const { user } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  const mine = talent.mine?.status === "pending" ? talent.mine : null;
  const [shares, setShares] = useState<string>(() => String(mine?.requested_shares ?? Math.min(10, talent.player_cap ?? 10)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const price = talent.ipo_price ?? 0;
  const qty = Math.floor(Number(shares));
  const valid = Number.isFinite(qty) && qty >= 1 && (!talent.player_cap || qty <= talent.player_cap);
  const cost = valid ? qty * price : 0;
  const spendable = (portfolio?.cash_balance ?? 0) + (mine?.held_cash ?? 0);

  if (!event.window_open) return null;
  if (!user) {
    return (
      <p className={styles.note}>
        <Link href="/login">Sign in</Link> to subscribe.
      </p>
    );
  }

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await subscribeIpo(talent.symbol, qty);
      setMessage({ tone: "ok", text: `Subscribed for ${result.requested_shares.toLocaleString("en-US")} at ${money(result.price)}. ${money(result.held_cash)} is held until listing.` });
      void useProfileStore.getState().refreshTradingState();
      onChanged();
    } catch (error) {
      setMessage({ tone: "error", text: ipoErrorText(error) });
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await cancelIpoSubscription(talent.symbol);
      setMessage({ tone: "ok", text: `Cancelled. ${money(result.released_cash)} is back in your Cash.` });
      void useProfileStore.getState().refreshTradingState();
      onChanged();
    } catch (error) {
      setMessage({ tone: "error", text: ipoErrorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.subscribe}
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        void submit();
      }}
    >
      <label className={styles.qty}>
        <span>Shares</span>
        <input type="number" inputMode="numeric" min={1} max={talent.player_cap ?? undefined} step={1} value={shares} onChange={(change) => setShares(change.target.value)} aria-describedby={`ipo-cost-${talent.symbol}`} />
      </label>
      <p className={styles.cost} id={`ipo-cost-${talent.symbol}`}>
        <b>{money(cost)}</b>
        <small>
          {talent.player_cap ? `max ${talent.player_cap.toLocaleString("en-US")} · ` : ""}
          Cash {money(spendable)}
          {valid && cost > spendable ? " · not enough" : ""}
        </small>
      </p>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={!valid || busy || cost > spendable + 1e-9}>
          {mine ? (qty === mine.requested_shares ? "Subscribed" : "Change") : "Subscribe"}
        </button>
        {mine ? (
          <button type="button" className={styles.ghost} onClick={() => void cancel()} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
      {mine ? (
        <p className={styles.mine}>
          You asked for <b>{mine.requested_shares.toLocaleString("en-US")}</b> · {money(mine.held_cash)} held
        </p>
      ) : null}
      {message ? (
        <p className={styles.message} data-tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}

function OfferBlock({ event, talent, onChanged }: { event: IpoEvent; talent: IpoTalent; onChanged: () => void }) {
  if (event.status === "announced") {
    return (
      <div className={styles.offer} data-state="announced">
        <p className={styles.pending}>
          IPO price is set when the window opens, <b>{etMoment(event.window_opens_at)}</b>: her debut value less {event.discount_pct}%.
        </p>
      </div>
    );
  }
  const offered = talent.shares_offered ?? 0;
  const ratio = offered ? talent.subscribed_shares / offered : 0;
  if (event.status === "listed") {
    const mine = talent.mine;
    return (
      <div className={styles.offer}>
        <dl className={styles.terms}>
          <div>
            <dt>IPO price</dt>
            <dd>{money(talent.ipo_price)}</dd>
          </div>
          <div>
            <dt>Went out</dt>
            <dd>{(talent.shares_allocated ?? 0).toLocaleString("en-US")} sh</dd>
          </div>
          <div>
            <dt>Players</dt>
            <dd>{talent.subscribers.toLocaleString("en-US")}</dd>
          </div>
        </dl>
        {mine && mine.status === "allocated" ? (
          <p className={styles.mine}>
            You got <b>{mine.allocated_shares.toLocaleString("en-US")}</b> of {mine.requested_shares.toLocaleString("en-US")}
            {mine.refunded_cash > 0 ? ` · ${money(mine.refunded_cash)} refunded` : ""}
          </p>
        ) : null}
        <Link href={`/stocks/${talent.symbol}`} className={styles.trade}>
          Trade {talent.symbol} →
        </Link>
      </div>
    );
  }
  return (
    <div className={styles.offer}>
      <dl className={styles.terms}>
        <div>
          <dt>IPO price</dt>
          <dd>{money(talent.ipo_price)}</dd>
        </div>
        <div>
          <dt>Offered</dt>
          <dd>{offered.toLocaleString("en-US")} sh</dd>
        </div>
        <div>
          <dt>Subscribed</dt>
          <dd className={ratio > 1 ? styles.hot : undefined}>{ratio ? `${(ratio * 100).toFixed(ratio >= 10 ? 0 : 1)}%` : "0%"}</dd>
        </div>
      </dl>
      <div className={styles.meter} role="img" aria-label={`${talent.subscribed_shares} of ${offered} shares subscribed by ${talent.subscribers} players`}>
        <i style={{ width: `${Math.min(100, ratio * 100)}%` }} data-over={ratio > 1 || undefined} />
      </div>
      <p className={styles.meterNote}>
        {talent.subscribed_shares.toLocaleString("en-US")} of {offered.toLocaleString("en-US")} shares asked for by {talent.subscribers.toLocaleString("en-US")} player{talent.subscribers === 1 ? "" : "s"}
        {ratio > 1 ? " · oversubscribed: shared out pro rata" : ""}
      </p>
      <SubscribeBox key={`${talent.symbol}-${talent.mine?.updated_at ?? "none"}`} event={event} talent={talent} onChanged={onChanged} />
    </div>
  );
}

function TalentCard({ event, talent, onChanged }: { event: IpoEvent; talent: IpoTalent; onChanged: () => void }) {
  const { theme } = useTheme();
  const accent = talentAccent(talent.color, theme);
  return (
    <article className={styles.card} id={talent.symbol} style={{ "--tal": accent } as React.CSSProperties}>
      <header className={styles.cardHead}>
        <ArtSlot kind="keyart" symbol={talent.symbol} icon={null} accent={accent} width={88} className={styles.art} />
        <div className={styles.names}>
          <span className={styles.ticker}>
            <IpoMark talent={talent} />
            {talent.symbol}
          </span>
          <h3>{talent.name_english || talent.display_name}</h3>
          <p>
            {talent.name_japanese ? <span lang="ja">{talent.name_japanese}</span> : null}
            {talent.unit ? <span>{unitLabel(talent.unit)}</span> : null}
            {talent.birthday ? <span>Birthday {new Date(`2000-${talent.birthday}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span> : null}
          </p>
        </div>
        <nav className={styles.links} aria-label={`${talent.display_name} links`}>
          <a href={`https://www.youtube.com/channel/${talent.youtube_channel_id}`} target="_blank" rel="noreferrer">
            YouTube ↗
          </a>
          {talent.twitter_id ? (
            <a href={`https://x.com/${talent.twitter_id}`} target="_blank" rel="noreferrer">
              X ↗
            </a>
          ) : null}
        </nav>
      </header>
      <ChannelNumbers talent={talent} />
      <OfferBlock event={event} talent={talent} onChanged={onChanged} />
    </article>
  );
}

function EventBlock({ event, now, onChanged }: { event: IpoEvent; now: number | null; onChanged: () => void }) {
  const stage = ipoStage(event, now ?? 0);
  return (
    <section className={styles.event} aria-labelledby={`ipo-${event.id}`}>
      <header className={styles.eventHead}>
        <div>
          <span className={styles.stage} data-tone={stage.tone}>
            <i aria-hidden="true" />
            {stage.label}
          </span>
          <h2 id={`ipo-${event.id}`}>{event.title}</h2>
        </div>
        <dl className={styles.timeline}>
          <div data-done={event.status !== "announced" || undefined}>
            <dt>Window opens</dt>
            <dd>{etMoment(event.window_opens_at)}</dd>
          </div>
          <div data-done={(event.status === "open" && !event.window_open) || event.status === "listed" || undefined}>
            <dt>Window closes</dt>
            <dd>{etMoment(event.window_closes_at)}</dd>
          </div>
          <div data-done={event.status === "listed" || undefined}>
            <dt>Starts trading</dt>
            <dd>{listingDay(event.listing_date)}, 09:00 ET</dd>
          </div>
          {stage.next ? (
            <div className={styles.countdown} suppressHydrationWarning>
              <dt>{stage.next.label} in</dt>
              <dd>
                <Countdown at={stage.next.at} now={now} />
              </dd>
            </div>
          ) : null}
        </dl>
      </header>
      <div className={styles.cards}>
        {event.talents.map((talent) => (
          <TalentCard key={talent.listing_id} event={event} talent={talent} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

/** The IPO tab: talents coming to market, their channels as we track them, and the subscription window. */
export function IpoTab() {
  const now = useNow();
  const { user } = useAuth();
  const [events, setEvents] = useState<IpoEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchIpos()
      .then((data) => {
        setEvents(data.events);
        setError(null);
      })
      .catch((caught) => setError(ipoErrorText(caught)));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load, user?.id]);

  useEffect(() => {
    if (user) void useProfileStore.getState().refreshTradingState();
  }, [user]);

  return (
    <div className={styles.tab}>
      <div className={styles.lede}>
        <div>
          <div className={styles.kick}>IPO · new talents</div>
          <h2>New talents come to market here first.</h2>
          <p>
            When hololive debuts someone, we start tracking her channel right away. Before she lists there&apos;s a window to <b>subscribe</b> for shares at
            the IPO price with Cash, held until listing like a queued buy. If more is asked for than offered, everyone gets a share of it (at least one each) and
            the rest of the cash comes back. She starts trading at the 09:00 settlement on her listing day, opening at the IPO price.
          </p>
        </div>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {events === null && !error ? <p className={styles.empty}>Loading…</p> : null}
      {events && !events.length ? (
        <p className={styles.empty}>No IPOs right now. When new talents debut, they show up here first, with their channel numbers, before they list.</p>
      ) : null}
      {events?.map((event) => (
        <EventBlock key={event.id} event={event} now={now} onChanged={load} />
      ))}
    </div>
  );
}
