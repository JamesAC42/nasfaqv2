"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { AnalyticsRow } from "@/app/components/admin/admin-api";
import { adminUi as ui, fmtCount, marketDateKey } from "@/app/components/admin/admin-ui";
import styles from "@/app/components/admin/admin-analytics-page.module.scss";

// The pieces both views of /admin/analytics use: our own numbers and Umami's.

export const V2_LAUNCH = "2026-10-31";

export const shiftDays = (dateKey: string, days: number) => new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const todayKey = () => marketDateKey(new Date().toISOString());

export const PRESETS: { label: string; range: (today: string) => [string, string] }[] = [
  { label: "Today", range: (today) => [today, today] },
  { label: "7 days", range: (today) => [shiftDays(today, -6), today] },
  { label: "30 days", range: (today) => [shiftDays(today, -29), today] },
  { label: "90 days", range: (today) => [shiftDays(today, -89), today] },
  { label: "Since launch", range: (today) => [V2_LAUNCH, today] },
];

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** A day key ("2026-10-31") or an hour key ("2026-10-31 13") as words. */
export function bucketLabel(at: string, withDay = true) {
  const date = new Date(`${at.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  if (at.length <= 10) return date;
  const hour = `${at.slice(11, 13)}:00`;
  return withDay ? `${date}, ${hour}` : hour;
}

export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** "+12% vs before", from the same length of time just before the range. */
export function changeText(value: number, previous: number) {
  if (!previous) return value ? "none before" : "—";
  const change = Math.round(((value - previous) / previous) * 100);
  if (change === 0) return "same as before";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}% vs before`;
}

/** The top of the y axis: 1, 2 or 5 times a power of ten, and at least 4 so small counts stay whole. */
function axisTop(max: number) {
  if (max <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 5, 10].find((multiple) => multiple * power >= max) ?? 10;
  return step * power;
}

export type ChartPoint = { at: string } & Record<string, number | string>;

/**
 * One measure over the range, a column per day or hour. The hovered or focused column shows every
 * measure in `labels` (the charted one first).
 */
export function ColumnChart({ points, metric, labels, multiDay }: { points: ChartPoint[]; metric: string; labels: Record<string, string>; multiDay: boolean }) {
  const plot = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const value = (point: ChartPoint, key: string) => Number(point[key]) || 0;
  const top = axisTop(Math.max(0, ...points.map((point) => value(point, metric))));
  const shown = [metric, ...Object.keys(labels).filter((key) => key !== metric)];

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box?.width || !points.length) return;
    setActive(Math.min(points.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * points.length))));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setActive((current) => Math.min(points.length - 1, Math.max(0, (current ?? points.length) + step)));
  };

  const point = active === null ? null : points[active];
  const middle = Math.floor((points.length - 1) / 2);
  const ticks = points.length > 2 ? [0, middle, points.length - 1] : points.map((_, index) => index);

  return (
    <figure className={styles.chart}>
      <div className={styles.axis} aria-hidden="true">
        <span>{compact.format(top)}</span>
        <span>{compact.format(top / 2)}</span>
        <span>0</span>
      </div>
      <div
        ref={plot}
        className={styles.plot}
        tabIndex={0}
        role="img"
        aria-label={`${labels[metric]} by ${multiDay ? "day" : "hour"}. Use the left and right arrow keys to read each one, or open the table below.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((current) => current ?? points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        {points.map((entry, index) => (
          <span key={entry.at} className={styles.band} data-active={active === index || undefined}>
            <i style={{ height: `${(value(entry, metric) / top) * 100}%` }} data-some={value(entry, metric) > 0 || undefined} />
          </span>
        ))}
        {point && active !== null ? (
          <div
            className={styles.tip}
            style={{ left: `${((active + 0.5) / points.length) * 100}%` }}
            data-edge={active < points.length * 0.25 ? "start" : active > points.length * 0.75 ? "end" : undefined}
            aria-live="polite"
          >
            <small>{bucketLabel(point.at)}</small>
            {shown.map((key) => (
              <span key={key}>
                <b>{fmtCount(value(point, key))}</b> {labels[key]}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {points.length ? (
        <div className={styles.ticks} aria-hidden="true">
          {ticks.map((index) => (
            <span key={points[index].at} style={{ left: `${((index + 0.5) / points.length) * 100}%` }} data-edge={index === 0 ? "start" : index === points.length - 1 && points.length > 1 ? "end" : undefined}>
              {bucketLabel(points[index].at, multiDay)}
            </span>
          ))}
        </div>
      ) : null}
    </figure>
  );
}

export function RankList({ rows, nameOf, empty }: { rows: AnalyticsRow[]; nameOf?: (label: string) => string; empty: string }) {
  if (!rows.length) return <p className={ui.empty}>{empty}</p>;
  const top = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ol className={styles.rank}>
      {rows.map((row) => (
        <li key={row.label}>
          <span title={row.label}>{nameOf ? nameOf(row.label) : row.label}</span>
          <b>{fmtCount(row.count)}</b>
          <i aria-hidden="true" style={{ width: `${(row.count / top) * 100}%` }} />
        </li>
      ))}
    </ol>
  );
}

export function Stat({ label, value, note, title }: { label: string; value: string; note: string; title?: string }) {
  return (
    <div className={ui.stat} title={title}>
      <small>{label}</small>
      <b>{value}</b>
      <em>{note}</em>
    </div>
  );
}
