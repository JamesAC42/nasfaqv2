"use client";

import { memo, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import styles from "@/app/components/common/hover-spark.module.scss";

export type SparkPoint = { t: string; v: number };

/**
 * A sparkline you can read: hover, drag or arrow-key along it and it reports the point under the
 * cursor (the parent shows the date and value). An optional `ceiling` series draws dashed above
 * the line, e.g. max shares over shares held.
 */
export const HoverSpark = memo(function HoverSpark({
  points,
  ceiling,
  active,
  onActive,
  label,
  color = "var(--mid)",
  height = 46,
  zeroBase = false,
  className,
}: {
  points: SparkPoint[];
  ceiling?: number[];
  active: number | null;
  onActive: (index: number | null) => void;
  label: string;
  color?: string;
  height?: number;
  /** Scale from zero instead of the series' own low (for levels against a ceiling). */
  zeroBase?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = 240;
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const all = [...points.map((point) => point.v), ...(ceiling ?? [])].filter(Number.isFinite);
    const min = zeroBase ? 0 : Math.min(...all);
    const max = Math.max(...all);
    const range = max - min || 1;
    const x = (index: number) => (index / (points.length - 1)) * width;
    const y = (value: number) => height - 2 - ((value - min) / range) * (height - 4);
    const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.v).toFixed(1)}`).join(" ");
    const roof = ceiling && ceiling.length === points.length ? ceiling.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ") : null;
    return { line, area: `0,${height} ${line} ${width},${height}`, roof, y };
  }, [ceiling, height, points, zeroBase]);

  if (!geometry) return <div className={`${styles.box} ${className ?? ""}`} style={{ height }} aria-hidden="true" />;

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onActive(Math.round(ratio * (points.length - 1)));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const current = active ?? last;
    const next = event.key === "ArrowLeft" ? current - 1 : event.key === "ArrowRight" ? current + 1 : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    onActive(Math.min(last, Math.max(0, next)));
  };
  const point = active === null ? null : points[active];
  const left = active === null ? 0 : (active / (points.length - 1)) * 100;
  const top = point ? (geometry.y(point.v) / height) * 100 : 0;

  return (
    <div
      ref={box}
      className={`${styles.box} ${className ?? ""}`}
      style={{ height, color }}
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={points.length - 1}
      aria-valuenow={active ?? points.length - 1}
      aria-valuetext={point ? point.t : "latest"}
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={() => onActive(null)}
      onKeyDown={onKey}
      onBlur={() => onActive(null)}
    >
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={geometry.area} fill="currentColor" opacity={0.12} />
        {geometry.roof ? <polyline points={geometry.roof} fill="none" stroke="var(--dim)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
        <polyline points={geometry.line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {point ? (
        <>
          <i className={styles.rule} style={{ left: `${left}%` }} />
          <b className={styles.dot} style={{ left: `${left}%`, top: `${top}%` }} />
        </>
      ) : null}
    </div>
  );
});

/**
 * Cumulative YouTube counts (subscribers, views, videos) never really drop to zero or dip for a
 * single day: those are failed scrapes. Drop non-positive values and one-day dips or spikes that
 * the next day undoes.
 */
export function cleanCumulative(points: SparkPoint[]): SparkPoint[] {
  const positive = points.filter((point) => Number.isFinite(point.v) && point.v > 0);
  return positive.filter((point, index) => {
    const prev = positive[index - 1]?.v;
    const next = positive[index + 1]?.v;
    if (prev === undefined || next === undefined) return true;
    const low = Math.min(prev, next);
    const high = Math.max(prev, next);
    return !(point.v < low * 0.97 || point.v > high * 1.03);
  });
}
