const schedulerHealth = require("./schedulerHealth");
const DEFAULT_TRADING_FEE_RATE = 0.01;
const DEFAULT_TRANSIENT_HALF_LIFE_MINUTES = 60;
const DEFAULT_TRANSIENT_IMPACT_WEIGHT = 0.7;
const DEFAULT_PERSISTENT_IMPACT_WEIGHT = 0.15;
const DEFAULT_EXECUTION_SLIPPAGE_WEIGHT = 0.5;
const DEFAULT_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL = 180;
const DEFAULT_LIVE_ORDER_BATCH_LIMIT = 100;
const DEFAULT_LIVE_ORDER_WORKER_CONCURRENCY = 4;
const DEFAULT_LIVE_ORDER_SCHEDULER_INTERVAL_MS = 1_000;
const DEFAULT_LIVE_ORDER_HOLD_MARGIN = 0.05;
const LIVE_ORDER_SCHEDULER_LOCK_KEY = 9_204_003;
const marketState = require("./marketState");
const supply = require("./marketSupply");
const netWorth = require("./netWorth");
const achievements = require("./achievements");
const { ensureUserCashAccount, getStarterCash } = require("./portfolioCash");
const economy = require("./economy");
const { publishMarketEvent } = require("./marketEvents");
const { invalidateMarketAssetsCache } = require("../marketCache");

function getTradingFeeRate() {
  const parsed = Number(process.env.MARKET_TRADING_FEE_RATE || DEFAULT_TRADING_FEE_RATE);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TRADING_FEE_RATE;
}

const TRANSIENT_HALF_LIFE_MINUTES = Number(process.env.MARKET_TRANSIENT_HALF_LIFE_MINUTES || DEFAULT_TRANSIENT_HALF_LIFE_MINUTES);
const TRANSIENT_IMPACT_WEIGHT = Number(process.env.MARKET_TRANSIENT_IMPACT_WEIGHT || DEFAULT_TRANSIENT_IMPACT_WEIGHT);
const PERSISTENT_IMPACT_WEIGHT = Number(process.env.MARKET_PERSISTENT_IMPACT_WEIGHT || DEFAULT_PERSISTENT_IMPACT_WEIGHT);
const EXECUTION_SLIPPAGE_WEIGHT = Number(process.env.MARKET_EXECUTION_SLIPPAGE_WEIGHT || DEFAULT_EXECUTION_SLIPPAGE_WEIGHT);
const LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL = Math.max(
  1,
  Number(
    process.env.MARKET_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL ||
    process.env.MARKET_LIVE_ORDER_LIMIT_PER_INTERVAL ||
    process.env.MARKET_LIVE_ORDER_SHARE_LIMIT_PER_TICK ||
      DEFAULT_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL
  )
);
const LIVE_ORDER_BATCH_LIMIT = Math.max(1, Number(process.env.MARKET_LIVE_ORDER_BATCH_LIMIT || DEFAULT_LIVE_ORDER_BATCH_LIMIT));
// A queued buy takes its estimated cost (plus this margin, for the price moving before the batch)
// out of spendable cash when it's placed, so cash promised to orders can't go to anything else. The
// batch charges the real price and gives back the rest; a cancel or a rejection gives it all back.
const LIVE_ORDER_HOLD_MARGIN = Math.max(0, Number(process.env.MARKET_LIVE_ORDER_HOLD_MARGIN || DEFAULT_LIVE_ORDER_HOLD_MARGIN) || 0);
const LIVE_ORDER_WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.MARKET_LIVE_ORDER_WORKER_CONCURRENCY || DEFAULT_LIVE_ORDER_WORKER_CONCURRENCY)
);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requirePositiveQuantity(quantity) {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error("invalid_quantity");
    error.code = "invalid_quantity";
    throw error;
  }
  return parsed;
}

function computeNextLiveOrderTick(now = new Date()) {
  const tickMs = 10 * 60 * 1000;
  return new Date((Math.floor(now.getTime() / tickMs) + 1) * tickMs);
}

function decayTransientOffset(transientOffset, lastUpdatedAt, now = new Date()) {
  const raw = Number(transientOffset || 0);
  if (!Number.isFinite(raw) || raw === 0 || !lastUpdatedAt) return 0;

  const last = new Date(lastUpdatedAt);
  if (Number.isNaN(last.getTime())) return 0;

  const dtMinutes = Math.max(0, (now.getTime() - last.getTime()) / 60000);
  const decayFactor = Math.pow(0.5, dtMinutes / Math.max(TRANSIENT_HALF_LIFE_MINUTES, 1));
  return raw * decayFactor;
}

function getDecayedOffsets(asset, now = new Date()) {
  const persistentOffset = Number(asset.current_persistent_offset || 0);
  const transientOffset = decayTransientOffset(asset.current_transient_offset, asset.offsets_updated_at, now);

  return {
    persistentOffset: Number.isFinite(persistentOffset) ? persistentOffset : 0,
    transientOffset: Number.isFinite(transientOffset) ? transientOffset : 0,
  };
}

function computeLiveMidPrice(fairPrice, persistentOffset, transientOffset) {
  const fair = Math.max(Number(fairPrice || 0), 0.000001);
  return fair * Math.exp(persistentOffset + transientOffset);
}

function computeShockPct(quantity, liquidityDepth) {
  const q = Math.max(Number(quantity || 0), 0);
  const depth = Math.max(Number(liquidityDepth || 0), 1);
  return q / depth;
}

function applyTradeShock({ side, quantity, liquidityDepth, persistentOffset, transientOffset }) {
  const shock = computeShockPct(quantity, liquidityDepth);
  const sign = side === "buy" ? 1 : -1;

  return {
    persistentOffset: persistentOffset + sign * (PERSISTENT_IMPACT_WEIGHT * shock),
    transientOffset: transientOffset + sign * (TRANSIENT_IMPACT_WEIGHT * shock),
  };
}

function computeExecutionPrice({ side, bidPrice, askPrice, quantity, liquidityDepth }) {
  const shock = computeShockPct(quantity, liquidityDepth);
  const slip = EXECUTION_SLIPPAGE_WEIGHT * shock;

  if (side === "buy") {
    return askPrice * (1 + slip);
  }

  return bidPrice * (1 - slip);
}

function computeQuotes(midPrice, spreadBps) {
  const spreadPct = Math.max(toNumber(spreadBps, 0), 0) / 10000;
  return {
    bidPrice: midPrice * (1 - spreadPct / 2),
    askPrice: midPrice * (1 + spreadPct / 2),
  };
}

async function getLockedAssetBySymbol(client, symbol, { lock = true } = {}) {
  const { rows } = await client.query(
    `
    SELECT
      a.id,
      a.symbol,
      a.display_name,
      c.icon,
      c.color,
      a.status,
      a.current_mid_price,
      a.current_bid_price,
      a.current_ask_price,
      a.current_premium_pct,
      a.current_fair_value,
      a.current_fair_value_raw,
      a.current_daily_emission,
      a.current_persistent_offset,
      a.current_transient_offset,
      a.offsets_updated_at,
      a.circulating_supply,
      a.treasury_supply,
      a.max_supply,
      a.broker_buffer_pct,
      a.trading_state,
      a.liquidity_depth,
      a.spread_bps,
      a.latest_snapshot_date,
      a.latest_snapshot_id
    FROM market.market_assets a
    JOIN yt.youtube_channels c
      ON c.youtube_channel_id = a.youtube_channel_id
    WHERE a.symbol = $1
    ${lock ? "FOR UPDATE OF a" : ""}
  `,
    [symbol]
  );

  return rows[0] || null;
}

async function getLockedHolding(client, userId, assetId) {
  const { rows } = await client.query(
    `
    SELECT user_id, asset_id, quantity, avg_cost_basis
    FROM market.portfolio_holdings
    WHERE user_id = $1 AND asset_id = $2
    FOR UPDATE
  `,
    [userId, assetId]
  );
  return rows[0] || null;
}

async function createOrder(client, { userId, assetId, side, quantity, bidPrice, askPrice }) {
  const { rows } = await client.query(
    `
    INSERT INTO market.trade_orders (
      user_id,
      asset_id,
      side,
      order_type,
      requested_quantity,
      filled_quantity,
      status,
      quote_bid_at_submit,
      quote_ask_at_submit,
      updated_at
    ) VALUES ($1,$2,$3,'market',$4,$4,'filled',$5,$6,now())
    RETURNING id
  `,
    [userId, assetId, side, quantity, bidPrice, askPrice]
  );
  return rows[0].id;
}

async function markExistingOrderFilled(client, { orderId, quantity, bidPrice, askPrice, liveOrderBatchId = null }) {
  const { rows } = await client.query(
    `
    UPDATE market.trade_orders
    SET
      filled_quantity = $2,
      status = 'filled',
      quote_bid_at_submit = COALESCE(quote_bid_at_submit, $3),
      quote_ask_at_submit = COALESCE(quote_ask_at_submit, $4),
      live_order_batch_id = COALESCE($5, live_order_batch_id),
      updated_at = now()
    WHERE id = $1
      AND status = 'pending'
    RETURNING id
  `,
    [orderId, quantity, bidPrice, askPrice, liveOrderBatchId]
  );
  if (!rows[0]) {
    const error = new Error("live_order_not_pending");
    error.code = "live_order_not_pending";
    throw error;
  }
  return rows[0].id;
}

async function createFill(client, fill) {
  const { rows } = await client.query(
    `
    INSERT INTO market.trade_fills (
      order_id,
      asset_id,
      user_id,
      ts,
      side,
      price,
      quantity,
      gross_cash,
      fee_cash,
      net_cash,
      counterparty_type
    ) VALUES ($1,$2,$3,now(),$4,$5,$6,$7,$8,$9,'treasury')
    RETURNING id, ts
  `,
    [
      fill.orderId,
      fill.assetId,
      fill.userId,
      fill.side,
      fill.price,
      fill.quantity,
      fill.grossCash,
      fill.feeCash,
      fill.netCash,
    ]
  );
  return rows[0];
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
      credit_delta,
      reference_type,
      reference_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `,
    [
      entry.userId,
      entry.assetId,
      entry.entryType,
      entry.quantityDelta,
      entry.cashDelta,
      entry.creditDelta || 0,
      entry.referenceType,
      entry.referenceId,
    ]
  );
}

/**
 * Moves cash between a player's spendable balance and what's held for their queued buys: a positive
 * amount holds, a negative one gives it back. The caller holds the cash row's lock.
 */
async function moveHeldCash(client, { userId, assetId, orderId, amount }) {
  if (!(Math.abs(amount) > 0)) return;
  await client.query(
    `
    UPDATE market.portfolio_cash_balances
    SET cash_balance = cash_balance - $2, held_cash = held_cash + $2, updated_at = now()
    WHERE user_id = $1
  `,
    [userId, amount]
  );
  await insertLedgerEntry(client, {
    userId,
    assetId,
    entryType: amount > 0 ? "order_cash_hold" : "order_cash_release",
    quantityDelta: 0,
    cashDelta: -amount,
    referenceType: "trade_order",
    referenceId: orderId,
  });
}

/** Gives back what a queued order held (it was cancelled or rejected). */
async function releaseOrderHold(client, order) {
  const held = toNumber(order?.held_cash, 0);
  if (!(held > 0)) return;
  await ensureUserCashAccount(client, order.user_id);
  await moveHeldCash(client, { userId: order.user_id, assetId: order.asset_id, orderId: order.id, amount: -held });
}

/** Shares already promised to queued sells of this stock. */
async function sumPendingSellShares(client, { userId, assetId }) {
  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(requested_quantity), 0) AS shares
    FROM market.trade_orders
    WHERE user_id = $1
      AND asset_id = $2
      AND side = 'sell'
      AND order_type = 'live_market'
      AND status = 'pending'
  `,
    [userId, assetId]
  );
  return toNumber(rows[0]?.shares, 0);
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

async function upsertHolding(client, { userId, assetId, quantity, avgCostBasis }) {
  await client.query(
    `
    INSERT INTO market.portfolio_holdings (
      user_id,
      asset_id,
      quantity,
      avg_cost_basis,
      updated_at
    ) VALUES ($1,$2,$3,$4,now())
    ON CONFLICT (user_id, asset_id)
    DO UPDATE SET
      quantity = EXCLUDED.quantity,
      avg_cost_basis = EXCLUDED.avg_cost_basis,
      updated_at = now()
  `,
    [userId, assetId, quantity, avgCostBasis]
  );
}

async function getUserTradeIdentity(client, userId) {
  const { rows } = await client.query(
    `
    SELECT id, username, profile_color
    FROM market.users
    WHERE id = $1
    LIMIT 1
  `,
    [userId]
  );

  return rows[0] || null;
}

async function updateAssetAfterTrade(client, asset, {
  side,
  quantity,
  executionPrice,
  fairPrice,
  now,
  marketDate,
  persistentOffset,
  transientOffset,
}) {
  const nextOffsets = applyTradeShock({
    side,
    quantity,
    liquidityDepth: asset.liquidity_depth,
    persistentOffset,
    transientOffset,
  });
  const nextMid = computeLiveMidPrice(fairPrice, nextOffsets.persistentOffset, nextOffsets.transientOffset);
  const nextPremium = fairPrice > 0 ? (nextMid - fairPrice) / fairPrice : 0;
  const quotes = computeQuotes(nextMid, asset.spread_bps);

  await client.query(
    `
    UPDATE market.market_assets
    SET
      current_mid_price = $2,
      current_bid_price = $3,
      current_ask_price = $4,
      current_premium_pct = $5,
      current_persistent_offset = $6,
      current_transient_offset = $7,
      offsets_updated_at = $8,
      updated_at = now()
    WHERE id = $1
  `,
    [asset.id, nextMid, quotes.bidPrice, quotes.askPrice, nextPremium, nextOffsets.persistentOffset, nextOffsets.transientOffset, now]
  );

  if (asset.latest_snapshot_id && marketDate) {
    await client.query(
      `
      UPDATE market.asset_daily_market_state
      SET
        mid_close = $3,
        mid_high = GREATEST(COALESCE(mid_high, mid_open), $3),
        mid_low = LEAST(COALESCE(mid_low, mid_open), $3),
        bid_close = $4,
        ask_close = $5,
        premium_close_pct = $6,
        volume_shares = volume_shares + $7,
        volume_cash = volume_cash + $8,
        trade_count = trade_count + 1,
        updated_at = now()
      WHERE asset_id = $1
        AND market_date = $2
    `,
      [asset.id, marketDate, nextMid, quotes.bidPrice, quotes.askPrice, nextPremium, quantity, executionPrice * quantity]
    );
  }

  return {
    mid_price: nextMid,
    bid_price: quotes.bidPrice,
    ask_price: quotes.askPrice,
    premium_pct: nextPremium,
    persistent_offset: nextOffsets.persistentOffset,
    transient_offset: nextOffsets.transientOffset,
  };
}

/** A sell into a buyback: the price stays frozen; the broker's tally and the day's volume move. */
async function recordBuybackSale(client, asset, buyback, { quantity, executionPrice, grossCash, marketDate }) {
  await client.query(
    `UPDATE market.asset_buybacks SET shares_bought = shares_bought + $2, cash_paid = cash_paid + $3 WHERE id = $1`,
    [buyback.id, quantity, grossCash]
  );
  if (asset.latest_snapshot_id && marketDate) {
    await client.query(
      `
      UPDATE market.asset_daily_market_state
      SET volume_shares = volume_shares + $3, volume_cash = volume_cash + $4, trade_count = trade_count + 1, updated_at = now()
      WHERE asset_id = $1 AND market_date = $2
    `,
      [asset.id, marketDate, quantity, executionPrice * quantity]
    );
  }
  return {
    mid_price: toNumber(asset.current_mid_price, 0),
    bid_price: toNumber(asset.current_bid_price, 0),
    ask_price: toNumber(asset.current_ask_price, 0),
    premium_pct: toNumber(asset.current_premium_pct, 0),
    persistent_offset: toNumber(asset.current_persistent_offset, 0),
    transient_offset: toNumber(asset.current_transient_offset, 0),
    buyback_price: executionPrice,
  };
}

async function getLockedPendingLiveOrder(client, orderId) {
  const { rows } = await client.query(
    `
    SELECT
      o.id,
      o.user_id,
      o.asset_id,
      o.side,
      o.requested_quantity,
      o.held_cash,
      a.symbol
    FROM market.trade_orders o
    JOIN market.market_assets a ON a.id = o.asset_id
    WHERE o.id = $1
      AND o.order_type = 'live_market'
      AND o.status = 'pending'
    FOR UPDATE OF o
  `,
    [orderId]
  );
  return rows[0] || null;
}

async function executeOrder(pool, {
  userId,
  symbol,
  side,
  quantity,
  redis = null,
  existingOrderId = null,
  liveOrderBatchId = null,
  refreshDerivedState = true,
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let effectiveUserId = userId;
    let effectiveSymbol = symbol;
    let effectiveSide = side;
    let effectiveQuantity = quantity;
    // What a queued buy set aside when it was placed: spendable again for this fill.
    let heldCash = 0;

    if (existingOrderId) {
      const pendingOrder = await getLockedPendingLiveOrder(client, existingOrderId);
      if (!pendingOrder) {
        const error = new Error("live_order_not_pending");
        error.code = "live_order_not_pending";
        throw error;
      }
      effectiveUserId = pendingOrder.user_id;
      effectiveSymbol = pendingOrder.symbol;
      effectiveSide = pendingOrder.side;
      effectiveQuantity = pendingOrder.requested_quantity;
      heldCash = toNumber(pendingOrder.held_cash, 0);
    }

    const status = await marketState.getMarketStatusWithClient(client);
    if (status && !status.is_trading_open) {
      const error = new Error("market_closed");
      error.code = "market_closed";
      error.marketStatus = status;
      throw error;
    }

    let parsedQuantity = requirePositiveQuantity(effectiveQuantity);
    const asset = await getLockedAssetBySymbol(client, effectiveSymbol);
    if (!asset) {
      const error = new Error("asset_not_found");
      error.code = "asset_not_found";
      throw error;
    }
    // A stock with no fair value yet would otherwise trade at the $0.000001 price floor.
    if (asset.status !== "active" || !(toNumber(asset.current_fair_value, 0) > 0)) {
      const error = new Error("asset_not_active");
      error.code = "asset_not_active";
      throw error;
    }

    // Supply: buys take the broker's shares for sale (a partial fill takes the last of them); a
    // stock in a buyback takes no buys and pays the broker's buyback price for sells.
    let buyback = null;
    if (asset.trading_state === "buyback") {
      if (effectiveSide === "buy") {
        const error = new Error("buyback_frozen");
        error.code = "buyback_frozen";
        throw error;
      }
      buyback = await supply.getActiveBuyback(client, asset.id, { lock: true });
    }
    if (effectiveSide === "buy") {
      const forSale = Math.floor(supply.sharesForSale(asset) * 1e6) / 1e6;
      if (!(forSale > 0)) {
        const error = new Error("sold_out");
        error.code = "sold_out";
        throw error;
      }
      parsedQuantity = Math.min(parsedQuantity, forSale);
    }

    const cashAccount = await ensureUserCashAccount(client, effectiveUserId);
    const holding = await getLockedHolding(client, effectiveUserId, asset.id);
    const feeRate = getTradingFeeRate();
    const now = new Date();
    const fairPrice = Math.max(toNumber(asset.current_fair_value, 0), 0.000001);
    const { persistentOffset, transientOffset } = getDecayedOffsets(asset, now);
    const liveMidBefore = buyback ? toNumber(asset.current_mid_price, 0) : computeLiveMidPrice(fairPrice, persistentOffset, transientOffset);
    const quotesBefore = computeQuotes(liveMidBefore, asset.spread_bps);
    const executablePrice = buyback
      ? supply.buybackFillPrice(asset, buyback, parsedQuantity, now)
      : computeExecutionPrice({
          side: effectiveSide,
          bidPrice: quotesBefore.bidPrice,
          askPrice: quotesBefore.askPrice,
          quantity: parsedQuantity,
          liquidityDepth: asset.liquidity_depth,
        });
    if (!(executablePrice > 0)) {
      const error = new Error("invalid_quote");
      error.code = "invalid_quote";
      throw error;
    }

    const grossCash = executablePrice * parsedQuantity;
    const feeCash = grossCash * feeRate;
    // The trading fee comes out of Credit first, Cash covering the rest; a sale also earns a little
    // Credit (services/economy.js).
    const creditBalance = toNumber(cashAccount.credit_balance, 0);
    const feeFromCredit = Math.min(Math.max(creditBalance, 0), feeCash);
    const feeFromCash = feeCash - feeFromCredit;
    const creditEarned = effectiveSide === "sell" ? Math.round(grossCash * economy.SETTINGS.sellCreditRate * 100) / 100 : 0;

    if (effectiveSide === "buy" && toNumber(cashAccount.cash_balance, 0) + heldCash < grossCash + feeFromCash) {
      const error = new Error("insufficient_cash");
      error.code = "insufficient_cash";
      throw error;
    }

    if (effectiveSide === "sell") {
      const currentQty = toNumber(holding?.quantity, 0);
      if (currentQty < parsedQuantity) {
        const error = new Error("insufficient_holdings");
        error.code = "insufficient_holdings";
        throw error;
      }
    }

    const orderId = existingOrderId
      ? await markExistingOrderFilled(client, {
          orderId: existingOrderId,
          quantity: parsedQuantity,
          bidPrice: quotesBefore.bidPrice,
          askPrice: quotesBefore.askPrice,
          liveOrderBatchId,
        })
      : await createOrder(client, {
          userId: effectiveUserId,
          assetId: asset.id,
          side: effectiveSide,
          quantity: parsedQuantity,
          bidPrice: quotesBefore.bidPrice,
          askPrice: quotesBefore.askPrice,
        });

    const fillRow = await createFill(client, {
      orderId,
      assetId: asset.id,
      userId: effectiveUserId,
      side: effectiveSide,
      price: executablePrice,
      quantity: parsedQuantity,
      grossCash,
      feeCash,
      netCash: effectiveSide === "buy" ? -(grossCash + feeCash) : grossCash - feeCash,
    });

    // The order's hold comes back first; the fill below then charges the real cost.
    if (heldCash > 0) {
      await moveHeldCash(client, { userId: effectiveUserId, assetId: asset.id, orderId, amount: -heldCash });
    }
    const currentCash = toNumber(cashAccount.cash_balance, 0) + heldCash;
    const currentQuantity = toNumber(holding?.quantity, 0);
    const currentAvgCost = toNumber(holding?.avg_cost_basis, 0);
    const costBasisSold = effectiveSide === "sell" ? currentAvgCost * parsedQuantity : null;

    let nextCash = currentCash;
    let nextQuantity = currentQuantity;
    let nextAvgCost = currentAvgCost;

    if (effectiveSide === "buy") {
      nextCash = currentCash - grossCash - feeFromCash;
      nextQuantity = currentQuantity + parsedQuantity;
      nextAvgCost =
        nextQuantity > 0
          ? ((currentQuantity * currentAvgCost) + grossCash + feeCash) / nextQuantity
          : 0;

      await insertLedgerEntry(client, {
        userId: effectiveUserId,
        assetId: asset.id,
        entryType: "buy_asset_credit",
        quantityDelta: parsedQuantity,
        cashDelta: 0,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
      await insertLedgerEntry(client, {
        userId: effectiveUserId,
        assetId: asset.id,
        entryType: "buy_cash_debit",
        quantityDelta: 0,
        cashDelta: -grossCash,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
      await insertLedgerEntry(client, {
        userId: effectiveUserId,
        assetId: asset.id,
        entryType: "trade_fee",
        quantityDelta: 0,
        cashDelta: -feeFromCash,
        creditDelta: -feeFromCredit,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
    } else {
      nextCash = currentCash + grossCash - feeFromCash;
      nextQuantity = currentQuantity - parsedQuantity;
      nextAvgCost = nextQuantity > 0 ? currentAvgCost : 0;

      await insertLedgerEntry(client, {
        userId: effectiveUserId,
        assetId: asset.id,
        entryType: "sell_asset_debit",
        quantityDelta: -parsedQuantity,
        cashDelta: 0,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
      await insertLedgerEntry(client, {
        userId: effectiveUserId,
        assetId: asset.id,
        entryType: "sell_cash_credit",
        quantityDelta: 0,
        cashDelta: grossCash,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
      await insertLedgerEntry(client, {
        userId: effectiveUserId,
        assetId: asset.id,
        entryType: "trade_fee",
        quantityDelta: 0,
        cashDelta: -feeFromCash,
        creditDelta: -feeFromCredit,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
      if (creditEarned > 0) {
        await insertLedgerEntry(client, {
          userId: effectiveUserId,
          assetId: asset.id,
          entryType: "sell_credit",
          quantityDelta: 0,
          cashDelta: 0,
          creditDelta: creditEarned,
          referenceType: "trade_fill",
          referenceId: fillRow.id,
        });
      }
    }

    await updateCashBalance(client, effectiveUserId, nextCash);
    const nextCredit = creditBalance - feeFromCredit + creditEarned;
    if (feeFromCredit > 0 || creditEarned > 0) {
      await client.query(`UPDATE market.portfolio_cash_balances SET credit_balance = $2, updated_at = now() WHERE user_id = $1`, [effectiveUserId, nextCredit]);
    }
    await upsertHolding(client, {
      userId: effectiveUserId,
      assetId: asset.id,
      quantity: nextQuantity,
      avgCostBasis: nextAvgCost,
    });

    const updatedQuote = buyback
      ? await recordBuybackSale(client, asset, buyback, {
          quantity: parsedQuantity,
          executionPrice: executablePrice,
          grossCash,
          marketDate: status?.last_settlement_market_date || null,
        })
      : await updateAssetAfterTrade(client, asset, {
          side: effectiveSide,
          quantity: parsedQuantity,
          executionPrice: executablePrice,
          fairPrice,
          now,
          marketDate: status?.last_settlement_market_date || null,
          persistentOffset,
          transientOffset,
        });
    await supply.moveShares(client, asset.id, effectiveSide === "buy" ? parsedQuantity : -parsedQuantity);
    // The stock's supply after this fill, for the live floor (sold out, shares left for sale).
    const heldAfter = Math.max(0, toNumber(asset.circulating_supply, 0) + (effectiveSide === "buy" ? parsedQuantity : -parsedQuantity));
    const supplyAfter = {
      circulating_supply: heldAfter,
      shares_for_sale: supply.sharesForSale({ ...asset, circulating_supply: heldAfter, treasury_supply: Math.max(0, toNumber(asset.max_supply, 0) - heldAfter) }),
      trading_state: asset.trading_state || "open",
    };
    Object.assign(updatedQuote, supplyAfter);

    const userIdentity = await getUserTradeIdentity(client, effectiveUserId);
    await client.query("COMMIT");

    if (refreshDerivedState) {
      netWorth.queueLeaderboardRefresh(pool, asset.id, { extraUserIds: [effectiveUserId] });
    }

    void publishMarketEvent(redis, {
      type: "market.trade_fill",
      trade: {
        id: fillRow.id,
        order_id: orderId,
        user_id: effectiveUserId,
        username: userIdentity?.username || null,
        profile_color: userIdentity?.profile_color || null,
        asset_id: asset.id,
        symbol: asset.symbol,
        display_name: asset.display_name,
        icon: asset.icon || null,
        color: asset.color || null,
        ts: fillRow.ts,
        side: effectiveSide,
        price: executablePrice,
        quantity: parsedQuantity,
        requested_quantity: requirePositiveQuantity(effectiveQuantity),
        buyback: Boolean(buyback),
        gross_cash: grossCash,
        fee_cash: feeCash,
        net_cash: effectiveSide === "buy" ? -(grossCash + feeCash) : grossCash - feeCash,
        counterparty_type: "treasury",
      },
      quote: {
        asset_id: asset.id,
        symbol: asset.symbol,
        display_name: asset.display_name,
        mid_price: updatedQuote.mid_price,
        bid_price: updatedQuote.bid_price,
        ask_price: updatedQuote.ask_price,
        premium_pct: updatedQuote.premium_pct,
        circulating_supply: supplyAfter.circulating_supply,
        shares_for_sale: supplyAfter.shares_for_sale,
        trading_state: supplyAfter.trading_state,
        updated_at: fillRow.ts,
      },
      market_status: {
        current_market_date: status?.current_market_date || null,
        last_settlement_market_date: status?.last_settlement_market_date || null,
        is_trading_open: Boolean(status?.is_trading_open),
      },
    });

    achievements.handleTradeFill(pool, {
      userId: effectiveUserId,
      fillId: fillRow.id,
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.error("achievement evaluation failed:", String(error?.message || error));
    });

    return {
      order_id: orderId,
      fill_id: fillRow.id,
      filled_quantity: parsedQuantity,
      executed_price: executablePrice,
      fee: feeCash,
      total_cost: effectiveSide === "buy" ? grossCash + feeCash : null,
      total_proceeds: effectiveSide === "sell" ? grossCash - feeCash : null,
      cost_basis_sold: costBasisSold,
      realized_pnl: effectiveSide === "sell" ? (grossCash - feeCash) - (costBasisSold || 0) : null,
      side: effectiveSide,
      symbol: asset.symbol,
      updated_holdings: {
        quantity: nextQuantity,
        avg_cost_basis: nextAvgCost,
      },
      updated_cash_balance: nextCash,
      updated_credit_balance: nextCredit,
      fee_from_credit: feeFromCredit,
      credit_earned: creditEarned,
      updated_quote: updatedQuote,
      filled_at: fillRow.ts,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** YYYY-MM-DD for a DATE column (node-pg gives a local-midnight Date) or a string. */
function toDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

/**
 * The tick window from the clock alone: the market day starts at the 09:00 ET Open tick, then
 * Lunch 15:00, Late 21:00 and Overnight 03:00 (which still belongs to the previous market day).
 */
function clockLiveOrderInterval(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  const hour = Number(parts.hour);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (hour >= 9) return { marketDate: today, intervalKey: hour < 15 ? "open" : hour < 21 ? "lunch" : "late", scheduledAt: null };
  const previous = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1)).toISOString().slice(0, 10);
  return { marketDate: previous, intervalKey: hour < 3 ? "late" : "overnight", scheduledAt: null };
}

/** When the current tick window ends (the next Open/Lunch/Late/Overnight tick), to the minute. */
function nextLiveOrderWindowAt(now = new Date()) {
  const current = clockLiveOrderInterval(now);
  const start = Math.ceil(now.getTime() / 60_000) * 60_000;
  for (let minute = 0; minute <= 7 * 60; minute++) {
    const at = new Date(start + minute * 60_000);
    const next = clockLiveOrderInterval(at);
    if (next.intervalKey !== current.intervalKey || next.marketDate !== current.marketDate) return at;
  }
  return null;
}

/**
 * The window the per-player share limit counts against. Uses the settled market day's tick schedule
 * when the market date is current; if the daily settlement hasn't advanced it (a stalled scheduler, or
 * a local database without YouTube data), falls back to the clock so the limit still resets every tick
 * instead of piling up in one window forever.
 */
async function resolveLiveOrderInterval(client, { statusMarketDate, now = new Date() }) {
  const clock = clockLiveOrderInterval(now);
  if (toDateKey(statusMarketDate) !== clock.marketDate) return clock;
  return getCurrentLiveOrderInterval(client, { marketDate: statusMarketDate, now });
}

async function getCurrentLiveOrderInterval(client, { marketDate, now = new Date() } = {}) {
  if (!marketDate) {
    return { marketDate: null, intervalKey: "open", scheduledAt: null };
  }

  const { rows } = await client.query(
    `
    WITH session AS (
      SELECT id, market_date
      FROM market.adjustment_sessions
      WHERE market_date = $1
      ORDER BY id DESC
      LIMIT 1
    ),
    interval_schedule AS (
      SELECT
        i.interval_key,
        MIN(i.scheduled_at) AS scheduled_at
      FROM market.asset_adjustment_intervals i
      JOIN session s ON s.id = i.session_id
      GROUP BY i.interval_key
    )
    SELECT interval_key, scheduled_at
    FROM interval_schedule
    WHERE scheduled_at <= $2
    ORDER BY scheduled_at DESC
    LIMIT 1
  `,
    [marketDate, now.toISOString()]
  );

  if (rows[0]) {
    return {
      marketDate,
      intervalKey: rows[0].interval_key,
      scheduledAt: rows[0].scheduled_at,
    };
  }

  return { marketDate, intervalKey: "open", scheduledAt: null };
}

async function sumLiveOrderSharesForTick(client, { userId, executeAfter }) {
  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(requested_quantity), 0) AS share_count
    FROM market.trade_orders
    WHERE user_id = $1
      AND order_type = 'live_market'
      AND status = 'pending'
      AND execute_after IS NOT DISTINCT FROM $2::timestamptz
  `,
    [userId, executeAfter]
  );
  return Number(rows[0]?.share_count || 0);
}

async function sumLiveOrderSharesForInterval(client, { userId, marketDate, intervalKey }) {
  const { rows } = await client.query(
    `
    SELECT COALESCE(SUM(requested_quantity), 0) AS share_count
    FROM market.trade_orders
    WHERE user_id = $1
      AND order_type = 'live_market'
      AND status IN ('pending', 'filled')
      AND submitted_market_date IS NOT DISTINCT FROM $2::date
      AND submitted_interval_key IS NOT DISTINCT FROM $3
  `,
    [userId, marketDate, intervalKey]
  );
  return Number(rows[0]?.share_count || 0);
}

/**
 * A player's share allowance for the current tick window, across all stocks: what their next order
 * can still use. Counts the orders submitLiveOrder counts (pending and filled; cancelled and rejected
 * ones give their shares back), so the two never disagree.
 */
async function getLiveOrderAllowance(pool, { userId, now = new Date() }) {
  const status = await marketState.getMarketStatus(pool);
  const statusMarketDate = status?.last_settlement_market_date || status?.current_market_date || null;
  const interval = await resolveLiveOrderInterval(pool, { statusMarketDate, now });
  const used = await sumLiveOrderSharesForInterval(pool, {
    userId,
    marketDate: interval.marketDate,
    intervalKey: interval.intervalKey,
  });
  return {
    limit: LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL,
    used,
    remaining: Math.max(0, LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL - used),
    window: interval.intervalKey,
    resets_at: nextLiveOrderWindowAt(now)?.toISOString() ?? null,
  };
}

async function lockLiveOrderInterval(client, { userId, marketDate, intervalKey }) {
  await client.query(
    `
    SELECT pg_advisory_xact_lock(
      hashtext($1)::integer,
      hashtext($2)::integer
    )
  `,
    [String(userId), String(`${marketDate || "none"}/${intervalKey || "none"}`)]
  );
}

async function submitLiveOrder(pool, { userId, symbol, side, quantity, redis = null }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const status = await marketState.getMarketStatusWithClient(client);
    if (status && !status.is_trading_open) {
      const error = new Error("market_closed");
      error.code = "market_closed";
      error.marketStatus = status;
      throw error;
    }

    const normalizedSide = String(side || "").toLowerCase();
    if (!["buy", "sell"].includes(normalizedSide)) {
      const error = new Error("invalid_side");
      error.code = "invalid_side";
      throw error;
    }

    const parsedQuantity = requirePositiveQuantity(quantity);
    const asset = await getLockedAssetBySymbol(client, symbol, { lock: false });
    if (!asset) {
      const error = new Error("asset_not_found");
      error.code = "asset_not_found";
      throw error;
    }
    // A stock with no fair value yet would otherwise trade at the $0.000001 price floor.
    if (asset.status !== "active" || !(toNumber(asset.current_fair_value, 0) > 0)) {
      const error = new Error("asset_not_active");
      error.code = "asset_not_active";
      throw error;
    }

    if (normalizedSide === "buy" && asset.trading_state === "buyback") {
      const error = new Error("buyback_frozen");
      error.code = "buyback_frozen";
      throw error;
    }
    if (normalizedSide === "buy" && !(supply.sharesForSale(asset) > 0)) {
      const error = new Error("sold_out");
      error.code = "sold_out";
      throw error;
    }

    const cashAccount = await ensureUserCashAccount(client, userId);
    const holding = await getLockedHolding(client, userId, asset.id);
    const now = new Date();
    const fairPrice = Math.max(toNumber(asset.current_fair_value, 0), 0.000001);
    const { persistentOffset, transientOffset } = getDecayedOffsets(asset, now);
    const liveMidBefore = computeLiveMidPrice(fairPrice, persistentOffset, transientOffset);
    const quotesBefore = computeQuotes(liveMidBefore, asset.spread_bps);
    const activeBuyback = asset.trading_state === "buyback" ? await supply.getActiveBuyback(client, asset.id) : null;
    const indicativePrice = activeBuyback
      ? supply.buybackFillPrice(asset, activeBuyback, parsedQuantity, now)
      : computeExecutionPrice({
          side: normalizedSide,
          bidPrice: quotesBefore.bidPrice,
          askPrice: quotesBefore.askPrice,
          quantity: parsedQuantity,
          liquidityDepth: asset.liquidity_depth,
        });
    if (!(indicativePrice > 0)) {
      const error = new Error("invalid_quote");
      error.code = "invalid_quote";
      throw error;
    }

    const indicativeGrossCash = indicativePrice * parsedQuantity;
    const indicativeFeeCash = indicativeGrossCash * getTradingFeeRate();
    // The fee comes out of Credit first, so Cash only has to cover the rest of it.
    const indicativeFeeFromCash = Math.max(0, indicativeFeeCash - Math.max(0, toNumber(cashAccount.credit_balance, 0)));
    if (normalizedSide === "buy" && toNumber(cashAccount.cash_balance, 0) < indicativeGrossCash + indicativeFeeFromCash) {
      const error = new Error("insufficient_cash");
      error.code = "insufficient_cash";
      throw error;
    }
    if (normalizedSide === "sell") {
      // Shares already in queued sells aren't available to another one.
      const queuedShares = await sumPendingSellShares(client, { userId, assetId: asset.id });
      if (toNumber(holding?.quantity, 0) - queuedShares < parsedQuantity) {
        const error = new Error("insufficient_holdings");
        error.code = "insufficient_holdings";
        error.queuedShares = queuedShares;
        throw error;
      }
    }

    // A buy holds its estimated cost and a margin, or all the cash there is if that's less (it
    // covers the estimate either way: checked above).
    const heldCash =
      normalizedSide === "buy" ? Math.min(toNumber(cashAccount.cash_balance, 0), (indicativeGrossCash + indicativeFeeFromCash) * (1 + LIVE_ORDER_HOLD_MARGIN)) : 0;

    const statusMarketDate = status?.last_settlement_market_date || status?.current_market_date || null;
    const interval = await resolveLiveOrderInterval(client, { statusMarketDate, now });
    const executeAfter = computeNextLiveOrderTick(now);
    const executeAfterIso = executeAfter.toISOString();
    await lockLiveOrderInterval(client, {
      userId,
      marketDate: interval.marketDate,
      intervalKey: interval.intervalKey,
    });
    const submittedShares = await sumLiveOrderSharesForInterval(client, {
      userId,
      marketDate: interval.marketDate,
      intervalKey: interval.intervalKey,
    });
    const remainingShares = Math.max(0, LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL - submittedShares);
    if (parsedQuantity > remainingShares) {
      const error = new Error("live_order_limit_exceeded");
      error.code = "live_order_limit_exceeded";
      error.limit = LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL;
      error.submittedShares = submittedShares;
      error.remainingShares = remainingShares;
      error.windowKey = interval.intervalKey;
      error.resetsAt = nextLiveOrderWindowAt(now)?.toISOString() ?? null;
      throw error;
    }

    const { rows } = await client.query(
      `
      INSERT INTO market.trade_orders (
        user_id,
        asset_id,
        side,
        order_type,
        requested_quantity,
        filled_quantity,
        status,
        quote_bid_at_submit,
        quote_ask_at_submit,
        execute_after,
        submitted_market_date,
        submitted_interval_key,
        metadata_json,
        held_cash,
        updated_at
      ) VALUES ($1,$2,$3,'live_market',$4,0,'pending',$5,$6,$7,$8,$9,$10::jsonb,$11,now())
      RETURNING id, requested_at
    `,
      [
        userId,
        asset.id,
        normalizedSide,
        parsedQuantity,
        quotesBefore.bidPrice,
        quotesBefore.askPrice,
        executeAfterIso,
        interval.marketDate,
        interval.intervalKey,
        JSON.stringify({
          queued_mid_price: roundForMetadata(liveMidBefore),
          queued_indicative_price: roundForMetadata(indicativePrice),
          queued_fee_rate: getTradingFeeRate(),
          live_order_share_limit: LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL,
          submitted_interval_scheduled_at: interval.scheduledAt || null,
        }),
        heldCash,
      ]
    );
    await moveHeldCash(client, { userId, assetId: asset.id, orderId: rows[0].id, amount: heldCash });

    await client.query("COMMIT");

    const order = {
      order_id: rows[0].id,
      user_id: userId,
      status: "pending",
      order_type: "live_market",
      side: normalizedSide,
      symbol: asset.symbol,
      requested_quantity: parsedQuantity,
      submitted_shares: submittedShares + parsedQuantity,
      remaining_tick_shares: null,
      remaining_interval_shares: Math.max(0, remainingShares - parsedQuantity),
      tick_share_limit: null,
      interval_share_limit: LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL,
      interval_limit: LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL,
      submitted_market_date: interval.marketDate,
      submitted_interval_key: interval.intervalKey,
      execute_after: executeAfterIso,
      quote_bid_at_submit: quotesBefore.bidPrice,
      quote_ask_at_submit: quotesBefore.askPrice,
      indicative_price: indicativePrice,
      requested_at: rows[0].requested_at,
    };

    void publishMarketEvent(redis, {
      type: "market.live_order_queued",
      order,
    });

    // The player's own copy also says what it held and the cash left to spend.
    return { ...order, held_cash: heldCash, cash_balance: toNumber(cashAccount.cash_balance, 0) - heldCash };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function roundForMetadata(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(8));
}

function isLiveOrderRejectionCode(code) {
  return [
    "market_closed",
    "asset_not_found",
    "asset_not_active",
    "insufficient_cash",
    "insufficient_holdings",
    "invalid_quote",
    "invalid_quantity",
    "live_order_not_pending",
    "sold_out",
    "buyback_frozen",
  ].includes(String(code || ""));
}

async function rejectLiveOrder(pool, { orderId, reason, liveOrderBatchId = null }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      UPDATE market.trade_orders
      SET
        status = 'rejected',
        rejection_reason = $2,
        live_order_batch_id = COALESCE($3, live_order_batch_id),
        updated_at = now()
      WHERE id = $1
        AND status = 'pending'
        AND order_type = 'live_market'
      RETURNING
        id,
        user_id,
        asset_id,
        side,
        order_type,
        requested_quantity,
        filled_quantity,
        status,
        quote_bid_at_submit,
        quote_ask_at_submit,
        rejection_reason,
        execute_after,
        live_order_batch_id,
        submitted_market_date,
        submitted_interval_key,
        held_cash,
        requested_at,
        updated_at
    `,
      [orderId, reason, liveOrderBatchId]
    );
    const order = rows[0] || null;
    if (order) await releaseOrderHold(client, order);
    await client.query("COMMIT");
    return order;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cancelLiveOrder(pool, { orderId, userId, redis = null }) {
  const client = await pool.connect();
  let order = null;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE market.trade_orders
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1
         AND user_id = $2
         AND status = 'pending'
         AND order_type = 'live_market'
       RETURNING
         id,
         user_id,
         asset_id,
         side,
         order_type,
         requested_quantity,
         filled_quantity,
         status,
         quote_bid_at_submit,
         quote_ask_at_submit,
         rejection_reason,
         execute_after,
         live_order_batch_id,
         submitted_market_date,
         submitted_interval_key,
         held_cash,
         requested_at,
         updated_at`,
      [orderId, userId]
    );
    order = rows[0] || null;
    if (!order) {
      const error = new Error("live_order_not_found_or_not_pending");
      error.code = "live_order_not_found_or_not_pending";
      throw error;
    }
    await releaseOrderHold(client, order);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const assetSnapshot = await getOrderAssetSnapshot(pool, order.id);

  void publishMarketEvent(redis, {
    type: "market.live_order_cancelled",
    order: assetSnapshot || order,
    user_id: userId,
    at: new Date().toISOString(),
  });

  return order;
}

async function getOrderAssetSnapshot(pool, orderId) {
  const { rows } = await pool.query(
    `
    SELECT
      o.id,
      o.user_id,
      o.asset_id,
      a.symbol,
      a.display_name,
      o.side,
      o.order_type,
      o.requested_quantity,
      o.filled_quantity,
      o.status,
      o.quote_bid_at_submit,
      o.quote_ask_at_submit,
      o.rejection_reason,
      o.execute_after,
      o.live_order_batch_id,
      o.submitted_market_date,
      o.submitted_interval_key,
      o.requested_at,
      o.updated_at
    FROM market.trade_orders o
    JOIN market.market_assets a ON a.id = o.asset_id
    WHERE o.id = $1
    LIMIT 1
  `,
    [orderId]
  );
  return rows[0] || null;
}

async function createLiveOrderBatch(pool) {
  const { rows } = await pool.query(
    `
    INSERT INTO market.live_order_batches (status, started_at)
    VALUES ('started', now())
    RETURNING id, started_at
  `
  );
  return rows[0];
}

async function completeLiveOrderBatch(pool, { batchId, attempted, filled, rejected, errorText = null }) {
  await pool.query(
    `
    UPDATE market.live_order_batches
    SET
      status = $2,
      completed_at = now(),
      orders_attempted = $3,
      orders_filled = $4,
      orders_rejected = $5,
      error_text = $6
    WHERE id = $1
  `,
    [batchId, errorText ? "failed" : "completed", attempted, filled, rejected, errorText]
  );
}

async function listDueLiveOrders(pool, { now = new Date(), limit = LIVE_ORDER_BATCH_LIMIT } = {}) {
  const { rows } = await pool.query(
    `
    SELECT id, asset_id, user_id
    FROM market.trade_orders
    WHERE order_type = 'live_market'
      AND status = 'pending'
      AND execute_after <= $1
    ORDER BY execute_after ASC, id ASC
    LIMIT $2
  `,
    [now.toISOString(), limit]
  );
  return rows
    .map((row) => ({
      id: Number(row.id),
      asset_id: Number(row.asset_id),
      user_id: Number(row.user_id),
    }))
    .filter((row) => row.id > 0 && row.asset_id > 0 && row.user_id > 0);
}

async function runWithConcurrency(items, concurrency, worker) {
  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(safeConcurrency, items.length) },
      () => runNext()
    )
  );
}

async function processDueLiveOrders(pool, { now = new Date(), limit = LIVE_ORDER_BATCH_LIMIT, redis = null } = {}) {
  // While trading is closed (settlement, or halted by an admin) queued orders wait for the next
  // batch after it reopens instead of being rejected.
  const marketStatus = await marketState.getMarketStatus(pool);
  if (marketStatus && !marketStatus.is_trading_open) {
    return { batch_id: null, attempted: 0, filled: 0, rejected: 0, skipped: "market_closed" };
  }
  const dueOrders = await listDueLiveOrders(pool, { now, limit });
  if (dueOrders.length === 0) {
    return { batch_id: null, attempted: 0, filled: 0, rejected: 0 };
  }

  const batch = await createLiveOrderBatch(pool);
  let filled = 0;
  let rejected = 0;
  let fatalError = null;
  const groupedByAsset = new Map();
  const refreshUserIdsByAsset = new Map();

  for (const order of dueOrders) {
    const group = groupedByAsset.get(order.asset_id) || [];
    group.push(order);
    groupedByAsset.set(order.asset_id, group);
  }

  await runWithConcurrency(Array.from(groupedByAsset.entries()), LIVE_ORDER_WORKER_CONCURRENCY, async ([, orders]) => {
    for (const order of orders) {
      try {
        await executeOrder(pool, {
          existingOrderId: order.id,
          liveOrderBatchId: batch.id,
          redis,
          refreshDerivedState: false,
        });
        filled += 1;
        const refreshUserIds = refreshUserIdsByAsset.get(order.asset_id) || new Set();
        refreshUserIds.add(order.user_id);
        refreshUserIdsByAsset.set(order.asset_id, refreshUserIds);
      } catch (error) {
        const reason = isLiveOrderRejectionCode(error?.code) ? error.code : "execution_failed";
        try {
          const rejectedOrder = await rejectLiveOrder(pool, { orderId: order.id, reason, liveOrderBatchId: batch.id });
          const orderSnapshot = rejectedOrder ? await getOrderAssetSnapshot(pool, order.id) : null;
          if (orderSnapshot) {
            void publishMarketEvent(redis, {
              type: "market.live_order_rejected",
              order: orderSnapshot,
              reason,
              batch_id: batch.id,
              at: new Date().toISOString(),
            });
          }
          rejected += 1;
        } catch (rejectError) {
          fatalError = fatalError || String(rejectError?.message || rejectError);
        }
        if (!isLiveOrderRejectionCode(error?.code)) {
          fatalError = fatalError || String(error?.message || error);
        }
      }
    }
  });

  await completeLiveOrderBatch(pool, {
    batchId: batch.id,
    attempted: dueOrders.length,
    filled,
    rejected,
    errorText: fatalError,
  });

  for (const [assetId, userIds] of refreshUserIdsByAsset.entries()) {
    netWorth.queueLeaderboardRefresh(pool, assetId, { extraUserIds: Array.from(userIds) });
  }

  return {
    batch_id: batch.id,
    attempted: dueOrders.length,
    filled,
    rejected,
    worker_concurrency: LIVE_ORDER_WORKER_CONCURRENCY,
    error: fatalError,
  };
}

async function acquireLiveOrderSchedulerLock(client) {
  const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [LIVE_ORDER_SCHEDULER_LOCK_KEY]);
  return Boolean(rows[0]?.locked);
}

async function releaseLiveOrderSchedulerLock(client) {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [LIVE_ORDER_SCHEDULER_LOCK_KEY]);
  } catch {}
}

function startLiveOrderScheduler(pool, logger = console, redis = null) {
  const enabled = (process.env.MARKET_LIVE_ORDER_SCHEDULER_ENABLED || "true").toLowerCase() !== "false";
  const intervalMs = Math.max(
    500,
    Number(process.env.MARKET_LIVE_ORDER_SCHEDULER_INTERVAL_MS || DEFAULT_LIVE_ORDER_SCHEDULER_INTERVAL_MS)
  );
  const heartbeat = schedulerHealth.startSchedulerHeartbeat(redis, "live-orders", { enabled, intervalMs }, logger);
  if (!enabled) return () => heartbeat.stop();
  let running = false;

  async function tick() {
    if (!enabled || running) return;
    running = true;
    heartbeat.update("running");
    let tickError = null;
    let lockClient = null;
    try {
      // Inside the try: a pool timeout here used to be an unhandled rejection (a crashed pod) and
      // left `running` stuck on.
      lockClient = await pool.connect();
      const locked = await acquireLiveOrderSchedulerLock(lockClient);
      if (!locked) return;
      const result = await processDueLiveOrders(pool, { redis });
      if (result.attempted > 0) {
        await invalidateMarketAssetsCache(redis);
        logger.info?.("market live order batch processed", result);
      }
    } catch (error) {
      tickError = error;
      heartbeat.update("error", error);
      logger.error?.("market live order scheduler failed", error);
    } finally {
      if (lockClient) {
        await releaseLiveOrderSchedulerLock(lockClient).catch(() => {});
        lockClient.release();
      }
      running = false;
      heartbeat.update(tickError ? "error" : "idle", tickError);
    }
  }

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => { clearInterval(timer); heartbeat.stop(); };
}

async function getPortfolioSummary(pool, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cashAccount = await ensureUserCashAccount(client, userId);

    const holdingsResult = await client.query(
      `
      SELECT
        h.asset_id,
        a.symbol,
        a.display_name,
        h.quantity,
        h.avg_cost_basis,
        a.current_mid_price,
        a.current_fair_value,
        (h.quantity * COALESCE(a.current_mid_price, 0)) AS market_value,
        (h.quantity * (COALESCE(a.current_mid_price, 0) - h.avg_cost_basis)) AS unrealized_pnl
      FROM market.portfolio_holdings h
      JOIN market.market_assets a ON a.id = h.asset_id
      WHERE h.user_id = $1
      ORDER BY a.symbol ASC
    `,
      [userId]
    );

    await client.query("COMMIT");

    const holdings = holdingsResult.rows;
    const totalMarketValue = holdings.reduce((sum, row) => sum + toNumber(row.market_value, 0), 0);
    const totalUnrealizedPnl = holdings.reduce((sum, row) => sum + toNumber(row.unrealized_pnl, 0), 0);

    const creditBalance = toNumber(cashAccount.credit_balance, 0);
    return {
      cash_balance: toNumber(cashAccount.cash_balance, 0),
      // Set aside for queued buys: not spendable, still yours (it counts toward net worth).
      held_cash: toNumber(cashAccount.held_cash, 0),
      credit_balance: creditBalance,
      total_market_value: totalMarketValue,
      total_unrealized_pnl: totalUnrealizedPnl,
      total_equity:
        toNumber(cashAccount.cash_balance, 0) +
        toNumber(cashAccount.held_cash, 0) +
        (economy.SETTINGS.netWorth === "cash_and_credit" ? creditBalance : 0) +
        totalMarketValue,
      // The Credit rules in force (some are still open: see services/economy.js).
      economy: economy.publicSettings(),
      holdings,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getPortfolioLedger(pool, userId, { limit = 100 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT
      l.id,
      l.user_id,
      l.asset_id,
      a.symbol,
      a.display_name,
      l.entry_type,
      l.quantity_delta,
      l.cash_delta,
      l.reference_type,
      l.reference_id,
      l.created_at
    FROM market.ledger_entries l
    LEFT JOIN market.market_assets a ON a.id = l.asset_id
    WHERE l.user_id = $1
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT $2
  `,
    [userId, limit]
  );
  return rows;
}

async function getPortfolioOrders(pool, userId, { limit = 100 } = {}) {
  const { rows } = await pool.query(
    `
    SELECT
      o.id,
      o.asset_id,
      a.symbol,
      a.display_name,
      o.side,
      o.order_type,
      o.requested_quantity,
      o.filled_quantity,
      o.status,
      o.quote_bid_at_submit,
      o.quote_ask_at_submit,
      o.rejection_reason,
      o.execute_after,
      o.live_order_batch_id,
      o.submitted_market_date,
      o.submitted_interval_key,
      o.held_cash,
      o.requested_at,
      o.updated_at,
      f.fill_id,
      f.fill_ts,
      f.fill_price,
      f.fill_gross_cash,
      f.fill_fee_cash
    -- The newest orders first, then their fills (only for filled ones, and only fills after the
    -- order was placed, so the lookup stays inside recent chunks of the fills table).
    FROM (
      SELECT * FROM market.trade_orders WHERE user_id = $1 ORDER BY requested_at DESC, id DESC LIMIT $2
    ) o
    JOIN market.market_assets a ON a.id = o.asset_id
    -- The fill, so a client that missed the live market.trade_fill event can still show it.
    LEFT JOIN LATERAL (
      SELECT MAX(tf.id) AS fill_id, MAX(tf.ts) AS fill_ts,
             SUM(tf.price * tf.quantity) / NULLIF(SUM(tf.quantity), 0) AS fill_price,
             SUM(tf.gross_cash) AS fill_gross_cash, SUM(tf.fee_cash) AS fill_fee_cash
      FROM market.trade_fills tf WHERE o.status = 'filled' AND tf.order_id = o.id AND tf.ts >= o.requested_at
    ) f ON true
    ORDER BY o.requested_at DESC, o.id DESC
  `,
    [userId, limit]
  );
  return rows;
}

async function getLiveOrderAdminHealth(pool, { batchLimit = 10, redis = null } = {}) {
  const safeLimit = Math.min(50, Math.max(1, Number.parseInt(String(batchLimit || 10), 10) || 10));
  const [healthResult, batchesResult] = await Promise.all([
    pool.query(
      `
      SELECT
        MIN(execute_after) FILTER (WHERE status = 'pending' AND order_type = 'live_market') AS next_execute_after,
        MIN(requested_at) FILTER (WHERE status = 'pending' AND order_type = 'live_market') AS oldest_pending_at,
        COUNT(*) FILTER (WHERE status = 'pending' AND order_type = 'live_market')::INTEGER AS pending_count,
        COUNT(*) FILTER (
          WHERE status = 'pending'
            AND order_type = 'live_market'
            AND execute_after <= now()
        )::INTEGER AS due_pending_count,
        COUNT(*) FILTER (
          WHERE status = 'pending'
            AND order_type = 'live_market'
            AND execute_after < now() - interval '10 minutes'
        )::INTEGER AS overdue_pending_count,
        COUNT(*) FILTER (
          WHERE status = 'rejected'
            AND order_type = 'live_market'
            AND updated_at >= now() - interval '24 hours'
        )::INTEGER AS rejected_24h_count,
        COUNT(*) FILTER (
          WHERE status = 'filled'
            AND order_type = 'live_market'
            AND updated_at >= now() - interval '24 hours'
        )::INTEGER AS filled_24h_count
      FROM market.trade_orders
    `
    ),
    pool.query(
      `
      SELECT
        id,
        status,
        started_at,
        completed_at,
        orders_attempted,
        orders_filled,
        orders_rejected,
        error_text,
        created_at
      FROM market.live_order_batches
      ORDER BY started_at DESC, id DESC
      LIMIT $1
    `,
      [safeLimit]
    ),
  ]);

  return {
    generated_at: new Date().toISOString(),
    ...await schedulerHealth.getSchedulerHealth(redis, "live-orders"),
    share_limit_per_tick: null,
    share_limit_per_interval: LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL,
    batch_limit: LIVE_ORDER_BATCH_LIMIT,
    worker_concurrency: LIVE_ORDER_WORKER_CONCURRENCY,
    health: healthResult.rows[0] || {},
    recent_batches: batchesResult.rows,
  };
}

module.exports = {
  executeOrder,
  submitLiveOrder,
  getLiveOrderAllowance,
  cancelLiveOrder,
  processDueLiveOrders,
  startLiveOrderScheduler,
  getLiveOrderAdminHealth,
  getStarterCash,
  getPortfolioSummary,
  getPortfolioLedger,
  getPortfolioOrders,
  _test: { clockLiveOrderInterval, resolveLiveOrderInterval, nextLiveOrderWindowAt },
};
