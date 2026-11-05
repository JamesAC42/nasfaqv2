// Which picture of a blackjack dealer each moment shows. Pure (no React), so the share card's server
// code can use it too; the live hook is in lib/games/dealers.ts.

import type { ChibiPose } from "@/app/lib/art-manifest";
import type { BlackjackTable } from "@/app/lib/games/types";

/** The dealer art set (art-pipeline poses.dealers.json): `SYM/dealer/<state>`. */
export type DealerState = "idle" | "shuffle" | "deal" | "reveal" | "house" | "bust" | "blackjack" | "push";

/** Until a talent's dealer art exists, the reaction set stands in. */
export const DEALER_FALLBACK_POSE: Record<DealerState, ChibiPose> = {
  idle: "idle",
  shuffle: "idle",
  deal: "idle",
  reveal: "smug",
  house: "smug",
  bust: "shock",
  blackjack: "hype",
  push: "idle",
};

const handTotal = (cards: BlackjackTable["dealer"]["hand"]) => {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (!card) continue; // the hole card, face down
    const rank = String(card.rank);
    if (rank === "A" || rank === "1" || rank === "14") {
      aces += 1;
      total += 11;
    } else if (rank === "J" || rank === "Q" || rank === "K" || Number(rank) >= 10) total += 10;
    else total += Number(rank) || 0;
  }
  while (total > 21 && aces) {
    total -= 10;
    aces -= 1;
  }
  return total;
};

/** What the dealer is doing right now at this table. */
export function dealerStateOf(table: BlackjackTable): DealerState {
  if (table.phase === "idle") return table.shoe_remaining >= table.shoe_size ? "shuffle" : "idle";
  if (table.phase === "betting") return "idle";
  if (table.phase === "playing") {
    if (table.turn !== null) return "idle";
    return table.dealer.hidden ? "deal" : "reveal";
  }
  // Results: the dealer's own hand first, then how the table did against it.
  const dealer = handTotal(table.dealer.hand);
  if (table.dealer.hand.length === 2 && dealer === 21) return "house";
  if (dealer > 21) return "bust";
  const hands = table.seats.filter((seat) => seat && seat.bet > 0 && seat.outcome);
  if (hands.some((seat) => seat!.outcome === "blackjack")) return "blackjack";
  const won = hands.filter((seat) => seat!.outcome === "win").length;
  const lost = hands.filter((seat) => seat!.outcome === "loss" || seat!.outcome === "bust").length;
  if (won > lost) return "blackjack";
  if (lost > won) return "house";
  return hands.length ? "push" : "idle";
}

/** The dealer's state for one settled hand, as the share card shows it. */
export function dealerStateForOutcome(outcome: string, dealerValue: number | null): DealerState {
  if (outcome === "blackjack") return "blackjack";
  if (outcome === "win") return (dealerValue ?? 0) > 21 ? "bust" : "blackjack";
  if (outcome === "push") return "push";
  return "house";
}
