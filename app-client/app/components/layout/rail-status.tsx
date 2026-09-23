"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatCountdown, getMarketClock } from "@/app/lib/market-clock";
import { useNow } from "@/app/lib/use-now";
import { useAuth } from "@/app/providers/auth-provider";
import { useMarketStore } from "@/app/stores/market-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/layout/site-shell.module.scss";

const STATE_LABEL: Record<string, { text: string; tone: "open" | "settling" | "closed" }> = {
  open: { text: "OPEN", tone: "open" },
  settling: { text: "SETTLING", tone: "settling" },
  manual_closed: { text: "CLOSED", tone: "closed" },
};

/** Market state pill, New York clock and the countdown to the next tick. */
export function RailStatus({ compact = false }: { compact?: boolean }) {
  const now = useNow();
  const status = useMarketStore((state) => state.marketStatus);
  const clock = now ? getMarketClock(now) : null;
  const state = status ? STATE_LABEL[status.trading_status] : null;

  return (
    <div className={styles.status}>
      {state ? (
        <span className={`${styles.pill} ${styles[`pill_${state.tone}`]}`} title={status?.trading_message ?? undefined}>
          <span className={styles.pillDot} />
          {state.text}
        </span>
      ) : null}
      {!compact ? (
        <span className={styles.clock} suppressHydrationWarning>
          {clock ? `${String(clock.et.hour).padStart(2, "0")}:${String(clock.et.minute).padStart(2, "0")}:${String(clock.et.second).padStart(2, "0")}` : "--:--:--"} ET
        </span>
      ) : null}
      <Link href="/market" className={styles.nextTick} prefetch={false} title="Every stock reprices on the tick">
        {!compact ? <span className={styles.nextWord}>NEXT</span> : null}
        <b>{clock ? clock.nextTick.label.toUpperCase() : "TICK"}</b>
        <b className={styles.countdown}>{clock ? formatCountdown(clock.secondsToNextTick) : "--:--:--"}</b>
      </Link>
    </div>
  );
}

/** Live net worth: cash plus holdings marked at current mids, so it ticks with the tape. */
export function RailWorth() {
  const { user } = useAuth();
  const portfolio = useProfileStore((state) => state.portfolio);
  const assets = useMarketStore((state) => state.assets);

  const equity = useMemo(() => {
    if (!portfolio) return null;
    const mids = new Map(assets.map((asset) => [asset.symbol, asset.current_mid_price]));
    const holdings = portfolio.holdings.reduce((sum, holding) => {
      const mid = mids.get(holding.symbol) ?? holding.current_mid_price;
      return sum + (mid !== null && mid !== undefined ? mid * holding.quantity : holding.market_value);
    }, 0);
    return portfolio.cash_balance + holdings;
  }, [assets, portfolio]);

  if (!user || equity === null) return null;

  return (
    <Link href="/profile" className={styles.worth} prefetch={false}>
      <small>NET WORTH</small>
      <span>${equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </Link>
  );
}
