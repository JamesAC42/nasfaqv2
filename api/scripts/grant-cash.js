// One-time Cash from the house to named players, such as the make-good after blackjack (2026-11-09).
//
//   node scripts/grant-cash.js --grant 20261109 --amount 5000 "Player One" "Player Two"           shows what it would do
//   node scripts/grant-cash.js --grant 20261109 --amount 5000 "Player One" "Player Two" --apply   pays it
//
// Each player gets one ledger row (entry_type one_time_grant, reference one_time_grant/<grant>) and a
// notification. A grant id pays a player once, so running it again skips whoever already has it. An
// unknown name stops the whole run before anything is written. Names are exact.
const { Pool } = require("pg");
const { loadEnv } = require("../src/config");

const MAX_AMOUNT = 25000;

function parseArgs(argv) {
  const args = { names: [], apply: false, amount: NaN, grant: NaN };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--amount") args.amount = Number(argv[++index]);
    else if (arg === "--grant") args.grant = Number(argv[++index]);
    else args.names.push(arg);
  }
  if (!(args.amount > 0 && args.amount <= MAX_AMOUNT)) throw new Error(`--amount must be above 0 and at most ${MAX_AMOUNT}`);
  if (!Number.isInteger(args.grant) || args.grant <= 0) throw new Error("--grant must be a whole number, such as 20261109");
  if (!args.names.length) throw new Error("name at least one player");
  return args;
}

/** Pays each named player once for this grant. Returns one { username, status, cash_before, cash_after } per name. */
async function grantCash(pool, { names, amount, grant, apply }) {
  const economy = require("../src/services/economy");
  const notifications = require("../src/services/notifications");
  const client = await pool.connect();
  const results = [];
  try {
    await client.query("BEGIN");
    const { rows: users } = await client.query(`SELECT id, username FROM market.users WHERE username = ANY($1::text[])`, [names]);
    const missing = names.filter((name) => !users.some((user) => user.username === name));
    if (missing.length) throw new Error(`no such player: ${missing.join(", ")}`);
    for (const user of [...users].sort((a, b) => Number(a.id) - Number(b.id))) {
      const userId = Number(user.id);
      const wallet = await economy.lockWallet(client, userId);
      const { rows: already } = await client.query(
        `SELECT 1 FROM market.ledger_entries WHERE user_id = $1 AND reference_type = 'one_time_grant' AND reference_id = $2 LIMIT 1`,
        [userId, grant]
      );
      if (already.length) {
        results.push({ username: user.username, user_id: userId, status: "already paid", cash_before: wallet.cash, cash_after: wallet.cash });
        continue;
      }
      if (apply) await economy.pay(client, userId, amount, { to: "cash", entryType: "one_time_grant", referenceType: "one_time_grant", referenceId: grant });
      results.push({ username: user.username, user_id: userId, status: apply ? "paid" : "would pay", cash_before: wallet.cash, cash_after: wallet.cash + amount });
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (apply) {
    const dollars = `$${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    for (const result of results.filter((entry) => entry.status === "paid")) {
      await notifications
        .notify(
          pool,
          result.user_id,
          {
            kind: "referral",
            title: `A one-time ${dollars} in Cash`,
            body: "Blackjack could take too much too fast, so it has limits now and here's some Cash to get you back in the game.",
            href: "/games/blackjack",
          },
          { publish: false }
        )
        .catch((error) => console.error(`couldn't notify ${result.username}:`, error.message));
    }
  }
  return results;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const results = await grantCash(pool, args);
    for (const result of results) console.log(`${result.status.padEnd(12)} ${result.username}: Cash ${result.cash_before} -> ${result.cash_after}`);
    if (!args.apply) console.log("Nothing written. Add --apply to pay it.");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { grantCash, parseArgs };
