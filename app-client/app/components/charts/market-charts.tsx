"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type Time,
} from "lightweight-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { getUsableChannelColor, type ColorMode } from "@/app/lib/color";
import { createChannelChartTheme, withAlpha, type ChannelChartTheme } from "@/app/lib/chart-theme";
import type { CandlePoint } from "@/app/lib/types";
import { useTheme } from "@/app/providers/theme-provider";
import styles from "@/app/components/charts/market-charts.module.scss";

type TrendPoint = {
  time: string;
  value: number | null;
};

type TrendSeries = {
  name: string;
  symbol?: string;
  icon?: string | null;
  color: string;
  kind?: "area" | "line";
  values: TrendPoint[];
};

type HistogramBar = {
  label: string;
  color: string;
  value: number;
  valueLabel?: string;
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

function toTimestampChartTime(value: string): Time | null {
  if (!value) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T00:00:00Z`)
    : Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000) as Time;
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

function readableChartColor(color: string, colorMode: ColorMode) {
  return getUsableChannelColor(
    color,
    colorMode,
    colorMode === "light" ? { maxLightLuminance: 0.34 } : undefined
  ) || color;
}

function resolveChartFontFamily(fontFamily?: string) {
  if (fontFamily?.trim()) return fontFamily.trim();
  if (typeof window !== "undefined") {
    const computed = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    if (computed) return computed;
  }
  return "'Nasfaq Mono', 'SFMono-Regular', 'Consolas', 'Liberation Mono', monospace";
}

function resolveCssVar(name: string, fallback: string) {
  if (typeof window !== "undefined") {
    const computed = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (computed) return computed;
  }
  return fallback;
}

function createBaseChart(
  container: HTMLDivElement,
  theme?: ChannelChartTheme | null,
  fontFamily?: string,
  height = 320,
  fontSize = 12
) {
  const palette = resolveTheme(theme);
  return createChart(container, {
    autoSize: true,
    height,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: resolveCssVar("--text", palette.text),
      fontFamily: resolveChartFontFamily(fontFamily),
      fontSize,
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

function formatVolumeValue(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatRangeLabel(values: string[]) {
  if (!values.length) return "No data";
  return `${values[0].slice(0, 10)} to ${values[values.length - 1].slice(0, 10)}`;
}

function formatCalendarMonth(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", { month: "short" });
}

function formatCalendarDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function chunkCalendarWeeks(cells: HeatmapRow["cells"]) {
  if (!cells.length) return [];
  const firstDate = new Date(`${cells[0].bucket.slice(0, 10)}T00:00:00`);
  const leadingBlankCount = Number.isNaN(firstDate.getTime()) ? 0 : firstDate.getDay();
  const padded: Array<HeatmapRow["cells"][number] | null> = [
    ...Array.from({ length: leadingBlankCount }, () => null),
    ...cells,
  ];
  const weekCount = Math.ceil(padded.length / 7);
  return Array.from({ length: weekCount }, (_, weekIndex) => padded.slice(weekIndex * 7, weekIndex * 7 + 7));
}

function chartTimeKey(time: Time) {
  return typeof time === "string" ? time : String(time);
}

function chartTimeSortValue(time: Time) {
  if (typeof time === "number") return time;
  if (typeof time === "string") {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(time)
      ? Date.parse(`${time}T00:00:00Z`)
      : Date.parse(time);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    return Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

function compareChartTime(left: Time, right: Time) {
  const leftValue = chartTimeSortValue(left);
  const rightValue = chartTimeSortValue(right);
  if (leftValue !== rightValue) return leftValue - rightValue;
  return chartTimeKey(left).localeCompare(chartTimeKey(right));
}

function syntheticChartTime(index: number): Time {
  const base = Date.UTC(2026, 0, 1);
  return Math.floor((base + index * 24 * 60 * 60 * 1000) / 1000) as Time;
}

function normalizeTrendData(points: TrendPoint[]) {
  const deduped = new Map<string, { time: Time; value: number }>();

  for (const point of points) {
    const time = toTimestampChartTime(point.time);
    if (!time || point.value === null || !Number.isFinite(point.value)) continue;
    deduped.set(chartTimeKey(time), { time, value: point.value });
  }

  return Array.from(deduped.values()).sort((left, right) => compareChartTime(left.time, right.time));
}

export function CandleChartCard({
  title,
  subtitle,
  candles,
  showMarkClose = false,
  chartType = "candles",
  showSubtitle = true,
  theme,
  fontFamily,
  height = 320,
  compact = false,
  candlePalette = "theme",
  className,
  fillHeight = false,
  bare = false,
  surfaceStyle,
}: {
  title: string;
  subtitle?: string;
  candles: CandlePoint[];
  showMarkClose?: boolean;
  chartType?: "candles" | "line";
  showSubtitle?: boolean;
  theme?: ChannelChartTheme | null;
  fontFamily?: string;
  height?: number;
  compact?: boolean;
  candlePalette?: "theme" | "market";
  className?: string;
  fillHeight?: boolean;
  bare?: boolean;
  surfaceStyle?: CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { theme: colorMode } = useTheme();
  const hasData = chartType === "line"
    ? candles.some((item) => {
        const value = item.close_mark ?? item.close ?? item.open ?? item.high ?? item.low;
        return value !== null && value !== undefined && Number.isFinite(value);
      })
    : candles.some((item) => item.open !== null && item.high !== null && item.low !== null && item.close !== null);
  const palette = resolveTheme(theme);
  const highlightColor = readableChartColor(palette.highlight, colorMode);
  const themedUpColor = readableChartColor(palette.baseDeep, colorMode);
  const themedDownColor = readableChartColor(palette.complementDeep, colorMode);

  useEffect(() => {
    if (!containerRef.current || !hasData) return;

    const chart = createBaseChart(containerRef.current, palette, fontFamily, height, compact ? 11 : 12);
    if (chartType === "line") {
      const lineSeries = chart.addSeries(LineSeries, {
        color: highlightColor,
        lineWidth: compact ? 2 : 3,
        priceLineVisible: false,
        lastValueVisible: true,
      });

      lineSeries.setData(
        candles
          .map((item) => {
            const time = toChartTime(item.bucket);
            const value = item.close_mark ?? item.close ?? item.open ?? item.high ?? item.low;
            if (!time || value === null || value === undefined || !Number.isFinite(value)) return null;
            return { time, value };
          })
          .filter(Boolean) as Array<{ time: Time; value: number }>
      );
    } else {
      const upColor = candlePalette === "market" ? "#16a34a" : themedUpColor;
      const downColor = candlePalette === "market" ? "#dc2626" : themedDownColor;
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor,
        downColor,
        wickUpColor: upColor,
        wickDownColor: downColor,
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
    }

    if (showMarkClose && chartType === "candles") {
      const markSeries = chart.addSeries(LineSeries, {
        color: highlightColor,
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
  }, [candles, candlePalette, chartType, compact, fontFamily, hasData, height, highlightColor, palette, showMarkClose, themedDownColor, themedUpColor]);

  return (
    <div
      className={[
        bare ? styles.chartBoxBare : styles.chartBox,
        styles.chartBoxCandles,
        compact ? styles.chartBoxCompact : "",
        fillHeight ? styles.chartBoxFill : "",
        className,
      ].filter(Boolean).join(" ")}
      style={{
        ...(fontFamily ? ({ "--chart-font-family": fontFamily } as CSSProperties) : {}),
        "--chart-height": `${height}px`,
        ...(surfaceStyle || {}),
      } as CSSProperties}
    >
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          {showSubtitle ? <span className={styles.subtitle}>{subtitle || formatRangeLabel(candles.map((item) => item.bucket))}</span> : null}
        </div>
        <div className={styles.legend}>
          <span
            className={`${styles.pill} ${chartType === "line" ? styles.linePill : styles.candlePill}`}
            style={{
              borderColor: withAlpha(chartType === "line" ? highlightColor : themedUpColor, 0.35),
              color: chartType === "line" ? highlightColor : themedUpColor,
            }}
          >
            {chartType === "line" ? "Price" : "Candles"} {formatValue(latestValue(candles.map((item) => ({
              value: chartType === "line"
                ? (item.close_mark ?? item.close ?? item.open ?? item.high ?? item.low)
                : item.close,
            }))))}
          </span>
          {showMarkClose && chartType === "candles" ? (
            <span
              className={`${styles.pill} ${styles.linePill}`}
              style={{ borderColor: withAlpha(highlightColor, 0.35), color: highlightColor }}
            >
              Mark {formatValue(latestValue(candles.map((item) => ({ value: item.close_mark ?? null }))))}
            </span>
          ) : null}
        </div>
      </div>
      {hasData ? <div ref={containerRef} className={styles.canvas} /> : <div className={styles.empty}>No {chartType === "line" ? "price" : "candle"} data</div>}
    </div>
  );
}

export function TrendChartCard({
  title,
  subtitle,
  series,
  theme,
  fontFamily,
  height = 320,
  compact = false,
  className,
  bare = false,
}: {
  title: string;
  subtitle?: string;
  series: TrendSeries[];
  theme?: ChannelChartTheme | null;
  fontFamily?: string;
  height?: number;
  compact?: boolean;
  className?: string;
  bare?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { theme: colorMode } = useTheme();
  const [selectedSeriesNames, setSelectedSeriesNames] = useState<string[]>([]);
  const hasData = series.some((item) => item.values.some((point) => point.value !== null && Number.isFinite(point.value)));
  const palette = resolveTheme(theme);
  const hasActiveSelection = selectedSeriesNames.length > 0;

  useEffect(() => {
    if (!containerRef.current || !hasData) return;

    const chart = createBaseChart(containerRef.current, palette, fontFamily, height, compact ? 11 : 12);

    for (const item of series) {
      const data = normalizeTrendData(item.values);
      if (!data.length) continue;
      const isActive = !hasActiveSelection || selectedSeriesNames.includes(item.name);
      const itemColor = readableChartColor(item.color, colorMode);
      const strokeColor = isActive ? itemColor : withAlpha(itemColor, 0.18);

      if (item.kind === "line") {
        const lineSeries = chart.addSeries(LineSeries, {
          color: strokeColor,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        lineSeries.setData(data);
      } else {
        const areaSeries = chart.addSeries(AreaSeries, {
          lineColor: strokeColor,
          topColor: isActive ? withAlpha(itemColor, 0.26) : withAlpha(itemColor, 0.06),
          bottomColor: isActive ? withAlpha(itemColor, 0.04) : withAlpha(itemColor, 0.01),
          lineWidth: 3,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        areaSeries.setData(data);
      }
    }

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [colorMode, compact, fontFamily, hasActiveSelection, hasData, height, palette, selectedSeriesNames, series]);

  const rangeValues = series[0]?.values.map((item) => item.time) || [];

  function toggleSeries(name: string) {
    setSelectedSeriesNames((current) => {
      const isSelected = current.includes(name);
      if (!isSelected) return [...current, name];
      if (current.length === 1) return [];
      return current.filter((item) => item !== name);
    });
  }

  return (
    <div
      className={[
        bare ? styles.chartBoxBare : styles.chartBox,
        styles.chartBoxTrend,
        compact ? styles.chartBoxCompact : "",
        className,
      ].filter(Boolean).join(" ")}
      style={{
        ...(fontFamily ? ({ "--chart-font-family": fontFamily } as CSSProperties) : {}),
        "--chart-height": `${height}px`,
      } as CSSProperties}
    >
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || formatRangeLabel(rangeValues)}</span>
        </div>
        <div className={styles.legend}>
          {series.map((item) => {
            const legendColor = readableChartColor(item.color, colorMode);
            const isActive = !hasActiveSelection || selectedSeriesNames.includes(item.name);

            return (
              <button
                key={item.name}
                type="button"
                className={`${styles.pill} ${isActive ? styles.pillActive : styles.pillMuted}`}
                style={
                  {
                    "--pill-color": legendColor,
                    borderColor: withAlpha(legendColor, 0.35),
                    color: legendColor,
                  } as CSSProperties
                }
                onClick={() => toggleSeries(item.name)}
                aria-pressed={hasActiveSelection && isActive}
              >
                <AssetCoin
                  symbol={item.symbol || item.name}
                  icon={item.icon ?? null}
                  color={legendColor}
                  appearance="plain"
                  className={styles.pillIcon}
                />
                <span className={styles.pillText}>
                  {item.name} {formatValue(latestValue(item.values))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {hasData ? <div ref={containerRef} className={styles.canvas} /> : <div className={styles.empty}>No trend data</div>}
    </div>
  );
}

export function VolumeChartCard({
  title,
  subtitle,
  candles,
  theme,
  fontFamily,
  height = 320,
  compact = false,
  className,
  bare = false,
}: {
  title: string;
  subtitle?: string;
  candles: CandlePoint[];
  theme?: ChannelChartTheme | null;
  fontFamily?: string;
  height?: number;
  compact?: boolean;
  className?: string;
  bare?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { theme: colorMode } = useTheme();
  const palette = resolveTheme(theme);
  const highlightColor = readableChartColor(palette.highlight, colorMode);
  const baseDeepColor = readableChartColor(palette.baseDeep, colorMode);
  const complementDeepColor = readableChartColor(palette.complementDeep, colorMode);
  const volumeCandles = candles
    .map((item) => {
      const time = toChartTime(item.bucket);
      const value = item.volume_shares;
      if (!time || value === null || value === undefined || !Number.isFinite(value)) return null;

      const toneColor =
        item.close !== null && item.open !== null
          ? item.close >= item.open
            ? baseDeepColor
            : complementDeepColor
          : highlightColor;

      return {
        time,
        value,
        color: withAlpha(toneColor, 0.72),
      };
    })
    .filter(Boolean) as Array<{ time: Time; value: number; color: string }>;
  const hasData = volumeCandles.length > 0;

  useEffect(() => {
    if (!containerRef.current || !hasData) return;

    const chart = createBaseChart(containerRef.current, palette, fontFamily, height, compact ? 11 : 12);
    const series = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume",
      },
      base: 0,
      priceLineVisible: false,
      lastValueVisible: true,
    });

    series.setData(volumeCandles);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [compact, fontFamily, hasData, height, palette, volumeCandles]);

  return (
    <div
      className={[
        bare ? styles.chartBoxBare : styles.chartBox,
        styles.chartBoxTrend,
        compact ? styles.chartBoxCompact : "",
        className,
      ].filter(Boolean).join(" ")}
      style={{
        ...(fontFamily ? ({ "--chart-font-family": fontFamily } as CSSProperties) : {}),
        "--chart-height": `${height}px`,
      } as CSSProperties}
    >
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || formatRangeLabel(candles.map((item) => item.bucket))}</span>
        </div>
        <div className={styles.legend}>
          <span
            className={`${styles.pill} ${styles.linePill}`}
            style={{ borderColor: withAlpha(highlightColor, 0.35), color: highlightColor }}
          >
            Volume {formatVolumeValue(latestValue(candles.map((item) => ({ value: item.volume_shares ?? null }))))}
          </span>
        </div>
      </div>
      {hasData ? <div ref={containerRef} className={styles.canvas} /> : <div className={styles.empty}>No volume data</div>}
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
        fontFamily: resolveChartFontFamily(),
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
  const { theme: colorMode } = useTheme();
  const hasData = bars.some((item) => Number.isFinite(item.value) && item.value > 0);
  const palette = resolveTheme(theme);

  useEffect(() => {
    if (!containerRef.current || !tooltipRef.current || !hasData) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: resolveCssVar("--text", palette.text),
        fontFamily: resolveChartFontFamily(),
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
        time: syntheticChartTime(index),
        value: item.value,
        color: readableChartColor(item.color, colorMode),
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
  }, [bars, colorMode, hasData, palette]);

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

export function MetricHistogramCard({
  title,
  subtitle,
  bars,
  theme,
  emptyLabel = "No data",
}: {
  title: string;
  subtitle?: string;
  bars: HistogramBar[];
  theme?: ChannelChartTheme | null;
  emptyLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const { theme: colorMode } = useTheme();
  const hasData = bars.some((item) => Number.isFinite(item.value) && item.value > 0);
  const palette = resolveTheme(theme);

  useEffect(() => {
    if (!containerRef.current || !tooltipRef.current || !hasData) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: resolveCssVar("--text", palette.text),
        fontFamily: resolveChartFontFamily(),
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
        time: syntheticChartTime(index),
        value: item.value,
        color: readableChartColor(item.color, colorMode),
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
        <span>${bar.valueLabel || formatValue(bar.value)}</span>
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
  }, [bars, colorMode, hasData, palette]);

  return (
    <div className={`${styles.chartBox} ${styles.chartBoxTrend}`}>
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || "Recent activity"}</span>
        </div>
      </div>
      {hasData ? (
        <div className={styles.chartTooltipWrap}>
          <div ref={containerRef} className={styles.canvas} />
          <div ref={tooltipRef} className={styles.chartTooltip} />
        </div>
      ) : (
        <div className={styles.empty}>{emptyLabel}</div>
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
  const { theme: colorMode } = useTheme();
  const sortedBars = [...bars].sort((a, b) => b.value - a.value);
  const maxValue = Math.max(...sortedBars.map((item) => item.value), 0);
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
          {sortedBars.map((item) => {
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
                    style={{ "--ranked-bar-width": width, "--ranked-bar-color": readableChartColor(item.color, colorMode) } as CSSProperties}
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
  rows,
  theme,
}: {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: HeatmapRow[];
  theme?: ChannelChartTheme | null;
}) {
  const { theme: colorMode } = useTheme();
  const cells = rows[0]?.cells || [];
  const weeks = chunkCalendarWeeks(cells);
  const maxValue = Math.max(...cells.map((cell) => cell.value), 0);
  const totalValue = cells.reduce((sum, cell) => sum + (cell.value || 0), 0);
  const activeDays = cells.filter((cell) => (cell.value || 0) > 0).length;
  const hasData = cells.length > 0;
  const palette = resolveTheme(theme);
  const heatmapStart = readableChartColor(palette.base, colorMode);
  const heatmapEnd = readableChartColor(palette.baseDeep, colorMode);
  const heatmapBorder = readableChartColor(palette.highlight, colorMode);
  const monthLabels = weeks.map((week) => {
    const firstRealCell = week.find((cell): cell is HeatmapRow["cells"][number] => Boolean(cell));
    if (!firstRealCell) return "";
    const day = Number(firstRealCell.bucket.slice(8, 10));
    return day <= 7 ? formatCalendarMonth(firstRealCell.bucket) : "";
  });

  return (
    <div className={`${styles.chartBox} ${styles.chartBoxTrend}`}>
      <div className={styles.header}>
        <div>
          <strong className={styles.title}>{title}</strong>
          <span className={styles.subtitle}>{subtitle || "Intensity by bucket"}</span>
        </div>
        {hasData ? (
          <div className={styles.heatmapSummary}>
            <strong>¥{formatValue(totalValue)}</strong>
            <span>{activeDays} active days</span>
          </div>
        ) : null}
      </div>
      {hasData ? (
        <div className={styles.heatmap}>
          <div
            className={styles.heatmapCalendar}
            style={
              {
                "--heatmap-start": heatmapStart,
                "--heatmap-end": heatmapEnd,
                "--heatmap-border": heatmapBorder,
              } as CSSProperties
            }
          >
            <div className={styles.heatmapMonths} style={{ "--heatmap-week-count": String(weeks.length) } as CSSProperties}>
              {monthLabels.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
            <div className={styles.heatmapBody}>
              <div className={styles.heatmapWeekdays}>
                <span>Mon</span>
                <span>Wed</span>
                <span>Fri</span>
              </div>
              <div className={styles.heatmapWeeks} style={{ "--heatmap-week-count": String(weeks.length) } as CSSProperties}>
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className={styles.heatmapWeek}>
                    {Array.from({ length: 7 }, (_, dayIndex) => {
                      const cell = week[dayIndex] || null;
                      if (!cell) {
                        return <span key={`blank-${weekIndex}-${dayIndex}`} className={styles.heatmapDayBlank} aria-hidden="true" />;
                      }
                      const normalized = maxValue > 0 ? cell.value / maxValue : 0;
                      const level = cell.value <= 0 ? 0 : normalized >= 0.75 ? 4 : normalized >= 0.45 ? 3 : normalized >= 0.18 ? 2 : 1;
                      return (
                        <span
                          key={cell.bucket}
                          className={styles.heatmapDay}
                          data-level={level}
                          title={`${formatCalendarDate(cell.bucket)}: ${cell.valueLabel}`}
                          aria-label={`${formatCalendarDate(cell.bucket)}: ${cell.valueLabel}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.heatmapLegend}>
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <span
                  key={level}
                  className={styles.heatmapDay}
                  data-level={level}
                  aria-hidden="true"
                />
              ))}
              <span>More</span>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.empty}>No heatmap data</div>
      )}
    </div>
  );
}
