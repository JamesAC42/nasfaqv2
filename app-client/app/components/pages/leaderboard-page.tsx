"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FaArrowTrendDown, FaArrowTrendUp, FaEarthAmericas, FaFlagCheckered, FaRegCalendar, FaTrophy, FaUserGroup, FaUserSlash } from "react-icons/fa6";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SiteShell } from "@/app/components/layout/site-shell";
import { LoadingSpinner } from "@/app/components/common/loading-spinner";
import { fmtDate, fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import { getIconUrl } from "@/app/lib/normalizers";
import type { MarketAsset } from "@/app/lib/types";
import type { LeaderboardEntry, LeaderboardNeighbor, LeaderboardScope, LeaderboardWindow } from "@/app/lib/types";
import { useAuthStore } from "@/app/stores/auth-store";
import { useLeaderboardStore } from "@/app/stores/leaderboard-store";
import { useMarketStore } from "@/app/stores/market-store";
import pageStyles from "@/app/components/pages/page-shell.module.scss";
import styles from "@/app/components/pages/leaderboard-page.module.scss";

const SCOPE_OPTIONS: Array<{
  value: LeaderboardScope;
  label: string;
  icon: typeof FaEarthAmericas;
}> = [
  { value: "global", label: "Global", icon: FaEarthAmericas },
  { value: "friends", label: "Friends", icon: FaUserGroup },
  { value: "rivals", label: "Rivals", icon: FaUserSlash },
];

const WINDOW_OPTIONS: Array<{ value: LeaderboardWindow; label: string }> = [
  { value: "1d", label: "1D" },
  { value: "7d", label: "7D" },
  { value: "all", label: "All Time" },
];

function initialsFor(username: string) {
  return username.trim().slice(0, 2).toUpperCase() || "NA";
}

function scopeThemeClass(scope: LeaderboardScope) {
  if (scope === "friends") return styles.scopeFriends;
  if (scope === "rivals") return styles.scopeRivals;
  return styles.scopeGlobal;
}

function trendTone(changePct: number | null) {
  if (changePct === null) return styles.trendFlat;
  return changePct >= 0 ? pageStyles.positive : pageStyles.negative;
}

function TrendValue({
  changePct,
  changeAbs,
  compact = false,
}: {
  changePct: number | null;
  changeAbs?: number | null;
  compact?: boolean;
}) {
  const TrendIcon = changePct === null ? FaFlagCheckered : changePct >= 0 ? FaArrowTrendUp : FaArrowTrendDown;

  return (
    <div className={`${styles.trendBlock} ${compact ? styles.trendCompact : ""}`.trim()}>
      <strong className={`${styles.trendValue} ${trendTone(changePct)}`.trim()}>
        <TrendIcon aria-hidden="true" />
        <span>{changePct === null ? "No move data" : `${changePct > 0 ? "+" : ""}${fmtPct(changePct)}`}</span>
      </strong>
      {changeAbs !== undefined ? (
        <span className={`${styles.trendSubtext} ${styles.valueMono}`.trim()}>
          {changeAbs === null ? "Absolute move unavailable" : `${changeAbs > 0 ? "+" : ""}${fmtNumber(changeAbs, "$")}`}
        </span>
      ) : null}
    </div>
  );
}

function ExposureMeter({ entry }: { entry: LeaderboardEntry }) {
  const total = Math.max(0, entry.cash_balance + entry.holdings_market_value);
  const investedPct = total > 0 ? Math.max(0, Math.min(100, (entry.holdings_market_value / total) * 100)) : 0;

  return (
    <div className={styles.exposureMeter}>
      <div className={styles.exposureHead}>
        <span>Exposure</span>
        <strong>{investedPct.toFixed(0)}%</strong>
      </div>
      <div className={styles.exposureTrack}>
        <i style={{ width: `${investedPct}%` }} />
      </div>
      <div className={styles.exposureLegend}>
        <span>{fmtNumber(entry.holdings_market_value, "$")} held</span>
        <span>{fmtNumber(entry.cash_balance, "$")} cash</span>
      </div>
    </div>
  );
}

function AssetMetaPill({
  label,
  asset,
  shares,
}: {
  label: string;
  asset: MarketAsset | null;
  shares: number | null;
}) {
  if (!asset) {
    return <span className={styles.podiumMetaFallback}>{label}</span>;
  }

  const isPositive = (asset.move_24h_pct ?? 0) >= 0;

  return (
    <div className={styles.assetMetaRow}>
      <span className={styles.assetMetaLabel}>{label}</span>
      <Link
        href={`/stocks/${encodeURIComponent(asset.symbol)}`}
        className={`${styles.assetMetaPill} ${isPositive ? styles.assetMetaPositive : styles.assetMetaNegative}`.trim()}
      >
        <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.assetMetaCoin} />
        <strong>{asset.symbol}</strong>
        <span className={styles.assetMetaPrice}>{fmtNumber(asset.current_mid_price, "$")}</span>
      </Link>
      {shares !== null ? <span className={styles.assetMetaShares}>x{fmtInteger(Math.round(shares))}</span> : null}
    </div>
  );
}

function AssetPositionCell({
  label,
  asset,
  symbol,
  value,
}: {
  label: string;
  asset: MarketAsset | null;
  symbol: string | null;
  value: string;
}) {
  if (!symbol) return <span className={styles.emptyMetric}>—</span>;

  return (
    <Link href={`/stocks/${encodeURIComponent(symbol)}`} className={styles.tableAssetChip}>
      <AssetCoin symbol={symbol} icon={asset?.icon ?? null} color={asset?.color ?? null} className={styles.tableAssetCoin} />
      <span>
        <strong>{symbol}</strong>
        <em>{label} {value}</em>
      </span>
    </Link>
  );
}

function LeaderboardAvatar({
  username,
  profilePictureUrl,
  profileColor,
  hat,
  className,
}: {
  username: string;
  profilePictureUrl: string | null;
  profileColor: string | null;
  hat: LeaderboardEntry["equipped_hat"];
  className?: string;
}) {
  return (
    <div
      className={`${styles.avatar} ${className || ""}`.trim()}
      style={profileColor ? ({ "--leaderboard-accent": profileColor } as CSSProperties) : undefined}
    >
      {profilePictureUrl ? (
        <img src={profilePictureUrl} alt="" className={styles.avatarImage} />
      ) : (
        initialsFor(username)
      )}
      {hat?.image_url ? (
        <img src={hat.image_url} alt="" className={styles.avatarHat} aria-hidden="true" />
      ) : null}
    </div>
  );
}

function AchievementRow({ entry }: { entry: LeaderboardEntry }) {
  const chips = entry.achievements.length
    ? entry.achievements.slice(0, 3).map((achievement) => ({
        key: achievement.key,
        label: achievement.name,
        color: achievement.badge_color,
      }))
    : entry.badges.slice(0, 3).map((badge) => ({
        key: badge,
        label: badge,
        color: null,
      }));

  return (
    <div className={styles.badgeRow}>
      {entry.streaks.current_streak_days > 0 ? (
        <span className={styles.streakBadge}>🔥 {entry.streaks.current_streak_days}d streak</span>
      ) : null}
      {chips.length ? chips.map((chip) => (
        <span
          key={chip.key}
          className={styles.badge}
          style={chip.color ? ({ "--leaderboard-badge-accent": chip.color } as CSSProperties) : undefined}
        >
          {chip.label}
        </span>
      )) : <span className={styles.badgeMuted}>No badge</span>}
    </div>
  );
}

function LeaderboardIdentity({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className={styles.identity}>
      <LeaderboardAvatar
        username={entry.username}
        profilePictureUrl={entry.profile_picture_url}
        profileColor={entry.profile_color}
        hat={entry.equipped_hat}
      />
      <div className={styles.identityMeta}>
        <Link href={`/profile/${encodeURIComponent(entry.username)}`} className={styles.profileLink}>
          {entry.username}
        </Link>
        <div className={styles.identityFlags}>
          {entry.is_me ? <span className={styles.badge}>You</span> : null}
          {!entry.is_me && entry.is_friend ? <span className={styles.badge}>Friend</span> : null}
          {!entry.is_me && entry.is_rival ? <span className={styles.badge}>Rival</span> : null}
        </div>
      </div>
    </div>
  );
}

function NeighborCard({ meRank, neighbor }: { meRank: number; neighbor: LeaderboardNeighbor }) {
  const isAbove = neighbor.rank < meRank;

  return (
    <div className={styles.neighbor}>
      <LeaderboardAvatar
        username={neighbor.username}
        profilePictureUrl={neighbor.profile_picture_url}
        profileColor={neighbor.profile_color}
        hat={neighbor.equipped_hat}
      />
      <div className={styles.neighborBody}>
        <span className={styles.neighborLabel}>
          {isAbove ? <FaArrowTrendUp aria-hidden="true" /> : <FaArrowTrendDown aria-hidden="true" />}
          <span>{isAbove ? "Above you" : "Below you"}</span>
        </span>
        <strong className={styles.neighborName}>#{neighbor.rank} {neighbor.username}</strong>
        <span className={styles.neighborMeta}>{fmtNumber(neighbor.total_equity, "$")} net worth</span>
      </div>
      <div className={styles.neighborGap}>
        <span className={styles.neighborGapLabel}>{isAbove ? "Need to pass" : "Lead over"}</span>
        <strong>{neighbor.gap_abs === null ? "—" : fmtNumber(Math.abs(neighbor.gap_abs), "$")}</strong>
      </div>
    </div>
  );
}

function PodiumCard({ entry, tone }: { entry: LeaderboardEntry; tone: "gold" | "silver" | "bronze" }) {
  const assets = useMarketStore((state) => state.assets);
  const largestAsset = useMemo(
    () => assets.find((asset) => asset.symbol === entry.largest_position?.symbol) || null,
    [assets, entry.largest_position?.symbol]
  );
  const bestAsset = useMemo(
    () => assets.find((asset) => asset.symbol === entry.best_asset?.symbol) || null,
    [assets, entry.best_asset?.symbol]
  );

  return (
    <article
      className={`${styles.podiumCard} ${styles[tone]}`}
      style={entry.profile_color ? ({ "--podium-user-color": entry.profile_color } as CSSProperties) : undefined}
    >
      <div className={styles.podiumStage}>
        {largestAsset?.icon ? <img src={getIconUrl(largestAsset.icon) || ""} alt="" className={styles.podiumWatermark} /> : null}
        <LeaderboardAvatar
          username={entry.username}
          profilePictureUrl={entry.profile_picture_url}
          profileColor={entry.profile_color}
          hat={entry.equipped_hat}
          className={styles.podiumAvatar}
        />
        <div className={styles.podiumRank}>#{entry.rank}</div>
      </div>
      <div className={styles.podiumInfo}>
        <Link href={`/profile/${encodeURIComponent(entry.username)}`} className={styles.podiumName}>
          {entry.username}
        </Link>
        <strong className={`${styles.podiumValue} ${styles.valueMono}`.trim()}>{fmtNumber(entry.total_equity, "$")}</strong>
        <TrendValue changePct={entry.change_pct} changeAbs={entry.change_abs} compact />
        <ExposureMeter entry={entry} />
        <div className={styles.podiumMeta}>
          <span className={styles.streakBadge}>🔥 {entry.streaks.current_streak_days > 0 ? `${fmtInteger(entry.streaks.current_streak_days)} day streak` : "No streak"}</span>
          <AssetMetaPill
            label="Largest bag"
            asset={largestAsset}
            shares={entry.largest_position?.quantity ?? null}
          />
          <AssetMetaPill
            label="Best pick"
            asset={bestAsset}
            shares={entry.best_asset?.quantity ?? null}
          />
        </div>
        <AchievementRow entry={entry} />
      </div>
    </article>
  );
}

export function LeaderboardPage() {
  const user = useAuthStore((state) => state.user);
  const entries = useLeaderboardStore((state) => state.entries);
  const me = useLeaderboardStore((state) => state.me);
  const stats = useLeaderboardStore((state) => state.stats);
  const pagination = useLeaderboardStore((state) => state.pagination);
  const error = useLeaderboardStore((state) => state.error);
  const isLoading = useLeaderboardStore((state) => state.isLoading);
  const fetchLeaderboard = useLeaderboardStore((state) => state.fetchLeaderboard);
  const assets = useMarketStore((state) => state.assets);
  const isLoadingOverview = useMarketStore((state) => state.isLoadingOverview);
  const refreshOverview = useMarketStore((state) => state.refreshOverview);
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [window, setWindow] = useState<LeaderboardWindow>("1d");

  useEffect(() => {
    void fetchLeaderboard({ scope, window, page: 1, limit: 25 });
  }, [fetchLeaderboard, scope, window]);

  useEffect(() => {
    if (!assets.length && !isLoadingOverview) {
      void refreshOverview();
    }
  }, [assets.length, isLoadingOverview, refreshOverview]);

  const topThree = entries.slice(0, 3);
  const tableRows = entries.slice(3);
  const scopeClassName = scopeThemeClass(scope);
  const assetBySymbol = useMemo(() => {
    const map = new Map<string, MarketAsset>();
    for (const asset of assets) {
      map.set(asset.symbol, asset);
    }
    return map;
  }, [assets]);
  const leader = entries[0] || null;
  const activeCapital = entries.reduce((sum, entry) => sum + entry.total_equity, 0);

  return (
    <SiteShell>
      <div className={`${pageStyles.stack} ${styles.leaderboardPage}`.trim()}>
        <section className={`${pageStyles.hero} ${styles.leaderboardHero}`.trim()}>
          <Image
            src="/celebrity-arrival-hero.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className={styles.heroImage}
            aria-hidden="true"
          />
          <div className={styles.heroHeader}>
            <div className={styles.eyebrow}><FaTrophy aria-hidden="true" /> Community Leaderboards</div>
            <h1 className={pageStyles.title}>Leaderboard</h1>
            <div className={styles.heroMeta}>
              <span><strong>{fmtInteger(stats.user_count)}</strong> tracked users</span>
              <span>Updated <strong>{fmtDate(stats.last_updated_at)}</strong></span>
              {leader ? <span>Desk to beat <strong>{leader.username}</strong> at <strong>{fmtNumber(leader.total_equity, "$")}</strong></span> : null}
            </div>
          </div>
          <div className={styles.marketStatsGrid}>
            <div className={styles.marketStat}>
              <span>Loaded equity</span>
              <strong>{fmtNumber(activeCapital, "$")}</strong>
            </div>
            <div className={styles.marketStat}>
              <span>Top 10 cutoff</span>
              <strong>{stats.cutoff_equity_top_10 !== null ? fmtNumber(stats.cutoff_equity_top_10, "$") : "—"}</strong>
            </div>
            <div className={styles.marketStat}>
              <span>Top 100 cutoff</span>
              <strong>{stats.cutoff_equity_top_100 !== null ? fmtNumber(stats.cutoff_equity_top_100, "$") : "—"}</strong>
            </div>
          </div>
        </section>

        <section className={styles.controlSection}>
          <div className={`${styles.controlRow} ${scopeClassName}`.trim()}>
            <div className={styles.controlGroup}>
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={scope === option.value ? styles.controlActive : styles.controlButton}
                  onClick={() => setScope(option.value)}
                  data-scope={option.value}
                >
                  <option.icon aria-hidden="true" />
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <div className={styles.rangeControl} role="group" aria-label="Leaderboard time range">
              <FaRegCalendar aria-hidden="true" className={styles.rangeIcon} />
              <div className={styles.rangeOptions}>
                {WINDOW_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={window === option.value ? styles.rangeOptionActive : styles.rangeOption}
                    onClick={() => setWindow(option.value)}
                    aria-pressed={window === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {scope !== "global" && !user ? (
            <div className={styles.inlineNotice}>Log in to compare against your {scope} leaderboard.</div>
          ) : null}
        </section>

        {me ? (
        <section className={styles.commandGrid}>
          <div className={`${styles.meCard} ${scopeClassName}`.trim()}>
            <div className={styles.meSummary}>
              <div className={styles.meHeading}>
                <div className={styles.eyebrow}>Your position</div>
                <LeaderboardAvatar
                  username={me.username}
                  profilePictureUrl={me.profile_picture_url}
                  profileColor={me.profile_color}
                  hat={me.equipped_hat}
                  className={styles.meAvatar}
                />
                <div className={styles.meRankSentence}>You are ranked <strong>#{me.rank}</strong> of <strong>{fmtInteger(stats.user_count)}</strong> players</div>
              </div>
              <div className={styles.meMetaGrid}>
                <div className={styles.meStat}>
                  <span className={styles.meStatLabel}>Net worth</span>
                  <strong className={styles.valueMono}>{fmtNumber(me.total_equity, "$")}</strong>
                </div>
                <div className={styles.meStat}>
                  <span className={styles.meStatLabel}>Window move</span>
                  <TrendValue changePct={me.change_pct} changeAbs={me.change_abs} />
                </div>
                <div className={styles.meStat}>
                  <span className={styles.meStatLabel}>Unrealized P/L</span>
                  <strong className={trendTone(me.total_unrealized_pnl)}>{fmtNumber(me.total_unrealized_pnl, "$")}</strong>
                  <span className={styles.meStatSubtle}>{(Math.max(0, me.percentile) * 100).toFixed(1)} percentile</span>
                </div>
                <div className={styles.meStat}>
                  <span className={styles.meStatLabel}>Streak</span>
                  <strong>{me.streaks.current_streak_days}d current</strong>
                  <span className={styles.meStatSubtle}>{me.streaks.longest_streak_days}d best</span>
                </div>
              </div>
            </div>
            <div className={styles.neighbors}>
              <div className={styles.neighborsTitle}>Closest ranks</div>
              {me.neighbors.length ? me.neighbors.map((neighbor) => (
                <NeighborCard key={neighbor.user_id} meRank={me.rank} neighbor={neighbor} />
              )) : <div className={styles.inlineNotice}>No nearby users in this scope yet.</div>}
              <Image
                src="/gura-ticker.png"
                alt=""
                width={250}
                height={205}
                className={styles.neighborTicker}
                aria-hidden="true"
              />
            </div>
          </div>
        </section>
        ) : null}

        {isLoading && !entries.length ? (
          <div className={pageStyles.panel}>
            <LoadingSpinner label="Loading leaderboard" />
          </div>
        ) : null}

        {error && !entries.length ? (
          <div className={pageStyles.panel}>
            <div className={styles.inlineNotice}>
              {error === "unauthenticated" ? "Log in to open this scoped leaderboard." : `Leaderboard unavailable: ${error}`}
            </div>
          </div>
        ) : null}

        {topThree.length ? (
          <section className={styles.podiumSection}>
            <div className={styles.tableHeader}>
              <div>
                <h2 className={styles.sectionTitle}>Top desks</h2>
              </div>
            </div>
            <div className={styles.podiumGrid}>
              {topThree[0] ? <PodiumCard entry={topThree[0]} tone="gold" /> : null}
              {topThree[1] ? <PodiumCard entry={topThree[1]} tone="silver" /> : null}
              {topThree[2] ? <PodiumCard entry={topThree[2]} tone="bronze" /> : null}
            </div>
          </section>
        ) : null}

        <section className={`${pageStyles.panel} ${styles.standingsPanel}`.trim()}>
          <div className={styles.tableHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Standings</h2>
              <p className={styles.sectionCopy}>Current equity decides rank. The selected window controls the move column.</p>
            </div>
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.controlButton}
                onClick={() => void fetchLeaderboard({ scope, window, page: pagination.page - 1, limit: pagination.limit })}
                disabled={!pagination.has_previous_page || isLoading}
              >
                Prev
              </button>
              <span>Page {pagination.page} / {pagination.page_count}</span>
              <button
                type="button"
                className={styles.controlButton}
                onClick={() => void fetchLeaderboard({ scope, window, page: pagination.page + 1, limit: pagination.limit })}
                disabled={!pagination.has_next_page || isLoading}
              >
                Next
              </button>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>User</th>
                  <th>Net Worth</th>
                  <th>Exposure</th>
                  <th>Move</th>
                  <th>Largest Bag</th>
                  <th>Best Pick</th>
                  <th>Badges</th>
                </tr>
              </thead>
              <tbody>
                {(tableRows.length ? tableRows : entries).map((entry) => (
                  <tr key={entry.id} className={entry.is_me ? styles.rowHighlight : undefined}>
                    <td>#{entry.rank}</td>
                    <td><LeaderboardIdentity entry={entry} /></td>
                    <td>
                      <div className={styles.metricCell}>
                        <strong>{fmtNumber(entry.total_equity, "$")}</strong>
                        <span>{fmtNumber(entry.total_unrealized_pnl, "$")} unrealized</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.metricCellWide}>
                        <ExposureMeter entry={entry} />
                      </div>
                    </td>
                    <td>
                      <div className={styles.metricCell}>
                        <TrendValue changePct={entry.change_pct} changeAbs={entry.change_abs} compact />
                      </div>
                    </td>
                    <td>
                      <AssetPositionCell
                        label="bag"
                        symbol={entry.largest_position?.symbol ?? null}
                        asset={entry.largest_position ? assetBySymbol.get(entry.largest_position.symbol) ?? null : null}
                        value={entry.largest_position ? fmtNumber(entry.largest_position.value, "$") : "—"}
                      />
                    </td>
                    <td>
                      <AssetPositionCell
                        label="P/L"
                        symbol={entry.best_asset?.symbol ?? null}
                        asset={entry.best_asset ? assetBySymbol.get(entry.best_asset.symbol) ?? null : null}
                        value={entry.best_asset ? fmtNumber(entry.best_asset.unrealized_pnl, "$") : "—"}
                      />
                    </td>
                    <td>
                      <AchievementRow entry={entry} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
