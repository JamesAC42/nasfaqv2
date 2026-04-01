"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HiMiniArrowSmallDown, HiMiniArrowSmallUp, HiOutlineArrowsUpDown } from "react-icons/hi2";
import { SparklineChart } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { OptionPicker } from "@/app/components/common/option-picker";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { computeDailyVolumeChange } from "@/app/lib/market-metrics";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import type { MarketAsset } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import shellStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/stocks-page.module.scss";

type OverviewTimeSeriesPoint = {
  time: string;
  subscriber_count: number | null;
  view_count: number | null;
  video_count: number | null;
};

type OverviewRow = {
  channel: {
    youtube_channel_id: string;
  };
  series: OverviewTimeSeriesPoint[];
};

type ChannelMetrics = {
  subscribers: number | null;
  subscriberChangePct24h: number | null;
  views: number | null;
  viewChangePct24h: number | null;
  videos: number | null;
};

type SortKey =
  | "symbol"
  | "name"
  | "unit"
  | "mid"
  | "fair"
  | "medium"
  | "premium"
  | "move24h"
  | "volume24h"
  | "volumeChange"
  | "subscribers"
  | "subscriberChange"
  | "views"
  | "viewChange"
  | "videos";

type SortDirection = "asc" | "desc";
type PriceMoveFilter = "all" | "positive" | "negative";
type VolumeChangeFilter = "all" | "positive" | "negative";

type DerivedStockRow = {
  asset: MarketAsset;
  channelMetrics: ChannelMetrics | undefined;
  volumeChangePct: number | null;
  href: string;
  isSelected: boolean;
  sortValues: Record<SortKey, number | string | null>;
};

const stringCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const MOBILE_SORT_OPTIONS: Array<{ value: `${SortKey}:${SortDirection}`; label: string }> = [
  { value: "symbol:asc", label: "Symbol A-Z" },
  { value: "symbol:desc", label: "Symbol Z-A" },
  { value: "name:asc", label: "Name A-Z" },
  { value: "name:desc", label: "Name Z-A" },
  { value: "unit:asc", label: "Unit A-Z" },
  { value: "unit:desc", label: "Unit Z-A" },
  { value: "mid:desc", label: "Mid price high-low" },
  { value: "mid:asc", label: "Mid price low-high" },
  { value: "fair:desc", label: "Fair value high-low" },
  { value: "fair:asc", label: "Fair value low-high" },
  { value: "medium:desc", label: "Medium price high-low" },
  { value: "medium:asc", label: "Medium price low-high" },
  { value: "premium:desc", label: "Premium high-low" },
  { value: "premium:asc", label: "Premium low-high" },
  { value: "move24h:desc", label: "24H move high-low" },
  { value: "move24h:asc", label: "24H move low-high" },
  { value: "volume24h:desc", label: "24H volume high-low" },
  { value: "volume24h:asc", label: "24H volume low-high" },
  { value: "volumeChange:desc", label: "Volume change high-low" },
  { value: "volumeChange:asc", label: "Volume change low-high" },
  { value: "subscribers:desc", label: "Subscribers high-low" },
  { value: "subscribers:asc", label: "Subscribers low-high" },
  { value: "subscriberChange:desc", label: "Subscriber change high-low" },
  { value: "subscriberChange:asc", label: "Subscriber change low-high" },
  { value: "views:desc", label: "Views high-low" },
  { value: "views:asc", label: "Views low-high" },
  { value: "viewChange:desc", label: "View change high-low" },
  { value: "viewChange:asc", label: "View change low-high" },
  { value: "videos:desc", label: "Videos high-low" },
  { value: "videos:asc", label: "Videos low-high" },
];

const SORTABLE_COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "symbol", label: "Symbol" },
  { key: "name", label: "Name" },
  { key: "unit", label: "Unit" },
  { key: "mid", label: "Mid" },
  { key: "fair", label: "Fair" },
  { key: "medium", label: "Medium" },
  { key: "premium", label: "Premium" },
  { key: "move24h", label: "24H Move" },
  { key: "volume24h", label: "24H Volume" },
  { key: "volumeChange", label: "Volume Change" },
  { key: "subscribers", label: "Subscribers" },
  { key: "subscriberChange", label: "24H % Subscriber Change" },
  { key: "views", label: "Views" },
  { key: "viewChange", label: "24H % View Change" },
  { key: "videos", label: "Videos" },
];

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${fmtNumber(value)}`;
}

function formatSignedPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function pickLatestPoint(series: OverviewTimeSeriesPoint[]) {
  return [...series]
    .filter((point) => toTimestamp(point.time) !== null)
    .sort((a, b) => (toTimestamp(a.time) ?? 0) - (toTimestamp(b.time) ?? 0))
    .at(-1) || null;
}

function pickPointAtOrBefore(series: OverviewTimeSeriesPoint[], targetMs: number) {
  return [...series]
    .filter((point) => {
      const ts = toTimestamp(point.time);
      return ts !== null && ts <= targetMs;
    })
    .sort((a, b) => (toTimestamp(a.time) ?? 0) - (toTimestamp(b.time) ?? 0))
    .at(-1) || null;
}

function computeChangePct(current: number | null, previous: number | null) {
  if (
    current === null ||
    previous === null ||
    Number.isNaN(current) ||
    Number.isNaN(previous) ||
    previous === 0
  ) {
    return null;
  }
  return (current - previous) / previous;
}

function buildChannelMetricsMap(rows: OverviewRow[]) {
  const result = new Map<string, ChannelMetrics>();

  for (const row of rows) {
    const latest = pickLatestPoint(row.series || []);
    const latestTs = toTimestamp(latest?.time);
    const prior24h = latestTs === null ? null : pickPointAtOrBefore(row.series || [], latestTs - 24 * 60 * 60 * 1000);

    result.set(row.channel.youtube_channel_id, {
      subscribers: latest?.subscriber_count ?? null,
      subscriberChangePct24h: computeChangePct(latest?.subscriber_count ?? null, prior24h?.subscriber_count ?? null),
      views: latest?.view_count ?? null,
      viewChangePct24h: computeChangePct(latest?.view_count ?? null, prior24h?.view_count ?? null),
      videos: latest?.video_count ?? null,
    });
  }

  return result;
}

function SparklineCell({ asset }: { asset: MarketAsset }) {
  return (
    <div className={shellStyles.sparklineCell}>
      <SparklineChart candles={asset.sparkline_candles} />
    </div>
  );
}

function compareNullableNumbers(a: number | null | undefined, b: number | null | undefined) {
  const left = a ?? Number.NEGATIVE_INFINITY;
  const right = b ?? Number.NEGATIVE_INFINITY;
  return left - right;
}

function compareStrings(a: string | null | undefined, b: string | null | undefined) {
  return stringCollator.compare(String(a || ""), String(b || ""));
}

function sortRows(rows: DerivedStockRow[], key: SortKey, direction: SortDirection) {
  const directionFactor = direction === "asc" ? 1 : -1;

  const sorted = [...rows].sort((a, b) => {
    const left = a.sortValues[key];
    const right = b.sortValues[key];
    const baseComparison = typeof left === "string" || typeof right === "string"
      ? compareStrings(String(left ?? ""), String(right ?? ""))
      : compareNullableNumbers(left as number | null | undefined, right as number | null | undefined);

    if (baseComparison !== 0) {
      return baseComparison * directionFactor;
    }

    return stringCollator.compare(a.asset.symbol, b.asset.symbol);
  });

  return sorted;
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return <HiOutlineArrowsUpDown className={styles.sortHint} aria-hidden="true" />;
  }

  return direction === "asc"
    ? <HiMiniArrowSmallUp className={styles.sortHint} aria-hidden="true" />
    : <HiMiniArrowSmallDown className={styles.sortHint} aria-hidden="true" />;
}

function DataItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className={styles.dataItem}>
      <dt className={styles.dataLabel}>{label}</dt>
      <dd
        className={[
          styles.dataValue,
          tone === "positive" ? shellStyles.positive : "",
          tone === "negative" ? shellStyles.negative : "",
        ].filter(Boolean).join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

export function StocksPage() {
  const router = useRouter();
  const assets = useMarketStore((state) => state.assets);
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const error = useMarketStore((state) => state.error);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const [overviewRows, setOverviewRows] = useState<OverviewRow[]>([]);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [unitFilter, setUnitFilter] = useState("all");
  const [priceMoveFilter, setPriceMoveFilter] = useState<PriceMoveFilter>("all");
  const [volumeChangeFilter, setVolumeChangeFilter] = useState<VolumeChangeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [, timeseriesResult] = await Promise.allSettled([
        refreshOverview(),
        apiFetch<OverviewRow[]>("/api/overview/timeseries?days=2&limit=8", { cache: "no-store" }),
      ]);

      if (cancelled) return;

      if (timeseriesResult.status === "fulfilled") {
        setOverviewRows(timeseriesResult.value || []);
        setChannelError(null);
      } else {
        setOverviewRows([]);
        setChannelError(String((timeseriesResult.reason as Error)?.message || timeseriesResult.reason));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshOverview]);

  const channelMetricsById = useMemo(() => buildChannelMetricsMap(overviewRows), [overviewRows]);
  const unitOptions = useMemo(
    () => [
      { value: "all", label: "All units" },
      ...Array.from(new Set(assets.map((asset) => asset.unit).filter((value): value is string => Boolean(value))))
        .sort((a, b) => a.localeCompare(b))
        .map((option) => ({ value: option, label: option })),
    ],
    [assets]
  );
  const priceMoveOptions = useMemo(
    () => [
      { value: "all", label: "All moves" },
      { value: "positive", label: "Positive only" },
      { value: "negative", label: "Negative only" },
    ],
    []
  );
  const volumeChangeOptions = useMemo(
    () => [
      { value: "all", label: "All volume trends" },
      { value: "positive", label: "Rising volume" },
      { value: "negative", label: "Falling volume" },
    ],
    []
  );
  const mobileSortOptions = useMemo(
    () => MOBILE_SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    []
  );

  const rows = useMemo<DerivedStockRow[]>(
    () =>
      assets.map((asset) => ({
        ...(() => {
          const channelMetrics = channelMetricsById.get(asset.youtube_channel_id);
          const volumeChangePct = computeDailyVolumeChange(asset.volume_24h, asset.sparkline_candles).pct;

          return {
            asset,
            channelMetrics,
            volumeChangePct,
            href: `/stocks/${encodeURIComponent(asset.symbol)}`,
            isSelected: asset.symbol === selectedSymbol,
            sortValues: {
              symbol: asset.symbol,
              name: asset.display_name,
              unit: asset.unit ?? "",
              mid: asset.current_mid_price,
              fair: asset.current_fair_value,
              medium: asset.current_bid_price,
              premium: asset.current_premium_pct,
              move24h: asset.move_24h_pct,
              volume24h: asset.volume_24h,
              volumeChange: volumeChangePct,
              subscribers: channelMetrics?.subscribers ?? null,
              subscriberChange: channelMetrics?.subscriberChangePct24h ?? null,
              views: channelMetrics?.views ?? null,
              viewChange: channelMetrics?.viewChangePct24h ?? null,
              videos: channelMetrics?.videos ?? null,
            },
          };
        })(),
      })),
    [assets, channelMetricsById, selectedSymbol]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesUnit = unitFilter === "all" || row.asset.unit === unitFilter;
      const move = row.asset.move_24h_pct;
      const volumeChange = row.volumeChangePct;
      const matchesPriceMove =
        priceMoveFilter === "all" ||
        (priceMoveFilter === "positive" ? (move ?? 0) > 0 : (move ?? 0) < 0);
      const matchesVolumeChange =
        volumeChangeFilter === "all" ||
        (volumeChangeFilter === "positive" ? (volumeChange ?? 0) > 0 : (volumeChange ?? 0) < 0);

      return matchesUnit && matchesPriceMove && matchesVolumeChange;
    });
  }, [priceMoveFilter, rows, unitFilter, volumeChangeFilter]);

  const sortedRows = useMemo(() => sortRows(filteredRows, sortKey, sortDirection), [filteredRows, sortDirection, sortKey]);

  function openRow(row: DerivedStockRow) {
    setSelectedSymbol(row.asset.symbol);
    router.push(row.href);
  }

  function toggleDesktopSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "symbol" || nextKey === "name" || nextKey === "unit" ? "asc" : "desc");
  }

  return (
    <SiteShell>
      <div className={shellStyles.stack}>
        <section className={shellStyles.hero}>
          <h1 className={shellStyles.title}>Stocks</h1>
          <p className={shellStyles.copy}>Click any row to open that asset&apos;s detail page.</p>
        </section>

        {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
        {channelError ? <div className="statusMessage statusMessageError">Channel request error: {channelError}</div> : null}
        {isLoadingOverview ? <div className={shellStyles.panel}>Loading stock data…</div> : null}

        <section className={styles.filtersPanel}>
          <div className={styles.filtersHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Filter Stocks</h2>
              <p className={styles.sectionCopy}>Refine by unit, price direction, and volume direction. Desktop uses header sorting; smaller screens switch to cards with dropdown sorting.</p>
            </div>
            <button
              type="button"
              className={styles.resetButton}
              onClick={() => {
                setUnitFilter("all");
                setPriceMoveFilter("all");
                setVolumeChangeFilter("all");
                setSortKey("symbol");
                setSortDirection("asc");
              }}
            >
              Reset filters
            </button>
          </div>

          <div className={styles.filtersGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Unit</span>
              <OptionPicker
                value={unitFilter}
                options={unitOptions}
                onChange={(nextValue) => {
                  startTransition(() => setUnitFilter(nextValue));
                }}
                placeholder="All units"
                searchable
                searchPlaceholder="Search units"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>24H price change</span>
              <OptionPicker
                value={priceMoveFilter}
                options={priceMoveOptions}
                onChange={(nextValue) => {
                  startTransition(() => setPriceMoveFilter(nextValue as PriceMoveFilter));
                }}
                placeholder="All moves"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Volume change</span>
              <OptionPicker
                value={volumeChangeFilter}
                options={volumeChangeOptions}
                onChange={(nextValue) => {
                  startTransition(() => setVolumeChangeFilter(nextValue as VolumeChangeFilter));
                }}
                placeholder="All volume trends"
              />
            </label>

            <label className={`${styles.field} ${styles.mobileSortField}`}>
              <span className={styles.fieldLabel}>Sort</span>
              <OptionPicker
                value={`${sortKey}:${sortDirection}`}
                options={mobileSortOptions}
                onChange={(nextValue) => {
                  const [nextKey, nextDirection] = nextValue.split(":") as [SortKey, SortDirection];
                  startTransition(() => {
                    setSortKey(nextKey);
                    setSortDirection(nextDirection);
                  });
                }}
                placeholder="Select sort"
                searchable
                searchPlaceholder="Search sort options"
              />
            </label>
          </div>

          <div className={styles.resultsMeta}>
            Showing {sortedRows.length} of {rows.length} coins
          </div>
        </section>

        <section className={shellStyles.panel}>
          <div className={`${shellStyles.tableWrap} ${styles.desktopTable}`}>
            <table className={`${shellStyles.stockTable} ${styles.stockTableCompact}`}>
              <thead>
                <tr>
                  <th>Icon</th>
                  {SORTABLE_COLUMNS.slice(0, 3).map((column) => (
                    <th key={column.key}>
                      <button type="button" className={styles.sortButton} onClick={() => toggleDesktopSort(column.key)}>
                        <span>{column.label}</span>
                        <SortIndicator active={sortKey === column.key} direction={sortDirection} />
                      </button>
                    </th>
                  ))}
                  <th>Trend</th>
                  {SORTABLE_COLUMNS.slice(3).map((column) => (
                    <th key={column.key}>
                      <button type="button" className={styles.sortButton} onClick={() => toggleDesktopSort(column.key)}>
                        <span>{column.label}</span>
                        <SortIndicator active={sortKey === column.key} direction={sortDirection} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const { asset, channelMetrics, isSelected } = row;
                  return (
                    <tr
                      key={asset.symbol}
                      className={`${shellStyles.stockRow} ${isSelected ? shellStyles.stockRowSelected : ""}`}
                      onClick={() => openRow(row)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        openRow(row);
                      }}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${asset.symbol} detail page`}
                    >
                      <td>
                        <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} />
                      </td>
                      <td className={shellStyles.symbolCell}>{asset.symbol}</td>
                      <td>{asset.display_name}</td>
                      <td>{asset.unit || "—"}</td>
                      <td>
                        <SparklineCell asset={asset} />
                      </td>
                      <td>{formatPrice(asset.current_mid_price)}</td>
                      <td>{formatPrice(asset.current_fair_value)}</td>
                      <td>{formatPrice(asset.current_bid_price)}</td>
                      <td>{fmtPct(asset.current_premium_pct)}</td>
                      <td className={(asset.move_24h_pct ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(asset.move_24h_pct)}
                      </td>
                      <td>{fmtNumber(asset.volume_24h)}</td>
                      <td className={(row.volumeChangePct ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(row.volumeChangePct)}
                      </td>
                      <td>{fmtInteger(channelMetrics?.subscribers)}</td>
                      <td className={(channelMetrics?.subscriberChangePct24h ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(channelMetrics?.subscriberChangePct24h)}
                      </td>
                      <td>{fmtInteger(channelMetrics?.views)}</td>
                      <td className={(channelMetrics?.viewChangePct24h ?? 0) >= 0 ? shellStyles.positive : shellStyles.negative}>
                        {formatSignedPct(channelMetrics?.viewChangePct24h)}
                      </td>
                      <td>{fmtInteger(channelMetrics?.videos)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.cardList}>
            {sortedRows.map((row) => {
              const { asset, channelMetrics, isSelected, volumeChangePct } = row;
              const priceTone = (asset.move_24h_pct ?? 0) > 0 ? "positive" : (asset.move_24h_pct ?? 0) < 0 ? "negative" : undefined;
              const volumeTone = (volumeChangePct ?? 0) > 0 ? "positive" : (volumeChangePct ?? 0) < 0 ? "negative" : undefined;
              const subscriberTone =
                (channelMetrics?.subscriberChangePct24h ?? 0) > 0
                  ? "positive"
                  : (channelMetrics?.subscriberChangePct24h ?? 0) < 0
                    ? "negative"
                    : undefined;
              const viewTone =
                (channelMetrics?.viewChangePct24h ?? 0) > 0
                  ? "positive"
                  : (channelMetrics?.viewChangePct24h ?? 0) < 0
                    ? "negative"
                    : undefined;

              return (
                <article
                  key={asset.symbol}
                  className={`${styles.stockCard} ${isSelected ? styles.stockCardSelected : ""}`}
                  onClick={() => openRow(row)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openRow(row);
                  }}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open ${asset.symbol} detail page`}
                >
                  <div className={styles.cardHeader}>
                    <div className={styles.cardIdentity}>
                      <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} />
                      <div className={styles.cardIdentityText}>
                        <div className={styles.cardSymbolRow}>
                          <strong className={styles.cardSymbol}>{asset.symbol}</strong>
                          <span className={styles.cardUnit}>{asset.unit || "—"}</span>
                        </div>
                        <div className={styles.cardName}>{asset.display_name}</div>
                      </div>
                    </div>
                    <div className={styles.cardPriceBlock}>
                      <strong className={styles.cardPrice}>{formatPrice(asset.current_mid_price)}</strong>
                      <span
                        className={[
                          styles.cardDelta,
                          priceTone === "positive" ? shellStyles.positive : "",
                          priceTone === "negative" ? shellStyles.negative : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {formatSignedPct(asset.move_24h_pct)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.cardSparkline}>
                    <SparklineCell asset={asset} />
                  </div>

                  <dl className={styles.dataGrid}>
                    <DataItem label="Fair" value={formatPrice(asset.current_fair_value)} />
                    <DataItem label="Medium" value={formatPrice(asset.current_bid_price)} />
                    <DataItem label="Premium" value={fmtPct(asset.current_premium_pct)} />
                    <DataItem label="24H Volume" value={fmtNumber(asset.volume_24h)} />
                    <DataItem label="Volume Change" value={formatSignedPct(volumeChangePct)} tone={volumeTone} />
                    <DataItem label="Subscribers" value={fmtInteger(channelMetrics?.subscribers)} />
                    <DataItem label="24H Sub Change" value={formatSignedPct(channelMetrics?.subscriberChangePct24h)} tone={subscriberTone} />
                    <DataItem label="Views" value={fmtInteger(channelMetrics?.views)} />
                    <DataItem label="24H View Change" value={formatSignedPct(channelMetrics?.viewChangePct24h)} tone={viewTone} />
                    <DataItem label="Videos" value={fmtInteger(channelMetrics?.videos)} />
                  </dl>
                </article>
              );
            })}
          </div>

          {!sortedRows.length ? <div className={styles.empty}>No stocks matched the current filters.</div> : null}
        </section>
      </div>
    </SiteShell>
  );
}
