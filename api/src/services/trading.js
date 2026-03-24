const DEFAULT_STARTER_CASH = 10000;
const DEFAULT_TRADING_FEE_RATE = 0.01;
const DEFAULT_TRANSIENT_HALF_LIFE_MINUTES = 60;
const DEFAULT_TRANSIENT_IMPACT_WEIGHT = 0.7;
const DEFAULT_PERSISTENT_IMPACT_WEIGHT = 0.15;
const DEFAULT_EXECUTION_SLIPPAGE_WEIGHT = 0.5;

function getTradingFeeRate() {
  const parsed = Number(process.env.MARKET_TRADING_FEE_RATE || DEFAULT_TRADING_FEE_RATE);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TRADING_FEE_RATE;
}

function getStarterCash() {
  const parsed = Number(process.env.MARKET_STARTER_CASH || DEFAULT_STARTER_CASH);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STARTER_CASH;
}

const TRANSIENT_HALF_LIFE_MINUTES = Number(process.env.MARKET_TRANSIENT_HALF_LIFE_MINUTES || DEFAULT_TRANSIENT_HALF_LIFE_MINUTES);
const TRANSIENT_IMPACT_WEIGHT = Number(process.env.MARKET_TRANSIENT_IMPACT_WEIGHT || DEFAULT_TRANSIENT_IMPACT_WEIGHT);
const PERSISTENT_IMPACT_WEIGHT = Number(process.env.MARKET_PERSISTENT_IMPACT_WEIGHT || DEFAULT_PERSISTENT_IMPACT_WEIGHT);
const EXECUTION_SLIPPAGE_WEIGHT = Number(process.env.MARKET_EXECUTION_SLIPPAGE_WEIGHT || DEFAULT_EXECUTION_SLIPPAGE_WEIGHT);

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

async function ensureUserCashAccount(client, userId) {
  const existing = await client.query(
    `
    SELECT user_id, cash_balance
    FROM market.portfolio_cash_balances
    WHERE user_id = $1
    FOR UPDATE
  `,
    [userId]
  );

  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  const starterCash = getStarterCash();
  await client.query(
    `
    INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, updated_at)
    VALUES ($1, $2, now())
  `,
    [userId, starterCash]
  );

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
    ) VALUES ($1, NULL, 'starter_cash_grant', 0, $2, 'system', 0)
  `,
    [userId, starterCash]
  );

  return { user_id: userId, cash_balance: starterCash };
}

async function getLockedAssetBySymbol(client, symbol) {
  const { rows } = await client.query(
    `
    SELECT
      id,
      symbol,
      display_name,
      status,
      current_mid_price,
      current_bid_price,
      current_ask_price,
      current_premium_pct,
      current_fair_value,
      current_fair_value_raw,
      current_daily_emission,
      current_persistent_offset,
      current_transient_offset,
      offsets_updated_at,
      circulating_supply,
      treasury_supply,
      liquidity_depth,
      spread_bps,
      latest_snapshot_date,
      latest_snapshot_id
    FROM market.market_assets
    WHERE symbol = $1
    FOR UPDATE
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

async function updateAssetAfterTrade(client, asset, {
  side,
  quantity,
  executionPrice,
  fairPrice,
  now,
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

  if (asset.latest_snapshot_id && asset.latest_snapshot_date) {
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
      [asset.id, asset.latest_snapshot_date, nextMid, quotes.bidPrice, quotes.askPrice, nextPremium, quantity, executionPrice * quantity]
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

async function executeOrder(pool, { userId, symbol, side, quantity }) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const parsedQuantity = requirePositiveQuantity(quantity);
    const asset = await getLockedAssetBySymbol(client, symbol);
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
    const feeRate = getTradingFeeRate();
    const now = new Date();
    const fairPrice = Math.max(toNumber(asset.current_fair_value, 0), 0.000001);
    const { persistentOffset, transientOffset } = getDecayedOffsets(asset, now);
    const liveMidBefore = computeLiveMidPrice(fairPrice, persistentOffset, transientOffset);
    const quotesBefore = computeQuotes(liveMidBefore, asset.spread_bps);
    const executablePrice = computeExecutionPrice({
      side,
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
    const totalCash = side === "buy" ? grossCash + feeCash : grossCash - feeCash;

    if (side === "buy" && toNumber(cashAccount.cash_balance, 0) < totalCash) {
      const error = new Error("insufficient_cash");
      error.code = "insufficient_cash";
      throw error;
    }

    if (side === "sell") {
      const currentQty = toNumber(holding?.quantity, 0);
      if (currentQty < parsedQuantity) {
        const error = new Error("insufficient_holdings");
        error.code = "insufficient_holdings";
        throw error;
      }
    }

    const orderId = await createOrder(client, {
      userId,
      assetId: asset.id,
      side,
      quantity: parsedQuantity,
      bidPrice: quotesBefore.bidPrice,
      askPrice: quotesBefore.askPrice,
    });

    const fillRow = await createFill(client, {
      orderId,
      assetId: asset.id,
      userId,
      side,
      price: executablePrice,
      quantity: parsedQuantity,
      grossCash,
      feeCash,
      netCash: side === "buy" ? -(grossCash + feeCash) : grossCash - feeCash,
    });

    const currentCash = toNumber(cashAccount.cash_balance, 0);
    const currentQuantity = toNumber(holding?.quantity, 0);
    const currentAvgCost = toNumber(holding?.avg_cost_basis, 0);

    let nextCash = currentCash;
    let nextQuantity = currentQuantity;
    let nextAvgCost = currentAvgCost;

    if (side === "buy") {
      nextCash = currentCash - grossCash - feeCash;
      nextQuantity = currentQuantity + parsedQuantity;
      nextAvgCost =
        nextQuantity > 0
          ? ((currentQuantity * currentAvgCost) + grossCash + feeCash) / nextQuantity
          : 0;

      await insertLedgerEntry(client, {
        userId,
        assetId: asset.id,
        entryType: "buy_asset_credit",
        quantityDelta: parsedQuantity,
        cashDelta: 0,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
      await insertLedgerEntry(client, {
        userId,
        assetId: asset.id,
        entryType: "buy_cash_debit",
        quantityDelta: 0,
        cashDelta: -grossCash,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
      await insertLedgerEntry(client, {
        userId,
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
        userId,
        assetId: asset.id,
        entryType: "sell_asset_debit",
        quantityDelta: -parsedQuantity,
        cashDelta: 0,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
      await insertLedgerEntry(client, {
        userId,
        assetId: asset.id,
        entryType: "sell_cash_credit",
        quantityDelta: 0,
        cashDelta: grossCash,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
      await insertLedgerEntry(client, {
        userId,
        assetId: asset.id,
        entryType: "trade_fee",
        quantityDelta: 0,
        cashDelta: -feeCash,
        referenceType: "trade_fill",
        referenceId: fillRow.id,
      });
    }

    await updateCashBalance(client, userId, nextCash);
    await upsertHolding(client, {
      userId,
      assetId: asset.id,
      quantity: nextQuantity,
      avgCostBasis: nextAvgCost,
    });

    const updatedQuote = await updateAssetAfterTrade(client, asset, {
      side,
      quantity: parsedQuantity,
      executionPrice: executablePrice,
      fairPrice,
      now,
      persistentOffset,
      transientOffset,
    });

    await client.query("COMMIT");

    return {
      order_id: orderId,
      fill_id: fillRow.id,
      filled_quantity: parsedQuantity,
      executed_price: executablePrice,
      fee: feeCash,
      total_cost: side === "buy" ? grossCash + feeCash : null,
      total_proceeds: side === "sell" ? grossCash - feeCash : null,
      side,
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

module.exports = {
  executeOrder,
  getStarterCash,
  getPortfolioSummary,
  getPortfolioLedger,
  getPortfolioOrders,
};
