"use client";

// A market day step by step, for the report: each talent's price from the open through every
// adjustment (and the trading in between) to now, or to the close once the day is done. While the
// day's adjustments are still landing its targets and strengths are secret, so this shows only what
// has actually happened; once they've all landed it adds the targets and how hard each one pulled.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AssetPicker } from "@/app/components/common/asset-picker";
import { num } from "@/app/components/market/bits";
import { apiFetch } from "@/app/lib/api";
import { formatEtTime, TICKS } from "@/app/lib/market-clock";
import { signedPct } from "@/app/lib/time";
import type { MarketAsset, SessionBreakdown } from "@/app/lib/types";
import { useHubStore } from "@/app/stores/hub-store";
import ui from "@/app/components/market/market.module.scss";
import styles from "@/app/components/market/report-tab.module.scss";

const DAY_MS = 24 * 3600_000;
const pct = (value: number | null | undefined, digits = 2) => signedPct(value, digits);

/** "Open", "Lunch", "Late", "Overnight". */
export const adjustmentLabel = (key: string) => TICKS.find((tick) => tick.key === key)?.label ?? key;

const et = (at: number) => formatEtTime(new Date(at));

// ── Data ─────────────────────────────────────────────────────────────────
const finishedCache = new Map<string, SessionBreakdown>();

/**
 * The day step by step. A finished day never changes, so it's cached; a day in progress is fetched
 * again whenever another adjustment lands (the market socket tells the hub) and every minute.
 */
export function useSession(date: string | null, live: boolean) {
  const landed = useHubStore((state) => (state.adjustments?.recaps ?? []).filter((recap) => (recap.market_date ?? "").slice(0, 10) === date).length);
  const [minute, setMinute] = useState(0);
  const [state, setState] = useState<{ date: string | null; session: SessionBreakdown | null }>({ date: null, session: null });

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setMinute((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [live]);

  useEffect(() => {
    if (!date) return;
    const cached = finishedCache.get(date);
    if (cached) {
      const timer = setTimeout(() => setState({ date, session: cached }), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    apiFetch<SessionBreakdown>(`/api/market/report/daily/${date}/session`)
      .then((result) => {
        if (result.finished) finishedCache.set(date, result);
        if (!cancelled) setState({ date, session: result });
      })
      .catch(() => {
        if (!cancelled) setState({ date, session: null });
      });
    return () => {
      cancelled = true;
    };
  }, [date, landed, minute]);

  // undefined while this date's breakdown is loading, null if it couldn't be.
  return state.date === date ? state.session : undefined;
}

// ── One talent's path through the day ─────────────────────────────────────
export type PathPoint = { at: number; price: number; kind: "open" | "before" | "after" | "now"; key?: string; strength?: number | null };

export type TalentPath = {
  symbol: string;
  open: number;
  now: number;
  points: PathPoint[];
  /** What the adjustments did (fraction), what trading did, and both together. */
  adj: number;
  trade: number;
  total: number;
  landed: number;
};

/** 09:00 ET on the market day (the Open adjustment's slot) to 09:00 the next day. */
export function sessionWindow(session: SessionBreakdown) {
  const first = session.adjustments[0]?.scheduled_at;
  const start = first ? Date.parse(first) : Date.now();
  return { start, end: start + DAY_MS };
}

/**
 * Every talent's path. `priceOf` gives the live price for a day in progress (the close otherwise).
 * Trading is everything between one adjustment and the next, so price moves split cleanly in two.
 */
export function buildPaths(session: SessionBreakdown, priceOf: (symbol: string) => number | null, live: boolean) {
  const window = sessionWindow(session);
  const nowAt = live ? Math.min(Math.max(Date.now(), window.start), window.end) : window.end;
  const paths = new Map<string, TalentPath>();
  for (const entry of session.assets) {
    if (!(entry.open > 0)) continue;
    const now = (live ? priceOf(entry.symbol) : null) ?? entry.close;
    if (!(now > 0)) continue;
    let price = entry.open;
    let adjFactor = 1;
    let tradeFactor = 1;
    let landed = 0;
    const points: PathPoint[] = [{ at: window.start, price, kind: "open" }];
    for (const step of entry.steps) {
      if (step.before === null || step.after === null || !(step.before > 0)) continue;
      const at = Date.parse(step.applied_at ?? step.scheduled_at);
      tradeFactor *= step.before / price;
      adjFactor *= step.after / step.before;
      points.push({ at, price: step.before, kind: "before", key: step.key });
      points.push({ at, price: step.after, kind: "after", key: step.key, strength: step.strength_pct });
      price = step.after;
      landed += 1;
    }
    tradeFactor *= now / price;
    points.push({ at: nowAt, price: now, kind: "now" });
    paths.set(entry.symbol.toUpperCase(), { symbol: entry.symbol, open: entry.open, now, points, adj: adjFactor - 1, trade: tradeFactor - 1, total: now / entry.open - 1, landed });
  }
  return { window, paths };
}

/** Share of all the day's price movement (in log terms) that came from adjustments, 0..1. */
export function adjustmentShare(paths: Iterable<TalentPath>) {
  let adj = 0;
  let trade = 0;
  for (const path of paths) {
    adj += Math.abs(Math.log(1 + path.adj));
    trade += Math.abs(Math.log(1 + path.trade));
  }
  return adj + trade > 0 ? adj / (adj + trade) : null;
}

// ── The step chart both views draw with ───────────────────────────────────
type ChartPoint = { at: number; value: number; kind: PathPoint["kind"]; key?: string; tip: string; label?: string };

/**
 * A value through the day: trading as sloped grey lines, each adjustment as a vertical blue jump
 * (labelled with what it did), optional reference lines (the target), and the adjustments still to
 * come as faint slots. One series, one axis; hover any point for its numbers.
 */
function StepChart({
  points,
  window,
  refs = [],
  pending = [],

  ariaLabel,
  height = 230,
}: {
  points: ChartPoint[];
  window: { start: number; end: number };
  refs?: Array<{ value: number; label: string; strong?: boolean }>;
  pending?: Array<{ at: number; label: string }>;

  ariaLabel: string;
  height?: number;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!width || points.length < 2) return null;
    const pad = { l: 12, r: 104, t: 18, b: 28 };
    const values = [...points.map((point) => point.value), ...refs.map((ref) => ref.value)];
    let min = Math.min(...values);
    let max = Math.max(...values);
    const span = max - min || Math.abs(max) * 0.02 || 1;
    min -= span * 0.12;
    max += span * 0.12;
    const X = (at: number) => pad.l + ((Math.min(Math.max(at, window.start), window.end) - window.start) / (window.end - window.start)) * (width - pad.l - pad.r);
    const Y = (value: number) => pad.t + (1 - (value - min) / (max - min)) * (height - pad.t - pad.b);
    return { pad, X, Y };
  }, [width, points, refs, window, height]);

  const slots = TICKS.map((tick, i) => ({ at: window.start + [0, 6, 12, 18][i] * 3600_000, label: tick.label }));
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className={styles.stepChart} ref={box} style={{ height }} onPointerLeave={() => setHover(null)}>
      {layout ? (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {/* The day's adjustment slots, and the ones still to come. */}
          {slots.map((slot) => (
            <g key={slot.label}>
              <line x1={layout.X(slot.at)} x2={layout.X(slot.at)} y1={layout.pad.t - 6} y2={height - layout.pad.b} className={styles.scSlot} />
              <text x={layout.X(slot.at) + 4} y={height - 10} className={styles.scAxis}>
                {slot.label.toUpperCase()} {et(slot.at)}
              </text>
            </g>
          ))}
          {pending.map((slot) => (
            <text key={`p-${slot.label}`} x={layout.X(slot.at) + 4} y={layout.pad.t} className={styles.scPending}>
              {slot.label.toUpperCase()} · TO COME
            </text>
          ))}
          {refs.map((ref) => (
            <g key={ref.label}>
              <line x1={layout.pad.l} x2={width - layout.pad.r} y1={layout.Y(ref.value)} y2={layout.Y(ref.value)} className={ref.strong ? styles.scRef : styles.scRefSoft} />
              <text x={width - layout.pad.r + 6} y={layout.Y(ref.value) + 3} className={ref.strong ? styles.scRefText : styles.scRefTextSoft}>
                {ref.label}
              </text>
            </g>
          ))}
          {/* Trading: sloped grey. Adjustments: vertical blue jumps. */}
          {points.slice(1).map((point, i) => {
            const prev = points[i];
            const jump = point.kind === "after";
            return (
              <line
                key={`s-${i}`}
                x1={layout.X(prev.at)}
                y1={layout.Y(prev.value)}
                x2={layout.X(point.at)}
                y2={layout.Y(point.value)}
                className={jump ? styles.scAdj : styles.scTrade}
              />
            );
          })}
          {points.map((point, i) =>
            point.kind === "before" ? null : (
              <g key={`m-${i}`}>
                <circle cx={layout.X(point.at)} cy={layout.Y(point.value)} r={point.kind === "after" ? 4.5 : 3.5} className={point.kind === "after" ? styles.scDotAdj : styles.scDot} />
                {point.label ? (
                  <text x={layout.X(point.at) + 7} y={layout.Y(point.value) + (i % 2 ? -8 : 14)} className={styles.scLabel}>
                    {point.label}
                  </text>
                ) : null}
              </g>
            )
          )}
          {/* Generous hover targets. */}
          {points.map((point, i) =>
            point.kind === "before" ? null : (
              <circle key={`h-${i}`} cx={layout.X(point.at)} cy={layout.Y(point.value)} r={14} className={styles.scHit} onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={point.tip} />
            )
          )}
          {hovered ? <line x1={layout.X(hovered.at)} x2={layout.X(hovered.at)} y1={layout.pad.t} y2={height - layout.pad.b} className={styles.scCross} /> : null}
        </svg>
      ) : null}
      {layout && hovered ? (
        <div className={styles.scTip} style={{ left: Math.min(Math.max(layout.X(hovered.at) - 90, 0), Math.max(0, width - 190)), top: Math.max(0, layout.Y(hovered.value) - 70) }} role="status">
          {hovered.tip}
        </div>
      ) : null}
    </div>
  );
}

function Legend({ target }: { target: boolean }) {
  return (
    <div className={styles.scLegend} aria-hidden="true">
      <span>
        <i className={styles.lgAdj} /> Adjustment
      </span>
      <span>
        <i className={styles.lgTrade} /> Trading
      </span>
      {target ? (
        <span>
          <i className={styles.lgRef} /> Target
        </span>
      ) : null}
    </div>
  );
}

// ── Talent by talent ──────────────────────────────────────────────────────
/**
 * Pick a talent and follow their day: the open, each adjustment, the trading in between, and now
 * (or the close), against the target once the day is done. With a table of the same steps.
 */
export function TalentDay({
  session,
  window,
  paths,
  assets,
  targets,
  defaultSymbol,
}: {
  session: SessionBreakdown;
  window: { start: number; end: number };
  paths: Map<string, TalentPath>;
  assets: MarketAsset[];
  /** Once the day is done: each talent's target (the day's mark) and the one before it. */
  targets: Map<string, { before: number; after: number }> | null;
  defaultSymbol: string | null;
}) {
  const [picked, setPicked] = useState("");
  const live = !session.finished;
  const choices = assets.filter((asset) => paths.has(asset.symbol.toUpperCase()));
  const symbol = (picked || defaultSymbol || choices[0]?.symbol || "").toUpperCase();
  const path = paths.get(symbol);
  const asset = choices.find((entry) => entry.symbol.toUpperCase() === symbol);
  const target = targets?.get(symbol) ?? null;
  if (!path || !asset) return null;

  const name = asset.display_name;
  const adjSteps = path.points.filter((point) => point.kind === "after");
  const strongest = [...adjSteps].filter((point) => point.strength !== null && point.strength !== undefined).sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))[0];
  const next = session.adjustments.find((entry) => entry.landed < entry.total);

  const chartPoints: ChartPoint[] = path.points.map((point, i) => {
    const prev = path.points[i - 1];
    if (point.kind === "open") return { at: point.at, value: point.price, kind: point.kind, tip: `Open · ${et(point.at)} ET · ${num(point.price)}` };
    if (point.kind === "before") return { at: point.at, value: point.price, kind: point.kind, tip: "" };
    if (point.kind === "after") {
      const move = prev ? point.price / prev.price - 1 : 0;
      const pull = point.strength !== null && point.strength !== undefined ? ` · pulled ${Math.round(point.strength)}% of the gap` : "";
      return {
        at: point.at,
        value: point.price,
        kind: point.kind,
        key: point.key,
        label: pct(move, 1),
        tip: `${adjustmentLabel(point.key ?? "")} adjustment · ${et(point.at)} ET · ${num(prev?.price)} → ${num(point.price)} (${pct(move)})${pull}`,
      };
    }
    return { at: point.at, value: point.price, kind: point.kind, tip: `${live ? "Now" : "Close"} · ${num(point.price)} · ${pct(path.total)} on the day` };
  });

  const refs = target
    ? [
        { value: target.after, label: `TARGET ${num(target.after)}`, strong: true },
        { value: target.before, label: `WAS ${num(target.before)}` },
      ]
    : [];
  const pending = live ? session.adjustments.filter((entry) => entry.landed < entry.total).map((entry) => ({ at: Date.parse(entry.scheduled_at), label: adjustmentLabel(entry.key) })) : [];

  // The same steps as rows: the table view of the chart.
  const rows: Array<{ what: string; when: string; from: number; to: number; pull: number | null; adj: boolean }> = [];
  path.points.forEach((point, i) => {
    const prev = path.points[i - 1];
    if (!prev) return;
    if (point.kind === "before" && Math.abs(point.price / prev.price - 1) > 1e-9) rows.push({ what: "Trading", when: `${et(prev.at)}–${et(point.at)}`, from: prev.price, to: point.price, pull: null, adj: false });
    if (point.kind === "after") rows.push({ what: `${adjustmentLabel(point.key ?? "")} adjustment`, when: et(point.at), from: prev.price, to: point.price, pull: point.strength ?? null, adj: true });
    if (point.kind === "now" && Math.abs(point.price / prev.price - 1) > 1e-9) rows.push({ what: "Trading", when: `${et(prev.at)}–${live ? "now" : et(point.at)}`, from: prev.price, to: point.price, pull: null, adj: false });
  });

  return (
    <section className={styles.talentDay}>
      <div className={ui.secHead}>
        <h2>{live ? "The day so far, talent by talent" : "How the day got there"}</h2>
        <span className={ui.aside}>{live ? "adjustments landed so far, and the trading around them" : "each adjustment, the trading in between, and the target"}</span>
      </div>
      <div className={styles.tdTop}>
        <div className={styles.tdPick}>
          <AssetPicker assets={choices} value={symbol} onChange={setPicked} placeholder="Pick a talent" emptyLabel="Biggest mover" />
        </div>
        <Legend target={Boolean(target)} />
      </div>
      <p className={styles.tdSum}>
        {live ? (
          <>
            <b>{name}</b> is <b className={ui[path.total >= 0 ? "up" : "down"]}>{pct(path.total)}</b> since the last close.{" "}
            {path.landed ? (
              <>
                The {path.landed === 1 ? "adjustment" : `${path.landed} adjustments`} so far moved the price <b>{pct(path.adj)}</b>, and trading <b>{pct(path.trade)}</b>.
              </>
            ) : (
              <>No adjustment has landed yet; trading has moved it <b>{pct(path.trade)}</b>.</>
            )}{" "}
            {next ? `Next: the ${adjustmentLabel(next.key)} adjustment at ${et(Date.parse(next.scheduled_at))} ET.` : null}
          </>
        ) : (
          <>
            {target ? (
              <>
                The settlement moved <b>{name}</b>&apos;s target <b className={ui[target.after >= target.before ? "up" : "down"]}>{pct(target.after / target.before - 1)}</b> to {num(target.after)}.{" "}
              </>
            ) : (
              <>
                <b>{name}</b>:{" "}
              </>
            )}
            The adjustments moved the price <b>{pct(path.adj)}</b>
            {strongest ? (
              <>
                {" "}
                (the {adjustmentLabel(strongest.key ?? "")} one pulled hardest, {Math.round(strongest.strength ?? 0)}% of the gap)
              </>
            ) : null}{" "}
            and trading <b>{pct(path.trade)}</b>
            {target ? (
              <>
                ; it closed <b>{pct(path.now / target.after - 1)}</b> {path.now >= target.after ? "above" : "below"} the target.
              </>
            ) : (
              "."
            )}
          </>
        )}
      </p>
      <StepChart
        points={chartPoints}
        window={window}
        refs={refs}
        pending={pending}
       
        ariaLabel={`${name}'s price through the day: ${pct(path.total)} overall, ${pct(path.adj)} from adjustments and ${pct(path.trade)} from trading.`}
      />
      <div className={styles.tdTableWrap}>
        <table className={styles.tdTable}>
          <thead>
            <tr>
              <th className={styles.l}>Step</th>
              <th className={styles.l}>ET</th>
              <th>Price</th>
              <th>Move</th>
              {session.finished ? <th>Pull</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} data-adj={row.adj || undefined}>
                <td className={styles.l}>{row.what}</td>
                <td className={styles.l}>{row.when}</td>
                <td>
                  {num(row.from)} → {num(row.to)}
                </td>
                <td className={ui[row.to >= row.from ? "up" : "down"]}>{pct(row.to / row.from - 1)}</td>
                {session.finished ? <td>{row.pull !== null ? `${Math.round(row.pull)}%` : "—"}</td> : null}
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className={styles.l} colSpan={session.finished ? 5 : 4}>
                  Nothing has moved yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── The whole market against its targets ──────────────────────────────────
/**
 * Once the day is done: how far, on average, prices sat from their targets through the day. Each
 * adjustment closes part of the gap (how much it pulled); trading in between widens or narrows it.
 */
export function GapChart({ session, window, paths, targets }: { session: SessionBreakdown; window: { start: number; end: number }; paths: Map<string, TalentPath>; targets: Map<string, { before: number; after: number }> }) {
  // Checkpoints every talent shares: the open, before/after each adjustment, the close.
  const keys = session.adjustments.map((entry) => entry.key);
  const series: Array<{ at: number; kind: PathPoint["kind"]; key?: string; values: number[] }> = [
    { at: window.start, kind: "open", values: [] },
    ...keys.flatMap((key) => {
      const at = Date.parse(session.adjustments.find((entry) => entry.key === key)?.scheduled_at ?? "");
      return [
        { at, kind: "before" as const, key, values: [] as number[] },
        { at, kind: "after" as const, key, values: [] as number[] },
      ];
    }),
    { at: window.end, kind: "now", values: [] },
  ];
  const pulls = new Map<string, number[]>();
  for (const [symbol, path] of paths) {
    const target = targets.get(symbol);
    if (!target || !(target.after > 0)) continue;
    const gap = (price: number) => Math.abs(price / target.after - 1) * 100;
    series[0].values.push(gap(path.open));
    series[series.length - 1].values.push(gap(path.now));
    for (const point of path.points) {
      if (point.kind !== "before" && point.kind !== "after") continue;
      const slot = series.find((entry) => entry.kind === point.kind && entry.key === point.key);
      slot?.values.push(gap(point.price));
      if (point.kind === "after" && point.key && point.strength !== null && point.strength !== undefined) pulls.set(point.key, [...(pulls.get(point.key) ?? []), point.strength]);
    }
  }
  const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const points: ChartPoint[] = [];
  series.forEach((entry, i) => {
    const value = avg(entry.values);
    if (value === null) return;
    const prev = points[points.length - 1];
    if (entry.kind === "after" && prev) {
      const pull = avg(pulls.get(entry.key ?? "") ?? []);
      points.push({
        at: entry.at,
        value,
        kind: "after",
        key: entry.key,
        label: `${value - prev.value >= 0 ? "+" : "−"}${Math.abs(value - prev.value).toFixed(1)} pts`,
        tip: `${adjustmentLabel(entry.key ?? "")} adjustment · average gap ${prev.value.toFixed(1)}% → ${value.toFixed(1)}%${pull !== null ? ` · average pull ${Math.round(pull)}%` : ""}`,
      });
    } else {
      points.push({
        at: entry.at,
        value,
        kind: entry.kind,
        tip: i === 0 ? `Open · prices sat ${value.toFixed(1)}% from their targets on average` : entry.kind === "now" ? `Close · ${value.toFixed(1)}% from target on average` : "",
      });
    }
  });
  if (points.length < 2) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  return (
    <section className={styles.gapSec}>
      <div className={ui.secHead}>
        <h2>Prices against their targets</h2>
        <span className={ui.aside}>average distance from target, every talent, through the day</span>
      </div>
      <p className={styles.tdSum}>
        At the open prices sat <b>{first.toFixed(1)}%</b> from their new targets on average; by the close, <b>{last.toFixed(1)}%</b>. The blue drops are the adjustments
        pulling prices in; the grey stretches are trading.
      </p>
      <Legend target={false} />
      <StepChart points={points} window={window} ariaLabel={`Average distance from target: ${first.toFixed(1)}% at the open, ${last.toFixed(1)}% at the close.`} height={200} />
    </section>
  );
}
