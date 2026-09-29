"use client";

import { useMarketStore } from "@/app/stores/market-store";
import styles from "@/app/components/common/trading-paused-banner.module.scss";

/**
 * Shown while an admin has paused trading, with the message they wrote. Follows the market status
 * from the socket, so it appears and clears without a reload. Renders nothing otherwise (the daily
 * settlement's few-minute closure has its own indicators).
 */
export function TradingPausedBanner({ className }: { className?: string }) {
  const status = useMarketStore((state) => state.marketStatus);
  if (status?.trading_status !== "manual_closed") return null;
  return (
    <div className={[styles.banner, className].filter(Boolean).join(" ")} role="status">
      <span className={styles.tag}>
        <i aria-hidden="true" />
        Trading paused
      </span>
      <p className={styles.message}>{status.trading_message || "Trading is paused for maintenance. Back soon."}</p>
      <p className={styles.note}>Queued orders fill once trading resumes. Games and predictions are still on.</p>
    </div>
  );
}
