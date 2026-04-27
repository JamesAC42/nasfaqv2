const predictionMarketDb = require("../predictionMarketDb");
const { ensureUserCashAccount } = require("./portfolioCash");

const VALID_INTERVALS = new Set(["1m", "5m", "1h", "1d"]);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function invalidPredictionMarketOrder(message = "invalid_prediction_market_order") {
  const error = new Error(message);
  error.code = "invalid_prediction_market_order";
  return error;
}

function conflict(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requirePositiveNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw invalidPredictionMarketOrder();
  }
  return parsed;
}

function normalizeOutcomeCode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized !== "yes" && normalized !== "no") {
    throw invalidPredictionMarketOrder();
  }
  return normalized;
}

function normalizeSide(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized !== "buy" && normalized !== "sell") {
    throw invalidPredictionMarketOrder();
  }
  return normalized;
}

function normalizePrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 0.99) {
    throw invalidPredictionMarketOrder();
  }
  return Number(parsed.toFixed(4));
}

function bucketDate(ts, interval) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();

  if (interval === "1m") return new Date(Date.UTC(year, month, day, hour, minute, 0, 0)).toISOString();
  if (interval === "5m") return new Date(Date.UTC(year, month, day, hour, Math.floor(minute / 5) * 5, 0, 0)).toISOString();
  if (interval === "1h") return new Date(Date.UTC(year, month, day, hour, 0, 0, 0)).toISOString();
  if (interval === "1d") return new Date(Date.UTC(year, month, day, 0, 0, 0, 0)).toISOString();
  return null;
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
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
  `,
    [
      entry.userId,
      null,
      entry.entryType,
      entry.quantityDelta,
      entry.cashDelta,
      entry.referenceType,
      entry.referenceId,
    ]
  );
}

async function updateCashBalance(client, userId, nextCashBalance) {
  await client.query(
    `
    UPDATE market.portfolio_cash_balances
    SET cash_balance = $2, updated_at = now()
    WHERE user_id = $1
  `,
    [userId, nextCashBalance]
  );
}

async function getPredictionPositionWithClient(client, userId, marketId, outcomeId) {
  const { rows } = await client.query(
    `
    SELECT user_id, market_id, outcome_id, shares, avg_entry_price, realized_pnl_cash
    FROM market.prediction_market_positions
    WHERE user_id = $1
      AND market_id = $2
      AND outcome_id = $3
    FOR UPDATE
  `,
    [userId, marketId, outcomeId]
  );
  return rows[0] || null;
}

async function upsertPredictionPositionWithClient(client, {
  userId,
  marketId,
  outcomeId,
  shares,
  avgEntryPrice,
  realizedPnlCash,
} = {}) {
  await client.query(
    `
    INSERT INTO market.prediction_market_positions (
      user_id,
      market_id,
      outcome_id,
      shares,
      avg_entry_price,
      realized_pnl_cash,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT (user_id, market_id, outcome_id)
    DO UPDATE SET
      shares = EXCLUDED.shares,
      avg_entry_price = EXCLUDED.avg_entry_price,
      realized_pnl_cash = EXCLUDED.realized_pnl_cash,
      updated_at = now()
  `,
    [userId, marketId, outcomeId, shares, avgEntryPrice, realizedPnlCash]
  );
}

async function getUserReservedSellQuantityWithClient(client, userId, marketId, outcomeId) {
  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(open_quantity), 0) AS reserved_quantity
    FROM market.prediction_market_orders
    WHERE user_id = $1
      AND market_id = $2
      AND outcome_id = $3
      AND side = 'sell'
      AND status IN ('open', 'partially_filled')
  `,
    [userId, marketId, outcomeId]
  );
  return toNumber(rows[0]?.reserved_quantity, 0);
}

async function insertOrderWithClient(client, {
  marketId,
  outcomeId,
  userId,
  side,
  price,
  quantity,
  cashReserved,
} = {}) {
  const { rows } = await client.query(
    `
    INSERT INTO market.prediction_market_orders (
      market_id,
      outcome_id,
      user_id,
      side,
      order_type,
      time_in_force,
      funding_type,
      price,
      original_quantity,
      open_quantity,
      matched_quantity,
      cash_reserved,
      status,
      updated_at
    ) VALUES ($1,$2,$3,$4,'limit','gtc','cash',$5,$6,$6,0,$7,'open',now())
    RETURNING *
  `,
    [marketId, outcomeId, userId, side, price, quantity, cashReserved]
  );
  return rows[0];
}

async function updateOrderWithClient(client, orderId, changes) {
  const entries = Object.entries(changes || {});
  if (!entries.length) return;

  const values = [orderId];
  const setters = [];
  for (const [key, value] of entries) {
    values.push(value);
    setters.push(`${key} = $${values.length}`);
  }
  setters.push("updated_at = now()");

  await client.query(
    `
    UPDATE market.prediction_market_orders
    SET ${setters.join(", ")}
    WHERE id = $1
  `,
    values
  );
}

async function insertTradeWithClient(client, trade) {
  const { rows } = await client.query(
    `
    INSERT INTO market.prediction_market_trades (
      market_id,
      outcome_id,
      trade_kind,
      maker_order_id,
      taker_order_id,
      maker_user_id,
      taker_user_id,
      maker_outcome_id,
      taker_outcome_id,
      maker_side,
      taker_side,
      buy_order_id,
      sell_order_id,
      buy_user_id,
      sell_user_id,
      price,
      quantity,
      notional_cash,
      fee_cash_buy,
      fee_cash_sell,
      matched_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,0,0,$19)
    RETURNING id, matched_at
  `,
    [
      trade.marketId,
      trade.canonicalOutcomeId,
      trade.tradeKind,
      trade.makerOrderId,
      trade.takerOrderId,
      trade.makerUserId,
      trade.takerUserId,
      trade.makerOutcomeId,
      trade.takerOutcomeId,
      trade.makerSide,
      trade.takerSide,
      trade.buyOrderId,
      trade.sellOrderId,
      trade.buyUserId,
      trade.sellUserId,
      trade.yesProbability,
      trade.quantity,
      trade.notionalCash,
      trade.matchedAt,
    ]
  );
  return rows[0];
}

async function listSameBookCandidatesWithClient(client, {
  marketId,
  outcomeId,
  takerSide,
  takerPrice,
} = {}) {
  const makerSide = takerSide === "buy" ? "sell" : "buy";
  const comparator = takerSide === "buy" ? "<=" : ">=";
  const orderBy = takerSide === "buy"
    ? "ord.price ASC, ord.created_at ASC, ord.id ASC"
    : "ord.price DESC, ord.created_at ASC, ord.id ASC";

  const { rows } = await client.query(
    `
    SELECT *
    FROM market.prediction_market_orders ord
    WHERE ord.market_id = $1
      AND ord.outcome_id = $2
      AND ord.side = $3
      AND ord.status IN ('open', 'partially_filled')
      AND ord.open_quantity > 0
      AND ord.price ${comparator} $4
    ORDER BY ${orderBy}
    FOR UPDATE
  `,
    [marketId, outcomeId, makerSide, takerPrice]
  );
  return rows;
}

async function listComplementCandidatesWithClient(client, {
  marketId,
  oppositeOutcomeId,
  takerSide,
  takerPrice,
} = {}) {
  const makerSide = takerSide;
  const comparator = takerSide === "buy" ? ">=" : "<=";
  const threshold = takerSide === "buy" ? 1 - takerPrice : 1 - takerPrice;
  const orderBy = takerSide === "buy"
    ? "ord.price DESC, ord.created_at ASC, ord.id ASC"
    : "ord.price ASC, ord.created_at ASC, ord.id ASC";

  const { rows } = await client.query(
    `
    SELECT *
    FROM market.prediction_market_orders ord
    WHERE ord.market_id = $1
      AND ord.outcome_id = $2
      AND ord.side = $3
      AND ord.status IN ('open', 'partially_filled')
      AND ord.open_quantity > 0
      AND ord.price ${comparator} $4
    ORDER BY ${orderBy}
    FOR UPDATE
  `,
    [marketId, oppositeOutcomeId, makerSide, threshold]
  );
  return rows;
}

async function updateOpenInterestWithClient(client, marketId, yesOutcomeId) {
  const { rows } = await client.query(
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
    [marketId, toNumber(rows[0]?.open_interest, 0)]
  );
}

async function updateMarketSnapshotAfterTradeWithClient(client, marketId, yesProbability, notionalCash, matchedAt, yesOutcomeId) {
  await client.query(
    `
    UPDATE market.prediction_markets
    SET
      last_traded_probability = $2,
      last_trade_at = $3,
      total_volume_cash = total_volume_cash + $4,
      updated_at = now()
    WHERE id = $1
  `,
    [marketId, yesProbability, matchedAt, notionalCash]
  );

  await updateOpenInterestWithClient(client, marketId, yesOutcomeId);
}

async function upsertHistoryBucketWithClient(client, {
  marketId,
  outcomeId,
  interval,
  bucketTs,
  price,
  quantity,
  notionalCash,
} = {}) {
  const { rows } = await client.query(
    `
    SELECT 1
    FROM market.prediction_market_price_history
    WHERE market_id = $1
      AND outcome_id = $2
      AND bucket_interval = $3
      AND bucket_ts = $4
    LIMIT 1
    FOR UPDATE
  `,
    [marketId, outcomeId, interval, bucketTs]
  );

  if (!rows[0]) {
    await client.query(
      `
      INSERT INTO market.prediction_market_price_history (
        market_id,
        outcome_id,
        bucket_interval,
        bucket_ts,
        open,
        high,
        low,
        close,
        last,
        volume_shares,
        volume_cash,
        trade_count,
        created_at,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$5,$5,$5,$5,$6,$7,1,now(),now())
    `,
      [marketId, outcomeId, interval, bucketTs, price, quantity, notionalCash]
    );
    return;
  }

  await client.query(
    `
    UPDATE market.prediction_market_price_history
    SET
      high = GREATEST(COALESCE(high, $5), $5),
      low = LEAST(COALESCE(low, $5), $5),
      close = $5,
      last = $5,
      volume_shares = COALESCE(volume_shares, 0) + $6,
      volume_cash = COALESCE(volume_cash, 0) + $7,
      trade_count = COALESCE(trade_count, 0) + 1,
      updated_at = now()
    WHERE market_id = $1
      AND outcome_id = $2
      AND bucket_interval = $3
      AND bucket_ts = $4
  `,
    [marketId, outcomeId, interval, bucketTs, price, quantity, notionalCash]
  );
}

async function recordTradeHistoryWithClient(client, {
  marketId,
  yesOutcomeId,
  noOutcomeId,
  yesProbability,
  quantity,
  notionalCash,
  matchedAt,
} = {}) {
  const noProbability = 1 - yesProbability;
  for (const interval of VALID_INTERVALS) {
    const bucketTs = bucketDate(matchedAt, interval);
    if (!bucketTs) continue;
    await upsertHistoryBucketWithClient(client, {
      marketId,
      outcomeId: yesOutcomeId,
      interval,
      bucketTs,
      price: yesProbability,
      quantity,
      notionalCash,
    });
    await upsertHistoryBucketWithClient(client, {
      marketId,
      outcomeId: noOutcomeId,
      interval,
      bucketTs,
      price: noProbability,
      quantity,
      notionalCash,
    });
  }
}

async function applyPositionDeltaWithClient(client, {
  userId,
  marketId,
  outcomeId,
  deltaShares,
  executionPrice,
} = {}) {
  const existing = await getPredictionPositionWithClient(client, userId, marketId, outcomeId);
  const currentShares = toNumber(existing?.shares, 0);
  const currentAvg = toNumber(existing?.avg_entry_price, 0);
  const currentRealized = toNumber(existing?.realized_pnl_cash, 0);

  if (deltaShares >= 0) {
    const nextShares = currentShares + deltaShares;
    const nextAvg = nextShares > 0
      ? (((currentShares * currentAvg) + (deltaShares * executionPrice)) / nextShares)
      : 0;
    await upsertPredictionPositionWithClient(client, {
      userId,
      marketId,
      outcomeId,
      shares: nextShares,
      avgEntryPrice: Number(nextAvg.toFixed(8)),
      realizedPnlCash: currentRealized,
    });
    return;
  }

  const sharesToRemove = Math.abs(deltaShares);
  if (currentShares < sharesToRemove) {
    throw conflict("prediction_insufficient_holdings");
  }

  const nextShares = currentShares - sharesToRemove;
  const nextRealized = currentRealized + ((executionPrice - currentAvg) * sharesToRemove);
  await upsertPredictionPositionWithClient(client, {
    userId,
    marketId,
    outcomeId,
    shares: nextShares,
    avgEntryPrice: nextShares > 0 ? currentAvg : 0,
    realizedPnlCash: Number(nextRealized.toFixed(8)),
  });
}

function getYesProbability(outcomeCode, outcomeExecutionPrice) {
  return outcomeCode === "yes" ? outcomeExecutionPrice : 1 - outcomeExecutionPrice;
}

function buildSameCandidate(order) {
  return {
    matchKind: "secondary",
    makerOrder: order,
    executionPriceForTaker: toNumber(order.price, 0),
  };
}

function buildComplementCandidate(order) {
  return {
    matchKind: order.side === "buy" ? "mint" : "redeem",
    makerOrder: order,
    executionPriceForTaker: Number((1 - toNumber(order.price, 0)).toFixed(4)),
  };
}

function pickBestCandidate(takerSide, sameCandidate, complementCandidate) {
  if (!sameCandidate) return complementCandidate;
  if (!complementCandidate) return sameCandidate;

  if (takerSide === "buy") {
    return sameCandidate.executionPriceForTaker <= complementCandidate.executionPriceForTaker
      ? sameCandidate
      : complementCandidate;
  }

  return sameCandidate.executionPriceForTaker >= complementCandidate.executionPriceForTaker
    ? sameCandidate
    : complementCandidate;
}

async function processSecondaryFillWithClient(client, context) {
  const {
    market,
    takerOrder,
    makerOrder,
    fillQuantity,
    takerOutcome,
    yesOutcome,
    noOutcome,
  } = context;

  const matchedAt = new Date().toISOString();
  const tradePrice = toNumber(makerOrder.price, 0);
  const notionalCash = tradePrice * fillQuantity;

  const buyerOrder = takerOrder.side === "buy" ? takerOrder : makerOrder;
  const sellerOrder = takerOrder.side === "sell" ? takerOrder : makerOrder;

  const buyerExecPrice = tradePrice;
  const sellerExecPrice = tradePrice;
  let buyerRefund = 0;

  let takerCashReserved = toNumber(takerOrder.cash_reserved, 0);
  let makerCashReserved = toNumber(makerOrder.cash_reserved, 0);

  if (buyerOrder.id === takerOrder.id) {
    takerCashReserved -= toNumber(takerOrder.price, 0) * fillQuantity;
    buyerRefund = (toNumber(takerOrder.price, 0) - buyerExecPrice) * fillQuantity;
  } else {
    makerCashReserved -= toNumber(makerOrder.price, 0) * fillQuantity;
  }

  const trade = await insertTradeWithClient(client, {
    marketId: market.id,
    canonicalOutcomeId: yesOutcome.id,
    tradeKind: "secondary",
    makerOrderId: Number(makerOrder.id),
    takerOrderId: Number(takerOrder.id),
    makerUserId: Number(makerOrder.user_id),
    takerUserId: Number(takerOrder.user_id),
    makerOutcomeId: Number(makerOrder.outcome_id),
    takerOutcomeId: Number(takerOrder.outcome_id),
    makerSide: makerOrder.side,
    takerSide: takerOrder.side,
    buyOrderId: buyerOrder.id ? Number(buyerOrder.id) : null,
    sellOrderId: sellerOrder.id ? Number(sellerOrder.id) : null,
    buyUserId: buyerOrder.user_id ? Number(buyerOrder.user_id) : null,
    sellUserId: sellerOrder.user_id ? Number(sellerOrder.user_id) : null,
    yesProbability: getYesProbability(takerOutcome.outcome_code, tradePrice),
    quantity: fillQuantity,
    notionalCash,
    matchedAt,
  });

  if (buyerRefund > 0) {
    const cashAccount = await ensureUserCashAccount(client, buyerOrder.user_id);
    const nextCash = toNumber(cashAccount.cash_balance, 0) + buyerRefund;
    await updateCashBalance(client, buyerOrder.user_id, nextCash);
    await insertLedgerEntry(client, {
      userId: buyerOrder.user_id,
      entryType: "prediction_cash_release",
      quantityDelta: 0,
      cashDelta: buyerRefund,
      referenceType: "prediction_trade",
      referenceId: trade.id,
    });
  }

  const sellerCashAccount = await ensureUserCashAccount(client, sellerOrder.user_id);
  const sellerNextCash = toNumber(sellerCashAccount.cash_balance, 0) + notionalCash;
  await updateCashBalance(client, sellerOrder.user_id, sellerNextCash);

  await applyPositionDeltaWithClient(client, {
    userId: buyerOrder.user_id,
    marketId: market.id,
    outcomeId: takerOutcome.id,
    deltaShares: fillQuantity,
    executionPrice: buyerExecPrice,
  });
  await applyPositionDeltaWithClient(client, {
    userId: sellerOrder.user_id,
    marketId: market.id,
    outcomeId: takerOutcome.id,
    deltaShares: -fillQuantity,
    executionPrice: sellerExecPrice,
  });

  await insertLedgerEntry(client, {
    userId: buyerOrder.user_id,
    entryType: "prediction_trade_buy",
    quantityDelta: fillQuantity,
    cashDelta: 0,
    referenceType: "prediction_trade",
    referenceId: trade.id,
  });
  await insertLedgerEntry(client, {
    userId: sellerOrder.user_id,
    entryType: "prediction_trade_sell",
    quantityDelta: -fillQuantity,
    cashDelta: notionalCash,
    referenceType: "prediction_trade",
    referenceId: trade.id,
  });

  await updateOrderWithClient(client, makerOrder.id, {
    open_quantity: toNumber(makerOrder.open_quantity, 0) - fillQuantity,
    matched_quantity: toNumber(makerOrder.matched_quantity, 0) + fillQuantity,
    cash_reserved: Math.max(0, makerCashReserved),
    status: toNumber(makerOrder.open_quantity, 0) - fillQuantity > 0 ? "partially_filled" : "filled",
  });
  await updateOrderWithClient(client, takerOrder.id, {
    open_quantity: toNumber(takerOrder.open_quantity, 0) - fillQuantity,
    matched_quantity: toNumber(takerOrder.matched_quantity, 0) + fillQuantity,
    cash_reserved: Math.max(0, takerCashReserved),
    status: toNumber(takerOrder.open_quantity, 0) - fillQuantity > 0 ? "partially_filled" : "filled",
  });

  const yesProbability = getYesProbability(takerOutcome.outcome_code, tradePrice);
  await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
    marketId: market.id,
    actorUserId: null,
    eventType: "trade_matched",
    eventData: {
      trade_id: trade.id,
      trade_kind: "secondary",
      yes_probability: yesProbability,
      quantity: fillQuantity,
    },
  });
  await updateMarketSnapshotAfterTradeWithClient(client, market.id, yesProbability, notionalCash, matchedAt, yesOutcome.id);
  await recordTradeHistoryWithClient(client, {
    marketId: market.id,
    yesOutcomeId: yesOutcome.id,
    noOutcomeId: noOutcome.id,
    yesProbability,
    quantity: fillQuantity,
    notionalCash,
    matchedAt,
  });

  return {
    tradeId: trade.id,
    matchedAt,
    yesProbability,
  };
}

async function processMintFillWithClient(client, context) {
  const {
    market,
    takerOrder,
    makerOrder,
    fillQuantity,
    takerOutcome,
    makerOutcome,
    yesOutcome,
    noOutcome,
  } = context;

  const matchedAt = new Date().toISOString();
  const makerExecPrice = toNumber(makerOrder.price, 0);
  const takerExecPrice = Number((1 - makerExecPrice).toFixed(4));
  const yesProbability = getYesProbability(takerOutcome.outcome_code, takerExecPrice);
  const notionalCash = fillQuantity;

  let takerCashReserved = toNumber(takerOrder.cash_reserved, 0) - (toNumber(takerOrder.price, 0) * fillQuantity);
  let makerCashReserved = toNumber(makerOrder.cash_reserved, 0) - (toNumber(makerOrder.price, 0) * fillQuantity);
  const takerRefund = (toNumber(takerOrder.price, 0) - takerExecPrice) * fillQuantity;

  const trade = await insertTradeWithClient(client, {
    marketId: market.id,
    canonicalOutcomeId: yesOutcome.id,
    tradeKind: "mint",
    makerOrderId: Number(makerOrder.id),
    takerOrderId: Number(takerOrder.id),
    makerUserId: Number(makerOrder.user_id),
    takerUserId: Number(takerOrder.user_id),
    makerOutcomeId: Number(makerOutcome.id),
    takerOutcomeId: Number(takerOutcome.id),
    makerSide: "buy",
    takerSide: "buy",
    buyOrderId: null,
    sellOrderId: null,
    buyUserId: null,
    sellUserId: null,
    yesProbability,
    quantity: fillQuantity,
    notionalCash,
    matchedAt,
  });

  if (takerRefund > 0) {
    const takerCashAccount = await ensureUserCashAccount(client, takerOrder.user_id);
    const nextCash = toNumber(takerCashAccount.cash_balance, 0) + takerRefund;
    await updateCashBalance(client, takerOrder.user_id, nextCash);
    await insertLedgerEntry(client, {
      userId: takerOrder.user_id,
      entryType: "prediction_cash_release",
      quantityDelta: 0,
      cashDelta: takerRefund,
      referenceType: "prediction_trade",
      referenceId: trade.id,
    });
  }

  await applyPositionDeltaWithClient(client, {
    userId: takerOrder.user_id,
    marketId: market.id,
    outcomeId: takerOutcome.id,
    deltaShares: fillQuantity,
    executionPrice: takerExecPrice,
  });
  await applyPositionDeltaWithClient(client, {
    userId: makerOrder.user_id,
    marketId: market.id,
    outcomeId: makerOutcome.id,
    deltaShares: fillQuantity,
    executionPrice: makerExecPrice,
  });

  await insertLedgerEntry(client, {
    userId: takerOrder.user_id,
    entryType: "prediction_trade_buy",
    quantityDelta: fillQuantity,
    cashDelta: 0,
    referenceType: "prediction_trade",
    referenceId: trade.id,
  });
  await insertLedgerEntry(client, {
    userId: makerOrder.user_id,
    entryType: "prediction_trade_buy",
    quantityDelta: fillQuantity,
    cashDelta: 0,
    referenceType: "prediction_trade",
    referenceId: trade.id,
  });

  await updateOrderWithClient(client, makerOrder.id, {
    open_quantity: toNumber(makerOrder.open_quantity, 0) - fillQuantity,
    matched_quantity: toNumber(makerOrder.matched_quantity, 0) + fillQuantity,
    cash_reserved: Math.max(0, makerCashReserved),
    status: toNumber(makerOrder.open_quantity, 0) - fillQuantity > 0 ? "partially_filled" : "filled",
  });
  await updateOrderWithClient(client, takerOrder.id, {
    open_quantity: toNumber(takerOrder.open_quantity, 0) - fillQuantity,
    matched_quantity: toNumber(takerOrder.matched_quantity, 0) + fillQuantity,
    cash_reserved: Math.max(0, takerCashReserved),
    status: toNumber(takerOrder.open_quantity, 0) - fillQuantity > 0 ? "partially_filled" : "filled",
  });

  await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
    marketId: market.id,
    actorUserId: null,
    eventType: "trade_matched",
    eventData: {
      trade_id: trade.id,
      trade_kind: "mint",
      yes_probability: yesProbability,
      quantity: fillQuantity,
    },
  });
  await updateMarketSnapshotAfterTradeWithClient(client, market.id, yesProbability, notionalCash, matchedAt, yesOutcome.id);
  await recordTradeHistoryWithClient(client, {
    marketId: market.id,
    yesOutcomeId: yesOutcome.id,
    noOutcomeId: noOutcome.id,
    yesProbability,
    quantity: fillQuantity,
    notionalCash,
    matchedAt,
  });

  return {
    tradeId: trade.id,
    matchedAt,
    yesProbability,
  };
}

async function processRedeemFillWithClient(client, context) {
  const {
    market,
    takerOrder,
    makerOrder,
    fillQuantity,
    takerOutcome,
    makerOutcome,
    yesOutcome,
    noOutcome,
  } = context;

  const matchedAt = new Date().toISOString();
  const makerExecPrice = toNumber(makerOrder.price, 0);
  const takerExecPrice = Number((1 - makerExecPrice).toFixed(4));
  const yesProbability = getYesProbability(takerOutcome.outcome_code, takerExecPrice);
  const notionalCash = fillQuantity;

  const trade = await insertTradeWithClient(client, {
    marketId: market.id,
    canonicalOutcomeId: yesOutcome.id,
    tradeKind: "redeem",
    makerOrderId: Number(makerOrder.id),
    takerOrderId: Number(takerOrder.id),
    makerUserId: Number(makerOrder.user_id),
    takerUserId: Number(takerOrder.user_id),
    makerOutcomeId: Number(makerOutcome.id),
    takerOutcomeId: Number(takerOutcome.id),
    makerSide: "sell",
    takerSide: "sell",
    buyOrderId: null,
    sellOrderId: null,
    buyUserId: null,
    sellUserId: null,
    yesProbability,
    quantity: fillQuantity,
    notionalCash,
    matchedAt,
  });

  await applyPositionDeltaWithClient(client, {
    userId: takerOrder.user_id,
    marketId: market.id,
    outcomeId: takerOutcome.id,
    deltaShares: -fillQuantity,
    executionPrice: takerExecPrice,
  });
  await applyPositionDeltaWithClient(client, {
    userId: makerOrder.user_id,
    marketId: market.id,
    outcomeId: makerOutcome.id,
    deltaShares: -fillQuantity,
    executionPrice: makerExecPrice,
  });

  const takerCashAccount = await ensureUserCashAccount(client, takerOrder.user_id);
  await updateCashBalance(client, takerOrder.user_id, toNumber(takerCashAccount.cash_balance, 0) + (takerExecPrice * fillQuantity));
  const makerCashAccount = await ensureUserCashAccount(client, makerOrder.user_id);
  await updateCashBalance(client, makerOrder.user_id, toNumber(makerCashAccount.cash_balance, 0) + (makerExecPrice * fillQuantity));

  await insertLedgerEntry(client, {
    userId: takerOrder.user_id,
    entryType: "prediction_trade_sell",
    quantityDelta: -fillQuantity,
    cashDelta: takerExecPrice * fillQuantity,
    referenceType: "prediction_trade",
    referenceId: trade.id,
  });
  await insertLedgerEntry(client, {
    userId: makerOrder.user_id,
    entryType: "prediction_trade_sell",
    quantityDelta: -fillQuantity,
    cashDelta: makerExecPrice * fillQuantity,
    referenceType: "prediction_trade",
    referenceId: trade.id,
  });

  await updateOrderWithClient(client, makerOrder.id, {
    open_quantity: toNumber(makerOrder.open_quantity, 0) - fillQuantity,
    matched_quantity: toNumber(makerOrder.matched_quantity, 0) + fillQuantity,
    status: toNumber(makerOrder.open_quantity, 0) - fillQuantity > 0 ? "partially_filled" : "filled",
  });
  await updateOrderWithClient(client, takerOrder.id, {
    open_quantity: toNumber(takerOrder.open_quantity, 0) - fillQuantity,
    matched_quantity: toNumber(takerOrder.matched_quantity, 0) + fillQuantity,
    status: toNumber(takerOrder.open_quantity, 0) - fillQuantity > 0 ? "partially_filled" : "filled",
  });

  await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
    marketId: market.id,
    actorUserId: null,
    eventType: "trade_matched",
    eventData: {
      trade_id: trade.id,
      trade_kind: "redeem",
      yes_probability: yesProbability,
      quantity: fillQuantity,
    },
  });
  await updateMarketSnapshotAfterTradeWithClient(client, market.id, yesProbability, notionalCash, matchedAt, yesOutcome.id);
  await recordTradeHistoryWithClient(client, {
    marketId: market.id,
    yesOutcomeId: yesOutcome.id,
    noOutcomeId: noOutcome.id,
    yesProbability,
    quantity: fillQuantity,
    notionalCash,
    matchedAt,
  });

  return {
    tradeId: trade.id,
    matchedAt,
    yesProbability,
  };
}

async function placePredictionOrder(pool, {
  userId,
  slug,
  outcomeCode,
  side,
  price,
  quantity,
} = {}) {
  const normalizedOutcomeCode = normalizeOutcomeCode(outcomeCode);
  const normalizedSide = normalizeSide(side);
  const normalizedPrice = normalizePrice(price);
  const normalizedQuantity = requirePositiveNumber(quantity);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const market = await predictionMarketDb.getPredictionMarketBySlugForTradingWithClient(client, slug);
    if (!market) {
      const error = new Error("prediction_market_not_found");
      error.code = "prediction_market_not_found";
      throw error;
    }
    if (market.status !== "open" || market.trading_status !== "open") {
      throw conflict("prediction_market_closed");
    }

    const outcomes = await predictionMarketDb.listPredictionOutcomesByMarketIdWithClient(client, market.id);
    const outcomeMap = new Map(outcomes.map((outcome) => [outcome.outcome_code, outcome]));
    const takerOutcome = outcomeMap.get(normalizedOutcomeCode);
    const oppositeOutcome = outcomeMap.get(normalizedOutcomeCode === "yes" ? "no" : "yes");
    const yesOutcome = outcomeMap.get("yes");
    const noOutcome = outcomeMap.get("no");
    if (!takerOutcome || !oppositeOutcome || !yesOutcome || !noOutcome) {
      throw invalidPredictionMarketOrder();
    }

    const cashAccount = await ensureUserCashAccount(client, userId);
    const currentCashBalance = toNumber(cashAccount.cash_balance, 0);
    const reserveRequired = normalizedSide === "buy" ? normalizedPrice * normalizedQuantity : 0;

    if (normalizedSide === "buy" && currentCashBalance < reserveRequired) {
      throw conflict("prediction_insufficient_cash");
    }
    if (normalizedSide === "sell") {
      const position = await getPredictionPositionWithClient(client, userId, market.id, takerOutcome.id);
      const reservedQuantity = await getUserReservedSellQuantityWithClient(client, userId, market.id, takerOutcome.id);
      const availableShares = toNumber(position?.shares, 0) - reservedQuantity;
      if (availableShares < normalizedQuantity) {
        throw conflict("prediction_insufficient_holdings");
      }
    }

    if (reserveRequired > 0) {
      await updateCashBalance(client, userId, currentCashBalance - reserveRequired);
    }

    const takerOrder = await insertOrderWithClient(client, {
      marketId: market.id,
      outcomeId: takerOutcome.id,
      userId,
      side: normalizedSide,
      price: normalizedPrice,
      quantity: normalizedQuantity,
      cashReserved: reserveRequired,
    });

    if (reserveRequired > 0) {
      await insertLedgerEntry(client, {
        userId,
        entryType: "prediction_cash_reserve",
        quantityDelta: 0,
        cashDelta: -reserveRequired,
        referenceType: "prediction_order",
        referenceId: takerOrder.id,
      });
    }

    await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
      marketId: market.id,
      actorUserId: userId,
      eventType: "order_placed",
      eventData: {
        order_id: takerOrder.id,
        side: normalizedSide,
        outcome_code: normalizedOutcomeCode,
        price: normalizedPrice,
        quantity: normalizedQuantity,
      },
    });

    const sameCandidates = await listSameBookCandidatesWithClient(client, {
      marketId: market.id,
      outcomeId: takerOutcome.id,
      takerSide: normalizedSide,
      takerPrice: normalizedPrice,
    });
    const complementCandidates = await listComplementCandidatesWithClient(client, {
      marketId: market.id,
      oppositeOutcomeId: oppositeOutcome.id,
      takerSide: normalizedSide,
      takerPrice: normalizedPrice,
    });

    let sameIndex = 0;
    let complementIndex = 0;
    let nextTakerOrder = takerOrder;

    while (toNumber(nextTakerOrder.open_quantity, 0) > 0) {
      while (sameIndex < sameCandidates.length && toNumber(sameCandidates[sameIndex].open_quantity, 0) <= 0) sameIndex += 1;
      while (complementIndex < complementCandidates.length && toNumber(complementCandidates[complementIndex].open_quantity, 0) <= 0) complementIndex += 1;

      const sameCandidate = sameIndex < sameCandidates.length ? buildSameCandidate(sameCandidates[sameIndex]) : null;
      const complementCandidate = complementIndex < complementCandidates.length ? buildComplementCandidate(complementCandidates[complementIndex]) : null;
      const best = pickBestCandidate(normalizedSide, sameCandidate, complementCandidate);
      if (!best) break;
      if (Number(best.makerOrder.user_id) === Number(nextTakerOrder.user_id)) {
        if (best === sameCandidate) sameIndex += 1; else complementIndex += 1;
        continue;
      }

      const fillQuantity = Math.min(
        toNumber(nextTakerOrder.open_quantity, 0),
        toNumber(best.makerOrder.open_quantity, 0)
      );
      if (fillQuantity <= 0) {
        if (best === sameCandidate) sameIndex += 1; else complementIndex += 1;
        continue;
      }

      const context = {
        market,
        takerOrder: nextTakerOrder,
        makerOrder: best.makerOrder,
        fillQuantity,
        takerOutcome,
        makerOutcome: best.matchKind === "secondary" ? takerOutcome : oppositeOutcome,
        yesOutcome,
        noOutcome,
      };

      if (best.matchKind === "secondary") {
        await processSecondaryFillWithClient(client, context);
      } else if (best.matchKind === "mint") {
        await processMintFillWithClient(client, context);
      } else {
        await processRedeemFillWithClient(client, context);
      }

      nextTakerOrder = {
        ...nextTakerOrder,
        open_quantity: toNumber(nextTakerOrder.open_quantity, 0) - fillQuantity,
        matched_quantity: toNumber(nextTakerOrder.matched_quantity, 0) + fillQuantity,
        cash_reserved: normalizedSide === "buy"
          ? Math.max(0, toNumber(nextTakerOrder.cash_reserved, 0) - (toNumber(nextTakerOrder.price, 0) * fillQuantity))
          : toNumber(nextTakerOrder.cash_reserved, 0),
        status: toNumber(nextTakerOrder.open_quantity, 0) - fillQuantity > 0 ? "partially_filled" : "filled",
      };

      if (best === sameCandidate) {
        sameCandidates[sameIndex] = {
          ...sameCandidates[sameIndex],
          open_quantity: toNumber(sameCandidates[sameIndex].open_quantity, 0) - fillQuantity,
        };
      } else {
        complementCandidates[complementIndex] = {
          ...complementCandidates[complementIndex],
          open_quantity: toNumber(complementCandidates[complementIndex].open_quantity, 0) - fillQuantity,
        };
      }
    }

    const refreshedMarket = await predictionMarketDb.getPredictionMarketByIdWithClient(client, market.id);
    await client.query("COMMIT");

    return {
      order_id: Number(nextTakerOrder.id),
      market: refreshedMarket,
      order_status: nextTakerOrder.status,
      open_quantity: toNumber(nextTakerOrder.open_quantity, 0),
      matched_quantity: toNumber(nextTakerOrder.matched_quantity, 0),
      cash_reserved: toNumber(nextTakerOrder.cash_reserved, 0),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cancelPredictionOrder(pool, {
  userId,
  slug,
  orderId,
} = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const market = await predictionMarketDb.getPredictionMarketBySlugForTradingWithClient(client, slug);
    if (!market) {
      const error = new Error("prediction_market_not_found");
      error.code = "prediction_market_not_found";
      throw error;
    }

    const { rows } = await client.query(
      `
      SELECT *
      FROM market.prediction_market_orders
      WHERE id = $1
        AND market_id = $2
        AND user_id = $3
      LIMIT 1
      FOR UPDATE
    `,
      [orderId, market.id, userId]
    );
    const order = rows[0] || null;
    if (!order) throw conflict("prediction_order_not_found");
    if (!["open", "partially_filled"].includes(order.status) || toNumber(order.open_quantity, 0) <= 0) {
      throw conflict("prediction_order_not_cancellable");
    }

    const refundableCash = toNumber(order.cash_reserved, 0);
    if (refundableCash > 0) {
      const cashAccount = await ensureUserCashAccount(client, userId);
      const nextCash = toNumber(cashAccount.cash_balance, 0) + refundableCash;
      await updateCashBalance(client, userId, nextCash);
      await insertLedgerEntry(client, {
        userId,
        entryType: "prediction_cash_release",
        quantityDelta: 0,
        cashDelta: refundableCash,
        referenceType: "prediction_order",
        referenceId: Number(order.id),
      });
    }

    await updateOrderWithClient(client, order.id, {
      open_quantity: 0,
      cash_reserved: 0,
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    });

    await predictionMarketDb.insertPredictionMarketEventWithClient(client, {
      marketId: market.id,
      actorUserId: userId,
      eventType: "order_cancelled",
      eventData: { order_id: Number(order.id) },
    });

    const refreshedMarket = await predictionMarketDb.getPredictionMarketByIdWithClient(client, market.id);
    await client.query("COMMIT");
    return {
      order_id: Number(order.id),
      market_id: Number(market.id),
      market: refreshedMarket,
      status: "cancelled",
      refunded_cash: refundableCash,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getPredictionTrades(pool, slug, { limit = 50 } = {}) {
  return predictionMarketDb.listPredictionTrades(pool, slug, { limit });
}

async function getPredictionOrderBook(pool, slug, { depth = 10 } = {}) {
  return predictionMarketDb.getPredictionOrderBook(pool, slug, { depth });
}

async function getPredictionCandles(pool, slug, { interval = "1h", outcomeCode = "yes", limit = 200 } = {}) {
  const normalizedInterval = String(interval || "1h").trim();
  const normalizedOutcomeCode = normalizeOutcomeCode(outcomeCode || "yes");
  if (!VALID_INTERVALS.has(normalizedInterval)) {
    throw invalidPredictionMarketOrder();
  }
  return predictionMarketDb.getPredictionCandles(pool, slug, {
    interval: normalizedInterval,
    outcomeCode: normalizedOutcomeCode,
    limit,
  });
}

module.exports = {
  cancelPredictionOrder,
  getPredictionCandles,
  getPredictionOrderBook,
  getPredictionTrades,
  placePredictionOrder,
};
