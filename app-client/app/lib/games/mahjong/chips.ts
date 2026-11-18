import { fmtInteger } from "@/app/lib/format";

/** Net chips with a sign: "+1,000", "−500", "0". */
export function fmtChips(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value > 0 ? `+${fmtInteger(value)}` : `−${fmtInteger(-value)}`;
}

/** Chips for each place, "+1,000 / +100 / −500 / −1,000". */
export const chipsLine = (chips: readonly number[]) => chips.map(fmtChips).join(" / ");

// A local marker for "this browser has dealt itself a hand", so a signed-out visitor who has already
// played stops being led with the first-hand card. Every access is in try/catch: private windows and
// blocked storage throw.
const PLAYED_KEY = "nasfaq.mahjong.played";

export function hasPlayedHere(): boolean {
  try {
    return window.localStorage.getItem(PLAYED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPlayedHere() {
  try {
    window.localStorage.setItem(PLAYED_KEY, "1");
  } catch {
    // Storage is blocked: the card shows again next visit, which is harmless.
  }
}
