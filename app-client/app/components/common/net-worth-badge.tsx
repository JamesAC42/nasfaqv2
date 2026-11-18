import type { Worth } from "@/app/components/common/use-net-worth";
import { money } from "@/app/lib/time";
import styles from "@/app/components/common/net-worth-badge.module.scss";

/**
 * A player's place on the net worth leaderboard and their net worth, next to their name: "#12 $1.2M".
 * The top three and the top ten stand out. Nothing for a player who isn't on the board.
 */
export function NetWorthBadge({ worth, className, amountClassName }: { worth: Worth | null | undefined; className?: string; amountClassName?: string }) {
  if (!worth || worth.rank <= 0) return null;
  const tier = worth.rank <= 3 ? styles.top : worth.rank <= 10 ? styles.ten : "";
  return (
    <span className={[styles.badge, tier, className].filter(Boolean).join(" ")} title={`Net worth ${money(worth.total_equity)}`}>
      #{worth.rank.toLocaleString("en-US")} <span className={[styles.amount, amountClassName].filter(Boolean).join(" ")}>{money(worth.total_equity, { compact: true })}</span>
    </span>
  );
}
