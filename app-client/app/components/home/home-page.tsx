"use client";

import { useEffect } from "react";
import { AssetDetailSection } from "@/app/components/home/asset-detail-section";
import { ChannelOverviewSection } from "@/app/components/home/channel-overview-section";
import { LeaderboardSection } from "@/app/components/home/leaderboard-section";
import { LivestreamSection } from "@/app/components/home/livestream-section";
import { MarketOverviewSection } from "@/app/components/home/market-overview-section";
import { MarketReportSection } from "@/app/components/home/market-report-section";
import { NewsSection } from "@/app/components/home/news-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { useAuth } from "@/app/providers/auth-provider";
import { useChannelStore } from "@/app/stores/channel-store";
import { useLeaderboardStore } from "@/app/stores/leaderboard-store";
import { useLivestreamStore } from "@/app/stores/livestream-store";
import { useMarketStore } from "@/app/stores/market-store";
import { useNewsStore } from "@/app/stores/news-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/home/home-page.module.scss";

export function HomePage() {
  const { user, refreshSession } = useAuth();
  const assets = useMarketStore((state) => state.assets);
  const report = useMarketStore((state) => state.report);
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol);
  const selectedUnit = useMarketStore((state) => state.selectedUnit);
  const detail = useMarketStore((state) => state.detail);
  const marketIndexes = useMarketStore((state) => state.marketIndexes);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const isLoadingIndex = useMarketStore((state) => state.isLoadingIndex);
  const error = useMarketStore((state) => state.error);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const setSelectedUnit = useMarketStore((state) => state.setSelectedUnit);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const fetchMarketIndexes = useMarketStore((state) => state.fetchMarketIndexes);
  const fetchAssetDetail = useMarketStore((state) => state.fetchAssetDetail);

  const channels = useChannelStore((state) => state.channels);
  const fetchChannels = useChannelStore((state) => state.fetchChannels);

  const livestreamItems = useLivestreamStore((state) => state.items);
  const livestreamError = useLivestreamStore((state) => state.error);
  const fetchLivestreams = useLivestreamStore((state) => state.fetchLivestreams);

  const leaderboardEntries = useLeaderboardStore((state) => state.entries);
  const leaderboardError = useLeaderboardStore((state) => state.error);
  const fetchLeaderboard = useLeaderboardStore((state) => state.fetchLeaderboard);

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
        fetchMarketIndexes(),
        fetchChannels(),
        fetchLivestreams(),
        fetchLeaderboard(),
        fetchNews(),
      ]);
      if (nextUser) {
        await fetchPortfolio();
      } else {
        clearPortfolio();
      }
    })();
  }, [clearPortfolio, fetchChannels, fetchLeaderboard, fetchLivestreams, fetchNews, fetchPortfolio, refreshOverview, refreshSession]);

  useEffect(() => {
    if (!selectedSymbol) return;
    void fetchAssetDetail(selectedSymbol);
  }, [fetchAssetDetail, selectedSymbol]);

  const selectedAsset = assets.find((item) => item.symbol === selectedSymbol) || null;
  const unitOptions = Array.from(
    new Set(assets.map((asset) => asset.unit).filter((value): value is string => Boolean(value)))
  ).sort((a, b) => a.localeCompare(b));

  async function refreshAll() {
    await Promise.allSettled([
      refreshOverview(),
      fetchMarketIndexes(),
      fetchChannels(),
      fetchLivestreams(),
      fetchLeaderboard(),
      fetchNews(),
    ]);
    if (selectedSymbol) {
      await fetchAssetDetail(selectedSymbol);
    }
  }

  return (
    <SiteShell>

      {error ? <div className="statusMessage statusMessageError">Request error: {error}</div> : null}
      {isLoadingOverview ? <div className={styles.status}>Loading dashboard data…</div> : null}

      <div className={styles.grid}>
        <NewsSection items={newsItems} error={newsError} />
        <div className={styles.section}>
        </div>
      </div>

      <MarketOverviewSection
        assets={assets}
        marketIndexes={marketIndexes}
        selectedSymbol={selectedSymbol}
        selectedUnit={selectedUnit}
        unitOptions={unitOptions}
        isLoadingIndex={isLoadingIndex}
        onSelectSymbol={setSelectedSymbol}
        onSelectUnit={setSelectedUnit}
      />
      <AssetDetailSection asset={selectedAsset} detail={detail} canTrade={Boolean(user)} onTradeComplete={refreshAll} />

      <MarketReportSection report={report} />
      <ChannelOverviewSection channels={channels} />

      <div className={styles.feedGrid}>
        <LivestreamSection items={livestreamItems} error={livestreamError} />
        <LeaderboardSection entries={leaderboardEntries} error={leaderboardError} />
      </div>
    </SiteShell>
  );
}
