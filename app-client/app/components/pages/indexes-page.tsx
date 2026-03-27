"use client";

import { useEffect } from "react";
import { MarketOverviewSection } from "@/app/components/home/market-overview-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/pages/page-shell.module.scss";

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

  useEffect(() => {
    void Promise.allSettled([refreshOverview(), fetchMarketIndexes()]);
  }, [fetchMarketIndexes, refreshOverview]);

  const unitOptions = Array.from(
    new Set(assets.map((asset) => asset.unit).filter((value): value is string => Boolean(value)))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Indexes</h1>
          <p className={styles.copy}>Equal-weight market indexes and the heatmap are split out onto their own route so the homepage stays focused on news and reports.</p>
        </section>

        {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
        {isLoadingOverview || isLoadingIndex ? <div className={styles.panel}>Loading index data…</div> : null}

        <MarketOverviewSection
          assets={assets}
          marketIndexes={marketIndexes}
          selectedSymbol={selectedSymbol}
          selectedUnit={selectedUnit}
          unitOptions={unitOptions}
          isLoadingIndex={isLoadingIndex}
          onSelectSymbol={setSelectedSymbol}
          onSelectUnit={setSelectedUnit}
          showAssetTable={false}
        />
      </div>
    </SiteShell>
  );
}
