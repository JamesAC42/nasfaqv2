"use client";

import Link from "next/link";
import { SparklineChart, TrendChartCard } from "@/app/components/charts/market-charts";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { computeHeatmapMarketCap, getIconUrl } from "@/app/lib/normalizers";
import type { MarketAsset, MarketIndexBundle } from "@/app/lib/types";
import styles from "@/app/components/home/market-overview-section.module.scss";

function formatIndexTitle(group: string) {
  return group === "all" ? "All Market" : group;
}

function formatIntervalLabel(value: string | null | undefined) {
  switch (value) {
    case "open":
      return "Open";
    case "lunch":
      return "Lunch";
    case "late":
      return "Late";
    case "overnight":
      return "Overnight";
    default:
      return value || "Next";
  }
}

function formatAdjustmentTime(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function computePremiumPressure(asset: MarketAsset) {
  const marketPrice = asset.market_price ?? asset.current_mid_price;
  const baseRate = asset.base_rate ?? asset.current_fair_value;
  if (!marketPrice || !baseRate) return null;
  return (marketPrice - baseRate) / baseRate;
}

function IndexCard({
  index,
  selectedUnit,
  isLoading,
  onSelectUnit,
}: {
  index: MarketIndexBundle;
  selectedUnit: string;
  isLoading: boolean;
  onSelectUnit: (unit: string) => void;
}) {
  const summary = index.summary;
  const groupValue = index.group === "all" ? "all" : index.group;
  const title = formatIndexTitle(index.group);
  const isSelected = selectedUnit === groupValue;

  return (
    <button
      type="button"
      className={`${styles.indexCard} ${isSelected ? styles.indexCardSelected : ""}`}
      onClick={() => onSelectUnit(groupValue)}
    >
      <TrendChartCard
        title={`${title} Index`}
        subtitle={`Equal-weight rebased index for ${title === "All Market" ? "all active assets" : `${title} assets`}`}
        series={[
          {
            name: "Index",
            color: "#2563eb",
            kind: "area",
            values: index.series.map((item) => ({ time: item.bucket, value: item.value })),
          },
        ]}
      />
      <div className={styles.indexStats}>
        <div className={styles.indexStatCard}>
          <span className={styles.label}>Index Level</span>
          <strong>{fmtNumber(summary?.index_value)}</strong>
        </div>
        <div className={styles.indexStatCard}>
          <span className={styles.label}>1D Return</span>
          <strong>{fmtPct(summary?.day_return_pct)}</strong>
        </div>
        <div className={styles.indexStatCard}>
          <span className={styles.label}>Range Return</span>
          <strong>{fmtPct(summary?.total_return_pct)}</strong>
        </div>
        <div className={styles.indexStatCard}>
          <span className={styles.label}>Constituents</span>
          <strong>{fmtInteger(summary?.constituent_count)}</strong>
        </div>
        <div className={styles.indexStatCard}>
          <span className={styles.label}>Advancers / Decliners</span>
          <strong>
            {fmtInteger(summary?.advancers)} / {fmtInteger(summary?.decliners)}
          </strong>
        </div>
        <div className={styles.indexStatCard}>
          <span className={styles.label}>Volume Cash</span>
          <strong>{fmtNumber(summary?.total_volume_cash)}</strong>
        </div>
        <div className={styles.indexStatCard}>
          <span className={styles.label}>Avg Premium</span>
          <strong>{fmtPct(summary?.avg_premium_pct)}</strong>
        </div>
        <div className={styles.indexStatCard}>
          <span className={styles.label}>Market Date</span>
          <strong>{summary?.market_date || (isLoading ? "Loading…" : "—")}</strong>
        </div>
      </div>
    </button>
  );
}

function AssetHeatmap({
  assets,
  onSelect,
}: {
  assets: MarketAsset[];
  onSelect: (symbol: string) => void;
}) {
  const ranked = [...assets]
    .map((asset) => ({ asset, marketCap: computeHeatmapMarketCap(asset) }))
    .sort((a, b) => b.marketCap - a.marketCap);
  const maxMarketCap = ranked[0]?.marketCap || 1;

  if (!ranked.length) {
    return <div className={styles.empty}>No assets available for the current heatmap filter.</div>;
  }

  return (
    <div className={styles.heatmapWrap}>
      {ranked.map(({ asset, marketCap }) => {
        const strength = Math.max(0, Math.min(1, marketCap / maxMarketCap));
        const span = strength > 0.65 ? styles.span3 : strength > 0.3 ? styles.span2 : styles.span1;
        const tone = (asset.move_24h_pct ?? 0) >= 0 ? styles.tileUp : styles.tileDown;

        return (
          <button
            key={asset.symbol}
            type="button"
            className={`${styles.tile} ${tone} ${span}`}
            onClick={() => onSelect(asset.symbol)}
            title={`${asset.symbol} ${fmtNumber(asset.current_mid_price)} ${fmtPct(asset.move_24h_pct)}`}
          >
            <div className={styles.tileHeader}>
              {getIconUrl(asset.icon) ? (
                <img src={getIconUrl(asset.icon) || ""} alt="" className={styles.icon} />
              ) : (
                <div className={styles.iconFallback}>{asset.symbol.slice(0, 1)}</div>
              )}
              <strong>{asset.symbol}</strong>
            </div>
            <div>{fmtNumber(asset.current_mid_price)}</div>
            <div>{fmtPct(asset.move_24h_pct)}</div>
          </button>
        );
      })}
    </div>
  );
}

export function MarketOverviewSection({
  assets,
  marketIndexes,
  selectedSymbol,
  selectedUnit,
  unitOptions,
  isLoadingIndex,
  onSelectSymbol,
  onSelectUnit,
  assetHrefBase,
  showIndexes = true,
  showAssetTable = true,
  showHeatmap = true,
}: {
  assets: MarketAsset[];
  marketIndexes: MarketIndexBundle[];
  selectedSymbol: string;
  selectedUnit: string;
  unitOptions: string[];
  isLoadingIndex: boolean;
  onSelectSymbol: (symbol: string) => void;
  onSelectUnit: (unit: string) => void;
  assetHrefBase?: string;
  showIndexes?: boolean;
  showAssetTable?: boolean;
  showHeatmap?: boolean;
}) {
  const heatmapAssets = [...assets]
    .filter((asset) => selectedUnit === "all" || asset.unit === selectedUnit)
    .sort((a, b) => computeHeatmapMarketCap(b) - computeHeatmapMarketCap(a))
    .slice(0, 25);
  const nextAdjustmentAsset = [...assets]
    .filter((asset) => asset.next_adjustment?.scheduled_at)
    .sort((a, b) => String(a.next_adjustment?.scheduled_at || "").localeCompare(String(b.next_adjustment?.scheduled_at || "")))[0] || null;
  const readyCount = assets.filter((asset) => asset.adjustment_ready).length;
  const largestPressureAsset = [...assets]
    .map((asset) => ({ asset, pressure: computePremiumPressure(asset) }))
    .filter((item): item is { asset: MarketAsset; pressure: number } => item.pressure !== null)
    .sort((a, b) => Math.abs(b.pressure) - Math.abs(a.pressure))[0] || null;

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Market Assets</h2>
          <p className={styles.copy}>Prices trade continuously, then scheduled adjustment ticks can move them toward each asset&apos;s base rate.</p>
        </div>
      </div>
      <div className={styles.adjustmentPanel}>
        <div className={styles.adjustmentLead}>
          <span className={styles.label}>Market Rhythm</span>
          <strong>
            {nextAdjustmentAsset?.next_adjustment
              ? `${formatIntervalLabel(nextAdjustmentAsset.next_adjustment.interval_key)} tick`
              : "No tick scheduled"}
          </strong>
          <p>
            Trading stays open during adjustment ticks. The tick uses each asset&apos;s scheduled strength to pull market price toward base rate.
          </p>
        </div>
        <div className={styles.adjustmentStats}>
          <div>
            <span className={styles.label}>Next Tick</span>
            <strong>{formatAdjustmentTime(nextAdjustmentAsset?.next_adjustment?.scheduled_at)}</strong>
          </div>
          <div>
            <span className={styles.label}>Ready Assets</span>
            <strong>{fmtInteger(readyCount)} / {fmtInteger(assets.length)}</strong>
          </div>
          <div>
            <span className={styles.label}>Largest Gap</span>
            <strong>{largestPressureAsset ? largestPressureAsset.asset.symbol : "N/A"}</strong>
            <em>{largestPressureAsset ? fmtPct(largestPressureAsset.pressure) : "N/A"}</em>
          </div>
        </div>
      </div>
      {showIndexes ? (
        <>
          <div className={styles.indexHeader}>
            <div>
              <h3 className={styles.title}>Market Indexes</h3>
              <p className={styles.copy}>All Market plus one equal-weight index per unit. Selecting a card also drives the heatmap filter below.</p>
            </div>
          </div>
          <div className={styles.indexGrid}>
            {marketIndexes.map((index) => (
              <IndexCard
                key={`${index.group_by}:${index.group}`}
                index={index}
                selectedUnit={selectedUnit}
                isLoading={isLoadingIndex}
                onSelectUnit={onSelectUnit}
              />
            ))}
          </div>
        </>
      ) : null}
      {showAssetTable ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Trend</th>
                <th>Mid</th>
                <th>Base Rate</th>
                <th>Premium</th>
                <th>Next Tick</th>
                <th>24h Move</th>
                <th>24h Volume</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.symbol} className={asset.symbol === selectedSymbol ? styles.selectedRow : undefined}>
                  <td>
                    {assetHrefBase ? (
                      <Link
                        href={`${assetHrefBase}/${encodeURIComponent(asset.symbol)}`}
                        className={styles.rowLink}
                        onClick={() => onSelectSymbol(asset.symbol)}
                      >
                        {asset.symbol}
                      </Link>
                    ) : (
                      <button type="button" className={styles.rowButton} onClick={() => onSelectSymbol(asset.symbol)}>
                        {asset.symbol}
                      </button>
                    )}
                  </td>
                  <td>{asset.display_name}</td>
                  <td><SparklineChart candles={asset.sparkline_candles} /></td>
                  <td>{fmtNumber(asset.current_mid_price)}</td>
                  <td>{fmtNumber(asset.base_rate ?? asset.current_fair_value)}</td>
                  <td>{fmtPct(asset.current_premium_pct)}</td>
                  <td>
                    {asset.next_adjustment
                      ? `${formatIntervalLabel(asset.next_adjustment.interval_key)} ${fmtPct((asset.next_adjustment.strength_pct ?? 0) / 100)}`
                      : "N/A"}
                  </td>
                  <td>{fmtPct(asset.move_24h_pct)}</td>
                  <td>{fmtNumber(asset.volume_24h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {showHeatmap ? (
        <>
          <div className={styles.heatmapHeader}>
            <div>
              <h3 className={styles.title}>Asset Heatmap</h3>
              <p className={styles.copy}>Top 25 by price × max(24h volume, 1). Tile size and selection remain presentational.</p>
            </div>
            <label className={styles.filter}>
              <span>Generation</span>
              <select className={styles.filterSelect} value={selectedUnit} onChange={(event) => onSelectUnit(event.target.value)}>
                <option value="all">All</option>
                {unitOptions.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <AssetHeatmap assets={heatmapAssets} onSelect={onSelectSymbol} />
        </>
      ) : null}
    </section>
  );
}
