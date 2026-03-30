"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SparklineChart } from "@/app/components/charts/market-charts";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import type { MarketAsset } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/pages/page-shell.module.scss";

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
    <div className={styles.sparklineCell}>
      <SparklineChart candles={asset.sparkline_candles} />
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

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Stocks</h1>
          <p className={styles.copy}>Market and channel snapshot data are combined here. Click any row to open that asset&apos;s detail page.</p>
        </section>

        {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
        {channelError ? <div className="statusMessage statusMessageError">Channel request error: {channelError}</div> : null}
        {isLoadingOverview ? <div className={styles.panel}>Loading stock data…</div> : null}

        <section className={styles.panel}>
          <div className={styles.tableWrap}>
            <table className={styles.stockTable}>
              <thead>
                <tr>
                  <th>Icon</th>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Trend</th>
                  <th>Mid</th>
                  <th>Fair</th>
                  <th>Medium</th>
                  <th>Premium</th>
                  <th>24H Move</th>
                  <th>24H Volume</th>
                  <th>Subscribers</th>
                  <th>24H % Subscriber Change</th>
                  <th>Views</th>
                  <th>24H % View Change</th>
                  <th>Videos</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => {
                  const channelMetrics = channelMetricsById.get(asset.youtube_channel_id);
                  const href = `/stocks/${encodeURIComponent(asset.symbol)}`;
                  const isSelected = asset.symbol === selectedSymbol;

                  return (
                    <tr
                      key={asset.symbol}
                      className={`${styles.stockRow} ${isSelected ? styles.stockRowSelected : ""}`}
                      onClick={() => {
                        setSelectedSymbol(asset.symbol);
                        router.push(href);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setSelectedSymbol(asset.symbol);
                        router.push(href);
                      }}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${asset.symbol} detail page`}
                    >
                      <td>
                        <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} />
                      </td>
                      <td className={styles.symbolCell}>{asset.symbol}</td>
                      <td>{asset.display_name}</td>
                      <td>{asset.unit || "—"}</td>
                      <td>
                        <SparklineCell asset={asset} />
                      </td>
                      <td>{formatPrice(asset.current_mid_price)}</td>
                      <td>{formatPrice(asset.current_fair_value)}</td>
                      <td>{formatPrice(asset.current_bid_price)}</td>
                      <td>{fmtPct(asset.current_premium_pct)}</td>
                      <td className={(asset.move_24h_pct ?? 0) >= 0 ? styles.positive : styles.negative}>
                        {formatSignedPct(asset.move_24h_pct)}
                      </td>
                      <td>{fmtNumber(asset.volume_24h)}</td>
                      <td>{fmtInteger(channelMetrics?.subscribers)}</td>
                      <td className={(channelMetrics?.subscriberChangePct24h ?? 0) >= 0 ? styles.positive : styles.negative}>
                        {formatSignedPct(channelMetrics?.subscriberChangePct24h)}
                      </td>
                      <td>{fmtInteger(channelMetrics?.views)}</td>
                      <td className={(channelMetrics?.viewChangePct24h ?? 0) >= 0 ? styles.positive : styles.negative}>
                        {formatSignedPct(channelMetrics?.viewChangePct24h)}
                      </td>
                      <td>{fmtInteger(channelMetrics?.videos)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
