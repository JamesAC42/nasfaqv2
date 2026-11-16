"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { FaBullseye } from "react-icons/fa6";
import { ReactionFace } from "@/app/components/common/reaction-face";
import { apiFetch } from "@/app/lib/api";
import { useFeature } from "@/app/lib/features";
import { unitName } from "@/app/lib/market-units";
import { chatRoomKind, compactCount, shortDuration, untilLabel } from "@/app/lib/streams";
import { talentAccent } from "@/app/lib/talent-color";
import { signedPct, toneOf } from "@/app/lib/time";
import type { MarketAsset } from "@/app/lib/types";
import { useTheme } from "@/app/providers/theme-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { MARKET_TIME_ZONE, wallClock, zonedInstant } from "@/app/lib/display-time.mjs";
import { useTimeFormat, type TimeFormat } from "@/app/lib/use-display-time";
import ls from "@/app/components/livestreams/livestreams.module.scss";
import styles from "@/app/components/livestreams/stream-calendar.module.scss";

// The stream calendar, a mode of the Livestreams page (/livestreams?view=calendar): listed talents'
// streams for the next week, laid out by day and time in the viewer's own time zone (or New York
// market time, for a player who picked it under the timezone-setting flag). A week grid on
// wide screens, a day list on phones. Each stream links to the talent's stock; one with an open peak
// pool carries a target mark (and a link on phones).
// Same data as the stream-peak pools (GET /api/livestreams/calendar).

export type CalendarStream = {
  video_id: string;
  state: "live" | "upcoming" | "late" | "ended";
  title: string | null;
  starts_at: string | null;
  ended_at: string | null;
  peak_viewers: number | null;
  symbol: string;
  display_name: string;
  icon: string | null;
  color: string | null;
  prediction: { slug: string; title: string; pricing: "lmsr" | "pool" } | null;
};

/** Where a stream's open bet lives: a pool has its own page. */
const betHref = (prediction: NonNullable<CalendarStream["prediction"]>) =>
  prediction.pricing === "pool" ? `/predictions/pools/${encodeURIComponent(prediction.slug)}` : `/predictions/${encodeURIComponent(prediction.slug)}`;

type Calendar = { generated_at: string; streams: CalendarStream[] };
/** `date` is noon UTC on the day's calendar date: read it with timeZone "UTC" / getUTC*, whatever zone the calendar is in. */
type Day = { key: string; start: number; end: number; date: Date; index: number };

const DAYS = 7;
const REFRESH_MS = 60_000;
/** Four-hour bands of the viewer's day: each sits in one half of the clock, so the band names AM or PM. */
const BANDS = [0, 4, 8, 12, 16, 20];

const pad = (n: number) => String(n).padStart(2, "0");
const localDayKey = (ms: number, zone: string) => {
  const d = wallClock(ms, zone);
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
};
const firstName = (name: string) => name.trim().split(/\s+/).pop() ?? name;
const hourText = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
const bandText = (band: number) => `${hourText(band)} – ${hourText((band + 4) % 24)}`;
const clockText = (ms: number, zone: string) => {
  const d = wallClock(ms, zone);
  return `${d.hour % 12 === 0 ? 12 : d.hour % 12}:${pad(d.minute)}`;
};
/** "9:00 PM", in the browser's zone before the timezone-setting flag. `label` names the zone (the calendar says it once instead). */
const timeText = (tf: TimeFormat, ms: number, label = true) => tf.format(ms, { hour: "numeric", minute: "2-digit" }, { was: "local", label });

/** The next seven days, starting today, in `zone` (DST-safe: calendar days, not 24h steps). */
function weekFrom(now: number, zone: string): Day[] {
  const today = wallClock(now, zone);
  return Array.from({ length: DAYS }, (_, index) => {
    // Date.UTC carries a day past the month's end into the next month.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + index, 12));
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    return { key: `${y}-${pad(m)}-${pad(d)}`, start: zonedInstant(y, m, d, 0, 0, zone), end: zonedInstant(y, m, d + 1, 0, 0, zone), date, index };
  });
}

function dayName(day: Day, style: "short" | "long" = "short") {
  if (day.index === 0) return "Today";
  if (day.index === 1) return "Tomorrow";
  return day.date.toLocaleDateString("en-US", { weekday: style, timeZone: "UTC" });
}

function stateLine(stream: CalendarStream, at: number, now: number) {
  if (stream.state === "live") return `Live · ${shortDuration((now - at) / 1000)}${stream.peak_viewers ? ` · ${compactCount(stream.peak_viewers)} peak` : ""}`;
  if (stream.state === "ended") return `Ended${stream.peak_viewers ? ` · ${compactCount(stream.peak_viewers)} peak` : ""}`;
  return untilLabel(stream.starts_at, now);
}

// A 30-second clock shared by the page (useNow ticks every second; the week doesn't need that).
// Null during SSR and hydration: every time on the page is the viewer's own.
let clockNow = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((notify) => notify());
    }, 30_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
const useClock = () => useSyncExternalStore(subscribeClock, () => clockNow || null, () => null);
const noSubscribe = () => () => {};
const useTimeZone = () => useSyncExternalStore(noSubscribe, () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "", () => "");

/**
 * The zone the calendar lays out in, and the formatter: New York for a player who picked market time
 * (timezone-setting flag), else the browser's own, as it always was.
 */
function useCalendarZone() {
  const tf = useTimeFormat();
  const browser = useTimeZone();
  return { tf, zone: tf.mode === "market" ? MARKET_TIME_ZONE : browser || tf.browserZone };
}

function useCalendar() {
  const [data, setData] = useState<Calendar | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<Calendar>("/api/livestreams/calendar?days=7").then(
        (value) => {
          if (cancelled) return;
          setData(value);
          setError(null);
        },
        (reason) => {
          if (!cancelled) setError(String((reason as Error)?.message || reason));
        }
      );
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  return { data, error };
}

/**
 * The calendar mode of the Livestreams page (behind the stream-calendar flag): the page's own search,
 * holdings and unit filters apply here too.
 */
export function StreamCalendar({ query, units, mine }: { query: string; units: string[]; mine: boolean }) {
  const { data, error } = useCalendar();
  const assets = useMarketStore((state) => state.assets);
  const portfolio = useProfileStore((state) => state.portfolio);
  const now = useClock();
  const { tf, zone } = useCalendarZone();
  const [picked, setPicked] = useState(0);

  const bySymbol = useMemo(() => new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset])), [assets]);
  const held = useMemo(() => new Set((portfolio?.holdings ?? []).filter((row) => row.quantity > 0).map((row) => row.symbol.toUpperCase())), [portfolio]);

  const minute = now === null ? null : Math.floor(now / 60_000);
  const streams = useMemo(() => {
    if (!data || minute === null) return [];
    const at = minute * 60_000;
    const needle = query.trim().toLowerCase();
    return data.streams.filter((stream) => {
      if (!stream.starts_at) return false;
      // Free-chat rooms and slots left open on purpose aren't streams.
      if ((stream.state === "upcoming" || stream.state === "late") && chatRoomKind({ title: stream.title ?? "", started_at: stream.starts_at }, at)) return false;
      const asset = bySymbol.get(stream.symbol.toUpperCase());
      if (units.length && !(asset && units.includes(unitName(asset.unit)))) return false;
      if (mine && !held.has(stream.symbol.toUpperCase())) return false;
      if (needle && !`${stream.display_name} ${stream.symbol} ${stream.title ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [bySymbol, data, held, mine, minute, query, units]);

  const week = useMemo(() => (minute === null ? [] : weekFrom(minute * 60_000, zone)), [minute, zone]);
  const byDay = useMemo(() => {
    const out = new Map<string, CalendarStream[]>();
    for (const stream of streams) {
      const key = localDayKey(Date.parse(stream.starts_at as string), zone);
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(stream);
    }
    return out;
  }, [streams, zone]);

  const live = useMemo(() => streams.filter((stream) => stream.state === "live"), [streams]);
  const upNext = useMemo(
    () => (now === null ? [] : streams.filter((stream) => (stream.state === "upcoming" || stream.state === "late") && Date.parse(stream.starts_at as string) > now - 2 * 3600_000).slice(0, 4)),
    [now, streams]
  );
  const filtering = units.length > 0 || Boolean(query.trim()) || mine;
  const day = week[Math.min(picked, week.length - 1)] ?? null;

  return (
    <>
      {error && !data ? <p className={ls.empty}>The calendar is unavailable right now ({error}).</p> : null}

      {now !== null && (live.length || upNext.length) ? <NowStrip live={live} upNext={upNext} now={now} bySymbol={bySymbol} /> : null}

      <div className={styles.legendRow}>
        <Legend bets={streams.some((stream) => stream.prediction)} />
        {zone ? <p className={styles.zone}>{tf.mode === "market" ? "Times in New York market time (ET)" : `Times in your time zone (${zone.replace(/_/g, " ")})`}</p> : null}
      </div>

      {now === null || !data ? (
        <div className={styles.skeleton} aria-hidden="true" />
      ) : (
        <>
          <WeekGrid week={week} byDay={byDay} now={now} />
          <div className={styles.phone}>
            <div className={styles.dayPicker} role="tablist" aria-label="Day">
              {week.map((entry) => {
                const count = (byDay.get(entry.key) ?? []).length;
                return (
                  <button key={entry.key} type="button" role="tab" aria-selected={entry.index === day?.index} onClick={() => setPicked(entry.index)} className={styles.dayPill}>
                    <span>{entry.index === 0 ? "Today" : entry.date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span>
                    <b>{entry.date.getUTCDate()}</b>
                    <small>{count ? `${count}` : "—"}</small>
                  </button>
                );
              })}
            </div>
            {day ? <DayList day={day} streams={byDay.get(day.key) ?? []} now={now} bySymbol={bySymbol} filtering={filtering} /> : null}
          </div>
          {!streams.length ? <p className={ls.empty}>{filtering ? "No streams match these filters." : "Nothing on the schedule yet."}</p> : null}
        </>
      )}
    </>
  );
}

// ── The market floor's box ───────────────────────────────────────────────

/** Who's live and who's next, for the market floor, with the way into the calendar. */
export function StreamsUpNext(props: { className?: string; headClass?: string; asideClass?: string }) {
  // Behind the stream-calendar flag (api/src/features), like the calendar it reads.
  return useFeature("stream-calendar") ? <UpNextBox {...props} /> : null;
}

function UpNextBox({ className, headClass, asideClass }: { className?: string; headClass?: string; asideClass?: string }) {
  const { data } = useCalendar();
  const now = useClock();
  const tf = useTimeFormat();
  const real = (data?.streams ?? []).filter((stream) => stream.starts_at && !((stream.state === "upcoming" || stream.state === "late") && now !== null && chatRoomKind({ title: stream.title ?? "", started_at: stream.starts_at }, now)));
  const live = real.filter((stream) => stream.state === "live");
  const next = now === null ? [] : real.filter((stream) => stream.state === "upcoming" && Date.parse(stream.starts_at as string) > now).slice(0, Math.max(2, 5 - live.length));
  const shown = [...live.slice(0, 3), ...next];
  return (
    <section className={className}>
      <div className={headClass}>
        <h2>On stream</h2>
        <span className={asideClass}>{live.length ? `${live.length} live now` : "next up"}</span>
      </div>
      <div className={styles.floorList}>
        {now === null || !data ? <div className={styles.floorSkeleton} aria-hidden="true" /> : null}
        {now !== null
          ? shown.map((stream) => {
              const at = Date.parse(stream.starts_at as string);
              return (
                <Link key={stream.video_id} href={`/stocks/${encodeURIComponent(stream.symbol)}`} className={styles.floorRow} data-state={stream.state} data-peek-stock={stream.symbol} prefetch={false}>
                  <Face stream={stream} size={24} />
                  <span className={styles.floorName}>
                    <b>{firstName(stream.display_name)}</b>
                    <small>{stream.symbol}</small>
                  </span>
                  {stream.prediction ? <FaBullseye className={styles.betMark} aria-label="Peak pool open" /> : <span />}
                  <span className={styles.floorWhen} suppressHydrationWarning>
                    {stream.state === "live" ? "LIVE" : untilLabel(stream.starts_at, now).replace(/^in /, "")}
                    <small>{stream.state === "live" ? (stream.peak_viewers ? `${compactCount(stream.peak_viewers)} peak` : "on air") : timeText(tf, at)}</small>
                  </span>
                </Link>
              );
            })
          : null}
        {now !== null && data && !shown.length ? <p className={styles.floorEmpty}>Nobody&apos;s scheduled in the next few hours.</p> : null}
      </div>
      <Link href="/livestreams?view=calendar" className={styles.floorMore} prefetch={false}>
        Stream calendar →
      </Link>
    </section>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────

function useAccent(color: string | null) {
  const { theme } = useTheme();
  return talentAccent(color, theme);
}

function Face({ stream, size }: { stream: CalendarStream; size: number }) {
  const accent = useAccent(stream.color);
  return (
    <span className={styles.face} data-state={stream.state} style={{ "--tal": accent, "--size": `${size}px` } as CSSProperties}>
      <ReactionFace symbol={stream.symbol} pose={stream.state === "live" ? "hype" : "idle"} size={size} />
    </span>
  );
}

function Legend({ bets }: { bets: boolean }) {
  return (
    <div className={styles.legend} aria-hidden="true">
      <span data-state="live">
        <i /> Live
      </span>
      <span data-state="upcoming">
        <i /> Upcoming
      </span>
      <span data-state="late">
        <i /> Running late
      </span>
      <span data-state="ended">
        <i /> Ended
      </span>
      {bets ? (
        <span>
          <FaBullseye className={styles.betMark} /> Peak pool open
        </span>
      ) : null}
    </div>
  );
}

function NowStrip({ live, upNext, now, bySymbol }: { live: CalendarStream[]; upNext: CalendarStream[]; now: number; bySymbol: Map<string, MarketAsset> }) {
  return (
    <section className={styles.strip} aria-label="On air and up next">
      {live.length ? (
        <div className={styles.stripGroup}>
          <h2>
            <i className={styles.liveDot} aria-hidden="true" /> On air now <small>{live.length}</small>
          </h2>
          <div className={styles.stripRow}>
            {live.slice(0, 8).map((stream) => (
              <StripCard key={stream.video_id} stream={stream} now={now} asset={bySymbol.get(stream.symbol.toUpperCase()) ?? null} />
            ))}
          </div>
        </div>
      ) : null}
      {upNext.length ? (
        <div className={styles.stripGroup} data-next="">
          <h2>
            Up next <small>{upNext.length}</small>
          </h2>
          <div className={styles.stripRow}>
            {upNext.map((stream) => (
              <StripCard key={stream.video_id} stream={stream} now={now} asset={bySymbol.get(stream.symbol.toUpperCase()) ?? null} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StripCard({ stream, now, asset }: { stream: CalendarStream; now: number; asset: MarketAsset | null }) {
  const { tf } = useCalendarZone();
  const at = Date.parse(stream.starts_at as string);
  return (
    <div className={styles.card} data-state={stream.state}>
      <Link href={`/stocks/${encodeURIComponent(stream.symbol)}`} className={styles.cardMain} data-peek-stock={stream.symbol}>
        <Face stream={stream} size={44} />
        <span className={styles.cardText}>
          <span className={styles.cardWho}>
            <b>{stream.display_name}</b>
            {asset ? (
              <span className={styles.tick}>
                {asset.symbol} <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span>
              </span>
            ) : null}
          </span>
          <span className={styles.cardState} suppressHydrationWarning>
            {stream.state === "live" ? null : `${timeText(tf, at, false)} · `}
            {stateLine(stream, at, now)}
          </span>
          {stream.title ? <span className={styles.cardTitle}>{stream.title}</span> : null}
        </span>
      </Link>
      {stream.prediction ? (
        <Link href={betHref(stream.prediction)} className={styles.betLink} title={stream.prediction.title}>
          <FaBullseye aria-hidden="true" /> Bet on the peak
        </Link>
      ) : null}
    </div>
  );
}

function chipTitle(tf: TimeFormat, stream: CalendarStream, at: number, now: number) {
  return [`${stream.display_name} · ${timeText(tf, at)}`, stateLine(stream, at, now), stream.title, stream.prediction ? "Peak pool open" : null].filter(Boolean).join("\n");
}

/** Wide screens: seven day columns, four-hour bands down the side, each stream a chip at its time. */
function WeekGrid({ week, byDay, now }: { week: Day[]; byDay: Map<string, CalendarStream[]>; now: number }) {
  const { zone } = useCalendarZone();
  const bandOf = (ms: number) => BANDS[Math.floor(wallClock(ms, zone).hour / 4)];
  const nowBand = bandOf(now);
  // Bands nobody streams in all week shrink to a sliver.
  const used = new Set<number>();
  for (const entry of week) for (const stream of byDay.get(entry.key) ?? []) used.add(bandOf(Date.parse(stream.starts_at as string)));

  return (
    <section className={styles.week} aria-label="Streams this week by day and time">
      <div className={styles.corner} />
      {week.map((entry) => {
        const count = (byDay.get(entry.key) ?? []).length;
        const weekend = entry.date.getUTCDay() === 0 || entry.date.getUTCDay() === 6;
        return (
          <div key={entry.key} className={styles.dayHead} data-today={entry.index === 0 || undefined} data-weekend={weekend || undefined}>
            <b>{dayName(entry)}</b>
            <span>
              {entry.date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
              {count ? ` · ${count}` : ""}
            </span>
          </div>
        );
      })}
      {BANDS.map((band) => (
        <Fragment key={band}>
          <div className={styles.band} data-empty={!used.has(band) || undefined}>
            {bandText(band)}
          </div>
          {week.map((entry) => {
            const items = (byDay.get(entry.key) ?? []).filter((stream) => bandOf(Date.parse(stream.starts_at as string)) === band);
            const isNowCell = entry.index === 0 && band === nowBand;
            const splitAt = isNowCell ? items.findIndex((stream) => stream.state !== "live" && stream.state !== "ended" && Date.parse(stream.starts_at as string) > now) : -1;
            const nowAt = isNowCell ? (splitAt === -1 ? items.length : splitAt) : -1;
            return (
              <div key={entry.key} className={styles.cell} data-empty={!used.has(band) || undefined} data-today={entry.index === 0 || undefined} data-past={entry.index === 0 && band + 4 <= wallClock(now, zone).hour ? "" : undefined}>
                {items.map((stream, index) => (
                  <Fragment key={stream.video_id}>
                    {index === nowAt ? <NowLine now={now} /> : null}
                    <Chip stream={stream} now={now} />
                  </Fragment>
                ))}
                {nowAt === items.length ? <NowLine now={now} /> : null}
              </div>
            );
          })}
        </Fragment>
      ))}
    </section>
  );
}

function NowLine({ now }: { now: number }) {
  const { zone } = useCalendarZone();
  return (
    <div className={styles.nowLine} aria-label="Now">
      <span>NOW {clockText(now, zone)}</span>
    </div>
  );
}

function Chip({ stream, now }: { stream: CalendarStream; now: number }) {
  const { tf, zone } = useCalendarZone();
  const at = Date.parse(stream.starts_at as string);
  const accent = useAccent(stream.color);
  return (
    <Link
      href={`/stocks/${encodeURIComponent(stream.symbol)}`}
      className={styles.chip}
      data-state={stream.state}
      data-peek-stock={stream.symbol}
      title={chipTitle(tf, stream, at, now)}
      style={{ "--tal": accent } as CSSProperties}
    >
      <Face stream={stream} size={22} />
      <span className={styles.chipText}>
        <time dateTime={stream.starts_at ?? undefined}>{stream.state === "live" ? "LIVE" : clockText(at, zone)}</time>
        <b>{firstName(stream.display_name)}</b>
      </span>
      {stream.prediction ? <FaBullseye className={styles.betMark} aria-label="Peak pool open" /> : null}
      {stream.state === "ended" && stream.peak_viewers ? <small className={styles.chipPeak}>{compactCount(stream.peak_viewers)}</small> : null}
    </Link>
  );
}

/** Phones: one day at a time, a row per stream. */
function DayList({ day, streams, now, bySymbol, filtering }: { day: Day; streams: CalendarStream[]; now: number; bySymbol: Map<string, MarketAsset>; filtering: boolean }) {
  const { zone } = useCalendarZone();
  if (!streams.length) return <p className={ls.empty}>{filtering ? `Nothing matching these filters ${day.index === 0 ? "today" : `on ${dayName(day, "long")}`}.` : `No streams scheduled ${day.index === 0 ? "today" : `on ${dayName(day, "long")}`} yet.`}</p>;
  const nowIndex = day.index === 0 ? streams.findIndex((stream) => stream.state !== "live" && stream.state !== "ended" && Date.parse(stream.starts_at as string) > now) : -1;
  return (
    <ol className={styles.dayList} aria-label={`Streams ${dayName(day, "long")}`}>
      {streams.map((stream, index) => {
        const at = Date.parse(stream.starts_at as string);
        const asset = bySymbol.get(stream.symbol.toUpperCase()) ?? null;
        return (
          <Fragment key={stream.video_id}>
            {index === nowIndex ? (
              <li className={styles.nowRow} aria-hidden="true">
                <NowLine now={now} />
              </li>
            ) : null}
            <li className={styles.row} data-state={stream.state}>
              <time className={styles.rowTime} dateTime={stream.starts_at ?? undefined}>
                {clockText(at, zone)}
                <small>{wallClock(at, zone).hour < 12 ? "AM" : "PM"}</small>
              </time>
              <Link href={`/stocks/${encodeURIComponent(stream.symbol)}`} className={styles.rowMain}>
                <Face stream={stream} size={40} />
                <span className={styles.rowText}>
                  <span className={styles.cardWho}>
                    <b>{stream.display_name}</b>
                    {asset ? (
                      <span className={styles.tick}>
                        {asset.symbol} <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span>
                      </span>
                    ) : null}
                  </span>
                  {stream.title ? <span className={styles.cardTitle}>{stream.title}</span> : null}
                  <span className={styles.cardState} suppressHydrationWarning>
                    {stateLine(stream, at, now)}
                  </span>
                </span>
              </Link>
              {stream.prediction ? (
                <Link href={betHref(stream.prediction)} className={styles.betLink} title={stream.prediction.title}>
                  <FaBullseye aria-hidden="true" /> Bet
                </Link>
              ) : null}
            </li>
          </Fragment>
        );
      })}
      {nowIndex === -1 && day.index === 0 ? (
        <li className={styles.nowRow} aria-hidden="true">
          <NowLine now={now} />
        </li>
      ) : null}
    </ol>
  );
}
