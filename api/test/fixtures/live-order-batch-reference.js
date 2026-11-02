// The row-at-a-time live-order batch from 4fb957a (before batching), the reference oracle for the
// batched settlement's equivalence test and the "before" of scripts/bench-live-orders.js. Its loop and
// helpers are frozen here; each fill still goes through the live trading.executeOrder, so a change to
// fills that isn't made to the batched path too fails the test.
//
// `order` picks how the due orders run:
// - "workers" (what production ran): grouped by stock, four stocks at a time.
// - "fifo": one at a time in (execute_after, id) order, the order the batched path fills in.
const trading = require("../../src/services/trading");
const marketState = require("../../src/services/marketState");
const netWorth = require("../../src/services/netWorth");
const achievements = require("../../src/services/achievements");
const { publishMarketEvent } = require("../../src/services/marketEvents");

const REJECTION_CODES = new Set([
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
]);

async function runWithConcurrency(items, concurrency, worker) {
  let index = 0;
  async function runNext() {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
}

async function rejectLiveOrder(pool, { orderId, reason, liveOrderBatchId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      UPDATE market.trade_orders
      SET status = 'rejected', rejection_reason = $2, live_order_batch_id = COALESCE($3, live_order_batch_id), updated_at = now()
      WHERE id = $1 AND status = 'pending' AND order_type = 'live_market'
      RETURNING id, user_id, asset_id, held_cash
    `,
      [orderId, reason, liveOrderBatchId]
    );
    const order = rows[0] || null;
    const held = Number(order?.held_cash || 0);
    if (held > 0) {
      await client.query(
        `UPDATE market.portfolio_cash_balances SET cash_balance = cash_balance - $2, held_cash = held_cash + $2, updated_at = now() WHERE user_id = $1`,
        [order.user_id, -held]
      );
      await client.query(
        `INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, credit_delta, reference_type, reference_id)
         VALUES ($1, $2, 'order_cash_release', 0, $3, 0, 'trade_order', $4)`,
        [order.user_id, order.asset_id, held, order.id]
      );
    }
    await client.query("COMMIT");
    return order;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getOrderAssetSnapshot(pool, orderId) {
  const { rows } = await pool.query(
    `
    SELECT
      o.id, o.user_id, o.asset_id, a.symbol, a.display_name, o.side, o.order_type, o.requested_quantity, o.filled_quantity,
      o.status, o.quote_bid_at_submit, o.quote_ask_at_submit, o.rejection_reason, o.execute_after, o.live_order_batch_id,
      o.submitted_market_date, o.submitted_interval_key, o.requested_at, o.updated_at
    FROM market.trade_orders o
    JOIN market.market_assets a ON a.id = o.asset_id
    WHERE o.id = $1
    LIMIT 1
  `,
    [orderId]
  );
  return rows[0] || null;
}

async function processDueLiveOrders(pool, { now = new Date(), limit = 100, redis = null, order: run = "workers", concurrency = 4 } = {}) {
  const marketStatus = await marketState.getMarketStatus(pool);
  if (marketStatus && !marketStatus.is_trading_open) {
    return { batch_id: null, attempted: 0, filled: 0, rejected: 0, skipped: "market_closed" };
  }
  const { rows } = await pool.query(
    `
    SELECT id, asset_id, user_id
    FROM market.trade_orders
    WHERE order_type = 'live_market' AND status = 'pending' AND execute_after <= $1
    ORDER BY execute_after ASC, id ASC
    LIMIT $2
  `,
    [now.toISOString(), limit]
  );
  const dueOrders = rows.map((row) => ({ id: Number(row.id), asset_id: Number(row.asset_id), user_id: Number(row.user_id) }));
  if (dueOrders.length === 0) return { batch_id: null, attempted: 0, filled: 0, rejected: 0 };

  const batch = (await pool.query(`INSERT INTO market.live_order_batches (status, started_at) VALUES ('started', now()) RETURNING id, started_at`)).rows[0];
  let filled = 0;
  let rejected = 0;
  let fatalError = null;
  const refreshUserIdsByAsset = new Map();

  const fillOne = async (order) => {
    try {
      await trading.executeOrder(pool, { existingOrderId: order.id, liveOrderBatchId: batch.id, redis, refreshDerivedState: false });
      filled += 1;
      const refreshUserIds = refreshUserIdsByAsset.get(order.asset_id) || new Set();
      refreshUserIds.add(order.user_id);
      refreshUserIdsByAsset.set(order.asset_id, refreshUserIds);
    } catch (error) {
      const reason = REJECTION_CODES.has(String(error?.code || "")) ? error.code : "execution_failed";
      try {
        const rejectedOrder = await rejectLiveOrder(pool, { orderId: order.id, reason, liveOrderBatchId: batch.id });
        const orderSnapshot = rejectedOrder ? await getOrderAssetSnapshot(pool, order.id) : null;
        if (orderSnapshot) {
          void publishMarketEvent(redis, { type: "market.live_order_rejected", order: orderSnapshot, reason, batch_id: batch.id, at: new Date().toISOString() });
        }
        rejected += 1;
      } catch (rejectError) {
        fatalError = fatalError || String(rejectError?.message || rejectError);
      }
      if (!REJECTION_CODES.has(String(error?.code || ""))) fatalError = fatalError || String(error?.message || error);
    }
  };

  const releaseAchievementChecks = achievements.holdTradeFills();
  try {
    if (run === "fifo") {
      for (const order of dueOrders) await fillOne(order);
    } else {
      const groupedByAsset = new Map();
      for (const order of dueOrders) {
        const group = groupedByAsset.get(order.asset_id) || [];
        group.push(order);
        groupedByAsset.set(order.asset_id, group);
      }
      await runWithConcurrency(Array.from(groupedByAsset.values()), concurrency, async (orders) => {
        for (const order of orders) await fillOne(order);
      });
    }
  } finally {
    releaseAchievementChecks();
  }

  await pool.query(
    `UPDATE market.live_order_batches SET status = $2, completed_at = now(), orders_attempted = $3, orders_filled = $4, orders_rejected = $5, error_text = $6 WHERE id = $1`,
    [batch.id, fatalError ? "failed" : "completed", dueOrders.length, filled, rejected, fatalError]
  );
  for (const [assetId, userIds] of refreshUserIdsByAsset.entries()) {
    netWorth.queueLeaderboardRefresh(pool, assetId, { extraUserIds: Array.from(userIds) });
  }
  return { batch_id: batch.id, attempted: dueOrders.length, filled, rejected, error: fatalError };
}

module.exports = { processDueLiveOrders };
