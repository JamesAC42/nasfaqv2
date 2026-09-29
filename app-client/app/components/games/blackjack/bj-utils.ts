import { useSyncExternalStore } from "react";
import type { BlackjackCard, BlackjackSeat, BlackjackTable } from "@/app/lib/games/types";

export const BJ_TURN_MS = 15_000;
export const BJ_BET_MS = 15_000;
export const BJ_RESULT_MS = 5_000;
export const BJ_IDLE_KICK = 3;

export const HOUSE_RULES = [
  { big: "3:2", text: "Blackjack pays three to two" },
  { big: "17", text: "Dealer stands on all 17s, soft too" },
  { big: "×2", text: "Double down on your first two cards" },
  { big: "6D", text: "Six-deck shoe, reshuffled past 75%" },
  { big: "15s", text: "To bet, then 15s a turn or you stand" },
  { big: "1:1", text: "Wins pay even. No split, no insurance" },
];

const DENOMS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/** Chip colours by denomination. No green or red: those mean up and down here. */
export const CHIP_COLOR: Record<number, { face: string; edge: string; ink: string }> = {
  5: { face: "#cfd6e4", edge: "#8e98ad", ink: "#14161c" },
  10: { face: "#3fb8f5", edge: "#1a6f9c", ink: "#02121c" },
  25: { face: "#9a74ff", edge: "#5a3fb8", ink: "#ffffff" },
  50: { face: "#ff8ac8", edge: "#b0457f", ink: "#2a0418" },
  100: { face: "#1b2030", edge: "#e8ecf4", ink: "#ffffff" },
  250: { face: "#5ad1e6", edge: "#1f7f91", ink: "#03181c" },
  500: { face: "#f5b83f", edge: "#9c6c10", ink: "#1f1300" },
  1000: { face: "#fff4d6", edge: "#d6a634", ink: "#3a2800" },
  2500: { face: "#c7b3ff", edge: "#6d4fd1", ink: "#16083a" },
  5000: { face: "#0f2340", edge: "#8ad6ff", ink: "#8ad6ff" },
  10000: { face: "#ffd84f", edge: "#1b2030", ink: "#1b1300" },
};

/** The four or five chip values that make sense at a table's limits. */
export function chipsFor(min: number, max: number) {
  const fit = DENOMS.filter((value) => value >= min && value <= max);
  return fit.slice(0, 5);
}

/** Break an amount into chips, biggest first, capped so a stack stays a stack. */
export function chipStack(amount: number, maxChips = 7) {
  const chips: number[] = [];
  let left = Math.round(amount);
  for (const value of [...DENOMS].reverse()) {
    while (left >= value && chips.length < maxChips) {
      chips.push(value);
      left -= value;
    }
  }
  if (!chips.length && amount > 0) chips.push(5);
  return chips.reverse();
}

export function chipLabel(value: number) {
  return value >= 1000 ? `${value / 1000}K` : String(value);
}

function cardValue(card: NonNullable<BlackjackCard>) {
  if (card.rank === "A") return 11;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return Number(card.rank);
}

/** Best total, and whether an ace is still counted as 11. Face-down cards are skipped. */
export function handValue(hand: BlackjackCard[]) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (!card) continue;
    total += cardValue(card);
    if (card.rank === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 && total < 21 };
}

/** "17", or "7/17" for a soft hand still in play. */
export function valueText(hand: BlackjackCard[], live: boolean) {
  const { total, soft } = handValue(hand);
  if (!hand.length) return null;
  if (soft && live) return `${total - 10}/${total}`;
  return String(total);
}

export const wagerOf = (seat: NonNullable<BlackjackSeat>) => seat.bet * (seat.doubled ? 2 : 1);

/** Profit on a settled hand: +$ for a win, −wager for a loss, 0 for a push. */
export function netOf(seat: NonNullable<BlackjackSeat>) {
  return Math.round((seat.payout - wagerOf(seat)) * 100) / 100;
}

export type TableMoment =
  | { kind: "idle" }
  | { kind: "betting" }
  | { kind: "dealing" }
  | { kind: "turn"; seat: number }
  | { kind: "dealer" }
  | { kind: "results" };

export function momentOf(table: BlackjackTable): TableMoment {
  if (table.phase === "betting") return { kind: "betting" };
  if (table.phase === "results") return { kind: "results" };
  if (table.phase === "playing") {
    if (table.turn !== null) return { kind: "turn", seat: table.turn };
    return table.dealer.hidden ? { kind: "dealing" } : { kind: "dealer" };
  }
  return { kind: "idle" };
}

export const PHASE_LABEL: Record<BlackjackTable["phase"], string> = {
  idle: "Idle",
  betting: "Betting",
  playing: "Dealing",
  results: "Results",
};

const phoneQuery = "(max-width: 720px)";

/** True at phone width. False on the server. */
export function usePhone() {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(phoneQuery);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  );
}

/**
 * The engine publishes a new turn, a hit and the results screen a moment before it arms that
 * step's timer, so pushes carry the previous deadline (expired, or the pre-hit one). Track each
 * step by identity and derive its deadline from the push's own server_time the first time we
 * see it, unless the payload already carries a fresh one (HTTP responses do).
 */
const stepDeadlines = new Map<string, { id: string; deadline: number }>();

export function withLiveDeadline(table: BlackjackTable): BlackjackTable {
  let id: string | null = null;
  let span = 0;
  if (table.phase === "playing" && table.turn !== null) {
    id = `turn:${table.round_id}:${table.turn}:${table.seats[table.turn]?.hand.length ?? 0}`;
    span = BJ_TURN_MS;
  } else if (table.phase === "results") {
    id = `results:${table.round_id}`;
    span = BJ_RESULT_MS;
  }
  if (!id) return table.phase === "playing" ? { ...table, deadline: null } : table;
  const fresh = table.deadline && table.deadline > table.server_time + span - 2500 ? table.deadline : null;
  const previous = stepDeadlines.get(table.key);
  const deadline = fresh ?? (previous?.id === id ? previous.deadline : table.server_time + span);
  stepDeadlines.set(table.key, { id, deadline });
  return { ...table, deadline };
}
