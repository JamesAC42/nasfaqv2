"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { FaArrowTrendDown, FaArrowTrendUp, FaArrowUpRightFromSquare, FaChartPie, FaCoins, FaCrown, FaSackDollar, FaTrophy, FaUsers } from "react-icons/fa6";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { fmtDate, fmtInteger, fmtNumber, fmtPct } from "@/app/lib/format";
import type { OshiboardResponse } from "@/app/lib/types";
import styles from "@/app/components/oshiboard/oshiboard-panel.module.scss";

function initialsFor(username: string) {
  return username.trim().slice(0, 2).toUpperCase() || "NA";
}

function fmtSignedPct(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${fmtPct(value)}`;
}

export function OshiboardPanel({
  board,
  isLoading = false,
  error = null,
  compact = false,
  transitionKey,
}: {
  board: OshiboardResponse | null;
  isLoading?: boolean;
  error?: string | null;
  compact?: boolean;
  transitionKey?: string;
}) {
  const asset = board?.asset || null;
  const leader = board?.entries[0] || null;
  const outstandingShares = Math.max(0, asset?.circulating_supply || 0);
  const boardOutstandingPct = outstandingShares > 0 && board ? board.stats.total_shares / outstandingShares : null;
  const changePct = asset?.current_premium_pct ?? null;
  const TrendIcon = (changePct ?? 0) >= 0 ? FaArrowTrendUp : FaArrowTrendDown;

  return (
    <section
      key={transitionKey || asset?.symbol || "oshiboard"}
      className={`${styles.panel} ${compact ? styles.compact : ""}`.trim()}
      style={asset?.color ? ({ "--oshi-accent": asset.color } as CSSProperties) : undefined}
    >
      {isLoading && !board ? (
        <div className={styles.skeletonStack}>
          <div className={styles.skeletonHero} />
          <div className={styles.skeletonLine} />
          <div className={styles.skeletonLineShort} />
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className={styles.skeletonRow} />)}
        </div>
      ) : error ? (
        <div className={styles.emptyState}>Oshiboard unavailable: {error}</div>
      ) : board && asset ? (
        <>
          <div className={styles.header}>
            <AssetCoin symbol={asset.symbol} icon={asset.icon} color={asset.color} className={styles.heroCoin} shape="circle" />
            <div className={styles.titleBlock}>
              <span className={styles.kicker}>Oshiboard</span>
              <h2>{asset.display_name}</h2>
              <div className={styles.symbolRow}>
                <strong>{asset.symbol}</strong>
                <span className={styles.priceMovePill}>
                  {asset.current_mid_price !== null && asset.current_mid_price !== undefined ? <em>{fmtNumber(asset.current_mid_price, "$")}</em> : null}
                  {changePct !== null && changePct !== undefined ? (
                    <b className={changePct >= 0 ? styles.moveUp : styles.moveDown}>
                      <TrendIcon aria-hidden="true" />
                      {fmtSignedPct(changePct)}
                    </b>
                  ) : null}
                </span>
              </div>
            </div>
            {!compact ? (
              <Link href={`/stocks/${encodeURIComponent(asset.symbol)}`} className={styles.assetLink}>
                <FaArrowUpRightFromSquare aria-hidden="true" />
                <span>Open stock page</span>
              </Link>
            ) : null}
          </div>

          <div className={styles.metricGrid}>
            <div className={styles.metric}>
              <span><FaUsers aria-hidden="true" /> Board Members</span>
              <strong>{fmtInteger(board.stats.member_count)}</strong>
            </div>
            <div className={styles.metric}>
              <span><FaCoins aria-hidden="true" /> Oshi Shares</span>
              <strong>{fmtInteger(Math.round(board.stats.total_shares))}</strong>
            </div>
            <div className={styles.metric}>
              <span><FaSackDollar aria-hidden="true" /> Board Value</span>
              <strong>{fmtNumber(board.stats.total_market_value, "$")}</strong>
            </div>
            <div className={styles.metric}>
              <span><FaChartPie aria-hidden="true" /> Outstanding</span>
              <strong>{boardOutstandingPct === null ? "—" : fmtPct(boardOutstandingPct)}</strong>
            </div>
            <div className={styles.metric}>
              <span><FaTrophy aria-hidden="true" /> Leader</span>
              <strong>{leader?.username || "Open"}</strong>
            </div>
          </div>

          <div className={styles.boardMeta}>
            <span><FaUsers aria-hidden="true" /> Owns and oshis this coin</span>
            <span>Updated {fmtDate(board.stats.last_updated_at)}</span>
          </div>

          <ol className={styles.list}>
            {board.entries.length ? board.entries.map((entry) => {
              const entryOutstandingPct = outstandingShares > 0 ? entry.coin_quantity / outstandingShares : null;
              return (
                <li key={entry.user_id} className={styles.row}>
                  <div className={styles.rank}>
                    {entry.rank <= 3 ? <FaCrown aria-hidden="true" /> : null}
                    <span>#{entry.rank}</span>
                  </div>
                  <Link href={`/profile/${encodeURIComponent(entry.username)}`} className={styles.identity}>
                    <span
                      className={styles.avatar}
                      style={entry.profile_color ? ({ "--oshi-user": entry.profile_color } as CSSProperties) : undefined}
                    >
                      {entry.profile_picture_url ? <img src={entry.profile_picture_url} alt="" /> : initialsFor(entry.username)}
                    </span>
                    <span>
                      <strong>{entry.username}</strong>
                      <em>{fmtNumber(entry.total_equity, "$")} net worth</em>
                    </span>
                  </Link>
                  <div className={styles.shares}>
                    <strong>{fmtInteger(Math.round(entry.coin_quantity))}</strong>
                    <span>{fmtNumber(entry.coin_market_value, "$")}</span>
                    <em>{entryOutstandingPct === null ? "—" : fmtPct(entryOutstandingPct)} outstanding</em>
                  </div>
                </li>
              );
            }) : (
              <li className={styles.emptyState}>No eligible holders yet. A user must own this as their largest share quantity and set it as their oshicoin.</li>
            )}
          </ol>
        </>
      ) : (
        <div className={styles.emptyState}>Select a coin to open its oshiboard.</div>
      )}
    </section>
  );
}
