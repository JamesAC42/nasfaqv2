"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { API_BASE } from "@/app/lib/config";
import { captureRef } from "@/app/lib/referrals";
import { useAuth } from "@/app/providers/auth-provider";

/**
 * Two small jobs on every page:
 * - keeps a referral code or source tag from the address (?ref=..., lib/referrals.ts) for sign-up;
 * - counts the page for visitors who aren't signed in, with one request to our own API
 *   (POST /api/site/here, api/src/services/visits.js). The request carries the path and, on the
 *   first page, the referring site's host. Ad blockers don't block it, and the API keeps no address.
 */
export function VisitCounter() {
  const pathname = usePathname() || "/";
  const { user, initialized } = useAuth();
  const firstPage = useRef(true);
  const lastCounted = useRef<string | null>(null);

  useEffect(() => {
    captureRef();
  }, [pathname]);

  useEffect(() => {
    if (!initialized || user) return;
    if (lastCounted.current === pathname) return;
    lastCounted.current = pathname;
    let referrer = "";
    if (firstPage.current) {
      firstPage.current = false;
      try {
        referrer = document.referrer ? new URL(document.referrer).origin : "";
      } catch {}
    }
    void fetch(`${API_BASE}/api/site/here`, {
      method: "POST",
      keepalive: true,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname, referrer }),
    }).catch(() => {});
  }, [initialized, user, pathname]);

  return null;
}
