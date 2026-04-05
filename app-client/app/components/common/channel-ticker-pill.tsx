"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { FaArrowTrendDown, FaArrowTrendUp } from "react-icons/fa6";
import { fmtPct } from "@/app/lib/format";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { computeDailyPriceChangePct } from "@/app/lib/market-metrics";
import type { NewsCharacter } from "@/app/lib/types";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/common/channel-ticker-pill.module.scss";

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function formatSignedPct(value: number | null) {
  if (value === null) return fmtPct(value);
  return value > 0 ? `+${fmtPct(value)}` : fmtPct(value);
}

export function ChannelTickerPill({
  channel,
  onClick,
  tone = "default",
  className,
}: {
  channel: NewsCharacter;
  onClick?: () => void;
  tone?: "default" | "warning";
  className?: string;
}) {
  const assets = useMarketStore((state) => state.assets);
  const normalizedChannelName = normalizeName(channel.name);
  const normalizedChannelId = channel.youtube_channel_id ? normalizeName(channel.youtube_channel_id) : null;
  const normalizedChannelSymbol = channel.symbol ? normalizeName(channel.symbol) : null;
  const asset = assets.find((item) => (
    (normalizedChannelId !== null && normalizeName(item.youtube_channel_id) === normalizedChannelId)
    || (normalizedChannelSymbol !== null && normalizeName(item.symbol) === normalizedChannelSymbol)
    || normalizeName(item.display_name) === normalizedChannelName
    || normalizeName(item.symbol) === normalizedChannelName
  ));
  const changePct = asset ? computeDailyPriceChangePct(asset.current_mid_price, asset.sparkline_candles) : null;
  const label = asset?.symbol || channel.name;
  const changeClassName = changePct === null
    ? styles.change
    : `${styles.change} ${changePct >= 0 ? styles.changeUp : styles.changeDown}`;
  const TrendIcon = changePct === null ? null : changePct >= 0 ? FaArrowTrendUp : FaArrowTrendDown;
  const href = asset ? `/stocks/${encodeURIComponent(asset.symbol)}` : null;
  const pillClassName = [styles.pill, tone === "warning" ? styles.warning : "", className].filter(Boolean).join(" ");
  const pillStyle = (tone === "warning"
    ? {
        "--ticker-pill-accent": "var(--warning)",
        "--ticker-pill-accent-soft": "var(--warning-soft)",
      }
    : undefined) as CSSProperties | undefined;

  const content = (
    <span className={pillClassName} style={pillStyle}>
      <AssetCoin
        symbol={label}
        icon={asset?.icon ?? channel.icon ?? null}
        color={asset?.color ?? null}
        className={styles.iconCoin}
        shape="circle"
      />
      <span className={styles.symbol}>{label}</span>
      <span className={changeClassName}>
        <span>{formatSignedPct(changePct)}</span>
        {TrendIcon ? <TrendIcon className={styles.trendIcon} aria-hidden="true" /> : null}
      </span>
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className={styles.link} onClick={onClick}>
      {content}
    </Link>
  );
}
