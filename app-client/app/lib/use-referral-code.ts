"use client";

import { useEffect, useState } from "react";
import { fetchReferralSummary } from "@/app/lib/referrals";
import { useAuth } from "@/app/providers/auth-provider";

/** The signed-in player's referral code, for links they share; null while loading or signed out. */
export function useReferralCode() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [found, setFound] = useState<{ userId: number; code: string } | null>(null);
  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    fetchReferralSummary(userId)
      .then((summary) => {
        if (!cancelled) setFound({ userId, code: summary.code });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);
  // Only the signed-in player's own code.
  return userId !== null && found?.userId === userId ? found.code : null;
}
