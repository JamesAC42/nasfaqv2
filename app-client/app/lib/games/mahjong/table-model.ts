// Pure helpers for the live table page (components/games/mahjong/table). Nothing here touches React.

import type { ChibiPose } from "@/app/lib/art-manifest";
import { fmtInteger } from "@/app/lib/format";
import { seatAt, windLetter, type Relative } from "@/app/lib/games/mahjong/tiles";
import type { FinalLine, HandResult, Meld, PublicHand, PublicSeat, SeatIndex, TableResult, WinEntry } from "@/app/lib/games/mahjong/types";
import type { RowMeld } from "@/app/components/games/mahjong/tile";

/** The four screen sides, in `Relative` order: you, the player after you (right), across, the player before you (left). */
export const SIDES = ["bottom", "right", "top", "left"] as const;
export type Side = (typeof SIDES)[number];

/** Seats in screen order for a table whose bottom seat is `bottom`. */
export const seatsBySide = (bottom: number): Record<Side, SeatIndex> => ({
  bottom: seatAt(0 as Relative, bottom) as SeatIndex,
  right: seatAt(1 as Relative, bottom) as SeatIndex,
  top: seatAt(2 as Relative, bottom) as SeatIndex,
  left: seatAt(3 as Relative, bottom) as SeatIndex,
});

export const signed = (value: number) => (value > 0 ? `+${fmtInteger(value)}` : value < 0 ? `−${fmtInteger(Math.abs(value))}` : "0");
export const points = (value: number | null | undefined) => fmtInteger(value ?? 0);

/** The name to show for a seat. */
export const seatLabel = (seat: PublicSeat | null | undefined) => (seat ? (seat.guest ? "Guest" : seat.username) : "Open seat");

export const RANK_NAMES: Record<string, string> = {
  bagholder: "Bagholder",
  "day-trader": "Day trader",
  "floor-trader": "Floor trader",
  broker: "Broker",
  "fund-manager": "Fund manager",
  whale: "Whale",
  "market-maker": "Market maker",
};

/** A hand with a limit (mangan and up) or a yakuman anywhere in it. */
export const isBigResult = (result: HandResult | null | undefined) => Boolean(result && result.type === "win" && result.wins.some((win) => win.yakuman > 0 || win.limit !== null));

/** What a seat's portrait does: set only by what is true of the hand, so a reload gives the same face. */
export function seatPose(seat: SeatIndex, hand: PublicHand | null, standing: { place: number } | null): ChibiPose {
  if (standing) return standing.place === 1 ? "moon" : standing.place === 4 ? "cope" : "idle";
  if (!hand) return "idle";
  const result = hand.result;
  if (hand.phase === "over" && result) {
    if (result.type === "win") {
      if (result.wins.some((win) => win.seat === seat)) return "hype";
      if (result.wins.some((win) => win.from === seat)) return "cope";
      const big = result.wins.some((win) => win.limit !== null || win.yakuman > 0);
      if (big && result.deltas[seat] < 0) return "shock";
      return "idle";
    }
    if (result.nagashi.includes(seat)) return "hype";
    if (result.reason === "exhaustive") return result.tenpai[seat] ? "smug" : "idle";
    return "idle";
  }
  return hand.seats[seat]?.riichi ? "smug" : "idle";
}

/** A meld off the table payload as the plain row shape used for results. */
export const rowMeld = (meld: Meld): RowMeld => ({ tiles: meld.tiles, type: meld.type, called: meld.called === null ? undefined : Math.max(0, meld.tiles.indexOf(meld.called)) });

/** "Tsumo", "Ron" and who paid, for a win line. */
export const winWord = (win: WinEntry) => (win.tsumo ? "Tsumo" : "Ron");

/** Wind letter for a seat's wind kind. */
export const windOf = (hand: PublicHand | null, seat: SeatIndex) => (hand ? windLetter(hand.seats[seat].wind) : "");

/** Standing of a seat in a finished game. */
export function standingOf(result: TableResult | null | undefined, seat: number): FinalLine | null {
  if (!result || !("standings" in result)) return null;
  return result.standings.find((line) => line.seat === seat) ?? null;
}

/** SHA-256 of a hex string's bytes, as hex; null when the browser can't. */
export async function sha256Hex(seedHex: string): Promise<string | null> {
  try {
    if (!/^[0-9a-f]{64}$/i.test(seedHex) || !window.crypto?.subtle) return null;
    const bytes = new Uint8Array(seedHex.match(/../g)!.map((pair) => parseInt(pair, 16)));
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
