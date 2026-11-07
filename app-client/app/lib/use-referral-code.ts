"use client";

import { useEffect, useState } from "react";
import { useFeature } from "@/app/lib/features";
import { fetchReferralSummary } from "@/app/lib/referrals";
import { useAuth } from "@/app/providers/auth-provider";

/**
 * The signed-in player's referral code, for links they share; null while loading, signed out, or
 * while the `referrals` flag is off for them (the API has no code for them then either).
 */
export function useReferralCode() {
  const { user } = useAuth();
  const enabled = useFeature("referrals");
  const userId = user?.id ?? null;
  const [found, setFound] = useState<{ userId: number; code: string } | null>(null);
  useEffect(() => {
    if (userId === null || !enabled) return;
    let cancelled = false;
    fetchReferralSummary(userId)
      .then((summary) => {
        if (!cancelled) setFound({ userId, code: summary.code });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, enabled]);
  // Only the signed-in player's own code.
  return enabled && userId !== null && found?.userId === userId ? found.code : null;
}
