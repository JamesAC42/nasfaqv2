"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { FaHeart, FaMagnifyingGlass } from "react-icons/fa6";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { OshiboardPanel } from "@/app/components/oshiboard/oshiboard-panel";
import { apiFetch } from "@/app/lib/api";
import { fmtDate, fmtInteger } from "@/app/lib/format";
import { normalizeOshiboardResponse } from "@/app/lib/normalizers";
import type { MarketAsset, OshiboardResponse } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import pageStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/oshiboard-page.module.scss";

type OshiboardAssetStat = {
  symbol: string;
  memberCount: number;
  lastUpdatedAt: string | null;
};

function sortAssets(assets: MarketAsset[], statsBySymbol: Map<string, OshiboardAssetStat>) {
  return [...assets].sort((a, b) => {
    const aUsers = statsBySymbol.get(a.symbol.toUpperCase())?.memberCount || 0;
    const bUsers = statsBySymbol.get(b.symbol.toUpperCase())?.memberCount || 0;
    if (aUsers !== bUsers) return bUsers - aUsers;
    return a.symbol.localeCompare(b.symbol);
  });
}

export function OshiboardPage() {
  const assets = useMarketStore((state) => state.assets);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [query, setQuery] = useState("");
  const [board, setBoard] = useState<OshiboardResponse | null>(null);
  const [assetStats, setAssetStats] = useState<OshiboardAssetStat[]>([]);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  useEffect(() => {
    if (!assets.length) void refreshOverview();
  }, [assets.length, refreshOverview]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAssetStats() {
      try {
        const result = await apiFetch<{ rows?: Array<Record<string, unknown>> }>("/api/leaderboard/oshiboard-assets");
        if (cancelled) return;
        setAssetStats((result.rows || []).map((row) => ({
          symbol: String(row.symbol || "").toUpperCase(),
          memberCount: Number(row.member_count || 0),
          lastUpdatedAt: row.last_updated_at ? String(row.last_updated_at) : null,
        })));
      } catch {
        if (!cancelled) setAssetStats([]);
      }
    }
    void fetchAssetStats();
    return () => {
      cancelled = true;
    };
  }, []);

  const statsBySymbol = useMemo(() => new Map(assetStats.map((item) => [item.symbol, item])), [assetStats]);
  const maxMemberCount = useMemo(() => Math.max(0, ...assetStats.map((item) => item.memberCount)), [assetStats]);
  const totalOshiboardUsers = useMemo(() => assetStats.reduce((sum, item) => sum + item.memberCount, 0), [assetStats]);
  const lastUpdatedAt = useMemo(() => {
    return assetStats.reduce<string | null>((latest, item) => {
      if (!item.lastUpdatedAt) return latest;
      if (!latest) return item.lastUpdatedAt;
      return new Date(item.lastUpdatedAt).getTime() > new Date(latest).getTime() ? item.lastUpdatedAt : latest;
    }, null);
  }, [assetStats]);
  const sortedAssets = useMemo(() => sortAssets(assets, statsBySymbol), [assets, statsBySymbol]);
  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sortedAssets;
    return sortedAssets.filter((asset) =>
      asset.symbol.toLowerCase().includes(needle) || asset.display_name.toLowerCase().includes(needle)
    );
  }, [query, sortedAssets]);

  useEffect(() => {
    if (selectedSymbol) return;
    const requestedCoin = typeof window === "undefined"
      ? ""
      : String(new URLSearchParams(window.location.search).get("coin") || "").trim().toUpperCase();
    const requestedAsset = requestedCoin ? sortedAssets.find((asset) => asset.symbol.toUpperCase() === requestedCoin) : null;
    if (requestedAsset?.symbol) {
      setSelectedSymbol(requestedAsset.symbol);
    } else if (sortedAssets[0]?.symbol) {
      setSelectedSymbol(sortedAssets[0].symbol);
    }
  }, [selectedSymbol, sortedAssets]);

  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;
    async function fetchBoard() {
      setIsLoadingBoard(true);
      setBoardError(null);
      try {
        const result = await apiFetch<Record<string, unknown>>(`/api/leaderboard/oshiboard/${encodeURIComponent(selectedSymbol)}?limit=100`);
        if (!cancelled) setBoard(normalizeOshiboardResponse(result));
      } catch (error) {
        if (!cancelled) {
          setBoard(null);
          setBoardError(String((error as Error).message || error));
        }
      } finally {
        if (!cancelled) setIsLoadingBoard(false);
      }
    }
    void fetchBoard();
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  return (
    <SiteShell>
      <div className={`${pageStyles.stack} ${styles.page}`.trim()}>
        <section className={styles.hero}>
          <Image
            src="/kotatsu-room-hero.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className={styles.heroImage}
            aria-hidden="true"
          />
          <div className={styles.heroHeader}>
            <span className={styles.eyebrow}><FaHeart aria-hidden="true" /> Community Leaderboards</span>
            <h1>Oshiboard</h1>
            <div className={styles.heroStats}>
              <span><strong>{fmtInteger(assets.length)}</strong> total coins</span>
              <span><strong>{fmtInteger(totalOshiboardUsers)}</strong> oshiboard users</span>
              <span>Updated <strong>{fmtDate(lastUpdatedAt)}</strong></span>
            </div>
          </div>
        </section>

        <div className={styles.splitPane}>
          <aside className={styles.coinPane}>
            <label className={styles.searchBox}>
              <FaMagnifyingGlass aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search coins" />
            </label>
            <div className={styles.coinGrid}>
              {visibleAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  title={`${asset.display_name} (${statsBySymbol.get(asset.symbol.toUpperCase())?.memberCount || 0} board members)`}
                  aria-label={`${asset.display_name} oshiboard`}
                  className={`${styles.coinButton} ${asset.symbol === selectedSymbol ? styles.coinButtonActive : ""}`.trim()}
                  style={{
                    "--coin-brightness": `${50 + ((statsBySymbol.get(asset.symbol.toUpperCase())?.memberCount || 0) / Math.max(1, maxMemberCount)) * 50}%`,
                  } as CSSProperties}
                  onClick={() => setSelectedSymbol(asset.symbol)}
                >
                  <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.coinIcon} shape="circle" />
                </button>
              ))}
              {!isLoadingOverview && !visibleAssets.length ? <div className={styles.emptyCoins}>No matching coins.</div> : null}
            </div>
          </aside>

          <main className={styles.boardPane}>
            <OshiboardPanel
              board={board}
              isLoading={isLoadingBoard}
              error={boardError}
              transitionKey={selectedSymbol}
            />

            <div className={styles.takostandWrap} aria-hidden="true">
              <Image
                src="/takostand.png"
                alt=""
                width={320}
                height={252}
                className={styles.takostandImage}
              />
            </div>
          </main>
        </div>
      </div>
    </SiteShell>
  );
}
