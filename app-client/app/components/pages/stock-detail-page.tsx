"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AssetDetailSection } from "@/app/components/home/asset-detail-section";
import { SiteShell } from "@/app/components/layout/site-shell";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtNumber } from "@/app/lib/format";
import { normalizeLivestreams } from "@/app/lib/normalizers";
import type { LivestreamItem } from "@/app/lib/types";
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
  const [channelStreams, setChannelStreams] = useState<{ live: LivestreamItem[]; upcoming: LivestreamItem[] }>({
    live: [],
    upcoming: [],
  });
  const [livestreamError, setLivestreamError] = useState<string | null>(null);
  const [isLoadingLivestreams, setIsLoadingLivestreams] = useState(false);

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

  useEffect(() => {
    const channelId = selectedAsset?.youtube_channel_id?.trim();
    if (!channelId) {
      setChannelStreams({ live: [], upcoming: [] });
      setLivestreamError(null);
      setIsLoadingLivestreams(false);
      return;
    }

    let cancelled = false;

    async function fetchLivestreams() {
      setIsLoadingLivestreams(true);
      setLivestreamError(null);
      try {
        const result = await apiFetch<{
          channel_id: string;
          live: Array<Record<string, unknown>>;
          upcoming: Array<Record<string, unknown>>;
        }>(`/api/livestreams/channel/${encodeURIComponent(channelId)}`);
        if (cancelled) return;
        setChannelStreams({
          live: normalizeLivestreams(result.live || []),
          upcoming: normalizeLivestreams(result.upcoming || []),
        });
      } catch (error) {
        if (cancelled) return;
        setChannelStreams({ live: [], upcoming: [] });
        setLivestreamError(String((error as Error).message || error));
      } finally {
        if (!cancelled) {
          setIsLoadingLivestreams(false);
        }
      }
    }

    void fetchLivestreams();
    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.youtube_channel_id]);

  async function refreshAll() {
    await refreshOverview();
    if (selectedAsset?.symbol) {
      await fetchAssetDetail(selectedAsset.symbol);
    }
  }

  function renderStreamItem(stream: LivestreamItem, label: "Live" | "Upcoming") {
    return (
      <Link
        key={stream.id}
        href={stream.url || `/livestreams`}
        className={styles.streamItem}
        target={stream.url ? "_blank" : undefined}
        rel={stream.url ? "noreferrer" : undefined}
      >
        {stream.thumbnail_url ? (
          <img src={stream.thumbnail_url} alt="" className={styles.streamThumb} />
        ) : (
          <div className={styles.streamThumbFallback} />
        )}
        <div className={styles.streamBody}>
          <div className={styles.streamTitle}>{stream.title}</div>
          <div className={styles.streamMeta}>{stream.creator}</div>
          <div className={styles.streamMeta}>
            {label === "Live" ? (
              <>
                <span className={styles.livePill}>LIVE</span>
                <span>{fmtNumber(stream.viewer_count)} viewers</span>
                {stream.started_at ? <span>Started {fmtDate(stream.started_at)}</span> : null}
              </>
            ) : (
              <>
                <span className={styles.upcomingPill}>UPCOMING</span>
                <span>{stream.started_at ? fmtDate(stream.started_at) : "Scheduled time unavailable"}</span>
              </>
            )}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <SiteShell>
      <div className={styles.stack}>
        <section className={styles.hero}>
          <h1 className={styles.title}>{symbol.trim().toUpperCase()}</h1>
          <p className={styles.copy}>
            This asset detail route now owns the stock-specific charts, treasury, recent trades, and trade ticket that previously lived on the homepage.
          </p>
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

        <section className={styles.panel}>
          <div>
            <h2 className={styles.title}>Livestreams</h2>
            <p className={styles.copy}>Current live and scheduled streams for this channel.</p>
          </div>

          {livestreamError ? <div className="statusMessage statusMessageError">Livestream error: {livestreamError}</div> : null}
          {isLoadingLivestreams ? <div className={styles.empty}>Loading livestreams…</div> : null}
          {!isLoadingLivestreams && !livestreamError && channelStreams.live.length === 0 && channelStreams.upcoming.length === 0 ? (
            <div className={styles.empty}>No live or upcoming streams in cache for this channel.</div>
          ) : null}

          {channelStreams.live.length > 0 ? (
            <div className={styles.streamSection}>
              <h3 className={styles.sectionLabel}>Live Now</h3>
              <div className={styles.streamList}>
                {channelStreams.live.map((stream) => renderStreamItem(stream, "Live"))}
              </div>
            </div>
          ) : null}

          {channelStreams.upcoming.length > 0 ? (
            <div className={styles.streamSection}>
              <h3 className={styles.sectionLabel}>Upcoming</h3>
              <div className={styles.streamList}>
                {channelStreams.upcoming.map((stream) => renderStreamItem(stream, "Upcoming"))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </SiteShell>
  );
}
