"use client";

import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { MARKET_TIME_ZONE } from "@/app/lib/market-clock";
import type { CandlePoint, MarketAdjustmentOutcome } from "@/app/lib/types";
import type { ChartRange } from "@/app/components/stock/use-stock-data";
import styles from "@/app/components/stock/price-chart.module.scss";

export type Overlays = { mark: boolean; ticks: boolean; volume: boolean; mine: boolean };

const TICK_NAMES: Record<string, string> = { open: "OPEN", lunch: "LUNCH", late: "LATE", overnight: "OVERNIGHT" };

type Point = { t: number; close: number; mark: number | null; volume: number; up: boolean };

function fmtTime(t: number, range: ChartRange, long = false) {
  const d = new Date(t);
  if (range === "1d") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: MARKET_TIME_ZONE });
  if (range === "1w" || long)
    return d.toLocaleString("en-US", { weekday: "short", month: range === "1w" ? undefined : "short", day: "numeric", hour: range === "1w" ? "2-digit" : undefined, minute: range === "1w" ? "2-digit" : undefined, hour12: false, timeZone: range === "1w" ? MARKET_TIME_ZONE : "UTC" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The dossier's price chart: price area with optional settlement-mark line,
 * tick markers, volume bars, and the viewer's average cost. Plain SVG.
 */
export function PriceChart({
  candles,
  range,
  overlays,
  ticks,
  latestMark,
  avgCost,
  livePrice,
  accent,
}: {
  candles: CandlePoint[];
  range: ChartRange;
  overlays: Overlays;
  ticks: MarketAdjustmentOutcome[];
  /** Today's settlement mark, drawn flat on intraday ranges. */
  latestMark: number | null;
  avgCost: number | null;
  livePrice: number | null;
  accent: string;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const points = useMemo<Point[]>(() => {
    const out = candles
      .map((candle) => {
        const t = Date.parse(candle.bucket);
        const close = candle.close ?? candle.open;
        if (!Number.isFinite(t) || close === null || close === undefined) return null;
        return { t, close, mark: candle.close_mark ?? null, volume: candle.volume_shares ?? 0, up: close >= (candle.open ?? close) };
      })
      .filter((point): point is Point => point !== null)
      .sort((a, b) => a.t - b.t);
    if (livePrice !== null && out.length && range === "1d") out.push({ t: Date.now(), close: livePrice, mark: null, volume: 0, up: livePrice >= out[out.length - 1].close });
    return out;
  }, [candles, livePrice, range]);

  const intraday = range === "1d" || range === "1w";
  const W = size.w;
  const H = size.h;
  const padR = 56;
  const volH = overlays.volume ? Math.min(64, H * 0.2) : 0;
  const top = 14;
  const priceBottom = H - 22 - volH - (volH ? 6 : 0);
  const plotW = Math.max(1, W - padR);

  const model = useMemo(() => {
    if (points.length < 2 || !W || !H) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const values = points.map((point) => point.close);
    if (overlays.mark) {
      if (intraday && latestMark) values.push(latestMark);
      else points.forEach((point) => point.mark !== null && values.push(point.mark));
    }
    if (overlays.mine && avgCost) values.push(avgCost);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const pad = (hi - lo || hi * 0.02 || 1) * 0.12;
    lo -= pad;
    hi += pad;
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * plotW;
    const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (priceBottom - top);
    const line = points.map((point, i) => `${i ? "L" : "M"}${x(point.t).toFixed(1)},${y(point.close).toFixed(1)}`).join("");
    const area = `${line}L${x(t1).toFixed(1)},${priceBottom}L0,${priceBottom}Z`;
    const markPts = !intraday ? points.filter((point) => point.mark !== null) : [];
    const markLine = markPts.length > 1 ? markPts.map((point, i) => `${i ? "L" : "M"}${x(point.t).toFixed(1)},${y(point.mark as number).toFixed(1)}`).join("") : null;
    const maxVol = Math.max(1, ...points.map((point) => point.volume));
    const barW = Math.max(1, Math.min(10, (plotW / points.length) * 0.7));
    const yTicks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / 4);
    const xCount = W < 480 ? 3 : 5;
    const xTicks = Array.from({ length: xCount }, (_, i) => t0 + ((t1 - t0) * (i + 0.5)) / xCount);
    const tickMarks = ticks
      .filter((tick) => tick.applied_at && tick.price_after !== null)
      .map((tick) => ({ tick, t: Date.parse(tick.applied_at as string) }))
      .filter(({ t }) => t >= t0 && t <= t1);
    return { t0, t1, lo, hi, x, y, line, area, markLine, maxVol, barW, yTicks, xTicks, tickMarks };
  }, [avgCost, H, W, intraday, latestMark, overlays.mark, overlays.mine, plotW, points, priceBottom, ticks]);

  const first = points[0]?.close ?? 0;
  const last = points[points.length - 1]?.close ?? 0;
  const tone = last >= first ? "up" : "down";
  const hovered = hover !== null ? points[hover] : null;

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!model) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const t = model.t0 + (px / plotW) * (model.t1 - model.t0);
    let best = 0;
    for (let i = 1; i < points.length; i += 1) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    setHover(best);
  };

  return (
    <div className={`${styles.box} ${styles[tone]}`} ref={box} style={{ "--tal": accent } as React.CSSProperties}>
      {model ? (
        <svg width={W} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Price chart, ${points.length} points`}>
          <defs>
            <linearGradient id="pc-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" className={styles.fillTop} />
              <stop offset="1" className={styles.fillBottom} />
            </linearGradient>
          </defs>
          {model.yTicks.map((value) => (
            <g key={value}>
              <line x1={0} x2={plotW} y1={model.y(value)} y2={model.y(value)} className={styles.grid} />
              <text x={W - 4} y={model.y(value) + 3} className={styles.axis} textAnchor="end">
                {value.toFixed(2)}
              </text>
            </g>
          ))}
          {model.xTicks.map((t) => (
            <text key={t} x={model.x(t)} y={H - 6} className={styles.axis} textAnchor="middle">
              {fmtTime(t, range)}
            </text>
          ))}
          <path d={model.area} fill="url(#pc-fill)" />
          <path d={model.line} className={styles.line} />
          {overlays.mark && model.markLine ? <path d={model.markLine} className={styles.mark} /> : null}
          {overlays.mark && intraday && latestMark ? (
            <g>
              <line x1={0} x2={plotW} y1={model.y(latestMark)} y2={model.y(latestMark)} className={styles.mark} />
              <text x={plotW - 4} y={model.y(latestMark) - 4} className={styles.markLbl} textAnchor="end">
                MARK
              </text>
            </g>
          ) : null}
          {overlays.mine && avgCost ? (
            <g>
              <line x1={0} x2={plotW} y1={model.y(avgCost)} y2={model.y(avgCost)} className={styles.avg} />
              <text x={4} y={model.y(avgCost) - 4} className={styles.avgLbl}>
                YOUR AVG {avgCost.toFixed(2)}
              </text>
            </g>
          ) : null}
          {overlays.ticks
            ? model.tickMarks.map(({ tick, t }) => {
                const up = (tick.move_pct ?? 0) >= 0;
                const cx = model.x(t);
                const cy = model.y(tick.price_after as number);
                return (
                  <g key={`${tick.market_date}-${tick.interval_key}`} className={up ? styles.tickUp : styles.tickDown}>
                    <line x1={cx} x2={cx} y1={top} y2={priceBottom} className={styles.tickLine} />
                    <path d={up ? `M${cx - 5},${cy + 12}L${cx + 5},${cy + 12}L${cx},${cy + 4}Z` : `M${cx - 5},${cy - 12}L${cx + 5},${cy - 12}L${cx},${cy - 4}Z`} />
                    <title>{`${TICK_NAMES[tick.interval_key] ?? tick.interval_key} tick ${((tick.move_pct ?? 0) * 100).toFixed(2)}%`}</title>
                  </g>
                );
              })
            : null}
          {volH
            ? points.map((point) => {
                const h = Math.max(1, (point.volume / model.maxVol) * volH);
                return <rect key={point.t} x={model.x(point.t) - model.barW / 2} y={H - 22 - h} width={model.barW} height={h} className={point.up ? styles.volUp : styles.volDown} />;
              })
            : null}
          {volH ? (
            <text x={4} y={H - 22 - volH + 8} className={styles.axis}>
              VOL
            </text>
          ) : null}
          <g className={styles.lastTag}>
            <rect x={plotW + 2} y={model.y(last) - 8} width={padR - 4} height={16} />
            <text x={plotW + padR / 2} y={model.y(last) + 4} textAnchor="middle">
              {last.toFixed(2)}
            </text>
          </g>
          {hovered ? (
            <g className={styles.cross}>
              <line x1={model.x(hovered.t)} x2={model.x(hovered.t)} y1={top} y2={H - 22} />
              <circle cx={model.x(hovered.t)} cy={model.y(hovered.close)} r={3.5} />
            </g>
          ) : null}
        </svg>
      ) : (
        <p className={styles.empty}>{points.length < 2 ? "Not enough trades in this window to draw a line." : ""}</p>
      )}
      {hovered && model ? (
        <div className={styles.tip} style={{ left: Math.min(Math.max(model.x(hovered.t), 70), plotW - 70) }}>
          <b>{hovered.close.toFixed(2)}</b>
          <span>{fmtTime(hovered.t, range, true)}</span>
          {hovered.volume ? <span>{hovered.volume.toLocaleString("en-US")} sh</span> : null}
          {!intraday && hovered.mark !== null ? <span>mark {hovered.mark.toFixed(2)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
