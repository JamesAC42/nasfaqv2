"use client";

import { SparklineChart } from "@/app/components/charts/market-charts";
import { fmtNumber, fmtPct } from "@/app/lib/format";
import { computeHeatmapMarketCap, getIconUrl } from "@/app/lib/normalizers";
import type { MarketAsset } from "@/app/lib/types";
import styles from "@/app/components/home/market-overview-section.module.scss";

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
  selectedSymbol,
  selectedUnit,
  unitOptions,
  onSelectSymbol,
  onSelectUnit,
}: {
  assets: MarketAsset[];
  selectedSymbol: string;
  selectedUnit: string;
  unitOptions: string[];
  onSelectSymbol: (symbol: string) => void;
  onSelectUnit: (unit: string) => void;
}) {
  const heatmapAssets = [...assets]
    .filter((asset) => selectedUnit === "all" || asset.unit === selectedUnit)
    .sort((a, b) => computeHeatmapMarketCap(b) - computeHeatmapMarketCap(a))
    .slice(0, 25);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Market Assets</h2>
          <p className={styles.copy}>Overview table, selection state, and heatmap are now isolated behind the market store.</p>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th>Trend</th>
              <th>Mid</th>
              <th>Fair</th>
              <th>Premium</th>
              <th>24h Move</th>
              <th>24h Volume</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.symbol} className={asset.symbol === selectedSymbol ? styles.selectedRow : undefined}>
                <td>
                  <button type="button" className={styles.rowButton} onClick={() => onSelectSymbol(asset.symbol)}>
                    {asset.symbol}
                  </button>
                </td>
                <td>{asset.display_name}</td>
                <td><SparklineChart candles={asset.sparkline_candles} /></td>
                <td>{fmtNumber(asset.current_mid_price)}</td>
                <td>{fmtNumber(asset.current_fair_value)}</td>
                <td>{fmtPct(asset.current_premium_pct)}</td>
                <td>{fmtPct(asset.move_24h_pct)}</td>
                <td>{fmtNumber(asset.volume_24h)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    </section>
  );
}
