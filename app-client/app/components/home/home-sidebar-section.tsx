"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SparklineChart } from "@/app/components/charts/market-charts";
import { fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { getIconUrl } from "@/app/lib/normalizers";
import type { LivestreamItem, MarketAsset } from "@/app/lib/types";
import styles from "@/app/components/home/home-sidebar-section.module.scss";

const RECENT_ASSETS_KEY = "nasfaq:app-client:recent-assets";

export function HomeSidebarSection({
  assets,
  livestreams,
  livestreamError,
  onSelectSymbol,
}: {
  assets: MarketAsset[];
  livestreams: LivestreamItem[];
  livestreamError: string | null;
  onSelectSymbol: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [recentSymbols, setRecentSymbols] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_ASSETS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        setRecentSymbols(parsed.filter((item) => typeof item === "string").slice(0, 8));
      }
    } catch {}
  }, []);

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

  const trendingAssets = useMemo(() => {
    return [...assets]
      .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
      .slice(0, 5);
  }, [assets]);

  const recentAssets = useMemo(() => {
    const bySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
    return recentSymbols.map((symbol) => bySymbol.get(symbol)).filter((asset): asset is MarketAsset => Boolean(asset));
  }, [assets, recentSymbols]);

  const topLivestreams = useMemo(() => {
    return [...livestreams]
      .sort((a, b) => (b.viewer_count ?? 0) - (a.viewer_count ?? 0))
      .slice(0, 5);
  }, [livestreams]);

  function rememberAndSelect(symbol: string) {
    setRecentSymbols((current) => {
      const next = [symbol, ...current.filter((item) => item !== symbol)].slice(0, 8);
      try {
        window.localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    onSelectSymbol(symbol);
  }

  return (
    <aside className={styles.sidebar}>
      <section className={styles.panel}>
        <div>
          <h2 className={styles.title}>Market Search</h2>
          <p className={styles.copy}>Search by symbol, name, or unit and jump the dashboard focus straight to that asset.</p>
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
            <button key={asset.symbol} type="button" className={styles.searchResult} onClick={() => rememberAndSelect(asset.symbol)}>
              <strong>{asset.symbol}</strong>
              <span>{asset.display_name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.headerRow}>
          <h2 className={styles.title}>Top Volume</h2>
          <span className={styles.badge}>24H</span>
        </div>
        <div className={styles.assetList}>
          {trendingAssets.map((asset) => (
            <button key={asset.symbol} type="button" className={styles.assetRow} onClick={() => rememberAndSelect(asset.symbol)}>
              <div className={styles.assetMeta}>
                <strong>{asset.symbol}</strong>
                <span>{asset.display_name}</span>
              </div>
              <div className={styles.assetSparkline}>
                <SparklineChart candles={asset.sparkline_candles} />
              </div>
              <div className={styles.assetQuote}>
                <strong>{fmtNumber(asset.current_mid_price)}</strong>
                <span className={(asset.move_24h_pct ?? 0) >= 0 ? styles.positive : styles.negative}>{fmtPct(asset.move_24h_pct)}</span>
                <span>{fmtInteger(asset.volume_24h)}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.title}>Recently Viewed Assets</h2>
        <div className={styles.recentList}>
          {recentAssets.length ? (
            recentAssets.map((asset) => (
              <button key={asset.symbol} type="button" className={styles.recentPill} onClick={() => rememberAndSelect(asset.symbol)}>
                {asset.symbol}
              </button>
            ))
          ) : (
            <div className={styles.empty}>Selected assets will appear here.</div>
          )}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.headerRow}>
          <h2 className={styles.title}>Top Livestreams</h2>
          <span className={styles.badge}>Live</span>
        </div>
        {livestreamError ? <div className={styles.empty}>Livestream feed unavailable: {livestreamError}</div> : null}
        <div className={styles.streamList}>
          {topLivestreams.map((stream) => (
            <article key={stream.id} className={styles.streamCard}>
              {stream.thumbnail_url ? <img src={stream.thumbnail_url} alt="" className={styles.streamThumb} /> : <div className={styles.streamThumbFallback} />}
              <div className={styles.streamBody}>
                <strong className={styles.streamTitle}>{stream.title}</strong>
                <div className={styles.streamMeta}>
                  {getIconUrl(stream.creator_icon) ? <img src={getIconUrl(stream.creator_icon) || ""} alt="" className={styles.streamIcon} /> : null}
                  <span>{stream.creator}</span>
                </div>
                <div className={styles.streamStats}>
                  <span className={styles.livePill}>LIVE</span>
                  <span className={styles.viewerCount}>{fmtInteger(stream.viewer_count)} viewers</span>
                </div>
              </div>
            </article>
          ))}
        </div>
        <Link href="/livestreams" className={styles.viewAllLink}>
          View all -&gt;
        </Link>
      </section>
    </aside>
  );
}
