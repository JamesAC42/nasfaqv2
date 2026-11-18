import type { GameLength, Speed, TournamentSummary } from "@/app/lib/games/mahjong/types";
import { fmtNumber } from "@/app/lib/format";

export const money = (value: number) => fmtNumber(value, "$");

export const lengthWords = (length: GameLength) => (length === "south" ? "East-South (two wind rounds)" : "East-only (one wind round)");
export const speedWords = (speed: Speed) => (speed === "relaxed" ? "relaxed clock" : speed === "untimed" ? "no clock" : "standard clock");

export function startsText(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

/** "2d 4h", "3h 12m", "4m 09s", "12s". */
export function countdown(untilMs: number, now: number) {
  const total = Math.max(0, Math.floor((untilMs - now) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** Tables per round for a knockout of `seats` players, four to a table: 16 gives 4, 2, 1. */
export function roundShape(seats: number): number[] {
  const out: number[] = [];
  for (let tables = Math.ceil(seats / 4); tables >= 1; tables = tables === 1 ? 0 : Math.ceil(tables / 2)) out.push(tables);
  return out;
}

const ROUND_WORDS: Record<number, string> = { 1: "the final table", 2: "the semifinals", 4: "the first round" };

/** The format in words: "16 players, knockout. Four to a table; the top two at each table go through…" */
export function formatWords(tournament: Pick<TournamentSummary, "seats" | "length" | "final_length" | "speed">): string {
  const shape = roundShape(tournament.seats);
  const rounds = shape.length;
  const parts: string[] = [];
  if (rounds === 1) {
    parts.push(`${tournament.seats} players at one table: a single game, and it’s the final.`);
  } else {
    parts.push(`${tournament.seats} players, knockout. Four to a table; the top two at each table go through. ${shape.map((tables) => `${tables} ${tables === 1 ? "table" : "tables"}`).join(", then ")}, ending at ${ROUND_WORDS[1]}.`);
  }
  const sameLength = tournament.length === tournament.final_length;
  parts.push(sameLength ? `Every game is ${lengthWords(tournament.length)}.` : `Games are ${lengthWords(tournament.length)}; the final is ${lengthWords(tournament.final_length)}.`);
  parts.push(`${speedWords(tournament.speed).replace(/^./, (c) => c.toUpperCase())}.`);
  return parts.join(" ");
}
