const DEFAULT_TRADING_FEE_RATE = 0.01;
const DEFAULT_TRANSIENT_HALF_LIFE_MINUTES = 60;
const DEFAULT_TRANSIENT_IMPACT_WEIGHT = 0.7;
const DEFAULT_PERSISTENT_IMPACT_WEIGHT = 0.15;
const DEFAULT_EXECUTION_SLIPPAGE_WEIGHT = 0.5;
const DEFAULT_LIVE_ORDER_SHARE_LIMIT_PER_INTERVAL = 180;
const DEFAULT_LIVE_ORDER_BATCH_LIMIT = 100;
const DEFAULT_LIVE_ORDER_WORKER_CONCURRENCY = 4;
const DEFAULT_LIVE_ORDER_SCHEDULER_INTERVAL_MS = 1_000;
const LIVE_ORDER_SCHEDULER_LOCK_KEY = 9_204_003;
const marketState = require("./marketState");
const netWorth = require("./netWorth");
const achievements = require("./achievements");
const { ensureUserCashAccount, getStarterCash } = require("./portfolioCash");
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
      reference_type,
      reference_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
  `,
    [
      entry.userId,
      entry.assetId,
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

async function getLockedPendingLiveOrder(client, orderId) {
  const { rows } = await client.query(
    `
    SELECT
      o.id,
      o.user_id,
      o.asset_id,
      o.side,
      o.requested_quantity,
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
    }

    const status = await marketState.getMarketStatusWithClient(client);
    if (status && !status.is_trading_open) {
      const error = new Error("market_closed");
      error.code = "market_closed";
      error.marketStatus = status;
      throw error;
    }

    const parsedQuantity = requirePositiveQuantity(effectiveQuantity);
    const asset = await getLockedAssetBySymbol(client, effectiveSymbol);
    if (!asset) {
      const error = new Error("asset_not_found");
      error.code = "asset_not_found";
      throw error;
    }
    if (asset.status !== "active") {
      const error = new Error("asset_not_active");
      error.code = "asset_not_active";
      throw error;
    }

    const cashAccount = await ensureUserCashAccount(client, effectiveUserId);
    const holding = await getLockedHolding(client, effectiveUserId, asset.id);
    const feeRate = getTradingFeeRate();
    const now = new Date();
    const fairPrice = Math.max(toNumber(asset.current_fair_value, 0), 0.000001);
    const { persistentOffset, transientOffset } = getDecayedOffsets(asset, now);
    const liveMidBefore = computeLiveMidPrice(fairPrice, persistentOffset, transientOffset);
    const quotesBefore = computeQuotes(liveMidBefore, asset.spread_bps);
    const executablePrice = computeExecutionPrice({
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
    const totalCash = effectiveSide === "buy" ? grossCash + feeCash : grossCash - feeCash;

    if (effectiveSide === "buy" && toNumber(cashAccount.cash_balance, 0) < totalCash) {
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

    const currentCash = toNumber(cashAccount.cash_balance, 0);
    const currentQuantity = toNumber(holding?.quantity, 0);
    const currentAvgCost = toNumber(holding?.avg_cost_basis, 0);
    const costBasisSold = effectiveSide === "sell" ? currentAvgCost * parsedQuantity : null;

    let nextCash = currentCash;
    let nextQuantity = currentQuantity;
    let nextAvgCost = currentAvgCost;

    if (effectiveSide === "buy") {
      nextCash = currentCash - grossCash - feeCash;
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
        cashDelta: -feeCash,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
    } else {
      nextCash = currentCash + grossCash - feeCash;
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
        cashDelta: -feeCash,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
    }

    await updateCashBalance(client, effectiveUserId, nextCash);
    await upsertHolding(client, {
      userId: effectiveUserId,
      assetId: asset.id,
      quantity: nextQuantity,
      avgCostBasis: nextAvgCost,
    });

    const updatedQuote = await updateAssetAfterTrade(client, asset, {
      side: effectiveSide,
      quantity: parsedQuantity,
      executionPrice: executablePrice,
      fairPrice,
      now,
      marketDate: status?.last_settlement_market_date || null,
      persistentOffset,
      transientOffset,
    });

    const userIdentity = await getUserTradeIdentity(client, effectiveUserId);
    await client.query("COMMIT");

    if (refreshDerivedState) {
      netWorth.refreshCurrentLeaderboardForAsset(pool, asset.id, { extraUserIds: [effectiveUserId] }).catch((error) => {
        // eslint-disable-next-line no-console
        console.error("post-trade leaderboard refresh failed:", String(error?.message || error));
      });
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
    if (asset.status !== "active") {
      const error = new Error("asset_not_active");
      error.code = "asset_not_active";
      throw error;
    }

    const cashAccount = await ensureUserCashAccount(client, userId);
    const holding = await getLockedHolding(client, userId, asset.id);
    const now = new Date();
    const fairPrice = Math.max(toNumber(asset.current_fair_value, 0), 0.000001);
    const { persistentOffset, transientOffset } = getDecayedOffsets(asset, now);
    const liveMidBefore = computeLiveMidPrice(fairPrice, persistentOffset, transientOffset);
    const quotesBefore = computeQuotes(liveMidBefore, asset.spread_bps);
    const indicativePrice = computeExecutionPrice({
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
    if (normalizedSide === "buy" && toNumber(cashAccount.cash_balance, 0) < indicativeGrossCash + indicativeFeeCash) {
      const error = new Error("insufficient_cash");
      error.code = "insufficient_cash";
      throw error;
    }
    if (normalizedSide === "sell" && toNumber(holding?.quantity, 0) < parsedQuantity) {
      const error = new Error("insufficient_holdings");
      error.code = "insufficient_holdings";
      throw error;
    }

    const marketDate = status?.last_settlement_market_date || status?.current_market_date || null;
    const interval = await getCurrentLiveOrderInterval(client, { marketDate, now });
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
        updated_at
      ) VALUES ($1,$2,$3,'live_market',$4,0,'pending',$5,$6,$7,$8,$9,$10::jsonb,now())
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
      ]
    );

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

    return order;
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
  ].includes(String(code || ""));
}

async function rejectLiveOrder(pool, { orderId, reason, liveOrderBatchId = null }) {
  const { rows } = await pool.query(
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
      requested_at,
      updated_at
  `,
    [orderId, reason, liveOrderBatchId]
  );
  return rows[0] || null;
}

async function cancelLiveOrder(pool, { orderId, userId, redis = null }) {
  const { rows } = await pool.query(
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
       requested_at,
       updated_at`,
    [orderId, userId]
  );
  const order = rows[0] || null;
  if (!order) {
    const error = new Error("live_order_not_found_or_not_pending");
    error.code = "live_order_not_found_or_not_pending";
    throw error;
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
    netWorth.refreshCurrentLeaderboardForAsset(pool, assetId, {
      extraUserIds: Array.from(userIds),
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.error("post-batch leaderboard refresh failed:", String(error?.message || error));
    });
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
  let running = false;

  async function tick() {
    if (!enabled || running) return;
    running = true;
    const lockClient = await pool.connect();
    try {
      const locked = await acquireLiveOrderSchedulerLock(lockClient);
      if (!locked) return;
      const result = await processDueLiveOrders(pool, { redis });
      if (result.attempted > 0) {
        await invalidateMarketAssetsCache(redis);
        logger.info?.("market live order batch processed", result);
      }
    } catch (error) {
      logger.error?.("market live order scheduler failed", error);
    } finally {
      await releaseLiveOrderSchedulerLock(lockClient);
      lockClient.release();
      running = false;
    }
  }

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => clearInterval(timer);
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

    return {
      cash_balance: toNumber(cashAccount.cash_balance, 0),
      total_market_value: totalMarketValue,
      total_unrealized_pnl: totalUnrealizedPnl,
      total_equity: toNumber(cashAccount.cash_balance, 0) + totalMarketValue,
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
      o.requested_at,
      o.updated_at
    FROM market.trade_orders o
    JOIN market.market_assets a ON a.id = o.asset_id
    WHERE o.user_id = $1
    ORDER BY o.requested_at DESC, o.id DESC
    LIMIT $2
  `,
    [userId, limit]
  );
  return rows;
}

async function getLiveOrderAdminHealth(pool, { batchLimit = 10 } = {}) {
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
    scheduler_enabled: (process.env.MARKET_LIVE_ORDER_SCHEDULER_ENABLED || "true").toLowerCase() !== "false",
    scheduler_interval_ms: Math.max(
      500,
      Number(process.env.MARKET_LIVE_ORDER_SCHEDULER_INTERVAL_MS || DEFAULT_LIVE_ORDER_SCHEDULER_INTERVAL_MS)
    ),
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
  cancelLiveOrder,
  processDueLiveOrders,
  startLiveOrderScheduler,
  getLiveOrderAdminHealth,
  getStarterCash,
  getPortfolioSummary,
  getPortfolioLedger,
  getPortfolioOrders,
};
