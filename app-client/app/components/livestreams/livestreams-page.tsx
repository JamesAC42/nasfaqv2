"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from "react";
import { Oshimark } from "@/app/components/common/oshimark";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { unitLabel, unitName, UNIT_ORDER } from "@/app/lib/market-units";
import {
  assetForStream,
  clockDuration,
  compactCount,
  dayHeading,
  localTime,
  normalizePastStream,
  previewOf,
  shortDuration,
  untilLabel,
  type PastStream,
  type PastStreamRow,
} from "@/app/lib/streams";
import { signedPct, toneOf } from "@/app/lib/time";
import type { LivestreamItem, MarketAsset } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useLivestreamStore } from "@/app/stores/livestream-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import { useOpenStream } from "@/app/stores/stream-store";
import styles from "@/app/components/livestreams/livestreams.module.scss";

type View = "now" | "past";
type PastSort = "newest" | "peak" | "avg" | "longest";
type Week = { page: number; week_start: string; week_end: string; has_older: boolean; streams: PastStream[] };

export function LivestreamsPage() {
  const live = useLivestreamStore((state) => state.live);
  const upcoming = useLivestreamStore((state) => state.upcoming);
  const isLoading = useLivestreamStore((state) => state.isLoading);
  const error = useLivestreamStore((state) => state.error);
  const fetchLivestreams = useLivestreamStore((state) => state.fetchLivestreams);
  const assets = useMarketStore((state) => state.assets);
  const portfolio = useProfileStore((state) => state.portfolio);
  const { user } = useAuth();
  const openStream = useOpenStream();

  const [view, setView] = useState<View>("now");
  const [units, setUnits] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void fetchLivestreams();
  }, [fetchLivestreams]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const held = useMemo(() => new Set((portfolio?.holdings ?? []).filter((row) => row.quantity > 0).map((row) => row.symbol.toUpperCase())), [portfolio]);
  const unitOptions = useMemo(() => {
    const present = new Set(assets.map((asset) => unitName(asset.unit)).filter(Boolean));
    return [...UNIT_ORDER.filter((unit) => present.has(unit)), ...[...present].filter((unit) => !UNIT_ORDER.includes(unit)).sort()];
  }, [assets]);

  const matcher = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (creator: string, title: string, channelId: string | null | undefined) => {
      const asset = assetForStream(assets, channelId, creator);
      if (units.length && !(asset && units.includes(unitName(asset.unit)))) return false;
      if (mine && !(asset && held.has(asset.symbol.toUpperCase()))) return false;
      if (needle && !`${creator} ${title} ${asset?.symbol ?? ""} ${asset?.display_name ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    };
  }, [assets, held, mine, query, units]);

  const liveShown = useMemo(() => live.filter((item) => matcher(item.creator, item.title, item.channel_id)), [live, matcher]);
  const upcomingShown = useMemo(() => upcoming.filter((item) => matcher(item.creator, item.title, item.channel_id)), [matcher, upcoming]);
  const watching = live.reduce((sum, item) => sum + (item.viewer_count ?? 0), 0);
  const next24 = upcoming.filter((item) => item.started_at && Date.parse(item.started_at) - now < 86_400_000 && Date.parse(item.started_at) > now - 3600_000).length;
  const filtering = units.length > 0 || Boolean(query.trim()) || mine;

  return (
    <SiteShell>
      <div className={styles.page}>
        <header className={styles.top}>
          <div className={styles.title}>
            <span className={styles.kicker}>
              <i aria-hidden="true" /> ON AIR
            </span>
            <h1>Livestreams</h1>
            <p>
              <b>{live.length}</b> live now · <b>{compactCount(watching)}</b> watching · <b>{next24}</b> scheduled in the next 24 hours
            </p>
          </div>
          <div className={styles.tabs} role="tablist" aria-label="Streams">
            <button type="button" role="tab" aria-selected={view === "now"} onClick={() => setView("now")}>
              Live & upcoming
            </button>
            <button type="button" role="tab" aria-selected={view === "past"} onClick={() => setView("past")}>
              Past streams
            </button>
          </div>
        </header>

        <div className={styles.filters}>
          <label className={styles.search}>
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Talent, ticker or title" aria-label="Search streams" />
          </label>
          {user ? (
            <button type="button" className={styles.chip} aria-pressed={mine} onClick={() => setMine((value) => !value)} title="Only talents whose stock you hold">
              My holdings
            </button>
          ) : null}
          <div className={styles.units} role="group" aria-label="Units">
            {unitOptions.map((unit) => (
              <button key={unit} type="button" className={styles.chip} aria-pressed={units.includes(unit)} onClick={() => setUnits((current) => (current.includes(unit) ? current.filter((entry) => entry !== unit) : [...current, unit]))}>
                {unitLabel(unit)}
              </button>
            ))}
          </div>
          {filtering ? (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                setUnits([]);
                setQuery("");
                setMine(false);
              }}
            >
              CLEAR
            </button>
          ) : null}
        </div>

        {error ? <p className={styles.empty}>The stream feed is unavailable right now ({error}).</p> : null}

        {view === "now" ? (
          <div className={styles.layout}>
            <main className={styles.main}>
              <section>
                <h2 className={styles.secHead}>
                  Live now <small>{liveShown.length}</small>
                </h2>
                {isLoading && !live.length ? (
                  <div className={styles.grid}>
                    {Array.from({ length: 6 }, (_, index) => (
                      <div key={index} className={styles.cardSkeleton} />
                    ))}
                  </div>
                ) : liveShown.length ? (
                  <div className={styles.grid}>
                    {liveShown.map((item) => (
                      <LiveCard key={item.id} item={item} asset={assetForStream(assets, item.channel_id, item.creator)} now={now} onOpen={() => openStream(previewOf(item))} />
                    ))}
                  </div>
                ) : (
                  <p className={styles.empty}>{filtering ? "Nobody matching these filters is live." : "Nobody's live right now. Check who's up next below."}</p>
                )}
              </section>

              <section>
                <h2 className={styles.secHead}>
                  Coming up <small>{upcomingShown.length}</small>
                </h2>
                {upcomingShown.length ? (
                  <Schedule items={upcomingShown} assets={assets} now={now} onOpen={(item) => openStream(previewOf({ ...item, status: "upcoming" }))} />
                ) : (
                  <p className={styles.empty}>{filtering ? "No scheduled streams match these filters." : "Nothing's on the schedule yet."}</p>
                )}
              </section>
            </main>
            <OnAirRail live={live} upcoming={upcoming} assets={assets} now={now} onOpen={(item) => openStream(previewOf(item))} />
          </div>
        ) : (
          <PastStreams matcher={matcher} filtering={filtering} onOpen={(stream) => openStream(previewOf(stream))} />
        )}
      </div>
    </SiteShell>
  );
}

// ── Live cards ───────────────────────────────────────────────────────────
function LiveCard({ item, asset, now, onOpen }: { item: LivestreamItem; asset: MarketAsset | null; now: number; onOpen: () => void }) {
  const uptime = item.started_at ? (now - Date.parse(item.started_at)) / 1000 : null;
  return (
    <button type="button" className={styles.card} onClick={onOpen}>
      <span className={styles.thumb}>
        {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" loading="lazy" /> : null}
        <span className={styles.onAir}>
          <i aria-hidden="true" />
          {compactCount(item.viewer_count)}
        </span>
        <time className={styles.uptime} suppressHydrationWarning>
          {clockDuration(uptime)}
        </time>
      </span>
      <span className={styles.cardBody}>
        <span className={styles.who}>
          {asset ? <Oshimark icon={asset.icon} symbol={asset.symbol} size={18} /> : null}
          <b>{item.creator}</b>
          {asset ? (
            <span className={styles.tick}>
              {asset.symbol} <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span>
            </span>
          ) : null}
        </span>
        <span className={styles.cardTitle}>{item.title}</span>
      </span>
    </button>
  );
}

// ── Schedule ─────────────────────────────────────────────────────────────
function Schedule({ items, assets, now, onOpen }: { items: LivestreamItem[]; assets: MarketAsset[]; now: number; onOpen: (item: LivestreamItem) => void }) {
  const groups = useMemo(() => {
    const out: Array<{ heading: string; items: LivestreamItem[] }> = [];
    for (const item of items) {
      const heading = dayHeading(item.started_at, now);
      const group = out.find((entry) => entry.heading === heading);
      if (group) group.items.push(item);
      else out.push({ heading, items: [item] });
    }
    // Late starters float to the top; they could go live any second.
    return out.sort((a, b) => (a.heading === "Waiting to start" ? -1 : b.heading === "Waiting to start" ? 1 : 0));
    // `now` ticks each second; day headings only change at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, Math.floor(now / 60_000)]);

  return (
    <div className={styles.schedule}>
      {groups.map((group) => (
        <div key={group.heading}>
          <h3 className={styles.day}>{group.heading}</h3>
          {group.items.map((item) => {
            const asset = assetForStream(assets, item.channel_id, item.creator);
            const until = untilLabel(item.started_at, now);
            return (
              <button key={item.id} type="button" className={styles.slot} onClick={() => onOpen(item)}>
                <time suppressHydrationWarning>{localTime(item.started_at)}</time>
                <span className={until.includes("late") || until === "any minute" ? styles.soon : styles.until} suppressHydrationWarning>
                  {until}
                </span>
                {asset ? <Oshimark icon={asset.icon} symbol={asset.symbol} size={22} /> : <span className={styles.noMark} />}
                <span className={styles.slotText}>
                  <b>{item.creator}</b>
                  <small>{item.title}</small>
                </span>
                {asset ? (
                  <span className={styles.slotTick}>
                    {asset.symbol}
                    <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Rail ─────────────────────────────────────────────────────────────────
function OnAirRail({ live, upcoming, assets, now, onOpen }: { live: LivestreamItem[]; upcoming: LivestreamItem[]; assets: MarketAsset[]; now: number; onOpen: (item: LivestreamItem) => void }) {
  const onAir = useMemo(() => {
    const seen = new Map<string, { asset: MarketAsset; viewers: number; item: LivestreamItem }>();
    for (const item of live) {
      const asset = assetForStream(assets, item.channel_id, item.creator);
      if (!asset) continue;
      const entry = seen.get(asset.symbol);
      if (entry) entry.viewers += item.viewer_count ?? 0;
      else seen.set(asset.symbol, { asset, viewers: item.viewer_count ?? 0, item });
    }
    return [...seen.values()].sort((a, b) => b.viewers - a.viewers);
  }, [assets, live]);
  const avg = (list: MarketAsset[]) => (list.length ? list.reduce((sum, asset) => sum + (asset.move_24h_pct ?? 0), 0) / list.length : null);
  const liveAvg = avg(onAir.map((entry) => entry.asset));
  const marketAvg = avg(assets);
  const next = upcoming.find((item) => item.started_at && Date.parse(item.started_at) > now);

  return (
    <aside className={styles.rail}>
      {next ? (
        <section className={styles.railSec}>
          <h2>Next up</h2>
          <button type="button" className={styles.nextUp} onClick={() => onOpen({ ...next, status: "upcoming" })}>
            <b suppressHydrationWarning>{untilLabel(next.started_at, now).replace(/^in /, "")}</b>
            <span>
              {next.creator} · {localTime(next.started_at)}
            </span>
            <small>{next.title}</small>
          </button>
        </section>
      ) : null}
      <section className={styles.railSec}>
        <h2>Stocks on air</h2>
        {onAir.length ? (
          <>
            <p className={styles.railNote}>
              Talents live right now are <b className={styles[toneOf(liveAvg)]}>{signedPct(liveAvg, 2)}</b> today on average, against <b className={styles[toneOf(marketAvg)]}>{signedPct(marketAvg, 2)}</b> for the whole market.
            </p>
            {onAir.map(({ asset, viewers, item }) => (
              <button key={asset.symbol} type="button" className={styles.airRow} onClick={() => onOpen(item)} data-peek-stock={asset.symbol}>
                <Oshimark icon={asset.icon} symbol={asset.symbol} size={18} />
                <b>{asset.symbol}</b>
                <span>{asset.current_mid_price?.toFixed(2) ?? "—"}</span>
                <span className={styles[toneOf(asset.move_24h_pct)]}>{signedPct(asset.move_24h_pct, 1)}</span>
                <small>{compactCount(viewers)}</small>
              </button>
            ))}
          </>
        ) : (
          <p className={styles.railNote}>No listed talents are live.</p>
        )}
      </section>
    </aside>
  );
}

// ── Past streams ─────────────────────────────────────────────────────────
function PastStreams({ matcher, filtering, onOpen }: { matcher: (creator: string, title: string, channelId: string | null | undefined) => boolean; filtering: boolean; onOpen: (stream: PastStream) => void }) {
  const assets = useMarketStore((state) => state.assets);
  const [page, setPage] = useState(0);
  const [week, setWeek] = useState<Week | null>(null);
  const [loadingPage, setLoadingPage] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<PastSort>("newest");

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ page: number; week_start: string; week_end: string; has_older: boolean; streams: PastStreamRow[] }>(`/api/livestreams/history?page=${page}`).then(
      (raw) => {
        if (cancelled) return;
        setWeek({ ...raw, streams: (raw.streams ?? []).map(normalizePastStream) });
        setError(null);
        setLoadingPage(null);
      },
      (reason) => {
        if (cancelled) return;
        setError(String((reason as Error).message || reason));
        setLoadingPage(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [page]);

  const go = (next: number) => {
    setLoadingPage(next);
    setPage(next);
  };

  const rows = useMemo(() => {
    const list = (week?.streams ?? []).filter((stream) => matcher(stream.creator, stream.title, stream.channel_id));
    const by = { newest: (s: PastStream) => Date.parse(s.started_at ?? "") || 0, peak: (s: PastStream) => s.max_viewers ?? 0, avg: (s: PastStream) => s.avg_viewers ?? 0, longest: (s: PastStream) => s.duration_seconds ?? 0 }[sort];
    return [...list].sort((a, b) => by(b) - by(a));
  }, [matcher, sort, week]);

  const hours = rows.reduce((sum, stream) => sum + (stream.duration_seconds ?? 0), 0) / 3600;
  const top = rows.reduce<PastStream | null>((best, stream) => (!best || (stream.max_viewers ?? 0) > (best.max_viewers ?? 0) ? stream : best), null);
  const range = week ? `${new Date(week.week_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(Date.parse(week.week_end) - 1).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "…";

  return (
    <section className={styles.past}>
      <div className={styles.weekBar}>
        <button type="button" onClick={() => go(page + 1)} disabled={loadingPage !== null || !week?.has_older}>
          ‹ OLDER
        </button>
        <b>{page === 0 ? `This week · ${range}` : range}</b>
        <button type="button" onClick={() => go(Math.max(0, page - 1))} disabled={loadingPage !== null || page === 0}>
          NEWER ›
        </button>
      </div>

      {week && rows.length ? (
        <div className={styles.weekStats}>
          <div>
            <span>Streams</span>
            <b>{rows.length}</b>
          </div>
          <div>
            <span>Hours on air</span>
            <b>{Math.round(hours).toLocaleString("en-US")}</b>
          </div>
          {top ? (
            <button type="button" onClick={() => onOpen(top)}>
              <span>Biggest peak</span>
              <b>{compactCount(top.max_viewers)}</b>
              <small>{top.creator}</small>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.sortRow}>
        <span>Sort</span>
        <div className={styles.seg} role="group" aria-label="Sort past streams">
          {(
            [
              ["newest", "Newest"],
              ["peak", "Peak"],
              ["avg", "Average"],
              ["longest", "Longest"],
            ] as Array<[PastSort, string]>
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className={styles.empty}>Past streams are unavailable right now ({error}).</p> : null}
      {loadingPage !== null && !week ? <div className={styles.tableSkeleton} /> : null}
      {week && !rows.length ? <p className={styles.empty}>{filtering ? "No streams this week match these filters." : "No finished streams recorded for this week."}</p> : null}

      {rows.length ? (
        <div className={`${styles.table} ${loadingPage !== null ? styles.stale : ""}`} role="table" aria-label="Past streams">
          <div className={styles.tHead} role="row">
            <span role="columnheader">When</span>
            <span role="columnheader">Stream</span>
            <span role="columnheader">Length</span>
            <span role="columnheader">Peak</span>
            <span role="columnheader">Avg</span>
            <span role="columnheader">Views</span>
          </div>
          {rows.map((stream) => {
            const asset = assetForStream(assets, stream.channel_id, stream.creator);
            return (
              <button key={stream.id} type="button" className={styles.tRow} role="row" onClick={() => onOpen(stream)}>
                <span className={styles.tWhen} role="cell" suppressHydrationWarning>
                  {stream.started_at ? `${new Date(stream.started_at).toLocaleDateString("en-US", { weekday: "short" })} ${new Date(stream.started_at).getDate()}` : "—"}
                  <small>{localTime(stream.started_at)}</small>
                </span>
                <span className={styles.tStream} role="cell">
                  {asset ? <Oshimark icon={asset.icon} symbol={asset.symbol} size={20} /> : <span className={styles.noMark} />}
                  <span>
                    <b>{stream.creator}</b>
                    <small>{stream.title}</small>
                  </span>
                </span>
                <span className={styles.tNum} role="cell" data-label="Length">
                  {shortDuration(stream.duration_seconds)}
                </span>
                <span className={`${styles.tNum} ${styles.tPeak}`} role="cell" data-label="Peak">
                  {compactCount(stream.max_viewers)}
                </span>
                <span className={styles.tNum} role="cell" data-label="Avg">
                  {compactCount(stream.avg_viewers)}
                </span>
                <span className={styles.tNum} role="cell" data-label="Views">
                  {compactCount(stream.total_views)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
