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
import ls from "@/app/components/livestreams/livestreams.module.scss";
import styles from "@/app/components/livestreams/stream-calendar.module.scss";

// The stream calendar, a mode of the Livestreams page (/livestreams?view=calendar): listed talents'
// streams for the next week, laid out by day and time in the viewer's own time zone. A week grid on
// wide screens, a day list on phones. Each stream links to the talent's stock; one with an open peak
// prediction carries a target mark (and a link on phones).
// Same data as the stream-peak predictions (GET /api/livestreams/calendar).

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
  prediction: { slug: string; title: string } | null;
};

type Calendar = { generated_at: string; streams: CalendarStream[] };
type Day = { key: string; start: number; end: number; date: Date; index: number };

const DAYS = 7;
const REFRESH_MS = 60_000;
/** Four-hour bands of the viewer's day: each sits in one half of the clock, so the band names AM or PM. */
const BANDS = [0, 4, 8, 12, 16, 20];

const pad = (n: number) => String(n).padStart(2, "0");
const localDayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const firstName = (name: string) => name.trim().split(/\s+/).pop() ?? name;
const hourText = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
const bandText = (band: number) => `${hourText(band)} – ${hourText((band + 4) % 24)}`;
const clockText = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}:${pad(d.getMinutes())}`;
};
const timeText = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The next seven days, starting today, in the viewer's time zone (DST-safe: calendar days, not 24h steps). */
function weekFrom(now: number): Day[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: DAYS }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const next = new Date(date);
    next.setDate(date.getDate() + 1);
    return { key: localDayKey(date.getTime()), start: date.getTime(), end: next.getTime(), date, index };
  });
}

function dayName(day: Day, style: "short" | "long" = "short") {
  if (day.index === 0) return "Today";
  if (day.index === 1) return "Tomorrow";
  return day.date.toLocaleDateString("en-US", { weekday: style });
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
  const zone = useTimeZone();
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

  const week = useMemo(() => (minute === null ? [] : weekFrom(minute * 60_000)), [minute]);
  const byDay = useMemo(() => {
    const out = new Map<string, CalendarStream[]>();
    for (const stream of streams) {
      const key = localDayKey(Date.parse(stream.starts_at as string));
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(stream);
    }
    return out;
  }, [streams]);

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
        <Legend />
        {zone ? <p className={styles.zone}>Times in your time zone ({zone.replace(/_/g, " ")})</p> : null}
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
                    <span>{entry.index === 0 ? "Today" : entry.date.toLocaleDateString("en-US", { weekday: "short" })}</span>
                    <b>{entry.date.getDate()}</b>
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
                  {stream.prediction ? <FaBullseye className={styles.betMark} aria-label="Peak prediction open" /> : <span />}
                  <span className={styles.floorWhen} suppressHydrationWarning>
                    {stream.state === "live" ? "LIVE" : untilLabel(stream.starts_at, now).replace(/^in /, "")}
                    <small>{stream.state === "live" ? (stream.peak_viewers ? `${compactCount(stream.peak_viewers)} peak` : "on air") : timeText(at)}</small>
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

function Legend() {
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
      <span>
        <FaBullseye className={styles.betMark} /> Peak prediction open
      </span>
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
            {stream.state === "live" ? null : `${timeText(at)} · `}
            {stateLine(stream, at, now)}
          </span>
          {stream.title ? <span className={styles.cardTitle}>{stream.title}</span> : null}
        </span>
      </Link>
      {stream.prediction ? (
        <Link href={`/predictions/${encodeURIComponent(stream.prediction.slug)}`} className={styles.betLink} title={stream.prediction.title}>
          <FaBullseye aria-hidden="true" /> Bet on the peak
        </Link>
      ) : null}
    </div>
  );
}

function chipTitle(stream: CalendarStream, at: number, now: number) {
  return [`${stream.display_name} · ${timeText(at)}`, stateLine(stream, at, now), stream.title, stream.prediction ? "Peak prediction open" : null].filter(Boolean).join("\n");
}

/** Wide screens: seven day columns, four-hour bands down the side, each stream a chip at its time. */
function WeekGrid({ week, byDay, now }: { week: Day[]; byDay: Map<string, CalendarStream[]>; now: number }) {
  const bandOf = (ms: number) => BANDS[Math.floor(new Date(ms).getHours() / 4)];
  const nowBand = bandOf(now);
  // Bands nobody streams in all week shrink to a sliver.
  const used = new Set<number>();
  for (const entry of week) for (const stream of byDay.get(entry.key) ?? []) used.add(bandOf(Date.parse(stream.starts_at as string)));

  return (
    <section className={styles.week} aria-label="Streams this week by day and time">
      <div className={styles.corner} />
      {week.map((entry) => {
        const count = (byDay.get(entry.key) ?? []).length;
        const weekend = entry.date.getDay() === 0 || entry.date.getDay() === 6;
        return (
          <div key={entry.key} className={styles.dayHead} data-today={entry.index === 0 || undefined} data-weekend={weekend || undefined}>
            <b>{dayName(entry)}</b>
            <span>
              {entry.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
              <div key={entry.key} className={styles.cell} data-empty={!used.has(band) || undefined} data-today={entry.index === 0 || undefined} data-past={entry.index === 0 && band + 4 <= new Date(now).getHours() ? "" : undefined}>
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
  return (
    <div className={styles.nowLine} aria-label="Now">
      <span>NOW {clockText(now)}</span>
    </div>
  );
}

function Chip({ stream, now }: { stream: CalendarStream; now: number }) {
  const at = Date.parse(stream.starts_at as string);
  const accent = useAccent(stream.color);
  return (
    <Link
      href={`/stocks/${encodeURIComponent(stream.symbol)}`}
      className={styles.chip}
      data-state={stream.state}
      data-peek-stock={stream.symbol}
      title={chipTitle(stream, at, now)}
      style={{ "--tal": accent } as CSSProperties}
    >
      <Face stream={stream} size={22} />
      <span className={styles.chipText}>
        <time dateTime={stream.starts_at ?? undefined}>{stream.state === "live" ? "LIVE" : clockText(at)}</time>
        <b>{firstName(stream.display_name)}</b>
      </span>
      {stream.prediction ? <FaBullseye className={styles.betMark} aria-label="Peak prediction open" /> : null}
      {stream.state === "ended" && stream.peak_viewers ? <small className={styles.chipPeak}>{compactCount(stream.peak_viewers)}</small> : null}
    </Link>
  );
}

/** Phones: one day at a time, a row per stream. */
function DayList({ day, streams, now, bySymbol, filtering }: { day: Day; streams: CalendarStream[]; now: number; bySymbol: Map<string, MarketAsset>; filtering: boolean }) {
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
                {clockText(at)}
                <small>{new Date(at).getHours() < 12 ? "AM" : "PM"}</small>
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
                <Link href={`/predictions/${encodeURIComponent(stream.prediction.slug)}`} className={styles.betLink} title={stream.prediction.title}>
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
