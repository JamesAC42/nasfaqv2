"use client";

import { useEffect } from "react";
import { HomeSidebarSection } from "@/app/components/home/home-sidebar-section";
import { MarketReportSection } from "@/app/components/home/market-report-section";
import { NewsSection } from "@/app/components/home/news-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useAuth } from "@/app/providers/auth-provider";
import { useLivestreamStore } from "@/app/stores/livestream-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useNewsStore } from "@/app/stores/news-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/home/home-page.module.scss";

export function HomePage() {
  const { refreshSession } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const report = useMarketStore((state) => state.report);
  const marketStatus = useMarketStore((state) => state.marketStatus);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const error = useMarketStore((state) => state.error);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);

  const livestreamItems = useLivestreamStore((state) => state.items);
  const livestreamError = useLivestreamStore((state) => state.error);
  const fetchLivestreams = useLivestreamStore((state) => state.fetchLivestreams);

  const newsItems = useNewsStore((state) => state.items);
  const newsError = useNewsStore((state) => state.error);
  const fetchNews = useNewsStore((state) => state.fetchNews);

  const fetchPortfolio = useProfileStore((state) => state.fetchPortfolio);
  const clearPortfolio = useProfileStore((state) => state.clearPortfolio);

  useEffect(() => {
    void (async () => {
      const nextUser = await refreshSession();
      await Promise.allSettled([
        refreshOverview(),
        fetchLivestreams(),
        fetchNews(),
      ]);
      if (nextUser) {
        await fetchPortfolio();
      } else {
        clearPortfolio();
      }
    })();
  }, [clearPortfolio, fetchLivestreams, fetchNews, fetchPortfolio, refreshOverview, refreshSession]);

  return (
    <SiteShell>

      {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
      {isLoadingOverview ? <div className={styles.status}>Loading dashboard data…</div> : null}
      {marketStatus && !marketStatus.is_trading_open ? (
        <div className="statusMessage statusMessageWarn">
          <strong>Market closed.</strong> {marketStatus.trading_message || "Daily settlement is in progress."}
          {marketStatus.current_market_date ? ` Market date: ${marketStatus.current_market_date}.` : ""}
        </div>
      ) : null}
      {marketStatus?.last_cycle_error ? (
        <div className="statusMessage statusMessageWarn">
          <strong>Settlement warning.</strong> {marketStatus.last_cycle_error}
        </div>
      ) : null}

      <div className={styles.grid}>
        <NewsSection items={newsItems} assets={assets} error={newsError} />
        <HomeSidebarSection
          assets={assets}
          livestreams={livestreamItems}
          livestreamError={livestreamError}
          onSelectSymbol={setSelectedSymbol}
        />
      </div>
      <MarketReportSection report={report} />
    </SiteShell>
  );
}
