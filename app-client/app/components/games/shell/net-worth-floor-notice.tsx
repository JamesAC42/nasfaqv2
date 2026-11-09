"use client";

import { fmtNumber } from "@/app/lib/format";
import { useProfileStore } from "@/app/stores/profile-store";

/**
 * Says why games, bets and card buying refuse a player under the net worth floor (api/src/services/sideModeFloor.js),
 * before they try. The API decides; this only explains. The frames that show it load the portfolio.
 */
export function NetWorthFloorNotice({ className }: { className?: string }) {
  const portfolio = useProfileStore((state) => state.portfolio);
  const floor = portfolio?.economy?.side_mode_min_net_worth ?? 0;
  if (!portfolio || !(floor > 0) || portfolio.total_equity >= floor) return null;
  return (
    <p className={`statusMessage statusMessageWarn ${className ?? ""}`} role="status">
      Games, bets and buying cards are closed while your net worth is under {fmtNumber(floor, "$")}. You&apos;re at {fmtNumber(portfolio.total_equity, "$")}. Build it back on the market and they reopen. Free cards and selling your cards still work.
    </p>
  );
}
