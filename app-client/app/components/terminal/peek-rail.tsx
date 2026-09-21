"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, type ReactNode } from "react";
import { FaArrowRight, FaXmark } from "react-icons/fa6";
import { AssetCoin } from "@/app/components/common/asset-coin";
import { SparklineChart } from "@/app/components/charts/market-charts";
import type { MarketAsset, CandlePoint } from "@/app/lib/types";
import styles from "@/app/components/terminal/peek-rail.module.scss";

function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function fmtVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
}

type PeekRailProps = {
  asset: MarketAsset | null;
  candles?: CandlePoint[];
  isOpen: boolean;
  onClose: () => void;
  onBuy?: (symbol: string) => void;
  onSell?: (symbol: string) => void;
  holdingQuantity?: number | null;
  holdingAvgCost?: number | null;
};

export const PeekRail = memo(function PeekRail({
  asset,
  candles = [],
  isOpen,
  onClose,
  onBuy,
  onSell,
  holdingQuantity,
  holdingAvgCost,
}: PeekRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        onClose();
      }
    },
    [isOpen, onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (isOpen && railRef.current) {
      railRef.current.focus();
    }
  }, [isOpen]);

  if (!asset) return null;

  const midPrice = asset.current_mid_price ?? null;
  const bidPrice = asset.current_bid_price ?? null;
  const askPrice = asset.current_ask_price ?? null;
  const priceChange = asset.move_24h_pct ?? null;
  const volume24h = asset.volume_24h ?? null;
  const color = asset.color ?? null;

  const trendTone = priceChange !== null && priceChange !== 0
    ? priceChange > 0
      ? "up"
      : "down"
    : "neutral";

  const hasHolding = holdingQuantity !== null && holdingQuantity !== undefined && holdingQuantity > 0;

  return (
    <div
      ref={railRef}
      className={`${styles.rail} ${isOpen ? styles.railOpen : ""}`}
      role="dialog"
      aria-modal="false"
      aria-label={`${asset.display_name || asset.symbol} quick view`}
      tabIndex={-1}
      style={color ? { "--asset-color": color } as React.CSSProperties : undefined}
    >
      <div className={styles.railHeader}>
        <div className={styles.railAsset}>
          <AssetCoin
            symbol={asset.symbol}
            icon={asset.icon ?? null}
            color={color}
            className={styles.railCoin}
          />
          <div className={styles.railAssetInfo}>
            <span className={styles.railSymbol}>{asset.symbol}</span>
            <span className={styles.railName}>{asset.display_name || asset.symbol}</span>
          </div>
        </div>
        <button
          type="button"
          className={styles.railClose}
          onClick={onClose}
          aria-label="Close quick view"
        >
          <FaXmark />
        </button>
      </div>

      <div className={styles.railPrice}>
        <span className={styles.railPriceLabel}>Mid</span>
        <span className={styles.railPriceValue}>{fmtPrice(midPrice)}</span>
        <span className={`${styles.railPriceChange} ${styles[`tone${trendTone.charAt(0).toUpperCase() + trendTone.slice(1)}`]}`}>
          {fmtPct(priceChange)}
        </span>
      </div>

      <div className={styles.railChart}>
        {candles.length > 1 ? (
          <SparklineChart candles={candles} mode="price" />
        ) : (
          <div className={styles.railChartEmpty}>No chart data</div>
        )}
      </div>

      <div className={styles.railQuotes}>
        <div className={styles.railQuote}>
          <span className={styles.railQuoteLabel}>Bid</span>
          <span className={styles.railQuoteValue}>{fmtPrice(bidPrice)}</span>
        </div>
        <div className={styles.railQuote}>
          <span className={styles.railQuoteLabel}>Ask</span>
          <span className={styles.railQuoteValue}>{fmtPrice(askPrice)}</span>
        </div>
        <div className={styles.railQuote}>
          <span className={styles.railQuoteLabel}>Vol 24H</span>
          <span className={styles.railQuoteValue}>{fmtVolume(volume24h)}</span>
        </div>
      </div>

      {hasHolding && (
        <div className={styles.railHolding}>
          <span className={styles.railHoldingLabel}>Your Position</span>
          <div className={styles.railHoldingRow}>
            <span className={styles.railHoldingQty}>{fmtVolume(holdingQuantity)} shares</span>
            <span className={styles.railHoldingCost}>@ {fmtPrice(holdingAvgCost)} avg</span>
          </div>
        </div>
      )}

      <div className={styles.railActions}>
        <button
          type="button"
          className={`${styles.railButton} ${styles.railButtonBuy}`}
          onClick={() => onBuy?.(asset.symbol)}
        >
          Buy
        </button>
        <button
          type="button"
          className={`${styles.railButton} ${styles.railButtonSell}`}
          onClick={() => onSell?.(asset.symbol)}
          disabled={!hasHolding}
        >
          Sell
        </button>
      </div>

      <Link
        href={`/stocks/${encodeURIComponent(asset.symbol)}`}
        className={styles.railDeskLink}
      >
        <span>Open desk</span>
        <FaArrowRight />
      </Link>
    </div>
  );
});

export default PeekRail;
