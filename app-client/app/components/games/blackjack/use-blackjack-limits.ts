"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtNumber } from "@/app/lib/format";
import { fetchBlackjackLimits } from "@/app/lib/games/api";
import type { BlackjackLimits } from "@/app/lib/games/types";

/**
 * The signed-in player's blackjack limits (api/src/services/games/tables/blackjackLimits.js). Call
 * `refresh` after anything that moves them: a bet, a double, a settled hand. The API decides at the
 * bet, so a failed read just keeps what we had.
 */
export function useBlackjackLimits(signedIn: boolean) {
  const [limits, setLimits] = useState<BlackjackLimits | null>(null);
  const refresh = useCallback(() => {
    if (!signedIn) return;
    fetchBlackjackLimits()
      .then(setLimits)
      .catch(() => {
        /* keep what we had */
      });
  }, [signedIn]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { limits: signedIn ? limits : null, refresh };
}

/** Why the player can't bet right now, in a sentence, or null when they can. */
export function blockedText(limits: BlackjackLimits): string | null {
  if (limits.blocked === "net_worth") {
    return `Blackjack is closed while your net worth is under ${fmtNumber(limits.min_net_worth, "$")}. You're at ${fmtNumber(limits.net_worth, "$")}. Build it back on the market and the tables reopen.`;
  }
  if (limits.blocked === "weekly_limit") return "You've hit this week's blackjack limit. The tables reopen Saturday at midnight ET.";
  if (limits.blocked === "daily_limit") return `That's your ${limits.hands_per_day} hands for today. More at midnight ET.`;
  return null;
}

/** "This week: −$3,200 of ±$10,000 · 12 of 50 hands today". */
export function limitsLine(limits: BlackjackLimits): string {
  const net = limits.week_net;
  const signed = net > 0 ? `+${fmtNumber(net, "$")}` : net < 0 ? `−${fmtNumber(-net, "$")}` : "$0";
  return `This week: ${signed} of ±${fmtNumber(limits.weekly_limit, "$")} · ${limits.hands_today} of ${limits.hands_per_day} hands today`;
}

/** Whether a hand with this stake can double without going past the week's limit. */
export function canDoubleWithin(limits: BlackjackLimits | null, stake: number): boolean {
  if (!limits) return true;
  return limits.loss_room >= stake && limits.week_net + stake * 2 <= limits.weekly_limit;
}
