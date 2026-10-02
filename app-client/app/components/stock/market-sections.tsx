"use client";

import { useMemo, useState } from "react";
import { buildPaths, TalentDay, useSession } from "@/app/components/market/report-day";
import { buildDays } from "@/app/components/market/report-model";
import { PriceChart, type Overlays } from "@/app/components/stock/price-chart";
import { CHART_RANGES, useCandles, useStats, useTickHistory, type ChartRange } from "@/app/components/stock/use-stock-data";
import { formatCountdown, formatEtTime, getMarketClock, marketDateKey, TICKS } from "@/app/lib/market-clock";
import { markSeries } from "@/app/lib/market-units";
import { signedPct, timeAgo, toneOf } from "@/app/lib/time";
import type { MarketAdjustmentOutcome, MarketAsset } from "@/app/lib/types";
import { useChannelData } from "@/app/lib/use-channel-data";
import { useNow } from "@/app/lib/use-now";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/stock/dossier.module.scss";
import { Term, Tip } from "@/app/components/common/tip";

const OVERLAYS: Array<[keyof Overlays, string]> = [
  ["mark", "MARK"],
  ["ticks", "TICKS"],
  ["volume", "VOLUME"],
  ["mine", "MY AVG"],
];

// ── Chart ────────────────────────────────────────────────────────────────
export function ChartSection({ asset, accent, avgCost }: { asset: MarketAsset; accent: string; avgCost: number | null }) {
  const [range, setRange] = useState<ChartRange>("1d");
  const [overlays, setOverlays] = useState<Overlays>({ mark: true, ticks: true, volume: true, mine: true });
  const candles = useCandles(asset.symbol, range);
  const ticks = useTickHistory(asset.symbol);
  const latestMark = markSeries(asset).at(-1) ?? null;
  const data = candles.data ?? [];
  const first = data.find((candle) => candle.close !== null)?.close ?? null;
  const last = range === "1d" ? asset.current_mid_price : data.at(-1)?.close ?? null;
  const change = first && last ? (last - first) / first : null;
  const high = Math.max(...data.map((candle) => candle.high ?? -Infinity));
  const low = Math.min(...data.map((candle) => candle.low ?? Infinity));
  const volume = data.reduce((sum, candle) => sum + (candle.volume_shares ?? 0), 0);

  return (
    <section className={styles.sec} id="s-chart">
      <div className={styles.chartHead}>
        <div className={styles.tabs} role="tablist" aria-label="Range">
          {CHART_RANGES.map((entry) => (
            <button key={entry.value} type="button" role="tab" aria-selected={range === entry.value} onClick={() => setRange(entry.value)}>
              {entry.label}
            </button>
          ))}
        </div>
        <div className={styles.overlays}>
          {OVERLAYS.filter(([key]) => key !== "mine" || avgCost !== null).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={overlays[key]} onClick={() => setOverlays((current) => ({ ...current, [key]: !current[key] }))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={candles.loading && !data.length ? styles.loadingBox : undefined}>
        <PriceChart candles={data} range={range} overlays={overlays} ticks={ticks.data ?? []} latestMark={latestMark} avgCost={avgCost} livePrice={asset.current_mid_price} accent={accent} />
      </div>
      <div className={styles.legend}>
        <span>
          {CHART_RANGES.find((entry) => entry.value === range)?.label} <b className={styles[toneOf(change)]}>{signedPct(change)}</b>
        </span>
        <span>
          high <b>{Number.isFinite(high) ? high.toFixed(2) : "—"}</b>
        </span>
        <span>
          low <b>{Number.isFinite(low) ? low.toFixed(2) : "—"}</b>
        </span>
        <span>
          volume <b>{volume.toLocaleString("en-US")} sh</b>
        </span>
        {overlays.mark ? <span className={styles.legendNote}>
            dashed line = settlement <Term k="mark">mark</Term>, the price with short-term order pressure stripped out
          </span> : null}
      </div>
    </section>
  );
}

// ── Today ────────────────────────────────────────────────────────────────
/**
 * The market report's day so far, for this talent alone: each adjustment as it lands and the trading
 * around it. Between the day's last adjustment and the next open, the finished day with its target.
 */
export function DaySection({ asset }: { asset: MarketAsset }) {
  const assets = useMarketStore((state) => state.assets);
  const model = useMemo(() => buildDays(assets), [assets]);
  const date = model.live?.date ?? model.dates.at(-1) ?? null;
  const session = useSession(date, Boolean(model.live));
  const symbol = asset.symbol.toUpperCase();
  const { window, paths } = useMemo(() => {
    if (!session || session.market_date !== date) return { window: null, paths: null };
    const price = new Map(assets.map((entry) => [entry.symbol.toUpperCase(), entry.market_price ?? entry.current_mid_price ?? null]));
    return buildPaths(session, (key) => price.get(key.toUpperCase()) ?? null, !session.finished);
  }, [session, date, assets]);
  const targets = useMemo(() => {
    const row = date && session?.finished ? model.bySymbol.get(symbol)?.get(date) : null;
    return row ? new Map([[symbol, { before: row.markBefore, after: row.markAfter }]]) : null;
  }, [model, symbol, date, session]);
  // The section is always there, so the nav's "Today" has somewhere to go while the day loads.
  return (
    <section className={styles.sec} id="s-day">
      {session && window && paths?.has(symbol) ? (
        <TalentDay
          session={session}
          window={window}
          paths={paths}
          assets={assets}
          targets={targets}
          defaultSymbol={symbol}
          fixed
          layout="side"
          heading={
            session.finished
              ? { title: "How the day went", aside: "each adjustment, the trading in between, and the target" }
              : { title: "The day so far", aside: "each adjustment as it lands, and the trading around it" }
          }
          bare
        />
      ) : (
        <>
          <div className={styles.secHead}>
            <h2>The day so far</h2>
          </div>
          <p className={styles.copy}>{session === undefined ? "Loading the day…" : `Nothing for ${asset.symbol} today yet.`}</p>
        </>
      )}
    </section>
  );
}

// ── Ticks ────────────────────────────────────────────────────────────────
const TICK_LABEL: Record<string, string> = Object.fromEntries(TICKS.map((tick) => [tick.key, tick.label]));

function dayKey(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

export function TicksSection({ asset }: { asset: MarketAsset }) {
  const now = useNow();
  const history = useTickHistory(asset.symbol);
  const clock = now ? getMarketClock(now) : null;
  const items = useMemo(() => history.data ?? [], [history.data]);
  // The market day in progress (09:00 ET to 09:00 ET), not simply the newest day in the history:
  // a day whose ticks haven't been scheduled yet shows as all pending.
  const today = now ? marketDateKey(now) : "";
  const todays = useMemo(
    () => new Map(items.filter((item) => today && dayKey(item.market_date) === today && (item.applied_at || item.skip_reason)).map((item) => [item.interval_key, item])),
    [items, today],
  );
  const log = useMemo(
    () =>
      items
        .filter((item) => item.applied_at || item.skip_reason)
        .sort((a, b) => String(b.applied_at ?? b.scheduled_at).localeCompare(String(a.applied_at ?? a.scheduled_at)))
        .slice(0, 8),
    [items],
  );
  const dayMove = [...todays.values()].reduce((product, item) => product * (1 + (item.applied_at ? item.move_pct ?? 0 : 0)), 1) - 1;

  return (
    <section className={styles.sec} id="s-ticks">
      <div className={styles.secHead}>
        <h2>The ticks</h2>
        <span className={styles.aside}>four a day · the pull is secret until it lands</span>
      </div>
      <p className={styles.copy}>
        Four times a day every stock gets <Term k="tick">pulled</Term> toward a <Term k="fair-value">hidden target</Term> set from its channel. You see each move when it lands; the target itself stays secret until the day&apos;s last tick, then the settlement report shows it.
        {todays.size ? (
          <>
            {" "}
            Today&apos;s ticks have moved <b>{asset.symbol}</b> <b className={styles[toneOf(dayMove)]}>{signedPct(dayMove)}</b>
            {clock ? (
              <>
                , and <b>{clock.nextTick.label.toUpperCase()}</b> lands in <b suppressHydrationWarning>{formatCountdown(clock.secondsToNextTick)}</b>
              </>
            ) : null}
            .
          </>
        ) : null}
      </p>
      <div className={styles.tickGrid}>
        <div>
          <div className={styles.label}>Today&apos;s ticks</div>
          <div className={styles.tickRow}>
            {TICKS.map((tick, index) => {
              const item = todays.get(tick.key);
              const next = clock?.nextTickIndex === index;
              const applied = Boolean(item?.applied_at);
              const skipped = Boolean(item?.skip_reason) && !applied;
              return (
                <div key={tick.key} className={`${styles.tnode} ${next ? styles.next : ""} ${!applied && !next ? styles.waiting : ""}`}>
                  <b>{tick.label.toUpperCase()}</b>
                  <span>
                    {String(tick.hour).padStart(2, "0")}:00{tick.key === "overnight" ? " +1d" : ""}
                  </span>
                  <strong className={applied ? styles[toneOf(item?.move_pct)] : undefined} suppressHydrationWarning>
                    {applied ? signedPct(item?.move_pct) : skipped ? "skipped" : next && clock ? formatCountdown(clock.secondsToNextTick) : "—"}
                  </strong>
                </div>
              );
            })}
          </div>
          <div className={styles.label} style={{ margin: "1rem 0 0.4rem" }}>
            Tick log
          </div>
          {log.length ? (
            <div className={styles.tickLog}>
              <div className={`${styles.logRow} ${styles.logHead}`} aria-hidden="true">
                <span>When</span>
                <span>Tick</span>
                <span>Price</span>
                <span>Move</span>
                <span>
                  <Tip content="How much of the distance to the target this tick closed. 100% lands right on it; over 100% overshoots.">Gap</Tip>
                </span>
              </div>
              {log.map((item) => (
                <TickLogRow key={`${item.market_date}-${item.interval_key}-${item.id ?? ""}`} item={item} />
              ))}
            </div>
          ) : (
            <p className={styles.empty}>{history.loading ? "Loading ticks…" : "No ticks logged for this stock yet."}</p>
          )}
        </div>
        <Signals asset={asset} />
      </div>
    </section>
  );
}

function TickLogRow({ item }: { item: MarketAdjustmentOutcome }) {
  const when = item.applied_at ?? item.scheduled_at;
  const date = when ? new Date(when) : null;
  return (
    <div className={styles.logRow}>
      <span className={styles.logWhen} suppressHydrationWarning>
        {date ? `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })} ${formatEtTime(date)}` : "—"}
      </span>
      <b>{(TICK_LABEL[item.interval_key] ?? item.interval_key).toUpperCase()}</b>
      {item.applied_at ? (
        <>
          <span className={styles.dim}>
            {item.price_before?.toFixed(2) ?? "—"} → {item.price_after?.toFixed(2) ?? "—"}
          </span>
          <span className={styles[toneOf(item.move_pct)]}>{signedPct(item.move_pct)}</span>
          <span className={styles.dim}>
            {item.gap_compression_pct !== null && item.gap_compression_pct !== undefined ? `${Math.round(item.gap_compression_pct * 100)}%` : ""}
          </span>
        </>
      ) : (
        <span className={styles.dim} style={{ gridColumn: "span 3", textAlign: "left" }}>
          skipped{item.skip_reason ? ` · ${item.skip_reason.replace(/_/g, " ")}` : ""}
        </span>
      )}
    </div>
  );
}

/** Public channel signals that feed the hidden target, read against the rest of the board. */
function Signals({ asset }: { asset: MarketAsset }) {
  const channels = useChannelData("24h");
  const stats = useStats(asset.symbol);
  const sym = asset.symbol.toUpperCase();

  const rows = useMemo(() => {
    const all = [...channels.values()];
    const mine = channels.get(sym);
    const read = (key: "viewsCh" | "subsCh", label: string, hint: string) => {
      const values = all.map((row) => row[key]).filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
      const value = mine?.[key] ?? null;
      if (value === null || !values.length) return { label, hint, value: null as number | null, dev: 0, rank: null as number | null, of: values.length, text: "—" };
      const median = values[Math.floor(values.length / 2)];
      const spread = Math.max(...values.map((entry) => Math.abs(entry - median)), 1e-9);
      return { label, hint, value, dev: (value - median) / spread, rank: 1 + values.filter((entry) => entry > value).length, of: values.length, text: signedPct(value) };
    };
    return [read("viewsCh", "Views", "24h growth"), read("subsCh", "Subscribers", "24h growth")];
  }, [channels, sym]);

  const uploads = useMemo(() => {
    const points = (stats.data ?? []).filter((point) => point.video_count !== null).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    if (points.length < 2) return null;
    const last = points[points.length - 1];
    const weekAgo = [...points].reverse().find((point) => Date.parse(point.snapshot_date) <= Date.parse(last.snapshot_date) - 7 * 86_400_000) ?? points[0];
    let lastUpload: string | null = null;
    for (let i = points.length - 1; i > 0; i -= 1) {
      if ((points[i].video_count ?? 0) > (points[i - 1].video_count ?? 0)) {
        lastUpload = points[i].snapshot_date;
        break;
      }
    }
    return { week: (last.video_count ?? 0) - (weekAgo.video_count ?? 0), lastUpload };
  }, [stats.data]);

  return (
    <div>
      <div className={styles.label}>What feeds the target</div>
      <div className={styles.signals}>
        {rows.map((row) => (
          <div key={row.label} className={styles.signal}>
            <span>
              {row.label} <small>{row.hint}</small>
            </span>
            <i className={styles.sigBar}>
              <s className={row.dev >= 0 ? styles.sigUp : styles.sigDown} style={row.dev >= 0 ? { left: "50%", width: `${Math.min(50, Math.abs(row.dev) * 50)}%` } : { right: "50%", width: `${Math.min(50, Math.abs(row.dev) * 50)}%` }} />
            </i>
            <b className={styles[toneOf(row.value)]}>{row.text}</b>
            <em>{row.rank ? `#${row.rank}/${row.of}` : ""}</em>
          </div>
        ))}
        <div className={styles.signal}>
          <span>
            Uploads <small>last 7 days</small>
          </span>
          <i className={styles.sigBar}>
            <s className={styles.sigUp} style={{ left: "50%", width: `${Math.min(50, (uploads?.week ?? 0) * 7)}%` }} />
          </i>
          <b>{uploads ? uploads.week : "—"}</b>
          <em title="Most recent upload">{uploads?.lastUpload ? timeAgo(uploads.lastUpload) : ""}</em>
        </div>
      </div>
      <p className={styles.formula}>
        Settlement at 09:00 ET reprices the target from views, subscribers and uploads. Channels that go quiet get marked down. Bars read against the median talent.
      </p>
    </div>
  );
}
