"use client";

import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { BsDashLg } from "react-icons/bs";
import { FaArrowTrendDown, FaArrowTrendUp } from "react-icons/fa6";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { ChannelTickerPill } from "@/app/components/common/channel-ticker-pill";
import { SparklineChart } from "@/app/components/charts/market-charts";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { computeDailyPriceChangePct, computeDailyVolumeChange, getCandleClose } from "@/app/lib/market-metrics";
import type { MarketAsset } from "@/app/lib/types";
import styles from "@/app/components/home/home-sidebar-section.module.scss";

const RECENT_ASSETS_KEY = "nasfaq:app-client:recent-assets";
const MOST_VIEWED_ASSETS_KEY = "nasfaq:app-client:most-viewed-assets";
const MAX_TRACKED_ASSETS = 8;

function parseRecentSymbols(raw: string | null) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === "string").slice(0, MAX_TRACKED_ASSETS);
  } catch {
    return [];
  }
}

function parseMostViewedCounts(raw: string | null) {
  if (!raw) return {} as Record<string, number>;

  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([symbol, count]) => typeof symbol === "string" && typeof count === "number" && Number.isFinite(count) && count > 0)
    );
  } catch {
    return {};
  }
}

function sortCandles(asset: MarketAsset) {
  return [...asset.sparkline_candles]
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)))
    .filter((point) => getCandleClose(point) !== null);
}

function computeDailyPriceChangeAbsolute(asset: MarketAsset) {
  const candles = sortCandles(asset);
  if (candles.length < 2) return null;
  const previousClose = getCandleClose(candles[candles.length - 2]);
  const latestClose = asset.current_mid_price ?? getCandleClose(candles[candles.length - 1]);
  if (previousClose === null || latestClose === null) return null;
  return latestClose - previousClose;
}

function formatSignedPct(value: number | null) {
  if (value === null) return fmtPct(value);
  return value > 0 ? `+${fmtPct(value)}` : fmtPct(value);
}

function formatSignedNumber(value: number | null, prefix?: string) {
  if (value === null) return "—";
  if (value < 0) {
    return `-${prefix ?? ""}${fmtNumber(Math.abs(value))}`;
  }
  return `${value > 0 ? "+" : ""}${prefix ?? ""}${fmtNumber(Math.abs(value))}`;
}

export const MarketSidebar = memo(function MarketSidebar({
  assets,
  onSelectSymbol,
  className,
  showSparklines = true,
  compact = false,
  showSearch = true,
  showTopMovers = true,
  showVolumeLeaders = true,
  showRecentViews = true,
  showMostViewed = true,
}: {
  assets: MarketAsset[];
  onSelectSymbol: (symbol: string) => void;
  className?: string;
  showSparklines?: boolean;
  compact?: boolean;
  showSearch?: boolean;
  showTopMovers?: boolean;
  showVolumeLeaders?: boolean;
  showRecentViews?: boolean;
  showMostViewed?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [recentSymbols, setRecentSymbols] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    return parseRecentSymbols(window.localStorage.getItem(RECENT_ASSETS_KEY));
  });
  const [mostViewedCounts, setMostViewedCounts] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    return parseMostViewedCounts(window.localStorage.getItem(MOST_VIEWED_ASSETS_KEY));
  });

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return assets.slice(0, 8);
    return assets.filter((asset) => {
      const symbol = asset.symbol.toLowerCase();
      const displayName = asset.display_name.toLowerCase();
      const unit = (asset.unit || "").toLowerCase();
      return symbol.includes(normalizedQuery) || displayName.includes(normalizedQuery) || unit.includes(normalizedQuery);
    }).slice(0, 8);
  }, [assets, query]);

  const moverAssets = useMemo(() => {
    return [...assets]
      .sort((a, b) => Math.abs(computeDailyPriceChangePct(b.current_mid_price, b.sparkline_candles) ?? 0) - Math.abs(computeDailyPriceChangePct(a.current_mid_price, a.sparkline_candles) ?? 0))
      .slice(0, 5);
  }, [assets]);

  const trendingAssets = useMemo(() => {
    return [...assets]
      .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
      .slice(0, 5);
  }, [assets]);

  const recentAssets = useMemo(() => {
    const bySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
    return recentSymbols.map((symbol) => bySymbol.get(symbol)).filter((asset): asset is MarketAsset => Boolean(asset));
  }, [assets, recentSymbols]);

  const mostViewedAssets = useMemo(() => {
    const bySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
    return Object.entries(mostViewedCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_TRACKED_ASSETS)
      .map(([symbol]) => bySymbol.get(symbol))
      .filter((asset): asset is MarketAsset => Boolean(asset));
  }, [assets, mostViewedCounts]);

  function rememberAndSelect(symbol: string) {
    setRecentSymbols((current) => {
      const next = [symbol, ...current.filter((item) => item !== symbol)].slice(0, MAX_TRACKED_ASSETS);
      try {
        window.localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    setMostViewedCounts((current) => {
      const next = { ...current, [symbol]: (current[symbol] ?? 0) + 1 };
      try {
        window.localStorage.setItem(MOST_VIEWED_ASSETS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    onSelectSymbol(symbol);
  }

  function assetHref(symbol: string) {
    return `/stocks/${encodeURIComponent(symbol)}`;
  }

  return (
    <aside className={[styles.sidebar, compact ? styles.sidebarCompact : "", className].filter(Boolean).join(" ")}>
      {showSearch ? (
      <section className={[styles.panel, compact ? styles.panelCompact : ""].filter(Boolean).join(" ")}>
        <div>
          <h2 className={styles.title}>Market Search</h2>
          <p className={styles.copy}>Search by symbol, name, or unit.</p>
        </div>
        <input
          className={styles.searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search assets"
          aria-label="Search assets"
        />
        <div className={styles.searchResults}>
          {filteredAssets.map((asset) => (
            <Link
              key={asset.symbol}
              href={assetHref(asset.symbol)}
              className={styles.searchResult}
              onClick={() => rememberAndSelect(asset.symbol)}
            >
              <div className={styles.assetMetaWrap}>
                <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.rowIcon} />
                <div className={styles.assetMeta}>
                  <strong>{asset.symbol}</strong>
                  <span>{asset.display_name}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
      ) : null}

      {showTopMovers ? (
      <section className={[styles.panel, compact ? styles.panelCompact : ""].filter(Boolean).join(" ")}>
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.title}>Top Movers</h2>
            <p className={styles.headerCopy}>Largest one-day price moves across active assets.</p>
          </div>
          <div className={styles.headerMeta}>
            <span className={styles.badge}>24H</span>
          </div>
        </div>
        <div className={styles.assetList}>
          {moverAssets.map((asset) => {
            const priceChangePct = computeDailyPriceChangePct(asset.current_mid_price, asset.sparkline_candles);
            const priceChangeAbsolute = computeDailyPriceChangeAbsolute(asset);
            const TrendIcon = priceChangeAbsolute === null
              ? BsDashLg
              : priceChangeAbsolute > 0
                ? FaArrowTrendUp
                : priceChangeAbsolute < 0
                  ? FaArrowTrendDown
                  : BsDashLg;
            const priceChangeToneClass = priceChangeAbsolute === null
              ? styles.volumeDeltaNeutral
              : priceChangeAbsolute > 0
                ? styles.volumeDeltaUp
                : priceChangeAbsolute < 0
                  ? styles.volumeDeltaDown
                  : styles.volumeDeltaNeutral;

            return (
              <Link
                key={asset.symbol}
                href={assetHref(asset.symbol)}
                className={styles.assetRow}
                onClick={() => rememberAndSelect(asset.symbol)}
              >
                <div className={styles.assetMetaWrap}>
                  <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.rowIcon} />
                  <div className={styles.assetMeta}>
                    <strong>{asset.symbol}</strong>
                    <span>{asset.display_name}</span>
                  </div>
                </div>
                <div className={styles.assetQuote}>
                  <strong>{fmtNumber(asset.current_mid_price, "$")}</strong>
                  <span>{asset.unit || "No unit"}</span>
                </div>
                <div className={styles.volumeDeltaColumn}>
                  <TrendIcon className={`${styles.volumeDeltaIcon} ${priceChangeToneClass}`} />
                  <strong className={`${styles.volumeDeltaAbsolute} ${priceChangeToneClass}`}>
                    {formatSignedNumber(priceChangeAbsolute, "$")}
                  </strong>
                  <span className={`${styles.volumeDeltaPct} ${priceChangeToneClass}`}>
                    {formatSignedPct(priceChangePct)}
                  </span>
                </div>
                {showSparklines ? (
                  <div className={styles.assetSparkline}>
                    <SparklineChart candles={asset.sparkline_candles} />
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>
      ) : null}

      {showVolumeLeaders ? (
      <section className={[styles.panel, compact ? styles.panelCompact : ""].filter(Boolean).join(" ")}>
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.title}>Volume Leaders</h2>
            <p className={styles.headerCopy}>Most heavily traded names by current 24-hour share volume.</p>
          </div>
          <div className={styles.headerMeta}>
            <span className={styles.badge}>Flow</span>
          </div>
        </div>
        <div className={styles.assetList}>
          {trendingAssets.map((asset) => {
            const volumeDelta = computeDailyVolumeChange(asset.volume_24h ?? null, asset.sparkline_candles);
            const volumeDeltaClass = volumeDelta.absolute !== null && volumeDelta.absolute >= 0
              ? styles.volumeDeltaUp
              : styles.volumeDeltaDown;
            return (
              <Link
                key={asset.symbol}
                href={assetHref(asset.symbol)}
                className={styles.assetRow}
                onClick={() => rememberAndSelect(asset.symbol)}
              >
                <div className={styles.assetMetaWrap}>
                  <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.rowIcon} />
                  <div className={styles.assetMeta}>
                    <strong>{asset.symbol}</strong>
                    <span>{asset.display_name}</span>
                  </div>
                </div>
                <div className={styles.assetQuote}>
                  <strong>{fmtNumber(asset.volume_24h)}</strong>
                  <span>shares</span>
                </div>
                <div className={styles.volumeDeltaColumn}>
                  <strong className={`${styles.volumeDeltaAbsolute} ${volumeDeltaClass}`}>
                    {formatSignedNumber(volumeDelta.absolute)}
                  </strong>
                </div>
                {showSparklines ? (
                  <div className={styles.assetSparkline}>
                    <SparklineChart candles={asset.sparkline_candles} />
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>
      ) : null}

      {showRecentViews ? (
      <section className={[styles.panel, compact ? styles.panelCompact : ""].filter(Boolean).join(" ")}>
        <div>
          <h2 className={styles.title}>Recent Views</h2>
        </div>
        {recentAssets.length ? (
          <div className={styles.recentList}>
            {recentAssets.map((asset) => (
              <ChannelTickerPill
                key={asset.symbol}
                className={styles.recentPill}
                compact
                channel={{
                  name: asset.display_name,
                  icon: asset.icon ?? null,
                  symbol: asset.symbol,
                  unit: asset.unit ?? null,
                  youtube_channel_id: asset.youtube_channel_id,
                }}
                onClick={() => rememberAndSelect(asset.symbol)}
              />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>Open a few assets to build a local watch trail.</div>
        )}
      </section>
      ) : null}

      {showMostViewed ? (
      <section className={[styles.panel, compact ? styles.panelCompact : ""].filter(Boolean).join(" ")}>
        <div>
          <h2 className={styles.title}>Most Viewed</h2>
        </div>
        {mostViewedAssets.length ? (
          <div className={styles.recentList}>
            {mostViewedAssets.map((asset) => (
              <ChannelTickerPill
                key={asset.symbol}
                className={styles.recentPill}
                compact
                channel={{
                  name: asset.display_name,
                  icon: asset.icon ?? null,
                  symbol: asset.symbol,
                  unit: asset.unit ?? null,
                  youtube_channel_id: asset.youtube_channel_id,
                }}
                onClick={() => rememberAndSelect(asset.symbol)}
              />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>View counts will appear here after a few visits.</div>
        )}
      </section>
      ) : null}
    </aside>
  );
});
