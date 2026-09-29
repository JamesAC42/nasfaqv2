// Predictions v2 trading (docs/predictions/PREDICTIONS_DESIGN.md §2–3): instant buys and sells
// against the LMSR market maker, plus limit orders that rest until the price reaches them and then
// fill against the market maker up to their limit.

const lmsr = require("./lmsr");
const core = require("./core");

const { num, round2, round6, ceil2, floor2, predictionError } = core;

const MIN_TRADE_CASH = 1;
const MAX_TRADE_CASH = 25_000;
const POSITION_CAP_SHARES = 25_000;
const MAX_SWEEP_FILLS = 60;
const DUST_SHARES = 0.000001;

function outcomeIndex(outcomes, code) {
  const index = outcomes.findIndex((outcome) => outcome.outcome_code === String(code || "").toLowerCase());
  if (index < 0) throw predictionError("invalid_outcome");
  return index;
}

function pricesView(outcomes, prices) {
  return outcomes.map((outcome, index) => ({ outcome_id: Number(outcome.id), outcome_code: outcome.outcome_code, price: round6(prices[index]) }));
}

// ── Pricing (pure given state) ─────────────────────────────────────────────
/** What a buy of `cashAmount` (fee included) gets right now. `ceiling` caps the resulting price. */
function priceBuy(state, index, cashAmount, feeRate, { ceiling = lmsr.PRICE_CEIL, heldShares = 0 } = {}) {
  const budgetCurve = cashAmount / (1 + feeRate);
  let shares = lmsr.sharesForCash(state.q, state.b, index, budgetCurve);
  let capped = false;
  const railShares = lmsr.maxBuyShares(state.q, state.b, index, ceiling);
  if (shares > railShares) {
    shares = railShares;
    capped = "price";
  }
  if (shares > POSITION_CAP_SHARES - heldShares) {
    shares = Math.max(0, POSITION_CAP_SHARES - heldShares);
    capped = "position";
  }
  if (shares < DUST_SHARES) return null;
  const curve = capped ? lmsr.buyCost(state.q, state.b, index, shares) : budgetCurve;
  // Never more than the amount offered (limit orders spend from an exact reserve).
  const total = Math.min(ceil2(curve * (1 + feeRate)), round2(cashAmount));
  const fee = Math.max(0, round2(total - curve));
  const after = lmsr.prices(state.q.map((value, i) => (i === index ? value + shares : value)), state.b);
  return { shares: round6(shares), curve, fee, total, avg: curve / shares, pricesAfter: after, capped };
}

/** What selling `shares` pays right now. `floor` caps how low the price may go. */
function priceSell(state, index, shares, feeRate, { floor = lmsr.PRICE_FLOOR } = {}) {
  let amount = shares;
  let capped = false;
  const railShares = lmsr.maxSellShares(state.q, state.b, index, floor);
  if (amount > railShares) {
    amount = railShares;
    capped = "price";
  }
  if (amount < DUST_SHARES) return null;
  const curve = lmsr.sellProceeds(state.q, state.b, index, amount);
  const payout = floor2(curve * (1 - feeRate));
  const fee = Math.max(0, round2(curve - payout));
  const after = lmsr.prices(state.q.map((value, i) => (i === index ? value - amount : value)), state.b);
  return { shares: round6(amount), curve, fee, payout, avg: curve / amount, pricesAfter: after, capped };
}

// ── Executions (inside a transaction, market row locked) ───────────────────
async function applyFill(client, market, outcomes, state, { userId, index, side, fill, limitOrderId = null }) {
  const nextQ = state.q.map((value, i) => (i === index ? value + (side === "buy" ? fill.shares : -fill.shares) : value));
  const outcome = outcomes[index];
  const now = new Date();
  const cash = side === "buy" ? fill.total : fill.payout;
  await client.query(
    `INSERT INTO market.prediction_market_trades
       (market_id, outcome_id, trade_kind, taker_user_id, taker_outcome_id, taker_side, buy_user_id, sell_user_id, price, quantity,
        notional_cash, fee_cash_buy, fee_cash_sell, matched_at, limit_order_id, price_after, prices_after)
     VALUES ($1, $2, 'amm', $3, $2, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      market.id,
      outcome.id,
      userId,
      side,
      side === "buy" ? userId : null,
      side === "sell" ? userId : null,
      round6(Math.min(0.99, Math.max(0.01, fill.avg))),
      fill.shares,
      round2(fill.curve),
      side === "buy" ? fill.fee : 0,
      side === "sell" ? fill.fee : 0,
      now,
      limitOrderId,
      round6(fill.pricesAfter[index]),
      JSON.stringify(pricesView(outcomes, fill.pricesAfter)),
    ]
  );
  await client.query(`UPDATE market.prediction_markets SET house_net_cash = house_net_cash + $2 WHERE id = $1`, [market.id, round2(side === "buy" ? cash : -cash)]);
  await core.storePrices(client, market, outcomes, nextQ, fill.pricesAfter, { tradedCash: fill.curve, at: now });
  await core.recordHistory(client, market.id, outcomes, fill.pricesAfter, { tradedIndex: index, shares: fill.shares, cash: fill.curve, at: now });
  state.q = nextQ;
  state.prices = fill.pricesAfter;
  return {
    market_id: Number(market.id),
    slug: market.slug,
    outcome_code: outcome.outcome_code,
    outcome_label: outcome.label,
    side,
    shares: fill.shares,
    cash,
    fee: fill.fee,
    avg_price: round6(fill.avg),
    price_after: round6(fill.pricesAfter[index]),
    prices: pricesView(outcomes, fill.pricesAfter),
    limit_order_id: limitOrderId,
    at: now.toISOString(),
  };
}

/** A buy paid from the user's cash (market order) or from a limit order's reserve. */
async function executeBuy(client, market, outcomes, state, { userId, index, cashAmount, ceiling, maxAvgPrice = null, fromReserve = false, limitOrderId = null }) {
  const outcome = outcomes[index];
  const position = await core.getPosition(client, userId, market.id, outcome.id);
  const held = num(position?.shares);
  const feeRate = num(market.fee_bps, 100) / 10_000;
  const fill = priceBuy(state, index, cashAmount, feeRate, { ceiling, heldShares: held });
  if (!fill) return null;
  if (maxAvgPrice !== null && fill.avg > maxAvgPrice + 1e-9) {
    throw predictionError("price_moved", { quote: quoteView(fill, "buy") });
  }
  if (!fromReserve) {
    await core.moveCash(client, userId, -fill.total, { entryType: "prediction_buy", marketId: market.id, quantityDelta: fill.shares });
  }
  const shares = held + fill.shares;
  const avg = (held * num(position?.avg_entry_price) + fill.total) / shares;
  await core.savePosition(client, {
    userId,
    marketId: market.id,
    outcomeId: outcome.id,
    shares,
    avgEntry: avg,
    netCost: num(position?.net_cost_cash) + fill.total,
    realized: num(position?.realized_pnl_cash),
  });
  return applyFill(client, market, outcomes, state, { userId, index, side: "buy", fill, limitOrderId });
}

/** A sell of held shares (market order) or of a sell-limit's reserved shares. */
async function executeSell(client, market, outcomes, state, { userId, index, shares, floor, minAvgPrice = null, fromReserve = false, limitOrderId = null }) {
  const outcome = outcomes[index];
  const position = await core.getPosition(client, userId, market.id, outcome.id);
  const held = num(position?.shares);
  if (!fromReserve && shares > held + DUST_SHARES) throw predictionError("insufficient_shares", { shares_held: held });
  const feeRate = num(market.fee_bps, 100) / 10_000;
  const fill = priceSell(state, index, Math.min(shares, fromReserve ? shares : held), feeRate, { floor });
  if (!fill) return null;
  if (minAvgPrice !== null && fill.avg < minAvgPrice - 1e-9) {
    throw predictionError("price_moved", { quote: quoteView(fill, "sell") });
  }
  await core.moveCash(client, userId, fill.payout, { entryType: "prediction_sell", marketId: market.id, quantityDelta: -fill.shares });
  const avg = num(position?.avg_entry_price);
  await core.savePosition(client, {
    userId,
    marketId: market.id,
    outcomeId: outcome.id,
    shares: fromReserve ? held : held - fill.shares,
    // Keep the average even at zero: reserved sell-limit shares still carry it.
    avgEntry: avg,
    netCost: num(position?.net_cost_cash) - fill.payout,
    realized: num(position?.realized_pnl_cash) + fill.payout - avg * fill.shares,
  });
  return applyFill(client, market, outcomes, state, { userId, index, side: "sell", fill, limitOrderId });
}

function quoteView(fill, side) {
  return {
    side,
    shares: fill.shares,
    avg_price: round6(fill.avg),
    fee: fill.fee,
    total: side === "buy" ? fill.total : undefined,
    payout: side === "sell" ? fill.payout : undefined,
    capped: fill.capped || null,
  };
}

async function loadTradeableMarket(client, slug) {
  const market = await core.lockMarket(client, { slug });
  if (!core.isTradeable(market)) throw predictionError("prediction_market_closed");
  const outcomes = await core.loadOutcomes(client, market.id);
  return { market, outcomes, state: core.ammState(market, outcomes) };
}

// ── Public operations ──────────────────────────────────────────────────────
/** Preview for the ticket: no lock, no writes. */
async function quote(pool, { slug, outcomeCode, side, amount = null, shares = null, userId = null }) {
  const { rows } = await pool.query(`SELECT * FROM market.prediction_markets WHERE slug = $1`, [slug]);
  const market = rows[0];
  if (!market) throw predictionError("prediction_market_not_found");
  const outcomes = await core.loadOutcomes(pool, market.id);
  const state = core.ammState(market, outcomes);
  const index = outcomeIndex(outcomes, outcomeCode);
  const feeRate = num(market.fee_bps, 100) / 10_000;
  let held = 0;
  if (userId) {
    const position = await pool.query(`SELECT shares FROM market.prediction_market_positions WHERE user_id = $1 AND market_id = $2 AND outcome_id = $3`, [userId, market.id, outcomes[index].id]);
    held = num(position.rows[0]?.shares);
  }
  const fill = side === "sell" ? priceSell(state, index, num(shares), feeRate) : priceBuy(state, index, num(amount), feeRate, { heldShares: held });
  return {
    slug,
    outcome_code: outcomes[index].outcome_code,
    price: round6(state.prices[index]),
    tradeable: core.isTradeable(market),
    quote: fill ? { ...quoteView(fill, side === "sell" ? "sell" : "buy"), price_after: round6(fill.pricesAfter[index]), payout_if_right: side === "sell" ? null : round2(fill.shares) } : null,
  };
}

async function trade(pool, { userId, slug, outcomeCode, side, amount = null, shares = null, maxAvgPrice = null, minAvgPrice = null }) {
  const result = await core.inTransaction(pool, async (client) => {
    const { market, outcomes, state } = await loadTradeableMarket(client, slug);
    const index = outcomeIndex(outcomes, outcomeCode);
    let fill;
    if (side === "buy") {
      const cash = round2(num(amount));
      if (!(cash >= MIN_TRADE_CASH) || cash > MAX_TRADE_CASH) throw predictionError("invalid_amount");
      fill = await executeBuy(client, market, outcomes, state, { userId, index, cashAmount: cash, maxAvgPrice: maxAvgPrice === null ? null : num(maxAvgPrice) });
    } else if (side === "sell") {
      const count = num(shares);
      if (!(count > 0)) throw predictionError("invalid_amount");
      fill = await executeSell(client, market, outcomes, state, { userId, index, shares: count, minAvgPrice: minAvgPrice === null ? null : num(minAvgPrice) });
    } else {
      throw predictionError("invalid_side");
    }
    if (!fill) throw predictionError("price_at_limit");
    const cashBalance = await core.cashBalance(client, userId);
    return { fill, market_id: Number(market.id), cash_balance: cashBalance };
  });
  const swept = await sweepMarket(pool, result.market_id);
  return { ...result, fills: [result.fill, ...swept] };
}

async function placeLimitOrder(pool, { userId, slug, outcomeCode, side, limitPrice, amount = null, shares = null }) {
  const price = Math.round(num(limitPrice) * 100) / 100;
  if (!(price >= 0.01 && price <= 0.99)) throw predictionError("invalid_limit_price");
  const order = await core.inTransaction(pool, async (client) => {
    const { market, outcomes } = await loadTradeableMarket(client, slug);
    const index = outcomeIndex(outcomes, outcomeCode);
    const outcome = outcomes[index];
    if (side === "buy") {
      const cash = round2(num(amount));
      if (!(cash >= MIN_TRADE_CASH) || cash > MAX_TRADE_CASH) throw predictionError("invalid_amount");
      const { rows } = await client.query(
        `INSERT INTO market.prediction_limit_orders (market_id, outcome_id, user_id, side, limit_price, cash_budget, cash_reserved)
         VALUES ($1, $2, $3, 'buy', $4, $5, $5) RETURNING *`,
        [market.id, outcome.id, userId, price, cash]
      );
      await core.moveCash(client, userId, -cash, { entryType: "prediction_limit_reserve", marketId: market.id, referenceType: "prediction_limit_order", referenceId: rows[0].id });
      return rows[0];
    }
    if (side === "sell") {
      const count = round6(num(shares));
      const position = await core.getPosition(client, userId, market.id, outcome.id);
      if (!(count > 0) || count > num(position?.shares) + DUST_SHARES) throw predictionError("insufficient_shares", { shares_held: num(position?.shares) });
      const reserve = Math.min(count, num(position.shares));
      await core.savePosition(client, {
        userId,
        marketId: market.id,
        outcomeId: outcome.id,
        shares: num(position.shares) - reserve,
        avgEntry: num(position.avg_entry_price),
        netCost: num(position.net_cost_cash),
        realized: num(position.realized_pnl_cash),
      });
      const { rows } = await client.query(
        `INSERT INTO market.prediction_limit_orders (market_id, outcome_id, user_id, side, limit_price, shares_total, shares_reserved)
         VALUES ($1, $2, $3, 'sell', $4, $5, $5) RETURNING *`,
        [market.id, outcome.id, userId, price, reserve]
      );
      return rows[0];
    }
    throw predictionError("invalid_side");
  });
  const fills = await sweepMarket(pool, order.market_id);
  const { rows } = await pool.query(`SELECT * FROM market.prediction_limit_orders WHERE id = $1`, [order.id]);
  return { order: limitOrderView(rows[0]), fills };
}

async function cancelLimitOrder(pool, { userId, orderId }) {
  return core.inTransaction(pool, async (client) => {
    const { rows } = await client.query(`SELECT market_id FROM market.prediction_limit_orders WHERE id = $1`, [orderId]);
    if (!rows[0]) throw predictionError("order_not_found");
    await core.lockMarket(client, { id: rows[0].market_id });
    const order = (await client.query(`SELECT * FROM market.prediction_limit_orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
    if (String(order.user_id) !== String(userId)) throw predictionError("forbidden");
    if (order.status !== "open") throw predictionError("order_not_open");
    await releaseOrderWithClient(client, order, "cancelled", "cancelled");
    return limitOrderView({ ...order, status: "cancelled" });
  });
}

/** Returns an order's reserve to its owner and closes it. */
async function releaseOrderWithClient(client, order, status, reason) {
  if (order.side === "buy" && num(order.cash_reserved) > 0) {
    await core.moveCash(client, order.user_id, num(order.cash_reserved), {
      entryType: "prediction_limit_release",
      marketId: order.market_id,
      referenceType: "prediction_limit_order",
      referenceId: order.id,
    });
  }
  if (order.side === "sell" && num(order.shares_reserved) > 0) {
    const position = await core.getPosition(client, order.user_id, order.market_id, order.outcome_id);
    await core.savePosition(client, {
      userId: order.user_id,
      marketId: order.market_id,
      outcomeId: order.outcome_id,
      shares: num(position?.shares) + num(order.shares_reserved),
      avgEntry: num(position?.avg_entry_price),
      netCost: num(position?.net_cost_cash),
      realized: num(position?.realized_pnl_cash),
    });
  }
  await client.query(
    `UPDATE market.prediction_limit_orders SET status = $2, close_reason = $3, cash_reserved = 0, shares_reserved = 0, closed_at = now(), updated_at = now() WHERE id = $1`,
    [order.id, status, reason]
  );
}

/** Close, resolve and void call this first so nothing stays reserved. */
async function releaseMarketOrdersWithClient(client, marketId, reason) {
  const { rows } = await client.query(`SELECT * FROM market.prediction_limit_orders WHERE market_id = $1 AND status = 'open' FOR UPDATE`, [marketId]);
  for (const order of rows) await releaseOrderWithClient(client, order, "released", reason);
  return rows.length;
}

/**
 * Fills resting limit orders whose price has been reached, oldest first, re-checking after every
 * fill (each fill moves prices). One transaction per fill so a long sweep never holds the lock.
 */
async function sweepMarket(pool, marketId) {
  const fills = [];
  for (let step = 0; step < MAX_SWEEP_FILLS; step += 1) {
    const fill = await core.inTransaction(pool, async (client) => {
      const market = await core.lockMarket(client, { id: marketId });
      if (!core.isTradeable(market)) return null;
      const outcomes = await core.loadOutcomes(client, market.id);
      const state = core.ammState(market, outcomes);
      const { rows } = await client.query(
        `SELECT * FROM market.prediction_limit_orders WHERE market_id = $1 AND status = 'open' ORDER BY created_at, id FOR UPDATE`,
        [market.id]
      );
      for (const order of rows) {
        const index = outcomes.findIndex((outcome) => String(outcome.id) === String(order.outcome_id));
        const price = state.prices[index];
        const limit = num(order.limit_price);
        if (order.side === "buy" && price < limit - 1e-6) {
          const made = await executeBuy(client, market, outcomes, state, {
            userId: order.user_id,
            index,
            cashAmount: num(order.cash_reserved),
            ceiling: limit,
            fromReserve: true,
            limitOrderId: order.id,
          });
          if (!made) continue;
          const reserved = round2(num(order.cash_reserved) - made.cash);
          // Out of budget = filled; otherwise it rests at its limit for the next dip.
          const done = reserved < 0.01;
          await client.query(
            `UPDATE market.prediction_limit_orders SET cash_reserved = $2, spent_cash = spent_cash + $3, filled_shares = filled_shares + $4,
               status = $5, closed_at = CASE WHEN $5 = 'filled' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`,
            [order.id, Math.max(0, reserved), made.cash, made.shares, done ? "filled" : "open"]
          );
          if (done && reserved > 0) {
            await core.moveCash(client, order.user_id, reserved, { entryType: "prediction_limit_release", marketId: market.id, referenceType: "prediction_limit_order", referenceId: order.id });
            await client.query(`UPDATE market.prediction_limit_orders SET cash_reserved = 0 WHERE id = $1`, [order.id]);
          }
          return { ...made, order_status: done ? "filled" : "open" };
        }
        if (order.side === "sell" && price > limit + 1e-6) {
          const made = await executeSell(client, market, outcomes, state, {
            userId: order.user_id,
            index,
            shares: num(order.shares_reserved),
            floor: limit,
            fromReserve: true,
            limitOrderId: order.id,
          });
          if (!made) continue;
          const left = round6(num(order.shares_reserved) - made.shares);
          const done = left < DUST_SHARES;
          await client.query(
            `UPDATE market.prediction_limit_orders SET shares_reserved = $2, received_cash = received_cash + $3, filled_shares = filled_shares + $4,
               status = $5, closed_at = CASE WHEN $5 = 'filled' THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`,
            [order.id, Math.max(0, left), made.cash, made.shares, done ? "filled" : "open"]
          );
          return { ...made, order_status: done ? "filled" : "open" };
        }
      }
      return null;
    });
    if (!fill) break;
    fills.push(fill);
  }
  return fills;
}

async function sweepAllMarkets(pool) {
  const { rows } = await pool.query(`SELECT DISTINCT market_id FROM market.prediction_limit_orders WHERE status = 'open'`);
  const fills = [];
  for (const row of rows) fills.push(...(await sweepMarket(pool, Number(row.market_id))));
  return fills;
}

function limitOrderView(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    market_id: Number(row.market_id),
    outcome_id: Number(row.outcome_id),
    side: row.side,
    limit_price: num(row.limit_price),
    cash_budget: num(row.cash_budget),
    cash_reserved: num(row.cash_reserved),
    shares_total: num(row.shares_total),
    shares_reserved: num(row.shares_reserved),
    filled_shares: num(row.filled_shares),
    spent_cash: num(row.spent_cash),
    received_cash: num(row.received_cash),
    status: row.status,
    close_reason: row.close_reason,
    created_at: row.created_at,
  };
}

module.exports = {
  MAX_TRADE_CASH,
  MIN_TRADE_CASH,
  POSITION_CAP_SHARES,
  cancelLimitOrder,
  limitOrderView,
  placeLimitOrder,
  priceBuy,
  priceSell,
  quote,
  releaseMarketOrdersWithClient,
  sweepAllMarkets,
  sweepMarket,
  trade,
};
