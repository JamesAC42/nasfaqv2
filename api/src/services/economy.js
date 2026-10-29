const { ensureUserCashAccount } = require("./portfolioCash");
const pgNumeric = require("./pgNumeric");

// Cash and Credit, BBB's two currencies (docs/market/credit.md).
//
// Cash (BBB's "Liquid"; portfolio_cash_balances.cash_balance) buys shares. Credit (credit_balance) is
// the buffer most money lands in: games, the capsule machine, the card exchange and predictions run
// on it, dividends pay it, share fees and the trading fee come out of it first, and part of it turns
// into Cash at each Saturday review. So gambling spends Credit while shares are bought with Cash,
// and the two don't cross. Every move writes one ledger row carrying cash_delta and credit_delta.
//
// PLACEHOLDER marks a number or a choice still waiting on BBB; BBB marks his answers. Change them here
// (or with their env vars).

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function envChoice(name, choices, fallback) {
  const raw = String(process.env[name] || "").trim();
  return choices.includes(raw) ? raw : fallback;
}

const SETTINGS = Object.freeze({
  /**
   * BBB: share of a player's Credit that turns into Cash at each Saturday review, 5% to start (5-10%,
   * to be tuned), licenses raising it later; never more than half.
   */
  weeklyConversionRate: Math.min(envNumber("ECONOMY_WEEKLY_CONVERSION_RATE", 0.05), 0.5),
  /** BBB: the conversion is at least this much ("5% or $10k, whichever is more"), or all of a smaller balance. */
  weeklyConversionMinimum: envNumber("ECONOMY_WEEKLY_CONVERSION_MINIMUM", 10000),
  /** BBB: Credit counts toward net worth and the leaderboard ("cash" would leave it out). */
  netWorth: envChoice("ECONOMY_NET_WORTH", ["cash", "cash_and_credit"], "cash_and_credit"),
  /**
   * BBB: minigames, gacha, gambling (predictions) and player trading (the card exchange) spend Credit
   * first, then Cash once it runs out ("credit_then_cash"; "credit" would stop at Credit). Winnings
   * land in Credit; refunds go back where the money came from (see refund).
   */
  sideModeFunds: envChoice("ECONOMY_SIDE_MODE_FUNDS", ["credit", "credit_then_cash"], "credit_then_cash"),
  /** PLACEHOLDER. Credit a share sale earns, as a share of the sale's value (BBB: "a small % of that coin's tax value"). */
  sellCreditRate: envNumber("ECONOMY_SELL_CREDIT_RATE", 0.01),
  /** PLACEHOLDER. Where achievement rewards land (BBB: early ones give both; this pays them all in one). */
  achievementRewards: envChoice("ECONOMY_ACHIEVEMENT_REWARDS", ["credit", "cash"], "credit"),
});

function economyError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/** The player's balances, with their row locked for the rest of the transaction. */
async function lockWallet(client, userId) {
  const account = await ensureUserCashAccount(client, userId);
  return { cash: num(account.cash_balance), credit: num(account.credit_balance), held: num(account.held_cash) };
}

/**
 * Splits a charge between Credit and Cash. `from` is "credit", "cash" or "credit_then_cash". Throws
 * insufficient_credit / insufficient_cash when the wallet can't cover it, unless `shortfall` names
 * the balance that takes what's left (it can go below zero: weekly share fees, the trading fee).
 */
function splitCharge(wallet, amount, from, { shortfall = null } = {}) {
  const total = num(amount);
  if (!(total > 0)) return { credit: 0, cash: 0 };
  const creditAvailable = Math.max(0, wallet.credit);
  const cashAvailable = Math.max(0, wallet.cash);
  let credit = 0;
  let cash = 0;
  if (from === "cash") cash = Math.min(total, cashAvailable);
  else credit = Math.min(total, creditAvailable);
  if (from === "credit_then_cash") cash = Math.min(total - credit, cashAvailable);
  const left = total - credit - cash;
  if (left > 1e-9) {
    if (shortfall === "cash") cash += left;
    else if (shortfall === "credit") credit += left;
    else {
      const code = from === "cash" ? "insufficient_cash" : "insufficient_credit";
      throw economyError(code, { cash_balance: wallet.cash, credit_balance: wallet.credit, required: total });
    }
  }
  return { credit, cash };
}

async function writeMove(client, userId, { cash, credit, entryType, referenceType, referenceId, assetId = null, quantityDelta = 0 }) {
  if (cash || credit) {
    await client.query(
      `
      UPDATE market.portfolio_cash_balances
      SET cash_balance = cash_balance + $2, credit_balance = credit_balance + $3, updated_at = now()
      WHERE user_id = $1
    `,
      [userId, cash, credit]
    );
  }
  await client.query(
    `
    INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, credit_delta, reference_type, reference_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `,
    [userId, assetId, entryType, quantityDelta, cash, credit, referenceType, referenceId]
  );
}

/**
 * Takes `amount` from the player (see splitCharge for `from` and `shortfall`) and writes the ledger
 * row. Returns the balances before and after, and how much came from each.
 */
async function charge(client, userId, amount, { from, shortfall = null, entryType, referenceType, referenceId, assetId = null, quantityDelta = 0 }) {
  const wallet = await lockWallet(client, userId);
  const split = splitCharge(wallet, amount, from, { shortfall });
  await writeMove(client, userId, { cash: -split.cash, credit: -split.credit, entryType, referenceType, referenceId, assetId, quantityDelta });
  return {
    before: wallet,
    after: { ...wallet, cash: wallet.cash - split.cash, credit: wallet.credit - split.credit },
    cash_delta: -split.cash,
    credit_delta: -split.credit,
  };
}

/** Gives the player `amount` in `to` ("credit" or "cash") and writes the ledger row. */
async function pay(client, userId, amount, { to, entryType, referenceType, referenceId, assetId = null, quantityDelta = 0 }) {
  const wallet = await lockWallet(client, userId);
  const value = Math.max(0, num(amount));
  const cash = to === "cash" ? value : 0;
  const credit = to === "cash" ? 0 : value;
  await writeMove(client, userId, { cash, credit, entryType, referenceType, referenceId, assetId, quantityDelta });
  return { before: wallet, after: { ...wallet, cash: wallet.cash + cash, credit: wallet.credit + credit }, cash_delta: cash, credit_delta: credit };
}

/**
 * Gives back money a side mode held or took (an outbid bid, a refunded stake, a released or voided
 * prediction): Cash up to what the player's Cash put into `sources` (net of what already came back),
 * the rest as Credit, so a side mode that fell back on Cash doesn't quietly turn it into Credit.
 * `sources` are ledger references ({ referenceType, referenceId }); by default the one being written.
 */
async function refund(client, userId, amount, { entryType, referenceType, referenceId, assetId = null, quantityDelta = 0, sources = null }) {
  const wallet = await lockWallet(client, userId);
  const value = Math.max(0, num(amount));
  const refs = sources && sources.length ? sources : [{ referenceType, referenceId }];
  const { rows } = await client.query(
    `
    SELECT COALESCE(-SUM(l.cash_delta), 0) AS cash_in
    FROM market.ledger_entries l
    JOIN unnest($2::text[], $3::bigint[]) AS r(reference_type, reference_id)
      ON l.reference_type = r.reference_type AND l.reference_id = r.reference_id
    WHERE l.user_id = $1
  `,
    [userId, refs.map((ref) => String(ref.referenceType)), refs.map((ref) => Number(ref.referenceId))]
  );
  const cash = Math.min(value, Math.max(0, num(rows[0]?.cash_in)));
  const credit = value - cash;
  await writeMove(client, userId, { cash, credit, entryType, referenceType, referenceId, assetId, quantityDelta });
  return { before: wallet, after: { ...wallet, cash: wallet.cash + cash, credit: wallet.credit + credit }, cash_delta: cash, credit_delta: credit };
}

/**
 * writeMove for many players at once: each move is { userId, cash, credit, entryType, referenceType,
 * referenceId, assetId, quantityDelta }. One statement: every move gets its ledger row, and each
 * balance moves by the sum of its player's moves, which is exactly where one writeMove after another
 * leaves it (NUMERIC sums are exact). Accounts must exist already.
 */
async function writeMoves(client, moves) {
  if (!moves.length) return;
  await client.query(
    `
    WITH moves AS (
      SELECT m."userId", m."assetId", m."entryType", COALESCE(m."quantityDelta", 0) AS quantity_delta,
             COALESCE(m.cash, 0) AS cash, COALESCE(m.credit, 0) AS credit, m."referenceType", m."referenceId"
      FROM jsonb_to_recordset($1::jsonb) AS m("userId" bigint, "assetId" bigint, "entryType" text, "quantityDelta" numeric,
        cash numeric, credit numeric, "referenceType" text, "referenceId" bigint)
    ),
    balances AS (
      UPDATE market.portfolio_cash_balances b
      SET cash_balance = b.cash_balance + t.cash, credit_balance = b.credit_balance + t.credit, updated_at = now()
      FROM (SELECT "userId", SUM(cash) AS cash, SUM(credit) AS credit FROM moves WHERE cash <> 0 OR credit <> 0 GROUP BY "userId") t
      WHERE b.user_id = t."userId"
    )
    INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, credit_delta, reference_type, reference_id)
    SELECT "userId", "assetId", "entryType", quantity_delta, cash, credit, "referenceType", "referenceId" FROM moves
  `,
    [JSON.stringify(moves)]
  );
}

/**
 * The Saturday review's conversion, worked out for each wallet ({ userId, credit }, credit as NUMERIC
 * text or a pgNumeric value): `rate` of every positive Credit balance becomes Cash, or `minimum` if
 * that's more (all of a balance smaller than that). Postgres's arithmetic (LEAST(credit,
 * GREATEST(round(credit * rate, 2), minimum))), each amount handed back as the JS number a row of it
 * reads as. Returns how many players and how much it moves.
 */
function planCreditConversion(wallets, { rate = SETTINGS.weeklyConversionRate, minimum = SETTINGS.weeklyConversionMinimum } = {}) {
  const share = Math.min(Math.max(num(rate), 0), 0.5);
  const floor = Math.max(num(minimum), 0);
  if (!(share > 0) && !(floor > 0)) return { players: 0, converted: 0, rate: share, minimum: floor, moves: [] };
  const shareValue = pgNumeric.parse(share);
  const floorValue = pgNumeric.parse(floor);
  let converted = 0;
  const moves = [];
  for (const wallet of wallets) {
    const credit = typeof wallet.credit === "object" ? wallet.credit : pgNumeric.parse(wallet.credit);
    if (pgNumeric.compare(credit, pgNumeric.ZERO) <= 0) continue;
    const portion = pgNumeric.round(pgNumeric.mul(credit, shareValue), 2);
    const atLeast = pgNumeric.compare(portion, floorValue) >= 0 ? portion : floorValue;
    const amount = pgNumeric.toNumber(pgNumeric.compare(credit, atLeast) <= 0 ? credit : atLeast);
    converted += amount;
    moves.push({ userId: Number(wallet.userId), amount });
  }
  return { players: moves.length, converted: Math.round(converted * 100) / 100, rate: share, minimum: floor, moves };
}

/** The ledger moves for a planned conversion (reference: the evaluation). */
function conversionMoves(plan, evaluationId) {
  return plan.moves.map((move) => ({
    userId: move.userId,
    cash: move.amount,
    credit: -move.amount,
    entryType: "credit_conversion",
    referenceType: "weekly_evaluation",
    referenceId: evaluationId,
  }));
}

/** The conversion on every wallet as it stands, one ledger row per player (reference: the evaluation). */
async function convertCredit(client, { rate = SETTINGS.weeklyConversionRate, minimum = SETTINGS.weeklyConversionMinimum, evaluationId }) {
  const { rows } = await client.query(
    `SELECT user_id, credit_balance FROM market.portfolio_cash_balances WHERE credit_balance > 0 ORDER BY user_id FOR UPDATE`
  );
  const plan = planCreditConversion(rows.map((row) => ({ userId: row.user_id, credit: row.credit_balance })), { rate, minimum });
  await writeMoves(client, conversionMoves(plan, evaluationId));
  return plan;
}

/** What games, the capsule machine, the exchange and predictions can spend: Credit, plus Cash when they fall back to it. */
function sideModeSpendable(wallet) {
  return Math.max(0, num(wallet.credit)) + (SETTINGS.sideModeFunds === "credit_then_cash" ? Math.max(0, num(wallet.cash)) : 0);
}

/** What a client needs to know about the rules (the open choices included). */
function publicSettings() {
  return {
    side_mode_funds: SETTINGS.sideModeFunds,
    net_worth: SETTINGS.netWorth,
    weekly_conversion_rate: SETTINGS.weeklyConversionRate,
    weekly_conversion_minimum: SETTINGS.weeklyConversionMinimum,
    sell_credit_rate: SETTINGS.sellCreditRate,
  };
}

module.exports = {
  SETTINGS,
  charge,
  conversionMoves,
  convertCredit,
  lockWallet,
  pay,
  planCreditConversion,
  publicSettings,
  refund,
  sideModeSpendable,
  splitCharge,
  writeMoves,
};
