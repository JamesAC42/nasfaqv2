// Friendly copy for predictions API error codes (api/src/routes/predictions.js ERROR_STATUS).

const COPY: Record<string, string> = {
  unauthenticated: "Sign in to trade.",
  email_verification_required: "Verify your email to trade.",
  "Verify your email before using this feature.": "Verify your email to trade.",
  forbidden: "You don't have permission for that.",
  prediction_market_not_found: "That market doesn't exist.",
  prediction_market_closed: "Trading on this market is closed.",
  insufficient_cash: "Not enough cash.",
  insufficient_credit: "Not enough Credit or cash.",
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
  prediction_market_transition_invalid: "The market can't do that from its current state.",
  prediction_market_self_approval_forbidden: "Someone else has to approve your market.",
  invalid_prediction_market: "Some fields need fixing.",
  // Pools and margin
  invalid_pool: "Some fields need fixing.",
  resolution_note_required: "Add a source link or a note saying how you know.",
  in_the_red: "You're in the red. Winnings and share sales pay it back first; until then you can't bet, buy or spend.",
  margin_line_exceeded: "That's more than your margin line.",
  margin_account_too_new: "Margin opens 7 days after you sign up.",
  account_suspended: "Your account is suspended.",
  new_account_pool_cap: "New accounts can have $10,000 in pools for their first 7 days.",
  bookie_own_pool: "Bookies can't bet in their own pools.",
  bookie_has_stake: "You have money in this pool, so someone else has to call it.",
  correction_window_closed: "Results can only be corrected or voided for 7 days.",
  same_outcome: "That's already the result.",
  lmsr_retired: "New markets are pools now.",
};

export function predictionErrorText(error: unknown) {
  const message = String((error as Error)?.message ?? error ?? "");
  return COPY[message] ?? (message && !/^\d+$/.test(message) ? message.replace(/_/g, " ") : "Something went wrong. Try again.");
}
