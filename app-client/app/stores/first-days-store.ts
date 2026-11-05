"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import type { AuthUser } from "@/app/lib/types";

// The first-days guide for brand-new accounts (api/src/services/firstDays.js): the card on the front
// page and the profile, and the "what happens now" note on early fills. Only accounts made since it
// shipped have first_days_until, so everyone already playing never asks for it.

export type FirstDays = {
  active: boolean;
  until: string | null;
  oshi?: { symbol: string; name: string } | null;
  first_fill?: { at: string; symbol: string } | null;
  first_tick?: { at: string; key: string; symbol: string; move_pct: number | null } | null;
  first_review?: { date: string; net: number } | null;
  cards_claimed?: boolean;
};

/** True while this account is inside its first days (before fetching what it has done). */
export function inFirstDays(user: Pick<AuthUser, "first_days_until"> | null | undefined, now = Date.now()) {
  const until = user?.first_days_until ? Date.parse(user.first_days_until) : NaN;
  return Number.isFinite(until) && until > now;
}

type State = {
  userId: number | null;
  data: FirstDays | null;
  /** Reads the guide for this account; a no-op while a read for the same account is in flight. */
  load: (userId: number) => Promise<void>;
  /** Reads it again (after a fill, a claim, a profile save). */
  refresh: () => Promise<void>;
  dismiss: () => Promise<void>;
  clear: () => void;
};

let inflight: Promise<void> | null = null;

export const useFirstDaysStore = create<State>((set, get) => ({
  userId: null,
  data: null,
  load: async (userId) => {
    if (get().userId === userId && (get().data || inflight)) return;
    set({ userId, data: get().userId === userId ? get().data : null });
    inflight = apiFetch<FirstDays>("/api/auth/me/first-days", { cache: "no-store" })
      .then((data) => {
        if (get().userId === userId) set({ data });
      })
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
    await inflight;
  },
  refresh: async () => {
    const { userId, data } = get();
    if (userId === null || !data?.active) return;
    try {
      const next = await apiFetch<FirstDays>("/api/auth/me/first-days", { cache: "no-store" });
      if (get().userId === userId) set({ data: next });
    } catch {
      /* keep what we had */
    }
  },
  dismiss: async () => {
    const { data } = get();
    if (data) set({ data: { ...data, active: false } });
    try {
      await apiFetch("/api/auth/me/first-days/dismiss", { method: "POST", body: "{}" });
    } catch {
      /* hidden here either way; it comes back next visit if the API missed it */
    }
  },
  clear: () => set({ userId: null, data: null }),
}));
