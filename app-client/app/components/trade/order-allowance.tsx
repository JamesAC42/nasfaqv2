"use client";

import { Term } from "@/app/components/common/tip";
import { formatEtTime } from "@/app/lib/market-clock";
import { tickWindowLabel } from "@/app/lib/trade";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/trade/order-allowance.module.scss";

const count = (value: number) => Math.floor(value).toLocaleString("en-US");

/**
 * How many more shares your orders can ask for before the next tick (buys and sells, every stock
 * together): a bar of what's used, plus what the order being typed would take, and a line saying
 * when it resets. `order` is the ticket's share count. Nothing when signed out.
 */
export function OrderAllowanceMeter({ order = 0, compact = false }: { order?: number; compact?: boolean }) {
  const allowance = useProfileStore((state) => state.orderAllowance);
  if (!allowance) return null;
  const { limit, used, remaining } = allowance;
  const over = order > remaining;
  const window = tickWindowLabel(allowance.window);
  const reset = allowance.resetsAt ? `${formatEtTime(new Date(allowance.resetsAt))} ET` : "the next tick";
  const usedPct = Math.min(100, (used / limit) * 100);
  const orderPct = Math.min(100 - usedPct, (Math.min(order, remaining) / limit) * 100);
  const tone = remaining === 0 || over ? "warn" : remaining / limit < 0.2 ? "low" : undefined;
  const note =
    remaining === 0
      ? `All used for the ${window} window. It resets at ${reset}.`
      : over
        ? `This order is ${count(order - remaining)} over. Try ${count(remaining)} or fewer, or wait for the reset at ${reset}.`
        : order > 0
          ? `${count(remaining - order)} left after this order · resets at ${reset}`
          : `${window} window, every stock together · resets at ${reset}`;
  return (
    <div className={`${styles.meter} ${compact ? styles.compact : ""}`} data-tone={tone}>
      <div className={styles.head}>
        <span className={styles.label}>
          <Term k="share-limit">Shares left this tick</Term>
        </span>
        <b>
          {count(remaining)}
          <small> / {count(limit)}</small>
        </b>
      </div>
      <i className={styles.bar} aria-hidden="true">
        <s className={styles.used} style={{ width: `${usedPct}%` }} />
        {order > 0 && remaining > 0 ? <s className={styles.order} style={{ left: `${usedPct}%`, width: `${orderPct}%` }} /> : null}
      </i>
      <span className={styles.note} suppressHydrationWarning>
        {note}
      </span>
    </div>
  );
}
