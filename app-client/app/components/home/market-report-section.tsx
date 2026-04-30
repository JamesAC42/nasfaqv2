"use client";

import { useEffect, useMemo, useState } from "react";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { apiFetch } from "@/app/lib/api";
import { getUsableChannelColor, type ColorMode } from "@/app/lib/color";
import { fmtPct } from "@/app/lib/format";
import { normalizeCandles, normalizeMarketAdjustmentSummary } from "@/app/lib/normalizers";
import type { DailyReport, MarketAdjustmentOutcome, MarketAdjustmentSummary, MarketAsset, ReportRow } from "@/app/lib/types";
import { useTheme } from "@/app/providers/theme-provider";
import styles from "@/app/components/home/market-report-section.module.scss";

function findAsset(assets: MarketAsset[], symbol: string) {
  return assets.find((asset) => asset.symbol === symbol);
}

type ReportListRow = Pick<ReportRow, "symbol" | "display_name" | "premium_pct" | "move_pct" | "volume_change_pct"> & {
  icon?: string | null;
  color?: string | null;
};

function formatMetric(row: ReportListRow, mode: "premium" | "move" | "volume") {
  if (mode === "premium") return fmtPct(row.premium_pct);
  if (mode === "move") return fmtPct(row.move_pct);
  return fmtPct(row.volume_change_pct);
}

function metricTone(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return styles.neutral;
  return value >= 0 ? styles.positive : styles.negative;
}

function isLastAdjustmentOutcome(item: MarketAdjustmentOutcome, lastTick: MarketAdjustmentSummary["last_tick"]) {
  if (!lastTick) return true;
  if (item.market_date && lastTick.market_date && item.market_date !== lastTick.market_date) return false;
  if (item.interval_key !== lastTick.interval_key) return false;
  if (lastTick.scheduled_at && item.scheduled_at && item.scheduled_at !== lastTick.scheduled_at) return false;
  return true;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function getMonthsAgoFromTimestamp(timestamp: number, months: number) {
  const cutoff = new Date(timestamp);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - months);
  return cutoff.getTime();
}

function buildMonthPriceSeries(
  assets: MarketAsset[],
  candleHistoryBySymbol: Record<string, Array<{ bucket: string; close_mark?: number | null; close: number | null }>>,
  theme: ColorMode
) {
  const fallbackColors = ["#f97316", "#0ea5e9", "#22c55e", "#eab308", "#ec4899"];

  return [...assets]
    .sort((a, b) => (b.current_mid_price ?? 0) - (a.current_mid_price ?? 0))
    .slice(0, 15)
    .map((asset, index) => {
      const candles = [...(candleHistoryBySymbol[asset.symbol] || asset.sparkline_candles || [])]
        .filter((point) => toTimestamp(point.bucket) !== null)
        .sort((a, b) => (toTimestamp(a.bucket) ?? 0) - (toTimestamp(b.bucket) ?? 0));
      const latestTs = toTimestamp(candles[candles.length - 1]?.bucket);
      const startTs = latestTs === null ? null : getMonthsAgoFromTimestamp(latestTs, 4);

      const values = candles
        .filter((point) => {
          const ts = toTimestamp(point.bucket);
          if (ts === null) return false;
          return startTs === null ? true : ts >= startTs;
        })
        .map((point) => ({
          time: point.bucket,
          value: point.close_mark ?? point.close ?? null,
        }))
        .filter((point) => point.value !== null && Number.isFinite(point.value));

      return {
        name: asset.symbol,
        symbol: asset.symbol,
        icon: asset.icon ?? null,
        color: getUsableChannelColor(asset.color, theme) || fallbackColors[index % fallbackColors.length],
        kind: "line" as const,
        values,
      };
    })
    .filter((series) => series.values.length > 0);
}

function ReportList({
  title,
  rows,
  assets,
  mode,
  copy = "Snapshot of the latest settled report basket.",
}: {
  title: string;
  rows: ReportListRow[];
  assets: MarketAsset[];
  mode: "premium" | "move" | "volume";
  copy?: string;
}) {
  return (
    <div className={styles.listCard}>
      <div className={styles.listHeader}>
        <div>
          <h3 className={styles.listTitle}>{title}</h3>
          <p className={styles.listCopy}>{copy}</p>
        </div>
      </div>
      <div className={styles.list}>
        {rows.map((row, index) => {
          const asset = findAsset(assets, row.symbol);
          const tone = metricTone(mode === "premium" ? row.premium_pct : mode === "move" ? row.move_pct : row.volume_change_pct);

          return (
            <div key={`${title}-${row.symbol}`} className={styles.row}>
              <div className={styles.rank}>{String(index + 1).padStart(2, "0")}</div>
              <div className={styles.rowMeta}>
                <AssetCoin
                  symbol={row.symbol}
                  icon={asset?.icon ?? row.icon ?? null}
                  color={asset?.color ?? row.color ?? null}
                  className={styles.rowIcon}
                />
                <div>
                  <strong>{row.symbol}</strong>
                  <span>{row.display_name}</span>
                </div>
              </div>
              <strong className={`${styles.metric} ${tone}`}>{formatMetric(row, mode)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MarketReportSection({
  report,
  assets,
}: {
  report: DailyReport | null;
  assets: MarketAsset[];
}) {
  const { theme } = useTheme();
  const [dailyCandleHistoryBySymbol, setDailyCandleHistoryBySymbol] = useState<Record<string, ReturnType<typeof normalizeCandles>>>({});
  const [adjustmentSummary, setAdjustmentSummary] = useState<MarketAdjustmentSummary | null>(null);

  const topAssets = useMemo(
    () => [...assets].sort((a, b) => (b.current_mid_price ?? 0) - (a.current_mid_price ?? 0)).slice(0, 15),
    [assets]
  );

  useEffect(() => {
    let isCancelled = false;

    async function loadDailyCandleHistory() {
      if (!topAssets.length) {
        if (!isCancelled) setDailyCandleHistoryBySymbol({});
        return;
      }

      const results = await Promise.allSettled(
        topAssets.map(async (asset) => {
          const response = await apiFetch<{ candles: Array<Record<string, unknown>> }>(
            `/api/market/assets/${asset.symbol}/candles?interval=1d&range=1y`,
            { cache: "no-store" }
          );
          return [asset.symbol, normalizeCandles(response.candles)] as const;
        })
      );

      if (isCancelled) return;

      const nextHistory: Record<string, ReturnType<typeof normalizeCandles>> = {};
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const [symbol, candles] = result.value;
        nextHistory[symbol] = candles;
      }
      setDailyCandleHistoryBySymbol(nextHistory);
    }

    void loadDailyCandleHistory();

    return () => {
      isCancelled = true;
    };
  }, [topAssets]);

  useEffect(() => {
    let isCancelled = false;

    async function loadAdjustmentSummary() {
      try {
        const result = await apiFetch<Record<string, unknown>>("/api/market/adjustments/summary?recent_limit=12", { cache: "no-store" });
        if (!isCancelled) {
          setAdjustmentSummary(normalizeMarketAdjustmentSummary(result));
        }
      } catch {
        if (!isCancelled) {
          setAdjustmentSummary(null);
        }
      }
    }

    void loadAdjustmentSummary();

    return () => {
      isCancelled = true;
    };
  }, []);

  if (!report) {
    return <section className={styles.section}><div className={styles.empty}>No daily report found yet.</div></section>;
  }

  const monthPriceSeries = buildMonthPriceSeries(assets, dailyCandleHistoryBySymbol, theme);
  const appliedAdjustmentFeed = (adjustmentSummary?.feed || [])
    .filter((item) => item.status !== "skipped" && item.move_pct !== null && item.move_pct !== undefined);
  const lastTickFeed = appliedAdjustmentFeed
    .filter((item) => isLastAdjustmentOutcome(item, adjustmentSummary?.last_tick || null));
  const adjustmentMovers = lastTickFeed.length
    ? lastTickFeed
    : appliedAdjustmentFeed.length
      ? appliedAdjustmentFeed
      : adjustmentSummary?.leaderboards.movers || [];
  const adjustmentWinners: MarketAdjustmentOutcome[] = [...adjustmentMovers]
    .filter((item) => (item.move_pct ?? 0) > 0)
    .sort((left, right) => (right.move_pct ?? 0) - (left.move_pct ?? 0))
    .slice(0, 5);
  const adjustmentLosers: MarketAdjustmentOutcome[] = [...adjustmentMovers]
    .filter((item) => (item.move_pct ?? 0) < 0)
    .sort((left, right) => (left.move_pct ?? 0) - (right.move_pct ?? 0))
    .slice(0, 5);
  const winnerRows: ReportListRow[] = adjustmentWinners.length ? adjustmentWinners : (report.biggest_winners || []);
  const loserRows: ReportListRow[] = adjustmentLosers.length ? adjustmentLosers : (report.biggest_losers || []);
  const moveListCopy = adjustmentMovers.length
    ? "Largest moves from the latest adjustment outcomes."
    : "Snapshot of the latest settled report basket.";

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Latest Market Report</h2>
          <p className={styles.copy}>Market date {report.market_date} with {report.asset_count} assets settled.</p>
        </div>
        <div className={styles.summaryStrip}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Biggest Winner</span>
            <strong>{winnerRows[0]?.symbol || "—"}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Top Loser</span>
            <strong>{loserRows[0]?.symbol || "—"}</strong>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        <ReportList title="Biggest Winners" rows={winnerRows} assets={assets} mode="move" copy={moveListCopy} />
        <ReportList title="Biggest Losers" rows={loserRows} assets={assets} mode="move" copy={moveListCopy} />
        <ReportList title="Volume Winners" rows={report.volume_winners || []} assets={assets} mode="volume" />
        <ReportList title="Volume Losers" rows={report.volume_losers || []} assets={assets} mode="volume" />
      </div>

      <div className={styles.trendWrap}>
        <TrendChartCard
          title="Top 15 Coin Prices (4M)"
          subtitle="Past 4 months of price trend for the highest-priced coins."
          series={monthPriceSeries}
        />
      </div>
    </section>
  );
}
