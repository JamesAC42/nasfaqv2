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

type CandlePoint = {
  bucket: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  close_mark?: number | null;
};

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
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value as Time;
  }

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
      textColor: "#475569",
      fontFamily: "Arial, Helvetica, sans-serif",
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: "rgba(148, 163, 184, 0.16)" },
      horzLines: { color: "rgba(148, 163, 184, 0.16)" },
    },
    crosshair: {
      vertLine: { color: "rgba(15, 23, 42, 0.2)", width: 1 },
      horzLine: { color: "rgba(15, 23, 42, 0.12)", width: 1 },
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
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
  });
}

function formatValue(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatRangeLabel(values: string[]) {
  if (!values.length) return "No data";
  const first = values[0];
  const last = values[values.length - 1];
  return `${first.slice(0, 10)} to ${last.slice(0, 10)}`;
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
  const hasData = candles.some(
    (item) =>
      item.open !== null &&
      item.high !== null &&
      item.low !== null &&
      item.close !== null
  );

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
          if (!time || item.open === null || item.high === null || item.low === null || item.close === null) {
            return null;
          }
          return {
            time,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
          };
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

  const latestClose = latestValue(candles.map((item) => ({ value: item.close })));
  const latestMark = latestValue(candles.map((item) => ({ value: item.close_mark ?? null })));

  return (
    <div className="chartBox chartBoxCandles">
      <div className="chartTitleRow">
        <div>
          <strong>{title}</strong>
          <span>{subtitle || formatRangeLabel(candles.map((item) => item.bucket))}</span>
        </div>
        <div className="chartLegend">
          <span className="chartPill chartPillCandle">Candles {formatValue(latestClose)}</span>
          {showMarkClose ? <span className="chartPill chartPillLine">Mark {formatValue(latestMark)}</span> : null}
        </div>
      </div>
      {hasData ? <div ref={containerRef} className="chartCanvas" /> : <div className="chartEmpty">No candle data</div>}
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
        continue;
      }

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

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [hasData, series]);

  const rangeValues = series[0]?.values.map((item) => item.time) || [];

  return (
    <div className="chartBox chartBoxTrend">
      <div className="chartTitleRow">
        <div>
          <strong>{title}</strong>
          <span>{subtitle || formatRangeLabel(rangeValues)}</span>
        </div>
        <div className="chartLegend">
          {series.map((item) => (
            <span key={item.name} className="chartPill" style={{ borderColor: `${item.color}55`, color: item.color }}>
              {item.name} {formatValue(latestValue(item.values))}
            </span>
          ))}
        </div>
      </div>
      {hasData ? <div ref={containerRef} className="chartCanvas" /> : <div className="chartEmpty">No trend data</div>}
    </div>
  );
}

export function SparklineChart({
  candles,
}: {
  candles: CandlePoint[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasData = candles.some(
    (item) => (item.close_mark ?? item.close) !== null && Number.isFinite(item.close_mark ?? item.close)
  );

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
      rightPriceScale: {
        visible: false,
      },
      leftPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: false,
      },
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
    const tone =
      sparklineValues.length >= 2 && sparklineValues[sparklineValues.length - 1] < sparklineValues[0]
        ? "down"
        : "up";

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

  return hasData ? <div ref={containerRef} className="sparklineCanvas" /> : <div className="sparklineEmpty" />;
}
