// Shared plumbing for predictions v2: errors, rounding, cash + ledger moves, market locking,
// outcome state and price history. Everything here runs inside a caller's transaction.
// Predictions run on Credit (services/economy.js): "cash" in this code is the money a player has
// for them (Credit, or Credit then Cash by SETTINGS.sideModeFunds), and payouts land in Credit.

const economy = require("../economy");
const lmsr = require("./lmsr");

const round2 = (value) => Math.round(Number(value) * 100) / 100;
const ceil2 = (value) => Math.ceil(Number(value) * 100 - 1e-7) / 100;
const floor2 = (value) => Math.floor(Number(value) * 100 + 1e-7) / 100;
const round6 = (value) => Math.round(Number(value) * 1e6) / 1e6;
const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function predictionError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/**
 * Moves a user's prediction money and writes the ledger row in the same transaction. Returns what
 * they have left to spend on predictions.
 */
async function moveCash(client, userId, delta, { entryType, marketId, quantityDelta = 0, referenceType = "prediction_market", referenceId = null }) {
  const amount = round2(delta);
  const ledger = { entryType, referenceType, referenceId: referenceId ?? marketId, quantityDelta: round6(quantityDelta) };
  // Only spending is refused; a payout or refund always lands.
  if (amount < 0) {
    try {
      const result = await economy.charge(client, userId, -amount, { from: economy.SETTINGS.sideModeFunds, ...ledger });
      return round2(economy.sideModeSpendable(result.after));
    } catch (error) {
      if (error?.code !== "insufficient_credit" && error?.code !== "insufficient_cash") throw error;
      throw predictionError("insufficient_credit", { cash_balance: round2(economy.sideModeSpendable({ credit: error.credit_balance, cash: error.cash_balance })), required_cash: -amount });
    }
  }
  const result = await economy.pay(client, userId, amount, { to: "credit", ...ledger });
  return round2(economy.sideModeSpendable(result.after));
}

async function cashBalance(client, userId) {
  return economy.sideModeSpendable(await economy.lockWallet(client, userId));
}

/** Locks the market row: every price-changing operation on a market is serialized through this. */
async function lockMarket(client, { id = null, slug = null }) {
  const { rows } = await client.query(
    `SELECT * FROM market.prediction_markets WHERE ${id ? "id = $1" : "slug = $1"} FOR UPDATE`,
    [id ?? slug]
  );
  if (!rows[0]) throw predictionError("prediction_market_not_found");
  return rows[0];
}

async function loadOutcomes(client, marketId) {
  const { rows } = await client.query(
    `SELECT o.*, a.symbol AS asset_symbol, ch.icon AS asset_icon, ch.color AS asset_color
     FROM market.prediction_market_outcomes o
     LEFT JOIN market.market_assets a ON a.id = o.asset_id LEFT JOIN yt.youtube_channels ch ON ch.youtube_channel_id = a.youtube_channel_id
     WHERE o.market_id = $1 ORDER BY o.sort_order, o.id`,
    [marketId]
  );
  return rows;
}

/** Market-maker state: b, q vector and current prices, aligned with `outcomes`. */
function ammState(market, outcomes) {
  const b = num(market.liquidity_b, 250);
  const q = outcomes.map((outcome) => num(outcome.amm_shares));
  return { b, q, prices: lmsr.prices(q, b) };
}

const isTradeable = (market, now = new Date()) =>
  market.status === "open" && market.trading_status === "open" && new Date(market.opens_at) <= now && new Date(market.closes_at) > now && market.amm_ready;

/** The headline probability: YES for binary, the leader for multi (kept for older clients). */
function headlineProbability(market, outcomes, prices) {
  if (market.market_type === "binary") {
    const yes = outcomes.findIndex((outcome) => outcome.outcome_code === "yes");
    return prices[yes >= 0 ? yes : 0];
  }
  return Math.max(...prices);
}

/** Writes new prices to the outcomes and the market after a trade or seed. */
async function storePrices(client, market, outcomes, q, prices, { tradedCash = 0, at = new Date() } = {}) {
  for (const [index, outcome] of outcomes.entries()) {
    await client.query(`UPDATE market.prediction_market_outcomes SET amm_shares = $2, last_price = $3, updated_at = now() WHERE id = $1`, [
      outcome.id,
      round6(q[index]),
      round6(prices[index]),
    ]);
  }
  const headline = Math.min(0.99, Math.max(0.01, headlineProbability(market, outcomes, prices)));
  await client.query(
    `UPDATE market.prediction_markets
     SET last_traded_probability = $2, last_trade_at = CASE WHEN $3::numeric > 0 THEN $4 ELSE last_trade_at END,
         total_volume_cash = total_volume_cash + $3, updated_at = now()
     WHERE id = $1`,
    [market.id, round6(headline), round2(tradedCash), at]
  );
}

const BUCKETS = [
  ["1m", 60_000],
  ["5m", 300_000],
  ["1h", 3_600_000],
  ["1d", 86_400_000],
];

/** Price history for every outcome (all prices move on every trade); volume on the traded one. */
async function recordHistory(client, marketId, outcomes, prices, { tradedIndex = -1, shares = 0, cash = 0, at = new Date() } = {}) {
  for (const [interval, size] of BUCKETS) {
    const bucket = new Date(Math.floor(at.getTime() / size) * size);
    for (const [index, outcome] of outcomes.entries()) {
      const price = round6(prices[index]);
      const traded = index === tradedIndex;
      await client.query(
        `INSERT INTO market.prediction_market_price_history
           (market_id, outcome_id, bucket_interval, bucket_ts, open, high, low, close, last, volume_shares, volume_cash, trade_count)
         VALUES ($1, $2, $3, $4, $5, $5, $5, $5, $5, $6, $7, $8)
         ON CONFLICT (market_id, outcome_id, bucket_interval, bucket_ts) DO UPDATE SET
           high = GREATEST(market.prediction_market_price_history.high, EXCLUDED.high),
           low = LEAST(market.prediction_market_price_history.low, EXCLUDED.low),
           close = EXCLUDED.close, last = EXCLUDED.last,
           volume_shares = market.prediction_market_price_history.volume_shares + EXCLUDED.volume_shares,
           volume_cash = market.prediction_market_price_history.volume_cash + EXCLUDED.volume_cash,
           trade_count = market.prediction_market_price_history.trade_count + EXCLUDED.trade_count,
           updated_at = now()`,
        [marketId, outcome.id, interval, bucket, price, traded ? round6(shares) : 0, traded ? round2(cash) : 0, traded ? 1 : 0]
      );
    }
  }
}

async function getPosition(client, userId, marketId, outcomeId) {
  const { rows } = await client.query(
    `SELECT * FROM market.prediction_market_positions WHERE user_id = $1 AND market_id = $2 AND outcome_id = $3 FOR UPDATE`,
    [userId, marketId, outcomeId]
  );
  return rows[0] || null;
}

async function savePosition(client, { userId, marketId, outcomeId, shares, avgEntry, netCost, realized }) {
  await client.query(
    `INSERT INTO market.prediction_market_positions (user_id, market_id, outcome_id, shares, avg_entry_price, net_cost_cash, realized_pnl_cash, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (user_id, market_id, outcome_id) DO UPDATE SET
       shares = EXCLUDED.shares, avg_entry_price = EXCLUDED.avg_entry_price, net_cost_cash = EXCLUDED.net_cost_cash,
       realized_pnl_cash = EXCLUDED.realized_pnl_cash, updated_at = now()`,
    [userId, marketId, outcomeId, round6(Math.max(0, shares)), round6(Math.max(0, avgEntry)), round2(netCost), round2(realized)]
  );
}

async function logEvent(client, marketId, eventType, eventData = {}, actorUserId = null) {
  await client.query(
    `INSERT INTO market.prediction_market_events (market_id, actor_user_id, event_type, event_data) VALUES ($1, $2, $3, $4)`,
    [marketId, actorUserId, eventType, JSON.stringify(eventData)]
  );
}

async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ammState,
  cashBalance,
  ceil2,
  floor2,
  getPosition,
  headlineProbability,
  inTransaction,
  isTradeable,
  loadOutcomes,
  lockMarket,
  logEvent,
  moveCash,
  num,
  predictionError,
  recordHistory,
  round2,
  round6,
  savePosition,
  storePrices,
};
