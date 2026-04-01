import { AssetCoin } from "@/app/components/common/asset-coin";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { fmtPct } from "@/app/lib/format";
import type { DailyReport, MarketAsset, ReportRow } from "@/app/lib/types";
import styles from "@/app/components/home/market-report-section.module.scss";

function findAsset(assets: MarketAsset[], symbol: string) {
  return assets.find((asset) => asset.symbol === symbol);
}

function formatMetric(row: ReportRow, mode: "premium" | "move" | "volume") {
  if (mode === "premium") return fmtPct(row.premium_pct);
  if (mode === "move") return fmtPct(row.move_pct);
  return fmtPct(row.volume_change_pct);
}

function metricTone(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return styles.neutral;
  return value >= 0 ? styles.positive : styles.negative;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function buildMonthPriceSeries(assets: MarketAsset[]) {
  const fallbackColors = ["#f97316", "#0ea5e9", "#22c55e", "#eab308", "#ec4899"];

  return [...assets]
    .sort((a, b) => (b.current_mid_price ?? 0) - (a.current_mid_price ?? 0))
    .slice(0, 15)
    .map((asset, index) => {
      const candles = [...(asset.sparkline_candles || [])]
        .filter((point) => toTimestamp(point.bucket) !== null)
        .sort((a, b) => (toTimestamp(a.bucket) ?? 0) - (toTimestamp(b.bucket) ?? 0));
      const latestTs = toTimestamp(candles[candles.length - 1]?.bucket);
      const startTs = latestTs === null ? null : latestTs - 90 * 24 * 60 * 60 * 1000;

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
        color: asset.color || fallbackColors[index % fallbackColors.length],
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
}: {
  title: string;
  rows: ReportRow[];
  assets: MarketAsset[];
  mode: "premium" | "move" | "volume";
}) {
  return (
    <div className={styles.listCard}>
      <div className={styles.listHeader}>
        <div>
          <h3 className={styles.listTitle}>{title}</h3>
          <p className={styles.listCopy}>Snapshot of the latest settled report basket.</p>
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
                  icon={asset?.icon ?? null}
                  color={asset?.color ?? null}
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
  if (!report) {
    return <section className={styles.section}><div className={styles.empty}>No daily report found yet.</div></section>;
  }

  const monthPriceSeries = buildMonthPriceSeries(assets);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Latest Market Report</h2>
          <p className={styles.copy}>Market date {report.market_date} with {report.asset_count} assets settled across price, premium, and flow leadership.</p>
        </div>
        <div className={styles.summaryStrip}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Premium Leaders</span>
            <strong>{report.largest_premiums?.[0]?.symbol || "—"}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Biggest Winner</span>
            <strong>{report.biggest_winners?.[0]?.symbol || "—"}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Top Loser</span>
            <strong>{report.biggest_losers?.[0]?.symbol || "—"}</strong>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        <ReportList title="Largest Premiums" rows={report.largest_premiums || []} assets={assets} mode="premium" />
        <ReportList title="Largest Discounts" rows={report.largest_discounts || []} assets={assets} mode="premium" />
        <ReportList title="Biggest Winners" rows={report.biggest_winners || []} assets={assets} mode="move" />
        <ReportList title="Top Losers" rows={report.biggest_losers || []} assets={assets} mode="move" />
        <ReportList title="Volume Winners" rows={report.volume_winners || []} assets={assets} mode="volume" />
        <ReportList title="Volume Losers" rows={report.volume_losers || []} assets={assets} mode="volume" />
      </div>

      <div className={styles.trendWrap}>
        <TrendChartCard
          title="Top 15 Coin Prices (90D)"
          subtitle="Past 3 months of price trend for the highest-priced coins."
          series={monthPriceSeries}
        />
      </div>
    </section>
  );
}
