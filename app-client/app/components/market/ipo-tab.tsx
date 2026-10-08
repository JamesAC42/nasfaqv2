"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Sparkline } from "@/app/components/common/sparkline";
import { IpoMark } from "@/app/components/market/ipo-mark";
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

const POLL_OPEN_MS = 15_000;
const POLL_MS = 60_000;
const QUICK_AMOUNTS = [50, 100];

/** Ticks while a window counts down; 1s precision only matters in the last day. */
function Countdown({ at, now }: { at: string; now: number | null }) {
  if (now === null) return <>—</>;
  const seconds = Math.max(0, Math.round((Date.parse(at) - now) / 1000));
  if (seconds > 86_400 * 2) return <>{Math.floor(seconds / 86_400)}d {Math.floor((seconds % 86_400) / 3600)}h</>;
  return <>{formatCountdown(seconds, { withHours: true })}</>;
}

const fmt = (value: number) => Math.round(value).toLocaleString("en-US");

/** What she'd get at close if demand stayed as it is, with her request at `qty`. */
function estimateFill(talent: IpoTalent, qty: number) {
  const offered = talent.shares_offered ?? 0;
  const demand = talent.subscribed_shares - (talent.mine?.status === "pending" ? talent.mine.requested_shares : 0) + qty;
  if (!offered || demand <= offered) return qty;
  return Math.min(qty, Math.max(1, Math.floor((qty * offered) / demand)));
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
          {channel.week ? (
            <small className={channel.week.subscribers >= 0 ? styles.up : styles.down}>
              {channel.week.subscribers >= 0 ? "+" : ""}
              {compactCount(channel.week.subscribers)} in {channel.week.days}d
            </small>
          ) : (
            <small>first day</small>
          )}
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
        <small>{channel.days_tracked ? `Subscribers, ${channel.days_tracked} day${channel.days_tracked === 1 ? "" : "s"} tracked (since ${listingDay(channel.tracked_since || "")})` : "Tracking starts with tonight's scrape"}</small>
      </div>
    </div>
  );
}

/** Asked for vs offered: everyone else in blue, you in her colour, and the offering line once it's oversubscribed. */
function DemandBar({ talent }: { talent: IpoTalent }) {
  const offered = talent.shares_offered ?? 0;
  const mine = talent.mine?.status === "pending" ? talent.mine.requested_shares : 0;
  const total = talent.subscribed_shares;
  const scale = Math.max(offered, total, 1);
  const ratio = offered ? total / offered : 0;
  return (
    <div className={styles.demand}>
      <div className={styles.bar} role="img" aria-label={`${fmt(total)} of ${fmt(offered)} shares asked for by ${talent.subscribers} players`}>
        <i className={styles.others} style={{ width: `${((total - mine) / scale) * 100}%` }} />
        <i className={styles.yours} style={{ width: `${(mine / scale) * 100}%` }} />
        {total > offered ? <b className={styles.line} style={{ left: `${(offered / scale) * 100}%` }} aria-hidden="true" /> : null}
      </div>
      <p className={styles.demandNote}>
        <span>
          <b>{fmt(total)}</b> of {fmt(offered)} asked for · {talent.subscribers} player{talent.subscribers === 1 ? "" : "s"}
        </span>
        {ratio > 1 ? <span className={styles.hotTag}>×{ratio.toFixed(ratio >= 10 ? 0 : 1)} oversubscribed</span> : null}
      </p>
    </div>
  );
}

/**
 * Your order while the window is open. The amount stops at the most you can ask for (the per-player
 * cap, or what your Cash covers) and says which; the estimate shows what you'd get if it closed now.
 * The layout never changes height as you edit or submit.
 */
function OrderPanel({ event, talent, onChanged }: { event: IpoEvent; talent: IpoTalent; onChanged: () => void }) {
  const portfolio = useProfileStore((state) => state.portfolio);
  const mine = talent.mine?.status === "pending" ? talent.mine : null;
  const price = talent.ipo_price ?? 0;
  const cap = talent.player_cap ?? Number.POSITIVE_INFINITY;
  const free = portfolio?.cash_balance ?? null;
  const budget = (free ?? 0) + (mine?.held_cash ?? 0);
  const affordable = price > 0 ? Math.floor((budget + 1e-9) / price) : 0;
  const maxQty = Math.max(0, Math.min(cap, affordable));
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);

  const fallback = mine?.requested_shares ?? Math.min(10, Math.max(maxQty, 1));
  const text = draft ?? String(fallback);
  const raw = Math.floor(Number(text));
  const typed = Number.isFinite(raw) ? raw : 0;
  const qty = Math.max(0, Math.min(typed, maxQty));
  const limit = typed > cap ? "cap" : typed > affordable ? "cash" : null;
  const cost = qty * price;
  const delta = cost - (mine?.held_cash ?? 0);
  const same = Boolean(mine && qty === mine.requested_shares);
  const fill = estimateFill(talent, qty);

  const set = (value: number) => {
    setError(null);
    setDraft(String(Math.max(0, Math.min(Math.round(value), maxQty))));
  };

  const submit = async () => {
    if (busy || qty < 1 || same) return;
    setBusy(true);
    setError(null);
    try {
      await subscribeIpo(talent.symbol, qty);
      setDraft(String(qty));
      setPulse((value) => value + 1);
      void useProfileStore.getState().refreshTradingState();
      onChanged();
    } catch (caught) {
      setError(ipoErrorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (busy || !mine) return;
    setBusy(true);
    setError(null);
    try {
      await cancelIpoSubscription(talent.symbol);
      void useProfileStore.getState().refreshTradingState();
      onChanged();
    } catch (caught) {
      setError(ipoErrorText(caught));
    } finally {
      setBusy(false);
    }
  };

  let hint: React.ReactNode;
  if (maxQty < 1) hint = <span className={styles.warnText}>Your Cash doesn&apos;t cover a share at {money(price)}.</span>;
  else if (limit === "cap")
    hint = (
      <span className={styles.warnText}>
        {fmt(cap)} is the most one player can ask for ({event.player_cap_pct}% of the offering).
      </span>
    );
  else if (limit === "cash") hint = <span className={styles.warnText}>Your Cash covers {fmt(affordable)}.</span>;
  else if (qty < 1) hint = "Pick how many shares you want.";
  else if (fill >= qty) hint = <>If it closed now you&apos;d get all {fmt(qty)}.</>;
  else hint = <>If it closed now you&apos;d get about {fmt(fill)} of {fmt(qty)}.</>;

  const label = busy
    ? "Working…"
    : qty < 1
      ? "Pick an amount"
      : same
        ? `You're in for ${fmt(qty)}`
        : mine
          ? `Change to ${fmt(qty)} · ${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))}`
          : `Subscribe · ${money(cost)}`;

  return (
    <form
      className={styles.order}
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        void submit();
      }}
    >
      <p className={styles.status} data-in={mine ? "" : undefined} key={pulse} data-pulse={pulse > 0 || undefined}>
        {mine ? (
          <>
            <b>✓ You&apos;re in</b>
            <span>
              {fmt(mine.requested_shares)} sh · {money(mine.held_cash)} held
            </span>
          </>
        ) : (
          <>
            <b>Your order</b>
            <span>up to {Number.isFinite(cap) ? fmt(cap) : "—"} sh each</span>
          </>
        )}
      </p>

      <div className={styles.amount}>
        <div className={styles.stepper}>
          <button type="button" onClick={() => set(qty - 1)} disabled={busy || qty <= 1} aria-label="One fewer share">
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={maxQty || undefined}
            step={1}
            value={text}
            aria-label={`${talent.symbol} shares to ask for`}
            onChange={(change) => {
              setError(null);
              setDraft(change.target.value);
            }}
            onBlur={() => setDraft(String(Math.max(Math.min(qty, maxQty), maxQty ? 1 : 0)))}
          />
          <button type="button" onClick={() => set(qty + 1)} disabled={busy || qty >= maxQty} aria-label="One more share">
            +
          </button>
        </div>
        <div className={styles.quick} role="group" aria-label="Quick amounts">
          {QUICK_AMOUNTS.filter((amount) => amount < maxQty).map((amount) => (
            <button key={amount} type="button" onClick={() => set(amount)} aria-pressed={qty === amount} disabled={busy}>
              {amount}
            </button>
          ))}
          <button type="button" onClick={() => set(maxQty)} aria-pressed={qty === maxQty && maxQty > 0} disabled={busy || maxQty < 1}>
            Max
          </button>
        </div>
      </div>

      <input
        type="range"
        className={styles.slider}
        min={maxQty ? 1 : 0}
        max={Math.max(maxQty, 1)}
        step={1}
        value={Math.max(qty, maxQty ? 1 : 0)}
        disabled={busy || maxQty < 1}
        onChange={(change) => set(Number(change.target.value))}
        aria-label={`${talent.symbol} shares`}
      />

      <div className={styles.sum}>
        <span>
          {fmt(qty)} × {money(price)}
        </span>
        <b>{money(cost)}</b>
      </div>
      <p className={styles.hint}>{hint}</p>
      <p className={styles.cash}>
        Cash {money(free)}
        {free !== null && !same && qty > 0 ? <> → {money(free - delta)}</> : null}
      </p>

      <div className={styles.actions}>
        <button type="submit" className={same ? styles.done : styles.primary} disabled={busy || qty < 1 || same}>
          {label}
        </button>
        {mine ? (
          <button type="button" className={styles.ghost} onClick={() => void withdraw()} disabled={busy}>
            Withdraw
          </button>
        ) : null}
      </div>
      <p className={styles.error} role="alert">
        {error ?? ""}
      </p>
    </form>
  );
}

function OfferBlock({ event, talent, onChanged }: { event: IpoEvent; talent: IpoTalent; onChanged: () => void }) {
  const { user } = useAuth();
  if (event.status === "announced") {
    return (
      <div className={styles.offer}>
        <p className={styles.pending}>
          The IPO price is set when the window opens, <b>{etMoment(event.window_opens_at)}</b>: her debut value less {event.discount_pct}%.
        </p>
      </div>
    );
  }
  const offered = talent.shares_offered ?? 0;
  const ratio = offered ? talent.subscribed_shares / offered : 0;
  const terms = (
    <dl className={styles.terms}>
      <div>
        <dt>IPO price</dt>
        <dd>{money(talent.ipo_price)}</dd>
      </div>
      <div>
        <dt>{event.status === "listed" ? "Went out" : "Offered"}</dt>
        <dd>{fmt(event.status === "listed" ? (talent.shares_allocated ?? 0) : offered)} sh</dd>
      </div>
      <div>
        <dt>Demand</dt>
        <dd className={ratio > 1 ? styles.hot : undefined}>{ratio > 1 ? `×${ratio.toFixed(ratio >= 10 ? 0 : 1)}` : `${Math.round(ratio * 100)}%`}</dd>
      </div>
    </dl>
  );
  if (event.status === "listed") {
    const mine = talent.mine;
    return (
      <div className={styles.offer}>
        {terms}
        {mine && mine.status === "allocated" ? (
          <p className={styles.status} data-in="">
            <b>✓ You got {fmt(mine.allocated_shares)}</b>
            <span>
              of {fmt(mine.requested_shares)}
              {mine.refunded_cash > 0 ? ` · ${money(mine.refunded_cash)} back` : ""}
            </span>
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
      {terms}
      <DemandBar talent={talent} />
      {!event.window_open ? (
        <p className={styles.pending}>The window has closed. Shares are handed out at the 09:00 settlement.</p>
      ) : user ? (
        <OrderPanel event={event} talent={talent} onChanged={onChanged} />
      ) : (
        <p className={styles.pending}>
          <Link href="/login">Sign in</Link> to subscribe.
        </p>
      )}
    </div>
  );
}

function TalentCard({ event, talent, onChanged }: { event: IpoEvent; talent: IpoTalent; onChanged: () => void }) {
  const { theme } = useTheme();
  const accent = talentAccent(talent.color, theme);
  const avatar = talent.youtube_channel_icon_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.avatar} src={talent.youtube_channel_icon_url} alt="" referrerPolicy="no-referrer" loading="lazy" />
  ) : undefined;
  return (
    <article className={styles.card} id={talent.symbol} style={{ "--tal": accent } as React.CSSProperties}>
      <header className={styles.cardHead}>
        <ArtSlot kind="keyart" symbol={talent.symbol} icon={null} accent={accent} width={88} className={styles.art} fallback={avatar} />
        <div className={styles.names}>
          <span className={styles.ticker}>
            <IpoMark oshimarkUrl={talent.oshimark_url} icon={talent.icon} symbol={talent.symbol} size={20} />
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

  // Livelier while a window is open, so demand moves as people subscribe.
  const anyOpen = Boolean(events?.some((event) => event.window_open));
  useEffect(() => {
    load();
    const timer = setInterval(load, anyOpen ? POLL_OPEN_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [load, user?.id, anyOpen]);

  useEffect(() => {
    if (user) void useProfileStore.getState().refreshTradingState();
  }, [user]);

  return (
    <div className={styles.tab}>
      <div className={styles.lede}>
        <div className={styles.kick}>IPO · new talents</div>
        <h2>New talents come to market here first.</h2>
        <p>
          We start tracking a new talent&apos;s channel the day she&apos;s announced. Before she lists there&apos;s a window to <b>subscribe</b> at the IPO
          price with Cash (held until listing, like a queued buy). Oversubscribed? Everyone gets a fair share, at least one, and the rest of the cash comes back.
          She starts trading at the 09:00 settlement on listing day, opening at the IPO price.
        </p>
      </div>
      {error ? (
        <p className={styles.loadError} role="alert">
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
