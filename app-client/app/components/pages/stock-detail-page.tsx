"use client";

import { useEffect } from "react";
import { AssetDetailSection } from "@/app/components/home/asset-detail-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/pages/page-shell.module.scss";

export function StockDetailPage({ symbol }: { symbol: string }) {
  const { user, refreshSession } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const detail = useMarketStore((state) => state.detail);
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const error = useMarketStore((state) => state.error);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const isLoadingDetail = useMarketStore((state) => state.isLoadingDetail);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const fetchAssetDetail = useMarketStore((state) => state.fetchAssetDetail);

  useEffect(() => {
    void refreshSession();
    void refreshOverview();
  }, [refreshOverview, refreshSession]);

  useEffect(() => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    setSelectedSymbol(normalizedSymbol);
    void fetchAssetDetail(normalizedSymbol);
  }, [fetchAssetDetail, setSelectedSymbol, symbol]);

  const selectedAsset = assets.find((item) => item.symbol.toUpperCase() === symbol.trim().toUpperCase()) || null;

  async function refreshAll() {
    await refreshOverview();
    if (selectedAsset?.symbol) {
      await fetchAssetDetail(selectedAsset.symbol);
    }
  }

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <h1 className={styles.title}>{symbol.trim().toUpperCase()}</h1>
          <p className={styles.copy}>This asset detail route now owns the stock-specific charts, treasury, recent trades, and trade ticket that previously lived on the homepage.</p>
        </section>

        {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
        {isLoadingOverview || isLoadingDetail ? <div className={styles.panel}>Loading asset detail…</div> : null}

        <AssetDetailSection
          asset={selectedAsset}
          detail={detail}
          canTrade={Boolean(user)}
          marketStatus={marketStatus}
          onTradeComplete={refreshAll}
        />
      </div>
    </SiteShell>
  );
}
