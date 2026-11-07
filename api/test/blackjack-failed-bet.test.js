const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const blackjack = require("../src/services/games/tables/blackjack");

// G1 in the state-machine audit: the first bet of a round inserts the round, and a bet that then
// fails (the wallet can't cover it) rolls that row back. The table used to keep the dead round's id,
// so every later bet at the table failed its foreign key until api-games restarted. On a freshly
// migrated database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

async function waitFor(check, { timeoutMs = 20_000, everyMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

test("a bet the wallet can't cover leaves the table playable", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_blackjack_failed_bet_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_blackjack_failed_bet_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_blackjack_failed_bet_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  const saved = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await require("../src/migrations").applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = saved;
  }

  const user = async (name, cash) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json)
       VALUES ($1, $1, $1 || '@example.test', true, 'x', 'x', '{}') RETURNING id`,
      [name]
    );
    const id = Number(rows[0].id);
    await pool.query(`INSERT INTO market.portfolio_cash_balances (user_id, cash_balance, credit_balance) VALUES ($1, $2, 0)`, [id, cash]);
    return id;
  };
  const broke = await user("broke", 0);
  const rich = await user("rich", 1000);

  await blackjack.init(pool);
  await blackjack.sit({ userId: broke, tableKey: "low", seat: 0 });
  await blackjack.sit({ userId: rich, tableKey: "low", seat: 1 });

  await assert.rejects(blackjack.bet({ userId: broke, tableKey: "low", amount: 50 }), { code: "insufficient_credit" });
  const afterFailure = blackjack.getTable("low");
  assert.equal(afterFailure.phase, "idle", "the failed bet didn't start a round");
  assert.equal(afterFailure.round_id, null, "the table doesn't keep the rolled-back round");

  // The broke player walks away, so the funded player's bet is the only one and the deal comes at once.
  await blackjack.leave({ userId: broke, tableKey: "low" });
  const placed = await blackjack.bet({ userId: rich, tableKey: "low", amount: 50 });
  assert.equal(placed.phase, "betting");
  const { rows: rounds } = await pool.query(`SELECT id, status, total_bet_cash FROM games.blackjack_rounds`);
  assert.equal(rounds.length, 1, "one round row, for the bet that went through");
  assert.equal(Number(placed.round_id), Number(rounds[0].id));
  assert.equal(Number(rounds[0].total_bet_cash), 50);

  // And the round plays to the end: the player stands when it's their turn, the dealer draws, it settles.
  const settled = await waitFor(async () => {
    const table = blackjack.getTable("low");
    if (table.phase === "playing" && table.turn === 1) await blackjack.act({ userId: rich, tableKey: "low", action: "stand" }).catch(() => {});
    const { rows } = await pool.query(`SELECT status FROM games.blackjack_rounds WHERE id = $1`, [rounds[0].id]);
    return rows[0]?.status === "settled" ? rows[0] : null;
  });
  assert.equal(settled.status, "settled");
  const { rows: bets } = await pool.query(`SELECT user_id, outcome FROM games.blackjack_bets WHERE round_id = $1`, [rounds[0].id]);
  assert.equal(bets.length, 1);
  assert.equal(Number(bets[0].user_id), rich);
  assert.ok(bets[0].outcome, "the bet has an outcome");
  // The table goes back to idle after the results, ready for the next round.
  await waitFor(() => blackjack.getTable("low").phase === "idle");
});
