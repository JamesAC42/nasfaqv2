"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type Time,
} from "lightweight-charts";
import { createChannelChartTheme, withAlpha, type ChannelChartTheme } from "@/app/lib/chart-theme";
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

type HistogramBar = {
  label: string;
  color: string;
  value: number;
  subtitle?: string;
  flagUrl?: string | null;
};

type RankedBar = {
  label: string;
  color: string;
  value: number;
  valueLabel: string;
  meta?: string;
};

type HeatmapRow = {
  label: string;
  cells: Array<{
    bucket: string;
    value: number;
    valueLabel: string;
  }>;
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

function resolveTheme(theme?: ChannelChartTheme | null) {
  return theme || createChannelChartTheme(null);
}

function createBaseChart(container: HTMLDivElement, theme?: ChannelChartTheme | null) {
  const palette = resolveTheme(theme);
  return createChart(container, {
    autoSize: true,
    height: 320,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: palette.text,
      fontFamily: "'Nasfaq Sans', 'Avenir Next', 'Segoe UI', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', sans-serif",
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: palette.grid },
      horzLines: { color: palette.grid },
    },
    crosshair: {
      vertLine: { color: palette.crosshair, width: 1 },
      horzLine: { color: palette.crosshairSoft, width: 1 },
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
  theme,
}: {
  title: string;
  subtitle?: string;
  candles: CandlePoint[];
  showMarkClose?: boolean;
  theme?: ChannelChartTheme | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasData = candles.some((item) => item.open !== null && item.high !== null && item.low !== null && item.close !== null);
  const palette = resolveTheme(theme);

  useEffect(() => {
    if (!containerRef.current || !hasData) return;

    const chart = createBaseChart(containerRef.current, palette);
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: palette.baseDeep,
      downColor: palette.complementDeep,
      wickUpColor: palette.baseDeep,
      wickDownColor: palette.complementDeep,
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
        color: palette.highlight,
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
  }, [candles, hasData, palette, showMarkClose]);

  return (
    <div className={`${styles.chartBox} ${styles.chartBoxCandles}`}>
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || formatRangeLabel(candles.map((item) => item.bucket))}</span>
        </div>
        <div className={styles.legend}>
          <span
            className={`${styles.pill} ${styles.candlePill}`}
            style={{ borderColor: withAlpha(palette.baseDeep, 0.35), color: palette.baseDeep }}
          >
            Candles {formatValue(latestValue(candles.map((item) => ({ value: item.close }))))}
          </span>
          {showMarkClose ? (
            <span
              className={`${styles.pill} ${styles.linePill}`}
              style={{ borderColor: withAlpha(palette.highlight, 0.35), color: palette.highlight }}
            >
              Mark {formatValue(latestValue(candles.map((item) => ({ value: item.close_mark ?? null }))))}
            </span>
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
  theme,
}: {
  title: string;
  subtitle?: string;
  series: TrendSeries[];
  theme?: ChannelChartTheme | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasData = series.some((item) => item.values.some((point) => point.value !== null && Number.isFinite(point.value)));
  const palette = resolveTheme(theme);

  useEffect(() => {
    if (!containerRef.current || !hasData) return;

    const chart = createBaseChart(containerRef.current, palette);

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
          topColor: withAlpha(item.color, 0.26),
          bottomColor: withAlpha(item.color, 0.04),
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
  }, [hasData, palette, series]);

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

export function SparklineChart({ candles, mode = "price" }: { candles: CandlePoint[]; mode?: "price" | "volume" }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasData = candles.some((item) => {
    const value = mode === "volume" ? item.volume_shares : item.close_mark ?? item.close;
    return value !== null && value !== undefined && Number.isFinite(value);
  });

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
      .map((item) => (mode === "volume" ? item.volume_shares : item.close_mark ?? item.close))
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
          const value = mode === "volume" ? item.volume_shares : item.close_mark ?? item.close;
          if (!time || value === null || value === undefined) return null;
          return { time, value };
        })
        .filter(Boolean) as Array<{ time: Time; value: number }>
    );

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, hasData, mode]);

  return hasData ? <div ref={containerRef} className={styles.sparklineCanvas} /> : <div className={styles.sparklineEmpty} />;
}

export function SuperchatHistogramCard({
  title,
  subtitle,
  bars,
  theme,
}: {
  title: string;
  subtitle?: string;
  bars: HistogramBar[];
  theme?: ChannelChartTheme | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hasData = bars.some((item) => Number.isFinite(item.value) && item.value > 0);
  const palette = resolveTheme(theme);

  useEffect(() => {
    if (!containerRef.current || !tooltipRef.current || !hasData) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: palette.text,
        fontFamily: "'Nasfaq Sans', 'Avenir Next', 'Segoe UI', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: withAlpha(palette.baseDeep, 0.08) },
        horzLines: { color: palette.grid },
      },
      crosshair: {
        vertLine: { visible: false, labelVisible: false },
        horzLine: { color: palette.crosshairSoft, width: 1 },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.16, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
        tickMarkFormatter: () => "",
      },
      localization: {
        locale: "en-US",
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume",
      },
      base: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    series.setData(
      bars.map((item, index) => ({
        time: `2026-01-${String(index + 1).padStart(2, "0")}` as Time,
        value: item.value,
        color: item.color,
      }))
    );

    const tooltip = tooltipRef.current;
    chart.subscribeCrosshairMove((param) => {
      if (!tooltip) return;

      const point = param.point;
      const logical = typeof param.logical === "number" ? Math.round(param.logical) : null;
      const bar = logical !== null && logical >= 0 && logical < bars.length ? bars[logical] : null;

      if (
        !bar ||
        !point ||
        point.x < 0 ||
        point.y < 0 ||
        !containerRef.current ||
        point.x > containerRef.current.clientWidth ||
        point.y > containerRef.current.clientHeight
      ) {
        tooltip.style.opacity = "0";
        return;
      }

      tooltip.innerHTML = `
        <strong class="${styles.chartTooltipLabel}">
          ${bar.flagUrl ? `<img src="${bar.flagUrl}" alt="" class="${styles.chartTooltipFlag}" />` : ""}
          <span>${bar.label}</span>
        </strong>
        <span>${formatValue(bar.value)} yen</span>
        ${bar.subtitle ? `<span>${bar.subtitle}</span>` : ""}
      `;

      const left = Math.min(Math.max(point.x + 14, 12), containerRef.current.clientWidth - 180);
      const top = Math.max(point.y - 18, 12);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.opacity = "1";
    });

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, hasData, palette]);

  return (
    <div className={`${styles.chartBox} ${styles.chartBoxTrend}`}>
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || "Past week by currency"}</span>
        </div>
      </div>
      {hasData ? (
        <div className={styles.chartTooltipWrap}>
          <div ref={containerRef} className={styles.canvas} />
          <div ref={tooltipRef} className={styles.chartTooltip} />
        </div>
      ) : (
        <div className={styles.empty}>No superchat data</div>
      )}
    </div>
  );
}

export function RankedBarChartCard({
  title,
  subtitle,
  bars,
}: {
  title: string;
  subtitle?: string;
  bars: RankedBar[];
}) {
  const maxValue = Math.max(...bars.map((item) => item.value), 0);
  const hasData = maxValue > 0;

  return (
    <div className={`${styles.chartBox} ${styles.chartBoxTrend}`}>
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || "Ranked breakdown"}</span>
        </div>
      </div>
      {hasData ? (
        <div className={styles.rankedBars}>
          {bars.map((item) => {
            const width = maxValue > 0 ? `${(item.value / maxValue) * 100}%` : "0%";
            return (
              <div key={item.label} className={styles.rankedBarRow}>
                <div className={styles.rankedBarHeader}>
                  <span className={styles.rankedBarLabel}>{item.label}</span>
                  <span className={styles.rankedBarValue}>{item.valueLabel}</span>
                </div>
                <div className={styles.rankedBarTrack}>
                  <div
                    className={styles.rankedBarFill}
                    style={{ "--ranked-bar-width": width, "--ranked-bar-color": item.color } as CSSProperties}
                  />
                </div>
                {item.meta ? <div className={styles.rankedBarMeta}>{item.meta}</div> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>No ranked data</div>
      )}
    </div>
  );
}

export function SuperchatHeatmapCard({
  title,
  subtitle,
  columns,
  rows,
  theme,
}: {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: HeatmapRow[];
  theme?: ChannelChartTheme | null;
}) {
  const maxValue = Math.max(...rows.flatMap((row) => row.cells.map((cell) => cell.value)), 0);
  const hasData = maxValue > 0 && columns.length > 0 && rows.length > 0;
  const palette = resolveTheme(theme);

  return (
    <div className={`${styles.chartBox} ${styles.chartBoxTrend}`}>
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || "Intensity by bucket"}</span>
        </div>
      </div>
      {hasData ? (
        <div className={styles.heatmap}>
          <div
            className={styles.heatmapGrid}
            style={
              {
                "--heatmap-columns": String(columns.length),
                "--heatmap-start": palette.base,
                "--heatmap-end": palette.complement,
                "--heatmap-border": palette.highlight,
              } as CSSProperties
            }
          >
            <div className={styles.heatmapCorner}>Currency</div>
            {columns.map((column) => (
              <div key={column} className={styles.heatmapColumnLabel}>
                {column}
              </div>
            ))}
            {rows.map((row) => (
              <div key={row.label} className={styles.heatmapRowGroup}>
                <div className={styles.heatmapRowLabel}>{row.label}</div>
                {row.cells.map((cell) => {
                  const intensity = maxValue > 0 ? Math.max(cell.value / maxValue, 0.08) : 0;
                  return (
                    <div
                      key={`${row.label}-${cell.bucket}`}
                      className={styles.heatmapCell}
                      style={{ "--heatmap-cell-opacity": intensity.toFixed(3) } as CSSProperties}
                      title={`${row.label} • ${cell.bucket}: ${cell.valueLabel}`}
                    >
                      <span>{cell.value > 0 ? cell.valueLabel : "—"}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.empty}>No heatmap data</div>
      )}
    </div>
  );
}
