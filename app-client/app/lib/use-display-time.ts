"use client";

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { apiFetch } from "@/app/lib/api";
import { browserTimeZone, displayMode, isMarketZone, makeTimeFormat, MARKET_TIME_ZONE, type TimeZoneChoice } from "@/app/lib/display-time.mjs";
import { useFeature, useFeaturesKnown } from "@/app/lib/features";
import { useAuthStore } from "@/app/stores/auth-store";

// How clock times show for this viewer (lib/display-time.mjs has the formatting and the modes).
//
// The pick: a signed-in player's is on their account (GET/PUT /api/settings/display), so it follows
// them to other devices; a signed-out visitor's is in this browser. Either way this browser keeps a
// copy, so the next page load shows the right zone straight away instead of after the API answers.
// Behind the timezone-setting flag: without it every spot shows what it always did.
//
// The server render and hydration always show ET (the server can't know the browser's zone);
// <DisplayTimeSync> in AppProviders switches to the browser's zone right after mount.

export type TimeFormat = ReturnType<typeof makeTimeFormat>;
export type { TimeZoneChoice };

const FLAG = "timezone-setting";
/** This browser's pick: { choice, user } (user null when it was picked signed out). */
const PICK_KEY = "nasfaq.time-zone";
/** "1" while the flag was on for whoever used this browser last, so a reload applies the pick at once. */
const FLAG_KEY = "nasfaq.time-zone.flag";

type State = {
  mounted: boolean;
  browserZone: string;
  flagOn: boolean;
  /** Whether flagOn is the API's answer for this viewer, not just the last visit's. */
  flagKnown: boolean;
  choice: TimeZoneChoice | null;
  /** Whether this viewer has picked (account or browser); null until that's known. */
  answered: boolean | null;
};

const useDisplayStore = create<State>(() => ({
  mounted: false,
  browserZone: MARKET_TIME_ZONE,
  flagOn: false,
  flagKnown: false,
  choice: null,
  answered: null,
}));

const isChoice = (value: unknown): value is TimeZoneChoice => value === "market" || value === "local";

function readPick(): { choice: TimeZoneChoice; user: number | null } | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PICK_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const { choice, user } = parsed as { choice?: unknown; user?: unknown };
    return isChoice(choice) ? { choice, user: typeof user === "number" ? user : null } : null;
  } catch {
    return null;
  }
}

function writePick(choice: TimeZoneChoice, user: number | null) {
  try {
    window.localStorage.setItem(PICK_KEY, JSON.stringify({ choice, user }));
  } catch {}
}

function writeFlag(on: boolean) {
  try {
    if (on) window.localStorage.setItem(FLAG_KEY, "1");
    else window.localStorage.removeItem(FLAG_KEY);
  } catch {}
}

function readFlag() {
  try {
    return window.localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function formatOf(state: Pick<State, "mounted" | "flagOn" | "choice" | "browserZone">) {
  return makeTimeFormat({ mode: displayMode(state), browserZone: state.browserZone });
}

/**
 * The formatter for this viewer: tf.clock(at) is "09:00 ET" or "22:00 JST", tf.format(at, options)
 * takes Intl options. Re-renders when the zone changes (mount, the flag arriving, a new pick).
 */
export function useTimeFormat(): TimeFormat {
  const mounted = useDisplayStore((state) => state.mounted);
  const flagOn = useDisplayStore((state) => state.flagOn);
  const choice = useDisplayStore((state) => state.choice);
  const browserZone = useDisplayStore((state) => state.browserZone);
  return useMemo(() => formatOf({ mounted, flagOn, choice, browserZone }), [mounted, flagOn, choice, browserZone]);
}

/** The formatter as it is right now, for code outside React (chart tick formatters, messages built in a handler). */
export function currentTimeFormat(): TimeFormat {
  return formatOf(useDisplayStore.getState());
}

/** Saves a pick: on the account when signed in (and in this browser either way). Throws if the API refuses. */
async function savePick(choice: TimeZoneChoice) {
  const user = useAuthStore.getState().user;
  const previous = useDisplayStore.getState();
  useDisplayStore.setState({ choice, answered: true });
  writePick(choice, user ? Number(user.id) : null);
  if (!user) return;
  try {
    await apiFetch("/api/settings/display", { method: "PUT", body: JSON.stringify({ display: { time_zone: choice } }) });
  } catch (error) {
    useDisplayStore.setState({ choice: previous.choice, answered: previous.answered });
    if (previous.choice) writePick(previous.choice, Number(user.id));
    throw error;
  }
}

/** For the Display section and the prompt: whether the setting is on for this viewer, the pick, and how to change it. */
export function useTimeZoneSetting() {
  const state = useDisplayStore();
  return {
    /** The flag is on for this viewer (the API said so). */
    available: state.flagOn && state.flagKnown,
    mounted: state.mounted,
    choice: state.choice,
    answered: state.answered,
    browserZone: state.browserZone,
    /** The browser is on New York time already, so the two picks look the same. */
    inMarketZone: isMarketZone(state.browserZone),
    save: savePick,
  };
}

/** Keeps the store in step with the browser, the flag and the account. Rendered once, in AppProviders. */
export function DisplayTimeSync() {
  const flagOn = useFeature(FLAG);
  const flagKnown = useFeaturesKnown();
  const initialized = useAuthStore((state) => state.initialized);
  const userId = useAuthStore((state) => (state.user ? Number(state.user.id) : null));

  // After mount: the browser's zone, and the last visit's pick and flag, so the right zone shows now.
  useEffect(() => {
    const pick = readPick();
    useDisplayStore.setState({ mounted: true, browserZone: browserTimeZone(), flagOn: readFlag(), choice: pick?.choice ?? null });
  }, []);

  // The flag as the API has it for this viewer.
  useEffect(() => {
    if (!flagKnown) return;
    writeFlag(flagOn);
    useDisplayStore.setState({ flagOn, flagKnown: true });
  }, [flagKnown, flagOn]);

  // The pick for this viewer: the account's when signed in, else this browser's.
  useEffect(() => {
    if (!initialized || !flagKnown) return;
    if (!flagOn) {
      useDisplayStore.setState({ answered: null });
      return;
    }
    const pick = readPick();
    if (!userId) {
      useDisplayStore.setState({ choice: pick?.choice ?? null, answered: Boolean(pick) });
      return;
    }
    let cancelled = false;
    useDisplayStore.setState({ answered: null, choice: pick && (pick.user === userId || pick.user === null) ? pick.choice : null });
    apiFetch<{ display?: { time_zone?: unknown } }>("/api/settings/display", { cache: "no-store" })
      .then(async (result) => {
        if (cancelled) return;
        const saved = result.display?.time_zone;
        if (isChoice(saved)) {
          writePick(saved, userId);
          useDisplayStore.setState({ choice: saved, answered: true });
        } else if (pick && pick.user === null) {
          // Picked here while signed out: that answer is theirs, so it goes on the account.
          await savePick(pick.choice).catch(() => {});
        } else {
          useDisplayStore.setState({ choice: null, answered: false });
        }
      })
      .catch(() => {
        // Can't tell: keep showing what this browser had, and don't ask.
        if (!cancelled) useDisplayStore.setState({ answered: null });
      });
    return () => {
      cancelled = true;
    };
  }, [initialized, flagKnown, flagOn, userId]);

  return null;
}
