const { ensureUserCashAccount } = require("../portfolioCash");

const VALID_ENTRY_TYPES = new Set([
  "gacha_pull_fee",
  "gacha_duplicate_compensation",
  "game_entry_fee",
  "game_prize_payout",
  "game_refund",
  "pvp_stake_debit",
  "pvp_prize_payout",
]);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

async function insertLedgerEntryWithClient(client, {
  userId,
  assetId = null,
  entryType,
  quantityDelta = 0,
  cashDelta,
  referenceType,
  referenceId,
}) {
  await client.query(
    `
    INSERT INTO market.ledger_entries (
      user_id,
      asset_id,
      entry_type,
      quantity_delta,
      cash_delta,
      reference_type,
      reference_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
  `,
    [userId, assetId, entryType, quantityDelta, cashDelta, referenceType, referenceId]
  );
}

async function updateCashBalanceWithClient(client, userId, nextCashBalance) {
  await client.query(
    `
    UPDATE market.portfolio_cash_balances
    SET cash_balance = $2, updated_at = now()
    WHERE user_id = $1
  `,
    [userId, nextCashBalance]
  );
}

async function getLockedCashAccountWithClient(client, userId) {
  const account = await ensureUserCashAccount(client, userId);
  return {
    user_id: Number(account.user_id),
    cash_balance: toNumber(account.cash_balance, 0),
  };
}

async function ensureSufficientCashWithClient(client, userId, amount) {
  const requiredAmount = requirePositiveCashAmount(amount);
  const account = await getLockedCashAccountWithClient(client, userId);

  if (account.cash_balance < requiredAmount) {
    const error = new Error("insufficient_cash");
    error.code = "insufficient_cash";
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
  const account = await ensureSufficientCashWithClient(client, userId, debitAmount);
  const nextCashBalance = account.cash_balance - debitAmount;

  await updateCashBalanceWithClient(client, userId, nextCashBalance);
  await insertLedgerEntryWithClient(client, {
    userId,
    assetId,
    entryType: safeEntryType,
    quantityDelta: 0,
    cashDelta: -debitAmount,
    referenceType: safeReferenceType,
    referenceId: safeReferenceId,
  });

  return {
    previous_cash_balance: account.cash_balance,
    cash_balance: nextCashBalance,
    cash_delta: -debitAmount,
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
  const account = await getLockedCashAccountWithClient(client, userId);
  const nextCashBalance = account.cash_balance + creditAmount;

  await updateCashBalanceWithClient(client, userId, nextCashBalance);
  await insertLedgerEntryWithClient(client, {
    userId,
    assetId,
    entryType: safeEntryType,
    quantityDelta: 0,
    cashDelta: creditAmount,
    referenceType: safeReferenceType,
    referenceId: safeReferenceId,
  });

  return {
    previous_cash_balance: account.cash_balance,
    cash_balance: nextCashBalance,
    cash_delta: creditAmount,
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
