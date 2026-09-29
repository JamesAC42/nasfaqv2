"use client";

import Link from "next/link";
import { Oshimark } from "@/app/components/common/oshimark";
import { signedPct, toneOf } from "@/app/lib/time";
import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/common/stock-chip.module.scss";

/** Oshimark + ticker + today's move. Links to the stock and shows a peek on hover. */
export function StockChip({ symbol, className }: { symbol: string; className?: string }) {
  const asset = useMarketStore((state) => state.assets.find((entry) => entry.symbol === symbol.toUpperCase()) ?? null);
  const move = asset?.move_24h_pct ?? null;
  return (
    <Link
      href={`/stocks/${encodeURIComponent(symbol)}`}
      prefetch={false}
      className={[styles.chip, className].filter(Boolean).join(" ")}
      data-peek-stock={symbol.toUpperCase()}
    >
      <Oshimark icon={asset?.icon} symbol={symbol} size={14} />
      <b>{symbol.toUpperCase()}</b>
      {asset ? <span className={styles[toneOf(move)]}>{signedPct(move)}</span> : null}
    </Link>
  );
}
