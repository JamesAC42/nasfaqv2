const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { applySchema } = require("../src/migrations");
const economy = require("../src/services/economy");
const wallet = require("../src/services/games/wallet");
const predictionsCore = require("../src/services/predictions/core");
const trading = require("../src/services/trading");
const netWorth = require("../src/services/netWorth");
const { getStarterCash, getStarterCredit } = require("../src/services/portfolioCash");

test("splitting a charge between Credit and Cash", () => {
  const wallet = { credit: 30, cash: 100 };
  assert.deepEqual(economy.splitCharge(wallet, 20, "credit"), { credit: 20, cash: 0 });
  assert.throws(() => economy.splitCharge(wallet, 50, "credit"), { code: "insufficient_credit" });
  assert.deepEqual(economy.splitCharge(wallet, 50, "credit_then_cash"), { credit: 30, cash: 20 });
  assert.throws(() => economy.splitCharge(wallet, 200, "credit_then_cash"), { code: "insufficient_credit" });
  assert.deepEqual(economy.splitCharge(wallet, 200, "credit_then_cash", { shortfall: "cash" }), { credit: 30, cash: 170 });
  assert.deepEqual(economy.splitCharge(wallet, 40, "cash"), { credit: 0, cash: 40 });
  assert.throws(() => economy.splitCharge({ credit: 500, cash: 10 }, 40, "cash"), { code: "insufficient_cash" });
  // A negative balance covers nothing.
  assert.deepEqual(economy.splitCharge({ credit: -5, cash: 10 }, 8, "credit_then_cash"), { credit: 0, cash: 8 });
});

// Credit end to end on a freshly migrated database (its own): new accounts' balances, games and
// predictions spending Credit, the trading fee taking Credit first, sales earning Credit, the
// weekly conversion, share fees falling through to Cash, and net worth.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("credit end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_credit_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_credit_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_credit_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const quiet = console.warn;
  console.warn = () => {};
  const log = console.log;
  console.log = () => {};
  try {
    await applySchema(pool);
  } finally {
    console.warn = quiet;
    console.log = log;
  }

  const inTx = async (work) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const balances = async (id) => {
    const { rows } = await pool.query(`SELECT cash_balance, credit_balance FROM market.portfolio_cash_balances WHERE user_id = $1`, [id]);
    return { cash: Number(rows[0].cash_balance), credit: Number(rows[0].credit_balance) };
  };
  const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);

  const { rows: userRows } = await pool.query(
    `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
     VALUES ('alice', 'alice', 'alice@example.test', true, 'x', 'x', '{}') RETURNING id`
  );
  const alice = Number(userRows[0].id);

  // ── A new account gets both ──
  let b = await inTx((client) => economy.lockWallet(client, alice));
  assert.deepEqual([b.cash, b.credit], [getStarterCash(), getStarterCredit()]);
  const starter = await pool.query(`SELECT cash_delta, credit_delta FROM market.ledger_entries WHERE user_id = $1 AND entry_type = 'starter_cash_grant'`, [alice]);
  assert.deepEqual([Number(starter.rows[0].cash_delta), Number(starter.rows[0].credit_delta)], [getStarterCash(), getStarterCredit()]);
  const startCash = getStarterCash();
  const startCredit = getStarterCredit();

  // ── Games spend Credit and pay into it; Cash doesn't move while Credit lasts ──
  await inTx((client) => wallet.debitCashForGameWithClient(client, { userId: alice, amount: 500, entryType: "gacha_pull_fee", referenceType: "test", referenceId: 1 }));
  await inTx((client) => wallet.creditCashForGameWithClient(client, { userId: alice, amount: 200, entryType: "table_payout", referenceType: "test", referenceId: 1 }));
  b = await balances(alice);
  assert.deepEqual([b.cash, b.credit], [startCash, startCredit - 300]);

  // ── Predictions too ──
  const left = await inTx((client) => predictionsCore.moveCash(client, alice, -1000, { entryType: "prediction_buy", marketId: 1 }));
  close(left, economy.sideModeSpendable({ credit: startCredit - 1300, cash: startCash }), "moveCash returns what's left to spend");
  await inTx((client) => predictionsCore.moveCash(client, alice, 250, { entryType: "prediction_sell", marketId: 1 }));
  b = await balances(alice);
  assert.deepEqual([b.cash, b.credit], [startCash, startCredit - 1050]);

  // ── Once Credit runs out: Cash tops it up (BBB), or nothing does ──
  await pool.query(`UPDATE market.portfolio_cash_balances SET credit_balance = 100, cash_balance = 1000 WHERE user_id = $1`, [alice]);
  const bet = () => inTx((client) => wallet.debitCashForGameWithClient(client, { userId: alice, amount: 300, entryType: "table_bet_debit", referenceType: "blackjack_round", referenceId: 77 }));
  if (economy.SETTINGS.sideModeFunds === "credit_then_cash") {
    await bet();
    b = await balances(alice);
    assert.deepEqual([b.credit, b.cash], [0, 800], "$100 from Credit, $200 from Cash");
    // The refund goes back where it came from: $200 to Cash, the rest to Credit.
    await inTx((client) => wallet.refundCashForGameWithClient(client, { userId: alice, amount: 300, referenceType: "blackjack_round", referenceId: 77 }));
    b = await balances(alice);
    assert.deepEqual([b.credit, b.cash], [100, 1000], "a refund undoes the split");
    // Winnings are Credit however the stake was paid.
    await bet();
    await inTx((client) => wallet.creditCashForGameWithClient(client, { userId: alice, amount: 600, entryType: "table_payout", referenceType: "blackjack_round", referenceId: 77 }));
    b = await balances(alice);
    assert.deepEqual([b.credit, b.cash], [600, 800]);
    await assert.rejects(
      inTx((client) => wallet.debitCashForGameWithClient(client, { userId: alice, amount: 5000, entryType: "table_bet_debit", referenceType: "blackjack_round", referenceId: 78 })),
      { code: "insufficient_credit" },
      "more than Credit and Cash together"
    );
  } else {
    await assert.rejects(bet(), { code: "insufficient_credit" }, "Cash doesn't cover a game while side modes are Credit only");
  }

  // ── A prediction void gives back Cash it took, through buys and limit orders ──
  await pool.query(`UPDATE market.portfolio_cash_balances SET credit_balance = 0, cash_balance = 1000 WHERE user_id = $1`, [alice]);
  if (economy.SETTINGS.sideModeFunds === "credit_then_cash") {
    await inTx((client) => predictionsCore.moveCash(client, alice, -400, { entryType: "prediction_buy", marketId: 9 }));
    await inTx((client) =>
      predictionsCore.moveCash(client, alice, 400, {
        entryType: "prediction_void_refund",
        marketId: 9,
        referenceType: "prediction_void",
        sources: [{ referenceType: "prediction_market", referenceId: 9 }],
      })
    );
    b = await balances(alice);
    assert.deepEqual([b.credit, b.cash], [0, 1000], "a void returns the Cash a buy took");
  }

  // ── Trading: shares cost Cash, the fee comes out of Credit, a sale earns Credit ──
  await pool.query(`UPDATE market.portfolio_cash_balances SET credit_balance = 50000, cash_balance = 10000 WHERE user_id = $1`, [alice]);
  await pool.query(`INSERT INTO market.market_runtime_state (state_key, trading_status) VALUES ('primary', 'open') ON CONFLICT (state_key) DO UPDATE SET trading_status = 'open'`);
  await pool.query(`INSERT INTO yt.youtube_channels (youtube_channel_id, name_short) VALUES ('UCtest', 'Test')`);
  await pool.query(
    `INSERT INTO market.market_assets (youtube_channel_id, symbol, display_name, status, max_supply, circulating_supply, treasury_supply, liquidity_depth, spread_bps, current_fair_value, current_fair_value_raw, current_mid_price)
     VALUES ('UCtest', 'TST', 'Test', 'active', 100000, 0, 100000, 1000000000, 100, 100, 100, 100)`
  );
  const before = await balances(alice);
  const buy = await trading.executeOrder(pool, { userId: alice, symbol: "TST", side: "buy", quantity: 10, refreshDerivedState: false });
  b = await balances(alice);
  close(b.cash, before.cash - buy.executed_price * 10, "the buy cost Cash for the shares only");
  close(b.credit, before.credit - buy.fee, "the fee came out of Credit");
  close(buy.fee_from_credit, buy.fee, "and the result says so");
  const sell = await trading.executeOrder(pool, { userId: alice, symbol: "TST", side: "sell", quantity: 10, refreshDerivedState: false });
  const afterSell = await balances(alice);
  close(afterSell.cash, b.cash + sell.executed_price * 10, "a sale's proceeds land in Cash in full");
  close(sell.credit_earned, Math.round(sell.executed_price * 10 * economy.SETTINGS.sellCreditRate * 100) / 100, "a sale earns Credit");
  close(afterSell.credit, b.credit - sell.fee + sell.credit_earned, "the sale's fee came out of Credit, its earnings went in");

  // ── The weekly conversion: 5% or $10,000, whichever is more (all of a smaller balance) ──
  const convert = (credit) => pool.query(`UPDATE market.portfolio_cash_balances SET credit_balance = $2, cash_balance = 0 WHERE user_id = $1`, [alice, credit]).then(() =>
    inTx((client) => economy.convertCredit(client, { rate: 0.05, minimum: 10000, evaluationId: 1 }))
  );
  for (const [credit, moved] of [
    [1_000_000, 50_000], // 5% is more than the minimum
    [99_000, 10_000], // the minimum is more than 5%
    [4_000, 4_000], // smaller than the minimum: all of it
  ]) {
    const result = await convert(credit);
    close(result.converted, moved, `${credit} Credit converts ${moved}`);
    b = await balances(alice);
    assert.deepEqual([b.credit, b.cash], [credit - moved, moved]);
  }
  const ledgerMove = await pool.query(`SELECT cash_delta, credit_delta FROM market.ledger_entries WHERE user_id = $1 AND entry_type = 'credit_conversion' ORDER BY id DESC LIMIT 1`, [alice]);
  assert.deepEqual([Number(ledgerMove.rows[0].cash_delta), Number(ledgerMove.rows[0].credit_delta)], [4000, -4000]);

  // ── Share fees: Credit first, then Cash, which can go below zero ──
  await pool.query(`UPDATE market.portfolio_cash_balances SET credit_balance = 30, cash_balance = 100 WHERE user_id = $1`, [alice]);
  await inTx((client) => economy.charge(client, alice, 200, { from: "credit_then_cash", shortfall: "cash", entryType: "share_fee", referenceType: "weekly_evaluation", referenceId: 1 }));
  b = await balances(alice);
  assert.deepEqual([b.credit, b.cash], [0, -70]);

  // ── Net worth counts Credit (BBB), with Cash and Credit reported apart ──
  await pool.query(`UPDATE market.portfolio_cash_balances SET credit_balance = 5000, cash_balance = 1000 WHERE user_id = $1`, [alice]);
  const worth = await netWorth.getCurrentNetWorth(pool, alice);
  const counts = economy.SETTINGS.netWorth === "cash_and_credit";
  close(Number(worth.cash_balance), 1000, "the cash figure is Cash only");
  close(Number(worth.credit_balance), 5000, "Credit reported apart");
  close(Number(worth.total_equity), counts ? 6000 : 1000, "net worth");
  close(netWorth.getStarterNetWorth(), getStarterCash() + (counts ? getStarterCredit() : 0), "all-time change starts from cash and Credit");
  const summary = await trading.getPortfolioSummary(pool, alice);
  close(summary.credit_balance, 5000, "the portfolio reports Credit");
  assert.equal(summary.economy.side_mode_funds, economy.SETTINGS.sideModeFunds);
});
