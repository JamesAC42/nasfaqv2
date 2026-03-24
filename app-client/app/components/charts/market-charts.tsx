"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  type Time,
} from "lightweight-charts";
import type { CandlePoint } from "@/app/lib/types";
import styles from "@/app/components/charts/market-charts.module.scss";

type TrendPoint = {
  time: string;
  value: number | null;
};

type TrendSeries = {
  name: string;
  color: string;
  kind?: "area" | "line";
  values: TrendPoint[];
};

function toChartTime(value: string): Time | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value as Time;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000) as Time;
}

function latestValue(points: Array<{ value: number | null }>) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const candidate = points[index]?.value;
    if (candidate !== null && candidate !== undefined && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
}

function createBaseChart(container: HTMLDivElement) {
  return createChart(container, {
    autoSize: true,
    height: 320,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: "#6b5d4c",
      fontFamily: "'Nasfaq Sans', 'Avenir Next', 'Segoe UI', sans-serif",
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: "rgba(107, 93, 76, 0.12)" },
      horzLines: { color: "rgba(107, 93, 76, 0.12)" },
    },
    crosshair: {
      vertLine: { color: "rgba(31, 26, 20, 0.2)", width: 1 },
      horzLine: { color: "rgba(31, 26, 20, 0.12)", width: 1 },
    },
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.18, bottom: 0.12 },
    },
    timeScale: {
      borderVisible: false,
      timeVisible: true,
      secondsVisible: false,
    },
    localization: {
      locale: "en-US",
    },
  });
}

function formatValue(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatRangeLabel(values: string[]) {
  if (!values.length) return "No data";
  return `${values[0].slice(0, 10)} to ${values[values.length - 1].slice(0, 10)}`;
}

export function CandleChartCard({
  title,
  subtitle,
  candles,
  showMarkClose = false,
}: {
  title: string;
  subtitle?: string;
  candles: CandlePoint[];
  showMarkClose?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasData = candles.some((item) => item.open !== null && item.high !== null && item.low !== null && item.close !== null);

  useEffect(() => {
    if (!containerRef.current || !hasData) return;

    const chart = createBaseChart(containerRef.current);
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#0f766e",
      downColor: "#dc2626",
      wickUpColor: "#0f766e",
      wickDownColor: "#dc2626",
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    candleSeries.setData(
      candles
        .map((item) => {
          const time = toChartTime(item.bucket);
          if (!time || item.open === null || item.high === null || item.low === null || item.close === null) return null;
          return { time, open: item.open, high: item.high, low: item.low, close: item.close };
        })
        .filter(Boolean) as Array<{ time: Time; open: number; high: number; low: number; close: number }>
    );

    if (showMarkClose) {
      const markSeries = chart.addSeries(LineSeries, {
        color: "#2563eb",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      markSeries.setData(
        candles
          .map((item) => {
            const time = toChartTime(item.bucket);
            if (!time || item.close_mark === null || item.close_mark === undefined) return null;
            return { time, value: item.close_mark };
          })
          .filter(Boolean) as Array<{ time: Time; value: number }>
      );
    }

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, hasData, showMarkClose]);

  return (
    <div className={`${styles.chartBox} ${styles.chartBoxCandles}`}>
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || formatRangeLabel(candles.map((item) => item.bucket))}</span>
        </div>
        <div className={styles.legend}>
          <span className={`${styles.pill} ${styles.candlePill}`}>Candles {formatValue(latestValue(candles.map((item) => ({ value: item.close }))))}</span>
          {showMarkClose ? (
            <span className={`${styles.pill} ${styles.linePill}`}>Mark {formatValue(latestValue(candles.map((item) => ({ value: item.close_mark ?? null }))))}</span>
          ) : null}
        </div>
      </div>
      {hasData ? <div ref={containerRef} className={styles.canvas} /> : <div className={styles.empty}>No candle data</div>}
    </div>
  );
}

export function TrendChartCard({
  title,
  subtitle,
  series,
}: {
  title: string;
  subtitle?: string;
  series: TrendSeries[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasData = series.some((item) => item.values.some((point) => point.value !== null && Number.isFinite(point.value)));

  useEffect(() => {
    if (!containerRef.current || !hasData) return;

    const chart = createBaseChart(containerRef.current);

    for (const item of series) {
      if (item.kind === "line") {
        const lineSeries = chart.addSeries(LineSeries, {
          color: item.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        lineSeries.setData(
          item.values
            .map((point) => {
              const time = toChartTime(point.time);
              if (!time || point.value === null) return null;
              return { time, value: point.value };
            })
            .filter(Boolean) as Array<{ time: Time; value: number }>
        );
      } else {
        const areaSeries = chart.addSeries(AreaSeries, {
          lineColor: item.color,
          topColor: `${item.color}44`,
          bottomColor: `${item.color}06`,
          lineWidth: 3,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        areaSeries.setData(
          item.values
            .map((point) => {
              const time = toChartTime(point.time);
              if (!time || point.value === null) return null;
              return { time, value: point.value };
            })
            .filter(Boolean) as Array<{ time: Time; value: number }>
        );
      }
    }

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [hasData, series]);

  const rangeValues = series[0]?.values.map((item) => item.time) || [];

  return (
    <div className={`${styles.chartBox} ${styles.chartBoxTrend}`}>
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || formatRangeLabel(rangeValues)}</span>
        </div>
        <div className={styles.legend}>
          {series.map((item) => (
            <span key={item.name} className={styles.pill} style={{ borderColor: `${item.color}55`, color: item.color }}>
              {item.name} {formatValue(latestValue(item.values))}
            </span>
          ))}
        </div>
      </div>
      {hasData ? <div ref={containerRef} className={styles.canvas} /> : <div className={styles.empty}>No trend data</div>}
    </div>
  );
}

export function SparklineChart({ candles }: { candles: CandlePoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasData = candles.some((item) => (item.close_mark ?? item.close) !== null && Number.isFinite(item.close_mark ?? item.close));

  useEffect(() => {
    if (!containerRef.current || !hasData) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 44,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "transparent",
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false },
      crosshair: {
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
    });

    const sparklineValues = candles
      .map((item) => item.close_mark ?? item.close)
      .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
    const tone = sparklineValues.length >= 2 && sparklineValues[sparklineValues.length - 1] < sparklineValues[0] ? "down" : "up";
    const palette =
      tone === "up"
        ? { line: "#0f766e", top: "rgba(15, 118, 110, 0.24)", bottom: "rgba(15, 118, 110, 0.02)" }
        : { line: "#dc2626", top: "rgba(220, 38, 38, 0.18)", bottom: "rgba(220, 38, 38, 0.02)" };

    const series = chart.addSeries(AreaSeries, {
      lineColor: palette.line,
      topColor: palette.top,
      bottomColor: palette.bottom,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    series.setData(
      candles
        .map((item) => {
          const time = toChartTime(item.bucket);
          const value = item.close_mark ?? item.close;
          if (!time || value === null || value === undefined) return null;
          return { time, value };
        })
        .filter(Boolean) as Array<{ time: Time; value: number }>
    );

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, hasData]);

  return hasData ? <div ref={containerRef} className={styles.sparklineCanvas} /> : <div className={styles.sparklineEmpty} />;
}
