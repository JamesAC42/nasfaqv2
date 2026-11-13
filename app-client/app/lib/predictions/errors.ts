// Friendly copy for predictions API error codes (api/src/routes/predictions.js ERROR_STATUS).

const COPY: Record<string, string> = {
  unauthenticated: "Sign in to bet.",
  email_verification_required: "Verify your email to bet.",
  "Verify your email before using this feature.": "Verify your email to bet.",
  forbidden: "You don't have permission for that.",
  prediction_market_not_found: "That pool doesn't exist.",
  prediction_market_closed: "Betting on this has closed.",
  insufficient_cash: "Not enough cash.",
  insufficient_credit: "Not enough Credit. Bets never spend your cash.",
  net_worth_floor: "Bets are closed while your net worth is this low. Build it back on the market and they reopen.",
  insufficient_shares: "You don't hold that many shares.",
  price_moved: "The price moved. Check the new quote and try again.",
  price_at_limit: "The price is already at the limit; nothing to fill.",
  invalid_amount: "Enter an amount between $1 and $25,000.",
  invalid_limit_price: "Limit price must be between 1¢ and 99¢.",
  invalid_outcome: "Pick an outcome.",
  order_not_open: "That order already closed.",
  source_required: "Add a source link.",
  invalid_source_url: "The source must be a full http(s) link.",
  invalid_dispute_reason: "Say why in at least 20 characters.",
  dispute_window_closed: "The dispute window has closed.",
  dispute_requires_position: "Only players who traded this market can dispute.",
  already_disputed: "You've already disputed this call.",
  confirm_requires_second_resolver: "A different resolver has to confirm a disputed call.",
  no_open_proposal: "There's no open call on this market.",
  prediction_market_transition_invalid: "That can't be done from its current state.",
  prediction_market_self_approval_forbidden: "Someone else has to approve your market.",
  invalid_prediction_market: "Some fields need fixing.",
  // Pools and margin
  invalid_pool: "Some fields need fixing.",
  resolution_note_required: "Add a source link or a note saying how you know.",
  in_the_red: "You're in the red. Winnings and other Credit pay it back; until then you can't bet or spend Credit. Stock trading isn't affected.",
  margin_line_exceeded: "That's more than your margin line.",
  margin_account_too_new: "Margin opens 7 days after you sign up.",
  account_suspended: "Your account is suspended.",
  new_account_pool_cap: "New accounts can have $10,000 in pools for their first 7 days.",
  bookie_own_pool: "Bookies can't bet in their own pools.",
  bookie_has_stake: "You have money in this pool, so its bookie or an admin has to call it.",
  void_has_stake: "You have money in this pool, so you can't void it. An admin can, or its bookie before it's called.",
  correction_window_closed: "Results can only be corrected or voided for 7 days.",
  same_outcome: "That's already the result.",
  lmsr_retired: "Market-maker markets can't open. Reject this one if it's queued, and open a pool from the bookie desk.",
  reopen_reason_required: "Say why you're reopening it, in a few words.",
  pool_reopen_too_late: "Its closing time has passed, so betting stays closed.",
  pool_reopen_not_early: "Only a pool someone closed early can reopen.",
  pool_reopened_already: "Betting on a pool can only be reopened once.",
};

export function predictionErrorText(error: unknown) {
  const message = String((error as Error)?.message ?? error ?? "");
  return COPY[message] ?? (message && !/^\d+$/.test(message) ? message.replace(/_/g, " ") : "Something went wrong. Try again.");
}
