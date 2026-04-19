#!/usr/bin/env node

const assert = require("node:assert/strict");
const { Pool } = require("pg");

const { applySchema } = require("../src/migrations");
const predictionMarketService = require("../src/services/predictionMarketService");
const predictionOrderbook = require("../src/services/predictionOrderbook");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL");
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

async function ensureUser(pool, {
  username,
  isAdmin = false,
  canCreate = false,
  canApprove = false,
  canResolve = false,
  canVoid = false,
} = {}) {
  const passwordParams = JSON.stringify({ N: 16384, r: 8, p: 1 });
  const { rows } = await pool.query(
    `
    INSERT INTO market.users (
      username,
      username_normalized,
      password_hash,
      password_salt,
      password_params_json,
      is_admin,
      can_create_prediction_markets,
      can_approve_prediction_markets,
      can_resolve_prediction_markets,
      can_void_prediction_markets,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,now())
    ON CONFLICT (username_normalized)
    DO UPDATE SET
      is_admin = EXCLUDED.is_admin,
      can_create_prediction_markets = EXCLUDED.can_create_prediction_markets,
      can_approve_prediction_markets = EXCLUDED.can_approve_prediction_markets,
      can_resolve_prediction_markets = EXCLUDED.can_resolve_prediction_markets,
      can_void_prediction_markets = EXCLUDED.can_void_prediction_markets,
      updated_at = now()
    RETURNING id, username, is_admin, can_create_prediction_markets, can_approve_prediction_markets, can_resolve_prediction_markets, can_void_prediction_markets
  `,
    [
      username,
      normalizeUsername(username),
      "seeded-test-password-hash",
      "seeded-test-password-salt",
      passwordParams,
      isAdmin,
      canCreate,
      canApprove,
      canResolve,
      canVoid,
    ]
  );
  return rows[0];
}

async function cleanupMarket(pool, slug) {
  const marketResult = await pool.query(`SELECT id FROM market.prediction_markets WHERE slug = $1`, [slug]);
  const marketId = marketResult.rows[0]?.id || null;
  if (!marketId) return;
  await pool.query(`DELETE FROM market.prediction_market_events WHERE market_id = $1`, [marketId]);
  await pool.query(`DELETE FROM market.prediction_market_price_history WHERE market_id = $1`, [marketId]);
  await pool.query(`DELETE FROM market.prediction_market_trades WHERE market_id = $1`, [marketId]);
  await pool.query(`DELETE FROM market.prediction_market_positions WHERE market_id = $1`, [marketId]);
  await pool.query(`DELETE FROM market.prediction_market_orders WHERE market_id = $1`, [marketId]);
  await pool.query(`DELETE FROM market.prediction_market_outcomes WHERE market_id = $1`, [marketId]);
  await pool.query(`DELETE FROM market.prediction_markets WHERE id = $1`, [marketId]);
}

async function resetLedgerForUsers(pool, userIds) {
  await pool.query(`DELETE FROM market.ledger_entries WHERE user_id = ANY($1::bigint[])`, [userIds]);
  await pool.query(`DELETE FROM market.portfolio_cash_balances WHERE user_id = ANY($1::bigint[])`, [userIds]);
}

async function fetchMarketSummary(pool, slug) {
  const { rows } = await pool.query(
    `
    SELECT id, slug, status, trading_status, last_traded_probability, total_volume_cash, open_interest_shares, last_trade_at
    FROM market.prediction_markets
    WHERE slug = $1
    LIMIT 1
  `,
    [slug]
  );
  return rows[0] || null;
}

async function fetchPositions(pool, slug, usernames) {
  const { rows } = await pool.query(
    `
    SELECT
      u.username,
      o.outcome_code,
      p.shares,
      p.avg_entry_price,
      p.realized_pnl_cash
    FROM market.prediction_market_positions p
    JOIN market.users u ON u.id = p.user_id
    JOIN market.prediction_markets pm ON pm.id = p.market_id
    JOIN market.prediction_market_outcomes o ON o.id = p.outcome_id
    WHERE pm.slug = $1
      AND u.username = ANY($2::text[])
    ORDER BY u.username ASC, o.outcome_code ASC
  `,
    [slug, usernames]
  );
  return rows;
}

async function fetchCashBalances(pool, usernames) {
  const { rows } = await pool.query(
    `
    SELECT u.username, pcb.cash_balance
    FROM market.users u
    JOIN market.portfolio_cash_balances pcb ON pcb.user_id = u.id
    WHERE u.username = ANY($1::text[])
    ORDER BY u.username ASC
  `,
    [usernames]
  );
  return rows;
}

async function assertRejectsWithCode(fn, code) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error?.code, code);
    return;
  }
  throw new Error(`Expected rejection with code ${code}`);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function approxEqual(actual, expected, epsilon = 1e-9) {
  return Math.abs(actual - expected) <= epsilon;
}

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    options: process.env.PG_OPTIONS || "-c timezone=UTC",
  });

  const slug = "canonical-refactor-e2e-test";
  const privateSlug = "canonical-refactor-private-visibility-test";
  const creatorName = "prediction_creator_test";
  const approverName = "prediction_approver_test";
  const traderYesName = "prediction_yes_trader_test";
  const traderNoName = "prediction_no_trader_test";

  try {
    await applySchema(pool);

    const creator = await ensureUser(pool, {
      username: creatorName,
      canCreate: true,
    });
    const approver = await ensureUser(pool, {
      username: approverName,
      canApprove: true,
      canResolve: true,
      canVoid: true,
    });
    const traderYes = await ensureUser(pool, { username: traderYesName });
    const traderNo = await ensureUser(pool, { username: traderNoName });

    await cleanupMarket(pool, slug);
    await cleanupMarket(pool, privateSlug);
    await resetLedgerForUsers(pool, [creator.id, approver.id, traderYes.id, traderNo.id]);

    const market = await predictionMarketService.createPredictionMarket(pool, creator, {
      slug,
      title: "Canonical Refactor E2E Test",
      subtitle: "Verifies mint and redeem flows",
      description: "Scripted test market",
      rules_text: "Resolves YES for test purposes only.",
      resolution_source_text: "Test harness source",
      visibility: "public",
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      resolves_after: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
    });

    await predictionMarketService.submitPredictionMarket(pool, market.id, creator);
    await predictionMarketService.approvePredictionMarket(pool, market.id, approver);

    const buyYes = await predictionOrderbook.placePredictionOrder(pool, {
      userId: traderYes.id,
      slug,
      outcomeCode: "yes",
      side: "buy",
      price: 0.6,
      quantity: 10,
    });

    const mintMatch = await predictionOrderbook.placePredictionOrder(pool, {
      userId: traderNo.id,
      slug,
      outcomeCode: "no",
      side: "buy",
      price: 0.45,
      quantity: 10,
    });

    const sellYes = await predictionOrderbook.placePredictionOrder(pool, {
      userId: traderYes.id,
      slug,
      outcomeCode: "yes",
      side: "sell",
      price: 0.55,
      quantity: 5,
    });

    const redeemMatch = await predictionOrderbook.placePredictionOrder(pool, {
      userId: traderNo.id,
      slug,
      outcomeCode: "no",
      side: "sell",
      price: 0.35,
      quantity: 5,
    });

    const restingBuyYes = await predictionOrderbook.placePredictionOrder(pool, {
      userId: traderNo.id,
      slug,
      outcomeCode: "yes",
      side: "buy",
      price: 0.52,
      quantity: 2,
    });

    const secondaryMatch = await predictionOrderbook.placePredictionOrder(pool, {
      userId: traderYes.id,
      slug,
      outcomeCode: "yes",
      side: "sell",
      price: 0.5,
      quantity: 2,
    });

    const cancellableBuyNo = await predictionOrderbook.placePredictionOrder(pool, {
      userId: traderNo.id,
      slug,
      outcomeCode: "no",
      side: "buy",
      price: 0.2,
      quantity: 3,
    });

    const cancelledBuyNo = await predictionOrderbook.cancelPredictionOrder(pool, {
      userId: traderNo.id,
      slug,
      orderId: cancellableBuyNo.order_id,
    });

    const privateMarket = await predictionMarketService.createPredictionMarket(pool, creator, {
      slug: privateSlug,
      title: "Canonical Private Visibility Test",
      subtitle: "Verifies private review visibility",
      description: "Private market for permission assertions",
      rules_text: "Private market test rules.",
      resolution_source_text: "Private market test source",
      visibility: "private",
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      resolves_after: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
    });

    await predictionMarketService.submitPredictionMarket(pool, privateMarket.id, creator);

    const marketSummary = await fetchMarketSummary(pool, slug);
    const orderbook = await predictionOrderbook.getPredictionOrderBook(pool, slug, { depth: 10 });
    const trades = await predictionOrderbook.getPredictionTrades(pool, slug, { limit: 20 });
    const yesCandles = await predictionOrderbook.getPredictionCandles(pool, slug, { interval: "1h", outcomeCode: "yes", limit: 10 });
    const noCandles = await predictionOrderbook.getPredictionCandles(pool, slug, { interval: "1h", outcomeCode: "no", limit: 10 });
    const positions = await fetchPositions(pool, slug, [traderYesName, traderNoName]);
    const cashBalances = await fetchCashBalances(pool, [traderYesName, traderNoName]);
    const creatorPrivateDetail = await predictionMarketService.getPredictionMarketDetail(pool, privateSlug, creator);
    const approverPrivateDetail = await predictionMarketService.getPredictionMarketDetail(pool, privateSlug, approver);
    const publicListForTrader = await predictionMarketService.listPredictionMarkets(pool, {
      actorUser: traderYes,
      scope: "public",
      limit: 50,
    });
    const mineListForCreator = await predictionMarketService.listPredictionMarkets(pool, {
      actorUser: creator,
      scope: "mine",
      limit: 50,
    });
    const reviewQueueForApprover = await predictionMarketService.listPredictionMarkets(pool, {
      actorUser: approver,
      scope: "review_queue",
      limit: 50,
    });

    assert.equal(buyYes.order_status, "open");
    assert.equal(mintMatch.order_status, "filled");
    assert.equal(sellYes.order_status, "open");
    assert.equal(redeemMatch.order_status, "filled");
    assert.equal(restingBuyYes.order_status, "open");
    assert.equal(secondaryMatch.order_status, "filled");
    assert.equal(cancellableBuyNo.order_status, "open");
    assert.equal(cancelledBuyNo.status, "cancelled");
    assert.ok(approxEqual(toNumber(cancelledBuyNo.refunded_cash), 0.6));

    assert.equal(String(marketSummary.status), "open");
    assert.equal(String(marketSummary.trading_status), "open");
    assert.ok(approxEqual(toNumber(marketSummary.last_traded_probability), 0.52));
    assert.ok(approxEqual(toNumber(marketSummary.total_volume_cash), 16.04));
    assert.ok(approxEqual(toNumber(marketSummary.open_interest_shares), 5));

    assert.deepEqual(orderbook, {
      yes: { buy: [], sell: [] },
      no: { buy: [], sell: [] },
    });

    assert.equal(trades.length, 3);
    assert.equal(trades[0].trade_kind, "secondary");
    assert.equal(trades[1].trade_kind, "redeem");
    assert.equal(trades[2].trade_kind, "mint");
    assert.ok(approxEqual(toNumber(trades[0].price), 0.52));
    assert.ok(approxEqual(toNumber(trades[1].price), 0.55));
    assert.ok(approxEqual(toNumber(trades[2].price), 0.6));
    assert.equal(trades[0].maker_side, "buy");
    assert.equal(trades[0].taker_side, "sell");
    assert.equal(trades[1].maker_side, "sell");
    assert.equal(trades[1].taker_side, "sell");
    assert.equal(trades[2].maker_side, "buy");
    assert.equal(trades[2].taker_side, "buy");

    assert.equal(yesCandles.length, 1);
    assert.equal(noCandles.length, 1);
    assert.ok(approxEqual(toNumber(yesCandles[0].close), 0.52));
    assert.ok(approxEqual(toNumber(noCandles[0].close), 0.48));
    assert.ok(approxEqual(toNumber(yesCandles[0].close) + toNumber(noCandles[0].close), 1));
    assert.ok(approxEqual(toNumber(yesCandles[0].volume_shares), 17));
    assert.ok(approxEqual(toNumber(noCandles[0].volume_shares), 17));
    assert.ok(approxEqual(toNumber(yesCandles[0].volume_cash), 16.04));
    assert.ok(approxEqual(toNumber(noCandles[0].volume_cash), 16.04));

    const positionMap = new Map(positions.map((row) => [`${row.username}:${row.outcome_code}`, row]));
    assert.equal(positionMap.size, 3);
    assert.ok(approxEqual(toNumber(positionMap.get(`${traderYesName}:yes`)?.shares), 3));
    assert.ok(approxEqual(toNumber(positionMap.get(`${traderYesName}:yes`)?.avg_entry_price), 0.6));
    assert.ok(approxEqual(toNumber(positionMap.get(`${traderYesName}:yes`)?.realized_pnl_cash), -0.41));
    assert.ok(approxEqual(toNumber(positionMap.get(`${traderNoName}:yes`)?.shares), 2));
    assert.ok(approxEqual(toNumber(positionMap.get(`${traderNoName}:yes`)?.avg_entry_price), 0.52));
    assert.ok(approxEqual(toNumber(positionMap.get(`${traderNoName}:yes`)?.realized_pnl_cash), 0));
    assert.ok(approxEqual(toNumber(positionMap.get(`${traderNoName}:no`)?.shares), 5));
    assert.ok(approxEqual(toNumber(positionMap.get(`${traderNoName}:no`)?.avg_entry_price), 0.4));
    assert.ok(approxEqual(toNumber(positionMap.get(`${traderNoName}:no`)?.realized_pnl_cash), 0.25));

    const cashMap = new Map(cashBalances.map((row) => [row.username, row]));
    assert.ok(approxEqual(toNumber(cashMap.get(traderYesName)?.cash_balance), 9997.79));
    assert.ok(approxEqual(toNumber(cashMap.get(traderNoName)?.cash_balance), 9997.21));

    assert.equal(creatorPrivateDetail.slug, privateSlug);
    assert.equal(creatorPrivateDetail.status, "pending_approval");
    assert.equal(creatorPrivateDetail.viewer_permissions.can_submit_for_approval, false);
    assert.equal(approverPrivateDetail.slug, privateSlug);
    assert.equal(approverPrivateDetail.viewer_permissions.can_approve, true);
    assert.equal(publicListForTrader.items.some((item) => item.slug === privateSlug), false);
    assert.equal(mineListForCreator.items.some((item) => item.slug === privateSlug), true);
    assert.equal(reviewQueueForApprover.items.some((item) => item.slug === privateSlug), true);

    await assertRejectsWithCode(
      () => predictionMarketService.getPredictionMarketDetail(pool, privateSlug, traderYes),
      "prediction_market_not_found"
    );
    await assertRejectsWithCode(
      () => predictionMarketService.listPredictionMarkets(pool, {
        actorUser: traderYes,
        scope: "review_queue",
        limit: 50,
      }),
      "forbidden"
    );

    console.log(JSON.stringify({
      ok: true,
      market_created_id: market.id,
      order_results: {
        buy_yes: buyYes,
        mint_match: mintMatch,
        sell_yes: sellYes,
        redeem_match: redeemMatch,
        resting_buy_yes: restingBuyYes,
        secondary_match: secondaryMatch,
        cancellable_buy_no: cancellableBuyNo,
        cancelled_buy_no: cancelledBuyNo,
      },
      market_summary: marketSummary,
      orderbook,
      trades,
      yes_candles: yesCandles,
      no_candles: noCandles,
      positions,
      cash_balances: cashBalances,
      private_market: {
        creator_detail: {
          slug: creatorPrivateDetail.slug,
          status: creatorPrivateDetail.status,
          viewer_permissions: creatorPrivateDetail.viewer_permissions,
        },
        approver_detail: {
          slug: approverPrivateDetail.slug,
          status: approverPrivateDetail.status,
          viewer_permissions: approverPrivateDetail.viewer_permissions,
        },
        public_list_contains_private: publicListForTrader.items.some((item) => item.slug === privateSlug),
        creator_mine_contains_private: mineListForCreator.items.some((item) => item.slug === privateSlug),
        approver_review_queue_contains_private: reviewQueueForApprover.items.some((item) => item.slug === privateSlug),
      },
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
