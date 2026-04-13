"use client";

import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useMemo, type ReactNode } from "react";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { SiteShell } from "@/app/components/layout/site-shell";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { computeHeatmapMarketCap } from "@/app/lib/normalizers";
import type { DailyReport, MarketAsset, MarketIndexBundle, ReportRow } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import {
  FaArrowTrendDown,
  FaArrowTrendUp,
  FaArrowsLeftRight,
  FaBolt,
  FaChartColumn,
  FaChartLine,
  FaCircleNodes,
  FaGaugeHigh,
  FaLayerGroup,
  FaMoneyBillTrendUp,
  FaRankingStar,
  FaRegCalendar,
} from "react-icons/fa6";
import { HiMiniSquares2X2, HiSparkles } from "react-icons/hi2";
import { IoPulse } from "react-icons/io5";
import styles from "@/app/components/pages/indexes-page.module.scss";

function formatIndexTitle(group: string) {
  if (group === "all") return "All Market";
  return group.replace(/^hololive\s+/i, "");
}

function getToneClass(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return styles.neutral;
  if (value > 0) return styles.positive;
  if (value < 0) return styles.negative;
  return styles.neutral;
}

function findAsset(assets: MarketAsset[], symbol: string) {
  return assets.find((asset) => asset.symbol === symbol) || null;
}

function getIndexGroupValue(index: MarketIndexBundle) {
  return index.group === "all" ? "all" : index.group;
}

function topAssetBy(
  assets: MarketAsset[],
  selector: (asset: MarketAsset) => number | null | undefined,
  direction: "max" | "min" = "max"
) {
  return [...assets]
    .filter((asset) => {
      const value = selector(asset);
      return value !== null && value !== undefined && Number.isFinite(value);
    })
    .sort((left, right) => {
      const a = selector(left) ?? 0;
      const b = selector(right) ?? 0;
      return direction === "max" ? b - a : a - b;
    })[0] || null;
}

function buildReportGroups(report: DailyReport | null) {
  if (!report) return [];

  return [
    {
      key: "largest-premiums",
      title: "Premium Leaders",
      icon: <FaRankingStar />,
      rows: report.largest_premiums || [],
      metric: (row: ReportRow) => fmtPct(row.premium_pct),
    },
    {
      key: "largest-discounts",
      title: "Discounts",
      icon: <FaArrowTrendDown />,
      rows: report.largest_discounts || [],
      metric: (row: ReportRow) => fmtPct(row.premium_pct),
    },
    {
      key: "winners",
      title: "Price Winners",
      icon: <FaArrowTrendUp />,
      rows: report.biggest_winners || [],
      metric: (row: ReportRow) => fmtPct(row.move_pct),
    },
    {
      key: "losers",
      title: "Price Losers",
      icon: <FaChartLine />,
      rows: report.biggest_losers || [],
      metric: (row: ReportRow) => fmtPct(row.move_pct),
    },
    {
      key: "volume-winners",
      title: "Flow Leaders",
      icon: <FaMoneyBillTrendUp />,
      rows: report.volume_winners || [],
      metric: (row: ReportRow) => fmtPct(row.volume_change_pct),
    },
    {
      key: "volume-losers",
      title: "Flow Fade",
      icon: <FaArrowsLeftRight />,
      rows: report.volume_losers || [],
      metric: (row: ReportRow) => fmtPct(row.volume_change_pct),
    },
  ].filter((group) => group.rows.length > 0);
}

function IndexConstituentRow({
  index,
  assets,
}: {
  index: MarketIndexBundle;
  assets: MarketAsset[];
}) {
  const constituents = [...assets]
    .filter((asset) => index.group === "all" || asset.unit === index.group)
    .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
    .slice(0, 8);

  if (!constituents.length) {
    return (
      <div className={styles.iconStripEmpty}>
        <FaCircleNodes />
        <span>No channel icons yet</span>
      </div>
    );
  }

  const remaining = Math.max(0, (index.summary?.constituent_count ?? constituents.length) - constituents.length);

  return (
    <div className={styles.iconStrip}>
      <div className={styles.iconStack} aria-label="Index constituents">
        {constituents.map((asset) => (
          <AssetCoin
            key={`${index.group}-${asset.symbol}`}
            symbol={asset.symbol}
            icon={asset.icon ?? null}
            color={asset.color ?? null}
            className={styles.indexChannelIcon}
          />
        ))}
      </div>
      <div className={styles.iconStripMeta}>
        <span>Channels in basket</span>
        {remaining > 0 ? <strong>+{remaining} more</strong> : <strong>{fmtInteger(index.summary?.constituent_count)}</strong>}
      </div>
    </div>
  );
}

function IndexSelectorMemberStrip({
  index,
  assets,
}: {
  index: MarketIndexBundle;
  assets: MarketAsset[];
}) {
  if (index.group === "all") return null;

  const members = assets
    .filter((asset) => asset.unit === index.group)
    .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
    .slice(0, 6);

  if (!members.length) return null;

  return (
    <div className={styles.indexSelectorMembers} aria-hidden="true">
      {members.map((asset) => (
        <AssetCoin
          key={`${index.group}-selector-${asset.symbol}`}
          symbol={asset.symbol}
          icon={asset.icon ?? null}
          color={asset.color ?? null}
          className={styles.indexSelectorMemberIcon}
        />
      ))}
    </div>
  );
}

function IndexSelectorCard({
  index,
  assets,
  selectedUnit,
  onSelectUnit,
}: {
  index: MarketIndexBundle;
  assets: MarketAsset[];
  selectedUnit: string;
  onSelectUnit: (unit: string) => void;
}) {
  const summary = index.summary;
  const groupValue = getIndexGroupValue(index);
  const isSelected = selectedUnit === groupValue;
  const title = formatIndexTitle(index.group);

  return (
    <button
      type="button"
      className={`${styles.indexSelectorCard} ${isSelected ? styles.indexSelectorCardSelected : ""}`}
      onClick={() => onSelectUnit(groupValue)}
      aria-pressed={isSelected}
    >
      <div className={styles.indexSelectorHeader}>
        <div>
          <div className={styles.indexEyebrow}>
            <FaLayerGroup />
            <span>{index.weighting} weight</span>
          </div>
          <div className={styles.indexSelectorTitleRow}>
            <h3>{title}</h3>
            <IndexSelectorMemberStrip index={index} assets={assets} />
          </div>
          <p>{title === "All Market" ? "Cross-market baseline" : "Unit-level market tape"} with equal-weight breadth.</p>
        </div>
        <div className={`${styles.returnBadge} ${getToneClass(summary?.day_return_pct)}`}>
          {summary?.day_return_pct !== null && (summary?.day_return_pct ?? 0) >= 0 ? <FaArrowTrendUp /> : <FaArrowTrendDown />}
          <strong>{fmtPct(summary?.day_return_pct)}</strong>
          <span>1D</span>
        </div>
      </div>
      <div className={styles.indexSelectorStats}>
        <div className={styles.indexSelectorStat}>
          <span><FaGaugeHigh /> Level</span>
          <strong>{fmtNumber(summary?.index_value)}</strong>
        </div>
        <div className={styles.indexSelectorStat}>
          <span><FaChartLine /> Range</span>
          <strong className={getToneClass(summary?.total_return_pct)}>{fmtPct(summary?.total_return_pct)}</strong>
        </div>
        <div className={styles.indexSelectorStat}>
          <span><FaArrowTrendUp /> Breadth</span>
          <strong>
            {fmtInteger(summary?.advancers)} / {fmtInteger(summary?.decliners)}
          </strong>
        </div>
      </div>
    </button>
  );
}

function IndexDetailPanel({
  index,
  assets,
  indexChartColor,
  selectedSymbol,
  setSelectedSymbol,
  heatmapAssets,
  assetTableRows,
}: {
  index: MarketIndexBundle;
  assets: MarketAsset[];
  indexChartColor: string;
  selectedSymbol: string | null;
  setSelectedSymbol: (symbol: string) => void;
  heatmapAssets: MarketAsset[];
  assetTableRows: MarketAsset[];
}) {
  const summary = index.summary;
  const title = formatIndexTitle(index.group);

  return (
    <div className={styles.indexDetailPane}>
      <div className={styles.indexDetailTop}>
        <div className={styles.indexDetailChart}>
          <div className={styles.indexDetailHeader}>
            <div>
              <div className={styles.indexEyebrow}>
                <FaLayerGroup />
                <span>{index.weighting} weight</span>
              </div>
              <h3>{title}</h3>
              <p>
                {title === "All Market" ? "Cross-market baseline" : "Unit-level market tape"} with performance, breadth, and constituent read-through.
              </p>
            </div>
            <div className={`${styles.returnBadge} ${getToneClass(summary?.day_return_pct)}`}>
              {summary?.day_return_pct !== null && (summary?.day_return_pct ?? 0) >= 0 ? <FaArrowTrendUp /> : <FaArrowTrendDown />}
              <strong>{fmtPct(summary?.day_return_pct)}</strong>
              <span>1D</span>
            </div>
          </div>

          <div className={styles.detailChart}>
            <TrendChartCard
              title={`${title} Index`}
              subtitle={`${summary?.market_date || "Latest"} · ${fmtInteger(summary?.constituent_count)} constituents`}
              series={[
                {
                  name: "Index",
                  color: indexChartColor,
                  kind: "area",
                  values: index.series.map((point) => ({ time: point.bucket, value: point.value })),
                },
              ]}
            />
          </div>
        </div>

        <div className={styles.indexDetailAside}>
          <div className={styles.indexDetailCallout}>
            <span><FaMoneyBillTrendUp /> Indexed flow</span>
            <strong>{fmtNumber(summary?.total_volume_cash, "$")}</strong>
            <p>Notional volume moving through this basket on the latest settled session.</p>
          </div>
          <div className={styles.indexDetailCallout}>
            <span><HiSparkles /> Average premium</span>
            <strong className={getToneClass(summary?.avg_premium_pct)}>{fmtPct(summary?.avg_premium_pct)}</strong>
            <p>Mean premium across the currently indexed constituents.</p>
          </div>
          <IndexConstituentRow index={index} assets={assets} />
        </div>
      </div>

      <div className={styles.indexStatsGrid}>
        <div className={styles.indexStat}>
          <span><FaGaugeHigh /> Level</span>
          <strong>{fmtNumber(summary?.index_value)}</strong>
        </div>
        <div className={styles.indexStat}>
          <span><FaChartLine /> Range</span>
          <strong className={getToneClass(summary?.total_return_pct)}>{fmtPct(summary?.total_return_pct)}</strong>
        </div>
        <div className={styles.indexStat}>
          <span><FaMoneyBillTrendUp /> Volume</span>
          <strong>{fmtNumber(summary?.total_volume_cash, "$")}</strong>
        </div>
        <div className={styles.indexStat}>
          <span><HiSparkles /> Premium</span>
          <strong className={getToneClass(summary?.avg_premium_pct)}>{fmtPct(summary?.avg_premium_pct)}</strong>
        </div>
        <div className={styles.indexStat}>
          <span><FaArrowTrendUp /> Breadth</span>
          <strong>
            {fmtInteger(summary?.advancers)} / {fmtInteger(summary?.decliners)}
          </strong>
        </div>
        <div className={styles.indexStat}>
          <span><FaRegCalendar /> Date</span>
          <strong>{summary?.market_date || "—"}</strong>
        </div>
      </div>

      <div className={styles.indexDetailMarketDesk}>
        <div className={styles.heatmapPanel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Heatmap</h2>
              <p>Tile size scales with price-volume footprint for the selected basket.</p>
            </div>
          </div>
          <div className={styles.heatmap}>
            {heatmapAssets.map((asset) => {
              const strength = Math.max(0, Math.min(1, computeHeatmapMarketCap(asset) / Math.max(computeHeatmapMarketCap(heatmapAssets[0] || asset), 1)));
              const spanClass = strength > 0.66 ? styles.tileLg : strength > 0.33 ? styles.tileMd : styles.tileSm;
              return (
                <button
                  key={asset.symbol}
                  type="button"
                  className={`${styles.heatmapTile} ${spanClass} ${(asset.move_24h_pct ?? 0) >= 0 ? styles.tileUp : styles.tileDown} ${selectedSymbol === asset.symbol ? styles.tileSelected : ""}`}
                  onClick={() => setSelectedSymbol(asset.symbol)}
                >
                  <div className={styles.heatmapTileHeader}>
                    <AssetCoin symbol={asset.symbol} icon={asset.icon ?? null} color={asset.color ?? null} className={styles.heatmapIcon} />
                    <div>
                      <strong>{asset.symbol}</strong>
                      <span>{asset.display_name}</span>
                    </div>
                  </div>
                  <div className={styles.heatmapNumbers}>
                    <strong>{fmtNumber(asset.current_mid_price, "$")}</strong>
                    <span className={getToneClass(asset.move_24h_pct)}>{fmtPct(asset.move_24h_pct)}</span>
                  </div>
                  <div className={styles.heatmapMeta}>
                    <span>Vol {fmtNumber(asset.volume_24h)}</span>
                    <span>Prem {fmtPct(asset.current_premium_pct)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.tablePanel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Asset Tape</h2>
              <p>Compact sortable-style readout for the currently selected index basket.</p>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Mid</th>
                  <th>24h</th>
                  <th>Premium</th>
                  <th>Volume</th>
                  <th>Desk</th>
                </tr>
              </thead>
              <tbody>
                {assetTableRows.map((asset) => (
                  <tr key={asset.symbol} className={selectedSymbol === asset.symbol ? styles.selectedRow : undefined}>
                    <td>
                      <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.assetLink} onClick={() => setSelectedSymbol(asset.symbol)}>
                        <AssetCoin symbol={asset.symbol} icon={asset.icon ?? null} color={asset.color ?? null} className={styles.tableCoin} />
                        <span>
                          <strong>{asset.symbol}</strong>
                          <em>{asset.display_name}</em>
                        </span>
                      </Link>
                    </td>
                    <td>{fmtNumber(asset.current_mid_price, "$")}</td>
                    <td className={getToneClass(asset.move_24h_pct)}>{fmtPct(asset.move_24h_pct)}</td>
                    <td className={getToneClass(asset.current_premium_pct)}>{fmtPct(asset.current_premium_pct)}</td>
                    <td>{fmtNumber(asset.volume_24h)}</td>
                    <td>{asset.unit || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportCard({
  title,
  rows,
  assets,
  icon,
  metric,
}: {
  title: string;
  rows: ReportRow[];
  assets: MarketAsset[];
  icon: ReactNode;
  metric: (row: ReportRow) => string;
}) {
  return (
    <section className={styles.reportCard}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <span className={styles.cardIcon}>{icon}</span>
          <div>
            <h3>{title}</h3>
            <p>Latest settled daily report leaders.</p>
          </div>
        </div>
      </div>
      <div className={styles.reportRows}>
        {rows.slice(0, 5).map((row, index) => {
          const asset = findAsset(assets, row.symbol);
          return (
            <div key={`${title}-${row.symbol}`} className={styles.reportRow}>
              <span className={styles.reportRank}>{String(index + 1).padStart(2, "0")}</span>
              <div className={styles.reportAsset}>
                <AssetCoin
                  symbol={row.symbol}
                  icon={asset?.icon ?? null}
                  color={asset?.color ?? null}
                  className={styles.reportAssetIcon}
                />
                <div>
                  <strong>{row.symbol}</strong>
                  <span>{row.display_name}</span>
                </div>
              </div>
              <strong className={getToneClass(row.move_pct ?? row.premium_pct ?? row.volume_change_pct)}>{metric(row)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function IndexesPage() {
  const assets = useMarketStore((state) => state.assets);
  const report = useMarketStore((state) => state.report);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol);
  const selectedUnit = useMarketStore((state) => state.selectedUnit);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const isLoadingIndex = useMarketStore((state) => state.isLoadingIndex);
  const error = useMarketStore((state) => state.error);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const setSelectedUnit = useMarketStore((state) => state.setSelectedUnit);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const fetchMarketIndexes = useMarketStore((state) => state.fetchMarketIndexes);
  const deferredSelectedUnit = useDeferredValue(selectedUnit);
  const indexChartColor = useMemo(() => {
    if (typeof document === "undefined") return "#4f8cff";
    return getComputedStyle(document.documentElement).getPropertyValue("--trend-line").trim() || "#4f8cff";
  }, []);

  useEffect(() => {
    void Promise.allSettled([refreshOverview(), fetchMarketIndexes()]);
  }, [fetchMarketIndexes, refreshOverview]);

  const marketTopPrice = useMemo(() => topAssetBy(assets, (asset) => asset.current_mid_price), [assets]);
  const marketTopVolume = useMemo(() => topAssetBy(assets, (asset) => asset.volume_24h), [assets]);
  const marketTopMover = useMemo(() => topAssetBy(assets, (asset) => asset.move_24h_pct), [assets]);
  const marketTopDiscount = useMemo(() => topAssetBy(assets, (asset) => asset.current_premium_pct, "min"), [assets]);
  const allMarketIndex = useMemo(
    () => marketIndexes.find((index) => index.group === "all") || marketIndexes[0] || null,
    [marketIndexes]
  );
  const unitOptions = useMemo(
    () =>
      Array.from(new Set(assets.map((asset) => asset.unit).filter((value): value is string => Boolean(value)))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [assets]
  );

  const averageMove = useMemo(() => {
    if (!assets.length) return null;
    const moves = assets.map((asset) => Math.abs(asset.move_24h_pct ?? 0));
    return moves.reduce((sum, value) => sum + value, 0) / moves.length;
  }, [assets]);

  const totalVolumeCash = useMemo(
    () => marketIndexes.reduce((sum, index) => sum + (index.summary?.total_volume_cash ?? 0), 0),
    [marketIndexes]
  );

  const reportGroups = useMemo(() => buildReportGroups(report), [report]);

  const activeIndex = useMemo(() => {
    if (!marketIndexes.length) return null;
    return marketIndexes.find((index) => getIndexGroupValue(index) === selectedUnit) || allMarketIndex || marketIndexes[0] || null;
  }, [allMarketIndex, marketIndexes, selectedUnit]);

  useEffect(() => {
    if (!marketIndexes.length) return;
    if (marketIndexes.some((index) => getIndexGroupValue(index) === selectedUnit)) return;

    const fallbackUnit = getIndexGroupValue(allMarketIndex || marketIndexes[0]);
    startTransition(() => {
      setSelectedUnit(fallbackUnit);
    });
  }, [allMarketIndex, marketIndexes, selectedUnit, setSelectedUnit]);

  const filteredAssets = useMemo(
    () => assets.filter((asset) => deferredSelectedUnit === "all" || asset.unit === deferredSelectedUnit),
    [assets, deferredSelectedUnit]
  );

  const heatmapAssets = useMemo(
    () =>
      [...filteredAssets]
        .sort((a, b) => computeHeatmapMarketCap(b) - computeHeatmapMarketCap(a))
        .slice(0, 18),
    [filteredAssets]
  );

  const assetTableRows = useMemo(
    () => [...filteredAssets].sort((a, b) => (b.current_mid_price ?? 0) - (a.current_mid_price ?? 0)).slice(0, 12),
    [filteredAssets]
  );

  return (
    <SiteShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.heroEyebrow}>
              <IoPulse />
              <span>Market dashboard</span>
            </div>
            <h1>Indexes</h1>
            <p>
              A denser macro view of the tape: index performance, breadth, leaders and laggards, and the current asset map in one place.
            </p>
          </div>
          <div className={styles.heroStats}>
            <div className={styles.heroStat}>
              <span><FaLayerGroup /> Indexes tracked</span>
              <strong>{fmtInteger(marketIndexes.length)}</strong>
            </div>
            <div className={styles.heroStat}>
              <span><FaMoneyBillTrendUp /> Indexed flow</span>
              <strong>{fmtNumber(totalVolumeCash, "$")}</strong>
            </div>
            <div className={styles.heroStat}>
              <span><FaRegCalendar /> Market date</span>
              <strong>{report?.market_date || marketStatus?.current_market_date || "—"}</strong>
            </div>
          </div>
        </section>

        {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
        {isLoadingOverview || isLoadingIndex ? <div className={styles.loadingPanel}>Loading dashboard data…</div> : null}

        <section className={styles.statusStrip}>
          <div className={styles.statusCard}>
            <span><FaBolt /> Market status</span>
            <strong>{marketStatus?.is_trading_open ? "Open" : "Closed"}</strong>
            <p>{marketStatus?.trading_message || "Trading session operating normally."}</p>
          </div>
          <div className={styles.statusCard}>
            <span><FaArrowTrendUp /> Breadth</span>
            <strong>
              {fmtInteger(allMarketIndex?.summary?.advancers)} adv / {fmtInteger(allMarketIndex?.summary?.decliners)} dec
            </strong>
            <p>All-market daily direction split.</p>
          </div>
          <div className={styles.statusCard}>
            <span><FaChartColumn /> Coverage</span>
            <strong>{fmtInteger(assets.length)} active assets</strong>
              <p>{selectedUnit === "all" ? "Full market universe visible." : `${selectedUnit} subset selected.`}</p>
            </div>
          </section>

        <section className={styles.summaryGrid}>
          <div className={styles.summaryCardLarge}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <span className={styles.cardIcon}><FaGaugeHigh /></span>
                <div>
                  <h2>Market Summary</h2>
                  <p>Homepage snapshot, reformatted into a compact control-room layout.</p>
                </div>
              </div>
            </div>
            <div className={styles.summaryHighlights}>
              <div className={styles.highlightCard}>
                <span>Highest price</span>
                <strong>{fmtNumber(marketTopPrice?.current_mid_price, "$")}</strong>
                {marketTopPrice ? (
                  <div className={styles.assetMeta}>
                    <AssetCoin symbol={marketTopPrice.symbol} icon={marketTopPrice.icon} color={marketTopPrice.color} className={styles.inlineAssetIcon} />
                    <span>{marketTopPrice.display_name}</span>
                  </div>
                ) : null}
              </div>
              <div className={styles.highlightCard}>
                <span>Highest flow</span>
                <strong>{fmtNumber(marketTopVolume?.volume_24h)}</strong>
                {marketTopVolume ? (
                  <div className={styles.assetMeta}>
                    <AssetCoin symbol={marketTopVolume.symbol} icon={marketTopVolume.icon} color={marketTopVolume.color} className={styles.inlineAssetIcon} />
                    <span>{marketTopVolume.symbol} shares traded</span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className={styles.summaryStats}>
              <div className={styles.summaryStat}>
                <span><FaChartLine /> Top mover</span>
                <strong>{marketTopMover?.symbol || "—"}</strong>
                <em className={getToneClass(marketTopMover?.move_24h_pct)}>{fmtPct(marketTopMover?.move_24h_pct)}</em>
              </div>
              <div className={styles.summaryStat}>
                <span><FaArrowTrendDown /> Cheapest premium</span>
                <strong>{marketTopDiscount?.symbol || "—"}</strong>
                <em className={getToneClass(marketTopDiscount?.current_premium_pct)}>{fmtPct(marketTopDiscount?.current_premium_pct)}</em>
              </div>
              <div className={styles.summaryStat}>
                <span><HiMiniSquares2X2 /> Active assets</span>
                <strong>{fmtInteger(assets.length)}</strong>
                <em>Across all tracked units</em>
              </div>
              <div className={styles.summaryStat}>
                <span><HiSparkles /> Avg daily move</span>
                <strong>{fmtPct(averageMove)}</strong>
                <em>Absolute 24h move</em>
              </div>
            </div>
          </div>

          <div className={styles.summaryCardLarge}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>
                <span className={styles.cardIcon}><FaRankingStar /></span>
                <div>
                  <h2>Market Report</h2>
                  <p>Daily report leadership folded into the dashboard instead of a separate homepage block.</p>
                </div>
              </div>
            </div>
            <div className={styles.reportSnapshot}>
              <div className={styles.reportSnapshotItem}>
                <span>Date</span>
                <strong>{report?.market_date || "—"}</strong>
              </div>
              <div className={styles.reportSnapshotItem}>
                <span>Settled assets</span>
                <strong>{fmtInteger(report?.asset_count)}</strong>
              </div>
              <div className={styles.reportSnapshotItem}>
                <span>Premium leader</span>
                <strong>{report?.largest_premiums?.[0]?.symbol || "—"}</strong>
              </div>
              <div className={styles.reportSnapshotItem}>
                <span>Top winner</span>
                <strong>{report?.biggest_winners?.[0]?.symbol || "—"}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.reportGrid}>
          {reportGroups.map((group) => (
            <ReportCard
              key={group.key}
              title={group.title}
              rows={group.rows}
              assets={assets}
              icon={group.icon}
              metric={group.metric}
            />
          ))}
        </section>

        <section className={styles.indexesSection}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Index Desk</h2>
              <p>Select an index from the left rail to inspect its chart, breadth, and constituent basket. The heatmap and asset tape below follow that selection.</p>
            </div>
            <div className={styles.filterPill}>
              <span>Indexes visible</span>
              <strong>{fmtInteger(unitOptions.length + 1)}</strong>
            </div>
          </div>
          <div className={styles.indexSplitPane}>
            <div className={styles.indexSelectorPane}>
              {marketIndexes.map((index) => (
                <IndexSelectorCard
                  key={`${index.group_by}:${index.group}`}
                  index={index}
                  assets={assets}
                  selectedUnit={selectedUnit}
                  onSelectUnit={(unit) => {
                    startTransition(() => {
                      setSelectedUnit(unit);
                    });
                  }}
                />
              ))}
            </div>
            {activeIndex ? (
              <IndexDetailPanel
                key={`${activeIndex.group_by}:${activeIndex.group}`}
                index={activeIndex}
                assets={assets}
                indexChartColor={indexChartColor}
                selectedSymbol={selectedSymbol}
                setSelectedSymbol={setSelectedSymbol}
                heatmapAssets={heatmapAssets}
                assetTableRows={assetTableRows}
              />
            ) : null}
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
