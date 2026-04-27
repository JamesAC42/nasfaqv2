const predictionMarketDb = require("../predictionMarketDb");
const { ensureUserCashAccount } = require("./portfolioCash");

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function conflict(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function invalidPredictionMarket(message = "invalid_prediction_market") {
  const error = new Error(message);
  error.code = "invalid_prediction_market";
  return error;
}

function normalizeOutcome(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized !== "yes" && normalized !== "no") {
    throw invalidPredictionMarket();
  }
  return normalized;
}

async function insertLedgerEntry(client, entry) {
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
    ) VALUES ($1,NULL,$2,$3,$4,$5,$6)
  `,
    [
      entry.userId,
      entry.entryType,
      entry.quantityDelta,
      entry.cashDelta,
      entry.referenceType,
      entry.referenceId,
    ]
  );
}

async function updateCashBalance(client, userId, deltaCash) {
  if (!deltaCash) return;
  const account = await ensureUserCashAccount(client, userId);
  const nextCash = toNumber(account.cash_balance, 0) + deltaCash;
  if (nextCash < -0.00000001) {
    throw conflict("prediction_cash_invariant_failed");
  }
  await client.query(
    `
    UPDATE market.portfolio_cash_balances
    SET cash_balance = $2, updated_at = now()
    WHERE user_id = $1
  `,
    [userId, nextCash]
  );
}

async function releaseOpenOrdersWithClient(client, marketId, {
  actorUserId = null,
  status = "cancelled",
  reason = "settlement",
} = {}) {
  const orders = await predictionMarketDb.listOpenPredictionOrdersForMarketWithClient(client, marketId);
  const released = [];

  for (const order of orders) {
    const refundableCash = toNumber(order.cash_reserved, 0);
    if (refundableCash > 0) {
      await updateCashBalance(client, order.user_id, refundableCash);
      await insertLedgerEntry(client, {
        userId: order.user_id,
        entryType: "prediction_cash_release",
        quantityDelta: 0,
        cashDelta: refundableCash,
        referenceType: "prediction_order",
        referenceId: Number(order.id),
      });
    }

    await predictionMarketDb.updatePredictionOrderWithClient(client, order.id, {
      open_quantity: 0,
      cash_reserved: 0,
      status,
      cancelled_at: new Date().toISOString(),
    });
    await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
      marketId,
      actorUserId,
      eventType: "order_cancelled",
      eventData: {
        order_id: Number(order.id),
        reason,
        released_cash: refundableCash,
      },
    });
    released.push({ order_id: Number(order.id), released_cash: refundableCash });
  }

  return released;
}

async function recalcOpenInterestWithClient(client, marketId) {
  const { rows } = await client.query(
    `
    SELECT o.id AS yes_outcome_id
    FROM market.prediction_market_outcomes o
    WHERE o.market_id = $1
      AND o.outcome_code = 'yes'
    LIMIT 1
  `,
    [marketId]
  );
  const yesOutcomeId = rows[0]?.yes_outcome_id || null;
  if (!yesOutcomeId) return;

  const result = await client.query(
    `
    SELECT COALESCE(SUM(shares), 0) AS open_interest
    FROM market.prediction_market_positions
    WHERE market_id = $1
      AND outcome_id = $2
  `,
    [marketId, yesOutcomeId]
  );
  await client.query(
    `
    UPDATE market.prediction_markets
    SET open_interest_shares = $2, updated_at = now()
    WHERE id = $1
  `,
    [marketId, toNumber(result.rows[0]?.open_interest, 0)]
  );
}

async function openMarketWithClient(client, marketId, actorUserId = null) {
  const market = await predictionMarketDb.lockPredictionMarketByIdWithClient(client, marketId);
  if (!market) {
    const error = new Error("prediction_market_not_found");
    error.code = "prediction_market_not_found";
    throw error;
  }
  if (market.status !== "open" || market.trading_status !== "pending_open") {
    throw conflict("prediction_market_transition_invalid");
  }

  const updated = await predictionMarketDb.updatePredictionMarketWithClient(client, marketId, {
    trading_status: "open",
    trading_opened_at: new Date().toISOString(),
  });
  await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
    marketId,
    actorUserId,
    eventType: "market_opened",
  });
  return updated;
}

async function closeMarketWithClient(client, marketId, actorUserId = null, { reason = "manual" } = {}) {
  const market = await predictionMarketDb.lockPredictionMarketByIdWithClient(client, marketId);
  if (!market) {
    const error = new Error("prediction_market_not_found");
    error.code = "prediction_market_not_found";
    throw error;
  }
  if (market.status !== "open" || !["open", "pending_open", "halted"].includes(market.trading_status)) {
    throw conflict("prediction_market_transition_invalid");
  }

  const releasedOrders = await releaseOpenOrdersWithClient(client, marketId, {
    actorUserId,
    status: "expired",
    reason: "market_closed",
  });
  const now = new Date().toISOString();
  const updated = await predictionMarketDb.updatePredictionMarketWithClient(client, marketId, {
    status: "closed",
    trading_status: "closed",
    trading_closed_at: now,
  });
  await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
    marketId,
    actorUserId,
    eventType: "market_closed",
    eventData: {
      reason,
      released_order_count: releasedOrders.length,
    },
  });
  return updated;
}

async function markResolvingWithClient(client, marketId) {
  const market = await predictionMarketDb.lockPredictionMarketByIdWithClient(client, marketId);
  if (!market) {
    const error = new Error("prediction_market_not_found");
    error.code = "prediction_market_not_found";
    throw error;
  }
  if (market.status !== "closed" || market.trading_status !== "closed") {
    throw conflict("prediction_market_transition_invalid");
  }
  const updated = await predictionMarketDb.updatePredictionMarketWithClient(client, marketId, {
    status: "resolving",
  });
  await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
    marketId,
    actorUserId: null,
    eventType: "resolution_proposed",
    eventData: { reason: "resolves_after_elapsed" },
  });
  return updated;
}

async function settlePositionsWithClient(client, marketId, winningOutcome) {
  const positions = await predictionMarketDb.listPredictionPositionsForMarketWithClient(client, marketId);
  const settled = [];

  for (const position of positions) {
    const shares = toNumber(position.shares, 0);
    if (shares <= 0) continue;

    const avgEntry = toNumber(position.avg_entry_price, 0);
    const isWinner = position.outcome_code === winningOutcome;
    const payout = isWinner ? shares : 0;
    const realizedDelta = ((isWinner ? 1 : 0) - avgEntry) * shares;
    const nextRealizedPnl = toNumber(position.realized_pnl_cash, 0) + realizedDelta;

    if (payout > 0) {
      await updateCashBalance(client, position.user_id, payout);
    }
    await insertLedgerEntry(client, {
      userId: position.user_id,
      entryType: isWinner ? "prediction_payout_win" : "prediction_payout_loss",
      quantityDelta: -shares,
      cashDelta: payout,
      referenceType: "prediction_resolution",
      referenceId: marketId,
    });
    await predictionMarketDb.updatePredictionPositionWithClient(client, {
      userId: position.user_id,
      marketId,
      outcomeId: position.outcome_id,
      shares: 0,
      avgEntryPrice: 0,
      realizedPnlCash: Number(nextRealizedPnl.toFixed(8)),
    });
    settled.push({
      user_id: Number(position.user_id),
      outcome_code: position.outcome_code,
      shares,
      payout,
      realized_pnl_delta: Number(realizedDelta.toFixed(8)),
    });
  }

  await recalcOpenInterestWithClient(client, marketId);
  return settled;
}

async function voidPositionsWithClient(client, marketId) {
  const positions = await predictionMarketDb.listPredictionPositionsForMarketWithClient(client, marketId);
  const refunded = [];

  for (const position of positions) {
    const shares = toNumber(position.shares, 0);
    if (shares <= 0) continue;

    const avgEntry = toNumber(position.avg_entry_price, 0);
    const refund = avgEntry * shares;
    if (refund > 0) {
      await updateCashBalance(client, position.user_id, refund);
    }
    await insertLedgerEntry(client, {
      userId: position.user_id,
      entryType: "prediction_void",
      quantityDelta: -shares,
      cashDelta: refund,
      referenceType: "prediction_void",
      referenceId: marketId,
    });
    await predictionMarketDb.updatePredictionPositionWithClient(client, {
      userId: position.user_id,
      marketId,
      outcomeId: position.outcome_id,
      shares: 0,
      avgEntryPrice: 0,
      realizedPnlCash: toNumber(position.realized_pnl_cash, 0),
    });
    refunded.push({
      user_id: Number(position.user_id),
      outcome_code: position.outcome_code,
      shares,
      refund,
    });
  }

  await recalcOpenInterestWithClient(client, marketId);
  return refunded;
}

async function runMarketTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function openDuePredictionMarkets(pool, { now = new Date(), limit = 100 } = {}) {
  return runMarketTransaction(pool, async (client) => {
    const ids = await predictionMarketDb.listDuePendingOpenPredictionMarketIdsWithClient(client, now.toISOString(), { limit });
    const markets = [];
    for (const id of ids) {
      markets.push(await openMarketWithClient(client, id, null));
    }
    return markets;
  });
}

async function closeDuePredictionMarkets(pool, { now = new Date(), limit = 100 } = {}) {
  return runMarketTransaction(pool, async (client) => {
    const ids = await predictionMarketDb.listDueOpenPredictionMarketIdsWithClient(client, now.toISOString(), { limit });
    const markets = [];
    for (const id of ids) {
      markets.push(await closeMarketWithClient(client, id, null, { reason: "closes_at_elapsed" }));
    }
    return markets;
  });
}

async function markDuePredictionMarketsResolving(pool, { now = new Date(), limit = 100 } = {}) {
  return runMarketTransaction(pool, async (client) => {
    const ids = await predictionMarketDb.listDueResolvingPredictionMarketIdsWithClient(client, now.toISOString(), { limit });
    const markets = [];
    for (const id of ids) {
      markets.push(await markResolvingWithClient(client, id));
    }
    return markets;
  });
}

async function closePredictionMarket(pool, marketId, actorUser, { reason = "manual" } = {}) {
  return runMarketTransaction(pool, (client) => closeMarketWithClient(client, marketId, actorUser?.id || null, { reason }));
}

async function resolvePredictionMarket(pool, marketId, actorUser, { outcome, notes = null } = {}) {
  const winningOutcome = normalizeOutcome(outcome);
  const cleanNotes = notes === null || notes === undefined ? null : String(notes).trim().slice(0, 2000) || null;

  return runMarketTransaction(pool, async (client) => {
    const market = await predictionMarketDb.lockPredictionMarketByIdWithClient(client, marketId);
    if (!market) {
      const error = new Error("prediction_market_not_found");
      error.code = "prediction_market_not_found";
      throw error;
    }
    if (!["closed", "resolving"].includes(market.status) || !["closed", "halted"].includes(market.trading_status)) {
      throw conflict("prediction_market_transition_invalid");
    }

    const releasedOrders = await releaseOpenOrdersWithClient(client, marketId, {
      actorUserId: actorUser?.id || null,
      status: "cancelled",
      reason: "market_resolved",
    });
    const settledPositions = await settlePositionsWithClient(client, marketId, winningOutcome);

    await client.query(
      `
      UPDATE market.prediction_market_outcomes
      SET is_winner = outcome_code = $2,
          updated_at = now()
      WHERE market_id = $1
    `,
      [marketId, winningOutcome]
    );

    const now = new Date().toISOString();
    const updated = await predictionMarketDb.updatePredictionMarketWithClient(client, marketId, {
      status: "resolved",
      trading_status: "resolved",
      resolver_user_id: actorUser?.id || null,
      resolution_outcome: winningOutcome,
      resolution_notes: cleanNotes,
      resolved_at: now,
    });
    await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
      marketId,
      actorUserId: actorUser?.id || null,
      eventType: "market_resolved",
      eventData: {
        outcome: winningOutcome,
        notes: cleanNotes,
        released_order_count: releasedOrders.length,
        settled_position_count: settledPositions.length,
      },
    });
    return updated;
  });
}

async function voidPredictionMarket(pool, marketId, actorUser, { reason = null } = {}) {
  const cleanReason = reason === null || reason === undefined ? null : String(reason).trim().slice(0, 2000) || null;

  return runMarketTransaction(pool, async (client) => {
    const market = await predictionMarketDb.lockPredictionMarketByIdWithClient(client, marketId);
    if (!market) {
      const error = new Error("prediction_market_not_found");
      error.code = "prediction_market_not_found";
      throw error;
    }
    if (["resolved", "voided"].includes(market.status) || ["resolved", "voided"].includes(market.trading_status)) {
      throw conflict("prediction_market_transition_invalid");
    }

    const releasedOrders = await releaseOpenOrdersWithClient(client, marketId, {
      actorUserId: actorUser?.id || null,
      status: "cancelled",
      reason: "market_voided",
    });
    const refundedPositions = await voidPositionsWithClient(client, marketId);

    await client.query(
      `
      UPDATE market.prediction_market_outcomes
      SET is_winner = false,
          updated_at = now()
      WHERE market_id = $1
    `,
      [marketId]
    );

    const updated = await predictionMarketDb.updatePredictionMarketWithClient(client, marketId, {
      status: "voided",
      trading_status: "voided",
      resolver_user_id: actorUser?.id || null,
      resolution_outcome: "void",
      resolution_notes: cleanReason,
      voided_at: new Date().toISOString(),
    });
    await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
      marketId,
      actorUserId: actorUser?.id || null,
      eventType: "market_voided",
      eventData: {
        reason: cleanReason,
        released_order_count: releasedOrders.length,
        refunded_position_count: refundedPositions.length,
      },
    });
    return updated;
  });
}

module.exports = {
  closeDuePredictionMarkets,
  closePredictionMarket,
  markDuePredictionMarketsResolving,
  openDuePredictionMarkets,
  resolvePredictionMarket,
  voidPredictionMarket,
};
