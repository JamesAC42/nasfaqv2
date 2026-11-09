"use client";

// Referral links and source tags (api/src/services/referrals.js). A visit to any page with ?ref=<value>
// keeps the value in this browser for 30 days (newest first, a few at most), and sign-up sends them
// along. The API decides which is a player's code (a referral) and which is a plain source tag like
// "v1-email". Links that only carry utm_source count as that source.

import { apiFetch } from "@/app/lib/api";

const STORAGE_KEY = "nasfaq:refs";
const KEEP_MS = 30 * 86_400_000;
const MAX_KEPT = 3;
const TAG = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export type RefVia = "link" | "blackjack" | "cards";
export type KeptRef = { ref: string; via: RefVia; at: number };

export type ReferralSettings = { cash: number; credit: number; weekly_cap: number; window_days: number; min_age_hours: number };

export type ReferralJoin = {
  username: string;
  profile_color: string | null;
  profile_picture_url: string | null;
  joined_at: string;
  via: RefVia;
  status: "pending" | "paid" | "refused" | "expired";
  reason: string | null;
  your_share: "waiting" | "paid" | "refused" | null;
  your_share_reason: string | null;
  your_share_retry_at: string | null;
  paid_at: string | null;
};

export type ReferralSummary = {
  code: string;
  path: string;
  settings: ReferralSettings;
  totals: { joined: number; paid: number; paid_this_week: number; cash: number; credit: number };
  joined: ReferralJoin[];
  invited_by: { username: string; status: ReferralJoin["status"]; reason: string | null; cash: number; credit: number; joined_at: string } | null;
};

export const cleanRef = (value: string | null | undefined) => {
  const text = String(value ?? "").trim().toLowerCase();
  return TAG.test(text) ? text : null;
};

/** Which kind of page a link opened: a shared game moment, or anything else. */
function viaOf(pathname: string): RefVia {
  const match = /^\/games\/moments\/(blackjack|cards)\//.exec(pathname);
  return (match?.[1] as RefVia | undefined) ?? "link";
}

/** The refs this browser kept, newest first, without the expired ones. */
export function keptRefs(now = Date.now()): KeptRef[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as KeptRef[];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && cleanRef(entry.ref) && now - Number(entry.at) < KEEP_MS).slice(0, MAX_KEPT) : [];
  } catch {
    return [];
  }
}

function keep(entry: KeptRef) {
  try {
    const rest = keptRefs(entry.at).filter((kept) => kept.ref !== entry.ref);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...rest].slice(0, MAX_KEPT)));
  } catch {}
}

export function forgetRefs() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/**
 * Keeps this page's ?ref= (or, with none, its utm_source), and takes `ref` out of the address bar so
 * it isn't copied along when the page is shared. Returns the value it kept, if any.
 */
export function captureRef() {
  const url = new URL(window.location.href);
  const ref = cleanRef(url.searchParams.get("ref"));
  const source = ref ? null : cleanRef(url.searchParams.get("utm_source"));
  const value = ref ?? source;
  if (value) keep({ ref: value, via: viaOf(url.pathname), at: Date.now() });
  if (url.searchParams.has("ref")) {
    url.searchParams.delete("ref");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return value;
}

let summaryRequest: { userId: number; promise: Promise<ReferralSummary> } | null = null;

/**
 * The signed-in player's referral panel data: one request, shared, and kept per player so another
 * account signing in on the same page never gets the last one's code. `fresh` asks again.
 */
export function fetchReferralSummary(userId: number, fresh = false) {
  if (!summaryRequest || summaryRequest.userId !== userId || fresh) {
    const promise = apiFetch<ReferralSummary>("/api/referrals/me", { cache: "no-store" }).catch((error) => {
      if (summaryRequest?.promise === promise) summaryRequest = null;
      throw error;
    });
    summaryRequest = { userId, promise };
  }
  return summaryRequest.promise;
}

/** The full link for a code on this site. */
export const referralLink = (origin: string, code: string) => `${origin}/?ref=${encodeURIComponent(code)}`;

/** "$250 and 2,500 Credit" */
export function rewardText(settings: Pick<ReferralSettings, "cash" | "credit">) {
  const parts: string[] = [];
  if (settings.cash > 0) parts.push(`$${settings.cash.toLocaleString("en-US")}`);
  if (settings.credit > 0) parts.push(`${settings.credit.toLocaleString("en-US")} Credit`);
  return parts.join(" and ");
}
