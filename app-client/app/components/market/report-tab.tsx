"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArtSlot } from "@/app/components/common/art-slot";
import { Oshimark } from "@/app/components/common/oshimark";
import { StockChip } from "@/app/components/common/stock-chip";
import { compactMoney, num, RankRow, Seg, toneClass, useAssetMap } from "@/app/components/market/bits";
import { AreaLine } from "@/app/components/market/mini-charts";
import { buildDays, dateLabel, markIndex, type DayModel, type DayRow } from "@/app/components/market/report-model";
import { adjustmentLabel, adjustmentShare, buildPaths, GapChart, TalentDay, useSession, type TalentPath } from "@/app/components/market/report-day";
import { apiFetch } from "@/app/lib/api";
import { formatEtTime, TICKS } from "@/app/lib/market-clock";
import { groupByUnit, unitLabel, unitName } from "@/app/lib/market-units";
import { talentAccent } from "@/app/lib/talent-color";
import { money, signedPct } from "@/app/lib/time";
import type { DailyReport, MarketAdjustmentOutcome, ReportRow, SessionBreakdown } from "@/app/lib/types";
import { useAuth } from "@/app/providers/auth-provider";
import { useTheme } from "@/app/providers/theme-provider";
import { useHubStore } from "@/app/stores/hub-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import ui from "@/app/components/market/market.module.scss";
import styles from "@/app/components/market/report-tab.module.scss";

type Metric = "fd" | "prem" | "pchg";
const reportCache = new Map<string, DailyReport | null>();

const pct = (value: number | null | undefined, digits = 2) => signedPct(value, digits);
const premOf = (row: ReportRow) =>
  row.premium_pct ?? row.premium_discount_pct ?? null; // withheld while that day's ticks are still landing

function useReport(date: string | null) {
  const latest = useMarketStore((state) => state.report);
  const [report, setReport] = useState<DailyReport | null | undefined>(undefined);
  useEffect(() => {
    if (!date) return;
    if (latest && latest.market_date.slice(0, 10) === date) {
      setReport(latest);
      return;
    }
    if (reportCache.has(date)) {
      setReport(reportCache.get(date));
      return;
    }
    let cancelled = false;
    setReport(undefined);
    apiFetch<DailyReport>(`/api/market/report/daily/${date}`)
      .then((result) => {
        reportCache.set(date, result);
        if (!cancelled) setReport(result);
      })
      .catch(() => {
        reportCache.set(date, null);
        if (!cancelled) setReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [date, latest]);
  return report;
}

// ── Date strip ───────────────────────────────────────────────────────────
/** Finished sessions, then today's while its ticks are still landing. */
const sessionDates = (model: DayModel) => (model.live ? [...model.dates, model.live.date] : model.dates);

function DateStrip({ model, date, mode, onPick, onMode }: { model: DayModel; date: string; mode: "one" | "all"; onPick: (date: string) => void; onMode: () => void }) {
  const strip = useRef<HTMLDivElement | null>(null);
  const bySymbol = useAssetMap();
  const all = sessionDates(model);
  const idx = all.indexOf(date);
  const live = model.live;
  const liveSorted = live ? [...live.rows].sort((a, b) => b.pchg - a.pchg) : [];

  useLayoutEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (el && strip.current) strip.current.scrollLeft = el.offsetLeft - strip.current.clientWidth / 2 + el.offsetWidth / 2;
  }, [date]);

  return (
    <div className={styles.dates}>
      <button type="button" className={styles.arr} disabled={idx <= 0} aria-label="Earlier session" onClick={() => onPick(all[idx - 1])}>
        ‹
      </button>
      <div className={styles.strip} ref={strip}>
        {model.dates.map((day, i) => {
          const rows = model.byDate.get(day) ?? [];
          const up = rows.filter((row) => row.fd > 0.00005).length / Math.max(1, rows.length);
          const sorted = [...rows].sort((a, b) => b.fd - a.fd);
          const label = dateLabel(day);
          const top = sorted[0]?.asset;
          const bottom = sorted[sorted.length - 1]?.asset;
          return (
            <button key={day} type="button" className={styles.rpd} aria-pressed={mode === "one" && day === date} aria-label={label.long} onClick={() => onPick(day)}>
              <span>{i === model.dates.length - 1 && !live ? "LATEST" : label.dow}</span>
              <b>{label.day}</b>
              <i className={styles.breadth}>
                <s style={{ width: `${(up * 100).toFixed(0)}%` }} />
              </i>
              <span className={styles.oms}>
                {top ? <Oshimark icon={bySymbol.get(top.symbol)?.icon ?? top.icon} symbol={top.symbol} size={14} /> : null}
                {bottom ? <Oshimark icon={bySymbol.get(bottom.symbol)?.icon ?? bottom.icon} symbol={bottom.symbol} size={14} /> : null}
              </span>
            </button>
          );
        })}
        {live ? (
          <button
            type="button"
            className={styles.rpd}
            data-live=""
            aria-pressed={mode === "one" && date === live.date}
            aria-label={`${dateLabel(live.date).long}, in progress`}
            onClick={() => onPick(live.date)}
          >
            <span>LIVE</span>
            <b>{dateLabel(live.date).day}</b>
            <i className={styles.breadth}>
              <s style={{ width: `${((live.rows.filter((row) => row.pchg > 0.00005).length / Math.max(1, live.rows.length)) * 100).toFixed(0)}%` }} />
            </i>
            <span className={styles.oms}>
              {liveSorted[0] ? <Oshimark icon={liveSorted[0].asset.icon} symbol={liveSorted[0].asset.symbol} size={14} /> : null}
              {liveSorted.length > 1 ? <Oshimark icon={liveSorted[liveSorted.length - 1].asset.icon} symbol={liveSorted[liveSorted.length - 1].asset.symbol} size={14} /> : null}
            </span>
          </button>
        ) : null}
      </div>
      <button type="button" className={styles.arr} disabled={idx < 0 || idx >= all.length - 1} aria-label="Later session" onClick={() => onPick(all[idx + 1])}>
        ›
      </button>
      <button type="button" className={styles.allBtn} aria-pressed={mode === "all"} onClick={onMode}>
        <i aria-hidden="true" />
        <span>
          ALL {model.dates.length}
          <br />
          SESSIONS
        </span>
      </button>
    </div>
  );
}

// ── Lede + KPIs ──────────────────────────────────────────────────────────
function Lede({ date, rows, report }: { date: string; rows: DayRow[]; report: DailyReport | null | undefined }) {
  const { theme } = useTheme();
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.fd - a.fd);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const up = rows.filter((row) => row.fd > 0.00005).length;
  const down = rows.filter((row) => row.fd < -0.00005).length;
  const emissions = report?.notable_treasury_emissions ?? [];
  const topEm = emissions[0];
  const cheap = [...rows].filter((row) => row.prem !== null).sort((a, b) => (a.prem ?? 0) - (b.prem ?? 0))[0];
  const head =
    up > down * 1.5
      ? `A green settlement: ${up} of ${rows.length} targets rise and ${top.asset.display_name} leads`
      : down > up * 1.5
        ? `A red settlement: ${down} of ${rows.length} targets cut, ${bottom.asset.display_name} hit hardest`
        : `A split settlement as ${top.asset.display_name} climbs and ${bottom.asset.display_name} slides`;
  const label = dateLabel(date);
  return (
    <div className={styles.lede}>
      <div>
        <div className={styles.kick}>{label.long.toUpperCase()} · SETTLEMENT REPORT · ALL FOUR ADJUSTMENTS IN</div>
        <h2>{head}</h2>
        <p>
          {top.asset.display_name} <StockChip symbol={top.asset.symbol} /> had its target raised the most, from {num(top.markBefore)} to {num(top.markAfter)}. {bottom.asset.display_name}{" "}
          <StockChip symbol={bottom.asset.symbol} /> took the biggest cut.
          {topEm ? (
            <>
              {" "}
              The treasury&apos;s biggest print went into <b>{topEm.symbol}</b> ({num(topEm.emission, 1)} new shares{premOf(topEm) !== null ? <> at a {pct(premOf(topEm))} premium</> : null})
            </>
          ) : null}
          {cheap ? (
            <>
              {topEm ? ", and " : " "}
              <b>{cheap.asset.symbol}</b> closed furthest under its target, at {pct(cheap.prem)}.
            </>
          ) : (
            "."
          )}
        </p>
      </div>
      <div className={styles.cast}>
        {[
          { row: top, pose: "hype" as const, label: "TOP OF SESSION", tone: "up" as const },
          { row: bottom, pose: "cope" as const, label: "BOTTOM", tone: "down" as const },
        ].map(({ row, pose, label: caption, tone }) => (
          <Link key={caption} href={`/stocks/${encodeURIComponent(row.asset.symbol)}`} className={styles.castFig}>
            <ArtSlot kind="chibi" pose={pose} symbol={row.asset.symbol} icon={row.asset.icon} accent={talentAccent(row.asset.color, theme)} width={256} className={styles.castArt} />
            <span>
              <b className={ui[tone]}>{pct(row.fd)}</b>
              {caption}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Kpis({ rows, report, indexValue }: { rows: DayRow[]; report: DailyReport | null | undefined; indexValue: { value: number; change: number } | null }) {
  if (!rows.length) return null;
  const up = rows.filter((row) => row.fd > 0.00005).length;
  const down = rows.filter((row) => row.fd < -0.00005).length;
  const avg = rows.reduce((sum, row) => sum + row.fd, 0) / rows.length;
  const sorted = [...rows].sort((a, b) => b.fd - a.fd);
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  const volumeCash = rows.reduce((sum, row) => sum + row.volume * (row.close ?? 0), 0);
  const prems = rows.map((row) => row.prem).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const median = prems.length ? prems[Math.floor(prems.length / 2)] : null;
  const supplyWatch = report?.supply_watch ?? null;
  const emission = (report?.notable_treasury_emissions ?? []).reduce((sum, row) => sum + (row.emission ?? 0), 0);
  const tight = supplyWatch ? supplyWatch.filter((row) => row.trading_state === "buyback" || row.shares_for_sale <= 0).length : null;
  return (
    <div className={ui.kstrip} style={{ "--cols": 6 } as React.CSSProperties}>
      <div>
        <span className={ui.label}>All-talent target</span>
        <span className={ui.kv}>{indexValue ? indexValue.value.toFixed(2) : "—"}</span>
        <span className={`${ui.ks} ${indexValue ? ui[toneClass(indexValue.change)] : ""}`}>{indexValue ? `${indexValue.change >= 0 ? "▲" : "▼"} ${pct(indexValue.change)}` : "—"}</span>
      </div>
      <div>
        <span className={ui.label}>Breadth</span>
        <span className={ui.kv}>
          <span className={ui.up}>{up}</span>
          <span className={ui.flat}> / </span>
          <span className={ui.down}>{down}</span>
        </span>
        <span className={ui.ks}>targets up / down of {rows.length}</span>
      </div>
      <div>
        <span className={ui.label}>Avg target move</span>
        <span className={`${ui.kv} ${ui[toneClass(avg)]}`}>{pct(avg)}</span>
        <span className={ui.ks}>
          max {pct(sorted[0].fd)} · min {pct(sorted[sorted.length - 1].fd)}
        </span>
      </div>
      <div>
        {tight !== null ? (
          <>
            <span className={ui.label}>Sold out</span>
            <span className={ui.kv}>{tight}</span>
            <span className={ui.ks}>sold out or in a buyback</span>
          </>
        ) : (
          <>
            <span className={ui.label}>New shares</span>
            <span className={ui.kv}>{emission ? Math.round(emission).toLocaleString("en-US") : "—"}</span>
            <span className={ui.ks}>treasury print (old rules)</span>
          </>
        )}
      </div>
      <div>
        <span className={ui.label}>Session volume</span>
        <span className={ui.kv}>{compactMoney(volumeCash)}</span>
        <span className={ui.ks}>{volume.toLocaleString("en-US")} shares</span>
      </div>
      <div>
        <span className={ui.label}>Median close vs target</span>
        <span className={`${ui.kv} ${median !== null && median > 0 ? ui.down : ui.up}`}>{pct(median)}</span>
        <span className={ui.ks}>close vs the day&apos;s target</span>
      </div>
    </div>
  );
}

// ── Swarm: every talent's oshimark placed by how far they moved ───────────────
/**
 * Every talent on one line, placed by `value` (a target move once the day is done, a price move while it runs).
 * `fill`: stretch to the height of the row it shares instead of a fixed one.
 */
function Swarm({ points, title, upLabel, downLabel, fill = false }: { points: Array<{ asset: DayRow["asset"]; value: number }>; title: string; upLabel: string; downLabel: string; fill?: boolean }) {
  const rows = points.map((point) => ({ asset: point.asset, fd: point.value }));
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [boxHeight, setBoxHeight] = useState(0);
  const bySymbol = useAssetMap();
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      setBoxHeight(el.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!width || !rows.length) return null;
    // Scale to where most talents are (90% of them), so a few big movers don't squash everyone
    // else into the middle; the ones past it sit at the edge, which is labelled "≤" / "≥".
    const abs = rows.map((row) => Math.abs(row.fd)).sort((a, b) => a - b);
    const p90 = abs[Math.floor((abs.length - 1) * 0.9)] ?? 0;
    const maxAbs = [0.005, 0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 0.5, 1].find((step) => step >= p90) ?? Math.ceil(p90 * 10) / 10;
    const clipped = abs[abs.length - 1] > maxAbs;
    const small = width < 600;
    const H = fill && boxHeight ? Math.max(150, boxHeight - 22) : small ? 200 : 170;
    const place = (S: number) => {
      const X = (value: number) => S / 2 + ((Math.max(-maxAbs, Math.min(maxAbs, value)) + maxAbs) / (2 * maxAbs)) * (width - S);
      const bins = new Map<number, number>();
      const marks = [...rows]
        .sort((a, b) => Math.abs(a.fd) - Math.abs(b.fd))
        .map((row) => {
          const bin = Math.round(X(row.fd) / (S * 0.9));
          const n = (bins.get(bin) ?? 0) + 1;
          bins.set(bin, n);
          return { row, x: bin * S * 0.9, n };
        });
      return { S, X, marks, tallest: Math.max(...bins.values()) };
    };
    // Given the room (beside the day's chart), the oshimarks grow while the tallest pile still
    // fits comfortably under the labels.
    let placed = place(small ? 16 : 20);
    if (fill) {
      for (let size = 32; size > placed.S; size -= 2) {
        const bigger = place(size);
        if ((bigger.tallest - 1) * (size + 1) + size <= H * 0.8) {
          placed = bigger;
          break;
        }
      }
    }
    const { S, X, marks, tallest } = placed;
    const step = Math.min(S + 1, (H - S) / Math.max(1, tallest - 1));
    const ticks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];
    return { S, H, X, marks, step, ticks, clipped, zero: X(0) };
  }, [rows, width, fill, boxHeight]);

  const up = rows.filter((row) => row.fd > 0.00005).length;
  const down = rows.filter((row) => row.fd < -0.00005).length;
  return (
    <section className={`${styles.swarmSec} ${fill ? styles.swarmFill : ""}`}>
      <div className={ui.secHead}>
        <h2>{title}</h2>
        <span className={ui.aside}>each oshimark is a talent · hover to peek, click to open</span>
      </div>
      <div className={styles.swarm} ref={box} style={layout && !fill ? { height: layout.H + 22 } : undefined}>
        {layout ? (
          <>
            <div className={styles.zoneD} style={{ width: layout.zero }} />
            <div className={styles.zoneU} style={{ left: layout.zero }} />
            <div className={styles.zero} style={{ left: layout.zero }} />
            <div className={styles.axis} />
            <span className={`${styles.zl} ${ui.down}`} style={{ left: 8 }}>
              ← {down} {downLabel}
            </span>
            <span className={`${styles.zl} ${ui.up}`} style={{ right: 8 }}>
              {up} {upLabel} →
            </span>
            {layout.ticks.map((tick, i) => (
              <span key={i} className={`${styles.swtk} ${i === 0 ? styles.first : i === layout.ticks.length - 1 ? styles.last : ""}`} style={{ left: layout.X(tick) }}>
                {layout.clipped && i === 0 ? "≤" : layout.clipped && i === layout.ticks.length - 1 ? "≥" : ""}
                {tick > 0 ? "+" : ""}
                {(tick * 100).toFixed(Math.abs(tick * 100) % 1 ? 1 : 0)}%
              </span>
            ))}
            {layout.marks.map(({ row, x, n }) => (
              <Link
                key={row.asset.symbol}
                href={`/stocks/${encodeURIComponent(row.asset.symbol)}`}
                className={styles.mark}
                style={{ left: x, bottom: 22 + (n - 1) * layout.step, width: layout.S, height: layout.S }}
                data-peek-stock={row.asset.symbol}
                aria-label={`${row.asset.symbol} ${pct(row.fd)}`}
              >
                <Oshimark icon={bySymbol.get(row.asset.symbol)?.icon ?? row.asset.icon} symbol={row.asset.symbol} size={layout.S} />
              </Link>
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

// ── The four adjustments ─────────────────────────────────────────────────
/** The day's adjustments: what each did once it landed, and (once the day is done) how hard each pulled. */
function Ticks({ date, session }: { date: string; session?: SessionBreakdown | null }) {
  const pulls = new Map<string, { avg: number; top: { symbol: string; pct: number } | null }>();
  if (session?.finished) {
    for (const entry of session.adjustments) {
      const values = session.assets.flatMap((asset) => asset.steps.filter((step) => step.key === entry.key && step.strength_pct !== null).map((step) => ({ symbol: asset.symbol, pct: step.strength_pct as number })));
      if (!values.length) continue;
      const top = [...values].sort((a, b) => b.pct - a.pct)[0];
      pulls.set(entry.key, { avg: values.reduce((sum, value) => sum + value.pct, 0) / values.length, top });
    }
  }
  const adjustments = useHubStore((state) => state.adjustments);
  const bySymbol = useAssetMap();
  const sameDay = (value: string | null | undefined) => (value ?? "").slice(0, 10) === date;
  const recaps = (adjustments?.recaps ?? []).filter((recap) => sameDay(recap.market_date));
  const outcomes = [...(adjustments?.feed ?? []), ...(adjustments?.leaderboards.movers ?? []), ...(adjustments?.leaderboards.gap_compression ?? [])].filter((item) => sameDay(item.market_date));
  const unique = new Map<string, MarketAdjustmentOutcome>();
  outcomes.forEach((item) => unique.set(`${item.symbol}:${item.interval_key}`, item));
  const rows = [...unique.values()];
  if (!adjustments) return null;
  const maxMove = Math.max(0.0001, ...recaps.map((recap) => recap.avg_abs_move_pct ?? 0));
  const label = (key: string) => TICKS.find((tick) => tick.key === key)?.label ?? key;
  const row = (item: MarketAdjustmentOutcome, value: string, tone: "up" | "down" | "flat") => (
    <RankRow
      key={`${item.symbol}-${item.interval_key}-${value}`}
      symbol={item.symbol}
      icon={bySymbol.get(item.symbol.toUpperCase())?.icon ?? item.icon}
      detail={`${label(item.interval_key)} · ${item.applied_at ? `${formatEtTime(new Date(item.applied_at))} ET` : ""}`}
      tone="flat"
      valueTone={tone}
      value={value}
    />
  );
  const up = rows.filter((item) => (item.move_pct ?? 0) > 0).sort((a, b) => (b.move_pct ?? 0) - (a.move_pct ?? 0)).slice(0, 5);
  const down = rows.filter((item) => (item.move_pct ?? 0) < 0).sort((a, b) => (a.move_pct ?? 0) - (b.move_pct ?? 0)).slice(0, 5);
  const empty = <p className={ui.empty}>Not in the recent adjustment history.</p>;
  return (
    <section className={styles.ticks}>
      <div className={ui.secHead}>
        <h2>The four adjustments</h2>
        <span className={ui.aside}>
          {session?.finished ? "how hard each pulled, now the day is done" : "how hard each pulls stays secret until the day is done"} · {recaps.length} of 4 landed
        </span>
      </div>
      <div className={styles.tk4}>
        {TICKS.map((tick) => {
          const recap = recaps.find((item) => item.interval_key === tick.key);
          return recap ? (
            <div key={tick.key} className={styles.tkc}>
              <div className={styles.tkh}>
                <b>{tick.label.toUpperCase()}</b>
                <span>{recap.applied_at ? `${formatEtTime(new Date(recap.applied_at))} ET` : `${String(tick.hour).padStart(2, "0")}:00 ET`}</span>
              </div>
              <div className={styles.str}>
                <i style={{ width: `${(((recap.avg_abs_move_pct ?? 0) / maxMove) * 100).toFixed(0)}%` }} />
              </div>
              <dl>
                <dt>Applied</dt>
                <dd>
                  {recap.applied_count ?? "—"}
                  {recap.asset_count ? ` / ${recap.asset_count}` : ""}
                </dd>
                <dt>Avg move</dt>
                <dd>±{((recap.avg_abs_move_pct ?? 0) * 100).toFixed(2)}%</dd>
                <dt>Skipped</dt>
                <dd>{recap.skipped_count ?? 0}</dd>
                {pulls.get(tick.key) ? (
                  <>
                    <dt>Avg pull</dt>
                    <dd>{Math.round(pulls.get(tick.key)!.avg)}% of the gap</dd>
                    <dt>Hardest</dt>
                    <dd>
                      {pulls.get(tick.key)!.top?.symbol} {Math.round(pulls.get(tick.key)!.top?.pct ?? 0)}%
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>
          ) : (
            <div key={tick.key} className={`${styles.tkc} ${styles.pend}`}>
              <div className={styles.tkh}>
                <b>{tick.label.toUpperCase()}</b>
                <span>{String(tick.hour).padStart(2, "0")}:00 ET</span>
              </div>
              <div className={styles.str}>
                <i />
              </div>
              <p className={styles.secret}>Lands at {String(tick.hour).padStart(2, "0")}:00 ET. How hard it pulls stays secret.</p>
            </div>
          );
        })}
      </div>
      <div className={styles.tkb}>
        <div className={ui.sec}>
          <div className={ui.secHead}>
            <h2 className={ui.up}>Largest adjustment moves up</h2>
          </div>
          {up.length ? up.map((item) => row(item, pct(item.move_pct), "up")) : empty}
        </div>
        <div className={ui.sec}>
          <div className={ui.secHead}>
            <h2 className={ui.down}>Largest adjustment moves down</h2>
          </div>
          {down.length ? down.map((item) => row(item, pct(item.move_pct), "down")) : empty}
        </div>
      </div>
    </section>
  );
}

// ── Report lists ─────────────────────────────────────────────────────────
function Lists({ rows, report, paths }: { rows: DayRow[]; report: DailyReport | null | undefined; paths: Map<string, TalentPath> }) {
  const bySymbol = useAssetMap();
  const icon = (symbol: string) => bySymbol.get(symbol.toUpperCase())?.icon;
  const byFd = [...rows].sort((a, b) => b.fd - a.fd);
  const maxFd = Math.max(0.0001, ...rows.map((row) => Math.abs(row.fd)));
  const list = (title: string, hint: string, tone: "up" | "down" | "", content: React.ReactNode) => (
    <div className={ui.sec}>
      <div className={ui.secHead}>
        <h2 className={tone ? ui[tone] : undefined}>{title}</h2>
        <span className={ui.aside}>{hint}</span>
      </div>
      {content}
    </div>
  );
  const fromReport = (items: ReportRow[] | undefined, value: (row: ReportRow) => number | null | undefined, format: (row: ReportRow) => string, detail: (row: ReportRow) => string, tone: (row: ReportRow) => "up" | "down" | "flat") => {
    const clean = (items ?? []).slice(0, 6);
    if (!clean.length) return <p className={ui.empty}>{report === undefined ? "Loading…" : "Not in this report."}</p>;
    const max = Math.max(0.0001, ...clean.map((row) => Math.abs(value(row) ?? 0)));
    return clean.map((row) => <RankRow key={row.symbol} symbol={row.symbol} icon={icon(row.symbol)} detail={detail(row)} bar={Math.abs(value(row) ?? 0) / max} tone={tone(row)} value={format(row)} />);
  };
  return (
    <div className={styles.grid}>
      {list(
        "Target up",
        "moved by the settlement",
        "up",
        byFd.slice(0, 6).map((row) => <RankRow key={row.asset.symbol} symbol={row.asset.symbol} icon={icon(row.asset.symbol)} detail={`${num(row.markBefore)} → ${num(row.markAfter)}`} bar={Math.abs(row.fd) / maxFd} tone="up" value={pct(row.fd)} />),
      )}
      {list(
        "Target down",
        "moved by the settlement",
        "down",
        byFd
          .slice(-6)
          .reverse()
          .map((row) => <RankRow key={row.asset.symbol} symbol={row.asset.symbol} icon={icon(row.asset.symbol)} detail={`${num(row.markBefore)} → ${num(row.markAfter)}`} bar={Math.abs(row.fd) / maxFd} tone="down" value={pct(row.fd)} />),
      )}
      {/* Price over the whole day, open to close (the stored report is written at 09:00, before the day trades). */}
      {(["up", "down"] as const).map((tone) => {
        const items = [...paths.values()]
          .filter((path) => (tone === "up" ? path.total > 0.00005 : path.total < -0.00005))
          .sort((a, b) => (tone === "up" ? b.total - a.total : a.total - b.total))
          .slice(0, 6);
        const top = Math.max(0.0001, ...items.map((path) => Math.abs(path.total)));
        return (
          <Fragment key={tone}>
            {list(
              tone === "up" ? "Breakouts" : "Drawdowns",
              "price, open to close",
              "",
              items.length ? (
                items.map((path) => (
                  <RankRow key={path.symbol} symbol={path.symbol} icon={icon(path.symbol)} detail={`${num(path.open)} → ${num(path.now)}`} bar={Math.abs(path.total) / top} tone={tone} value={pct(path.total)} />
                ))
              ) : (
                <p className={ui.empty}>{paths.size ? "None." : "Loading…"}</p>
              ),
            )}
          </Fragment>
        );
      })}
      {(["adj", "trade"] as const).map((key) => {
        const items = [...paths.values()].filter((path) => Math.abs(path[key]) > 0.00005).sort((a, b) => Math.abs(b[key]) - Math.abs(a[key])).slice(0, 6);
        const top = Math.max(0.0001, ...items.map((path) => Math.abs(path[key])));
        return (
          <Fragment key={key}>
            {list(
              key === "adj" ? "Adjustments did most" : "Trading did most",
              key === "adj" ? "the four adjustments together" : "what players moved between them",
              "",
              items.length ? (
                items.map((path) => (
                  <RankRow
                    key={path.symbol}
                    symbol={path.symbol}
                    icon={icon(path.symbol)}
                    detail={key === "adj" ? `trading ${pct(path.trade)}` : `adjustments ${pct(path.adj)}`}
                    bar={Math.abs(path[key]) / top}
                    tone={path[key] >= 0 ? "up" : "down"}
                    value={pct(path[key])}
                  />
                ))
              ) : (
                <p className={ui.empty}>{paths.size ? "Nothing moved." : "Loading…"}</p>
              ),
            )}
          </Fragment>
        );
      })}
      {list(
        "Flow acceleration",
        "volume vs the session before",
        "",
        fromReport(report?.volume_winners, (row) => row.volume_change_pct, (row) => pct(row.volume_change_pct), (row) => `${compactMoney(row.volume_cash)} · ${(row.volume_shares ?? 0).toLocaleString("en-US")} sh`, (row) => toneClass(row.volume_change_pct)),
      )}
      {report?.supply_watch
        ? list(
            "Supply watch",
            "left for sale",
            "",
            report.supply_watch.slice(0, 6).map((row) => (
              <RankRow
                key={row.symbol}
                symbol={row.symbol}
                icon={icon(row.symbol)}
                detail={`${Math.round(row.held).toLocaleString("en-US")} of ${Math.round(row.max_supply).toLocaleString("en-US")} held`}
                bar={row.max_supply ? Math.min(1, row.held / row.max_supply) : 0}
                tone={row.trading_state === "buyback" || row.shares_for_sale <= 0 ? "down" : "flat"}
                value={row.trading_state === "buyback" ? "BUYBACK" : row.shares_for_sale <= 0 ? "SOLD OUT" : `${Math.floor(row.shares_for_sale).toLocaleString("en-US")}`}
              />
            )),
          )
        : list("Dilution watch", "new shares", "", fromReport(report?.notable_treasury_emissions, (row) => row.emission, (row) => `${num(row.emission, 1)} sh`, (row) => `closed ${num(row.market_price)}`, () => "flat"))}
      {list("Most traded", "shares, the session", "", fromReport(report?.top_volume, (row) => row.volume_shares, (row) => `${(row.volume_shares ?? 0).toLocaleString("en-US")} sh`, (row) => compactMoney(row.volume_cash), () => "flat"))}
      {list("Going quiet", "volume vs the session before", "", fromReport(report?.volume_losers, (row) => row.volume_change_pct, (row) => pct(row.volume_change_pct), (row) => `${compactMoney(row.volume_cash)} · ${(row.volume_shares ?? 0).toLocaleString("en-US")} sh`, (row) => toneClass(row.volume_change_pct)))}
    </div>
  );
}

// ── Today, while its adjustments are still landing ───────────────────────
/**
 * The adjustment report: the day so far, told in what has actually happened: prices since the last
 * close, the adjustments that have landed and the trading around them. How far the settlement moved
 * each target, and how hard each adjustment pulls, stay secret until the day's last adjustment;
 * then this day becomes the settlement report.
 */
function LiveSession({
  live,
  report,
  session,
  paths,
  window,
}: {
  live: NonNullable<DayModel["live"]>;
  report: DailyReport | null | undefined;
  session: SessionBreakdown | null | undefined;
  paths: Map<string, TalentPath>;
  window: { start: number; end: number } | null;
}) {
  const { theme } = useTheme();
  const assets = useMarketStore((state) => state.assets);
  const bySymbol = useAssetMap();
  const icon = (symbol: string) => bySymbol.get(symbol.toUpperCase())?.icon;
  const rows = [...live.rows].sort((a, b) => b.pchg - a.pchg);
  if (!rows.length) return <p className={styles.loading}>The session has just opened.</p>;
  const up = rows.filter((row) => row.pchg > 0.00005).length;
  const down = rows.filter((row) => row.pchg < -0.00005).length;
  const avg = rows.reduce((sum, row) => sum + row.pchg, 0) / rows.length;
  const top = rows[0];
  const bottom = rows[rows.length - 1];
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  const volumeCash = rows.reduce((sum, row) => sum + row.volume * row.price, 0);
  const share = adjustmentShare(paths.values());
  const done = (session?.adjustments ?? []).filter((entry) => entry.total > 0 && entry.landed >= entry.total);
  const next = session?.adjustments.find((entry) => entry.landed < entry.total) ?? null;
  const revealAt = session?.reveal_at ?? report?.targets_reveal_at ?? null;
  const label = dateLabel(live.date);
  const head =
    up > down * 1.5
      ? `A green day so far: ${up} of ${rows.length} up, and ${top.asset.display_name} leads`
      : down > up * 1.5
        ? `A red day so far: ${down} of ${rows.length} down, ${bottom.asset.display_name} hit hardest`
        : `A split day so far as ${top.asset.display_name} climbs and ${bottom.asset.display_name} slides`;
  const pathOf = (symbol: string) => paths.get(symbol.toUpperCase()) ?? null;
  const byMove = (key: "adj" | "trade") =>
    [...paths.values()]
      .filter((path) => Math.abs(path[key]) > 0.00005)
      .sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]))
      .slice(0, 6);
  const list = (title: string, hint: string, tone: "up" | "down" | "", content: React.ReactNode) => (
    <div className={ui.sec}>
      <div className={ui.secHead}>
        <h2 className={tone ? ui[tone] : undefined}>{title}</h2>
        <span className={ui.aside}>{hint}</span>
      </div>
      {content}
    </div>
  );
  const max = Math.max(0.0001, ...rows.map((row) => Math.abs(row.pchg)));
  const priceRow = (row: (typeof rows)[number], tone: "up" | "down") => (
    <RankRow key={row.asset.symbol} symbol={row.asset.symbol} icon={icon(row.asset.symbol)} detail={`${num(row.prevClose)} → ${num(row.price)}`} bar={Math.abs(row.pchg) / max} tone={tone} value={pct(row.pchg)} />
  );
  const moveRows = (key: "adj" | "trade") => {
    const items = byMove(key);
    const top = Math.max(0.0001, ...items.map((path) => Math.abs(path[key])));
    return items.length ? (
      items.map((path) => (
        <RankRow
          key={path.symbol}
          symbol={path.symbol}
          icon={icon(path.symbol)}
          detail={key === "adj" ? `${path.landed} adjustment${path.landed === 1 ? "" : "s"} · trading ${pct(path.trade)}` : `adjustments ${pct(path.adj)}`}
          bar={Math.abs(path[key]) / top}
          tone={path[key] >= 0 ? "up" : "down"}
          value={pct(path[key])}
        />
      ))
    ) : (
      <p className={ui.empty}>{session === undefined ? "Loading…" : "Nothing yet."}</p>
    );
  };
  const tableRows = rows.map((row) => ({ ...row, path: pathOf(row.asset.symbol) }));

  return (
    <>
      <div className={styles.lede}>
        <div>
          <div className={styles.kick}>
            {label.long.toUpperCase()} · ADJUSTMENT REPORT · {done.length} OF {session?.adjustments.length || 4} LANDED
          </div>
          <h2>{head}</h2>
          <p>
            Prices since the last close{done.length ? `, after the ${done.map((entry) => adjustmentLabel(entry.key)).join(", ")} adjustment${done.length === 1 ? "" : "s"}` : ""}.{" "}
            {top.asset.display_name} <StockChip symbol={top.asset.symbol} /> is up the most, from {num(top.prevClose)} to {num(top.price)}; {bottom.asset.display_name}{" "}
            <StockChip symbol={bottom.asset.symbol} /> is down the most. How far this morning&apos;s settlement moved each target, and how hard each adjustment pulls, stays secret
            until the day&apos;s last adjustment{revealAt ? ` (${formatEtTime(new Date(revealAt))} ET)` : ""}. Then this becomes the settlement report.
          </p>
        </div>
        <div className={styles.cast}>
          {[
            { row: top, pose: "hype" as const, caption: "UP THE MOST", tone: "up" as const },
            { row: bottom, pose: "cope" as const, caption: "DOWN THE MOST", tone: "down" as const },
          ].map(({ row, pose, caption, tone }) => (
            <Link key={caption} href={`/stocks/${encodeURIComponent(row.asset.symbol)}`} className={styles.castFig}>
              <ArtSlot kind="chibi" pose={pose} symbol={row.asset.symbol} icon={row.asset.icon} accent={talentAccent(row.asset.color, theme)} width={256} className={styles.castArt} />
              <span>
                <b className={ui[tone]}>{pct(row.pchg)}</b>
                {caption}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className={ui.kstrip} style={{ "--cols": 6 } as React.CSSProperties}>
        <div>
          <span className={ui.label}>All-talent move</span>
          <span className={`${ui.kv} ${ui[toneClass(avg)]}`}>{pct(avg)}</span>
          <span className={ui.ks}>equal weight, since the last close</span>
        </div>
        <div>
          <span className={ui.label}>Breadth</span>
          <span className={ui.kv}>
            <span className={ui.up}>{up}</span>
            <span className={ui.flat}> / </span>
            <span className={ui.down}>{down}</span>
          </span>
          <span className={ui.ks}>up / down of {rows.length}</span>
        </div>
        <div>
          <span className={ui.label}>Range</span>
          <span className={`${ui.kv} ${ui[toneClass(top.pchg)]}`}>{pct(top.pchg)}</span>
          <span className={ui.ks}>top · bottom {pct(bottom.pchg)}</span>
        </div>
        <div>
          <span className={ui.label}>Adjustments</span>
          <span className={ui.kv}>
            {done.length} / {session?.adjustments.length || 4}
          </span>
          <span className={ui.ks}>{next ? `next: ${adjustmentLabel(next.key)} at ${formatEtTime(new Date(next.scheduled_at))} ET` : "all landed"}</span>
        </div>
        <div>
          <span className={ui.label}>Session volume</span>
          <span className={ui.kv}>{compactMoney(volumeCash)}</span>
          <span className={ui.ks}>{volume.toLocaleString("en-US")} shares</span>
        </div>
        <div>
          <span className={ui.label}>Moved by adjustments</span>
          <span className={ui.kv}>{share === null ? "—" : `${Math.round(share * 100)}%`}</span>
          <span className={ui.ks}>{share === null ? "nothing has moved yet" : `the rest, ${Math.round((1 - share) * 100)}%, by trading`}</span>
        </div>
      </div>

      <div className={styles.pairRow}>
        <Swarm points={rows.map((row) => ({ asset: row.asset, value: row.pchg }))} title="Where every price stands" upLabel="UP" downLabel="DOWN" fill />
        {session && window ? <TalentDay session={session} window={window} paths={paths} assets={assets} targets={null} defaultSymbol={[...rows].sort((a, b) => Math.abs(b.pchg) - Math.abs(a.pchg))[0]?.asset.symbol ?? null} /> : null}
      </div>
      <Ticks date={live.date} session={session} />

      <div className={styles.grid}>
        {list("Up so far", "price since the last close", "up", up ? rows.filter((row) => row.pchg > 0.00005).slice(0, 6).map((row) => priceRow(row, "up")) : <p className={ui.empty}>Nothing up yet.</p>)}
        {list(
          "Down so far",
          "price since the last close",
          "down",
          down ? [...rows].reverse().filter((row) => row.pchg < -0.00005).slice(0, 6).map((row) => priceRow(row, "down")) : <p className={ui.empty}>Nothing down yet.</p>,
        )}
        {list("Adjustments did most", "what the landed adjustments moved", "", moveRows("adj"))}
        {list("Trading did most", "what players moved around them", "", moveRows("trade"))}
        {list(
          "Most traded",
          "shares, so far",
          "",
          [...rows]
            .filter((row) => row.volume > 0)
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 6)
            .map((row) => <RankRow key={row.asset.symbol} symbol={row.asset.symbol} icon={icon(row.asset.symbol)} detail={compactMoney(row.volume * row.price)} tone="flat" value={`${row.volume.toLocaleString("en-US")} sh`} />),
        )}
      </div>

      <Angle
        date={live.date}
        title="Your book today"
        change={(symbol) => {
          const row = live.rows.find((entry) => entry.asset.symbol.toUpperCase() === symbol.toUpperCase());
          return row ? { move: row.pchg, perShare: row.price - row.prevClose, label: "today" } : null;
        }}
        note={(total) => (
          <>
            Your bags are {total >= 0 ? "up" : "down"} <b className={ui[toneClass(total)]}>{money(Math.abs(total))}</b> since the last close.
          </>
        )}
      />

      <FullTable
        rows={tableRows}
        initial="pchg"
        columns={[
          { key: "prev", label: "Last close", sort: (row) => row.prevClose, cell: (row) => num(row.prevClose), className: () => styles.dim },
          { key: "now", label: "Now", sort: (row) => row.price, cell: (row) => num(row.price) },
          { key: "pchg", label: "Δ", sort: (row) => row.pchg, cell: (row) => <span className={`${styles.mv} ${styles[toneClass(row.pchg)]}`}>{pct(row.pchg)}</span> },
          { key: "adj", label: "Adjustments", sort: (row) => row.path?.adj ?? null, cell: (row) => (row.path ? pct(row.path.adj) : "—"), className: (row) => (row.path ? ui[toneClass(row.path.adj)] : undefined) },
          { key: "trade", label: "Trading", sort: (row) => row.path?.trade ?? null, cell: (row) => (row.path ? pct(row.path.trade) : "—"), className: (row) => (row.path ? ui[toneClass(row.path.trade)] : undefined) },
          { key: "volume", label: "Volume", sort: (row) => row.volume, cell: (row) => row.volume.toLocaleString("en-US") },
        ]}
      />
    </>
  );
}

// ── Your angle: book, exposure, index context ────────────────────────────
/**
 * The report read against your own bags. `change` says how a talent moved in this view (the target
 * at the settlement once the day is done, the price since the last close while it runs).
 */
function Angle({
  date,
  title,
  change,
  note,
}: {
  date: string;
  title: string;
  change: (symbol: string) => { move: number; perShare: number; label: string } | null;
  note: (total: number) => ReactNode;
}) {
  const { user } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
  const bySymbol = useAssetMap();
  useEffect(() => {
    if (user) void fetchPortfolio();
  }, [fetchPortfolio, user]);

  const all = marketIndexes.find((index) => index.group === "all");
  const series = (all?.series ?? []).filter((point) => point.value !== null);
  const values = series.map((point) => point.value as number);
  const markerIndex = series.findIndex((point) => point.bucket.slice(0, 10) === date);
  const labels = series.length ? [series[0].bucket.slice(0, 7), series[Math.floor(series.length / 2)].bucket.slice(0, 7), dateLabel(series[series.length - 1].bucket.slice(0, 10)).short] : [];

  const holdings = (portfolio?.holdings ?? []).filter((holding) => holding.quantity > 0);
  const effects = holdings
    .map((holding) => {
      const row = change(holding.symbol);
      return { holding, row, effect: row ? holding.quantity * row.perShare : 0 };
    })
    .sort((a, b) => b.effect - a.effect);
  const total = effects.reduce((sum, item) => sum + item.effect, 0);
  const units = new Map<string, number>();
  holdings.forEach((holding) => {
    const unit = unitLabel(bySymbol.get(holding.symbol.toUpperCase())?.unit);
    units.set(unit, (units.get(unit) ?? 0) + holding.market_value);
  });
  const mv = portfolio?.total_market_value ?? 0;

  return (
    <div className={styles.angle}>
      <div className={ui.sec}>
        <div className={ui.secHead}>
          <h2>{title}</h2>
          {user ? (
            <Link href="/profile" className={ui.aside}>
              profile →
            </Link>
          ) : null}
        </div>
        {user && portfolio ? (
          <>
            <div className={styles.bk3}>
              <div>
                <span>EQUITY</span>
                <b>{money(portfolio.total_equity)}</b>
              </div>
              <div>
                <span>MARKET VALUE</span>
                <b>{money(portfolio.total_market_value)}</b>
              </div>
              <div>
                <span>UNREALIZED P/L</span>
                <b className={ui[toneClass(portfolio.total_unrealized_pnl)]}>{money(portfolio.total_unrealized_pnl)}</b>
              </div>
            </div>
            {effects.map(({ holding, row, effect }) => (
              <RankRow
                key={holding.symbol}
                symbol={holding.symbol}
                icon={bySymbol.get(holding.symbol.toUpperCase())?.icon}
                detail={`${holding.quantity.toLocaleString("en-US")} sh · ${row ? `${row.label} ${pct(row.move)}` : "—"}`}
                tone="flat"
                valueTone={toneClass(effect)}
                value={`${effect >= 0 ? "+" : "−"}${money(Math.abs(effect))}`}
              />
            ))}
            {effects.length ? (
              <p className={ui.note}>{note(total)}</p>
            ) : (
              <p className={ui.empty}>No bags to read this report against.</p>
            )}
          </>
        ) : (
          <p className={ui.empty}>Sign in to read the report against your own bags.</p>
        )}
      </div>
      <div className={ui.sec}>
        <div className={ui.secHead}>
          <h2>Exposure by unit</h2>
          <span className={ui.aside}>share of your bags</span>
        </div>
        {units.size && mv > 0 ? (
          [...units.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([unit, value]) => (
              <div key={unit} className={styles.exrow}>
                <span>{unit}</span>
                <i style={{ width: `${Math.max(4, (value / mv) * 100).toFixed(0)}%` }} />
                <span className={styles.r}>{((value / mv) * 100).toFixed(0)}%</span>
              </div>
            ))
        ) : (
          <p className={ui.empty}>Nothing held yet.</p>
        )}
      </div>
      <div className={ui.sec}>
        <div className={ui.secHead}>
          <h2>Index context</h2>
          <Link href="/market/indexes" className={ui.aside}>
            indexes →
          </Link>
        </div>
        <div className={styles.ixctx}>
          <AreaLine values={values} markerIndex={markerIndex >= 0 ? markerIndex : null} labels={labels} />
        </div>
        <p className={ui.note} style={{ marginTop: "1.4rem" }}>
          All-talent index, equal weight. The dashed line is this session.
        </p>
      </div>
    </div>
  );
}

// ── Every stock ──────────────────────────────────────────────────────────
/** A column after the Stock and Unit columns every table has. `sort` null sorts last. */
type Column<T> = {
  key: string;
  label: string;
  sort: (row: T) => number | null;
  cell: (row: T) => ReactNode;
  className?: (row: T) => string | undefined;
};

function FullTable<T extends { asset: DayRow["asset"] }>({ rows, columns, initial }: { rows: T[]; columns: Array<Column<T>>; initial: string }) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initial, dir: -1 });
  const bySymbol = useAssetMap();
  const value = (row: T): number | string => {
    if (sort.key === "sym") return row.asset.symbol;
    if (sort.key === "unit") return unitName(row.asset.unit);
    return columns.find((column) => column.key === sort.key)?.sort(row) ?? -Infinity;
  };
  const sorted = [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir;
  });
  const heads: Array<[string, string, boolean?]> = [["sym", "Stock", true], ["unit", "Unit", true], ...columns.map((column): [string, string] => [column.key, column.label])];
  return (
    <div className={styles.full}>
      <div className={styles.fullHead}>
        <h2>Every stock</h2>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "HIDE TABLE" : "SHOW TABLE"}
        </button>
      </div>
      {open ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {heads.map(([key, label, left]) => (
                  <th
                    key={key}
                    className={left ? styles.l : undefined}
                    aria-sort={sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}
                    onClick={() => setSort((current) => (current.key === key ? { key, dir: current.dir > 0 ? -1 : 1 } : { key, dir: key === "sym" || key === "unit" ? 1 : -1 }))}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.asset.symbol}>
                  <td className={styles.l}>
                    <Link href={`/stocks/${encodeURIComponent(row.asset.symbol)}`} className={styles.who} data-peek-stock={row.asset.symbol}>
                      <Oshimark icon={bySymbol.get(row.asset.symbol)?.icon ?? row.asset.icon} symbol={row.asset.symbol} size={20} />
                      <span>
                        <b>{row.asset.symbol}</b>
                        <small>{row.asset.display_name}</small>
                      </span>
                    </Link>
                  </td>
                  <td className={`${styles.l} ${styles.unit}`}>{unitLabel(row.asset.unit)}</td>
                  {columns.map((column) => (
                    <td key={column.key} className={column.className?.(row)}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// ── All sessions heatmap ─────────────────────────────────────────────────
function heatBg(value: number | null, metric: Metric) {
  if (value === null) return "transparent";
  const scale = metric === "prem" ? 0.15 : metric === "pchg" ? 0.06 : 0.05;
  let t = Math.max(-1, Math.min(1, value / scale));
  if (metric === "prem") t = -t;
  if (Math.abs(t) < 0.03) return "var(--ink-3)";
  const alpha = (0.12 + Math.abs(t) * 0.7).toFixed(3);
  return t > 0 ? `rgba(46, 227, 142, ${alpha})` : `rgba(255, 68, 96, ${alpha})`;
}

function Heatmap({ model, date, onPick }: { model: DayModel; date: string; onPick: (date: string) => void }) {
  const assets = useMarketStore((state) => state.assets);
  const portfolio = useProfileStore((state) => state.portfolio);
  const [metric, setMetric] = useState<Metric>("fd");
  const [sort, setSort] = useState<"unit" | "total" | "vol">("unit");
  const mine = useMemo(() => new Set((portfolio?.holdings ?? []).filter((holding) => holding.quantity > 0).map((holding) => holding.symbol.toUpperCase())), [portfolio]);
  const dates = model.dates;
  const rows = useMemo(
    () =>
      assets.map((asset) => {
        const days = model.bySymbol.get(asset.symbol.toUpperCase());
        const values = dates.map((day) => {
          const row = days?.get(day);
          return row ? (row[metric] as number | null) : null;
        });
        const first = days?.get(dates[0])?.markBefore;
        const last = days?.get(dates[dates.length - 1])?.markAfter;
        const total = first && last ? (last - first) / first : 0;
        const present = values.filter((value): value is number => value !== null);
        const vol = present.length ? Math.sqrt(present.reduce((sum, value) => sum + value * value, 0) / present.length) : 0;
        const spark = dates.map((day) => days?.get(day)?.markAfter).filter((value): value is number => value !== undefined);
        return { asset, values, total, vol, spark };
      }),
    [assets, dates, metric, model.bySymbol],
  );
  const scale = metric === "prem" ? 15 : metric === "pchg" ? 6 : 5;
  const aggregate = dates.map((day) => {
    const dayRows = model.byDate.get(day) ?? [];
    const vals = dayRows.map((row) => row[metric] as number | null).filter((value): value is number => value !== null);
    return { avg: vals.length ? vals.reduce((sum, value) => sum + value, 0) / vals.length : null, up: dayRows.filter((row) => row.fd > 0.00005).length / Math.max(1, dayRows.length) };
  });
  const cells = (values: Array<number | null>, symbol: string) =>
    values.map((value, i) => (
      <td
        key={dates[i]}
        className={`${styles.c} ${mine.has(symbol) ? styles.mineCell : ""}`}
        style={{ background: heatBg(value, metric) }}
        title={`${symbol} · ${dateLabel(dates[i]).long} · ${pct(value)}`}
        onClick={() => onPick(dates[i])}
      >
        {value === null ? "" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}`}
      </td>
    ));
  const renderRow = (row: (typeof rows)[number]) => (
    <tr key={row.asset.symbol}>
      <th className={styles.s}>
        <Link href={`/stocks/${encodeURIComponent(row.asset.symbol)}`} data-peek-stock={row.asset.symbol}>
          <Oshimark icon={row.asset.icon} symbol={row.asset.symbol} size={16} />
          {row.asset.symbol}
        </Link>
      </th>
      {cells(row.values, row.asset.symbol.toUpperCase())}
      <td className={styles.tot}>
        <span>
          <svg viewBox="0 0 70 16" preserveAspectRatio="none" aria-hidden="true">
            {row.spark.length > 1 ? (
              <polyline
                points={row.spark
                  .map((value, i) => {
                    const min = Math.min(...row.spark);
                    const max = Math.max(...row.spark);
                    return `${((i / (row.spark.length - 1)) * 70).toFixed(1)},${(15 - ((value - min) / (max - min || 1)) * 14).toFixed(1)}`;
                  })
                  .join(" ")}
                fill="none"
                stroke={row.total >= 0 ? "var(--up)" : "var(--down)"}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          <b className={ui[toneClass(row.total)]}>{pct(row.total)}</b>
        </span>
      </td>
    </tr>
  );
  const body =
    sort === "unit"
      ? groupByUnit(assets).map((group) => {
          const unitRows = rows.filter((row) => group.assets.includes(row.asset));
          const avg = unitRows.reduce((sum, row) => sum + row.total, 0) / Math.max(1, unitRows.length);
          return (
            <Fragment key={group.unit}>
              <tr className={styles.ug}>
                <th colSpan={dates.length + 2}>
                  {unitLabel(group.unit)}
                  <small className={ui[toneClass(avg)]}>{pct(avg)} over the window</small>
                </th>
              </tr>
              {unitRows.map(renderRow)}
            </Fragment>
          );
        })
      : [...rows].sort((a, b) => (sort === "total" ? b.total - a.total : b.vol - a.vol)).map(renderRow);

  return (
    <div>
      <div className={styles.hmCtl}>
        <div>
          <h2>{dates.length} sessions at a glance</h2>
          <p>Every talent, session by session. Click any column to open that day&apos;s report.</p>
        </div>
        <div className={styles.hmCtlR}>
          <Seg
            label="Metric"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "fd", label: "TARGET Δ" },
              { value: "prem", label: "CLOSE VS TARGET" },
              { value: "pchg", label: "PRICE Δ" },
            ]}
          />
          <Seg
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "unit", label: "BY UNIT" },
              { value: "total", label: "BEST OVER WINDOW" },
              { value: "vol", label: "MOST VOLATILE" },
            ]}
          />
        </div>
      </div>
      <div className={styles.hmLegend}>
        <span>{metric === "prem" ? `+${scale}% above` : `−${scale}%`}</span>
        <i style={{ background: `linear-gradient(90deg, ${heatBg(-scale / 100, metric === "prem" ? "fd" : metric)}, var(--ink-3), ${heatBg(scale / 100, metric === "prem" ? "fd" : metric)})` }} />
        <span>{metric === "prem" ? `−${scale}% below` : `+${scale}%`}</span>
        <span className={styles.hmNote}>
          {metric === "fd" ? "target change at the settlement" : metric === "prem" ? "closing price vs that day\u2019s target" : "price change over the session"}
          {mine.size ? " · blue outline = your bags" : ""}
        </span>
      </div>
      <div className={styles.hmWrap}>
        <table className={styles.hm}>
          <thead>
            <tr>
              <th className={styles.s}>
                <span className={styles.sessionLabel}>SESSION</span>
              </th>
              {dates.map((day, i) => {
                const label = dateLabel(day);
                return (
                  <th key={day} className={`${styles.col} ${day === date ? styles.on : ""}`}>
                    <button type="button" onClick={() => onPick(day)} aria-label={`Open ${label.long}`}>
                      {i === dates.length - 1 ? "LATEST" : label.dow}
                      <b>{label.day}</b>
                    </button>
                  </th>
                );
              })}
              <th className={styles.totHead}>WINDOW</th>
            </tr>
            <tr className={styles.agg}>
              <th className={styles.s}>
                <span className={styles.sessionLabel}>ALL-TALENT</span>
              </th>
              {aggregate.map((entry, i) => (
                <td key={dates[i]} className={styles.c} style={{ background: heatBg(entry.avg, metric) }} onClick={() => onPick(dates[i])}>
                  {entry.avg === null ? "" : `${entry.avg > 0 ? "+" : ""}${(entry.avg * 100).toFixed(1)}`}
                </td>
              ))}
              <td className={styles.tot} />
            </tr>
            <tr className={styles.agg}>
              <th className={styles.s}>
                <span className={styles.sessionLabel}>BREADTH</span>
              </th>
              {aggregate.map((entry, i) => (
                <td key={dates[i]} className={styles.c} onClick={() => onPick(dates[i])}>
                  <span className={styles.brd}>
                    <s style={{ width: `${(entry.up * 100).toFixed(0)}%` }} />
                  </span>
                </td>
              ))}
              <td className={styles.tot} />
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────
export function ReportTab({ initialDate, initialView }: { initialDate?: string; initialView?: string }) {
  const router = useRouter();
  const assets = useMarketStore((state) => state.assets);
  const latest = useMarketStore((state) => state.report);
  const model = useMemo(() => buildDays(assets), [assets]);
  const [mode, setMode] = useState<"one" | "all">(initialView === "all" ? "all" : "one");
  const [picked, setPicked] = useState<string | null>(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : null);
  const fallback = latest?.market_date?.slice(0, 10);
  const all = sessionDates(model);
  // Today while its adjustments land (the adjustment report), else the latest settlement report.
  const date = picked && all.includes(picked) ? picked : model.live ? model.live.date : fallback && model.dates.includes(fallback) ? fallback : model.dates[model.dates.length - 1] ?? null;
  const live = model.live && date === model.live.date ? model.live : null;
  const report = useReport(date);
  const session = useSession(mode === "one" ? date : null, Boolean(live));
  const rows = useMemo(() => (date ? model.byDate.get(date) ?? [] : []), [date, model.byDate]);
  const index = useMemo(() => {
    const series = markIndex(assets);
    if (!date || series.length < 2) return null;
    // markIndex aligns with the sparkline window; map the date to its position.
    const pos = model.dates.indexOf(date) + (series.length - model.dates.length);
    if (pos < 1 || pos >= series.length) return null;
    return { value: series[pos], change: (series[pos] - series[pos - 1]) / series[pos - 1] };
  }, [assets, date, model.dates]);
  // Each talent's day step by step: live prices while it runs, the close once it's done.
  const { window, paths } = useMemo(() => {
    if (!session || session.market_date !== date) return { window: null, paths: new Map<string, TalentPath>() };
    const price = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset.market_price ?? asset.current_mid_price ?? null]));
    return buildPaths(session, (symbol) => price.get(symbol.toUpperCase()) ?? null, !session.finished);
  }, [session, date, assets]);
  const targets = useMemo(() => new Map(rows.map((row) => [row.asset.symbol.toUpperCase(), { before: row.markBefore, after: row.markAfter }])), [rows]);

  const sync = (nextDate: string | null, nextMode: "one" | "all") => {
    const params = new URLSearchParams();
    if (nextDate && nextDate !== all[all.length - 1]) params.set("date", nextDate);
    if (nextMode === "all") params.set("view", "all");
    const query = params.toString();
    router.replace(`/market/report${query ? `?${query}` : ""}`, { scroll: false });
  };
  const pick = (day: string) => {
    setPicked(day);
    setMode("one");
    sync(day, "one");
  };
  const toggleMode = () => {
    const next = mode === "all" ? "one" : "all";
    setMode(next);
    sync(date, next);
  };

  if (!assets.length || !date) {
    return <p className={styles.loading}>Loading the report…</p>;
  }

  const finished = session?.finished && window ? session : null;
  return (
    <>
      <DateStrip model={model} date={date} mode={mode} onPick={pick} onMode={toggleMode} />
      {mode === "all" ? (
        <Heatmap model={model} date={date} onPick={pick} />
      ) : live ? (
        <LiveSession live={live} report={report} session={session} paths={paths} window={window} />
      ) : (
        <>
          <Lede date={date} rows={rows} report={report} />
          <Kpis rows={rows} report={report} indexValue={index} />
          <div className={styles.pairRow}>
            <Swarm points={rows.map((row) => ({ asset: row.asset, value: row.fd }))} title="Where the settlement moved every target" upLabel="TARGETS UP" downLabel="TARGETS DOWN" fill />
            {finished && window ? <GapChart session={finished} window={window} paths={paths} targets={targets} /> : null}
          </div>
          {finished && window ? (
            <TalentDay
              session={finished}
              window={window}
              paths={paths}
              assets={assets}
              targets={targets}
              defaultSymbol={[...rows].sort((a, b) => Math.abs(b.fd) - Math.abs(a.fd))[0]?.asset.symbol ?? null}
              layout="side"
            />
          ) : null}
          <Ticks date={date} session={session} />
          <Lists rows={rows} report={report} paths={paths} />
          <Angle
            date={date}
            title="Your book on this report"
            change={(symbol) => {
              const row = model.bySymbol.get(symbol.toUpperCase())?.get(date);
              return row ? { move: row.fd, perShare: row.markAfter - row.markBefore, label: "target" } : null;
            }}
            note={(total) => (
              <>
                At this settlement the targets on your bags moved <b className={ui[toneClass(total)]}>{`${total >= 0 ? "+" : "−"}${money(Math.abs(total))}`}</b> in all.
              </>
            )}
          />
          <FullTable
            rows={rows.map((row) => ({ ...row, path: paths.get(row.asset.symbol.toUpperCase()) ?? null }))}
            initial="fd"
            columns={[
              { key: "close", label: "Close", sort: (row) => row.close, cell: (row) => num(row.close) },
              { key: "markBefore", label: "Target before", sort: (row) => row.markBefore, cell: (row) => num(row.markBefore), className: () => styles.dim },
              { key: "markAfter", label: "Target", sort: (row) => row.markAfter, cell: (row) => num(row.markAfter) },
              { key: "fd", label: "Target Δ", sort: (row) => row.fd, cell: (row) => <span className={`${styles.mv} ${styles[toneClass(row.fd)]}`}>{pct(row.fd)}</span> },
              { key: "adj", label: "Adjustments", sort: (row) => row.path?.adj ?? null, cell: (row) => (row.path ? pct(row.path.adj) : "—"), className: (row) => (row.path ? ui[toneClass(row.path.adj)] : undefined) },
              { key: "trade", label: "Trading", sort: (row) => row.path?.trade ?? null, cell: (row) => (row.path ? pct(row.path.trade) : "—"), className: (row) => (row.path ? ui[toneClass(row.path.trade)] : undefined) },
              { key: "prem", label: "Close vs target", sort: (row) => row.prem, cell: (row) => pct(row.prem), className: (row) => (row.prem !== null && row.prem > 0 ? ui.down : ui.up) },
              { key: "volume", label: "Volume", sort: (row) => row.volume, cell: (row) => row.volume.toLocaleString("en-US") },
            ]}
          />
        </>
      )}
      <p className={ui.foot}>
        Each morning at 09:00 ET the settlement sets every talent&apos;s target (their fair value, repriced from YouTube views, subscribers and uploads, plus a one-day lift after a
        big stream: a 3D live, new outfit or original song). Four adjustments, at 09:00, 15:00, 21:00 and 03:00, pull each price toward it, and players trade in between. While
        they land this is the adjustment report: prices and landed adjustments only. The targets, and how hard each adjustment pulled, stay secret until the last one; then the
        day becomes the settlement report.
      </p>
    </>
  );
}
