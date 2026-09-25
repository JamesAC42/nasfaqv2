"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, CrosshairMode, LineSeries, LineType, TickMarkType, createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp } from "lightweight-charts";
import { fetchChart } from "@/app/lib/predictions/api";
import { outcomeColor, percent } from "@/app/lib/predictions/format";
import type { Chart, ChartRange, PredictionMarketDetail } from "@/app/lib/predictions/types";
import { useTheme } from "@/app/providers/theme-provider";
import styles from "@/app/components/predictions/market/chart.module.scss";

const RANGES: { key: ChartRange; label: string; seconds: number }[] = [
  { key: "1h", label: "1H", seconds: 3600 },
  { key: "6h", label: "6H", seconds: 6 * 3600 },
  { key: "24h", label: "24H", seconds: 86400 },
  { key: "7d", label: "7D", seconds: 7 * 86400 },
  { key: "30d", label: "30D", seconds: 30 * 86400 },
  { key: "all", label: "ALL", seconds: Infinity },
];

/** The smallest window that shows the market's whole life. */
function defaultRange(market: PredictionMarketDetail): ChartRange {
  const age = (Date.now() - new Date(market.opens_at || market.created_at).getTime()) / 1000;
  return (RANGES.find((range) => range.seconds >= age) ?? RANGES[RANGES.length - 1]).key;
}

export type LiveTick = { at: string; prices: { outcome_code: string; price: number }[]; n: number };

type Point = { time: UTCTimestamp; value: number };

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const toSec = (at: string | number) => Math.floor(new Date(at).getTime() / 1000) as UTCTimestamp;

function formatTick(time: Time, span: number, type: TickMarkType) {
  const date = new Date(Number(time) * 1000);
  if (type === TickMarkType.TimeWithSeconds) return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  if (span <= 86400 || type === TickMarkType.Time) return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Probability over time: one line per outcome in its colour, 0–100%, the tip moved by live trades. */
export function ProbabilityChart({ market, live }: { market: PredictionMarketDetail; live: LiveTick | null }) {
  const { theme } = useTheme();
  const [range, setRange] = useState<ChartRange>(() => defaultRange(market));
  const [data, setData] = useState<{ key: string; chart: Chart | null; prices: Record<string, number>; now: number } | null>(null);
  const [hover, setHover] = useState<Record<string, number> | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef(new Map<string, { api: ISeriesApi<"Line">; last: number }>());

  const open = market.status === "open";
  // Keyed on the colours themselves: the market object changes on every live trade.
  const colorKey = market.outcomes.map((outcome) => `${outcome.outcome_code}=${outcomeColor(market, outcome)}`).join("|");
  const colors = useMemo(() => Object.fromEntries(colorKey.split("|").map((pair) => pair.split("="))) as Record<string, string>, [colorKey]);
  const statusKey = `${market.status}:${market.trading_status}`;

  // Latest prices without re-creating the chart on every tick.
  const pricesRef = useRef(market.outcomes);
  useEffect(() => {
    pricesRef.current = market.outcomes;
  });

  const requestKey = `${market.slug}:${range}:${statusKey}`;
  useEffect(() => {
    let alive = true;
    const snapshot = (chart: Chart | null) => {
      if (!alive) return;
      const prices = Object.fromEntries(pricesRef.current.map((outcome) => [outcome.outcome_code, outcome.price]));
      setData({ key: requestKey, chart, prices, now: Math.floor(Date.now() / 1000) });
    };
    fetchChart(market.slug, range)
      .then(snapshot)
      .catch(() => snapshot(null));
    return () => {
      alive = false;
    };
  }, [market.slug, range, requestKey]);
  const loading = data?.key !== requestKey;

  const span = RANGES.find((entry) => entry.key === range)?.seconds ?? 86400;
  // lightweight-charts spaces points by index, not time, so resample every line onto one even
  // grid (forward-filled): a quiet hour then takes as much room as a busy one.
  const grid = useMemo(() => {
    if (!data?.chart) return null;
    const now = data.now;
    const raw = data.chart.series.map((series) => {
      const byTime = new Map<number, number>();
      for (const point of series.points) byTime.set(toSec(point.t), point.p * 100);
      return { code: series.outcome_code, points: [...byTime.entries()].sort((x, y) => x[0] - y[0]) };
    });
    const firsts = raw.flatMap((series) => (series.points.length ? [series.points[0][0]] : []));
    const lasts = raw.flatMap((series) => (series.points.length ? [series.points[series.points.length - 1][0]] : []));
    const opened = toSec(market.opens_at);
    let start = Number.isFinite(span) ? Math.max(now - span, opened) : firsts.length ? Math.min(...firsts) : opened;
    if (!open && firsts.length) start = Math.max(start, Math.min(...firsts));
    const end = open ? now : lasts.length ? Math.max(...lasts) : now;
    if (!open && !firsts.length) return { map: new Map<string, Point[]>(), step: 60 };
    const step = Math.max(60, Math.ceil((end - start) / 120 / 60) * 60);
    const first = Math.floor(start / step) * step;
    const out = new Map<string, Point[]>();
    for (const series of raw) {
      const current = data.prices[series.code];
      const points: Point[] = [];
      let i = 0;
      let value: number | null = null;
      // Before the window's first trade, the line sits at the first known price.
      if (series.points.length && series.points[0][0] > first) value = open || series.points[0][0] <= end ? series.points[0][1] : null;
      for (let t = first; t <= end + step - 1; t += step) {
        while (i < series.points.length && series.points[i][0] <= t) value = series.points[i++][1];
        if (value === null && open && current !== undefined) value = current * 100;
        if (value !== null) points.push({ time: t as UTCTimestamp, value });
      }
      if (open && current !== undefined && points.length) points[points.length - 1] = { ...points[points.length - 1], value: current * 100 };
      out.set(series.code, points);
    }
    return { map: out, step };
  }, [data, market.opens_at, open, span]);
  const seriesData = grid?.map ?? null;
  const stepRef = useRef(60);
  useEffect(() => {
    if (grid) stepRef.current = grid.step;
  }, [grid]);

  const hasPoints = seriesData ? [...seriesData.values()].some((points) => points.length > 0) : false;

  useEffect(() => {
    const el = box.current;
    if (!el || !seriesData || !hasPoints) return;
    const text = cssVar("--dim", "#7a8296");
    const rule = cssVar("--rule", "#222838");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: text, fontFamily: cssVar("--font-mono", "monospace"), fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: rule } },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: cssVar("--rule-2", "#2e3548"), labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.06, bottom: 0.06 } },
      timeScale: { borderVisible: false, timeVisible: span <= 7 * 86400, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true, tickMarkFormatter: (time: Time, type: TickMarkType) => formatTick(time, span, type) },
      localization: { locale: "en-US", priceFormatter: (value: number) => `${Math.round(value)}%`, timeFormatter: (time: Time) => new Date(Number(time) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;
    const map = new Map<string, { api: ISeriesApi<"Line">; last: number }>();
    // Label the top four on the axis; more than that just stacks.
    const labelled = new Set(
      [...market.outcomes]
        .sort((a, b) => b.price - a.price)
        .slice(0, 4)
        .map((outcome) => outcome.outcome_code),
    );
    for (const outcome of market.outcomes) {
      const points = seriesData.get(outcome.outcome_code) ?? [];
      const api = chart.addSeries(LineSeries, {
        color: colors[outcome.outcome_code],
        lineWidth: market.market_type === "binary" && outcome.outcome_code === "no" ? 1 : 2,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: labelled.has(outcome.outcome_code),
        crosshairMarkerRadius: 3,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      });
      api.setData(points);
      map.set(outcome.outcome_code, { api, last: points.length ? Number(points[points.length - 1].time) : 0 });
    }
    seriesRef.current = map;
    chart.timeScale().fitContent();

    const onMove = (param: MouseEventParams<Time>) => {
      if (!param.time || !param.point) {
        setHover(null);
        return;
      }
      const values: Record<string, number> = {};
      for (const [code, entry] of map) {
        const datum = param.seriesData.get(entry.api) as { value?: number } | undefined;
        if (datum?.value !== undefined) values[code] = datum.value / 100;
      }
      setHover(values);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = new Map();
    };
    // colors derive from the market's outcomes; the theme changes the grid.
  }, [seriesData, hasPoints, theme, span, colors, market.market_type, market.outcomes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live tip: every trade on this market moves each line's last point.
  useEffect(() => {
    if (!live) return;
    const step = stepRef.current;
    const t = Math.floor(toSec(live.at) / step) * step;
    for (const entry of live.prices) {
      const series = seriesRef.current.get(entry.outcome_code);
      if (!series) continue;
      const time = Math.max(t, series.last);
      try {
        // Keep the grid even: carry the old price across any skipped steps first.
        if (series.last && time > series.last + step) {
          const previous = series.api.data().at(-1) as { value?: number } | undefined;
          if (previous?.value !== undefined) for (let gap = series.last + step; gap < time; gap += step) series.api.update({ time: gap as UTCTimestamp, value: previous.value });
        }
        series.api.update({ time: time as UTCTimestamp, value: entry.price * 100 });
        series.last = time;
      } catch {
        // out-of-order tick after a refetch; the next one lands
      }
    }
  }, [live]);

  const legend = market.market_type === "binary" ? market.outcomes : [...market.outcomes].sort((a, b) => (hover ? (hover[b.outcome_code] ?? 0) - (hover[a.outcome_code] ?? 0) : b.price - a.price));

  return (
    <section className={styles.chart} aria-label="Probability chart">
      <div className={styles.top}>
        <ul className={styles.legend}>
          {legend.slice(0, market.market_type === "binary" ? 2 : 6).map((outcome) => (
            <li key={outcome.outcome_code} style={{ "--oc": colors[outcome.outcome_code] } as React.CSSProperties}>
              <i aria-hidden="true" />
              <span>{outcome.label}</span>
              <b>{percent(hover?.[outcome.outcome_code] ?? outcome.price)}</b>
            </li>
          ))}
        </ul>
        <div className={styles.ranges} role="group" aria-label="Chart range">
          {RANGES.map((entry) => (
            <button key={entry.key} type="button" aria-pressed={range === entry.key} onClick={() => setRange(entry.key)}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.plot}>
        {hasPoints ? <div ref={box} className={styles.canvas} /> : <p className={styles.empty}>{loading ? "Loading…" : "No trades in this window."}</p>}
      </div>
    </section>
  );
}
