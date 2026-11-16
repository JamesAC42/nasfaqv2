"use client";

import { FaSnowflake } from "react-icons/fa6";
import { activeBuyback, pctLabel, planOf, useInBuyback } from "@/app/lib/buyback";
import type { MarketAsset } from "@/app/lib/types";
import { useNowEvery } from "@/app/lib/use-now";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/common/buyback-badge.module.scss";

type Size = "xs" | "sm" | "md";

/**
 * The one buyback mark, the same everywhere a stock shows (the buyback-spotlight flag): a frozen
 * blue pill with a snowflake, BUYBACK and today's offer ("BUYBACK 120%"). `compact` drops the word
 * for tight rows ("❄ 120%"). Renders nothing for a stock that isn't in a buyback, or without the flag.
 */
export function BuybackBadge({ symbol, size = "sm", compact = false, className }: { symbol: string; size?: Size; compact?: boolean; className?: string }) {
  const shown = useInBuyback(symbol);
  if (!shown) return null;
  return <Frozen symbol={symbol} size={size} compact={compact} className={className} />;
}

function Frozen({ symbol, size, compact, className }: { symbol: string; size: Size; compact: boolean; className?: string }) {
  const upper = symbol.toUpperCase();
  const asset = useMarketStore((state) => state.assets.find((entry) => entry.symbol === upper) ?? null);
  // The offer steps down once a day; a minute is close enough for a badge.
  const now = useNowEvery(60_000);
  if (!asset || !activeBuyback(asset)) return null;
  return <BuybackPill asset={asset} now={now} size={size} compact={compact} className={className} />;
}

/** The pill itself, for callers that already have the asset and the time. */
export function BuybackPill({ asset, now, size = "sm", compact = false, className }: { asset: MarketAsset; now: number; size?: Size; compact?: boolean; className?: string }) {
  const plan = planOf(asset, now);
  if (!plan) return null;
  if (plan.backUnder) {
    const title = `${asset.symbol}'s extra shares are all sold back: it's still frozen, and reopens at the next Open.`;
    return <BuybackMark pct={null} size={size} compact={compact} className={className} title={title} />;
  }
  const title = `${asset.symbol} is frozen for a buyback: no buys, and the broker pays ${pctLabel(plan.pct)} of the frozen price for the shares still over the max.`;
  return <BuybackMark pct={plan.pct} size={size} compact={compact} className={className} title={title} />;
}

/**
 * The pill's look for a given offer, with no stock behind it (How to play's example). `pct` null:
 * the extra shares are all sold back and it reopens at the next Open ("BUYBACK ENDING").
 */
export function BuybackMark({ pct, size = "sm", compact = false, className, title }: { pct: number | null; size?: Size; compact?: boolean; className?: string; title?: string }) {
  const label = pct === null ? "ending" : pctLabel(pct);
  return (
    <span className={[styles.badge, className].filter(Boolean).join(" ")} data-size={size} data-ending={pct === null ? "" : undefined} title={title} aria-label={pct === null ? "Buyback ending" : `Buyback, broker pays ${label}`}>
      <FaSnowflake aria-hidden className={styles.flake} />
      {compact ? null : <span className={styles.word}>Buyback</span>}
      <span className={styles.pct}>{label}</span>
    </span>
  );
}
