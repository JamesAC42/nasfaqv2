// Friendly copy for the games API's error codes (api/src/routes/games.js ERROR_STATUS).

const COPY: Record<string, string> = {
  unauthenticated: "Sign in to play.",
  forbidden: "That isn't yours to do.",
  "Verify your email before using this feature.": "Verify your email to play for money.",
  email_verification_required: "Verify your email to play for money.",
  insufficient_cash: "Not enough cash for that.",
  insufficient_shards: "Not enough shards.",
  reward_already_claimed: "Already claimed.",
  set_incomplete: "That set isn't complete yet.",
  card_not_owned: "You don't own one of those cards.",
  table_full: "Someone else took the seat.",
  table_not_open: "That table isn't open anymore.",
  table_not_found: "That table is gone.",
  already_seated: "You're already at a table. Finish or cancel it first.",
  not_your_turn: "Not your turn.",
  invalid_action: "You can't do that right now.",
  invalid_stake: "That stake is outside the table limits.",
  invalid_deck: "Pick five different talents for your deck.",
  invalid_bet: "That bet is outside the table limits.",
  banner_not_found: "That banner has ended.",
  card_pool_empty: "The card pool is empty right now.",
  game_not_found: "That game isn't available.",
  run_too_fast: "That run ended too early to count.",
  game_session_not_active: "That run was already submitted.",
};

export function gameErrorText(error: unknown) {
  const message = String((error as Error)?.message ?? error ?? "");
  return COPY[message] ?? (message && !/^\d+$/.test(message) ? message.replace(/_/g, " ") : "Something went wrong. Try again.");
}
