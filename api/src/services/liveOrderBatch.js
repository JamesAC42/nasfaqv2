// Keep fill calculations in trading.js; only batch their database I/O here.
const { ensureUserCashAccount } = require("./portfolioCash");

const LOCK_NOT_AVAILABLE = "55P03";

/**
 * Locks everything a chunk of due orders touches, in a fill's lock order (order, stock, buyback, cash,
 * holding) and id order within each, and reads it. Orders that stopped being pending are left out.
 * Returns null without waiting if another transaction is writing one of the stocks: a tick locks its
 * stocks one at a time in its own order, so waiting for them here, holding others, could deadlock with
 * it. NO KEY UPDATE, because that's all these writes need and it doesn't conflict with the key-share
 * lock anyone inserting a row that references a stock holds: a player placing an order, the leaderboard
 * refresh. FOR UPDATE would turn this chunk away for those.
 */
async function lockChunk(client, orderIds) {
  const { rows: orders } = await client.query(
    `
    SELECT o.id, o.user_id, o.asset_id, o.side, o.requested_quantity, o.held_cash
    FROM market.trade_orders o
    WHERE o.id = ANY($1::bigint[])
      AND o.order_type = 'live_market'
      AND o.status = 'pending'
    ORDER BY o.execute_after ASC, o.id ASC
    FOR UPDATE OF o
  `,
    [orderIds]
  );
  if (!orders.length) return { orders, assets: new Map(), buybacks: new Map(), accounts: new Map(), holdings: new Map(), identities: new Map() };

  const assetIds = [...new Set(orders.map((order) => Number(order.asset_id)))];
  const userIds = [...new Set(orders.map((order) => Number(order.user_id)))];

  let assetRows;
  try {
    ({ rows: assetRows } = await client.query(
      `
      SELECT
        a.id, a.symbol, a.display_name, c.icon, c.color, a.status, a.current_mid_price, a.current_bid_price, a.current_ask_price,
        a.current_premium_pct, a.current_fair_value, a.current_persistent_offset, a.current_transient_offset, a.offsets_updated_at,
        a.circulating_supply, a.treasury_supply, a.max_supply, a.broker_buffer_pct, a.trading_state, a.liquidity_depth, a.spread_bps,
        a.latest_snapshot_id
      FROM market.market_assets a
      JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
      WHERE a.id = ANY($1::bigint[])
      ORDER BY a.id
      FOR NO KEY UPDATE OF a NOWAIT
    `,
      [assetIds]
    ));
  } catch (error) {
    if (error?.code !== LOCK_NOT_AVAILABLE) throw error;
    return null;
  }

  const frozen = assetRows.filter((asset) => asset.trading_state === "buyback").map((asset) => Number(asset.id));
  const { rows: buybackRows } = frozen.length
    ? await client.query(`SELECT * FROM market.asset_buybacks WHERE asset_id = ANY($1::bigint[]) AND status = 'active' ORDER BY asset_id FOR UPDATE`, [frozen])
    : { rows: [] };
  const { rows: accountRows } = await client.query(
    `SELECT user_id, cash_balance, held_cash, credit_balance FROM market.portfolio_cash_balances WHERE user_id = ANY($1::bigint[]) ORDER BY user_id FOR UPDATE`,
    [userIds]
  );
  const { rows: holdingRows } = await client.query(
    `
    SELECT h.user_id, h.asset_id, h.quantity, h.avg_cost_basis
    FROM market.portfolio_holdings h
    JOIN (SELECT DISTINCT * FROM unnest($1::bigint[], $2::bigint[]) AS p(user_id, asset_id)) p ON p.user_id = h.user_id AND p.asset_id = h.asset_id
    ORDER BY h.user_id, h.asset_id
    FOR UPDATE OF h
  `,
    [orders.map((order) => order.user_id), orders.map((order) => order.asset_id)]
  );
  const { rows: identityRows } = await client.query(`SELECT id, username, profile_color FROM market.users WHERE id = ANY($1::bigint[])`, [userIds]);

  return {
    orders,
    assets: new Map(assetRows.map((row) => [Number(row.id), row])),
    buybacks: new Map(buybackRows.map((row) => [Number(row.asset_id), row])),
    accounts: new Map(accountRows.map((row) => [Number(row.user_id), row])),
    holdings: new Map(holdingRows.map((row) => [`${Number(row.user_id)}:${Number(row.asset_id)}`, row])),
    identities: new Map(identityRows.map((row) => [Number(row.id), row])),
  };
}

/**
 * Writes a planned chunk in one go: one statement per table, whatever its size. Numbers go in as the
 * same text a row-at-a-time write sends them as, so the columns hold the same digits. Fills and ledger
 * rows are inserted in the order the plan made them, so their ids run in fill order too. Returns the
 * fills' ids and timestamps by order id, and the rejected orders as their event reports them.
 *
 * A fill's ts is cut to the millisecond (a JS Date can't hold more): everything in a chunk shares one
 * ts, and the tape's cursor is (ts, id), read back through a Date.
 */
async function writeChunk(client, plan, { batchId, marketDate }) {
  const filledByOrder = new Map();
  if (plan.fills.length) {
    await client.query(
      `
      UPDATE market.trade_orders o
      SET filled_quantity = s.quantity,
        status = 'filled',
        quote_bid_at_submit = COALESCE(o.quote_bid_at_submit, s.bid),
        quote_ask_at_submit = COALESCE(o.quote_ask_at_submit, s.ask),
        live_order_batch_id = COALESCE($2, o.live_order_batch_id),
        updated_at = now()
      FROM jsonb_to_recordset($1::jsonb) AS s(order_id bigint, quantity numeric, bid numeric, ask numeric)
      WHERE o.id = s.order_id
    `,
      [JSON.stringify(plan.fills.map((fill) => ({ order_id: fill.orderId, quantity: fill.quantity, bid: fill.quoteBid, ask: fill.quoteAsk }))), batchId]
    );
    const { rows } = await client.query(
      `
      INSERT INTO market.trade_fills (order_id, asset_id, user_id, ts, side, price, quantity, gross_cash, fee_cash, net_cash, counterparty_type)
      SELECT s.order_id, s.asset_id, s.user_id, date_trunc('milliseconds', now()), s.side, s.price, s.quantity, s.gross_cash, s.fee_cash, s.net_cash, 'treasury'
      FROM jsonb_to_recordset($1::jsonb) AS s(seq int, order_id bigint, asset_id bigint, user_id bigint, side text, price numeric, quantity numeric, gross_cash numeric, fee_cash numeric, net_cash numeric)
      ORDER BY s.seq
      RETURNING id, order_id, ts
    `,
      [
        JSON.stringify(
          plan.fills.map((fill, seq) => ({
            seq,
            order_id: fill.orderId,
            asset_id: fill.assetId,
            user_id: fill.userId,
            side: fill.side,
            price: fill.price,
            quantity: fill.quantity,
            gross_cash: fill.grossCash,
            fee_cash: fill.feeCash,
            net_cash: fill.netCash,
          }))
        ),
      ]
    );
    for (const row of rows) filledByOrder.set(Number(row.order_id), row);
  }

  // Opened in passing (an order whose player has no cash row yet): the row and its grant come first.
  for (const account of plan.openedAccounts) await ensureUserCashAccount(client, account.user_id);

  const { rows: rejected } = plan.rejections.length
    ? await client.query(
        `
        UPDATE market.trade_orders o
        SET status = 'rejected', rejection_reason = s.reason, live_order_batch_id = COALESCE($2, o.live_order_batch_id), updated_at = now()
        FROM jsonb_to_recordset($1::jsonb) AS s(order_id bigint, reason text), market.market_assets a
        WHERE o.id = s.order_id AND a.id = o.asset_id
        RETURNING
          o.id, o.user_id, o.asset_id, a.symbol, a.display_name, o.side, o.order_type, o.requested_quantity, o.filled_quantity, o.status,
          o.quote_bid_at_submit, o.quote_ask_at_submit, o.rejection_reason, o.execute_after, o.live_order_batch_id,
          o.submitted_market_date, o.submitted_interval_key, o.requested_at, o.updated_at
      `,
        [JSON.stringify(plan.rejections.map((rejection) => ({ order_id: rejection.orderId, reason: rejection.reason }))), batchId]
      )
    : { rows: [] };

  if (plan.ledger.length) {
    await client.query(
      `
      INSERT INTO market.ledger_entries (user_id, asset_id, entry_type, quantity_delta, cash_delta, credit_delta, reference_type, reference_id)
      SELECT s.user_id, s.asset_id, s.entry_type, s.quantity_delta, s.cash_delta, s.credit_delta, s.reference_type, s.reference_id
      FROM jsonb_to_recordset($1::jsonb) AS s(seq int, user_id bigint, asset_id bigint, entry_type text, quantity_delta numeric, cash_delta numeric, credit_delta numeric, reference_type text, reference_id bigint)
      ORDER BY s.seq
    `,
      [
        JSON.stringify(
          plan.ledger.map((entry, seq) => ({
            seq,
            user_id: entry.userId,
            asset_id: entry.assetId,
            entry_type: entry.entryType,
            quantity_delta: entry.quantityDelta,
            cash_delta: entry.cashDelta,
            credit_delta: entry.creditDelta || 0,
            reference_type: entry.referenceType,
            reference_id: entry.fillOrderId ? filledByOrder.get(entry.fillOrderId).id : entry.referenceId,
          }))
        ),
      ]
    );
  }

  if (plan.accounts.length) {
    await client.query(
      `
      UPDATE market.portfolio_cash_balances b
      SET cash_balance = s.cash_balance, held_cash = s.held_cash, credit_balance = s.credit_balance, updated_at = now()
      FROM jsonb_to_recordset($1::jsonb) AS s(user_id bigint, cash_balance numeric, held_cash numeric, credit_balance numeric)
      WHERE b.user_id = s.user_id
    `,
      [JSON.stringify(plan.accounts)]
    );
  }

  if (plan.holdings.length) {
    await client.query(
      `
      INSERT INTO market.portfolio_holdings (user_id, asset_id, quantity, avg_cost_basis, updated_at)
      SELECT s.user_id, s.asset_id, s.quantity, s.avg_cost_basis, now()
      FROM jsonb_to_recordset($1::jsonb) AS s(user_id bigint, asset_id bigint, quantity numeric, avg_cost_basis numeric)
      ON CONFLICT (user_id, asset_id) DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost_basis = EXCLUDED.avg_cost_basis, updated_at = now()
    `,
      [JSON.stringify(plan.holdings)]
    );
  }

  if (plan.assets.length) {
    // A stock in a buyback has no quote fields here: its price stays frozen, only its supply moves.
    await client.query(
      `
      UPDATE market.market_assets a
      SET current_mid_price = COALESCE(s.mid, a.current_mid_price),
        current_bid_price = COALESCE(s.bid, a.current_bid_price),
        current_ask_price = COALESCE(s.ask, a.current_ask_price),
        current_premium_pct = COALESCE(s.premium, a.current_premium_pct),
        current_persistent_offset = COALESCE(s.persistent_offset, a.current_persistent_offset),
        current_transient_offset = COALESCE(s.transient_offset, a.current_transient_offset),
        offsets_updated_at = COALESCE(s.offsets_updated_at, a.offsets_updated_at),
        circulating_supply = s.circulating_supply,
        treasury_supply = s.treasury_supply,
        updated_at = now()
      FROM jsonb_to_recordset($1::jsonb) AS s(id bigint, mid numeric, bid numeric, ask numeric, premium numeric, persistent_offset numeric, transient_offset numeric, offsets_updated_at timestamptz, circulating_supply numeric, treasury_supply numeric)
      WHERE a.id = s.id
    `,
      [JSON.stringify(plan.assets)]
    );
  }

  if (plan.dailyStates.length && marketDate) {
    await client.query(
      `
      UPDATE market.asset_daily_market_state d
      SET mid_close = COALESCE(s.mid_close, d.mid_close),
        mid_high = CASE WHEN s.mid_high IS NULL THEN d.mid_high ELSE GREATEST(COALESCE(d.mid_high, d.mid_open), s.mid_high) END,
        mid_low = CASE WHEN s.mid_low IS NULL THEN d.mid_low ELSE LEAST(COALESCE(d.mid_low, d.mid_open), s.mid_low) END,
        bid_close = COALESCE(s.bid_close, d.bid_close),
        ask_close = COALESCE(s.ask_close, d.ask_close),
        premium_close_pct = COALESCE(s.premium_close_pct, d.premium_close_pct),
        volume_shares = d.volume_shares + s.volume_shares,
        volume_cash = d.volume_cash + s.volume_cash,
        trade_count = d.trade_count + s.trade_count,
        updated_at = now()
      FROM jsonb_to_recordset($1::jsonb) AS s(asset_id bigint, mid_close numeric, mid_high numeric, mid_low numeric, bid_close numeric, ask_close numeric, premium_close_pct numeric, volume_shares numeric, volume_cash numeric, trade_count int)
      WHERE d.asset_id = s.asset_id AND d.market_date = $2
    `,
      [JSON.stringify(plan.dailyStates), marketDate]
    );
  }

  if (plan.buybacks.length) {
    await client.query(
      `
      UPDATE market.asset_buybacks b
      SET shares_bought = b.shares_bought + s.shares, cash_paid = b.cash_paid + s.cash
      FROM jsonb_to_recordset($1::jsonb) AS s(id bigint, shares numeric, cash numeric)
      WHERE b.id = s.id
    `,
      [JSON.stringify(plan.buybacks)]
    );
  }

  return { filledByOrder, rejected };
}

module.exports = { lockChunk, writeChunk };
