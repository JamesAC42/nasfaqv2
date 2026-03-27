"use client";

import Link from "next/link";
import { useEffect } from "react";
import { MarketOverviewSection } from "@/app/components/home/market-overview-section";
import { ChannelOverviewSection } from "@/app/components/home/channel-overview-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useChannelStore } from "@/app/stores/channel-store";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/pages/page-shell.module.scss";

export function StocksPage() {
  const assets = useMarketStore((state) => state.assets);
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol);
  const selectedUnit = useMarketStore((state) => state.selectedUnit);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const error = useMarketStore((state) => state.error);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const setSelectedUnit = useMarketStore((state) => state.setSelectedUnit);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);

  const channels = useChannelStore((state) => state.channels);
  const channelError = useChannelStore((state) => state.error);
  const fetchChannels = useChannelStore((state) => state.fetchChannels);

  useEffect(() => {
    void Promise.allSettled([refreshOverview(), fetchChannels()]);
  }, [fetchChannels, refreshOverview]);

  const unitOptions = Array.from(
    new Set(assets.map((asset) => asset.unit).filter((value): value is string => Boolean(value)))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Stocks</h1>
          <p className={styles.copy}>The full stock table, sparklines, and channel snapshot overview now live here. Use any symbol row to jump to its dedicated detail page.</p>
        </section>

        {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
        {channelError ? <div className="statusMessage statusMessageError">Channel request error: {channelError}</div> : null}
        {isLoadingOverview ? <div className={styles.panel}>Loading stock data…</div> : null}

        <MarketOverviewSection
          assets={assets}
          marketIndexes={[]}
          selectedSymbol={selectedSymbol}
          selectedUnit={selectedUnit}
          unitOptions={unitOptions}
          isLoadingIndex={false}
          onSelectSymbol={setSelectedSymbol}
          onSelectUnit={setSelectedUnit}
          assetHrefBase="/stocks"
          showIndexes={false}
          showHeatmap={false}
        />

        <section className={styles.panel}>
          <div className={styles.cardTitle}>Asset Detail Pages</div>
          <div className={styles.meta}>
            Open a dedicated route for any asset from the table above, or jump directly to{" "}
            {selectedSymbol ? <Link href={`/stocks/${encodeURIComponent(selectedSymbol)}`}>{selectedSymbol}</Link> : "the currently selected symbol"}.
          </div>
        </section>

        <ChannelOverviewSection channels={channels} />
      </div>
    </SiteShell>
  );
}
