"use client";

import Link from "next/link";
import Image from "next/image";
import { startTransition, useDeferredValue, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import {
  FaArrowTrendDown,
  FaArrowTrendUp,
  FaChartLine,
  FaCircleNodes,
  FaLayerGroup,
  FaMoneyBillTrendUp,
  FaPercent,
} from "react-icons/fa6";
import { TrendChartCard } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { computeHeatmapMarketCap } from "@/app/lib/normalizers";
import type { MarketAsset, MarketIndexBundle } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/pages/indexes-page.module.scss";

const INDEX_CHART_MIN_BUCKET = "2025-10-06";

type TreemapRect = {
  asset: MarketAsset;
  x: number;
  y: number;
  width: number;
  height: number;
};

type TreemapItem = {
  asset: MarketAsset;
  value: number;
};

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

function computeSettlementPriceMove(asset: MarketAsset) {
  if (
    asset.current_mid_price !== null &&
    asset.current_mid_price !== undefined &&
    asset.previous_settlement_mid_price !== null &&
    asset.previous_settlement_mid_price !== undefined
  ) {
    return asset.current_mid_price - asset.previous_settlement_mid_price;
  }

  return asset.move_24h_pct;
}

function getHeatmapTileToneClass(asset: MarketAsset) {
  const move = computeSettlementPriceMove(asset);
  if (move === null || move === undefined || Number.isNaN(move) || move === 0) return styles.tileFlat;
  return move > 0 ? styles.tileUp : styles.tileDown;
}

function getIndexGroupValue(index: MarketIndexBundle) {
  return index.group === "all" ? "all" : index.group;
}

function isChartBucketInDisplayRange(bucket: string) {
  return bucket.slice(0, 10) >= INDEX_CHART_MIN_BUCKET;
}

function getTreemapValue(asset: MarketAsset) {
  const value = computeHeatmapMarketCap(asset);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function splitTreemap(items: TreemapItem[], rect: Omit<TreemapRect, "asset">): TreemapRect[] {
  if (!items.length) return [];
  if (items.length === 1) {
    return [{ asset: items[0].asset, ...rect }];
  }

  const total = items.reduce((sum, item) => sum + item.value, 0);
  const target = total / 2;
  let splitIndex = 1;
  let running = 0;

  for (let index = 0; index < items.length - 1; index += 1) {
    const next = running + items[index].value;
    if (Math.abs(target - next) <= Math.abs(target - running) || index === 0) {
      running = next;
      splitIndex = index + 1;
      continue;
    }
    break;
  }

  const firstItems = items.slice(0, splitIndex);
  const secondItems = items.slice(splitIndex);
  const firstTotal = firstItems.reduce((sum, item) => sum + item.value, 0);
  const firstRatio = total > 0 ? firstTotal / total : 0.5;

  if (rect.width >= rect.height) {
    const firstWidth = rect.width * firstRatio;
    return [
      ...splitTreemap(firstItems, { ...rect, width: firstWidth }),
      ...splitTreemap(secondItems, { ...rect, x: rect.x + firstWidth, width: rect.width - firstWidth }),
    ];
  }

  const firstHeight = rect.height * firstRatio;
  return [
    ...splitTreemap(firstItems, { ...rect, height: firstHeight }),
    ...splitTreemap(secondItems, { ...rect, y: rect.y + firstHeight, height: rect.height - firstHeight }),
  ];
}

function buildHeatmapTreemap(assets: MarketAsset[]) {
  const items = assets.map((asset) => ({ asset, value: getTreemapValue(asset) }));
  return splitTreemap(items, { x: 0, y: 0, width: 100, height: 100 });
}

function getHeatmapTileStyle(rect: TreemapRect): CSSProperties {
  return {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
}

function getHeatmapTileSizeClass(rect: TreemapRect) {
  const area = (rect.width * rect.height) / 10000;
  if (area < 0.075) return styles.tileTiny;
  if (area > 0.28) return styles.tileLarge;
  return "";
}

function formatHeatmapShare(rect: TreemapRect) {
  const share = (rect.width * rect.height) / 100;
  if (share >= 10) return `${share.toFixed(0)}%`;
  if (share >= 1) return `${share.toFixed(1)}%`;
  return "<1%";
}

function IndexMemberStack({ index, assets, compact = false }: { index: MarketIndexBundle; assets: MarketAsset[]; compact?: boolean }) {
  const members = assets
    .filter((asset) => index.group === "all" || asset.unit === index.group)
    .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
    .slice(0, compact ? 5 : 9);

  if (!members.length) return null;

  return (
    <div className={compact ? styles.memberStackCompact : styles.memberStack} aria-label="Index constituents">
      {members.map((asset) => (
        <AssetCoin
          key={`${index.group}-${asset.symbol}-${compact ? "compact" : "full"}`}
          symbol={asset.symbol}
          icon={asset.icon ?? null}
          color={asset.color ?? null}
          className={compact ? styles.memberIconCompact : styles.memberIcon}
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
      className={`${styles.selectorCard} ${isSelected ? styles.selectorCardSelected : ""}`}
      onClick={() => onSelectUnit(groupValue)}
      aria-pressed={isSelected}
    >
      <div className={styles.selectorTop}>
        <div>
          <span className={styles.eyebrow}><FaLayerGroup /> {index.weighting} weight</span>
          <h3>{title}</h3>
        </div>
        <div className={`${styles.returnBadge} ${getToneClass(summary?.day_return_pct)}`}>
          {(summary?.day_return_pct ?? 0) >= 0 ? <FaArrowTrendUp /> : <FaArrowTrendDown />}
          <strong>{fmtPct(summary?.day_return_pct)}</strong>
        </div>
      </div>
      <IndexMemberStack index={index} assets={assets} compact />
      <div className={styles.selectorStats}>
        <span>Lvl {fmtNumber(summary?.index_value)}</span>
        <span>{fmtInteger(summary?.constituent_count)} names</span>
      </div>
    </button>
  );
}

function MetricTile({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className={styles.metricTile}>
      <span>{icon}{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function IndexDetailPanel({
  index,
  assets,
  selectedSymbol,
  setSelectedSymbol,
  heatmapAssets,
  assetTableRows,
}: {
  index: MarketIndexBundle;
  assets: MarketAsset[];
  selectedSymbol: string | null;
  setSelectedSymbol: (symbol: string) => void;
  heatmapAssets: MarketAsset[];
  assetTableRows: MarketAsset[];
}) {
  const summary = index.summary;
  const title = formatIndexTitle(index.group);
  const chartValues = index.series
    .filter((point) => isChartBucketInDisplayRange(point.bucket))
    .map((point) => ({ time: point.bucket, value: point.value }));
  const heatmapRects = useMemo(() => buildHeatmapTreemap(heatmapAssets), [heatmapAssets]);

  return (
    <section className={styles.detailPane}>
      <div className={styles.detailHeader}>
        <div>
          <span className={styles.eyebrow}><FaLayerGroup /> Index desk</span>
          <h1>{title}</h1>
          <p>{title === "All Market" ? "Cross-market baseline" : "Unit-level basket"}.</p>
        </div>
        <div className={styles.detailHeaderStats}>
          <div>
            <span>Level</span>
            <strong>{fmtNumber(summary?.index_value)}</strong>
          </div>
          <div>
            <span>Breadth</span>
            <strong>{fmtInteger(summary?.advancers)} / {fmtInteger(summary?.decliners)}</strong>
          </div>
          <div>
            <span>Names</span>
            <strong>{fmtInteger(summary?.constituent_count)}</strong>
          </div>
        </div>
        <div className={`${styles.heroReturn} ${getToneClass(summary?.day_return_pct)}`}>
          {(summary?.day_return_pct ?? 0) >= 0 ? <FaArrowTrendUp /> : <FaArrowTrendDown />}
          <strong>{fmtPct(summary?.day_return_pct)}</strong>
          <span>1D</span>
        </div>
      </div>

      <div className={styles.detailScroll}>
        <div className={styles.topGrid}>
          <div className={styles.chartPanel}>
            <TrendChartCard
              title={`${title} Index`}
              subtitle={`${summary?.market_date || "Latest"} · ${fmtInteger(summary?.constituent_count)} constituents`}
              series={[
                {
                  name: "Index",
                  color: "#5fdeec",
                  kind: "area",
                  values: chartValues,
                },
              ]}
              bare
            />
          </div>
          <div className={styles.sidePanel}>
            <div className={styles.constituentCard}>
              <IndexMemberStack index={index} assets={assets} />
              <p>{fmtInteger(summary?.constituent_count)} indexed channels in this basket.</p>
            </div>
            <MetricTile icon={<FaChartLine />} label="Range" value={fmtPct(summary?.total_return_pct)} tone={getToneClass(summary?.total_return_pct)} />
            <MetricTile icon={<FaMoneyBillTrendUp />} label="Volume" value={fmtNumber(summary?.total_volume_cash, "$")} />
            <MetricTile icon={<FaPercent />} label="Premium" value={fmtPct(summary?.avg_premium_pct)} tone={getToneClass(summary?.avg_premium_pct)} />
          </div>
        </div>

        <div className={styles.marketDesk}>
          <div className={styles.heatmapPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Constituent Heatmap</h2>
                <p>Tile area is each asset&apos;s mid price times 24h volume.</p>
              </div>
            </div>
            <div className={styles.heatmap}>
              {heatmapRects.map((rect) => {
                const { asset } = rect;
                return (
                  <div
                    key={asset.symbol}
                    className={`${styles.heatmapTile} ${getHeatmapTileSizeClass(rect)} ${getHeatmapTileToneClass(asset)}`.trim()}
                    style={getHeatmapTileStyle(rect)}
                    title={`${asset.symbol} ${fmtNumber(asset.current_mid_price, "$")}`}
                  >
                    <AssetCoin
                      symbol={asset.symbol}
                      icon={asset.icon ?? null}
                      color={asset.color ?? null}
                      appearance="plain"
                      className={styles.heatmapSymbolImage}
                    />
                    <span className={styles.heatmapShare}>{formatHeatmapShare(rect)}</span>
                    <span className={styles.heatmapPrice}>{fmtNumber(asset.current_mid_price, "$")}</span>
                    <span className={styles.heatmapSymbol}>{asset.symbol}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.tablePanel}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Asset Tape</h2>
                <p>Scrollable readout for the selected index basket.</p>
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
                  </tr>
                </thead>
                <tbody>
                  {assetTableRows.map((asset) => (
                    <tr key={asset.symbol} className={selectedSymbol === asset.symbol ? styles.selectedRow : undefined}>
                      <td>
                        <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.assetLink} onClick={() => setSelectedSymbol(asset.symbol)}>
                          <AssetCoin symbol={asset.symbol} icon={asset.icon ?? null} color={asset.color ?? null} className={styles.tableCoin} />
                          <span><strong>{asset.symbol}</strong><em>{asset.display_name}</em></span>
                        </Link>
                      </td>
                      <td>{fmtNumber(asset.current_mid_price, "$")}</td>
                      <td className={getToneClass(asset.move_24h_pct)}>{fmtPct(asset.move_24h_pct)}</td>
                      <td className={getToneClass(asset.current_premium_pct)}>{fmtPct(asset.current_premium_pct)}</td>
                      <td>{fmtNumber(asset.volume_24h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.assetTapeMascot} aria-hidden="true">
              <Image src="/subaru.png" alt="" width={411} height={458} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function IndexesPage() {
  const assets = useMarketStore((state) => state.assets);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
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

  useEffect(() => {
    void Promise.allSettled([refreshOverview(), fetchMarketIndexes()]);
  }, [fetchMarketIndexes, refreshOverview]);

  const allMarketIndex = useMemo(
    () => marketIndexes.find((index) => index.group === "all") || marketIndexes[0] || null,
    [marketIndexes]
  );

  const activeIndex = useMemo(() => {
    if (!marketIndexes.length) return null;
    return marketIndexes.find((index) => getIndexGroupValue(index) === selectedUnit) || allMarketIndex || marketIndexes[0] || null;
  }, [allMarketIndex, marketIndexes, selectedUnit]);

  useEffect(() => {
    if (!marketIndexes.length) return;
    if (marketIndexes.some((index) => getIndexGroupValue(index) === selectedUnit)) return;
    const fallbackUnit = getIndexGroupValue(allMarketIndex || marketIndexes[0]);
    startTransition(() => setSelectedUnit(fallbackUnit));
  }, [allMarketIndex, marketIndexes, selectedUnit, setSelectedUnit]);

  const filteredAssets = useMemo(
    () => assets.filter((asset) => deferredSelectedUnit === "all" || asset.unit === deferredSelectedUnit),
    [assets, deferredSelectedUnit]
  );

  const heatmapAssets = useMemo(
    () => [...filteredAssets].sort((a, b) => computeHeatmapMarketCap(b) - computeHeatmapMarketCap(a)).slice(0, 18),
    [filteredAssets]
  );

  const assetTableRows = useMemo(
    () => [...filteredAssets].sort((a, b) => (b.current_mid_price ?? 0) - (a.current_mid_price ?? 0)),
    [filteredAssets]
  );

  return (
    <SiteShell hideFooter hideRibbon>
      <div className={styles.dashboard}>
        <aside className={styles.selectorPane}>
          <div className={styles.selectorHeader}>
            <span className={styles.eyebrow}><FaCircleNodes /> Finance</span>
            <h2>Indexes</h2>
            <p>Select an index to view performance, heatmap, and tape.</p>
          </div>
          {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
          {isLoadingOverview || isLoadingIndex ? <div className={styles.loadingPanel}>Loading indexes…</div> : null}
          <div className={styles.selectorList}>
            {marketIndexes.map((index) => (
              <IndexSelectorCard
                key={`${index.group_by}:${index.group}`}
                index={index}
                assets={assets}
                selectedUnit={selectedUnit}
                onSelectUnit={(unit) => startTransition(() => setSelectedUnit(unit))}
              />
            ))}
          </div>
        </aside>

        {activeIndex ? (
          <IndexDetailPanel
            key={`${activeIndex.group_by}:${activeIndex.group}`}
            index={activeIndex}
            assets={assets}
            selectedSymbol={selectedSymbol}
            setSelectedSymbol={setSelectedSymbol}
            heatmapAssets={heatmapAssets}
            assetTableRows={assetTableRows}
          />
        ) : (
          <section className={styles.detailPane}><div className={styles.loadingPanel}>No index data available.</div></section>
        )}
      </div>
    </SiteShell>
  );
}
