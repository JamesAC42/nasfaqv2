"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaSnowflake } from "react-icons/fa6";
import { n2 } from "@/app/components/trade/trade-ticket";
import { pctLabel, planOf, useBuybackAssets } from "@/app/lib/buyback";
import { yourOfferShares } from "@/app/lib/buyback-plan.mjs";
import { useStoredState } from "@/app/lib/use-stored-state";
import { useNowEvery } from "@/app/lib/use-now";
import { useAuthStore } from "@/app/stores/auth-store";
import { useProfileStore } from "@/app/stores/profile-store";
import styles from "@/app/components/common/site-status-bar.module.scss";
import own from "@/app/components/common/buyback-heads-up.module.scss";

const DISMISSED_KEY = "nasfaq.buyback.dismissed";
const parseDismissed = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * The holders' heads-up (buyback-spotlight), a bar in the site's notice stack under the header: you
 * hold a stock that's frozen for a buyback, here's today's offer, go sell it if you want. Dismissing
 * it lasts until the offer drops (or another of your stocks freezes), then it comes back with the new
 * number. The weekly evaluation's inbox notification already tells holders when one starts; this is
 * for the days after.
 */
export function BuybackHeadsUp() {
  const user = useAuthStore((state) => state.user);
  const holdings = useProfileStore((state) => state.portfolio?.holdings ?? null);
  const frozen = useBuybackAssets();
  const now = useNowEvery(60_000);
  const pathname = usePathname();
  const [dismissed, setDismissed] = useStoredState<string | null>(DISMISSED_KEY, null, { parse: parseDismissed });
  if (!user || !holdings || !frozen.length) return null;

  const mine = frozen
    .map((asset) => {
      const holding = holdings.find((item) => item.symbol.toUpperCase() === asset.symbol);
      const held = holding?.quantity ?? 0;
      // Only holders with shares the offer pays on (not ones bought after the last tick before it).
      const yours = yourOfferShares({ held, eligible: holding?.buyback_offer_shares ?? null });
      const plan = yours > 0 ? planOf(asset, now) : null;
      return plan && !plan.backUnder ? { asset, held, plan } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (!mine.length) return null;
  // Already on the stock's page, where the banner says it all.
  if (mine.length === 1 && pathname?.toUpperCase() === `/STOCKS/${mine[0].asset.symbol}`) return null;
  const key = mine.map((row) => `${row.asset.symbol}@${row.plan.day}`).join(",");
  if (dismissed === key) return null;

  const [first] = mine;
  return (
    <div className={styles.stack}>
      <div className={`${styles.bar} ${own.bar}`} data-tone="info" role="status">
        <span className={styles.tag}>
          <FaSnowflake aria-hidden className={own.flake} /> Buyback
        </span>
        <p className={styles.message}>
          {mine.length === 1 ? (
            <>
              You hold <b>{Math.round(first.held).toLocaleString("en-US")} {first.asset.symbol}</b>, frozen for a buyback. The broker pays <b>{pctLabel(first.plan.pct)}</b> ({n2(first.plan.offer)} a share) for the extra shares
              {first.plan.nextPct !== null ? `, ${pctLabel(first.plan.nextPct)} from tomorrow` : ", its last day"}. Selling early pays best.
            </>
          ) : (
            <>
              {mine.length} of your stocks are frozen for buybacks:{" "}
              {mine.map((row, index) => (
                <span key={row.asset.symbol}>
                  {index ? ", " : ""}
                  <b>{row.asset.symbol}</b> at {pctLabel(row.plan.pct)}
                </span>
              ))}
              . The offers drop every day, so selling early pays best.
            </>
          )}
        </p>
        <div className={styles.actions}>
          <Link href={mine.length === 1 ? `/stocks/${encodeURIComponent(first.asset.symbol)}` : "/stocks?view=buybacks"} className={styles.primary}>
            See the offer{mine.length === 1 ? "" : "s"}
          </Link>
          <button type="button" className={styles.later} onClick={() => setDismissed(key)}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
