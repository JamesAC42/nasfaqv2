"use client";

import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { onMarketEvent } from "@/app/stores/market-store";
import { useTradeStore } from "@/app/stores/trade-store";

// Which release is live and whether maintenance is on (api/src/services/siteState.js). Read on
// load, when the tab comes back into view and every few minutes; changes also arrive on the market
// socket as `site.status`.

export type Maintenance = {
  /** "draining": a release is going out and new games wait; "on": an admin paused games. */
  state: "off" | "draining" | "on";
  source: string | null;
  message: string | null;
  started_at: string | null;
};

export type SiteState = {
  version: string | null;
  released_at: string | null;
  maintenance: Maintenance;
};

/** This page's release, baked in at build ("sha-<commit>"). Empty in local builds: no refresh notice. */
export const BUILD_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "";

const POLL_MS = 5 * 60_000;
/** A tab out of sight this long picks up a new release by itself (see reloadWhenAway). */
const AWAY_MS = 60_000;

function normalizeSite(value: unknown): SiteState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const m = (raw.maintenance && typeof raw.maintenance === "object" ? raw.maintenance : {}) as Record<string, unknown>;
  const state = m.state === "draining" || m.state === "on" ? m.state : "off";
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    version: text(raw.version),
    released_at: text(raw.released_at),
    maintenance: { state, source: text(m.source), message: text(m.message), started_at: text(m.started_at) },
  };
}

type SiteStore = {
  site: SiteState | null;
  /** The version the server named when this page first asked. A later, different one is a new release. */
  baseline: string | null | undefined;
  /** A release the player waved off with "Later"; the notice comes back for the next one. */
  dismissed: string | null;
  refresh: () => Promise<void>;
  dismiss: () => void;
};

export const useSiteStore = create<SiteStore>((set, get) => ({
  site: null,
  baseline: undefined,
  dismissed: null,
  refresh: async () => {
    try {
      const data = await apiFetch<{ site: unknown }>("/api/site");
      const site = normalizeSite(data.site);
      if (!site) return;
      set((state) => ({ site, baseline: state.baseline === undefined ? site.version : state.baseline }));
    } catch {
      // An API from before /api/site, or a blip: keep what we had.
    }
  },
  dismiss: () => set({ dismissed: get().site?.version ?? null }),
}));

/**
 * The live release, when it's newer than this page. Compared with what the server said when the
 * page loaded (not with clocks), so a page that already runs the new code never nags, and a
 * release that never got announced can't cause a notice that no refresh would clear.
 */
export function newRelease(state: Pick<SiteStore, "site" | "baseline">): string | null {
  const live = state.site?.version;
  if (!BUILD_VERSION || !live || state.baseline === undefined) return null;
  return live !== state.baseline && live !== BUILD_VERSION ? live : null;
}

/** Something half done that a reload would lose: an open trade ticket, a game table, typed text. */
function busy() {
  if (useTradeStore.getState().symbol) return true;
  if (/^\/games\/(blackjack|duel|high-low|ticker-tap)(\/|$)/.test(window.location.pathname)) return true;
  return Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input")).some((field) => {
    if (field instanceof HTMLInputElement && !["text", "search", "number", "email", ""].includes(field.type)) return false;
    return field.value.trim() !== "";
  });
}

let awayTimer: number | null = null;

/** A tab nobody is looking at reloads into the new release after a minute, unless it's busy. */
function reloadWhenAway() {
  if (awayTimer !== null) window.clearTimeout(awayTimer);
  awayTimer = null;
  if (document.visibilityState !== "hidden" || !newRelease(useSiteStore.getState())) return;
  awayTimer = window.setTimeout(() => {
    awayTimer = null;
    if (document.visibilityState === "hidden" && newRelease(useSiteStore.getState()) && !busy()) window.location.reload();
  }, AWAY_MS);
}

let connected = false;

/** Starts following the site state for the life of the page. Safe to call from every mount. */
export function connectSite() {
  if (connected || typeof window === "undefined") return;
  connected = true;
  const { refresh } = useSiteStore.getState();
  void refresh();
  onMarketEvent((payload) => {
    if (payload.type !== "site.status") return;
    const site = normalizeSite(payload.site);
    if (site) useSiteStore.setState((state) => ({ site, baseline: state.baseline === undefined ? site.version : state.baseline }));
  });
  window.setInterval(() => void refresh(), POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
    reloadWhenAway();
  });
  useSiteStore.subscribe((state, prev) => {
    if (newRelease(state) !== newRelease(prev)) reloadWhenAway();
  });
}
