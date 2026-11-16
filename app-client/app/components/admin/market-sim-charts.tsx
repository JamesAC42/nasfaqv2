"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { histogram } from "@/app/lib/market-sim/stats";
import styles from "@/app/components/admin/admin-market-sim-page.module.scss";

// The market simulator's two charts: where players' returns land, and the red share day by day,
// the scenario (blue) against today's settings (gray). Hover or focus reads any bin or day.

const W = 640;
const H = 220;
const PAD = { left: 40, right: 12, top: 12, bottom: 28 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

const pct = (value: number, digits = 0) => (Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—");
const signedPct = (value: number) => {
  const shown = Math.round(value * 100);
  return `${shown > 0 ? "+" : shown < 0 ? "−" : ""}${Math.abs(shown)}%`;
};

function Legend() {
  return (
    <div className={styles.legend}>
      <span data-series="scenario">Scenario</span>
      <span data-series="baseline">Today&rsquo;s settings</span>
    </div>
  );
}

function usePointerIndex(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !count) return;
    const x = ((event.clientX - box.left) / box.width) * W - PAD.left;
    setActive(Math.min(count - 1, Math.max(0, Math.floor((x / plotW) * count))));
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setActive((current) => Math.min(count - 1, Math.max(0, (current ?? (step > 0 ? -1 : count)) + step)));
  };
  return { active, setActive, handlers: { onPointerMove, onPointerLeave: () => setActive(null), onBlur: () => setActive(null), onKeyDown } };
}

const BINS = { from: -0.5, to: 0.5, bins: 20 };

/** Players' all-in returns, as shares of players per 5-point bin (the end bins take everything past ±50%). */
export function ReturnsChart({ scenario, baseline }: { scenario: number[]; baseline: number[] }) {
  const a = histogram(scenario, BINS);
  const b = histogram(baseline, BINS);
  const shareA = a.counts.map((count) => (scenario.length ? count / scenario.length : 0));
  const shareB = b.counts.map((count) => (baseline.length ? count / baseline.length : 0));
  const top = Math.max(0.05, ...shareA, ...shareB);
  const { active, setActive, handlers } = usePointerIndex(BINS.bins);
  const band = plotW / BINS.bins;
  const barW = Math.max(2, band / 2 - 2);
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;
  const zeroX = PAD.left + ((0 - BINS.from) / (BINS.to - BINS.from)) * plotW;
  const label = (index: number) => {
    const low = a.edges[index];
    const high = low + a.width;
    if (index === 0) return `under ${signedPct(high)}`;
    if (index === BINS.bins - 1) return `over ${signedPct(low)}`;
    return `${signedPct(low)} to ${signedPct(high)}`;
  };

  return (
    <figure className={styles.chart}>
      <figcaption>
        <b>Where players end up</b>
        <span>Share of players by all-in return. Left of the line is losing money.</span>
      </figcaption>
      <Legend />
      <div className={styles.plotWrap}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label="Share of players by all-in return, scenario against today's settings. Use the arrow keys to read each bin."
          onFocus={() => setActive((current) => current ?? 10)}
          {...handlers}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(top * f)} y2={y(top * f)} className={styles.grid} />
              <text x={PAD.left - 6} y={y(top * f) + 3} textAnchor="end" className={styles.axisText}>
                {pct(top * f)}
              </text>
            </g>
          ))}
          {shareA.map((value, index) => {
            const x = PAD.left + index * band;
            return (
              <g key={index} data-active={active === index || undefined}>
                <rect x={x} y={PAD.top} width={band} height={plotH} className={styles.hit} />
                <rect x={x + band / 2 - barW - 1} y={y(value)} width={barW} height={Math.max(0, PAD.top + plotH - y(value))} rx={1.5} className={styles.barScenario} />
                <rect x={x + band / 2 + 1} y={y(shareB[index])} width={barW} height={Math.max(0, PAD.top + plotH - y(shareB[index]))} rx={1.5} className={styles.barBaseline} />
              </g>
            );
          })}
          <line x1={zeroX} x2={zeroX} y1={PAD.top} y2={PAD.top + plotH} className={styles.zero} />
          {[0, 5, 10, 15, 19].map((index) => (
            <text
              key={index}
              x={PAD.left + (index + (index === 19 ? 1 : 0)) * band}
              y={H - 8}
              textAnchor={index === 0 ? "start" : index === 19 ? "end" : "middle"}
              className={styles.axisText}
            >
              {index === 0 ? "≤ −50%" : index === 19 ? "≥ +50%" : signedPct(a.edges[index])}
            </text>
          ))}
        </svg>
        {active !== null ? (
          <div className={styles.tip} style={{ left: `${((PAD.left + (active + 0.5) * band) / W) * 100}%` }} aria-live="polite">
            <small>{label(active)}</small>
            <span data-series="scenario">
              <b>{pct(shareA[active], 1)}</b> of players, scenario
            </span>
            <span data-series="baseline">
              <b>{pct(shareB[active], 1)}</b> today&rsquo;s settings
            </span>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

/** The share of open positions below their cost at each day's close. */
export function RedShareChart({ scenario, baseline, labels }: { scenario: number[]; baseline: number[]; labels: string[] }) {
  const count = Math.max(scenario.length, baseline.length);
  const { active, setActive, handlers } = usePointerIndex(count);
  const x = (index: number) => PAD.left + (count > 1 ? (index / (count - 1)) * plotW : plotW / 2);
  // The axis spans the data in 10-point steps (at least 20 points), so small gaps stay visible.
  const finite = [...scenario, ...baseline].filter((value) => Number.isFinite(value));
  const low = finite.length ? Math.max(0, Math.floor(Math.min(...finite) * 10) / 10) : 0;
  const high = finite.length ? Math.min(1, Math.max(low + 0.2, Math.ceil(Math.max(...finite) * 10) / 10)) : 1;
  const y = (value: number) => PAD.top + plotH - ((value - low) / (high - low)) * plotH;
  const path = (values: number[]) =>
    values
      .map((value, index) => (Number.isFinite(value) ? `${index === 0 || !Number.isFinite(values[index - 1]) ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}` : ""))
      .join(" ");
  const ticks = count > 2 ? [0, Math.floor((count - 1) / 2), count - 1] : [...Array(count).keys()];

  return (
    <figure className={styles.chart}>
      <figcaption>
        <b>Positions in the red, day by day</b>
        <span>Share of open positions worth less than they cost, at each day&rsquo;s close.</span>
      </figcaption>
      <Legend />
      <div className={styles.plotWrap}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label="Share of positions in the red by day, scenario against today's settings. Use the arrow keys to read each day."
          onFocus={() => setActive((current) => current ?? count - 1)}
          {...handlers}
        >
          {[low, (low + high) / 2, high].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(f)} y2={y(f)} className={styles.grid} />
              <text x={PAD.left - 6} y={y(f) + 3} textAnchor="end" className={styles.axisText}>
                {pct(f)}
              </text>
            </g>
          ))}
          <path d={path(baseline)} className={styles.lineBaseline} />
          <path d={path(scenario)} className={styles.lineScenario} />
          {active !== null ? (
            <>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} className={styles.crosshair} />
              {Number.isFinite(baseline[active]) ? <circle cx={x(active)} cy={y(baseline[active])} r={4} className={styles.dotBaseline} /> : null}
              {Number.isFinite(scenario[active]) ? <circle cx={x(active)} cy={y(scenario[active])} r={4} className={styles.dotScenario} /> : null}
            </>
          ) : null}
          {ticks.map((index) => (
            <text key={index} x={x(index)} y={H - 8} textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"} className={styles.axisText}>
              {shortDate(labels[index])}
            </text>
          ))}
        </svg>
        {active !== null ? (
          <div className={styles.tip} style={{ left: `${(x(active) / W) * 100}%` }} aria-live="polite">
            <small>{active === 0 ? `Start, ${shortDate(labels[0])}` : shortDate(labels[active])}</small>
            <span data-series="scenario">
              <b>{pct(scenario[active], 1)}</b> red, scenario
            </span>
            <span data-series="baseline">
              <b>{pct(baseline[active], 1)}</b> today&rsquo;s settings
            </span>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

function shortDate(dateKey: string | undefined) {
  if (!dateKey) return "";
  const date = new Date(`${dateKey}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
