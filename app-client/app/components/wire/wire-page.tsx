"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { HeroCast } from "@/app/components/common/hero-cast";
import { Oshimark } from "@/app/components/common/oshimark";
import { SiteShell } from "@/app/components/layout/site-shell";
import { LIFTS_FAIR_VALUE, WIRE_TAGS, wireTone, wireWhen } from "@/app/components/wire/wire-kit";
import { apiFetch } from "@/app/lib/api";
import type { MarketAsset, WireItem } from "@/app/lib/types";
import { CHATTER_TOPIC, heatLabel, useChatterStore, type ChatterTalent } from "@/app/stores/chatter-store";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/wire/wire-page.module.scss";

// /wire: everything on the Wire (filter by kind, talent and window, newest first, paging back),
// and /vt/ in depth: the board's posts per hour for the week, who it's talking about and why, and
// any one talent's week.

type Group = "all" | "streams" | "records" | "market" | "games" | "vt";
const GROUPS: Array<{ key: Group; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "streams", label: "Streams" },
  { key: "records", label: "Records" },
  { key: "market", label: "Market" },
  { key: "games", label: "Games" },
  { key: "vt", label: "/vt/" },
];
const WINDOWS: Array<{ hours: number; label: string }> = [
  { hours: 24, label: "24h" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];
const PAGE = 40;

type Counts = Record<Group, number>;
type History = {
  board: string;
  symbol: string | null;
  days: number;
  start: string;
  hourly: number[];
  total: number;
  peak: { at: string; posts: number } | null;
  topics: Array<{ topic: string; posts: number }>;
  talents: Array<{ symbol: string; posts: number; in_thread: number }>;
  /** Posts in her own threads that don't name anyone (one talent only). */
  in_thread: number | null;
  /** The oldest post collected; hours before it weren't collected yet (not quiet). */
  collecting_since: string | null;
};

const TOPIC_LABEL: Record<string, string> = {
  ...CHATTER_TOPIC,
  market: "Her stock",
  negative: "Complaints",
  passing: "Passing mentions",
  unread: "Not read yet",
};

const isExternal = (href: string) => /^https?:\/\//.test(href);
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

function dayLabel(key: string, now: number) {
  const today = dayKey(new Date(now).toISOString());
  const yesterday = dayKey(new Date(now - 86_400_000).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/** "last 7 days", or "since Sun 10 PM" while collection hasn't covered the whole window yet. */
function coverageText(history: History) {
  const since = history.collecting_since ? Date.parse(history.collecting_since) : Number.NaN;
  if (Number.isFinite(since) && since > Date.parse(history.start)) {
    return `since ${new Date(since).toLocaleString("en-US", { weekday: "short", hour: "numeric", timeZone: "America/New_York" })} ET`;
  }
  return `last ${history.days} days`;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function WirePage() {
  const assets = useMarketStore((state) => state.assets);
  const summary = useChatterStore((state) => state.summary);
  const fetchChatter = useChatterStore((state) => state.fetchChatter);
  const bySymbol = useMemo(() => new Map(assets.map((asset) => [asset.symbol, asset])), [assets]);
  const [group, setGroup] = useState<Group>("all");
  const [hours, setHours] = useState(168);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const feedRef = useRef<HTMLElement | null>(null);
  const sideRef = useRef<HTMLElement | null>(null);

  // Picking someone opens her week at the top of the side column; on narrow screens that column is
  // below the feed, so bring it into view.
  useEffect(() => {
    if (picked) sideRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [picked]);

  useEffect(() => {
    void fetchChatter();
  }, [fetchChatter]);

  // The header's cast: who /vt/ is talking about most right now.
  const cast = useMemo(
    () =>
      [...(summary?.talents ?? [])]
        .sort((a, b) => b.posts_recent - a.posts_recent)
        .map((talent) => bySymbol.get(talent.symbol))
        .filter((asset): asset is MarketAsset => Boolean(asset))
        .slice(0, 3),
    [bySymbol, summary],
  );

  const showHerWire = (next: string) => {
    setSymbol(next);
    setGroup("all");
    feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.top} data-cast={cast.length ? "" : undefined}>
          <HeroCast talents={cast} />
          <div className={styles.title}>
            <span className={styles.kicker}>
              <i aria-hidden="true" /> NEWSROOM
            </span>
            <h1>The Wire</h1>
            <p>Streams, records, market moves and game moments as they happen, and what {summary?.board ?? "/vt/"} is talking about.</p>
          </div>
        </header>

        <Pulse assets={bySymbol} onPick={setPicked} />

        <div className={styles.grid}>
          <section className={styles.feed} ref={feedRef} aria-label="The Wire">
            <WireFeed group={group} hours={hours} symbol={symbol} assets={bySymbol} onGroup={setGroup} onHours={setHours} onSymbol={setSymbol} />
          </section>
          <aside className={styles.side} ref={sideRef} aria-label={`Who ${summary?.board ?? "/vt/"} is talking about`}>
            {picked ? <TalentWeek symbol={picked} asset={bySymbol.get(picked) ?? null} onClose={() => setPicked(null)} onWire={() => showHerWire(picked)} /> : null}
            <TalkBoard summary={summary} assets={bySymbol} picked={picked} onPick={setPicked} />
          </aside>
        </div>
      </div>
    </SiteShell>
  );
}

// ── The feed ─────────────────────────────────────────────────────────────────
function WireFeed({
  group,
  hours,
  symbol,
  assets,
  onGroup,
  onHours,
  onSymbol,
}: {
  group: Group;
  hours: number;
  symbol: string | null;
  assets: Map<string, MarketAsset>;
  onGroup: (group: Group) => void;
  onHours: (hours: number) => void;
  onSymbol: (symbol: string | null) => void;
}) {
  // "3h ago" labels: a minute-old clock is plenty.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [items, setItems] = useState<WireItem[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "more" | "error">("loading");
  const [done, setDone] = useState(false);

  const query = useCallback(
    (before: string | null) => {
      const params = new URLSearchParams({ order: "time", limit: String(PAGE), hours: String(hours) });
      if (group !== "all") params.set("group", group);
      if (symbol) params.set("symbol", symbol);
      if (before) params.set("before", before);
      return `/api/overview/wire?${params}`;
    },
    [group, hours, symbol],
  );

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ hours: String(hours) });
    if (symbol) params.set("symbol", symbol);
    Promise.all([apiFetch<{ items: WireItem[] }>(query(null)), apiFetch<Counts>(`/api/overview/wire/counts?${params}`).catch(() => null)])
      .then(([result, nextCounts]) => {
        if (cancelled) return;
        const list = result.items ?? [];
        setItems(list);
        setCounts(nextCounts);
        setDone(list.length < PAGE);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [hours, query, symbol]);

  async function more() {
    const oldest = items.reduce<WireItem | null>((min, item) => (!min || Date.parse(item.occurred_at) < Date.parse(min.occurred_at) ? item : min), null);
    if (!oldest) return;
    setState("more");
    try {
      const result = await apiFetch<{ items: WireItem[] }>(query(oldest.occurred_at));
      const next = (result.items ?? []).filter((item) => !items.some((entry) => entry.id === item.id));
      setItems((current) => [...current, ...next]);
      setDone(next.length < PAGE);
      setState("ready");
    } catch {
      setState("ready");
    }
  }

  // One group per day, newest first. Sorted here rather than trusting the response order: an API
  // that doesn't know order=time yet (not restarted) returns the front page's ranked order, which
  // would otherwise split a day into several groups with the same key.
  const days = useMemo(() => {
    const groups = new Map<string, WireItem[]>();
    const sorted = [...items].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || b.id - a.id);
    for (const item of sorted) {
      const key = dayKey(item.occurred_at);
      const list = groups.get(key);
      if (list) list.push(item);
      else groups.set(key, [item]);
    }
    return [...groups].map(([key, list]) => ({ key, items: list }));
  }, [items]);

  const talent = symbol ? assets.get(symbol) : null;
  return (
    <>
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-label="What kind">
          {GROUPS.map((entry) => (
            <button key={entry.key} type="button" className={styles.chip} aria-pressed={group === entry.key} onClick={() => onGroup(entry.key)}>
              {entry.label}
              {counts ? <b>{counts[entry.key] ?? 0}</b> : null}
            </button>
          ))}
        </div>
        <div className={styles.chips} role="group" aria-label="How far back">
          {WINDOWS.map((entry) => (
            <button key={entry.hours} type="button" className={styles.chip} aria-pressed={hours === entry.hours} onClick={() => onHours(entry.hours)}>
              {entry.label}
            </button>
          ))}
        </div>
        {symbol ? (
          <button type="button" className={`${styles.chip} ${styles.talentChip}`} aria-pressed onClick={() => onSymbol(null)} title="Show everyone">
            <Oshimark icon={talent?.icon} symbol={symbol} size={16} /> {symbol} only <span aria-hidden="true">✕</span>
          </button>
        ) : null}
      </div>

      {state === "loading" ? <p className={styles.empty}>Reading the wire…</p> : null}
      {state === "error" ? <p className={styles.empty}>The wire didn&apos;t answer. Try again in a moment.</p> : null}
      {state !== "loading" && state !== "error" && !items.length ? <p className={styles.empty}>Nothing on the wire for this. Try a longer window or another kind.</p> : null}

      {days.map((day) => (
        <div key={day.key} className={styles.day}>
          <h3 suppressHydrationWarning>{dayLabel(day.key, now)}</h3>
          <ol>
            {day.items.map((item) => (
              <WireEntry key={item.id} item={item} now={now} assets={assets} onSymbol={onSymbol} />
            ))}
          </ol>
        </div>
      ))}

      {items.length && !done ? (
        <button type="button" className={styles.more} onClick={() => void more()} disabled={state === "more"}>
          {state === "more" ? "Loading…" : "Earlier on the wire ↓"}
        </button>
      ) : null}
    </>
  );
}

function WireEntry({ item, now, assets, onSymbol }: { item: WireItem; now: number; assets: Map<string, MarketAsset>; onSymbol: (symbol: string) => void }) {
  const when = wireWhen(item, now);
  const href = item.link_url || null;
  const first = item.symbols[0] ? assets.get(item.symbols[0]) : null;
  const body = (
    <>
      {item.image_url ? (
        <img src={item.image_url} alt="" className={styles.thumb} loading="lazy" decoding="async" />
      ) : (
        <span className={`${styles.thumb} ${styles.mark}`} data-tone={wireTone(item.kind)}>
          {item.symbols[0] ? <Oshimark icon={first?.icon} symbol={item.symbols[0]} size={30} /> : <b>{WIRE_TAGS[item.kind]?.slice(0, 1) ?? "·"}</b>}
        </span>
      )}
      <span className={styles.text}>
        <span className={styles.meta} suppressHydrationWarning>
          <i className={styles.tag} data-tone={wireTone(item.kind)}>
            {WIRE_TAGS[item.kind] ?? "Wire"}
          </i>
          <span className={when.live ? styles.live : undefined}>{when.text}</span>
          {LIFTS_FAIR_VALUE.has(item.kind) ? <span className={styles.lift}>▲ fair value</span> : null}
        </span>
        <b>{item.headline}</b>
        {item.blurb ? <small>{item.blurb}</small> : null}
      </span>
    </>
  );
  return (
    <li className={styles.entry}>
      {href ? (
        isExternal(href) ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={styles.link}>
            {body}
          </a>
        ) : (
          <Link href={href} className={styles.link} prefetch={false}>
            {body}
          </Link>
        )
      ) : (
        <div className={styles.link}>{body}</div>
      )}
      {item.symbols.length ? (
        <span className={styles.who}>
          {item.symbols.slice(0, 4).map((entry) => (
            <button key={entry} type="button" onClick={() => onSymbol(entry)} title={`Only ${entry} on the wire`}>
              {entry}
            </button>
          ))}
        </span>
      ) : null}
    </li>
  );
}

// ── /vt/ pulse ───────────────────────────────────────────────────────────────
function useHistory(symbol: string | null, days: number) {
  const [history, setHistory] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ days: String(days) });
    if (symbol) params.set("symbol", symbol);
    apiFetch<History>(`/api/overview/chatter/history?${params}`)
      .then((result) => {
        if (cancelled) return;
        setHistory(result);
        setFailed(false);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [days, symbol]);
  return { history: history && history.symbol === (symbol ?? null) ? history : null, failed };
}

/** The board's week: posts per hour, the busiest hour, and who it was about. */
function Pulse({ assets, onPick }: { assets: Map<string, MarketAsset>; onPick: (symbol: string) => void }) {
  const { history, failed } = useHistory(null, 7);
  if (failed) return null;
  const busiestHour = history?.peak ? new Date(history.peak.at) : null;
  return (
    <section className={styles.pulse} aria-label="/vt/ this week">
      <header className={styles.sectionHead}>
        <h2>{history?.board ?? "/vt/"} this week</h2>
        <span>
          Posts per hour in hololive threads that name a talent, or sit in a talent&apos;s own thread. Rumours and posts that aren&apos;t about her don&apos;t count.
        </span>
      </header>
      <div className={styles.pulseBody}>
        <div className={styles.pulseStats}>
          <Stat label="Posts" value={history ? history.total.toLocaleString("en-US") : "—"} sub={history ? coverageText(history) : " "} />
          <Stat
            label="Busiest hour"
            value={history?.peak ? history.peak.posts.toLocaleString("en-US") : "—"}
            sub={busiestHour ? busiestHour.toLocaleString("en-US", { weekday: "short", hour: "numeric", timeZone: "America/New_York" }) + " ET" : " "}
          />
          <div className={styles.topTalk}>
            <small>Most talked about</small>
            <ol>
              {(history?.talents ?? []).slice(0, 5).map((entry) => {
                const asset = assets.get(entry.symbol);
                return (
                  <li key={entry.symbol}>
                    <button
                      type="button"
                      onClick={() => onPick(entry.symbol)}
                      title={entry.in_thread ? `${entry.posts - entry.in_thread} name her, ${entry.in_thread} more in her own threads` : `${entry.posts} posts name her`}
                    >
                      <Oshimark icon={asset?.icon} symbol={entry.symbol} size={18} />
                      <b>{entry.symbol}</b>
                      <span>{entry.posts.toLocaleString("en-US")}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        <HourChart history={history} height={150} />
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className={styles.stat}>
      <small>{label}</small>
      <b>{value}</b>
      <span>{sub}</span>
    </div>
  );
}

/**
 * Posts per hour as thin bars with midnight (ET) gridlines and day labels. Hovering (or focusing
 * and using the arrow keys) reads out an hour. A hidden list gives the daily totals to screen readers.
 */
function HourChart({ history, height }: { history: History | null; height: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  if (!history) return <div className={styles.chartEmpty} style={{ height }} />;
  const values = history.hourly;
  const count = values.length;
  const max = Math.max(1, ...values);
  const start = Date.parse(history.start);
  const at = (index: number) => new Date(start + index * 3_600_000);
  const hourLabel = (date: Date) => date.toLocaleString("en-US", { weekday: "short", hour: "numeric", timeZone: "America/New_York" });
  const etHour = (date: Date) => Number(date.toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }));
  const midnights = values.map((_, index) => index).filter((index) => index > 0 && etHour(at(index)) === 0);
  // Hours before collection started: shaded and labelled, so they don't read as a quiet week.
  const sinceMs = history.collecting_since ? Date.parse(history.collecting_since) : Number.NaN;
  const uncollected = Number.isFinite(sinceMs) ? Math.max(0, Math.min(count, Math.floor((sinceMs - start) / 3_600_000))) : 0;
  const daily: Array<{ key: string; label: string; posts: number }> = [];
  values.forEach((value, index) => {
    const key = dayKey(at(index).toISOString());
    const last = daily[daily.length - 1];
    if (last?.key === key) last.posts += value;
    else daily.push({ key, label: at(index).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" }), posts: value });
  });

  const pick = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover(Math.max(0, Math.min(count - 1, Math.floor(((clientX - box.left) / box.width) * count))));
  };
  const shown = hover ?? null;
  return (
    <div
      className={styles.chart}
      ref={boxRef}
      style={{ height } as CSSProperties}
      tabIndex={0}
      aria-label="Posts per hour. Arrow keys step through the hours."
      onPointerMove={(event) => pick(event.clientX)}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setHover((current) => Math.max(0, (current ?? count) - 1));
        if (event.key === "ArrowRight") setHover((current) => Math.min(count - 1, (current ?? -1) + 1));
      }}
    >
      <svg viewBox={`0 0 ${count} 100`} preserveAspectRatio="none" aria-hidden="true">
        {uncollected > 0 ? <rect x={0} y={0} width={uncollected} height={100} className={styles.uncollected} /> : null}
        {midnights.map((index) => (
          <line key={index} x1={index} x2={index} y1={0} y2={100} className={styles.gridLine} vectorEffect="non-scaling-stroke" />
        ))}
        {values.map((value, index) => {
          const h = value ? Math.max(1.5, (value / max) * 96) : 0;
          return <rect key={index} x={index + 0.15} y={100 - h} width={0.7} height={h} className={index === shown ? styles.barOn : styles.bar} />;
        })}
      </svg>
      {uncollected >= count * 0.12 ? (
        <span className={styles.uncollectedLabel} style={{ width: `${(uncollected / count) * 100}%` }} aria-hidden="true">
          not collected yet
        </span>
      ) : null}
      <div className={styles.days} aria-hidden="true">
        {midnights.map((index) => (
          <span key={index} style={{ left: `${(index / count) * 100}%` }}>
            {at(index).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" })}
          </span>
        ))}
      </div>
      {shown !== null ? (
        <div className={styles.readout} style={{ left: `${Math.min(88, Math.max(12, ((shown + 0.5) / count) * 100))}%` }} role="status">
          <b>{shown < uncollected ? "Not collected yet" : `${values[shown].toLocaleString("en-US")} post${values[shown] === 1 ? "" : "s"}`}</b>
          <span>{hourLabel(at(shown))} ET</span>
        </div>
      ) : null}
      <ul className={styles.srOnly}>
        {daily.map((day) => (
          <li key={day.key}>
            {day.label}: {day.posts} posts
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Who /vt/ is talking about ────────────────────────────────────────────────
type Sort = "heat" | "recent" | "day";

function TalkBoard({
  summary,
  assets,
  picked,
  onPick,
}: {
  summary: ReturnType<typeof useChatterStore.getState>["summary"];
  assets: Map<string, MarketAsset>;
  picked: string | null;
  onPick: (symbol: string) => void;
}) {
  const [sort, setSort] = useState<Sort>("recent");
  const effectiveSort: Sort = sort === "heat" && !summary?.ready ? "recent" : sort;
  const rows = useMemo(() => {
    const list = (summary?.talents ?? []).filter((talent) => assets.has(talent.symbol) && talent.posts_24h > 0);
    const key = (talent: ChatterTalent) => (effectiveSort === "heat" ? (talent.heat ?? 0) : effectiveSort === "recent" ? talent.posts_recent : talent.posts_24h);
    return list.sort((a, b) => key(b) - key(a) || b.posts_24h - a.posts_24h);
  }, [assets, effectiveSort, summary]);
  if (!summary) return <div className={styles.board}><p className={styles.empty}>Reading {"/vt/"}…</p></div>;
  const hours = summary.recent_hours;
  return (
    <div className={styles.board}>
      <header className={styles.sectionHead}>
        <h2>Who {summary.board} is talking about</h2>
        <span>{summary.ready ? `Heat is the last ${hours} hours against her usual pace.` : "Heat shows once there's a day of history."} Pick someone for her week.</span>
      </header>
      <div className={styles.sorts} role="group" aria-label="Sort by">
        {summary.ready ? (
          <button type="button" aria-pressed={effectiveSort === "heat"} onClick={() => setSort("heat")}>
            Heat
          </button>
        ) : null}
        <button type="button" aria-pressed={effectiveSort === "recent"} onClick={() => setSort("recent")}>
          Last {hours}h
        </button>
        <button type="button" aria-pressed={effectiveSort === "day"} onClick={() => setSort("day")}>
          24h
        </button>
      </div>
      {rows.length ? (
        <ol className={styles.talkList}>
          {rows.map((talent, index) => {
            const asset = assets.get(talent.symbol)!;
            const heat = heatLabel(talent);
            return (
              <li key={talent.symbol}>
                <button type="button" className={styles.talkRow} aria-pressed={picked === talent.symbol} onClick={() => onPick(talent.symbol)}>
                  <i>{index + 1}</i>
                  <Oshimark icon={asset.icon} symbol={talent.symbol} size={22} />
                  <span className={styles.talkWho}>
                    <b>{talent.symbol}</b>
                    <small>{talent.topic ? CHATTER_TOPIC[talent.topic] : asset.display_name}</small>
                  </span>
                  <span className={styles.talkNum}>
                    <b data-hot={talent.heat !== null && talent.heat >= 1.5 ? "" : undefined}>{effectiveSort === "heat" ? (heat ?? "—") : effectiveSort === "recent" ? talent.posts_recent : talent.posts_24h}</b>
                    <small>{effectiveSort === "heat" ? `${talent.posts_recent} in ${hours}h` : effectiveSort === "recent" ? (heat ? `${heat} usual` : "posts") : "posts"}</small>
                  </span>
                  <Spark hourly={talent.hourly} recentHours={hours} />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.empty}>Nobody&apos;s been mentioned in the last day.</p>
      )}
    </div>
  );
}

/** A day of posts per hour; the recent window (what heat measures) in the accent color. */
function Spark({ hourly, recentHours }: { hourly: number[]; recentHours: number }) {
  const max = Math.max(1, ...hourly);
  return (
    <svg className={styles.spark} viewBox={`0 0 ${hourly.length} 20`} preserveAspectRatio="none" aria-hidden="true">
      {hourly.map((count, index) => {
        const h = count ? Math.max(1.5, (count / max) * 19) : 0.6;
        return <rect key={index} x={index + 0.15} y={20 - h} width={0.7} height={h} className={hourly.length - 1 - index < recentHours ? styles.sparkNow : styles.sparkBar} />;
      })}
    </svg>
  );
}

/** One talent's week on /vt/: posts per hour and what they were about. */
function TalentWeek({ symbol, asset, onClose, onWire }: { symbol: string; asset: MarketAsset | null; onClose: () => void; onWire: () => void }) {
  const { history } = useHistory(symbol, 7);
  const topicMax = Math.max(1, ...(history?.topics ?? []).map((entry) => entry.posts));
  return (
    <section className={styles.week} aria-label={`${symbol} on /vt/ this week`}>
      <header>
        <Oshimark icon={asset?.icon} symbol={symbol} size={28} />
        <span>
          <b>{asset?.display_name ?? symbol}</b>
          <small>
            {history
              ? `${history.total.toLocaleString("en-US")} posts ${coverageText(history)}${history.in_thread ? `, ${history.in_thread.toLocaleString("en-US")} of them in her own threads` : ""}`
              : "Reading her week…"}
          </small>
        </span>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <HourChart history={history} height={96} />
      {history?.topics.length ? (
        <ul className={styles.topics} aria-label="What the posts were about">
          {history.topics.map((entry) => (
            <li key={entry.topic}>
              <span>{TOPIC_LABEL[entry.topic] ?? entry.topic}</span>
              <i style={{ "--w": `${(entry.posts / topicMax) * 100}%` } as CSSProperties} aria-hidden="true" />
              <b>{entry.posts.toLocaleString("en-US")}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.weekLinks}>
        <button type="button" onClick={onWire}>
          Her wire →
        </button>
        <Link href={`/stocks/${encodeURIComponent(symbol)}`} prefetch={false}>
          {symbol} stock →
        </Link>
      </div>
    </section>
  );
}
