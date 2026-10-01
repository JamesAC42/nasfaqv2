const economy = require("../economy");

// Games, the capsule machine and the card exchange run on Credit (services/economy.js): stakes,
// fees, bids and purchases spend it (or Credit then Cash, by SETTINGS.sideModeFunds), and winnings,
// refunds and sale proceeds land in it. The helpers keep their old names; "cash" here is the money
// the player has for these modes.

const VALID_ENTRY_TYPES = new Set([
  "gacha_pull_fee",
  "gacha_duplicate_compensation",
  "game_entry_fee",
  "game_prize_payout",
  "game_refund",
  "pvp_stake_debit",
  "pvp_prize_payout",
  "table_bet_debit",
  "table_payout",
  // Card exchange: bid holds and refunds, purchases, sale proceeds, trade escrow.
  "exchange_bid_hold",
  "exchange_bid_refund",
  "exchange_purchase",
  "exchange_sale",
  "exchange_trade_escrow",
  "exchange_trade_refund",
  "exchange_trade_settle",
]);

function invalidGameWallet(code = "invalid_game_wallet") {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requirePositiveCashAmount(amount) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw invalidGameWallet();
  }
  return parsed;
}

function requireEntryType(entryType) {
  const normalized = String(entryType || "").trim();
  if (!VALID_ENTRY_TYPES.has(normalized)) {
    throw invalidGameWallet();
  }
  return normalized;
}

function requireReferenceType(referenceType) {
  const normalized = String(referenceType || "").trim();
  if (!normalized) {
    throw invalidGameWallet();
  }
  return normalized;
}

function requireReferenceId(referenceId) {
  const parsed = Number(referenceId);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invalidGameWallet();
  }
  return parsed;
}

const spendable = economy.sideModeSpendable;

async function getLockedCashAccountWithClient(client, userId) {
  const wallet = await economy.lockWallet(client, userId);
  return {
    user_id: Number(userId),
    cash_balance: spendable(wallet),
    credit_balance: wallet.credit,
  };
}

async function ensureSufficientCashWithClient(client, userId, amount) {
  const requiredAmount = requirePositiveCashAmount(amount);
  const account = await getLockedCashAccountWithClient(client, userId);

  if (account.cash_balance < requiredAmount) {
    const error = new Error("insufficient_credit");
    error.code = "insufficient_credit";
    error.cash_balance = account.cash_balance;
    error.required_cash = requiredAmount;
    throw error;
  }

  return account;
}

async function debitCashForGameWithClient(client, {
  userId,
  amount,
  entryType,
  referenceType,
  referenceId,
  assetId = null,
}) {
  const debitAmount = requirePositiveCashAmount(amount);
  const safeEntryType = requireEntryType(entryType);
  const safeReferenceType = requireReferenceType(referenceType);
  const safeReferenceId = requireReferenceId(referenceId);
  const result = await economy.charge(client, userId, debitAmount, {
    from: economy.SETTINGS.sideModeFunds,
    entryType: safeEntryType,
    referenceType: safeReferenceType,
    referenceId: safeReferenceId,
    assetId,
  });

  return {
    previous_cash_balance: spendable(result.before),
    cash_balance: spendable(result.after),
    cash_delta: -debitAmount,
    credit_balance: result.after.credit,
  };
}

async function creditCashForGameWithClient(client, {
  userId,
  amount,
  entryType,
  referenceType,
  referenceId,
  assetId = null,
}) {
  const creditAmount = requirePositiveCashAmount(amount);
  const safeEntryType = requireEntryType(entryType);
  const safeReferenceType = requireReferenceType(referenceType);
  const safeReferenceId = requireReferenceId(referenceId);
  const result = await economy.pay(client, userId, creditAmount, {
    to: "credit",
    entryType: safeEntryType,
    referenceType: safeReferenceType,
    referenceId: safeReferenceId,
    assetId,
  });

  return {
    previous_cash_balance: spendable(result.before),
    cash_balance: spendable(result.after),
    cash_delta: creditAmount,
    credit_balance: result.after.credit,
  };
}

async function refundCashForGameWithClient(client, params) {
  return creditCashForGameWithClient(client, {
    ...params,
    entryType: "game_refund",
  });
}

module.exports = {
  VALID_ENTRY_TYPES,
  creditCashForGameWithClient,
  debitCashForGameWithClient,
  ensureSufficientCashWithClient,
  getLockedCashAccountWithClient,
  refundCashForGameWithClient,
};
